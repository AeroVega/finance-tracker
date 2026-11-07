import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLiveRunner, LIVE_IDS, blankLive, prepareInterruption } from '../prototype/pr28-live-checks.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { summarizeLedger } from '../js/canonical-import.mjs';
import { setupCatalog } from './helpers/catalog-drive.mjs';
import { verifyCatalogHistory, readVerified } from '../js/catalog-storage.mjs';
import { resolveSnapshotLocators } from '../js/drive-locator-catalog.mjs';
import { exportCatalogArchive, verifyCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';
const loadBytes = path => readFile(new URL('../prototype/' + path, import.meta.url));

async function harness() {
  const setup = await setupCatalog();
  const { adapter, engine, manifestFileId } = setup;
  const lifecycle = {
    manifestFileId,
    async readManifest() { const manifest = await adapter.readJson(manifestFileId); await verifyCatalogHistory(adapter, manifest); return manifest; },
    async readObject(path) { const manifest = await this.readManifest(); const { catalog } = await verifyCatalogHistory(adapter, manifest); return readVerified(adapter, { ...resolveSnapshotLocators(manifest.snapshot, catalog)[path], kind: 'snapshot-object' }); },
    transact: transaction => engine.transact(transaction)
  };
  let store = new CanonicalLedgerStore({ lifecycle }); await store.load();
  let staged, dirty = false, connected = true, occupied = false;
  const calls = { saves: 0, opens: 0, portable: 0, revalidated: 0, releases: 0, leases: 0 };
  const identity = { databaseId: setup.manifest.databaseId, copyId: setup.manifest.copyId };
  const driver = {
    async requireFresh() { assert.equal(dirty, false); assert.equal(await store.load(), null); assert.equal(store.base.revision, 0); assert.deepEqual(store.base.snapshot, {}); },
    async identity() { return structuredClone(identity); },
    stage(next) { staged = structuredClone(next); dirty = true; },
    async save(next) { calls.saves++; const saved = await store.save(next); staged = saved; dirty = false; return saved; },
    async reopen() { calls.opens++; store = new CanonicalLedgerStore({ lifecycle }); staged = await store.load(); dirty = false; return staged; },
    async verifyPortable() { calls.portable++; const archive = await exportCatalogArchive({ adapter, manifestFileId, withSourceLock: op => op(), validateStructure: validateSyntheticApplicationSnapshot }); await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot }); },
    async revalidate() { calls.revalidated++; },
    async release() { calls.releases++; connected = false; }
  };
  const withWorkbench = async operation => { calls.leases++; assert.equal(connected, true); assert.equal(dirty, false); assert.equal(occupied, false); occupied = true; try { return await operation(driver); } finally { occupied = false; } };
  return { setup, lifecycle, calls, driver, withWorkbench, identity, connect() { connected = true; }, get ledger() { return staged; }, get dirty() { return dirty; } };
}

test('live runner uses the actual catalog engine for full invented recipe, saves, independent opens, archive and release', async () => {
  const h = await harness(); let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => { last = update; } });
  assert.equal(await runner.run(), true, JSON.stringify(last));
  assert.deepEqual(Object.keys(last.results), LIVE_IDS);
  assert.equal(Object.values(last.results).filter(value => value === 'passed').length, LIVE_IDS.length - 1);
  assert.equal(last.results['reconnect-same-copy'], 'not-run');
  assert.equal(h.calls.portable, 1); assert.equal(h.calls.releases, 1); assert.equal(h.calls.revalidated, 1);
  assert.equal(h.ledger.accounts.length, 5); assert.equal(h.ledger.events.length, 15); assert.equal(h.ledger.reviewDecisions.length, 8);
  const total = summarizeLedger(h.ledger, { start: '2026-01-01', end: '2026-03-31', currency: 'USD' });
  assert.equal(total.spending, '101.75'); assert.equal(total.income, '2250.37'); assert.equal(total.complete, false);
  h.connect(); assert.equal(await runner.verifyReconnect(), true); assert.equal(last.results['reconnect-same-copy'], 'passed');
  h.identity.copyId = 'different-copy'; assert.equal(await runner.verifyReconnect(), false); assert.equal(last.results['reconnect-same-copy'], 'failed');
  const mutations = h.setup.adapter.mutations;
  assert.equal(await runner.run(), false); assert.equal(last.state, 'blocked'); assert.equal(h.setup.adapter.mutations, mutations);
});

test('partial/failing runs report fixed statuses, never raw errors, never release or silently retry', async () => {
  const h = await harness(); let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes: async () => { throw new Error('private-token-and-provider-body'); }, onUpdate: update => { last = update; } });
  assert.equal(await runner.run(), false); assert.equal(last.results['mapping-coverage'], 'failed');
  assert.equal(last.results['first-save-reopen'], 'not-run'); assert.equal(h.calls.saves, 0); assert.equal(h.calls.releases, 0);
  assert.doesNotMatch(JSON.stringify(last), /private-token/);
});

test('concurrent clicks take one lease and stop waits for an admitted operation', async () => {
  const h = await harness(); let unblock, waiting;
  const gate = new Promise(resolve => { unblock = resolve; });
  const entered = new Promise(resolve => { waiting = resolve; });
  const originalSave = h.driver.save;
  h.driver.save = async value => { waiting(); await gate; return originalSave(value); };
  let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => { last = update; } });
  const pending = runner.run(); await entered;
  assert.equal(await runner.run(), false); assert.equal(h.calls.leases, 1);
  runner.stop(); assert.equal(runner.isRunning(), true); unblock();
  assert.equal(await pending, false); assert.equal(last.state, 'stopped');
  assert.equal(last.results['first-save-reopen'], 'passed'); assert.equal(last.results['repeat-import'], 'not-run');
  assert.equal(h.calls.saves, 1); assert.equal(h.calls.releases, 0);
  assert.equal(await runner.run(), false); assert.equal(last.state, 'blocked');
});

test('failed durable save is not repeated and leaves later checks unrun', async () => {
  const h = await harness(); let last;
  h.setup.adapter.stopAfter = h.setup.adapter.mutations + 1;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => { last = update; } });
  assert.equal(await runner.run(), false); assert.equal(last.results['first-save-reopen'], 'failed'); assert.equal(h.calls.saves, 1);
  assert.equal(last.results['repeat-import'], 'not-run'); assert.equal(h.calls.releases, 0);
  assert.equal(runner.canVerifyReconnect(), false);
});

test('interruption preparation saves baseline and stages just one unsaved classification', async () => {
  const h = await harness(); await prepareInterruption(h.withWorkbench, loadBytes);
  assert.equal(h.calls.saves, 1); assert.equal(h.calls.opens, 1); assert.equal(h.calls.releases, 0);
  assert.equal(h.ledger.events.length, 1); assert.equal(h.dirty, true);
  const saved = await new CanonicalLedgerStore({ lifecycle: h.lifecycle }).load();
  assert.equal(saved.events.length, 0); assert.equal(saved.activities.length, 4);
});

test('live status allowlist drops identifiers, strings outside its vocabulary and object coercion', () => {
  const result = blankLive({ 'fresh-base': ['passed'], 'mapping-coverage': 'passed', token: 'private' });
  assert.equal(result['fresh-base'], 'not-run'); assert.equal(result['mapping-coverage'], 'passed'); assert.equal(Object.hasOwn(result, 'token'), false);
});


test('historical statuses survive blocked preflight but never authorize reconnect; reset cannot resurrect them', async () => {
  let last;
  const runner = createLiveRunner({ recordedResults: { 'first-save-reopen': 'passed' }, withWorkbench: async () => { throw new Error('not-connected'); }, onUpdate: value => { last = value; } });
  assert.equal(runner.canVerifyReconnect(), false); assert.equal(await runner.verifyReconnect(), false);
  assert.equal(await runner.run(), false); assert.equal(last.state, 'blocked'); assert.equal(last.results['first-save-reopen'], 'passed');
  runner.forgetResults(); assert.equal(await runner.run(), false);
  assert.equal(last.results['first-save-reopen'], 'not-run'); assert.equal(runner.canVerifyReconnect(), false);
});

test('request metrics and throwing progress observers cannot alter operations or mark unrun checks passed', async () => {
  const { createDriveRequestMetrics } = await import('../js/drive-request-metrics.mjs');
  const requestMetrics = createDriveRequestMetrics();
  const fetch = requestMetrics.wrapFetch(async () => ({ status: 200 }));
  let parsed = 0;
  const runner = createLiveRunner({
    withWorkbench: operation => operation({ requestMetrics,
      async requireFresh() { await fetch('private-fresh'); },
      async identity() { await fetch('private-identity'); return { copyId: 'private-copy' }; }
    }),
    loadBytes: async () => { parsed++; throw new Error('private-fixture-failure'); },
    onUpdate: () => { throw new Error('private-observer-failure'); }
  });
  assert.equal(await runner.run(), false);
  assert.equal(parsed, 1, 'observer failures must not abort the admitted work');
  const metrics = runner.getMetrics();
  assert.equal(metrics.available, true); assert.equal(metrics.total.requests, 2);
  assert.equal(metrics.phases['fresh-base'].requests, 2);
  assert.equal(metrics.phases['mapping-coverage'].requests, 0);
  assert.equal(metrics.phases['first-save-reopen'], null);
  assert.doesNotMatch(JSON.stringify(metrics), /private-/);
  runner.forgetResults(); assert.equal(runner.getMetrics().available, false);
  assert.equal(requestMetrics.snapshot().requests, 2, 'reset only forgets reporting windows, not storage state');
});
