import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveActivities } from '../js/canonical-import.mjs';
import { CanonicalWorkspaceSession } from '../js/canonical-workspace-session.mjs';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { serializePackedCanonicalLedger, serializeCanonicalLedger, serializeFragmentedCanonicalLedger } from '../js/canonical-ledger-storage.mjs';

const recipe = await createSyntheticFinancialYear();
function setup(layout = 'chunks-v2') {
  const manifest = { syntheticOnly: true, databaseId: 'invented-db', copyId: 'invented-copy', revision: 1, snapshot: {} };
  const serialize = {'records-v1': serializeCanonicalLedger, 'chunks-v2': serializePackedCanonicalLedger, 'fragments-v3': serializeFragmentedCanonicalLedger}[layout];
  let objects = Object.fromEntries([...serialize(recipe.ledger)].map(([path, text]) => [path, new TextEncoder().encode(text)]));
  for (const path of Object.keys(objects)) manifest.snapshot[path] = 'invented-hash';
  const calls = { connects: [], writes: 0, reads: 0, fail: false, loseResponse: false };
  const lifecycle = {
    state: 'ready', acceptingWrites: true, coordinator: { canWrite: true }, folderId: 'invented-folder',
    async readManifest() { return structuredClone(manifest); }, async readObject(path) { return objects[path]; },
    async readVerifiedSnapshot() { calls.reads++; return { manifest: structuredClone(manifest), objects: structuredClone(objects) }; },
    async transact(transaction) {
      assert.deepEqual(transaction.expectedBase, manifest);
      if (calls.fail) throw Object.assign(new Error('private failure'), { code: 'base-conflict' });
      calls.writes++;
      for (const { logicalPath, content } of transaction.objects) { objects[logicalPath] = new TextEncoder().encode(content); manifest.snapshot[logicalPath] = 'invented-hash'; }
      manifest.revision++;
      if (calls.loseResponse) throw Object.assign(new Error('private lost response'), { code: 'transaction-unresolved' });
    }
  };
  const storage = {
    lifecycle: null, accessToken: 'invented-token',
    async connect(options) { calls.connects.push(options); this.lifecycle = lifecycle; },
    async release() { this.lifecycle = null; return { released: true }; }
  };
  const session = new CanonicalWorkspaceSession({ storage });
  return { session, storage, lifecycle, calls, manifest };
}

test('open selects an existing synthetic copy and independently loads canonical records', async () => {
  const h = setup(); await h.session.open();
  assert.deepEqual(h.calls.connects, [{ requireExisting: true }]);
  assert.deepEqual(h.session.ledger, recipe.ledger);
  assert.equal(h.session.dirty, false); assert.equal(h.session.canEdit(), true); assert.equal(h.calls.writes, 0);
});

function correction(ledger, rationale = 'Invented corrected amount') {
  const activity = getEffectiveActivities(ledger).find(a => a.activityKind === 'spending' && !a.originalActivityId);
  return { activityId: activity.activityId, type: 'bank-correction', amountText: '-99.50', rationale };
}

test('corrections preserve source and base activities; explicit save then reopen preserves full graph', async () => {
  const h = setup(); await h.session.open();
  const before = structuredClone(h.session.ledger);
  h.session.correct(correction(before));
  assert.equal(h.calls.writes, 0); assert.equal(h.session.dirty, true);
  assert.deepEqual(h.session.ledger.observations, before.observations);
  assert.deepEqual(h.session.ledger.activities, before.activities);
  assert.equal(h.session.ledger.events.length, before.events.length + 1);
  const proposed = structuredClone(h.session.ledger);
  await h.session.save(); assert.equal(h.calls.writes, 1); assert.equal(h.session.dirty, false);
  await h.session.reopen(); assert.deepEqual(h.session.ledger, proposed); assert.equal(h.calls.writes, 1);
  assert.equal(h.session.store.layout, 'chunks-v2');
});

test('preview remains local and cannot save or run alongside a selected Drive session', async () => {
  const h = setup(); h.session.preview(recipe.ledger); h.session.correct(correction(h.session.ledger));
  assert.equal(h.session.mode, 'preview'); assert.equal(h.session.canSave(), false);
  await assert.rejects(h.session.save(), { code: 'verified-draft-required' });
  assert.equal(h.calls.writes, 0); assert.deepEqual(h.calls.connects, []);
  await h.session.open(); assert.throws(() => h.session.preview(recipe.ledger), { code: 'release-before-preview' });
});

test('offline/session uncertainty blocks edits until a verified reopen, retaining local draft', async () => {
  const h = setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger);
  h.lifecycle.state = 'ownership-unknown'; h.session.invalidate();
  assert.equal(h.session.canEdit(), false); assert.equal(h.session.canSave(), false);
  h.lifecycle.state = 'ready'; assert.equal(h.session.canSave(), false);
  assert.deepEqual(h.session.ledger, proposal);
  await h.session.reopen(); assert.equal(h.session.dirty, false); assert.equal(h.session.canEdit(), true);
});

for (const [flag, writes] of [['fail', 0], ['loseResponse', 1]]) test(`${flag} retains proposal and forbids blind save retry`, async () => {
  const h = setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger); h.calls[flag] = true;
  await assert.rejects(h.session.save());
  assert.equal(h.session.unverified, true); assert.equal(h.session.dirty, true);
  assert.equal(h.session.canSave(), false); assert.deepEqual(h.session.ledger, proposal);
  await assert.rejects(h.session.save(), { code: 'verified-draft-required' }); assert.equal(h.calls.writes, writes);
  h.calls[flag] = false; await h.session.reopen(); assert.equal(h.session.unverified, false);
  assert.equal(h.session.dirty, false); assert.equal(h.calls.writes, writes);
  assert.deepEqual(h.session.ledger, flag === 'loseResponse' ? proposal : recipe.ledger);
});

test('release keeps draft read-only and clears credentials only after verified completion', async () => {
  const h = setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger);
  const release = h.storage.release;
  h.storage.release = async () => ({ released: false });
  await assert.rejects(h.session.release(), { code: 'release-unconfirmed' });
  assert.equal(h.storage.accessToken, 'invented-token'); assert.deepEqual(h.session.ledger, proposal);
  h.storage.release = release; await h.session.release();
  assert.equal(h.storage.accessToken, ''); assert.equal(h.session.dirty, true); assert.equal(h.session.canEdit(), false);
  assert.deepEqual(h.session.ledger, proposal);
});

test('failed open never adopts another copy as writable base for the retained draft', async () => {
  const h = setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger); h.storage.connect = async () => { throw new Error('invented cancellation'); };
  await assert.rejects(h.session.open());
  assert.deepEqual(h.session.ledger, proposal); assert.equal(h.session.canEdit(), false); assert.equal(h.session.canSave(), false);
});

test('missing canonical index and non-synthetic copies fail closed without initializing a ledger', async () => {
  for (const invalid of ['empty', 'production']) {
    const h = setup();
    h.lifecycle.readVerifiedSnapshot = async () => ({ manifest: { ...h.manifest, syntheticOnly: invalid !== 'production', snapshot: {} }, objects: {} });
    await assert.rejects(h.session.open(), { code: invalid === 'empty' ? 'canonical-ledger-required' : 'synthetic-data-required' });
    assert.equal(h.session.ledger, null); assert.equal(h.calls.writes, 0); assert.equal(h.session.canEdit(), false);
  }
});

test('rationale and engine validation are required; invalid changes remain atomic', async () => {
  const h = setup(); await h.session.open(); const before = structuredClone(h.session.ledger);
  assert.throws(() => h.session.correct(correction(before, ' ')), { code: 'correction-rationale-required' });
  assert.throws(() => h.session.correct({ ...correction(before), type: 'classification', activityKind: 'income' }), /classification-amount-conflict/);
  assert.deepEqual(h.session.ledger, before); assert.equal(h.session.dirty, false);
});

test('concurrent starts are refused while verified loading remains pending', async () => {
  const h = setup(); let finish; h.storage.connect = () => new Promise(resolve => { finish = () => { h.storage.lifecycle = h.lifecycle; resolve(); }; });
  const first = h.session.open(); await assert.rejects(h.session.open(), { code: 'operation-in-progress' });
  assert.equal(h.session.canEdit(), false); finish(); await first; assert.equal(h.session.canEdit(), true);
});

for (const layout of ['records-v1', 'fragments-v3']) test(`${layout} workspace correction saves and reopens without conversion`, async () => {
  const h = setup(layout); await h.session.open();
  assert.equal(h.session.store.layout, layout);
  h.session.correct(correction(h.session.ledger)); const proposal = structuredClone(h.session.ledger);
  await h.session.save(); await h.session.reopen();
  assert.equal(h.session.store.layout, layout); assert.deepEqual(h.session.ledger, proposal); assert.equal(h.calls.writes, 1);
});
