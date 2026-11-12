import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {LocatorBatchAdapter,ordered} from './helpers/paged-locator-batch-fixture.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {storageWriteDiagnostic} from '../js/storage-write-diagnostic.mjs';

function fixture(mode) {
  const drive = new HttpCatalogDrive();
  let target, reads = 0, writes = 0, online = true;
  drive.beforeResponse = ({category, fileId}) => {
    const file = drive.files.get(fileId);
    if (category !== 'metadata' || file?.metadata.appProperties?.financeTrackerKind !== 'locator-catalog-page') return;
    target ??= fileId;
    if (fileId !== target) return;
    reads++;
    if (reads === 3 || mode === 'never-stable' && reads > 3) {
      file.metadata.version = String(BigInt(file.metadata.version) + 1n);
      if (mode === 'corrupt') file.bytes[0] ^= 1;
      if (mode === 'binding') file.metadata.appProperties.financeTrackerTransaction = 'invented-wrong-transaction';
      if (mode === 'offline') online = false;
    }
  };
  const app = new ApplicationStorageLifecycle({syntheticOnly: true, pagedCanonical: true,
    verificationPlans: canonicalPartitionVerificationPlans(), folderName: 'invented synthetic readback',
    folderId: drive.folderId, accessToken: () => 'invented-test-token', fetchImpl: drive.fetch, makeManifest: () => {},
    initializeManifest: ({adapter,guard}) => initializePagedCanonicalCopy({adapter,guard}),
    afterMutation: () => { writes++; }, isOnline: () => online,
    adapterOptions: {visibilityDelayMs: 0, visibilityMaxDelayMs: 0},
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}, lifecycleTarget: null});
  return {drive, app, get target() { return target; }, get writes() { return writes; }};
}

const createsOf = h => h.drive.requests.filter(row => row.category === 'create' && row.fileId === h.target);

test('new locator whose metadata version settles initializes and seeds with one create per page', async () => {
  const h = fixture('settles');
  await h.app.start();
  assert.equal(h.app.state, 'ready');
  assert.equal(createsOf(h).length, 1);
  const store = new CanonicalLedgerStore({lifecycle: h.app});
  assert.equal(await store.load(), null);
  const {ledger} = replayFixture(2);
  await store.save(ledger);
  assert.deepEqual(await new CanonicalLedgerStore({lifecycle: h.app}).load(), ledger);
  assert.equal(createsOf(h).length, 1);
  await h.app.release();
});

for (const [mode, reason] of [['never-stable','version-mismatch'], ['corrupt','hash-mismatch'], ['binding','metadata-mismatch'], ['offline','offline']]) {
  test(`new-page revalidation refuses ${mode} without rewriting or deleting evidence`, async () => {
    const h = fixture(mode);
    await assert.rejects(h.app.start(), error => {
      if(mode==='offline') {
        // A settled version-only read completes; the next mutation is refused
        // before dispatch by its offline guard, not by immutable readback.
        assert.equal(error.code,'guard-scope');
        assert.equal(error.details.guardError.code,'offline');
      } else {
        assert.equal(error.code, 'write-unresolved');
        assert.equal(error.details.readbackError.code, reason);
        assert.equal(storageWriteDiagnostic(error).readback, reason);
      }
      return true;
    });
    assert.equal(h.writes, 4);
    assert.equal(h.drive.files.size, 5);
    assert.equal(createsOf(h).length, 1);
    assert.equal(h.app.acceptingWrites, false);
    assert.equal(h.app.manifestFileId, null);
  });
}

test('post-create metadata absence has the same four-write symptoms but remains a distinct unresolved cause', async () => {
  const h = fixture('unused'); h.drive.beforeResponse = null;
  const respond = h.drive.respond.bind(h.drive); let reads = 0;
  h.drive.respond = async (...args) => {
    const [, , category, id] = args;
    if (category === 'metadata' && h.drive.files.get(id)?.metadata.appProperties?.financeTrackerKind === 'locator-catalog-page' && ++reads === 2) {
      return new Response('{}', {status: 404});
    }
    return respond(...args);
  };
  await assert.rejects(h.app.start(), error => {
    assert.equal(error.code, 'write-unresolved');
    assert.equal(error.details.readbackError.code, 'object-not-found');
    assert.equal(storageWriteDiagnostic(error).readback, 'object-not-found');
    return true;
  });
  assert.equal(h.writes, 4); assert.equal(h.drive.files.size, 5);
  assert.equal(h.app.acceptingWrites, false);
});

test('cancellation during a new-page version retry preserves its exact dispatched identity', async () => {
  const adapter = new LocatorBatchAdapter(), controller = new AbortController();
  const entries = ordered([adapter.object(1)]), original = adapter.readMetadata.bind(adapter);
  let reads = 0, target;
  adapter.readMetadata = async (id, options) => {
    const metadata = await original(id, options);
    if (metadata.appProperties.financeTrackerKind === 'locator-catalog-page') {
      target ??= id;
      if (id === target && ++reads === 2) {
        metadata.version = String(BigInt(metadata.version) + 1n);
        setTimeout(() => controller.abort(), 0);
      }
    }
    return metadata;
  };
  const tree = createPagedPhysicalLocators(adapter, {databaseId: adapter.databaseId, copyId: adapter.copyId,
    folderId: adapter.folderId, assertWritable: async () => {}});
  await assert.rejects(tree.build(entries, {signal: controller.signal}), error => {
    assert.equal(error.code, 'write-unresolved'); assert.equal(error.details.fileId, target);
    assert.equal(error.details.readbackError.name, 'AbortError'); return true;
  });
  assert.equal(adapter.attempts.length, 1);
  assert.ok(adapter.files.has(target));
});
