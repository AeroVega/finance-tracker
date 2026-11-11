import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {createPagedPhysicalLocators, PAGED_LOCATOR_NODE_FORMAT} from '../js/paged-physical-locators.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const encode = x => encoder.encode(canonicalizeJcs(x));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const primary = e => e.kind + ':' + e.sha256;
const scope = {databaseId:'invented-database', copyId:'invented-copy', folderId:'invented-folder'};
const sort = entries => entries.sort((a, b) => primary(a) < primary(b) ? -1 : 1);
class SyntheticAdapter {
  folderId = scope.folderId;
  files = new Map(); next = 0; writable = true;
  stats = {metadata:0, reads:0, writes:0, readBytes:0, writeBytes:0, maximum:0};
  async readMetadata(id) { this.stats.metadata++; const f = this.files.get(id); if (!f) throw Object.assign(new Error('synthetic missing file'), {code:'object-not-found'}); return f.metadata; }
  async readBytes(id, {maxBytes}) {
    this.stats.reads++; const f = this.files.get(id);
    if (!f) throw Object.assign(new Error('synthetic missing file'), {code:'object-not-found'});
    assert.ok(maxBytes <= 65536, 'the caller supplies a transport budget');
    this.stats.readBytes += f.bytes.length; return f.bytes;
  }
  async allocateFileId() { return 'invented-file-' + String(this.next++).padStart(8, '0'); }
  async createImmutable({fileId, kind, transactionId, content, expectedSha256, beforeMutation}) {
    await beforeMutation();
    this.stats.writes++; this.stats.writeBytes += content.length; this.stats.maximum = Math.max(this.stats.maximum, content.length);
    assert.equal(hash(content), expectedSha256);
    if (this.files.has(fileId)) {
      assert.deepEqual(this.files.get(fileId).bytes, content, 'an adapter never overwrites a physical file'); return;
    }
    this.save(fileId, content, kind, transactionId);
  }
  save(fileId, bytes, kind, transactionId = 'invented-transaction') {
    this.files.set(fileId, {bytes:new Uint8Array(bytes), metadata:{id:fileId, parents:[this.folderId], trashed:false, version:'1', size:String(bytes.length),
      appProperties:{financeTrackerKind:kind === 'data-object' ? 'snapshot-object' : kind, financeTrackerHash:hash(bytes), financeTrackerTransaction:transactionId}}});
    return {fileId, sha256:hash(bytes)};
  }
  async object(n, kind = 'data-object', extra = {}) {
    const bytes = encode({inventedRecord:n, text:'synthetic only'}), fileId = await this.allocateFileId();
    const pointer = this.save(fileId, bytes, kind, extra.transactionId);
    return {kind, identity:kind === 'data-object' ? pointer.sha256 : 'invented-id-' + n, ...pointer,
      ...(kind === 'journal-event' ? {transactionId:extra.transactionId ?? 'invented-transaction', sequence:n} : {}), ...extra};
  }
  putJson(value, kind = 'locator-catalog-page') {
    const id = 'injected-' + this.next++; return this.save(id, encode(value), kind, 'paged-locators');
  }
  json(ref) { return JSON.parse(decoder.decode(this.files.get(ref.fileId).bytes)); }
  reset() { this.stats = {metadata:0, reads:0, writes:0, readBytes:0, writeBytes:0, maximum:0}; }
  tree(opts = {}) { return createPagedPhysicalLocators(this, {...scope, assertWritable:async () => { if (!this.writable) throw new Error('synthetic ownership lost'); }, ...opts}); }
}
async function fixtures(adapter, n) { const entries = []; for (let i = 0; i < n; i++) entries.push(await adapter.object(i)); return sort(entries); }
async function collect(iterable) { const result = []; for await (const x of iterable) result.push(x); return result; }
function rebindRoot(adapter, root, edit) { const value = adapter.json(root); edit(value); return adapter.putJson(value, 'locator-catalog'); }
function summary(adapter, ref) { const n = adapter.json(ref); return {...ref, height:n.height, count:n.count, min:n.min, max:n.max}; }
function replaceNode(adapter, root, index, edit) {
  const r = adapter.json(root), n = adapter.json(r[index]); edit(n);
  r[index] = summary(adapter, adapter.putJson(n)); return adapter.putJson(r, 'locator-catalog');
}

for (const n of [0, 1, 2, 17, 65, 129]) test(`synthetic build, direct lookup, paging and full traversal: ${n} locators`, async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:4, maxChildren:3, maxNodeBytes:4096});
  const expected = await fixtures(adapter, n); let emitted = 0;
  const root = await tree.build((async function* () {
    for (const e of expected) { if (emitted === 10) assert.equal(adapter.stats.writes, 0, "bulk build materializes descriptors before page publication"); emitted++; yield e; }
  })());
  assert.deepEqual(Object.keys(root).sort(), ['fileId', 'sha256']);
  const checked = await tree.verify(root); assert.equal(checked.entryCount, String(n));
  assert.deepEqual(await collect(tree.entries(root)), expected);
  let cursor = null, found = [];
  do { const result = await tree.page(root, {limit:7, cursor}); found.push(...result.entries); cursor = result.cursor; } while (cursor);
  assert.deepEqual(found, expected);
  for (const e of expected) {
    assert.deepEqual(await tree.get(root, {kind:e.kind, sha256:e.sha256}), e);
    assert.equal(hash(await tree.readObject(root, {kind:e.kind, sha256:e.sha256})), e.sha256);
  }
  assert.equal(await tree.get(root, {kind:'data-object', sha256:'0'.repeat(64)}), undefined);
  await assert.rejects(tree.readObject(root, {kind:'data-object', sha256:'0'.repeat(64)}), {code:'object-not-found'});
  let pages = 0, objects = 0, bytes = 0;
  for await (const item of tree.walk(root)) {
    assert.equal(hash(item.bytes), item.reference.sha256); bytes += item.bytes.length;
    if (item.entry) objects++; else pages++;
    item.bytes.fill(0); item.reference.fileId = 'caller mutation'; if (item.entry) item.entry.fileId = 'caller mutation';
  }
  assert.deepEqual(checked, {entryCount:String(objects), catalogPages:String(pages), byteLength:String(bytes)});
  assert.equal((await tree.verify(root)).entryCount, String(n));
  for (const f of adapter.files.values()) if (f.metadata.appProperties.financeTrackerKind === 'locator-catalog-page') {
    assert.ok(f.bytes.length <= 4096);
    const node = JSON.parse(decoder.decode(f.bytes));
    assert.ok((node.entries ?? node.children).length <= (node.nodeType === 'leaf' ? 4 : 3));
    for (const child of node.children ?? []) assert.ok(child.fileId && child.sha256 && !Object.hasOwn(child, 'hash'));
  }
});

test('all retained kinds preserve identities, journal metadata and immutable bindings', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree();
  const values = sort(await Promise.all(['data-object', 'commit-record', 'journal-event', 'migration-record', 'protocol-object'].map((kind, i) => adapter.object(i, kind))));
  const root = await tree.build(values);
  for (const e of values) assert.deepEqual(await tree.get(root, {kind:e.kind, sha256:e.sha256}), e);
  assert.equal((await tree.verify(root)).entryCount, '5');
  const commit = values.find(e => e.kind === 'commit-record');
  const collision = await adapter.object(100, 'commit-record', {identity:commit.identity});
  adapter.reset(); await assert.rejects(tree.set(root, collision), {code:'replacement-forbidden'}); assert.equal(adapter.stats.writes, 0);
  await assert.rejects(tree.set(root, {...commit, fileId:'invented-other-file'}), {code:'replacement-forbidden'});
  await assert.rejects(tree.set(root, {...await adapter.object(102), fileId:commit.fileId}), {code:'duplicate-physical-locator'});
  await assert.rejects(tree.set(root, {...values[0], kind:'unsupported'}), {code:'invalid-kind'});
  const journal = values.find(e => e.kind === 'journal-event');
  await assert.rejects(tree.set(root, {...journal, sequence:journal.sequence + 1}), {code:'replacement-forbidden'});
  await assert.rejects(tree.set(root, {...journal, sequence:'1'}), {code:'invalid-journal'});
  await assert.rejects(tree.set(root, {...await adapter.object(200), identity:'wrong'}), {code:'invalid-identity'});
  adapter.reset(); assert.deepEqual(await tree.set(root, commit), root); assert.equal(adapter.stats.writes, 0);
});

test('copy-on-write insertion preserves each old root and matches an independent oracle', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:4, maxChildren:3});
  let root = await tree.build([]); const oracle = new Map(), retained = [];
  for (let i = 0; i < 70; i++) {
    const e = await adapter.object(i); oracle.set(primary(e), e);
    const original = new Map([...adapter.files].map(([id, f]) => [id, new Uint8Array(f.bytes)]));
    root = await tree.set(root, e);
    for (const [id, bytes] of original) assert.deepEqual(adapter.files.get(id).bytes, bytes);
    if (i % 14 === 0) retained.push({root, expected:sort([...oracle.values()])});
  }
  for (const saved of retained) {
    assert.deepEqual(await collect(tree.entries(saved.root)), saved.expected);
    assert.equal((await tree.verify(saved.root)).entryCount, String(saved.expected.length));
  }
});

test('seek pages bind cursors to the exact root and retain no mutable caller state', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:3, maxChildren:3}), values = await fixtures(adapter, 40);
  const root = await tree.build(values), first = await tree.page(root, {limit:5});
  assert.equal(first.entries.length, 5); const cursor = structuredClone(first.cursor);
  first.entries[0].fileId = 'tampered'; first.cursor.root.fileId = 'tampered';
  assert.deepEqual((await tree.page(root, {limit:5, cursor})).entries, values.slice(5, 10));
  const next = await tree.set(root, await adapter.object(100));
  await assert.rejects(tree.page(next, {cursor}), {code:'cursor-mismatch'});
  await assert.rejects(tree.page(root, {cursor:{...cursor, trusted:true}}), {code:'invalid-shape'});
  await assert.rejects(tree.page(root, {limit:129}), {code:'invalid-page-limit'});
  await assert.rejects(tree.get(root, {kind:'data-object', sha256:values[0].sha256}, {trusted:true}), {code:'invalid-options'});
  const mutable = {...root}, iter = tree.entries(mutable); mutable.fileId = 'tampered';
  assert.deepEqual(await collect(iter), values);
});

test('entry and root snapshots happen before the first awaited adapter read', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), root = await tree.build([]), e = await adapter.object(1);
  let open; const gate = new Promise(resolve => { open = resolve; }); const read = adapter.readMetadata.bind(adapter);
  adapter.readMetadata = async id => { await gate; return read(id); }; const delayed = adapter.tree();
  const mutableRoot = {...root}, pending = delayed.set(mutableRoot, e); mutableRoot.fileId = 'caller changed'; e.fileId = 'caller changed'; open();
  assert.equal((await delayed.verify(await pending)).entryCount, '1');
});

test('node bytes and fanout both split; per-object oversize fails before publication', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree({maxNodeBytes:4096});
  const values = [];
  for (let i = 0; i < 45; i++) values.push(await adapter.object(i, 'protocol-object', {identity:'🧪'.repeat(50) + i}));
  const root = await tree.build(sort(values));
  assert.ok(BigInt((await tree.inspect(root)).objects.height) >= 1n);
  assert.ok(adapter.stats.maximum <= 4096);
  assert.equal((await tree.verify(root)).entryCount, '45');
  await assert.rejects(tree.set(root, {...values[0], identity:'🧪'.repeat(70)}), {code:'invalid-identity'});
  const large = new Uint8Array(65537), ref = adapter.save('invented-large', large, 'data-object');
  adapter.reset(); await assert.rejects(tree.set(root, {kind:'data-object', identity:ref.sha256, ...ref}), {code:'byte-limit'});
  assert.equal(adapter.stats.writes, 0);
});

test('root generations and page counts use decimal BigInt without rounding', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), values = await fixtures(adapter, 2), root = await tree.build(values);
  const huge = '900719925474099312345678901234567890';
  const advanced = rebindRoot(adapter, root, r => { r.generation = huge; r.previous = root; });
  const next = await tree.set(advanced, await adapter.object(10));
  assert.equal((await tree.inspect(next)).generation, String(BigInt(huge) + 1n));
  const countLie = rebindRoot(adapter, root, r => { r.entryCount = huge; for (const index of ['objects', 'identities', 'files']) r[index].count = huge; });
  assert.equal((await tree.inspect(countLie)).entryCount, huge, 'inspect exposes declarations, not full verification');
  await assert.rejects(tree.verify(countLie), {code:'child-mismatch'});
  await assert.rejects(tree.inspect(rebindRoot(adapter, root, r => { r.generation = Number.MAX_SAFE_INTEGER; })), {code:'invalid-count'});
});

for (const [label, edit, code] of [
  ['wrong database', r => { r.databaseId = 'other'; }, 'copy-mismatch'],
  ['wrong copy', r => { r.copyId = 'other'; }, 'copy-mismatch'],
  ['legacy version', r => { r.version = 2; }, 'unsupported-catalog'],
  ['unknown trusted flag', r => { r.trusted = true; }, 'invalid-shape'],
  ['wrong count', r => { r.entryCount = '100'; }, 'invalid-count'],
  ['repeated index file', r => { r.files = r.objects; }, 'duplicate-child'],
  ['leading-zero generation', r => { r.generation = '00'; }, 'invalid-count']
]) test(`reject malformed root: ${label}`, async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), root = await tree.build(await fixtures(adapter, 3));
  await assert.rejects(tree.verify(rebindRoot(adapter, root, edit)), {code});
});

for (const [label, edit, code] of [
  ['reordered children', n => { n.children.reverse(); }, 'invalid-order'],
  ['duplicate child', n => { n.children[1] = n.children[0]; }, 'duplicate-child'],
  ['missing child', n => { n.children.pop(); }, 'entry-limit'],
  ['wrong child count', n => { n.children[0].count = '200'; }, 'invalid-range'],
  ['wrong height', n => { n.children[0].height = n.height; }, 'invalid-height'],
  ['wrong page copy', n => { n.copyId = 'other'; }, 'copy-mismatch'],
  ['wrong index', n => { n.index = 'files'; }, 'invalid-node'],
  ['hash-only child', n => { delete n.children[0].fileId; }, 'invalid-shape']
]) test(`reject malformed physical branch: ${label}`, async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:2, maxChildren:4}), root = await tree.build(await fixtures(adapter, 6));
  await assert.rejects(tree.verify(replaceNode(adapter, root, 'objects', edit)), error=>error.code===code || (label==='missing child' && error.code==='invalid-range'));
});

test('cross-index corruption, duplicate keys, omitted descendants and corrupt bytes fail closed', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), values = await fixtures(adapter, 3), root = await tree.build(values);
  await assert.rejects(tree.verify(replaceNode(adapter, root, 'files', n => { n.entries[0][1] = primary(values[1]); })), {code:'index-mismatch'});
  await assert.rejects(tree.verify(replaceNode(adapter, root, 'objects', n => { n.entries[1] = n.entries[0]; })), {code:'invalid-order'});
  const r = adapter.json(root), saved = adapter.files.get(r.identities.fileId); adapter.files.delete(r.identities.fileId);
  await assert.rejects(tree.verify(root), {code:'object-not-found'}); adapter.files.set(r.identities.fileId, saved);
  adapter.files.get(r.objects.fileId).bytes[0] ^= 1;
  await assert.rejects(tree.get(root, {kind:'data-object', sha256:values[0].sha256}), {code:'hash-mismatch'});
});

for (const [label, change] of [
  ['wrong folder', m => { m.parents = ['different']; }], ['wrong file', m => { m.id = 'different'; }],
  ['trashed', m => { m.trashed = true; }], ['missing trash state', m => { delete m.trashed; }],
  ['wrong hash', m => { m.appProperties.financeTrackerHash = '0'.repeat(64); }],
  ['wrong kind', m => { m.appProperties.financeTrackerKind = 'commit-record'; }],
  ['wrong catalog transaction', m => { m.appProperties.financeTrackerTransaction = 'different'; }]
]) test(`strict metadata: ${label}`, async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), root = await tree.build(await fixtures(adapter, 1));
  change(adapter.files.get(root.fileId).metadata); await assert.rejects(tree.verify(root), {code:'metadata-mismatch'});
});

test('journal transaction metadata, changing versions, sizes and physical target bytes are checked', async () => {
  const adapter = new SyntheticAdapter(), e = await adapter.object(1, 'journal-event'), tree = adapter.tree(), root = await tree.build([e]);
  const f = adapter.files.get(e.fileId); f.metadata.appProperties.financeTrackerTransaction = 'other';
  await assert.rejects(tree.verify(root), {code:'metadata-mismatch'}); f.metadata.appProperties.financeTrackerTransaction = e.transactionId;
  f.bytes[0] ^= 1; await assert.rejects(tree.get(root, {kind:e.kind, sha256:e.sha256}), {code:'hash-mismatch'}); f.bytes[0] ^= 1;
  const read = adapter.readBytes.bind(adapter); adapter.readBytes = async (id, opts) => { const b = await read(id, opts); adapter.files.get(id).metadata.version = '2'; return b; };
  await assert.rejects(adapter.tree().inspect(root), {code:'version-mismatch'});
  adapter.readBytes = read; f.metadata.size = '0'; await assert.rejects(tree.verify(root), {code:'hash-mismatch'});
});

test('huge responses, decorated byte lengths and shared buffers fail before copying or hashing', async () => {
  const adapter = new SyntheticAdapter(), root = await adapter.tree().build([]);
  for (const raw of [new Uint8Array(65537), new Uint8Array(new SharedArrayBuffer(10)),
    new Uint8Array(vm.runInNewContext('new SharedArrayBuffer(10)'))]) {
    Object.defineProperty(raw, 'byteLength', {value:0}); Object.defineProperty(raw, 'buffer', {value:new ArrayBuffer(0)});
    adapter.readBytes = async () => raw;
    await assert.rejects(adapter.tree().inspect(root), e => ['byte-limit', 'invalid-bytes'].includes(e.code));
  }
});

test('Buffer aliases, resizable arrays and adapter mutation during digest cannot change admitted bytes', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), e = await adapter.object(1), root = await tree.build([e]);
  const original = adapter.files.get(e.fileId).bytes, buffer = Buffer.from(original);
  const normalRead = adapter.readBytes.bind(adapter); adapter.readBytes = async (id, opts) => id === e.fileId ? buffer : normalRead(id, opts);
  const originalCrypto = globalThis.crypto; let didMutate = false;
  Object.defineProperty(globalThis, 'crypto', {configurable:true, value:{subtle:{digest:async (algorithm, bytes) => {
    if (hash(bytes) === e.sha256 && !didMutate) { didMutate = true; buffer.fill(0); }
    return webcrypto.subtle.digest(algorithm, bytes);
  }}}});
  try { assert.equal(hash(await adapter.tree().readObject(root, {kind:e.kind, sha256:e.sha256})), e.sha256); }
  finally { Object.defineProperty(globalThis, 'crypto', {configurable:true, value:originalCrypto}); }
  assert.equal(didMutate, true);
  const backing = new ArrayBuffer(original.length, {maxByteLength:original.length + 10}), view = new Uint8Array(backing); view.set(original);
  adapter.readBytes = async (id, opts) => id === e.fileId ? view : normalRead(id, opts);
  const output = await adapter.tree().readObject(root, {kind:e.kind, sha256:e.sha256}); backing.resize(0); assert.equal(hash(output), e.sha256);
});

test('exact readback resolves lost create responses, including falsy failures, without another create', async () => {
  for (const rejection of [new Error('lost response'), undefined, null, false, 0]) {
    const adapter = new SyntheticAdapter(), create = adapter.createImmutable.bind(adapter);
    adapter.createImmutable = async args => { await create(args); throw rejection; };
    const tree = adapter.tree(), root = await tree.build([]);
    assert.equal(adapter.stats.writes, 1); assert.equal((await tree.verify(root)).entryCount, '0');
  }
});

test('uncertain or corrupt creates never return a new root and leave the old root untouched', async () => {
  const adapter = new SyntheticAdapter(), originalTree = adapter.tree(), e = await adapter.object(1), root = await originalTree.build([e]);
  const addition = await adapter.object(2), before = structuredClone(root), create = adapter.createImmutable.bind(adapter);
  adapter.createImmutable = async args => { await create(args); adapter.files.get(args.fileId).bytes[0] ^= 1; };
  await assert.rejects(adapter.tree().set(root, addition), {code:'write-unresolved'});
  assert.deepEqual(root, before); assert.equal((await originalTree.verify(root)).entryCount, '1');
  adapter.createImmutable = async args => { await args.beforeMutation(); throw new Error('never stored'); };
  await assert.rejects(adapter.tree().set(root, addition), {code:'write-unresolved'});
});

test('ownership guard is mandatory, fail-closed, scoped and repeated for each attempted create', async () => {
  const adapter = new SyntheticAdapter();
  const readOnly = createPagedPhysicalLocators(adapter, scope); await assert.rejects(readOnly.build([]), {code:'read-only'});
  adapter.writable = false; await assert.rejects(adapter.tree().build([]), {code:'guard-scope'}); assert.equal(adapter.stats.writes, 0);
  adapter.writable = true; const create = adapter.createImmutable.bind(adapter);
  adapter.createImmutable = async args => { adapter.save(args.fileId, args.content, args.kind, args.transactionId); };
  await assert.rejects(adapter.tree().build([]), {code:'guard-scope'});
  let callback; adapter.createImmutable = async args => { callback = args.beforeMutation; return create(args); };
  await adapter.tree().build([]); await assert.rejects(callback(), {code:'guard-scope'});
  let guards = 0;
  adapter.createImmutable = async args => { await args.beforeMutation(); await create(args); };
  await adapter.tree({assertWritable:async () => { guards++; }}).build([]); assert.equal(guards, 2);
});

test('cancellation stops new work, closes input streams and preserves completed roots', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), e = await adapter.object(1), root = await tree.build([e]);
  const control = new AbortController(); control.abort(); adapter.reset();
  for (const op of [() => tree.build([], {signal:control.signal}), () => tree.set(root, e, {signal:control.signal}),
    () => tree.get(root, {kind:e.kind, sha256:e.sha256}, {signal:control.signal}), () => tree.page(root, {signal:control.signal}),
    () => tree.verify(root, {signal:control.signal}), () => collect(tree.walk(root, {signal:control.signal}))]) await assert.rejects(op(), {name:'AbortError'});
  assert.equal(adapter.stats.reads + adapter.stats.writes + adapter.stats.metadata, 0);
  let closed = false; const middle = new AbortController();
  await assert.rejects(tree.build((async function* () { try { yield e; middle.abort(); yield e; } finally { closed = true; } })(), {signal:middle.signal}), {name:'AbortError'});
  assert.equal(closed, true);
  const during = new AbortController(), read = adapter.readBytes.bind(adapter);
  adapter.readBytes = async (id, opts) => { const result = await read(id, opts); during.abort(); return result; };
  await assert.rejects(adapter.tree().inspect(root, {signal:during.signal}), {name:'AbortError'});
  assert.equal((await tree.verify(root)).entryCount, '1');
});

test('invalid and reordered inputs cannot confer trust or publish a root', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), values = await fixtures(adapter, 2);
  await assert.rejects(tree.build([values[0], values[0]]), {code:'invalid-order'});
  await assert.rejects(tree.build([...values].reverse()), {code:'invalid-order'});
  const getter = {...values[0]}; Object.defineProperty(getter, 'fileId', {enumerable:true, get() { throw new Error('accessor must not execute'); }});
  await assert.rejects(tree.build([getter]), {code:'invalid-json'});
  await assert.rejects(tree.build([{...values[0], trusted:true}]), {code:'invalid-shape'});
  assert.throws(() => adapter.tree({maxNodeBytes:1024}), {code:'invalid-options'});
  assert.throws(() => createPagedPhysicalLocators(adapter, {...scope, folderId:'other'}), {code:'invalid-adapter'});
});

test('growth counters include direct media, metadata brackets and write readback', async t => {
  const reports = [];
  for (const n of [32, 128, 512]) {
    const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:16, maxChildren:8}), values = await fixtures(adapter, n);
    adapter.reset(); const root = await tree.build(values), build = {...adapter.stats};
    const info = await tree.inspect(root); const heights = ['objects', 'identities', 'files'].map(k => Number(info[k].height));
    const e = values[Math.floor(n / 2)]; adapter.reset(); await tree.get(root, {kind:e.kind, sha256:e.sha256}); const lookup = {...adapter.stats};
    assert.equal(lookup.reads, heights[0] + 3, 'root + object path + target'); assert.equal(lookup.metadata, 2 * lookup.reads);
    adapter.reset(); const page = await tree.page(root, {limit:8}); const paging = {...adapter.stats}; assert.equal(page.entries.length, 8);
    const added = await adapter.object(n + 1000); adapter.reset(); const next = await tree.set(root, added), set = {...adapter.stats};
    assert.ok(set.writes <= 1 + heights.reduce((sum, h) => sum + 2 * (h + 1) + 1, 0), 'three changed paths plus root, with possible splits');
    adapter.reset(); const verified = await tree.verify(next), verify = {...adapter.stats}; assert.equal(verified.entryCount, String(n + 1));
    assert.ok(build.maximum <= 65536); assert.ok(encode(root).length < 512);
    reports.push({n, heights, rootBytes:encode(root).length, build, lookup, page:paging, set, verify, reachable:verified});
  }
  t.diagnostic(JSON.stringify(reports));
});

test('metadata arrays never invoke caller map, iterator or JSON hooks', async () => {
  const adapter = new SyntheticAdapter(), root = await adapter.tree().build([]);
  const parents = adapter.files.get(root.fileId).metadata.parents;
  Object.defineProperty(parents, 'map', {get() { throw new Error('must not run array accessor'); }});
  Object.defineProperty(parents, 'toJSON', {get() { throw new Error('must not run JSON accessor'); }});
  Object.defineProperty(parents, 'slice', {value() { throw new Error('must not run subtype method'); }});
  assert.equal((await adapter.tree().inspect(root)).entryCount, '0');
});

test('a structural page cannot hide a unary chain or an impossible height', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:2, maxChildren:3}), root = await tree.build(await fixtures(adapter, 4));
  await assert.rejects(tree.verify(replaceNode(adapter, root, 'objects', node => {
    node.children = [node.children[0]]; Object.assign(node, {count:node.children[0].count, min:node.children[0].min, max:node.children[0].max});
  })), e => ['invalid-count', 'invalid-height', 'entry-limit'].includes(e.code));
  await assert.rejects(tree.inspect(rebindRoot(adapter, root, r => { r.objects.height = '9007199254740993'; })), {code:'invalid-height'});
  assert.throws(() => adapter.tree({maxChildren:2}), {code:'invalid-options'});
});

test('interruption at every insertion write never changes the old authoritative root', async () => {
  async function setup() {
    const adapter = new SyntheticAdapter(), tree = adapter.tree({maxEntries:4, maxChildren:3});
    const values = await fixtures(adapter, 12), root = await tree.build(values), addition = await adapter.object(99);
    adapter.reset(); return {adapter, tree, values, root, addition};
  }
  const baseline = await setup(); await baseline.tree.set(baseline.root, baseline.addition);
  const writes = baseline.adapter.stats.writes; assert.ok(writes > 3);
  for (const phase of ['before', 'after']) for (let cut = 1; cut <= writes; cut++) {
    const {adapter, tree, values, root, addition} = await setup();
    const create = adapter.createImmutable.bind(adapter), controller = new AbortController(); let attempts = 0;
    adapter.createImmutable = async args => {
      attempts++;
      if (attempts === cut && phase === 'before') { await args.beforeMutation(); throw new Error('synthetic stopped before mutation'); }
      await create(args);
      if (attempts === cut && phase === 'after') controller.abort();
    };
    await assert.rejects(adapter.tree({maxEntries:4, maxChildren:3}).set(root, addition, {signal:controller.signal}), {code:'write-unresolved'});
    assert.equal(attempts, cut);
    assert.deepEqual(await collect(tree.entries(root)), values);
    assert.equal((await tree.verify(root)).entryCount, '12');
  }
});

test('adapter mutation of upload buffers cannot change privately admitted bytes', async () => {
  const adapter = new SyntheticAdapter(), create = adapter.createImmutable.bind(adapter);
  adapter.createImmutable = async args => { await create(args); args.content.fill(0); };
  const tree = adapter.tree(), root = await tree.build(await fixtures(adapter, 3));
  assert.equal((await tree.verify(root)).entryCount, '3');
});

test('a swallowed guard rejection or an unsettled guard cannot produce a root', async () => {
  const adapter = new SyntheticAdapter();
  adapter.createImmutable = async args => { try { await args.beforeMutation(); } catch {} adapter.save(args.fileId, args.content, args.kind, args.transactionId); };
  await assert.rejects(adapter.tree({assertWritable:async () => { throw undefined; }}).build([]), {code:'guard-scope'});
  let finish, started; const begin = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { finish = resolve; });
  adapter.createImmutable = async args => { args.beforeMutation().catch(() => {}); started(); };
  const pending = adapter.tree({assertWritable:async () => { await gate; }}).build([]);
  await begin; await new Promise(resolve => setImmediate(resolve)); finish();
  await assert.rejects(pending, {code:'write-unresolved'});
});

test('cancellation inside the first ownership guard is a clean abort before mutation', async () => {
  const adapter = new SyntheticAdapter(), controller = new AbortController();
  const tree = adapter.tree({assertWritable:async () => { controller.abort(); }});
  await assert.rejects(tree.build([], {signal:controller.signal}), {name:'AbortError'});
  assert.equal(adapter.stats.writes, 0);
});

test('a later failed retry guard preserves the already-attempted exact physical ID', async () => {
  for (const cancelled of [true, false]) {
    const adapter = new SyntheticAdapter(), create = adapter.createImmutable.bind(adapter), controller = new AbortController(); let calls = 0;
    adapter.createImmutable = async args => { await create(args); await args.beforeMutation(); };
    const tree = adapter.tree({assertWritable:async () => {
      if (++calls === 2) { if (cancelled) controller.abort(); else throw new Error('ownership lost before retry'); }
    }});
    await assert.rejects(tree.build([], {signal:controller.signal}), error => {
      assert.equal(error.code, 'write-unresolved'); assert.ok(error.details.fileId && error.details.sha256);
      assert.equal(hash(adapter.files.get(error.details.fileId).bytes), error.details.sha256); return true;
    });
    assert.equal(adapter.stats.writes, 1);
  }
});

test('a changed adapter folder cannot use the pinned catalog or create more pages', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), root = await tree.build([]), e = await adapter.object(1);
  adapter.folderId = 'different-folder'; adapter.reset();
  await assert.rejects(tree.inspect(root), {code:'adapter-scope-mismatch'});
  await assert.rejects(tree.set(root, e), {code:'adapter-scope-mismatch'});
  await assert.rejects(tree.build([]), {code:'adapter-scope-mismatch'});
  assert.equal(adapter.stats.writes + adapter.stats.reads + adapter.stats.metadata, 0);
});

test('a targeted primary lookup does not imply a complete catalog audit', async () => {
  const adapter = new SyntheticAdapter(), tree = adapter.tree(), e = await adapter.object(1), root = await tree.build([e]);
  const body = adapter.json(root); adapter.files.delete(body.files.fileId);
  assert.deepEqual(await tree.get(root, {kind:e.kind, sha256:e.sha256}), e);
  await assert.rejects(tree.verify(root), {code:'object-not-found'});
});

test('bulk build and merge publish only final bounded index pages',async()=>{
 const adapter=new SyntheticAdapter(),tree=adapter.tree(),values=await fixtures(adapter,129);adapter.reset();
 const root=await tree.build(values);assert.equal(adapter.stats.writes,10,'two leaves and one branch per index plus one root');
 assert.equal((await tree.verify(root)).entryCount,'129');const next=await adapter.object(9999);adapter.reset();
 const merged=await tree.setMany(root,[next]);assert.equal(adapter.stats.writes,10,'one complete merge, no per-entry COW roots');
 assert.equal((await tree.verify(merged)).entryCount,'130');assert.deepEqual((await tree.inspect(merged)).previous,root);
 assert.deepEqual(await collect(tree.entries(merged)),sort([...values,next]));
});

test('allocation-free UTF-8 admission preserves exact prior locator wire bytes and hashes',async()=>{
 const {readFile}=await import('node:fs/promises');
 const current=await readFile(new URL('../js/paged-physical-locators.mjs',import.meta.url),'utf8');
 const prior=current.replace("import {utf8ByteLength} from './utf8-length.mjs';",'')
  .replace('utf8ByteLength(JSON.stringify(x))','encoder.encode(JSON.stringify(x)).length')
  .replace('used += utf8ByteLength(piece);','used += encoder.encode(piece).length;')
  .replaceAll("'./locator-codec.mjs'",JSON.stringify(new URL('../js/locator-codec.mjs',import.meta.url).href))
  .replace("'./physical-drive-adapter.mjs'",JSON.stringify(new URL('../js/physical-drive-adapter.mjs',import.meta.url).href))
  .replace("'./transaction-protocol.mjs'",JSON.stringify(new URL('../js/transaction-protocol.mjs',import.meta.url).href));
 const old=await import('data:text/javascript;base64,'+Buffer.from(prior).toString('base64'));
 const adapters=[new SyntheticAdapter(),new SyntheticAdapter()],roots=[];
 for(let n=0;n<2;n++) {
  const adapter=adapters[n],values=[];for(let i=0;i<40;i++)values.push(await adapter.object(i,'migration-record',{identity:'invented-'+i+['é','€','😀','\n','\u0000','quote"'][i%6]}));
  const create=n?old.createPagedPhysicalLocators:createPagedPhysicalLocators;
  const tree=create(adapter,{...scope,assertWritable:async()=>{},maxNodeBytes:4096,maxEntries:4,maxChildren:3});
  roots.push(await tree.build(sort(values)));assert.equal((await tree.verify(roots[n])).entryCount,'40');
 }
 assert.deepEqual(roots[0],roots[1]);assert.deepEqual([...adapters[0].files.keys()],[...adapters[1].files.keys()]);
 for(const [id,file]of adapters[0].files)assert.deepEqual(file.bytes,adapters[1].files.get(id).bytes,id);
});

test('an injected verifier callback cannot bypass real immutable body checks',async()=>{
 const adapter=new SyntheticAdapter(),tree=adapter.tree(),[e]=await fixtures(adapter,1),root=await tree.build([e]);
 adapter.files.get(e.fileId).bytes.fill(0);let called=0;adapter.verifyImmutableObject=async()=>{called++;return {byteLength:1};};
 await assert.rejects(tree.verify(root),{code:'hash-mismatch'});assert.equal(called,0);
});
