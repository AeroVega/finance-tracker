import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApplicationStorageLifecycle } from '../js/application-storage-lifecycle.mjs';
import { CanonicalLedgerStore, CANONICAL_INDEX } from '../js/canonical-ledger-storage.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent } from '../js/canonical-import.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { setupCatalog } from './helpers/catalog-drive.mjs';
import { resolveSnapshotLocators } from '../js/drive-locator-catalog.mjs';
import { verifyCatalogHistory } from '../js/catalog-storage.mjs';

async function setup() {
  const { adapter, manifestFileId } = await setupCatalog();
  let session = null;
  const lifecycle = new ApplicationStorageLifecycle({
    syntheticOnly: true, catalogProtocol: true, folderName: 'Invented synthetic snapshot test',
    folderId: adapter.folderId, manifestFileId, accessToken: () => 'invented-test-token',
    makeManifest: () => ({}), lifecycleTarget: new EventTarget(),
    setIntervalImpl: () => 1, clearIntervalImpl: () => {},
    factories: {
      createSessionAdapter: () => ({ read: async () => structuredClone(session), write: async value => { session = structuredClone(value); } }),
      createTransactionAdapter: () => adapter
    }
  });
  await lifecycle.start();
  const store = new CanonicalLedgerStore({ lifecycle });
  assert.equal(await store.load(), null);
  let ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented snapshot checking', currency: 'USD', accountType: 'checking' });
  const parsed = await parseProviderCsv({ bytes: await readFile(new URL('../fixtures/pr28/wells-fargo-foundation.csv', import.meta.url)), sourceFormat: 'wells-fargo-csv-v1' });
  const accountId = ledger.accounts[0].accountId;
  ledger = prepareCanonicalImport(ledger, { parsed, syntheticOnly: true, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } } }).ledger;
  for (const row of ledger.activities) ledger = applyFinancialEvent(ledger, { type: 'classification', activityId: row.activityId, commandId: crypto.randomUUID(), activityKind: row.amountMinor < 0 ? 'spending' : 'income', categoryId: 'invented' });
  await store.save(ledger);
  return { adapter, manifestFileId, lifecycle, store, ledger };
}

test('canonical reopen uses one whole-history verification, not one for each record', async () => {
  const { adapter, lifecycle, ledger } = await setup();
  const manifest = await lifecycle.readManifest();
  const { catalog } = await verifyCatalogHistory(adapter, manifest);
  const reads = new Map(), original = adapter.readBytes.bind(adapter);
  adapter.readBytes = async id => { reads.set(id, (reads.get(id) || 0) + 1); return original(id); };
  lifecycle.readObject = async () => { throw new Error('per-record fallback must not run'); };
  const store = new CanonicalLedgerStore({ lifecycle });
  assert.deepEqual(await store.load(), ledger);
  for (const entry of Object.values(catalog.entries)) assert.equal(reads.get(entry.fileId), 1, 'every retained object is read exactly once');
  assert.equal(reads.get(manifest.locatorCatalog.fileId), 1);
  assert.equal(reads.get(lifecycle.manifestFileId), 2, 'exact manifest is checked before and after the snapshot');
  assert.deepEqual(store.base, manifest);
});

test('snapshot bytes are detached and each subsequent call re-verifies stored bytes', async () => {
  const { lifecycle, ledger } = await setup();
  const first = await lifecycle.readVerifiedSnapshot();
  first.objects[CANONICAL_INDEX].fill(0); first.manifest.revision = -1;
  const second = await lifecycle.readVerifiedSnapshot();
  assert.ok(second.manifest.revision >= 1);
  assert.equal(JSON.parse(new TextDecoder().decode(second.objects[CANONICAL_INDEX])).metadata.ledgerId, ledger.ledgerId);
});

test('changed manifest during a bulk read clears the canonical base and pauses writes', async () => {
  const { adapter, lifecycle, store, manifestFileId, ledger } = await setup();
  const original = adapter.readJson.bind(adapter); let reads = 0;
  adapter.readJson = async id => { const value = await original(id); if (id === manifestFileId && ++reads === 2) value.revision++; return value; };
  await assert.rejects(store.load(), { code: 'base-conflict' });
  assert.equal(store.base, null); assert.equal(lifecycle.acceptingWrites, false); assert.equal(lifecycle.state, 'recovery-required');
  await assert.rejects(store.save(ledger), { code: 'verified-base-required' });
});

test('corrupt retained bytes still reject bulk read and pause writes', async () => {
  const { adapter, lifecycle, store, ledger } = await setup();
  const manifest = await lifecycle.readManifest();
  const { catalog } = await verifyCatalogHistory(adapter, manifest);
  const selected = resolveSnapshotLocators(manifest.snapshot, catalog)[CANONICAL_INDEX];
  adapter.files.get(selected.fileId).bytes[0] ^= 1;
  await assert.rejects(store.load());
  assert.equal(store.base, null); assert.equal(lifecycle.acceptingWrites, false); assert.equal(lifecycle.engine.recoveryRequired, true);
  await assert.rejects(store.save(ledger), { code: 'verified-base-required' });
});

test('ownership lost during a verified snapshot prevents returning a writable base', async () => {
  const { lifecycle, store } = await setup();
  const original = lifecycle.requireReady.bind(lifecycle); let checks = 0;
  lifecycle.requireReady = async () => { if (++checks === 2) lifecycle.acceptingWrites = false; return original(); };
  await assert.rejects(store.load(), { code: 'storage-not-ready' });
  assert.equal(store.base, null); assert.equal(lifecycle.acceptingWrites, false);
});

test('bulk canonical loader rejects orphan paths, missing objects and malformed index bytes', async () => {
  const { lifecycle } = await setup();
  const verified = await lifecycle.readVerifiedSnapshot();
  const stub = value => ({ readVerifiedSnapshot: async () => value, readManifest: async () => { throw new Error('unexpected fallback'); }, readObject: async () => { throw new Error('unexpected fallback'); }, transact: async () => {} });
  const empty = { ...verified.manifest, snapshot: {} };
  const fresh = new CanonicalLedgerStore({ lifecycle: stub({ manifest: empty, objects: {} }) });
  assert.equal(await fresh.load(), null); assert.deepEqual(fresh.base, empty);
  const orphan = structuredClone(verified); delete orphan.manifest.snapshot[CANONICAL_INDEX];
  await assert.rejects(new CanonicalLedgerStore({ lifecycle: stub(orphan) }).load(), { code: 'canonical-index-missing' });
  const missing = structuredClone(verified); delete missing.objects[CANONICAL_INDEX];
  await assert.rejects(new CanonicalLedgerStore({ lifecycle: stub(missing) }).load(), { code: 'canonical-record-missing' });
  const malformed = structuredClone(verified); malformed.objects[CANONICAL_INDEX] = new TextEncoder().encode('{');
  await assert.rejects(new CanonicalLedgerStore({ lifecycle: stub(malformed) }).load(), { code: 'invalid-canonical-object' });
});

test('bulk reads still verify historical objects that are absent from the selected snapshot', async () => {
  const { adapter, lifecycle, store, ledger } = await setup();
  const previous = await lifecycle.readManifest();
  const { catalog: priorCatalog } = await verifyCatalogHistory(adapter, previous);
  const oldIndex = resolveSnapshotLocators(previous.snapshot, priorCatalog)[CANONICAL_INDEX];
  const changed = applyFinancialEvent(ledger, { type: 'category-correction', activityId: ledger.activities[0].activityId, commandId: crypto.randomUUID(), categoryId: 'invented-later-category' });
  await store.save(changed);
  const current = await lifecycle.readManifest();
  assert.notEqual(current.snapshot[CANONICAL_INDEX], previous.snapshot[CANONICAL_INDEX]);
  adapter.files.get(oldIndex.fileId).bytes[0] ^= 1;
  await assert.rejects(store.load());
  assert.equal(store.base, null); assert.equal(lifecycle.acceptingWrites, false);
});
