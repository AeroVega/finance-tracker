import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { copyOwnedBytes } from '../js/byte-ownership.mjs';
import { readVerified, writeVerified, hashRaw, createCatalogHistoryVerifier, verifyCatalogHistory } from '../js/catalog-storage.mjs';
import { GoogleDriveTransactionAdapter } from '../js/drive-transaction-engine.mjs';
import { backupCatalogCopy, exportCatalogArchive, verifyCatalogArchive } from '../js/catalog-backup.mjs';
import { readBoundedDriveBytes, createDriveResponseLimits } from '../js/drive-response-transport.mjs';
import { setupCatalog, MemoryCatalogDrive } from './helpers/catalog-drive.mjs';
import { HttpCatalogDrive } from './helpers/http-catalog-drive.mjs';

const gate = work => work();
const guard = async () => {};
const text = bytes => new TextDecoder().decode(bytes);
const bytesOf = (kind, value) => kind === 'Buffer' ? Buffer.from(value) : new TextEncoder().encode(value);
// Model an adapter releasing its temporary read buffer on a later microtask.
// The genuine WebCrypto digest has already captured its input at this point.
const reuseAfterRead = (bytes, mutate) => queueMicrotask(() => queueMicrotask(() => mutate(bytes)));
const replaceValue = bytes => { bytes[bytes.length - 2] = 50; };

async function savedCatalog() {
  const h = await setupCatalog();
  const saved = await h.engine.transact(h.transaction);
  for (const file of h.adapter.files.values()) file.metadata.version = '1';
  h.adapter.readMetadataBatch = GoogleDriveTransactionAdapter.prototype.readMetadataBatch;
  return { ...h, manifest: saved.manifest };
}

for (const kind of ['Uint8Array', 'Buffer']) {
  test(`verified reads own ${kind} bytes before asynchronous hashing`, async () => {
    const source = bytesOf(kind, '{"n":1}');
    const sha256 = await hashRaw(source);
    const adapter = { folderId: 'invented-read-folder',
      async readMetadata(id) { return { id, parents: [this.folderId], appProperties: {
        financeTrackerHash: sha256, financeTrackerKind: 'snapshot-object' } }; },
      async readBytes() { reuseAfterRead(source, replaceValue); return source; } };
    const returned = await readVerified(adapter, { fileId: 'invented-object', kind: 'data-object', sha256 });
    assert.equal(text(source), '{"n":2}');
    assert.equal(text(returned), '{"n":1}');
    assert.equal(await hashRaw(returned), sha256);
    source.fill(0);
    assert.equal(text(returned), '{"n":1}');
  });

  test(`verified writes detach caller-owned ${kind} before hashing`, async () => {
    const adapter = new MemoryCatalogDrive();
    const source = bytesOf(kind, '{"n":1}');
    const operation = writeVerified(adapter, { content: source, kind: 'snapshot-object', transactionId: 'invented' }, guard);
    replaceValue(source);
    const location = await operation;
    assert.equal(text(await adapter.readBytes(location.fileId)), '{"n":1}');
    assert.equal(await hashRaw(await adapter.readBytes(location.fileId)), location.sha256);
  });

  test(`queued catalog transactions detach ${kind} inputs at admission`, async () => {
    const h = await setupCatalog();
    const content = bytesOf(kind, '{"syntheticOnly":true,"value":1}');
    const operation = h.engine.transact({ ...h.transaction,
      objects: [{ logicalPath: 'synthetic/ledger.json', content }] });
    replaceValue(content);
    const saved = await operation;
    const verified = await verifyCatalogHistory(h.adapter, saved.manifest);
    const data = verified.objects.get('data-object:' + saved.manifest.snapshot['synthetic/ledger.json']);
    assert.equal(JSON.parse(text(data)).value, 1);
    await h.engine.recover({ manifestFileId: h.manifestFileId });
  });
}

for (const batches of [false, true]) test(`full history owns reused Buffer reads with metadata batches ${batches}`, async () => {
  const h = await savedCatalog();
  if (!batches) delete h.adapter.readMetadataBatch;
  const remote = [...h.adapter.files].find(([, file]) => file.metadata.appProperties.financeTrackerKind === 'snapshot-object');
  const original = new Uint8Array(remote[1].bytes);
  h.adapter.readBytes = async id => {
    const bytes = Buffer.from(h.adapter.files.get(id).bytes);
    if (id === remote[0]) reuseAfterRead(bytes, replaceValue);
    return bytes;
  };
  const verified = await createCatalogHistoryVerifier().verify(h.adapter, h.manifest);
  const [key, bytes] = [...verified.objects].find(([key]) => key.startsWith('data-object:'));
  assert.equal(JSON.parse(text(bytes)).value, 1);
  assert.equal(await hashRaw(bytes), key.slice('data-object:'.length));
  assert.deepEqual(remote[1].bytes, original);
});

test('Buffer-backed session evidence never aliases returned objects or adapter buffers', async () => {
  const h = await savedCatalog();
  const buffers = new Map(), reads = [];
  h.adapter.readBytes = async id => {
    reads.push(id);
    const bytes = Buffer.from(h.adapter.files.get(id).bytes);
    buffers.set(id, bytes);
    return bytes;
  };
  const verifier = createCatalogHistoryVerifier();
  const verified = await verifier.verify(h.adapter, h.manifest);
  const originals = new Map([...verified.objects].map(([key, bytes]) => [key, new Uint8Array(bytes)]));
  for (const bytes of verified.objects.values()) bytes.fill(0);
  for (const bytes of buffers.values()) bytes.fill(0);
  reads.length = 0;
  const again = await verifier.verify(h.adapter, h.manifest);
  assert.deepEqual(again.objects, originals);
  assert.deepEqual(reads, [h.manifest.locatorCatalog.fileId], 'retained objects and catalog segments stay privately cached');
});

test('caller mutation after catalog preflight cannot poison journal recovery', async () => {
  const h = await setupCatalog();
  const content = Buffer.from('{"syntheticOnly":true,"value":1}');
  const create = h.adapter.createImmutable.bind(h.adapter);
  h.adapter.createImmutable = async request => {
    const result = await create(request);
    if (request.kind === 'journal-event' && JSON.parse(text(request.content)).eventType === 'transaction-started') replaceValue(content);
    return result;
  };
  const saved = await h.engine.transact({ ...h.transaction,
    objects: [{ logicalPath: 'synthetic/ledger.json', content }] });
  assert.equal(JSON.parse(text(content)).value, 2);
  const verified = await verifyCatalogHistory(h.adapter, saved.manifest);
  assert.equal(JSON.parse(text(verified.objects.get('data-object:' + saved.manifest.snapshot['synthetic/ledger.json']))).value, 1);
  await h.engine.recover({ manifestFileId: h.manifestFileId });
});

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

test('backup copies owned source bytes even when the adapter reuses its temporary buffers', async () => {
  const h = await savedCatalog();
  const targetAdapter = new MemoryCatalogDrive('invented-byte-copy');
  h.adapter.readBytes = async id => {
    const bytes = Buffer.from(h.adapter.files.get(id).bytes);
    if (h.adapter.files.get(id).metadata.appProperties.financeTrackerKind === 'snapshot-object') reuseAfterRead(bytes, replaceValue);
    return bytes;
  };
  const copied = await backupCatalogCopy({ sourceAdapter: h.adapter, sourceManifestFileId: h.manifestFileId,
    withSourceLock: gate, assertSourceWritable: guard, targetAdapter, withTargetLock: gate, assertTargetWritable: guard,
    validateStructure: ({ objects }) => Object.values(objects).every(bytes => JSON.parse(text(bytes)).value === 1) });
  const verified = await verifyCatalogHistory(targetAdapter, copied.manifest);
  const hash = copied.manifest.snapshot['synthetic/ledger.json'];
  assert.equal(JSON.parse(text(verified.objects.get('data-object:' + hash))).value, 1);
  assert.equal(await hashRaw(verified.objects.get('data-object:' + hash)), hash);
});

test('application validators cannot mutate bytes used by portable export or restore verification', async () => {
  const h = await savedCatalog();
  const mutateValidator = async ({ objects }) => {
    for (const bytes of Object.values(objects)) replaceValue(bytes);
    await Promise.resolve();
    return true;
  };
  const archive = await exportCatalogArchive({ adapter: h.adapter, manifestFileId: h.manifestFileId,
    withSourceLock: gate, validateStructure: mutateValidator });
  const verified = await verifyCatalogArchive(archive, { validateStructure: mutateValidator });
  const hash = archive.manifest.snapshot['synthetic/ledger.json'];
  const bytes = verified.objects.get('data-object:' + hash);
  assert.equal(JSON.parse(text(bytes)).value, 1);
  assert.equal(await hashRaw(bytes), hash);
});

test('validator metadata mutations cannot change exported or verified archive manifests', async () => {
  const h = await savedCatalog();
  const expectedSnapshot = structuredClone(h.manifest.snapshot);
  const retained = [];
  const validateStructure = async ({ manifest, commitRecord }) => {
    retained.push({ manifest, commitRecord });
    manifest.snapshot['invented-callback-path'] = 'a'.repeat(64);
    commitRecord.snapshot['invented-callback-path'] = 'b'.repeat(64);
    await Promise.resolve();
    return true;
  };
  const archive = await exportCatalogArchive({ adapter: h.adapter, manifestFileId: h.manifestFileId,
    withSourceLock: gate, validateStructure });
  assert.deepEqual(archive.manifest.snapshot, expectedSnapshot);
  const expectedArchive = structuredClone(archive);
  const verified = await verifyCatalogArchive(archive, { validateStructure });
  assert.deepEqual(verified.manifest.snapshot, expectedSnapshot);
  const expectedObjects = new Map([...verified.objects].map(([key, bytes]) => [key, new Uint8Array(bytes)]));
  // A callback may keep its inputs after its promise resolves. Those references
  // must not retain authority over any returned manifest, record, or archive.
  for (const { manifest, commitRecord } of retained) {
    for (const snapshot of [manifest.snapshot, commitRecord.snapshot]) {
      for (const key of Object.keys(snapshot)) delete snapshot[key];
    }
    manifest.storageBinding.provider = 'invented-callback-provider';
    commitRecord.databaseId = 'invented-callback-database';
  }
  assert.deepEqual(archive, expectedArchive);
  assert.deepEqual(verified.manifest.snapshot, expectedSnapshot);
  assert.equal(verified.manifest.storageBinding.provider, 'portable-archive');
  assert.deepEqual(verified.objects, expectedObjects);
  await verifyCatalogArchive(archive, { validateStructure: () => true });
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
