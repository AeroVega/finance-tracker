import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticYearSeeder } from '../js/synthetic-year-seeder.mjs';
import { CanonicalLedgerStore, CANONICAL_INDEX } from '../js/canonical-ledger-storage.mjs';
import { ApplicationStorageLifecycle } from '../js/application-storage-lifecycle.mjs';
import { initializePagedCanonicalCopy, inspectPagedCanonicalCopy } from '../js/paged-application-storage.mjs';
import { canonicalPartitionVerificationPlans } from '../js/canonical-paged-storage.mjs';
import { GoogleDriveTransactionAdapter } from '../js/drive-transaction-engine.mjs';
import { requireEmptySyntheticFolder } from '../js/dashboard-synthetic-storage.mjs';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { HttpCatalogDrive } from './helpers/http-catalog-drive.mjs';
import { pageController, deferred } from './helpers/page-controller.mjs';

// This deliberately legacy lifecycle controls cancellation, busy and failure
// ordering. It does not implement the requested v4 connection; the real-storage
// controller test below covers that path.
async function legacyYearPage() {
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
  const page = await pageController('synthetic-year', { DashboardSyntheticStorage: Storage, SyntheticYearSeeder });
  return { ...page, state, manifest, objects, storage,
    async upload() {
      await page.choose('empty-confirmed', true); await page.click('upload');
      await page.until(() => !page.get('preview').disabled);
    },
    storedVersion: () => JSON.parse(new TextDecoder().decode(objects[CANONICAL_INDEX])).version
  };
}

test('year page load and local preview never connect or write, and upload requires the checkbox', async () => {
  const h = await legacyYearPage();
  assert.equal(h.get('upload').disabled, true);
  await h.click('upload'); await h.click('preview'); await h.until(() => !h.get('preview').disabled);
  assert.deepEqual(h.state.connects, []); assert.equal(h.state.writes, 0);
  assert.match(h.get('preview-result').textContent, /253 activities.*207 audit events/);
  assert.match(h.get('result').textContent, /No Google connection or Drive write/);
  assert.equal(h.intervals.size, 0);
});

for (const stage of ['authorization-cancelled', 'picker-cancelled']) test(`${stage} through the upload handler cannot continue to a save`, async () => {
  const h = await legacyYearPage(); h.state.connectionError = stage;
  await h.upload();
  assert.equal(h.state.connects.length, 1); assert.equal(h.state.connects[0].requireEmpty, true);
  assert.equal(h.state.writes, 0); assert.equal(h.state.snapshotReads, 0); assert.equal(h.storage.lifecycle, null);
  assert.equal(h.get('result').dataset.state, 'error'); assert.doesNotMatch(h.get('result').textContent, /Private provider detail/);
  assert.equal(h.get('upload').disabled, false); assert.equal(h.get('verify').disabled, true);
  h.state.connectionError = null;
  await h.upload(); assert.equal(h.state.writes, 1); assert.equal(h.get('result').dataset.state, 'success');
});

test('pending upload disables repeated clicks and never reports success before commit/readback', async () => {
  const h = await legacyYearPage(); h.state.saveGate = deferred();
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
  const h = await legacyYearPage(); h.state.readbackGate = deferred();
  await h.choose('empty-confirmed', true); await h.click('upload');
  await h.until(() => h.state.writes === 1 && h.state.snapshotReads >= 2);
  assert.equal(h.manifest.revision, 1); assert.equal(h.get('preview').disabled, true);
  assert.notEqual(h.get('result').dataset.state, 'success');
  h.state.readbackGate.resolve(); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.get('result').dataset.state, 'success'); assert.equal(h.state.writes, 1);
});

test('lost response after commit remains uncertain until reconnect verifies, without a second write', async () => {
  const h = await legacyYearPage(); h.state.loseCommitResponse = true; await h.upload();
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
  const h = await legacyYearPage(); await h.upload(); h.state.releaseVerified = false;
  await h.click('release'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.state.releases, 1); assert.equal(h.get('result').dataset.state, 'error');
  assert.match(h.get('result').textContent, /Release was not verified/); assert.doesNotMatch(h.get('result').textContent, /You can now open another tool/);
  assert.equal(h.get('upload').disabled, true);
  h.state.releaseVerified = true; await h.click('release'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.get('result').dataset.state, 'success'); assert.match(h.get('result').textContent, /released and verified/);
  assert.equal(h.storage.lifecycle, null); assert.equal(h.state.writes, 1);
});

test('legacy storage seam retains fragmented v3 on reconnect without conversion or a second write', async () => {
  const h = await legacyYearPage(); await h.upload();
  assert.equal(h.get('result').dataset.state, 'success', h.get('result').textContent);
  assert.equal(h.storedVersion(), 3);
  const saved = structuredClone(h.objects);
  assert.ok(Object.keys(saved).length > 15);
  await h.click('release'); await h.until(() => !h.get('preview').disabled);
  await h.click('reconnect'); await h.until(() => !h.get('preview').disabled);
  assert.equal(h.state.connects.at(-1).requireExisting, true);
  assert.equal(h.state.writes, 1);
  assert.deepEqual(h.objects, saved);
  assert.match(h.get('preview-result').textContent, /New copies use canonical v5 with compact values and paged fallback/);
  assert.doesNotMatch(h.get('preview-result').textContent, /\d+ (?:physical |storage |payload )objects/);
  assert.equal(h.get('result').dataset.state, 'success');
  h.navigator.onLine = false; await h.event('offline');
  for (const id of ['upload', 'reconnect', 'verify']) assert.equal(h.get(id).disabled, true);
});

// Substitute DashboardSyntheticStorage orchestration and folder selection.
// The seeder, lifecycle, initialization, verification and HTTP adapters are real.
// Setup/retention composition, native browser permissions and live Google are
// not covered; HttpCatalogDrive supplies synthetic HTTP responses only.
async function pagedYearPage() {
  const http = new HttpCatalogDrive();
  const state = { connects: [], lifecycles: [], results: [], connection: null, admission: null, verification: null };
  let storage;
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; storage = this; }
    async prepare() {}
    connect(options) {
      state.connects.push(structuredClone(options));
      state.connection = this.connectLifecycle(options);
      return state.connection;
    }
    async connectLifecycle({ requireEmpty = false, requireExisting = false, canonicalLayout = null }) {
      assert.equal(this.lifecycle, null, 'A released connection must reopen with fresh lifecycle evidence');
      const adapter = new GoogleDriveTransactionAdapter({ folderId: http.folderId,
        accessToken: () => 'invented-test-token', fetchImpl: http.fetch });
      if (requireEmpty) {
        assert.equal(canonicalLayout, 'partitions-v5', 'The checked-in upload handler must request canonical v5');
        await requireEmptySyntheticFolder(adapter);
      }
      const inspected = await inspectPagedCanonicalCopy(adapter);
      if (requireExisting) assert.ok(inspected, 'Reconnect must select an existing saved v5 copy');
      const lifecycle = new ApplicationStorageLifecycle({
        syntheticOnly: true, pagedCanonical: Boolean(inspected) || canonicalLayout === 'partitions-v5',
        verificationPlans: canonicalPartitionVerificationPlans(),
        folderName: 'Invented synthetic year controller', folderId: http.folderId,
        manifestFileId: inspected?.manifestFileId,
        initializeManifest: ({ adapter, guard }) => initializePagedCanonicalCopy({ adapter, guard }),
        accessToken: () => 'invented-test-token', fetchImpl: http.fetch, makeManifest: () => ({}),
        adapterOptions: { visibilityDelayMs: 0, visibilityMaxDelayMs: 0 },
        onStatus: this.options.onStatus, afterMutation: this.options.afterMutation,
        setIntervalImpl: () => 1, clearIntervalImpl: () => {}, lifecycleTarget: null
      });
      this.lifecycle = lifecycle; state.lifecycles.push(lifecycle);
      await lifecycle.start();
    }
    async release() {
      const released = await this.lifecycle.release();
      if (released.released) this.lifecycle = null;
      return released;
    }
  }
  // Observe the actual seeder promises without replacing its recipe or logic.
  // Upload intentionally starts an unreturned operation from its click handler;
  // awaiting its work avoids imposing the small-DOM helper's five-second bound.
  class ObservedSeeder extends SyntheticYearSeeder {
    admitFreshConnection(lifecycle) {
      state.admission = super.admitFreshConnection(lifecycle);
      return state.admission;
    }
    verifyOrSeed(lifecycle) {
      state.verification = super.verifyOrSeed(lifecycle).then(result => { state.results.push(result); return result; });
      return state.verification;
    }
  }
  const page = await pageController('synthetic-year', { DashboardSyntheticStorage: Storage, SyntheticYearSeeder: ObservedSeeder });
  return { ...page, http, state, storage,
    async upload() {
      await page.choose('empty-confirmed', true); await page.click('upload');
      assert.ok(state.connection); await state.connection;
      await new Promise(setImmediate);
      assert.ok(state.admission); await state.admission;
      await new Promise(setImmediate);
      assert.ok(state.verification); await state.verification;
      await new Promise(setImmediate);
      assert.equal(page.get('preview').disabled, false, 'The upload handler finished');
    }
  };
}

test('new synthetic-year controller uploads genuine v5 and exactly reopens the full year without another financial commit', async t => {
  const h = await pagedYearPage();
  t.after(async () => { if (h.storage.lifecycle?.coordinator?.canWrite) await h.storage.release(); });
  const expected = (await createSyntheticFinancialYear()).ledger;
  assert.equal(expected.activities.length, 253);
  assert.equal(expected.observations.length, 253);
  assert.equal(expected.events.length, 207);
  await h.click('preview');
  assert.deepEqual(h.state.connects, []);
  assert.equal(h.http.requests.length, 0, 'Local preview makes no storage request');
  const preview = h.get('preview-result').textContent;
  assert.match(preview, /253 activities, 253 source observations and 207 audit events/);
  assert.match(preview, /New copies use canonical v5 with compact values and paged fallback/);
  assert.doesNotMatch(preview, /\d+ (?:physical |storage |payload )objects/);
  assert.match(h.get('result').textContent, /No Google connection or Drive write/);

  await h.upload();
  assert.deepEqual(h.state.connects, [{ requireEmpty: true, canonicalLayout: 'partitions-v5' }]);
  assert.equal(h.get('result').dataset.state, 'success', h.get('result').textContent);
  assert.match(h.get('result').textContent, /Uploaded and independently verified the complete invented year/);
  assert.equal(h.state.results[0].alreadySaved, false);
  assert.equal(h.state.results[0].storageLayout, 'partitions-v5');
  assert.deepEqual(h.state.results[0].ledger, expected);
  const first = h.storage.lifecycle;
  const manifest = await first.readManifest();
  assert.equal(manifest.format, 'finance-tracker-physical-root-manifest');
  assert.equal(manifest.version, 4);
  assert.equal(manifest.revision, '1');
  assert.equal(manifest.pending, null);
  const storedJson = hash => {
    const files = [...h.http.files.values()].filter(file => file.metadata.appProperties?.financeTrackerHash === hash);
    assert.equal(files.length, 1, 'The selected root must refer to stored bytes');
    return JSON.parse(new TextDecoder().decode(files[0].bytes));
  };
  const root = storedJson(manifest.root);
  assert.equal(root.format, 'finance-tracker-partitioned-canonical');
  assert.equal(root.version, 5);
  assert.equal(root.valueCodec, 'compact-json-v1');
  assert.equal(storedJson(root.source).format, 'finance-tracker-partitioned-canonical-source');
  assert.equal(storedJson(root.source).version, 2);
  assert.equal(storedJson(root.derived).format, 'finance-tracker-partitioned-canonical-derived');
  assert.equal(storedJson(root.derived).version, 2);
  assert.equal(storedJson(root.derived).source, root.source);
  const savedLedger = await new CanonicalLedgerStore({ lifecycle: first }).load();
  assert.deepEqual(savedLedger, expected);
  assert.deepEqual(savedLedger.observations, expected.observations);
  assert.deepEqual(savedLedger.events, expected.events);

  const financialFiles = () => structuredClone(new Map([...h.http.files]
    .filter(([, file]) => file.metadata.appProperties?.financeTrackerSession !== 'v1')));
  const savedFiles = financialFiles();
  const commits = [...savedFiles.values()].filter(file => file.metadata.appProperties?.financeTrackerKind === 'commit-record')
    .map(file => JSON.parse(new TextDecoder().decode(file.bytes)));
  assert.equal(commits.length, 2, 'Only genesis and one financial commit exist');
  assert.equal(commits.filter(commit => commit.operation === 'synthetic-canonical-import').length, 1);
  const beforeHandoff = h.http.requests.length;
  await h.click('release');
  assert.equal(h.get('result').dataset.state, 'success', h.get('result').textContent);
  assert.match(h.get('result').textContent, /released and verified/);
  assert.equal(h.storage.lifecycle, null);
  assert.equal(first.started, false);
  assert.equal(first.coordinator.canWrite, false);
  await h.click('reconnect');
  assert.deepEqual(h.state.connects.at(-1), { requireExisting: true });
  assert.notEqual(h.storage.lifecycle, first, 'Reconnect must not reuse the old lifecycle or store');
  assert.equal(h.state.lifecycles.length, 2);
  assert.equal(h.get('result').dataset.state, 'success', h.get('result').textContent);
  assert.match(h.get('result').textContent, /already contains the exact invented year.*No financial records were added or replaced/);
  assert.equal(h.state.results[1].alreadySaved, true);
  assert.equal(h.state.results[1].storageLayout, 'partitions-v5');
  assert.deepEqual(h.state.results[1].ledger, expected);
  await h.click('verify');
  assert.equal(h.get('result').dataset.state, 'success', h.get('result').textContent);
  assert.equal(h.state.results[2].alreadySaved, true);
  const reopened = await new CanonicalLedgerStore({ lifecycle: h.storage.lifecycle }).load();
  assert.deepEqual(reopened, savedLedger, 'Every saved collection and metadata field survives handoff');
  assert.deepEqual(reopened.observations, expected.observations);
  assert.deepEqual(reopened.events, expected.events);
  assert.deepEqual(await h.storage.lifecycle.readManifest(), manifest);
  assert.deepEqual(financialFiles(), savedFiles, 'Release, reconnect and verification cannot change financial bytes or metadata');
  const handoffMutations = h.http.requests.slice(beforeHandoff).filter(row => ['POST', 'PATCH'].includes(row.method));
  assert.ok(handoffMutations.length > 0, 'Session acquisition and release still update the session marker');
  assert.ok(handoffMutations.every(row => row.kind === 'session-marker'), 'Session marker writes are not financial commits');
  assert.equal(h.get('preview-result').textContent, preview);
  assert.equal(h.intervals.size, 0);
});
