import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveSessionAdapter, SESSION_MARKER_NAME } from '../js/drive-session-adapter.mjs';
import { SessionCoordinator } from '../js/session-coordination.mjs';
import { HttpCatalogDrive } from './helpers/http-catalog-drive.mjs';

function setup() {
  const http = new HttpCatalogDrive();
  const id = http.idPrefix + 'marker';
  const record = { format: 'finance-tracker-session', version: 1, sessionId: 'invented-owner', state: 'active',
    startedAt: 1000, heartbeatAt: 1000, expiresAt: 121000, releasedAt: null };
  const file = { metadata: { id, name: SESSION_MARKER_NAME, mimeType: 'application/json', parents: [http.folderId],
    appProperties: { financeTrackerSession: 'v1' }, trashed: false, version: '90071992547409930' },
    bytes: new TextEncoder().encode(JSON.stringify(record)) };
  http.files.set(id, file);
  const adapter = createDriveSessionAdapter({ folderId: http.folderId, accessToken: () => 'invented-test-token', fetchImpl: http.fetch });
  return { http, id, file, record, adapter };
}
const bump = file => { file.metadata.version = String(BigInt(file.metadata.version) + 1n); };

test('one session record reuses only a version-bracketed GET and returns detached records', async () => {
  const h = setup();
  const first = await h.adapter.read();
  assert.deepEqual(h.http.summary().categories, { list: 1, 'generate-id': 0, metadata: 1, media: 1, create: 0, update: 0 });
  first.sessionId = 'caller-mutation';
  h.http.phase = 'warm';
  assert.deepEqual(await h.adapter.read(), h.record);
  assert.deepEqual(h.http.summary('warm').categories, { list: 1, 'generate-id': 0, metadata: 0, media: 0, create: 0, update: 0 });
  h.adapter.clear();
  h.http.phase = 'cold';
  assert.deepEqual(await h.adapter.read(), h.record);
  assert.equal(h.http.summary('cold').categories.media, 1);
});

test('every warm marker read rejects extra, malformed and duplicate identities', async t => {
  for (const mode of ['second-marker', 'name-only-marker', 'duplicate-id', 'bad-name', 'bad-kind', 'moved', 'trashed']) await t.test(mode, async () => {
    const h = setup(); await h.adapter.read();
    if (mode === 'second-marker' || mode === 'name-only-marker') {
      const other = structuredClone(h.file); other.metadata.id += '-other';
      if (mode === 'name-only-marker') other.metadata.appProperties = {};
      h.http.files.set(other.metadata.id, other);
    }
    if (mode === 'duplicate-id') h.http.transformListing = files => [...files, structuredClone(files[0])];
    if (mode === 'bad-name') h.file.metadata.name = 'wrong';
    if (mode === 'bad-kind') h.file.metadata.mimeType = 'text/plain';
    if (mode === 'moved') h.file.metadata.parents = ['other'];
    if (mode === 'trashed') h.file.metadata.trashed = true;
    if (['moved', 'trashed'].includes(mode)) assert.equal(await h.adapter.read(), null);
    else await assert.rejects(h.adapter.read());
    h.http.phase = 'after-failure';
    h.http.transformListing = null;
    h.http.files.clear();
    const fresh = setup(); h.http.files.set(fresh.id, fresh.file);
    await h.adapter.read();
    assert.equal(h.http.summary('after-failure').categories.media, 1, 'failure clears earlier record evidence');
  });
});

test('same-ID owner changes and expired cached records still fail the session guard', async t => {
  for (const mode of ['owner', 'expiry']) await t.test(mode, async () => {
    const h = setup(); let now = 2000;
    const coordinator = new SessionCoordinator({ adapter: h.adapter, now: () => now });
    coordinator.session = structuredClone(h.record); coordinator.ownership = 'owned';
    await coordinator.assertCanWrite();
    if (mode === 'owner') { h.record.sessionId = 'invented-other-owner'; h.file.bytes = new TextEncoder().encode(JSON.stringify(h.record)); bump(h.file); }
    else now = 121000;
    await assert.rejects(coordinator.assertCanWrite(), { code: 'ownership-lost' });
    assert.equal(coordinator.canWrite, false);
  });
});

test('a session marker changed during its media/metadata bracket cannot populate evidence', async () => {
  const h = setup(); let changed = false;
  h.http.beforeResponse = ({ category }) => {
    if (category === 'metadata' && !changed) { changed = true; bump(h.file); }
  };
  await assert.rejects(h.adapter.read(), { code: 'ownership-unknown' });
  h.http.beforeResponse = null; h.http.phase = 'retry';
  await h.adapter.read();
  assert.equal(h.http.summary('retry').categories.media, 1);
});

test('clear during an in-flight marker read prevents later cache fill', async () => {
  const h = setup();
  h.http.beforeResponse = ({ category }) => { if (category === 'metadata') h.adapter.clear(); };
  await h.adapter.read();
  h.http.beforeResponse = null; h.http.phase = 'after-clear';
  await h.adapter.read();
  assert.equal(h.http.summary('after-clear').categories.media, 1);
});

test('marker writes and ambiguous responses require fresh exact media, never the submitted payload', async () => {
  const h = setup(); await h.adapter.read();
  const next = { ...h.record, heartbeatAt: 2000, expiresAt: 122000 };
  let changed = false;
  h.http.beforeResponse = ({ category }) => {
    if (category === 'list' && changed) return;
    if (category === 'update') changed = true;
    if (category === 'media' && changed) { h.file.bytes = new TextEncoder().encode(JSON.stringify({ ...next, sessionId: 'invented-other-owner' })); bump(h.file); }
  };
  await assert.rejects(h.adapter.write(next));
});

test('identical marker content at a replacement ID never authorizes a PATCH of the former ID', async () => {
  const h = setup();
  await h.adapter.read();
  h.http.files.delete(h.id);
  h.file.metadata.id += '-replacement';
  h.http.files.set(h.file.metadata.id, h.file);
  const before = h.http.mutations;
  await assert.rejects(h.adapter.write({ ...h.record, heartbeatAt: 2000, expiresAt: 122000 }), { code: 'ownership-unknown' });
  assert.equal(h.http.mutations, before);
  assert.equal(h.http.requests.filter(row => row.category === 'update').length, 0);
});
