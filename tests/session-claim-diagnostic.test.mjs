import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveSessionAdapter } from '../js/drive-session-adapter.mjs';
import { SessionCoordinator } from '../js/session-coordination.mjs';
import { sessionClaimDiagnostic } from '../js/session-claim-diagnostic.mjs';
import { ApplicationStorageLifecycle } from '../js/application-storage-lifecycle.mjs';
import { HttpCatalogDrive } from './helpers/http-catalog-drive.mjs';

const closingCases = [
  ['closing-trashed-unconfirmed', value => { delete value.trashed; }],
  ['closing-trashed-unconfirmed', value => { value.trashed = true; }],
  ['closing-parents-missing', value => { delete value.parents; }],
  ['closing-properties-missing', value => { delete value.appProperties; }],
  ['closing-version-invalid', value => { value.version = 1; }],
  ['closing-id-changed', value => { value.id = 'invented-other-file'; }],
  ['closing-name-changed', value => { value.name = 'invented-other-name'; }],
  ['closing-mime-changed', value => { value.mimeType = 'text/plain'; }],
  ['closing-parents-changed', value => { value.parents = ['invented-other-folder']; }],
  ['closing-session-property-changed', value => { value.appProperties.financeTrackerSession = 'v2'; }],
  ['closing-version-changed', value => { value.version = '2'; }]
];
for (const [check, change] of closingCases) test(`claim reports ${check} without initializing or retrying`, async () => {
  const http = new HttpCatalogDrive();
  const fetchImpl = async (url, options) => {
    const result = await http.fetch(url, options);
    if (http.requests.at(-1).category !== 'metadata' || !http.mutations) return result;
    const value = await result.json(); change(value);
    return new Response(JSON.stringify(value));
  };
  let initialized = 0;
  const app = new ApplicationStorageLifecycle({syntheticOnly: true,
    folderName: 'invented synthetic diagnostic', folderId: http.folderId,
    accessToken: () => 'invented-test-token', fetchImpl, makeManifest: () => {},
    initializeManifest: async () => { initialized++; return 'unused'; }, lifecycleTarget: null});
  await assert.rejects(app.start(), failure => {
    assert.deepEqual(sessionClaimDiagnostic(failure), {code: 'ownership-unknown', check});
    assert.match(failure.message, /session claim could not be confirmed/);
    return true;
  });
  assert.equal(initialized, 0);
  assert.equal(app.coordinator.canWrite, false);
  assert.equal(app.acceptingWrites, false);
  assert.equal(http.mutations, 1);
  assert.equal(http.files.size, 1);
  assert.equal(http.requests.filter(row => row.category === 'metadata').length, 1);
});

for (const mode of ['replacement', 'content']) test(`claim distinguishes ${mode} conflict`, async () => {
  const http = new HttpCatalogDrive();
  if (mode === 'replacement') http.transformListing = files => files.map(file => ({...file, id: 'invented-replacement'}));
  else http.beforeResponse = ({category}) => {
    if (category !== 'media') return;
    const file = [...http.files.values()][0];
    file.bytes = new TextEncoder().encode(JSON.stringify({...http.json(file.metadata.id), sessionId: 'invented-other-owner'}));
  };
  const adapter = createDriveSessionAdapter({folderId: http.folderId, accessToken: () => 'invented-test-token', fetchImpl: http.fetch});
  const coordinator = new SessionCoordinator({adapter});
  await assert.rejects(coordinator.start(), failure => {
    assert.equal(sessionClaimDiagnostic(failure).check, mode === 'replacement' ? 'marker-id-changed' : 'readback-record-changed');
    return true;
  });
  assert.equal(coordinator.canWrite, false); assert.equal(http.mutations, 1);
});

test('prewrite record conflict remains mutation-free and independently diagnosable', async () => {
  const http = new HttpCatalogDrive();
  const adapter = createDriveSessionAdapter({folderId: http.folderId, accessToken: () => 'invented-test-token', fetchImpl: http.fetch});
  const coordinator = new SessionCoordinator({adapter});
  await coordinator.start();
  const file = [...http.files.values()][0];
  file.bytes = new TextEncoder().encode(JSON.stringify({...coordinator.session, sessionId: 'invented-other-owner'}));
  file.metadata.version = '2';
  const count = http.mutations;
  await assert.rejects(adapter.write(coordinator.session), failure => {
    assert.equal(sessionClaimDiagnostic(failure).check, 'prewrite-record-changed'); return true;
  });
  assert.equal(http.mutations, count);
});

for (const mode of ['read', 'record']) test(`independent coordinator ${mode} check remains fail-closed`, async () => {
  let written;
  const adapter = {async write(record) { written = record; }, async read() {
    if (!written) return null;
    if (mode === 'read') throw new Error('private-response');
    return {...written, sessionId: 'invented-other-owner'};
  }};
  const coordinator = new SessionCoordinator({adapter});
  await assert.rejects(coordinator.start(), failure => {
    assert.equal(sessionClaimDiagnostic(failure).check, mode === 'read' ? 'coordinator-read-failed' : 'coordinator-record-changed'); return true;
  });
  assert.equal(coordinator.canWrite, false);
});

test('session diagnostic never serializes arbitrary data or coerces hostile values', () => {
  const secret = 'private-provider-token-id-version-record-url';
  for (const sessionCheck of [secret, {toString() {throw Error(secret);}}, undefined, null]) {
    const value = sessionClaimDiagnostic({code: 'ownership-unknown', sessionCheck, message: secret, cause: {body: secret}});
    assert.deepEqual(value, {code: 'ownership-unknown', check: 'unknown'});
    assert.ok(Object.isFrozen(value)); assert.ok(!JSON.stringify(value).includes(secret));
  }
  assert.deepEqual(sessionClaimDiagnostic({code: 'ownership-unknown', get sessionCheck() {throw Error(secret);}}), {code: 'ownership-unknown', check: 'unknown'});
  assert.equal(sessionClaimDiagnostic({get code() {throw Error(secret);}}), null);
  assert.equal(sessionClaimDiagnostic({code: secret, sessionCheck: 'closing-version-changed'}), null);
});

test('independent coordinator read preserves a detailed adapter check without its private fields', async () => {
  let written;
  const coordinator = new SessionCoordinator({adapter: {
    async write(record) { written = record; },
    async read() {
      if (!written) return null;
      throw Object.assign(new Error('private-provider-body'), {
        code: 'ownership-unknown', sessionCheck: 'closing-version-changed', version: 'private-version'
      });
    }
  }});
  await assert.rejects(coordinator.start(), failure => {
    assert.deepEqual(sessionClaimDiagnostic(failure), {code: 'ownership-unknown', check: 'closing-version-changed'});
    assert.doesNotMatch(JSON.stringify(failure), /private-/);
    return true;
  });
  assert.equal(coordinator.canWrite, false);
});
