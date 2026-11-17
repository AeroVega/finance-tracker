import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { copyOwnedBytes } from '../js/byte-ownership.mjs';
import { GoogleDriveTransactionAdapter } from '../js/drive-transaction-engine.mjs';
import { readBoundedDriveBytes, createDriveResponseLimits } from '../js/drive-response-transport.mjs';
import { HttpCatalogDrive } from './helpers/http-catalog-drive.mjs';

const text=bytes=>new TextDecoder().decode(bytes);
const hashRaw=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
for (const kind of ['Uint8Array', 'ArrayBuffer', 'Buffer']) test(`real Drive adapter owns ${kind} bytes before upload admission and hashing`, async () => {
  const http = new HttpCatalogDrive();
  const adapter = new GoogleDriveTransactionAdapter({ folderId: http.folderId,
    accessToken: () => 'invented-test-token', fetchImpl: http.fetch, responseLimits: { 'data-object': 4 } });
  const backing = new ArrayBuffer(4, { maxByteLength: 32 });
  const view = kind === 'Buffer' ? Buffer.alloc(4, 97) : new Uint8Array(backing);
  view.fill(97);
  const content = kind === 'ArrayBuffer' ? backing : view;
  const expectedSha256 = await hashRaw(view);
  const fileId = await adapter.allocateFileId();
  const operation = adapter.createImmutable({ fileId, content, kind: 'snapshot-object', transactionId: 'invented', expectedSha256 });
  if (kind !== 'Buffer') backing.resize(32);
  view.fill(98);
  const result = await operation;
  assert.equal(result.size, 4);
  assert.equal(text(http.files.get(fileId).bytes), 'aaaa');
  assert.equal(await hashRaw(http.files.get(fileId).bytes), expectedSha256);
  assert.equal(text(result.readback.bytes), 'aaaa');
  assert.equal(http.requests.filter(request => request.category === 'create').length, 1);
});

test('shared buffers are refused instead of taking an unstable concurrent snapshot', async () => {
  const content = new Uint8Array(new SharedArrayBuffer(4));
  assert.throws(() => copyOwnedBytes(content), TypeError);
  const adapter = new GoogleDriveTransactionAdapter({ folderId: 'invented', accessToken: () => 'invented-test-token',
    fetchImpl: async () => assert.fail('shared input must not reach a provider') });
  await assert.rejects(adapter.createImmutable({ fileId: 'invented', content, kind: 'data-object', expectedSha256: '0'.repeat(64) }), TypeError);
});

test('shared-buffer rejection checks backing storage despite a shadowed buffer property', () => {
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  Object.defineProperty(shared, 'buffer', { value: new ArrayBuffer(4) });
  assert.throws(() => copyOwnedBytes(shared), TypeError);
  const ordinary = new Uint8Array([1, 2, 3, 4]);
  Object.defineProperty(ordinary, 'buffer', { get() { assert.fail('an own buffer getter must not run'); } });
  assert.deepEqual(copyOwnedBytes(ordinary), new Uint8Array([1, 2, 3, 4]));
});

test('shared-buffer rejection works across realms without a global SharedArrayBuffer constructor', () => {
  const foreignBuffer = runInNewContext('new SharedArrayBuffer(4)');
  assert.equal(foreignBuffer instanceof SharedArrayBuffer, false);
  const view = new Uint8Array(foreignBuffer);
  assert.throws(() => copyOwnedBytes(view), TypeError);
  const saved = globalThis.SharedArrayBuffer;
  try {
    globalThis.SharedArrayBuffer = undefined;
    assert.throws(() => copyOwnedBytes(view), TypeError);
    assert.deepEqual(copyOwnedBytes(new Uint8Array([1, 2])), new Uint8Array([1, 2]));
  } finally { globalThis.SharedArrayBuffer = saved; }
});

test('bounded transport owns Buffer chunks and still rejects excess actual bytes', async () => {
  let reads = 0;
  const chunk = Buffer.from('ab');
  const response = { headers: new Headers(), body: { getReader() { return {
    async read() { if (reads++ === 0) return { value: chunk, done: false }; chunk.fill(120); return { done: true }; },
    async cancel() {}, releaseLock() {} }; } } };
  assert.equal(text(await readBoundedDriveBytes(response, { limits: createDriveResponseLimits({ 'stored-object': 2 }) })), 'ab');
  let cancelled = false;
  const oversized = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(Buffer.from('abc')); }, cancel() { cancelled = true; }
  }, { highWaterMark: 0 }));
  await assert.rejects(readBoundedDriveBytes(oversized, { limits: createDriveResponseLimits({ 'stored-object': 4 }) }), { code: 'drive-response-too-large' });
  assert.equal(cancelled, true);
});
