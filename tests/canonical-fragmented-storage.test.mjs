import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { fixture, lifecycleFor, correct, now, guard, gate, encode } from './helpers/canonical-storage-fixture.mjs';
import { CanonicalLedgerStore, CANONICAL_INDEX, CANONICAL_PREFIX, serializeCanonicalLedger, serializePackedCanonicalLedger, serializeFragmentedCanonicalLedger, validateCanonicalSnapshot } from '../js/canonical-ledger-storage.mjs';
import { fragmentCanonicalObjects, fragmentInventory, reassembleCanonicalObjects, FRAGMENT_BYTES, FRAGMENT_OBJECT_BYTES, FRAGMENT_LOGICAL_BYTES, FRAGMENT_TOTAL_BYTES } from '../js/canonical-fragments.mjs';
import { setupCatalog, MemoryCatalogDrive } from './helpers/catalog-drive.mjs';
import { CatalogTransactionEngine } from '../js/catalog-transaction-engine.mjs';
import { exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
import { denseLedgerFixture } from './helpers/dense-ledger-fixture.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent } from '../js/canonical-import.mjs';
import { replayRow, replayFixture } from './helpers/ledger-replay-fixtures.mjs';
const snapshot = objects => Object.fromEntries([...objects].map(([path, text]) => [path, encode(text)]));
function memoryLifecycle(objects = new Map()) {
  let manifest = { syntheticOnly: true, snapshot: Object.fromEntries([...objects.keys()].map(path => [path, {}])) };
  return { writes: 0, readManifest: async () => structuredClone(manifest), readObject: async path => encode(objects.get(path)),
    async transact({ objects: changes }) { this.writes++; for (const { logicalPath, content } of changes) { objects.set(logicalPath, content); manifest.snapshot[logicalPath] = {}; } manifest.revision = (manifest.revision || 0) + 1; }, objects };
}

test('fragments preserve exact canonical Unicode across byte splits and reject unsupported legacy index versions', async () => {
  const { ledger } = await fixture();
  ledger.accounts[0].inventedEvidence = '漢😀é\\\n'.repeat(30000);
  const packed = serializeFragmentedCanonicalLedger(ledger), root = JSON.parse(packed.get(CANONICAL_INDEX));
  assert.equal(root.version, 3);
  assert.ok([...packed.values()].every(text => encode(text).length <= FRAGMENT_OBJECT_BYTES));
  assert.ok(root.fragments[CANONICAL_PREFIX + 'chunks/accounts/000000.json'].parts > 1);
  assert.equal(validateCanonicalSnapshot({ objects: snapshot(packed) }), true);
  const logical = reassembleCanonicalObjects(root, packed);
  assert.deepEqual(JSON.parse(logical.get(CANONICAL_PREFIX + 'chunks/accounts/000000.json')).records, ledger.accounts);
  const store = new CanonicalLedgerStore({ lifecycle: memoryLifecycle(packed) });
  assert.deepEqual(await store.load(), ledger); assert.equal(store.layout, 'fragments-v3');
  // Frozen pre-v3 opening guard: versions other than 1/2 fail, at the same index path.
  const oldGuard = index => { if (![1, 2].includes(index.version)) throw new Error('unsupported'); };
  assert.throws(() => oldGuard(root), /unsupported/);
});

test('fragments roundtrip retries, immutable evidence, no-op and v1/v2 preservation', async () => {
  const { ledger, reviewInput } = await fixture();
  for (const layout of ['records-v1', 'chunks-v2', 'fragments-v3']) {
    const lifecycle = memoryLifecycle(), original = new CanonicalLedgerStore({ lifecycle, layout });
    await original.load(); await original.save(ledger);
    const store = new CanonicalLedgerStore({ lifecycle, layout: 'fragments-v3' });
    await store.load(); assert.equal(store.layout, layout);
    let next = correct(ledger); next = prepareCanonicalImport(next, reviewInput, { now }).ledger;
    await store.save(next); next = prepareCanonicalImport(next, reviewInput, { now }).ledger; await store.save(next);
    assert.deepEqual(await store.load(), next);
    const writes = lifecycle.writes; await store.save(next); assert.equal(lifecycle.writes, writes);
    for (const [change, code] of [
      [l => l.events.reverse(), 'history-order-change-refused'],
      [l => { l.activities[0].sourceDescription = 'Changed'; }, 'history-rewrite-refused'],
      [l => { l.observations[0].sourceFields.DESCRIPTION = 'Changed'; }, 'source-evidence-rewrite-refused'],
      [l => { l.imports.at(-1).retryAttempts[0].completedAt = '2026-11-07T12:00:00.000Z'; }, 'retry-history-rewrite-refused'],
      [l => { l.createdAt = '2026-11-07T12:00:00.000Z'; }, 'ledger-metadata-rewrite-refused']
    ]) { const changed = structuredClone(next); change(changed); await assert.rejects(store.save(changed), { code }); assert.equal(lifecycle.writes, writes); }
  }
});

test('all read paths reject missing, extra, reordered, duplicate, malformed, oversized and mismatched fragments', async () => {
  const { ledger } = await fixture(); ledger.accounts[0].inventedEvidence = '😀'.repeat(40000);
  const base = serializeFragmentedCanonicalLedger(ledger), root = JSON.parse(base.get(CANONICAL_INDEX));
  const parts = fragmentInventory(root), first = parts.find(path => path.includes('accounts')), second = first.replace('000000.json', '000001.json');
  const mutateJson = (objects, path, mutation) => { const value = JSON.parse(objects.get(path)); mutation(value); objects.set(path, JSON.stringify(value)); };
  for (const mutate of [
    o => o.delete(first), o => o.set(first + '.extra', '{}'), o => o.set(first, '{'),
    o => { const text = o.get(first); o.set(first, o.get(second)); o.set(second, text); },
    o => o.set(second, o.get(first)),
    o => mutateJson(o, first, v => { v.data += '='; }),
    o => mutateJson(o, first, v => { v.extra = true; }),
    o => mutateJson(o, first, v => { v.path = CANONICAL_INDEX; }),
    o => mutateJson(o, first, v => { v.ordinal = 2; }),
    o => o.set(first, o.get(first) + ' '.repeat(FRAGMENT_OBJECT_BYTES)),
    o => o.set(CANONICAL_INDEX, o.get(CANONICAL_INDEX) + ' '.repeat(FRAGMENT_OBJECT_BYTES)),
    o => mutateJson(o, CANONICAL_INDEX, v => { v.fragments[CANONICAL_INDEX].parts++; }),
    o => mutateJson(o, CANONICAL_INDEX, v => { v.fragments[CANONICAL_INDEX].bytes--; }),
    o => mutateJson(o, CANONICAL_INDEX, v => { v.extra = true; }),
    o => o.set(CANONICAL_PREFIX + 'accounts/orphan.json', '{}')
  ]) {
    const objects = new Map(base); mutate(objects);
    assert.throws(() => validateCanonicalSnapshot({ objects: snapshot(objects) }));
    for (const verified of [false, true]) {
      const lifecycle = memoryLifecycle(objects);
      if (verified) lifecycle.readVerifiedSnapshot = async () => ({ manifest: await lifecycle.readManifest(), objects: snapshot(objects) });
      const store = new CanonicalLedgerStore({ lifecycle }); await assert.rejects(store.load());
      await assert.rejects(store.save(ledger), { code: 'verified-base-required' }); assert.equal(lifecycle.writes, 0);
    }
  }
});

test('shrinking mutable buckets retain empty trailing fragments and reject nonempty padding', async () => {
  const { ledger } = await fixture();
  ledger.observations[0].inventedReviewNote = 'x'.repeat(FRAGMENT_BYTES * 3);
  const lifecycle = memoryLifecycle(), store = new CanonicalLedgerStore({ lifecycle, layout: 'fragments-v3' });
  await store.load(); await store.save(ledger);
  const before = new Set(lifecycle.objects.keys());
  delete ledger.observations[0].inventedReviewNote;
  await store.save(ledger); assert.deepEqual(await store.load(), ledger);
  assert.ok([...before].every(path => lifecycle.objects.has(path)));
  const empty = [...lifecycle.objects].find(([path, text]) => path !== CANONICAL_INDEX && JSON.parse(text).data === '');
  assert.ok(empty); const bytes = snapshot(lifecycle.objects); const value = JSON.parse(empty[1]); value.data = 'eA=='; bytes[empty[0]] = encode(value);
  assert.throws(() => validateCanonicalSnapshot({ objects: bytes }));
});

test('logical, aggregate and root limits reject admission before any write', async () => {
  const { ledger } = await fixture(); ledger.accounts[0].inventedEvidence = 'x'.repeat(FRAGMENT_LOGICAL_BYTES);
  const lifecycle = memoryLifecycle(), store = new CanonicalLedgerStore({ lifecycle, layout: 'fragments-v3' });
  await store.load(); await assert.rejects(store.save(ledger), { code: 'invalid-canonical-fragments' }); assert.equal(lifecycle.writes, 0);
  const root = { format: 'finance-tracker-canonical-index', version: 3, syntheticOnly: true, fragments: { [CANONICAL_INDEX]: { bytes: 1, parts: 1 } } };
  for (let i = 0; i < FRAGMENT_TOTAL_BYTES / FRAGMENT_LOGICAL_BYTES; i++) root.fragments[CANONICAL_PREFIX + `chunks/accounts/${String(i).padStart(6, '0')}.json`] = { bytes: FRAGMENT_LOGICAL_BYTES, parts: 256 };
  assert.throws(() => fragmentInventory(root), { code: 'invalid-canonical-fragments' });
  const logical = new Map([[CANONICAL_INDEX, '{}']]);
  for (let i = 0; i < 2000; i++) logical.set(CANONICAL_PREFIX + `chunks/accounts/${String(i).padStart(6, '0')}.json`, '{}');
  assert.throws(() => fragmentCanonicalObjects(logical), { code: 'invalid-canonical-fragments' });
});

test('fragmented catalog export/verify/fresh-copy restore preserves complete oversize records and history', async () => {
  const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout: 'fragments-v3' });
  const { ledger } = await fixture(); ledger.accounts[0].inventedEvidence = '漢😀'.repeat(30000);
  await store.load(); await store.save(ledger); const corrected = correct(ledger); await store.save(corrected);
  const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId, withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now });
  await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
  const targetAdapter = new MemoryCatalogDrive('invented-fragment-restore');
  const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure: validateSyntheticApplicationSnapshot });
  const engine = new CatalogTransactionEngine({ adapter: targetAdapter, assertWritable: guard, isOnline: () => true });
  const reopened = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ adapter: targetAdapter, engine, manifestFileId: restored.manifestFileId }) });
  assert.deepEqual(await reopened.load(), corrected); assert.equal(reopened.layout, 'fragments-v3');
});

test('every durable fragmented correction boundary recovers exact old/new history and permits safe retry', async t => {
  const { ledger } = await fixture(); ledger.accounts[0].inventedEvidence = 'x'.repeat(FRAGMENT_BYTES * 2);
  const corrected = applyFinancialEvent(ledger, { type: 'bank-correction', commandId: 'invented-fragment-correction', activityId: ledger.activities[0].activityId, amountText: '-90.00', evidence: 'x'.repeat(FRAGMENT_BYTES * 2) }, { now }), baseline = await setupCatalog();
  const baseStore = new CanonicalLedgerStore({ lifecycle: lifecycleFor(baseline), layout: 'fragments-v3' });
  await baseStore.load(); await baseStore.save(ledger); const before = baseline.adapter.mutations; await baseStore.save(corrected);
  const boundaries = baseline.adapter.mutations - before; assert.ok(boundaries > 8);
  for (let boundary = 1; boundary <= boundaries; boundary++) await t.test('durable mutation ' + boundary, async () => {
    const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout: 'fragments-v3' });
    await store.load(); await store.save(ledger); setup.adapter.stopAfter = setup.adapter.mutations + boundary;
    await assert.rejects(store.save(corrected), { code: 'transaction-unresolved' });
    await assert.rejects(store.save(corrected), { code: 'verified-base-required' }); setup.adapter.reboot();
    const engine = new CatalogTransactionEngine({ adapter: setup.adapter, assertWritable: guard, isOnline: () => true });
    await engine.recover({ manifestFileId: setup.manifestFileId });
    const fresh = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ ...setup, engine }) }), recovered = await fresh.load();
    assert.ok(isDeepStrictEqual(recovered, ledger) || isDeepStrictEqual(recovered, corrected));
    await fresh.save(corrected); assert.deepEqual(await fresh.load(), corrected);
  });
});

for (const years of (process.env.FRAGMENT_TEST_YEARS || '1').split(',').map(Number)) test(`dense ${years}-year imports save/reopen with bounded physical objects`, async () => {
  const { ledger } = denseLedgerFixture(years);
  assert.ok(encode(serializeCanonicalLedger(ledger).get(CANONICAL_INDEX)).length > FRAGMENT_OBJECT_BYTES);
  if (years > 1) assert.throws(() => serializePackedCanonicalLedger(ledger), { code: 'canonical-chunk-too-large' });
  const lifecycle = memoryLifecycle(), store = new CanonicalLedgerStore({ lifecycle, layout: 'fragments-v3' });
  await store.load(); assert.deepEqual(await store.save(ledger), ledger);
  assert.deepEqual(await new CanonicalLedgerStore({ lifecycle }).load(), ledger);
  assert.ok([...lifecycle.objects.values()].every(text => encode(text).length <= FRAGMENT_OBJECT_BYTES));
  assert.equal(validateCanonicalSnapshot({ objects: snapshot(lifecycle.objects) }), true);
});

test('a single dense prospective-rule membership larger than v2 cap saves/reopens intact', async () => {
  let { ledger, options } = replayFixture(4000, Array.from({ length: 4000 }, (_, i) => replayRow(i, { normalizedDescription: 'invented recurring merchant' })));
  ledger = applyFinancialEvent(ledger, { type: 'category-correction', commandId: 'invented-dense-rule', activityId: ledger.activities[0].activityId, categoryId: 'invented-rule' }, options);
  assert.ok(encode(canonicalizeJcs(ledger.imports[0])).length > FRAGMENT_OBJECT_BYTES);
  assert.equal(ledger.events[0].prospectiveRule.existingActivityIds.length, 4000);
  assert.ok(encode(canonicalizeJcs(ledger.events[0])).length > FRAGMENT_OBJECT_BYTES);
  assert.throws(() => serializePackedCanonicalLedger(ledger), { code: 'canonical-chunk-too-large' });
  const lifecycle = memoryLifecycle(), store = new CanonicalLedgerStore({ lifecycle, layout: 'fragments-v3' });
  await store.load(); assert.deepEqual(await store.save(ledger), ledger); assert.deepEqual(await store.load(), ledger);
});

test('reconstructed index and chunk inventories reject wrong versions, identities, order and logical orphans', async () => {
  const { ledger } = await fixture(), physical = serializeFragmentedCanonicalLedger(ledger);
  const root = JSON.parse(physical.get(CANONICAL_INDEX));
  const base = reassembleCanonicalObjects(root, physical);
  const accountPath = CANONICAL_PREFIX + 'chunks/accounts/000000.json';
  for (const mutate of [
    m => { const i = JSON.parse(m.get(CANONICAL_INDEX)); i.version = 1; m.set(CANONICAL_INDEX, canonicalizeJcs(i)); },
    m => { const i = JSON.parse(m.get(CANONICAL_INDEX)); i.collections.activities.reverse(); m.set(CANONICAL_INDEX, canonicalizeJcs(i)); },
    m => { const c = JSON.parse(m.get(accountPath)); c.records[0].accountId = 'invented-other'; m.set(accountPath, canonicalizeJcs(c)); },
    m => m.set(CANONICAL_PREFIX + 'chunks/accounts/999999.json', '{}')
  ]) {
    const logical = new Map(base); mutate(logical); const bad = fragmentCanonicalObjects(logical);
    assert.throws(() => validateCanonicalSnapshot({ objects: snapshot(bad) }));
    await assert.rejects(new CanonicalLedgerStore({ lifecycle: memoryLifecycle(bad) }).load());
  }
});
