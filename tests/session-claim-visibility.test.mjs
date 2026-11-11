import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveSessionAdapter, SESSION_MARKER_NAME} from '../js/drive-session-adapter.mjs';
import {SessionCoordinator} from '../js/session-coordination.mjs';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

function fixture({wait = async () => {}, delays = [0, 0, 0]} = {}) {
  const http = new HttpCatalogDrive();
  const adapter = createDriveSessionAdapter({folderId: http.folderId,
    accessToken: () => 'invented-test-token', fetchImpl: http.fetch, wait, verificationDelays: delays});
  const coordinator = new SessionCoordinator({adapter});
  return {http, adapter, coordinator};
}

for (const lostResponse of [false, true]) test(`claim tolerates one omitted listing without repeating create, lost response ${lostResponse}`, async () => {
  const h = fixture(); let omitted = false;
  h.http.transformListing = files => {
    if (files.length && !omitted) { omitted = true; return []; }
    return files;
  };
  if (lostResponse) {
    const mutate = h.http.mutate.bind(h.http);
    h.http.mutate = () => { mutate(); throw new Error('Invented lost response'); };
  }
  await h.coordinator.start();
  assert.equal(h.coordinator.canWrite, true);
  assert.equal(h.http.files.size, 1);
  assert.equal(h.http.mutations, 1);
  await h.coordinator.assertCanWrite();
});

test('persistent invisibility is bounded and a second attempt cannot create another marker', async () => {
  const h = fixture();
  h.http.transformListing = () => [];
  await assert.rejects(h.coordinator.start(), {code: 'ownership-unknown'});
  assert.equal(h.coordinator.canWrite, false);
  assert.equal(h.http.summary().categories.list, 6); // inspection, prewrite, four verification attempts
  await assert.rejects(h.coordinator.start(), {code: 'ownership-unknown'});
  assert.equal(h.http.files.size, 1);
  assert.equal(h.http.mutations, 1);
});

for (const mode of ['duplicate', 'changed-owner', 'malformed', 'authorization', 'incomplete']) test(`claim does not retry ${mode}`, async () => {
  let waits = 0;
  const h = fixture({wait: async () => { waits++; }});
  h.http.transformListingPage = page => {
    if (!h.http.mutations) return page;
    if (mode === 'duplicate') page.files.push({...page.files[0], id: 'invented-other-marker'});
    if (mode === 'incomplete') page.incompleteSearch = true;
    return page;
  };
  h.http.beforeResponse = ({category}) => {
    if (!h.http.mutations || category !== 'media') return;
    const file = [...h.http.files.values()][0];
    const record = JSON.parse(new TextDecoder().decode(file.bytes));
    if (mode === 'changed-owner') record.sessionId = 'invented-other-owner';
    if (mode === 'malformed') delete record.sessionId;
    file.bytes = new TextEncoder().encode(JSON.stringify(record));
  };
  if (mode === 'authorization') {
    const fetch = h.http.fetch;
    // Keep the actual HTTP fixture for mutations, deny only post-write verification.
    const adapter = createDriveSessionAdapter({folderId: h.http.folderId, accessToken: () => 'invented-test-token',
      fetchImpl: (...args) => h.http.mutations ? Promise.resolve(new Response('{}', {status: 401})) : fetch(...args),
      wait: async () => { waits++; }});
    h.coordinator = new SessionCoordinator({adapter});
  }
  await assert.rejects(h.coordinator.start());
  assert.equal(waits, 0);
  assert.equal(h.coordinator.canWrite, false);
  assert.equal(h.http.mutations, 1);
});

for (const phase of ['before-create', 'after-dispatch', 'retry-wait']) test(`cancel during ${phase} cannot acquire ownership or dispatch a later marker mutation`, async () => {
  let enter, resume;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const h = fixture({wait: async () => { enter(); await gate; }});
  if (phase === 'retry-wait') h.http.transformListing = () => [];
  h.http.beforeResponse = async ({category}) => {
    if (category === (phase === 'before-create' ? 'generate-id' : phase === 'after-dispatch' ? 'create' : 'unused')) {
      enter(); await gate;
    }
  };
  const start = h.coordinator.start();
  const failure = assert.rejects(start, {code: 'session-operation-cancelled'});
  await entered;
  h.coordinator.cancelPending();
  const mutations = h.http.mutations;
  resume(); await failure;
  assert.equal(h.coordinator.canWrite, false);
  assert.equal(h.http.mutations, phase === 'after-dispatch' ? mutations + 1 : mutations);
  assert.equal(h.http.mutations, phase === 'before-create' ? 0 : 1);
});

test('offline during app claim preserves the marker without initializing a database', async () => {
  const http = new HttpCatalogDrive(); let app, online = true;
  const create = http.respond.bind(http);
  http.respond = async (...args) => {
    const response = await create(...args);
    if (args[2] === 'create') { online = false; await app.handleOffline(); }
    return response;
  };
  let initialized = 0;
  app = new ApplicationStorageLifecycle({syntheticOnly: true, folderName: 'invented synthetic claim', folderId: http.folderId,
    accessToken: () => 'invented-test-token', fetchImpl: http.fetch, makeManifest: () => {},
    initializeManifest: async () => { initialized++; return 'unused'; }, isOnline: () => online, lifecycleTarget: null});
  await assert.rejects(app.start());
  assert.equal(app.state, 'offline');
  assert.equal(app.acceptingWrites, false);
  assert.equal(app.coordinator.canWrite, false);
  assert.equal(initialized, 0);
  assert.equal(http.files.size, 1);
  assert.equal([...http.files.values()][0].metadata.name, SESSION_MARKER_NAME);
});

test('ownership checks exclude ledger objects while enumerating every marker page', async () => {
  const h = fixture(); await h.coordinator.start();
  for (let i = 0; i < 2001; i++) h.http.files.set('invented-data-' + i, {
    metadata: {id: 'invented-data-' + i, name: 'invented-data-' + i, parents: [h.http.folderId],
      mimeType: 'application/octet-stream', appProperties: {financeTrackerKind: 'snapshot-object'}},
    bytes: new Uint8Array(1)
  });
  h.http.phase = 'large-folder';
  await h.coordinator.assertCanWrite();
  assert.equal(h.http.summary('large-folder').categories.list, 1);
  assert.ok(h.http.summary('large-folder').responseBytes < 1000);
  const marker = structuredClone([...h.http.files.values()].find(file => file.metadata.name === SESSION_MARKER_NAME));
  marker.metadata.id = 'invented-name-only-marker'; marker.metadata.appProperties = {};
  h.http.files.set(marker.metadata.id, marker); h.http.pageSize = 1;
  h.http.phase = 'duplicate';
  await assert.rejects(h.coordinator.assertCanWrite(), {code: 'ownership-lost'});
  assert.equal(h.http.summary('duplicate').categories.list, 2);
  assert.equal(h.coordinator.canWrite, false);
});

test('cancellation also closes acquisition already waiting in the marker queue', async () => {
  const h = fixture(); let enter, resume;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  h.http.beforeResponse = async ({category}) => { if (category === 'list') { enter(); await gate; } };
  const first = assert.rejects(h.coordinator.start(), {code: 'session-operation-cancelled'});
  await entered;
  const queued = assert.rejects(h.coordinator.start(), {code: 'session-operation-cancelled'});
  h.coordinator.cancelPending(); resume();
  await Promise.all([first, queued]);
  assert.equal(h.http.mutations, 0);
});

for (const afterCreate of [false, true]) test(`session deadline aborts stalled ${afterCreate ? 'verification' : 'inspection'} without retrying a mutation`, async () => {
  const http = new HttpCatalogDrive();
  const fetchImpl = (url, init) => {
    if (!afterCreate || http.mutations) return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Invented timeout', 'AbortError')), {once: true});
    });
    return http.fetch(url, init);
  };
  const adapter = createDriveSessionAdapter({folderId: http.folderId, accessToken: () => 'invented-test-token', fetchImpl, operationTimeoutMs: 25});
  const coordinator = new SessionCoordinator({adapter});
  await assert.rejects(coordinator.start(), {code: 'ownership-unknown'});
  assert.equal(coordinator.canWrite, false);
  assert.equal(http.mutations, afterCreate ? 1 : 0);
  assert.equal(http.files.size, afterCreate ? 1 : 0);
});
