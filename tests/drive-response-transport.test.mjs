import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveResponseLimits, readBoundedDriveBytes, readBoundedDriveJson } from '../js/drive-response-transport.mjs';
import { GoogleDriveTransactionAdapter } from '../js/drive-transaction-engine.mjs';
import { createDriveSessionAdapter, SESSION_MARKER_NAME, SESSION_MARKER_PROPERTY } from '../js/drive-session-adapter.mjs';
import { listFolderChildren, createSyntheticObject } from '../js/drive-feasibility-spike.mjs';
import { discoverFoldersByExactName } from '../js/drive-folder-discovery.mjs';
import { initializeCatalogCopy, verifyCatalogHistory } from '../js/catalog-storage.mjs';
import { CatalogTransactionEngine } from '../js/catalog-transaction-engine.mjs';
import { HttpCatalogDrive } from './helpers/http-catalog-drive.mjs';

const token = 'invented-test-token';
const limits = createDriveResponseLimits({ 'stored-object': 8 });
function endless({ length, status = 200, chunk = new Uint8Array([1, 2, 3, 4]) } = {}) {
  const stats = { pulls: 0, cancels: 0 };
  const body = new ReadableStream({
    pull(controller) { stats.pulls++; controller.enqueue(chunk); },
    cancel() { stats.cancels++; }
  }, { highWaterMark: 0 });
  const response = new Response(body, { status, headers: length == null ? {} : { 'Content-Length': length } });
  response.text = response.json = response.arrayBuffer = response.clone = () => { throw new Error('Unbounded body API must not run'); };
  return { response, stats };
}
const adapter = (fetchImpl, responseLimits = {}) => new GoogleDriveTransactionAdapter({ accessToken: () => token, folderId: 'invented-folder', fetchImpl, responseLimits });

for (const length of [undefined, '1', 'false', '-1']) test(`stream counting rejects an oversized response with Content-Length ${length}`, async () => {
  const { response, stats } = endless({ length });
  await assert.rejects(readBoundedDriveBytes(response, { limits }), { code: 'drive-response-too-large' });
  assert.deepEqual(stats, { pulls: 3, cancels: 1 });
  assert.equal(response.body.locked, false);
});

test('declared oversize cancels without reading a chunk, including unsafe integer lengths', async () => {
  for (const length of ['9', '9007199254740993123456789']) {
    const { response, stats } = endless({ length });
    await assert.rejects(readBoundedDriveBytes(response, { limits }), { code: 'drive-response-too-large' });
    assert.deepEqual(stats, { pulls: 0, cancels: 1 });
  }
});

test('exact byte boundaries accept multi-chunk UTF-8 and do not trust an understated length', async () => {
  const chunks = [new Uint8Array([34, 240, 159]), new Uint8Array([152, 128, 34])];
  const response = new Response(new ReadableStream({ pull(c) { chunks.length ? c.enqueue(chunks.shift()) : c.close(); } }), { headers: { 'Content-Length': '1' } });
  assert.equal(await readBoundedDriveJson(response, { limits: createDriveResponseLimits({ 'stored-object': 6 }) }), '😀');
  assert.deepEqual(await readBoundedDriveBytes(new Response(new Uint8Array(8)), { limits }), new Uint8Array(8));
});

test('malformed UTF-8, JSON and stream failures never quote private response content', async () => {
  for (const bytes of [new TextEncoder().encode('{"private-invented-amount":oops}'), new Uint8Array([34, 0xc3, 34])]) {
    await assert.rejects(readBoundedDriveJson(new Response(bytes)), error => error.code === 'invalid-json-object' && !JSON.stringify(error).includes('private-invented-amount') && !error.message.includes('oops'));
  }
  const response = new Response(new ReadableStream({ pull(c) { c.error(new Error('private-invented-description')); } }));
  await assert.rejects(readBoundedDriveBytes(response), error => error.code === 'drive-response-interrupted' && !error.message.includes('private-invented-description'));
});

test('a browser without readable response streams fails safely instead of allocating an unbounded body', async () => {
  await assert.rejects(readBoundedDriveBytes({ status: 200, arrayBuffer: () => assert.fail('must not buffer') }), { code: 'drive-stream-unavailable' });
  for (const value of [Infinity, NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createDriveResponseLimits({ manifest: value }), { code: 'invalid-response-limits' });
  assert.throws(() => createDriveResponseLimits({ typo: 42 }), { code: 'invalid-response-limits' });
});

test('HTTP failures cancel their bodies and preserve status without including server content', async () => {
  const { response, stats } = endless({ status: 503, chunk: new TextEncoder().encode('private-invented-description') });
  await assert.rejects(adapter(async () => response).readBytes('invented-object'), error => {
    assert.equal(error.code, 'drive-request-failed');
    assert.deepEqual(error.details, { status: 503 });
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  assert.deepEqual(stats, { pulls: 0, cancels: 1 });
});

test('all transaction response routes use distinct finite per-kind budgets', async () => {
  for (const [kind, operation] of [
    ['metadata', a => a.readMetadata('invented-file')],
    ['list-page', a => a.listChildren()],
    ['generated-ids', a => a.allocateFileId()],
    ['manifest', a => a.readJson('invented-manifest', { kind: 'manifest' })],
    ['journal-event', a => a.readJson('invented-journal', { kind: 'journal-event' })],
    ['locator-catalog-segment', a => a.readBytes('invented-segment', { kind: 'locator-catalog-segment' })]
  ]) {
    const { response, stats } = endless();
    await assert.rejects(operation(adapter(async () => response, { [kind]: 8 })), { code: 'drive-response-too-large' });
    assert.equal(stats.cancels, 1, kind);
  }
});

test('folder lists and session discovery reject oversized pages without claiming an empty folder', async () => {
  for (const operation of [
    settings => listFolderChildren(settings),
    settings => createDriveSessionAdapter(settings).read(),
    settings => discoverFoldersByExactName({ ...settings, folderName: 'invented-folder' })
  ]) {
    const { response, stats } = endless();
    await assert.rejects(operation({ accessToken: token, folderId: 'invented-folder', fetchImpl: async () => response, responseLimits: { 'list-page': 8 } }), { code: 'drive-response-too-large' });
    assert.equal(stats.cancels, 1);
  }
});

test('session media uses its own cap and an unreadable marker never permits a write', async () => {
  const { response, stats } = endless();
  let writes = 0;
  const session = createDriveSessionAdapter({ accessToken: token, folderId: 'invented-folder', responseLimits: { 'session-marker': 8 },
    fetchImpl: async (url, options = {}) => {
      if (options.method !== 'GET') writes++;
      if (String(url).includes('alt=media')) return response;
      return Response.json({ incompleteSearch: false, files: [{ id: 'invented-marker', name: SESSION_MARKER_NAME, mimeType: 'application/json', parents: ['invented-folder'], appProperties: { [SESSION_MARKER_PROPERTY]: 'v1' } }] });
    }
  });
  await assert.rejects(session.read(), { code: 'drive-response-too-large' });
  await assert.rejects(session.write({}), { code: 'read-before-write-required' });
  assert.equal(writes, 0);
  assert.equal(stats.cancels, 1);
});

test('listing bounds apply to each page, never the aggregate database', async () => {
  let pages = 0;
  const a = adapter(async () => Response.json({ incompleteSearch: false, files: [{ id: `invented-file-${++pages}` }], ...(pages < 20 ? { nextPageToken: String(pages) } : {}) }), { 'list-page': 128 });
  assert.equal((await a.listChildren()).length, 20);
  assert.equal(pages, 20);
  const repeated = adapter(async () => Response.json({ incompleteSearch: false, files: [], nextPageToken: 'same' }));
  await assert.rejects(repeated.listChildren(), { code: 'pagination-loop' });
});

test('oversized legacy data remains intact and recovers with an explicit larger finite profile and full integrity checks', async () => {
  const http = new HttpCatalogDrive();
  const makeAdapter = responseLimits => new GoogleDriveTransactionAdapter({ accessToken: () => token, folderId: http.folderId, fetchImpl: http.fetch, responseLimits });
  const normal = makeAdapter({});
  const initial = await initializeCatalogCopy({ adapter: normal, guard: async () => {} });
  const engine = new CatalogTransactionEngine({ adapter: normal, assertWritable: async () => {}, isOnline: () => true });
  const content = JSON.stringify({ inventedLegacyPayload: 'x'.repeat(140 * 1024) });
  const saved = await engine.transact({ manifestFileId: initial.manifestFileId, expectedBase: initial.manifest,
    objects: [{ logicalPath: 'synthetic/legacy.json', content }], commitRecord: { operationType: 'synthetic-test' } });
  const before = structuredClone([...http.files]);
  const mutations = http.mutations;
  const tight = new CatalogTransactionEngine({ adapter: makeAdapter({ 'data-object': 1024 }), assertWritable: async () => {}, isOnline: () => true });
  await assert.rejects(tight.recover({ manifestFileId: initial.manifestFileId }), { code: 'drive-response-too-large' });
  assert.equal(tight.recoveryRequired, true);
  assert.equal(http.mutations, mutations);
  assert.deepEqual([...http.files], before);
  const reopened = makeAdapter({ 'data-object': 256 * 1024 });
  const recovery = new CatalogTransactionEngine({ adapter: reopened, assertWritable: async () => {}, isOnline: () => true });
  const result = await recovery.recover({ manifestFileId: initial.manifestFileId });
  assert.equal(result.manifest.commitId, saved.manifest.commitId);
  const verified = await verifyCatalogHistory(reopened, result.manifest);
  const target = Object.values(verified.catalog.entries).find(entry => entry.kind === 'data-object');
  assert.equal(new TextDecoder().decode(verified.objects.get(`data-object:${target.identity}`)), content);
  http.files.get(target.fileId).bytes[0] ^= 1;
  await assert.rejects(recovery.recover({ manifestFileId: initial.manifestFileId }), { code: 'immutable-hash-mismatch' });
  assert.equal(http.mutations, mutations, 'neither oversize nor corruption authorizes repair writes or data deletion');
});

test('a huge first chunk is cancelled before retaining it, even if cancellation rejects', async () => {
  let cancels = 0;
  const response = new Response(new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancels++; throw new Error('invented-cancel-detail'); }
  }, { highWaterMark: 0 }));
  await assert.rejects(readBoundedDriveBytes(response, { limits }), { code: 'drive-response-too-large' });
  assert.equal(cancels, 1);
  assert.equal(response.body.locked, false);
});

test('tiny chunks and reused producer buffers retain exact admitted bytes', async () => {
  let count = 0;
  const shared = new Uint8Array(1);
  const size = 70_000;
  const response = new Response(new ReadableStream({ pull(c) {
    if (count === size) { c.close(); return; }
    shared[0] = count++ % 251;
    c.enqueue(shared);
  } }, { highWaterMark: 0 }));
  const actual = await readBoundedDriveBytes(response, { limits: createDriveResponseLimits({ 'stored-object': size }) });
  assert.equal(actual.length, size);
  for (let i = 0; i < size; i++) assert.equal(actual[i], i % 251);
});

test('oversized manifests stop recovery before any mutations or empty-copy fallback', async () => {
  const http = new HttpCatalogDrive();
  const normal = new GoogleDriveTransactionAdapter({ accessToken: () => token, folderId: http.folderId, fetchImpl: http.fetch });
  const initial = await initializeCatalogCopy({ adapter: normal, guard: async () => {} });
  const before = structuredClone([...http.files]);
  const mutations = http.mutations;
  const bounded = new GoogleDriveTransactionAdapter({ accessToken: () => token, folderId: http.folderId, fetchImpl: http.fetch, responseLimits: { manifest: 8 } });
  const recovery = new CatalogTransactionEngine({ adapter: bounded, assertWritable: async () => {}, isOnline: () => true });
  await assert.rejects(recovery.recover({ manifestFileId: initial.manifestFileId }), { code: 'drive-response-too-large' });
  assert.equal(recovery.recoveryRequired, true);
  assert.equal(http.mutations, mutations);
  assert.deepEqual([...http.files], before);
});

test('an oversized successful create body is discarded and resolved by the same exact ID and verified bytes', async () => {
  const http = new HttpCatalogDrive();
  let oversized = null;
  const a = new GoogleDriveTransactionAdapter({ accessToken: () => token, folderId: http.folderId, fetchImpl: async (url, options) => {
    const response = await http.fetch(url, options);
    if (options?.method === 'POST') { oversized = endless({ length: '999999999' }); return oversized.response; }
    return response;
  } });
  const content = new TextEncoder().encode('{"invented":true}');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), b => b.toString(16).padStart(2, '0')).join('');
  const id = await a.allocateFileId();
  const result = await a.createImmutable({ fileId: id, content, kind: 'data-object', transactionId: 'invented', name: 'invented', expectedSha256: hash });
  assert.equal(result.fileId, id);
  assert.deepEqual(result.readback.bytes, content);
  assert.deepEqual(oversized.stats, { pulls: 0, cancels: 1 });
  assert.equal(http.mutations, 1);
});

test('new oversized objects fail before posting a durable file', async () => {
  let requests = 0;
  const a = adapter(async () => { requests++; throw new Error('Must not request'); }, { 'data-object': 8, manifest: 8 });
  await assert.rejects(a.createImmutable({ fileId: 'invented', content: 'too-long-invented-content', kind: 'data-object', expectedSha256: '0'.repeat(64) }), { code: 'drive-response-too-large' });
  await assert.rejects(a.publishManifest('invented', { invented: true }), { code: 'drive-response-too-large' });
  assert.equal(requests, 0);
});

test('the catalog segment transport default matches the 64 KiB stored-format bound', async () => {
  const a = adapter(async () => new Response(new Uint8Array(64 * 1024 + 1)));
  await assert.rejects(a.readBytes('invented-segment', { kind: 'locator-catalog-segment' }), error =>
    error.code === 'drive-response-too-large' && error.details.maxBytes === 64 * 1024);
});

test('physical and logical data aliases share one finite upload and recovery budget', async () => {
  for (const responseLimits of [{ 'data-object': 8 }, { 'snapshot-object': 8 }, { 'data-object': 64, 'snapshot-object': 8 }]) {
    const http = new HttpCatalogDrive();
    const a = new GoogleDriveTransactionAdapter({ accessToken: () => token, folderId: http.folderId,
      fetchImpl: http.fetch, responseLimits });
    assert.equal(a.responseLimits['data-object'], 8);
    assert.equal(a.responseLimits['snapshot-object'], 8);
    const initial = await initializeCatalogCopy({ adapter: a, guard: async () => {} });
    const mutations = http.mutations;
    const engine = new CatalogTransactionEngine({ adapter: a, assertWritable: async () => {}, isOnline: () => true });
    await assert.rejects(engine.transact({ manifestFileId: initial.manifestFileId, expectedBase: initial.manifest,
      objects: [{ logicalPath: 'synthetic/rejected.json', content: 'x'.repeat(32) }] }), { code: 'drive-response-too-large' });
    assert.equal(http.mutations, mutations, 'reject before any transaction journal or payload becomes durable');
    const recovered = await engine.recover({ manifestFileId: initial.manifestFileId });
    assert.deepEqual(recovered.manifest, initial.manifest);
    assert.equal(http.mutations, mutations);
  }
  const larger = createDriveResponseLimits({ 'data-object': 64 * 1024 * 1024 });
  assert.equal(larger['snapshot-object'], larger['data-object']);
});


test('feasibility uploads apply their read-back budget before allocating or posting', async () => {
  let requests = 0;
  await assert.rejects(createSyntheticObject({ accessToken: token, folderId: 'invented-folder',
    content: 'x'.repeat(32), responseLimits: { 'stored-object': 8 },
    fetchImpl: async () => { requests++; throw new Error('must not request'); }
  }), { code: 'drive-response-too-large' });
  assert.equal(requests, 0);
});
