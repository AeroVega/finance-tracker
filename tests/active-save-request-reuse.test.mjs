import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { CanonicalWorkspaceSession } from '../js/canonical-workspace-session.mjs';
import { getEffectiveActivities } from '../js/canonical-import.mjs';
import { setupHttpCanonicalWorkbench } from './helpers/pr28-http-workbench.mjs';
import { readCatalog, createCatalogHistoryVerifier, verifyCatalogHistory } from '../js/catalog-storage.mjs';

const recipe = await createSyntheticFinancialYear();
async function setup() {
  const h = await setupHttpCanonicalWorkbench();
  const store = new CanonicalLedgerStore({ lifecycle: h.lifecycle });
  await store.load();
  await store.save(recipe.ledger);
  const session = new CanonicalWorkspaceSession({ storage: { lifecycle: h.lifecycle } });
  await session.loadVerified();
  const activity = getEffectiveActivities(session.ledger).find(a => a.sourceDescription === 'INVENTED BROKERAGE FEE');
  return { ...h, session, activity };
}
function stage(h, revision = 0) {
  h.session.correct({ activityId: h.activity.activityId, type: 'classification', activityKind: 'spending', rationale: 'Invented correction ' + revision });
  h.session.correct({ activityId: h.activity.activityId, type: 'category-correction', categoryId: revision % 2 ? 'other' : 'fees', rationale: 'Invented category ' + revision });
  return structuredClone(h.session.ledger);
}
const bump = file => { file.metadata.version = String(BigInt(file.metadata.version) + 1n); };

test('active two-edit workspace saves reuse GET bytes with fresh checks as retained revisions grow', async t => {
  const h = await setup(), counts = [];
  let retained = 0;
  for (let revision = 0; revision < 6; revision++) {
    const expected = stage(h, revision);
    h.http.phase = 'save-' + revision;
    await h.session.save();
    assert.deepEqual(h.session.ledger, expected);
    assert.deepEqual(h.session.ledger.observations, recipe.ledger.observations);
    const metrics = h.http.summary(h.http.phase);
    assert.ok(metrics.requests <= 140, JSON.stringify(metrics));
    assert.equal(metrics.peakMutations, 1);
    assert.ok(metrics.peakConcurrency <= 4);
    counts.push(metrics.requests);
    h.http.phase = 'reopen';
    await h.session.reopen();
    assert.deepEqual(h.session.ledger, expected);
    const catalog = await readCatalog(h.lifecycle.transactionAdapter, h.http.json(h.manifestFileId));
    assert.ok(Object.keys(catalog.entries).length > retained);
    retained = Object.keys(catalog.entries).length;
  }
  await h.driver.verifyPortable();
  t.diagnostic(JSON.stringify({ activities: recipe.ledger.activities.length, saves: counts, retained }));
});

test('fresh closing metadata checks catalog roots, segments and retained entries even on cache hits', async t => {
  for (const kind of ['locator-catalog', 'locator-catalog-segment', 'snapshot-object', 'journal-event']) {
    for (const mode of ['version', 'folder', 'hash', 'missing', 'missing-trash-state']) await t.test(kind + ' ' + mode, async () => {
      const h = await setup();
      const adapter = h.lifecycle.transactionAdapter, manifest = h.http.json(h.manifestFileId);
      const catalog = await readCatalog(adapter, manifest);
      const root = h.http.json(manifest.locatorCatalog.fileId);
      const id = kind === 'locator-catalog' ? manifest.locatorCatalog.fileId : kind === 'locator-catalog-segment' ? root.segmentTip.fileId
        : Object.values(catalog.entries).find(entry => entry.kind === (kind === 'snapshot-object' ? 'data-object' : kind)).fileId;
      const snapshot = adapter.readMetadataSnapshot.bind(adapter);
      let calls = 0;
      adapter.readMetadataSnapshot = async () => {
        const metadata = await snapshot();
        if (++calls === 2) {
          const file = metadata.get(id);
          if (mode === 'version') file.version += '1';
          if (mode === 'folder') file.parents = ['invented-other-folder'];
          if (mode === 'hash') file.appProperties.financeTrackerHash = '0'.repeat(64);
          if (mode === 'missing') metadata.delete(id);
          if (mode === 'missing-trash-state') delete file.trashed;
        }
        return metadata;
      };
      const before = h.http.mutations;
      await assert.rejects(h.lifecycle.engine.verifyHistory(manifest));
      assert.equal(h.http.mutations, before);
    });
  }
});

test('new write readbacks cannot hide corruption or rebinding before publication', async t => {
  for (const kind of ['snapshot-object', 'journal-event', 'commit-record', 'locator-catalog-segment', 'locator-catalog']) {
    await t.test(kind, async () => {
      const h = await setup(), adapter = h.lifecycle.transactionAdapter;
      const expected = stage(h);
      let changed = false;
      adapter.afterMutation = async ({ kind: actual }) => {
        if (actual !== kind || changed) return;
        changed = true;
        const file = [...h.http.files.values()].filter(file => file.metadata.appProperties.financeTrackerKind === kind).at(-1);
        file.bytes[0] ^= 1;
        bump(file);
      };
      await assert.rejects(h.session.save());
      assert.equal(changed, true);
      assert.deepEqual(h.session.ledger, expected, 'the draft survives failed verification');
      assert.equal(h.session.dirty, true);
      assert.equal(h.http.json(h.manifestFileId).revision, 1, 'corruption blocks financial publication');
      assert.equal(h.lifecycle.acceptingWrites, false);
    });
  }
});

test('private write readbacks detach adapter receipts and are discarded after a failed operation', async () => {
  const h = await setup(), adapter = h.lifecycle.transactionAdapter;
  const create = adapter.createImmutable.bind(adapter), receipts = [];
  adapter.createImmutable = async options => {
    for (const receipt of receipts) { receipt.bytes.fill(0); receipt.metadata.parents = ['invented-other-folder']; }
    const result = await create(options);
    receipts.push(result.readback);
    return result;
  };
  const expected = stage(h);
  await h.session.save();
  assert.deepEqual(h.session.ledger, expected);
  await h.session.reopen();
  assert.deepEqual(h.session.ledger, expected);
  h.lifecycle.engine.invalidateHistory();
  h.http.phase = 'cold';
  await h.lifecycle.engine.verifyHistory(h.http.json(h.manifestFileId));
  assert.ok(h.http.summary('cold').categories.media > 30, 'cleared evidence and completed scopes cannot supply bytes');
});


test('raw bytes cannot forge an opaque write receipt, and closed scopes reject late admission', async () => {
  const h = await setup(), adapter = h.lifecycle.transactionAdapter, manifest = h.http.json(h.manifestFileId);
  const catalog = await readCatalog(adapter, manifest);
  const entry = Object.values(catalog.entries).find(entry => entry.kind === 'data-object');
  const file = h.http.files.get(entry.fileId), original = file.bytes.slice();
  file.bytes[0] ^= 1; bump(file);
  const verifier = createCatalogHistoryVerifier();
  let closed;
  await verifier.withWriteReadbacks(async remember => {
    closed = remember;
    assert.throws(() => remember(entry, file.metadata, original), { code: 'invalid-write-receipt' });
    await assert.rejects(verifier.verify(adapter, manifest), { code: 'immutable-hash-mismatch' });
  });
  assert.throws(() => closed({}), { code: 'expired-write-receipt-scope' });
  await assert.rejects(verifyCatalogHistory(adapter, manifest), { code: 'immutable-hash-mismatch' });
});

test('every active save mutation interruption preserves the draft and recovers one whole ledger', async t => {
  for (let boundary = 1; boundary <= 25; boundary++) await t.test('mutation ' + boundary, async () => {
    const h = await setup();
    const original = structuredClone(h.session.ledger), expected = stage(h);
    // The fake provider cannot become visible until reboot. Keep all eight
    // visibility attempts but remove real backoff time from synthetic failures.
    h.lifecycle.transactionAdapter.visibilityDelayMs = 0;
    h.lifecycle.transactionAdapter.visibilityMaxDelayMs = 0;
    h.http.stopAfterMutation = h.http.mutations + boundary;
    await assert.rejects(h.session.save());
    assert.deepEqual(h.session.ledger, expected);
    assert.equal(h.session.dirty, true);
    h.http.reboot();
    await h.lifecycle.recover();
    const reopened = await new CanonicalLedgerStore({ lifecycle: h.lifecycle }).load();
    const manifest = h.http.json(h.manifestFileId);
    assert.equal(manifest.catalogFinalizationPending, null);
    assert.ok([1, 2].includes(manifest.revision));
    assert.deepEqual(reopened, manifest.revision === 1 ? original : expected);
    assert.deepEqual(reopened.observations, recipe.ledger.observations);
    assert.deepEqual(h.session.ledger, expected, 'recovery must not erase the local draft');
  });
});
