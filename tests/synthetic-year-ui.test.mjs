import {createCanonicalMonthIndex, MONTH_INDEX_GROUP_SIZE} from '../js/canonical-month-index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticYearSeeder } from '../js/synthetic-year-seeder.mjs';
import { serializeCanonicalLedger, serializeFragmentedCanonicalLedger, CANONICAL_INDEX } from '../js/canonical-ledger-storage.mjs';
import { pageController, deferred } from './helpers/page-controller.mjs';

async function yearPage() {
  const state = { connectionError: null, saveGate: null, readbackGate: null, loseCommitResponse: false, releaseVerified: true, connects: [], writes: 0, releases: 0, snapshotReads: 0 };
  const manifest = { syntheticOnly: true, role: 'primary', revision: 0, databaseId: 'invented-ui-db', copyId: 'invented-ui-copy', snapshot: {}, catalogFinalizationPending: null };
  const objects = {};
  let storage;
  const lifecycle = {
    folderId: 'invented-ui-folder', state: 'ready', acceptingWrites: true, started: true, coordinator: { canWrite: true },
    async readManifest() { return structuredClone(manifest); },
    async readObject(path) { return objects[path]; },
    async readVerifiedSnapshot() {
      state.snapshotReads++;
      if (manifest.revision > 0 && state.readbackGate) await state.readbackGate.promise;
      return { manifest: structuredClone(manifest), objects: structuredClone(objects) };
    },
    async transact(transaction) {
      assert.deepEqual(transaction.expectedBase, manifest);
      if (state.saveGate) await state.saveGate.promise;
      state.writes++;
      for (const { logicalPath, content } of transaction.objects) {
        objects[logicalPath] = new TextEncoder().encode(content); manifest.snapshot[logicalPath] = 'invented-hash';
      }
      manifest.revision++;
      await storage.options.afterMutation();
      if (state.loseCommitResponse) {
        state.loseCommitResponse = false; lifecycle.state = 'recovery-required'; lifecycle.acceptingWrites = false;
        throw Object.assign(new Error('Invented lost response after commit'), { code: 'transaction-unresolved' });
      }
    }
  };
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; storage = this; }
    async prepare() {}
    async connect(options) {
      state.connects.push(options);
      if (state.connectionError) throw Object.assign(new Error('Private provider detail must not appear'), { code: state.connectionError });
      assert.ok(options.requireEmpty || options.requireExisting);
      if (options.requireEmpty) assert.equal(manifest.revision, 0, 'Fresh upload must not replace a saved copy');
      if (options.requireExisting) assert.ok(manifest.revision > 0, 'Reconnect requires the saved copy');
      lifecycle.state = 'ready'; lifecycle.acceptingWrites = true; this.lifecycle = lifecycle;
      this.options.onStatus({ state: 'ready' });
    }
    async release() { state.releases++; if (state.releaseVerified) this.lifecycle = null; return { released: state.releaseVerified }; }
  }
  const page = await pageController('synthetic-year', { DashboardSyntheticStorage: Storage, SyntheticYearSeeder, createCanonicalMonthIndex, MONTH_INDEX_GROUP_SIZE,
    serializeCanonicalLedger, serializeFragmentedCanonicalLedger });
  return { ...page, state, manifest, objects, storage,
    async upload() {
      await page.choose('empty-confirmed', true); await page.click('upload');
      await page.until(() => !page.get('preview').disabled);
    },
    storedVersion: () => JSON.parse(new TextDecoder().decode(objects[CANONICAL_INDEX])).version
  };
}

test('year page load and local preview never connect or write, and upload requires the checkbox', async () => {
  const h = await yearPage();
  assert.equal(h.get('upload').disabled, true);
  await h.click('upload'); await h.click('preview'); await h.until(() => !h.get('preview').disabled);
  assert.deepEqual(h.state.connects, []); assert.equal(h.state.writes, 0);
  assert.match(h.get('preview-result').textContent, /253 activities.*207 audit events/);
  assert.match(h.get('result').textContent, /No Google connection or Drive write/);
  assert.equal(h.intervals.size, 0);
});

for (const stage of ['authorization-cancelled', 'picker-cancelled']) test(`${stage} through the upload handler cannot continue to a save`, async () => {
  const h = await yearPage(); h.state.connectionError = stage;
  await h.upload();
  assert.equal(h.state.connects.length, 1); assert.equal(h.state.connects[0].requireEmpty, true);
  assert.equal(h.state.writes, 0); assert.equal(h.state.snapshotReads, 0); assert.equal(h.storage.lifecycle, null);
  assert.equal(h.get('result').dataset.state, 'error'); assert.doesNotMatch(h.get('result').textContent, /Private provider detail/);
  assert.equal(h.get('upload').disabled, false); assert.equal(h.get('verify').disabled, true);
  h.state.connectionError = null;
  await h.upload(); assert.equal(h.state.writes, 1); assert.equal(h.get('result').dataset.state, 'success');
});

test('pending upload disables repeated clicks and never reports success before commit/readback', async () => {
  const h = await yearPage(); h.state.saveGate = deferred();
  await h.choose('empty-confirmed', true); await h.click('upload');
  await h.until(() => h.state.snapshotReads > 0);
  assert.equal(h.get('upload').disabled, true);
  assert.notEqual(h.get('result').dataset.state, 'success');
  await h.click('upload'); await h.click('verify'); assert.equal(h.state.connects.length, 1); assert.equal(h.state.writes, 0);
  const warning = { preventDefault() { this.prevented = true; } }; await h.event('beforeunload', warning); assert.equal(warning.prevented, true);
  h.state.saveGate.resolve(); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.state.writes, 1); assert.ok(h.state.snapshotReads >= 2); assert.equal(h.get('result').dataset.state, 'success');
});

test('committed upload is not successful while post-commit readback is still pending', async () => {
  const h = await yearPage(); h.state.readbackGate = deferred();
  await h.choose('empty-confirmed', true); await h.click('upload');
  await h.until(() => h.state.writes === 1 && h.state.snapshotReads >= 2);
  assert.equal(h.manifest.revision, 1); assert.equal(h.get('preview').disabled, true);
  assert.notEqual(h.get('result').dataset.state, 'success');
  h.state.readbackGate.resolve(); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.get('result').dataset.state, 'success'); assert.equal(h.state.writes, 1);
});

test('lost response after commit remains uncertain until reconnect verifies, without a second write', async () => {
  const h = await yearPage(); h.state.loseCommitResponse = true; await h.upload();
  assert.equal(h.state.writes, 1); assert.equal(h.manifest.revision, 1);
  assert.equal(h.get('result').dataset.state, 'error'); assert.match(h.get('result').textContent, /Some files may have been saved/);
  assert.equal(h.get('upload').disabled, true); assert.equal(h.get('verify').disabled, true);
  const before = h.state.snapshotReads;
  await h.click('reconnect'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.state.connects.at(-1).requireExisting, true); assert.ok(h.state.snapshotReads > before);
  assert.match(h.get('result').textContent, /already contains the exact invented year/);
  assert.equal(h.get('result').dataset.state, 'success'); assert.equal(h.state.writes, 1);
  await h.click('verify'); await h.until(() => !h.get('preview').disabled); assert.equal(h.state.writes, 1);
});

test('unverified release remains a failure and holds the connection until verified release', async () => {
  const h = await yearPage(); await h.upload(); h.state.releaseVerified = false;
  await h.click('release'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.state.releases, 1); assert.equal(h.get('result').dataset.state, 'error');
  assert.match(h.get('result').textContent, /Release was not verified/); assert.doesNotMatch(h.get('result').textContent, /You can now open another tool/);
  assert.equal(h.get('upload').disabled, true);
  h.state.releaseVerified = true; await h.click('release'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.get('result').dataset.state, 'success'); assert.match(h.get('result').textContent, /released and verified/);
  assert.equal(h.storage.lifecycle, null); assert.equal(h.state.writes, 1);
});

test('new synthetic-year uploads use fragmented v3 and reconnect without conversion or a second write', async () => {
  const h = await yearPage(); await h.upload();
  assert.equal(h.get('result').dataset.state, 'success', h.get('result').textContent);
  assert.equal(h.storedVersion(), 3);
  const saved = structuredClone(h.objects);
  const physicalCount = Object.keys(saved).length;
  assert.ok(physicalCount > 15);
  await h.click('release'); await h.until(() => !h.get('preview').disabled);
  await h.click('reconnect'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.state.connects.at(-1).requireExisting, true);
  assert.equal(h.state.writes, 1);
  assert.deepEqual(h.objects, saved);
  assert.match(h.get('preview-result').textContent, new RegExp(`${physicalCount} storage objects`));
  assert.equal(h.get('result').dataset.state, 'success');
  h.navigator.onLine = false; await h.event('offline');
  for (const id of ['upload', 'reconnect', 'verify']) assert.equal(h.get(id).disabled, true);
});
