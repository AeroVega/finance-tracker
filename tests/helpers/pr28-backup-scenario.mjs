import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ApplicationStorageLifecycle } from '../../js/application-storage-lifecycle.mjs';
import { GoogleDriveTransactionAdapter } from '../../js/drive-transaction-engine.mjs';
import { SessionCoordinator } from '../../js/session-coordination.mjs';
import { createDriveSessionAdapter } from '../../js/drive-session-adapter.mjs';
import { CanonicalLedgerStore } from '../../js/canonical-ledger-storage.mjs';
import { verifyCatalogHistory } from '../../js/catalog-storage.mjs';
import { validateSyntheticApplicationSnapshot } from '../../js/synthetic-application-structure.mjs';
import { createLiveRunner, LIVE_IDS } from '../../prototype/pr28-live-checks.mjs';
import * as currentBackup from '../../js/catalog-backup.mjs';
import { HttpCatalogDrive, HTTP_CATEGORIES } from './http-catalog-drive.mjs';
import { setupHttpCanonicalWorkbench, loadCanonicalFixtureBytes } from './pr28-http-workbench.mjs';

const accessToken = () => 'invented-test-token';
const validateStructure = validateSyntheticApplicationSnapshot;

async function measure(drives, phase, operation) {
  assert.ok(drives.every(http => http.active === 0));
  for (const http of drives) http.phase = phase;
  const started = performance.now();
  const result = await operation();
  const elapsedMs = performance.now() - started;
  assert.ok(drives.every(http => http.active === 0), 'HTTP requests must drain before a phase ends');
  const summaries = drives.map(http => http.summary(phase));
  return { result, measurement: {
    requests: summaries.reduce((sum, item) => sum + item.requests, 0),
    categories: Object.fromEntries(HTTP_CATEGORIES.map(category => [category,
      summaries.reduce((sum, item) => sum + item.categories[category], 0)])),
    peakConcurrency: Math.max(...summaries.map(item => item.peakConcurrency)),
    peakMutations: Math.max(...summaries.map(item => item.peakMutations)),
    // Optional transport delay is an invented local experiment. It is neither a
    // Google/Safari measurement nor a prediction; tests never assert this time.
    simulatedElapsedMs: Number(elapsedMs.toFixed(2))
  } };
}

async function destination(name, latencyMs) {
  const http = new HttpCatalogDrive({ folderId: 'invented-' + name + '-folder',
    idPrefix: 'invented-http-' + name + '-', latencyMs });
  const targetAdapter = new GoogleDriveTransactionAdapter({ folderId: http.folderId,
    accessToken, fetchImpl: http.fetch, cryptoImpl: webcrypto });
  const coordinator = new SessionCoordinator({ adapter: createDriveSessionAdapter({
    folderId: http.folderId, accessToken, fetchImpl: http.fetch }) });
  http.phase = name + '-connect';
  await coordinator.start();
  // Intentionally no periodic timer. Per-mutation ownership checks still use
  // the real session adapter; heartbeat requests are excluded, not optimized.
  return { http, coordinator, targetAdapter,
    withTargetLock: work => coordinator.withWrite(work),
    assertTargetWritable: () => coordinator.assertCanWrite({ online: true }) };
}

async function reopen(target, result, expectedLedger, expectedHistory, phase) {
  target.http.phase = phase + '-release';
  await target.coordinator.release();
  const lifecycle = new ApplicationStorageLifecycle({ syntheticOnly: true, catalogProtocol: true,
    folderName: 'Invented synthetic copied canonical state', folderId: target.http.folderId,
    manifestFileId: result.manifestFileId, accessToken, makeManifest: () => ({}),
    lifecycleTarget: new EventTarget(), fetchImpl: target.http.fetch,
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}, cryptoImpl: webcrypto });
  target.http.phase = phase + '-connect';
  await lifecycle.start();
  try {
    const { measurement } = await measure([target.http], phase, async () => {
      const store = new CanonicalLedgerStore({ lifecycle, cryptoImpl: webcrypto });
      assert.deepEqual(await store.load(), expectedLedger, 'the entire canonical graph and collection order must survive');
    });
    target.http.phase = phase + '-history-assertions';
    const history = await verifyCatalogHistory(target.targetAdapter, result.manifest);
    assert.deepEqual([...history.objects.keys()], [...expectedHistory.objects.keys()]);
    for (const [key, bytes] of expectedHistory.objects) {
      assert.deepEqual(history.objects.get(key), bytes, 'every retained byte must survive: ' + key);
      const { fileId: originalId, ...logical } = expectedHistory.catalog.entries[key];
      const { fileId: copiedId, ...copiedLogical } = history.catalog.entries[key];
      assert.notEqual(copiedId, originalId, 'the copy must have independent physical locators');
      assert.deepEqual(copiedLogical, logical, 'logical history must not change');
    }
    assert.equal(result.manifest.commitId, history.record.commitId);
    return measurement;
  } finally {
    target.http.phase = phase + '-release';
    await lifecycle.release();
  }
}

/** Complete the unchanged live recipe, then copy its actual retained history. */
export async function measureCanonicalBackupFlow({ variants = [{ name: 'current', implementation: currentBackup }], latencyMs = 0 } = {}) {
  const source = await setupHttpCanonicalWorkbench();
  let last;
  const runner = createLiveRunner({ withWorkbench: source.withWorkbench, loadBytes: loadCanonicalFixtureBytes,
    onUpdate: update => { last = update; if (update.current) source.http.phase = update.current; } });
  const recipeStart = source.http.requests.length;
  assert.equal(await runner.run(), true, JSON.stringify(last));
  assert.equal(Object.values(last.results).filter(result => result === 'passed').length, LIVE_IDS.length - 1);
  const recipeRequests = source.http.requests.length - recipeStart;
  source.http.phase = 'source-reconnect';
  await source.lifecycle.start();
  await source.driver.reopen();
  assert.equal(await runner.verifyReconnect(), true, JSON.stringify(last));
  assert.ok(Object.values(last.results).every(result => result === 'passed'));
  const manifest = source.http.json(source.manifestFileId);
  const sourceOptions = { sourceAdapter: source.lifecycle.transactionAdapter,
    sourceManifestFileId: source.manifestFileId,
    withSourceLock: operation => source.lifecycle.coordinator.withWrite(operation),
    assertSourceWritable: () => source.lifecycle.coordinator.assertCanWrite({ online: true }), validateStructure };
  source.http.phase = 'source-history-assertions';
  const sourceHistory = await verifyCatalogHistory(sourceOptions.sourceAdapter, manifest);
  const retainedByKind = Object.values(sourceHistory.catalog.entries).reduce((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1; return counts;
  }, {});
  assert.equal(Object.keys(manifest.snapshot).length, 66);
  assert.equal(Object.keys(sourceHistory.catalog.entries).length, 226);
  assert.equal(retainedByKind['journal-event'], 154);
  source.http.latencyMs = latencyMs;
  const report = { transportLatencyMs: latencyMs, heartbeatRequests: 0, recipeRequests,
    selectedObjects: Object.keys(manifest.snapshot).length,
    retainedObjects: Object.keys(sourceHistory.catalog.entries).length,
    retainedByKind, variants: {} };
  let expectedArchive;
  try {
    for (const { name, implementation } of variants) {
      const phase = suffix => name + '-' + suffix;
      const exported = await measure([source.http], phase('portable-export'), () => implementation.exportCatalogArchive({
        adapter: sourceOptions.sourceAdapter, manifestFileId: source.manifestFileId,
        withSourceLock: sourceOptions.withSourceLock, validateStructure, now: '2026-11-08T12:00:00.000Z' }));
      if (expectedArchive) assert.deepEqual(exported.result, expectedArchive, 'the exact archive envelope and history must match across implementations');
      else expectedArchive = structuredClone(exported.result);
      const portable = await measure([source.http], phase('portable-verify'), () => implementation.verifyCatalogArchive(exported.result, { validateStructure }));
      assert.equal(exported.result.objects.length, report.retainedObjects);
      assert.equal(exported.result.originalImports.length, 0, 'canonical processing must not invent retained CSVs');
      assert.equal(exported.result.objects.some(object => Object.hasOwn(object, 'fileId')), false);
      assert.deepEqual(portable.result.objects, sourceHistory.objects);
      const backupTarget = await destination(phase('backup'), latencyMs);
      const backup = await measure([source.http, backupTarget.http], phase('backup'), () => implementation.backupCatalogCopy({ ...sourceOptions, ...backupTarget }));
      assert.equal(backup.result.objectCount, report.retainedObjects);
      assert.equal(backup.result.manifest.role, 'backup');
      assert.notEqual(backup.result.manifest.copyId, manifest.copyId);
      const backupReopen = await reopen(backupTarget, backup.result, source.ledger, sourceHistory, phase('backup-reopen'));
      const restoreTarget = await destination(phase('restore'), latencyMs);
      const restore = await measure([restoreTarget.http], phase('restore'), () => implementation.restoreCatalogArchive({
        archive: exported.result, ...restoreTarget, validateStructure }));
      assert.equal(restore.result.objectCount, report.retainedObjects);
      assert.equal(restore.result.manifest.role, 'primary');
      assert.notEqual(restore.result.manifest.copyId, manifest.copyId);
      assert.notEqual(restore.result.manifest.copyId, backup.result.manifest.copyId);
      const restoreReopen = await reopen(restoreTarget, restore.result, source.ledger, sourceHistory, phase('restore-reopen'));
      assert.deepEqual(source.http.json(source.manifestFileId), manifest, 'copy operations must leave the source manifest unchanged');
      report.variants[name] = { portableExport: exported.measurement, portableVerify: portable.measurement,
        backup: backup.measurement, backupReopen, restore: restore.measurement, restoreReopen };
    }
  } finally {
    source.http.phase = 'source-release';
    await source.lifecycle.release();
  }
  return report;
}
