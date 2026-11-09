import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, summarizeLedger } from '../js/canonical-import.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { CanonicalLedgerStore, CANONICAL_PREFIX, CANONICAL_INDEX, CANONICAL_CHUNK_RECORDS, CANONICAL_CHUNK_BYTES, serializeCanonicalLedger, serializePackedCanonicalLedger, validateCanonicalSnapshot } from '../js/canonical-ledger-storage.mjs';
import { setupCatalog, MemoryCatalogDrive } from './helpers/catalog-drive.mjs';
import { CatalogTransactionEngine } from '../js/catalog-transaction-engine.mjs';
import { verifyCatalogHistory, readVerified } from '../js/catalog-storage.mjs';
import { resolveSnapshotLocators } from '../js/drive-locator-catalog.mjs';
import { exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';

const now = '2026-11-06T12:00:00.000Z', guard = async () => {}, gate = operation => operation();
const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const snapshotOf = ledger => Object.fromEntries([...serializePackedCanonicalLedger(ledger)].map(([path, text]) => [path, encode(text)]));
function lifecycleFor({ adapter, manifestFileId, engine }) {
  return {
    manifestFileId,
    async readManifest() { const m = await adapter.readJson(manifestFileId); await verifyCatalogHistory(adapter, m); return m; },
    async readVerifiedSnapshot() {
      const manifest = await this.readManifest();
      const { catalog } = await verifyCatalogHistory(adapter, manifest);
      const objects = {};
      for (const [path, ref] of Object.entries(resolveSnapshotLocators(manifest.snapshot, catalog))) objects[path] = await readVerified(adapter, { ...ref, kind: 'snapshot-object' });
      return { manifest, objects };
    },
    async readObject(path) { return (await this.readVerifiedSnapshot()).objects[path]; },
    transact: transaction => engine.transact(transaction)
  };
}
async function fixture() {
  let ledger = registerAccount(createLedger({ now }), { institutionId: 'wells-fargo', name: 'Invented packed checking', currency: 'USD', accountType: 'checking' }, { now });
  const accountId = ledger.accounts[0].accountId;
  const input = parsed => ({ parsed, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } }, syntheticOnly: true });
  const parse = async name => parseProviderCsv({ bytes: await readFile(new URL('../fixtures/pr28/' + name, import.meta.url)), sourceFormat: 'wells-fargo-csv-v1' });
  ledger = prepareCanonicalImport(ledger, input(await parse('wells-fargo-foundation.csv')), { now }).ledger;
  for (const [i, activity] of ledger.activities.entries()) ledger = applyFinancialEvent(ledger, { type: 'classification', commandId: 'packed-classify-' + i, activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? 'spending' : 'income', categoryId: 'invented-default' }, { now });
  return { ledger, reviewInput: input(await parse('wells-fargo-review.csv')) };
}
const correct = ledger => applyFinancialEvent(ledger, { type: 'bank-correction', commandId: 'packed-correction', activityId: ledger.activities[0].activityId, amountText: '-90.00', evidence: 'Invented correction' }, { now });

test('packed roundtrip, append, corrections, retries, default reopen, and no-op retain exact logical history', async () => {
  const setup = await setupCatalog(), lifecycle = lifecycleFor(setup);
  const store = new CanonicalLedgerStore({ lifecycle, layout: 'chunks-v2' });
  assert.equal(await store.load(), null);
  let { ledger, reviewInput } = await fixture();
  assert.deepEqual(await store.save(ledger), ledger);
  ledger = correct(ledger);
  ledger = prepareCanonicalImport(ledger, reviewInput, { now }).ledger;
  await store.save(ledger);
  ledger = prepareCanonicalImport(ledger, reviewInput, { now }).ledger;
  assert.equal(ledger.imports.at(-1).retryAttempts.length, 1);
  await store.save(ledger);
  const reopened = new CanonicalLedgerStore({ lifecycle });
  assert.deepEqual(await reopened.load(), ledger);
  assert.equal(reopened.layout, 'chunks-v2');
  assert.equal(JSON.parse(new TextDecoder().decode(await lifecycle.readObject(CANONICAL_INDEX))).version, 2);
  const mutations = setup.adapter.mutations;
  assert.deepEqual(await reopened.save(ledger), ledger);
  assert.equal(setup.adapter.mutations, mutations);
  for (const [change, code] of [
    [l => l.events.reverse(), 'history-order-change-refused'],
    [l => { l.activities[0].sourceDescription = 'Changed'; }, 'history-rewrite-refused'],
    [l => { l.observations[0].sourceFields.DESCRIPTION = 'Changed'; }, 'source-evidence-rewrite-refused'],
    [l => { l.imports.at(-1).retryAttempts[0].completedAt = '2026-11-07T12:00:00.000Z'; }, 'retry-history-rewrite-refused'],
    [l => { l.createdAt = '2026-11-07T12:00:00.000Z'; }, 'ledger-metadata-rewrite-refused']
  ]) {
    const changed = structuredClone(ledger); change(changed);
    await assert.rejects(reopened.save(changed), { code });
    assert.equal(setup.adapter.mutations, mutations);
  }
});

test('fixed 64-record boundaries preserve completed chunks on append and enforce byte limits before writes', async () => {
  let ledger = createLedger({ now });
  for (let i = 0; i < 65; i++) ledger = registerAccount(ledger, { institutionId: 'wells-fargo', name: 'Invented ' + i, currency: 'USD', accountType: 'checking' }, { now });
  const first = serializePackedCanonicalLedger(ledger);
  const index = JSON.parse(first.get(CANONICAL_INDEX));
  assert.equal(CANONICAL_CHUNK_RECORDS, 64); assert.equal(CANONICAL_CHUNK_BYTES, 131072);
  assert.equal(index.version, 2); assert.equal(index.chunks.accounts.length, 2);
  assert.deepEqual(index.chunks.accounts.map(path => JSON.parse(first.get(path)).records.length), [64, 1]);
  ledger = registerAccount(ledger, { institutionId: 'wells-fargo', name: 'Invented append', currency: 'USD', accountType: 'checking' }, { now });
  const next = serializePackedCanonicalLedger(ledger);
  assert.equal(next.get(index.chunks.accounts[0]), first.get(index.chunks.accounts[0]));
  assert.notEqual(next.get(index.chunks.accounts[1]), first.get(index.chunks.accounts[1]));
  const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout: 'chunks-v2' });
  await store.load();
  ledger.accounts[0].extraInventedEvidence = 'x'.repeat(CANONICAL_CHUNK_BYTES);
  assert.throws(() => serializePackedCanonicalLedger(ledger), { code: 'canonical-chunk-too-large' });
  const mutations = setup.adapter.mutations;
  await assert.rejects(store.save(ledger), { code: 'canonical-chunk-too-large' });
  assert.equal(setup.adapter.mutations, mutations);
});

test('v1 is not migrated by packed opt-in; v2 fails the old index contract at the same legacy path', async () => {
  const { ledger } = await fixture(), setup = await setupCatalog(), lifecycle = lifecycleFor(setup);
  const old = new CanonicalLedgerStore({ lifecycle }); await old.load(); await old.save(ledger);
  const chosen = new CanonicalLedgerStore({ lifecycle, layout: 'chunks-v2' });
  assert.deepEqual(await chosen.load(), ledger); assert.equal(chosen.layout, 'records-v1');
  const corrected = correct(ledger);
  await chosen.save(corrected);
  const manifest = await lifecycle.readManifest();
  assert.deepEqual(Object.keys(manifest.snapshot).sort(), [...serializeCanonicalLedger(corrected).keys()].sort());
  assert.equal(JSON.parse(new TextDecoder().decode(await lifecycle.readObject(CANONICAL_INDEX))).version, 1);
  // Frozen opening guard from validateIndex in js/canonical-ledger-storage.mjs
  // at c2d25b9a. This tests the old index contract, not whole-client integration,
  // and deliberately requires neither Git history nor a temporary module at runtime.
  function fail(code, message) { throw Object.assign(new Error(message), { code }); }
  function legacyIndexGuard(index) {
    if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 1 ||
        index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
        !index.collections || typeof index.collections !== "object") {
      fail("invalid-canonical-index", "The canonical index is not a supported synthetic record set.");
    }
  }
  const legacyPath = 'synthetic/canonical-v1/index.json';
  assert.equal(CANONICAL_INDEX, legacyPath);
  const v1 = serializeCanonicalLedger(ledger), v2 = serializePackedCanonicalLedger(ledger);
  assert.ok(v1.has(legacyPath)); assert.ok(v2.has(legacyPath));
  assert.doesNotThrow(() => legacyIndexGuard(JSON.parse(v1.get(legacyPath))));
  assert.throws(() => legacyIndexGuard(JSON.parse(v2.get(legacyPath))), { code: 'invalid-canonical-index' });
});

test('current backup validator, archive verification and fresh-copy restore preserve packed history and totals', async () => {
  const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout: 'chunks-v2' });
  await store.load(); const { ledger } = await fixture(); await store.save(ledger); const corrected = correct(ledger); await store.save(corrected);
  const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId, withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now });
  await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
  const targetAdapter = new MemoryCatalogDrive('invented-packed-restore');
  const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure: validateSyntheticApplicationSnapshot });
  const engine = new CatalogTransactionEngine({ adapter: targetAdapter, assertWritable: guard, isOnline: () => true });
  const reopened = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ adapter: targetAdapter, engine, manifestFileId: restored.manifestFileId }) });
  assert.deepEqual(await reopened.load(), corrected); assert.equal(reopened.layout, 'chunks-v2');
  const period = { start: '2026-01-01', end: '2026-01-31', currency: 'USD' };
  assert.deepEqual(summarizeLedger(await reopened.load(), period), summarizeLedger(corrected, period));
  assert.notEqual(restored.manifest.copyId, archive.sourceCopyId);
});

test('missing, malformed, wrong-order, wrong-collection, oversized, and mixed orphan chunks fail both read validators', async () => {
  const { ledger } = await fixture();
  for (const mutation of [
    objects => { const index = JSON.parse(new TextDecoder().decode(objects[CANONICAL_INDEX])); index.unsupported = true; objects[CANONICAL_INDEX] = encode(index); },
    objects => { const path = CANONICAL_PREFIX + 'chunks/activities/000000.json', chunk = JSON.parse(new TextDecoder().decode(objects[path])); chunk.unsupported = true; objects[path] = encode(chunk); },
    objects => { delete objects[CANONICAL_INDEX]; },
    objects => { delete objects[CANONICAL_PREFIX + 'chunks/activities/000000.json']; },
    objects => { objects[CANONICAL_PREFIX + 'chunks/activities/000000.json'] = encode('{'); },
    objects => { const path = CANONICAL_PREFIX + 'chunks/activities/000000.json', chunk = JSON.parse(new TextDecoder().decode(objects[path])); chunk.records.reverse(); objects[path] = encode(chunk); },
    objects => { const path = CANONICAL_PREFIX + 'chunks/activities/000000.json', chunk = JSON.parse(new TextDecoder().decode(objects[path])); chunk.collection = 'events'; objects[path] = encode(chunk); },
    objects => { const path = CANONICAL_PREFIX + 'chunks/activities/000000.json', chunk = JSON.parse(new TextDecoder().decode(objects[path])); chunk.extra = 'x'.repeat(CANONICAL_CHUNK_BYTES); objects[path] = encode(chunk); },
    objects => { const path = CANONICAL_PREFIX + 'chunks/activities/000000.json'; objects[path] = encode(new TextDecoder().decode(objects[path]) + ' '.repeat(CANONICAL_CHUNK_BYTES)); },
    objects => { objects[CANONICAL_PREFIX + 'activities/orphan.json'] = encode(ledger.activities[0]); },
    objects => { objects[CANONICAL_PREFIX + 'chunks/events/999999.json'] = encode({}); },
    objects => { const index = JSON.parse(new TextDecoder().decode(objects[CANONICAL_INDEX])); index.chunks.activities[0] = CANONICAL_PREFIX + 'chunks/events/000000.json'; objects[CANONICAL_INDEX] = encode(index); }
  ]) {
    const objects = snapshotOf(ledger); mutation(objects);
    assert.throws(() => validateCanonicalSnapshot({ objects }));
    let writes = 0;
    const manifest = { syntheticOnly: true, snapshot: Object.fromEntries(Object.keys(objects).map(path => [path, {}])) };
    const lifecycle = { readManifest: async () => manifest, readObject: async path => objects[path], transact: async () => { writes++; } };
    const store = new CanonicalLedgerStore({ lifecycle });
    await assert.rejects(store.load()); await assert.rejects(store.save(ledger), { code: 'verified-base-required' }); assert.equal(writes, 0);
  }
});

test('every durable packed correction boundary recovers exactly old or complete new history and permits safe retry', async t => {
  const { ledger } = await fixture(), corrected = correct(ledger);
  const baseline = await setupCatalog(), baseStore = new CanonicalLedgerStore({ lifecycle: lifecycleFor(baseline), layout: 'chunks-v2' });
  await baseStore.load(); await baseStore.save(ledger); const before = baseline.adapter.mutations; await baseStore.save(corrected);
  const boundaries = baseline.adapter.mutations - before; assert.ok(boundaries > 8);
  for (let boundary = 1; boundary <= boundaries; boundary++) await t.test('durable mutation ' + boundary, async () => {
    const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout: 'chunks-v2' });
    await store.load(); await store.save(ledger); setup.adapter.stopAfter = setup.adapter.mutations + boundary;
    await assert.rejects(store.save(corrected), { code: 'transaction-unresolved' });
    await assert.rejects(store.save(corrected), { code: 'verified-base-required' });
    setup.adapter.reboot();
    const engine = new CatalogTransactionEngine({ adapter: setup.adapter, assertWritable: guard, isOnline: () => true });
    await engine.recover({ manifestFileId: setup.manifestFileId });
    const fresh = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ ...setup, engine }) }), recovered = await fresh.load();
    assert.ok(isDeepStrictEqual(recovered, ledger) || isDeepStrictEqual(recovered, corrected));
    await fresh.save(corrected); assert.deepEqual(await fresh.load(), corrected);
    const mutations = setup.adapter.mutations; await fresh.save(corrected); assert.equal(setup.adapter.mutations, mutations);
  });
});

test('catalog source byte corruption refuses reopen, no-op save, changed save, and export without writes', async () => {
  const setup = await setupCatalog(), lifecycle = lifecycleFor(setup), store = new CanonicalLedgerStore({ lifecycle, layout: 'chunks-v2' });
  await store.load(); const { ledger } = await fixture(); await store.save(ledger);
  const manifest = await lifecycle.readManifest(), { catalog } = await verifyCatalogHistory(setup.adapter, manifest);
  const refs = resolveSnapshotLocators(manifest.snapshot, catalog), chunk = refs[CANONICAL_PREFIX + 'chunks/activities/000000.json'];
  setup.adapter.files.get(chunk.fileId).bytes = encode('corrupted source');
  const mutations = setup.adapter.mutations;
  await assert.rejects(store.save(ledger)); await assert.rejects(store.save(correct(ledger)));
  await assert.rejects(new CanonicalLedgerStore({ lifecycle }).load());
  await assert.rejects(exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId, withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now }));
  assert.equal(setup.adapter.mutations, mutations);
});

test('raw whitespace-padded chunks over 128 KiB are refused before parsing on both read paths', async () => {
  const { ledger } = await fixture(), objects = snapshotOf(ledger);
  const path = CANONICAL_PREFIX + 'chunks/activities/000000.json';
  objects[path] = encode(new TextDecoder().decode(objects[path]) + ' '.repeat(CANONICAL_CHUNK_BYTES));
  assert.throws(() => validateCanonicalSnapshot({ objects }), { code: 'invalid-canonical-chunk' });
  const manifest = { syntheticOnly: true, snapshot: Object.fromEntries(Object.keys(objects).map(key => [key, {}])) };
  for (const verified of [false, true]) {
    const lifecycle = { readManifest: async () => manifest, readObject: async key => objects[key], transact: async () => assert.fail('invalid chunks cannot write') };
    if (verified) lifecycle.readVerifiedSnapshot = async () => ({ manifest, objects });
    await assert.rejects(new CanonicalLedgerStore({ lifecycle }).load(), { code: 'invalid-canonical-chunk' });
  }
});
