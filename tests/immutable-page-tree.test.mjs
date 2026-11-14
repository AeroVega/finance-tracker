import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createImmutablePageTree, PAGE_TREE_FORMAT, PAGE_TREE_MAX_BYTES} from '../js/immutable-page-tree.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const encode = value => encoder.encode(canonicalizeJcs(value));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const k = n => String(n).padStart(8, '0');
class MemoryStore {
  files = new Map(); reads = 0; writes = 0; readBytes = 0; writeBytes = 0; maximum = 0;
  async read(hash) {
    this.reads++;
    const bytes = this.files.get(hash);
    if (!bytes) throw new Error('missing page');
    this.readBytes += bytes.length;
    return bytes; // Deliberately expose mutable adapter-owned bytes.
  }
  async write(bytes) {
    this.writes++; this.writeBytes += bytes.length; this.maximum = Math.max(this.maximum, bytes.length);
    const hash = digest(bytes); this.files.set(hash, bytes); return hash;
  }
  put(value) { const bytes = encode(value), hash = digest(bytes); this.files.set(hash, bytes); return hash; }
  json(hash) { return JSON.parse(decoder.decode(this.files.get(hash))); }
  reset() { this.reads = this.writes = this.readBytes = this.writeBytes = this.maximum = 0; }
}
const leaf = entries => ({format: PAGE_TREE_FORMAT, version: 1, kind: 'leaf', height: '0', count: String(entries.length), min: entries[0]?.[0] ?? null, max: entries.at(-1)?.[0] ?? null, entries});
const ref = (store, hash) => { const n = store.json(hash); return {hash, count:n.count, min:n.min, max:n.max, height:n.height}; };
const branch = children => ({format: PAGE_TREE_FORMAT, version: 1, kind: 'branch', height: String(BigInt(children[0].height) + 1n),
  count:String(children.reduce((n, c) => n + BigInt(c.count), 0n)), min:children[0].min, max:children.at(-1).max, children});
async function collect(iterable) { const result = []; for await (const x of iterable) result.push(x); return result; }
const fixture = (n, value = i => ({synthetic:i, text:'invented'})) => Array.from({length:n}, (_, i) => [k(i), value(i)]);

for (const n of [0, 1, 2, 9, 65, 257, 1025]) test(`streamed build, lookup, pages and full structural verification for ${n} entries`, async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:4, maxChildren:3, maxNodeBytes:2048});
  const expected = fixture(n);
  let produced = 0;
  const root = await tree.build((async function* () {
    for (const entry of expected) {
      if (produced === 100) assert.ok(store.writes > 0, 'builder emits pages before source completion');
      produced++; yield entry;
    }
  })());
  assert.match(root, /^[0-9a-f]{64}$/);
  assert.equal((await tree.verify(root)).count, String(n));
  assert.deepEqual(await collect(tree.entries(root)), expected);
  assert.equal(await tree.get(root, 'absent'), undefined);
  if (n) assert.deepEqual(await tree.get(root, k(Math.floor(n / 2))), expected[Math.floor(n / 2)][1]);
  let cursor = null, found = [];
  do { const page = await tree.page(root, {limit:7, cursor}); found.push(...page.entries); cursor = page.cursor; } while (cursor);
  assert.deepEqual(found, expected);
  assert.ok(store.maximum <= 2048);
  for (const bytes of store.files.values()) {
    const node = JSON.parse(decoder.decode(bytes));
    assert.ok((node.entries ?? node.children).length <= (node.kind === 'leaf' ? 4 : 3));
  }
});

test('byte splitting measures encoded UTF-8, not JavaScript string length', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxNodeBytes:1024});
  const values = fixture(40, () => ({text:'🧪'.repeat(85)}));
  const root = await tree.build(values);
  assert.deepEqual(await collect(tree.entries(root)), values);
  assert.ok(store.files.size > 20);
  for (const bytes of store.files.values()) assert.ok(bytes.length <= 1024);
  await assert.rejects(tree.set(root, 'oversize', '🧪'.repeat(1000)), {code:'node-byte-limit'});
});

test('ordered Unicode keys, including astral/BMP ordering, round-trip exactly', async () => {
  const values = ['', '\u0000', 'a', 'e\u0301', 'é', '中', '🧪', '\uE000'].sort().map(key => [key, {key}]);
  const tree = createImmutablePageTree(new MemoryStore(), {maxEntries:2, maxChildren:2});
  const root = await tree.build(values);
  assert.deepEqual(await collect(tree.entries(root)), values);
  for (const [key, value] of values) assert.deepEqual(await tree.get(root, key), value);
});

test('persistent mixed updates match an independent Map oracle and preserve every old root', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:4, maxChildren:3, maxNodeBytes:2048});
  let root = await tree.build([]), seed = 17;
  const oracle = new Map(), historical = [];
  for (let step = 0; step < 240; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const key = k(seed % 75);
    if (seed % 4 === 0) { oracle.delete(key); root = await tree.delete(root, key); }
    else { const value = {synthetic:step, text:'x'.repeat(seed % 120)}; oracle.set(key, value); root = await tree.set(root, key, value); }
    const expected = [...oracle].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    assert.equal((await tree.verify(root)).count, String(expected.length));
    assert.deepEqual(await collect(tree.entries(root)), expected);
    if (step % 40 === 0) historical.push({root, expected});
  }
  for (const old of historical) assert.deepEqual(await collect(tree.entries(old.root)), old.expected);
  for (const key of oracle.keys()) root = await tree.delete(root, key);
  assert.equal((await tree.inspect(root)).height, '0');
  assert.deepEqual(await collect(tree.entries(root)), []);
});

test('single changed key writes only its path, with no-op set/delete writing nothing', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:16, maxChildren:8});
  const root = await tree.build(fixture(4096)), before = new Map([...store.files].map(([h, b]) => [h, b.slice()]));
  const height = Number((await tree.inspect(root)).height);
  store.reset();
  const next = await tree.set(root, k(1999), {synthetic:'changed'});
  assert.ok(store.writes <= height + 1, `${store.writes} writes at height ${height}`);
  assert.ok(store.reads <= 2 * (height + 1) + 1);
  for (const [hash, bytes] of before) assert.deepEqual(store.files.get(hash), bytes);
  assert.deepEqual(await tree.get(root, k(1999)), {synthetic:1999, text:'invented'});
  assert.deepEqual(await tree.get(next, k(1999)), {synthetic:'changed'});
  store.reset();
  assert.equal(await tree.set(next, k(1999), {synthetic:'changed'}), next);
  assert.equal(await tree.delete(next, 'missing'), next);
  assert.equal(store.writes, 0);
});

test('range pages bind cursors to the exact root/query, including exclusive end', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:3, maxChildren:3});
  const root = await tree.build(fixture(60));
  const scope = {gte:k(12), lt:k(23), limit:4};
  let result = [], cursor = null;
  do { const page = await tree.page(root, {...scope, cursor}); result.push(...page.entries); cursor = page.cursor; } while (cursor);
  assert.deepEqual(result, fixture(60).slice(12, 23));
  assert.deepEqual(await tree.page(root, {gte:k(12), lt:k(12)}), {entries:[], cursor:null});
  assert.deepEqual(await tree.page(root, {gte:k(90)}), {entries:[], cursor:null});
  const first = await tree.page(root, scope), next = await tree.set(root, k(99), null);
  await assert.rejects(tree.page(next, {...scope, cursor:first.cursor}), {code:'cursor-mismatch'});
  await assert.rejects(tree.page(root, {...scope, gte:k(11), cursor:first.cursor}), {code:'cursor-mismatch'});
  await assert.rejects(tree.page(root, {...scope, cursor:{...first.cursor, after:k(30)}}), {code:'invalid-cursor'});
  await assert.rejects(tree.page(root, {...scope, cursor:{...first.cursor, trusted:true}}), {code:'invalid-cursor'});
  await assert.rejects(tree.page(root, {limit:Infinity}), {code:'invalid-page-limit'});
  await assert.rejects(tree.page(root, {gte:'z', lt:'a'}), {code:'invalid-query'});
});

test('streaming traversal snapshots query and never exposes cached private state', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:2});
  const input = fixture(10), original = structuredClone(input), root = await tree.build(input);
  input[0][1].text = 'caller changed';
  const opts = {gte:k(2), lt:k(5)}, iterator = tree.entries(root, opts);
  opts.gte = k(8); opts.lt = k(9);
  assert.deepEqual(await collect(iterator), original.slice(2, 5));
  const value = await tree.get(root, k(0)); value.synthetic = 'tampered';
  const page = await tree.page(root); page.entries[1][0] = 'tampered'; page.entries[1][1].text = 'tampered';
  const info = await tree.inspect(root); info.count = '999';
  assert.deepEqual(await collect(tree.entries(root)), original);
});

test('set snapshots input before awaiting a hostile store', async () => {
  const store = new MemoryStore(), normal = createImmutablePageTree(store), root = await normal.build([['a', 1]]);
  let resolve;
  const gate = new Promise(r => { resolve = r; });
  const tree = createImmutablePageTree({read:async hash => { await gate; return store.read(hash); }, write:bytes => store.write(bytes)});
  const value = {nested:{synthetic:1}}, pending = tree.set(root, 'b', value);
  value.nested.synthetic = 99; resolve();
  assert.deepEqual(await tree.get(await pending, 'b'), {nested:{synthetic:1}});
});

test('cancellation stops work before operations and after awaited stores and closes generators', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store), control = new AbortController();
  const root = await tree.build(fixture(20));
  control.abort(); store.reset();
  for (const op of [() => tree.build([], {signal:control.signal}), () => tree.get(root, 'a', {signal:control.signal}),
    () => tree.set(root, 'a', 1, {signal:control.signal}), () => tree.delete(root, 'a', {signal:control.signal}),
    () => tree.page(root, {signal:control.signal}), () => tree.inspect(root, {signal:control.signal}),
    () => tree.verify(root, {signal:control.signal})]) await assert.rejects(op(), {name:'AbortError'});
  assert.equal(store.writes + store.reads, 0);
  let closed = false;
  const middle = new AbortController();
  await assert.rejects(tree.build((async function* () {
    try { yield ['a', 1]; middle.abort(); yield ['b', 2]; } finally { closed = true; }
  })(), {signal:middle.signal}), {name:'AbortError'});
  assert.equal(closed, true);
  const during = new AbortController();
  const hostile = createImmutablePageTree({read:async hash => { during.abort(); return store.read(hash); }, write:bytes => store.write(bytes)});
  await assert.rejects(hostile.get(root, 'a', {signal:during.signal}), {name:'AbortError'});
});

test('invalid input has no trust bypass, rejects duplicate/reordered keys and non-JSON values', async t => {
  const tree = createImmutablePageTree(new MemoryStore());
  for (const [label, input, code] of [
    ['duplicate', [['a', 1], ['a', 2]], 'invalid-order'], ['reordered', [['b', 1], ['a', 2]], 'invalid-order'],
    ['surrogate key', [['\uD800', 1]], 'invalid-unicode'], ['surrogate value', [['a', '\uDC00']], 'invalid-unicode'],
    ['surrogate object key', [['a', {'\uD800':1}]], 'invalid-unicode'], ['infinity', [['a', Infinity]], 'invalid-number'],
    ['nan', [['a', NaN]], 'invalid-number'], ['undefined', [['a', undefined]], 'invalid-value'],
    ['date', [['a', new Date()]], 'invalid-value'], ['bigint', [['a', 2n]], 'invalid-value'],
    ['sparse', [['a', Array(3)]], 'invalid-value'], ['oversize key', [['x'.repeat(1024), 1]], 'key-byte-limit'],
    ['wrong pair', [['a']], 'invalid-entry']
  ]) await t.test(label, async () => { await assert.rejects(tree.build(input), {code}); });
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(tree.build([['a', cyclic]]), {code:'cyclic-value'});
  const accessor = {}; Object.defineProperty(accessor, 'x', {enumerable:true, get() { throw new Error('should not execute'); }});
  await assert.rejects(tree.build([['a', accessor]]), {code:'invalid-value'});
  let deep = 0; for (let i = 0; i < 70; i++) deep = [deep];
  await assert.rejects(tree.build([['a', deep]]), {code:'value-depth-limit'});
  assert.throws(() => createImmutablePageTree(new MemoryStore(), {trusted:true}), {code:'invalid-options'});
  await assert.rejects(tree.get('0'.repeat(64), 'a', {verified:true}), {code:'invalid-options'});
});

test('adversarial stored shape, order, counts, ranges and height fail closed', async t => {
  const edits = {
    duplicate:n => { n.entries[1][0] = 'a'; n.max = 'a'; }, reordered:n => { n.entries.reverse(); n.min = 'b'; n.max = 'a'; },
    count:n => { n.count = '3'; }, range:n => { n.max = 'z'; }, wrongKind:n => { n.kind = 'other'; },
    unknownField:n => { n.trusted = true; }, wrongVersion:n => { n.version = 2; }, nonintegerCount:n => { n.count = 2; },
    leadingZero:n => { n.count = '02'; }, negative:n => { n.count = '-2'; }, height:n => { n.height = '1'; },
    missingField:n => { delete n.max; }, wrongPair:n => { n.entries[0].push(1); }, tooMany:n => { n.entries = fixture(129); n.count = '129'; n.min = k(0); n.max = k(128); }
  };
  for (const [label, edit] of Object.entries(edits)) await t.test(label, async () => {
    const store = new MemoryStore(), tree = createImmutablePageTree(store), value = leaf([['a', 1], ['b', 2]]);
    edit(value);
    await assert.rejects(tree.verify(store.put(value)), error => error.name === 'PageTreeError');
  });
});

test('parent references must match actual count/range/height and disjoint membership', async t => {
  for (const type of ['count', 'min', 'max', 'height', 'overlap', 'repeated', 'missing']) await t.test(type, async () => {
    const store = new MemoryStore(), tree = createImmutablePageTree(store);
    const a = ref(store, store.put(leaf([['a', 1], ['b', 2]]))), b = ref(store, store.put(leaf([['x', 3], ['z', 4]])));
    if (type === 'count') a.count = '9007199254740993';
    if (type === 'min') a.min = '0';
    if (type === 'max') a.max = 'c';
    if (type === 'height') a.height = '1';
    if (type === 'overlap') b.min = 'b';
    if (type === 'repeated') Object.assign(b, a);
    if (type === 'missing') a.hash = '0'.repeat(64);
    const root = store.put(branch([a, b]));
    if (type === 'count') assert.equal((await tree.inspect(root)).count, '9007199254740995', 'metadata remains exact beyond Number range, not full trust');
    await assert.rejects(tree.verify(root));
  });
});

test('hash integrity, UTF-8, duplicate JSON fields, huge nodes and simulated cycles are rejected', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store), root = await tree.build([['a', 1]]);
  const original = store.files.get(root).slice(); store.files.get(root)[0] ^= 1;
  await assert.rejects(tree.get(root, 'a'), {code:'hash-mismatch'});
  store.files.set(root, original);
  for (const [bytes, code] of [
    [encoder.encode(' '.repeat(PAGE_TREE_MAX_BYTES + 1)), 'node-byte-limit'],
    [new Uint8Array([0xff]), 'invalid-json'],
    [encoder.encode('{"a":1,"a":2}'), 'noncanonical-json'],
    [encoder.encode('{"x":1e999}'), 'invalid-number'],
    [encoder.encode(JSON.stringify(leaf([['a', 1]]))), 'noncanonical-json']
  ]) { const hash = digest(bytes); store.files.set(hash, bytes); await assert.rejects(tree.verify(hash), {code}); }
  const child = ref(store, root), parent = branch([{...child, hash:'a'.repeat(64)}]), parentRoot = store.put(parent);
  // A store returning an ancestor for a child cannot fabricate a SHA-256 fixed point.
  store.files.set('a'.repeat(64), store.files.get(parentRoot));
  await assert.rejects(tree.verify(parentRoot), {code:'hash-mismatch'});
});

test('write verification detects lying hashes and mutated/wrong read-back bytes', async () => {
  for (const type of ['wrong hash', 'wrong bytes', 'mutate input']) {
    const store = new MemoryStore();
    const tree = createImmutablePageTree({read:hash => store.read(hash), write:async bytes => {
      const hash = digest(bytes);
      if (type === 'wrong hash') { await store.write(bytes); return '0'.repeat(64); }
      if (type === 'mutate input') bytes[0] ^= 1;
      store.files.set(hash, type === 'wrong bytes' ? new Uint8Array([123]) : bytes);
      return hash;
    }});
    await assert.rejects(tree.build([['a', 1]]), {code:type === 'wrong hash' ? 'write-hash-mismatch' : 'write-readback-mismatch'});
  }
  const tree = createImmutablePageTree({read:async () => ({}), write:async () => '0'.repeat(64)});
  await assert.rejects(tree.get('0'.repeat(64), 'a'), {code:'invalid-bytes'});
  if (typeof SharedArrayBuffer !== 'undefined') {
    const shared = createImmutablePageTree({read:async () => new Uint8Array(new SharedArrayBuffer(10)), write:async () => '0'.repeat(64)});
    await assert.rejects(shared.get('0'.repeat(64), 'a'), {code:'invalid-bytes'});
  }
});

test('an incomplete but structurally valid index cannot claim source completeness', async () => {
  const tree = createImmutablePageTree(new MemoryStore()), root = await tree.build([['only-one-of-two-source-records', 1]]);
  assert.equal((await tree.verify(root)).count, '1');
  assert.equal(await tree.get(root, 'omitted-source-record'), undefined);
  assert.equal(Object.hasOwn(await tree.verify(root), 'sourceVerified'), false);
});

test('reachable-page walker supports read-only archive stores and detached output', async () => {
  const store = new MemoryStore(), writable = createImmutablePageTree(store, {maxEntries:3, maxChildren:3});
  const root = await writable.build(fixture(80));
  const tree = createImmutablePageTree({read:hash => store.read(hash)}, {maxEntries:3, maxChildren:3});
  const walked = new Map();
  for await (const {hash, bytes} of tree.walk(root)) {
    assert.equal(digest(bytes), hash); walked.set(hash, bytes.slice()); bytes[0] ^= 1;
  }
  assert.equal(String(walked.size), (await tree.verify(root)).nodes);
  assert.deepEqual(await collect(tree.entries(root)), fixture(80));
  const restored = createImmutablePageTree({read:async hash => walked.get(hash)}, {maxEntries:3, maxChildren:3});
  assert.deepEqual(await collect(restored.entries(root)), fixture(80));
  await assert.rejects(tree.set(root, k(0), 'change'), {code:'read-only-store'});
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(collect(tree.walk(root, {signal:cancelled.signal})), {name:'AbortError'});
});

test('failed/interrupted immutable updates leave the previous root readable', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:3, maxChildren:3});
  const initial = fixture(100), root = await tree.build(initial);
  let attempts = 0;
  const failing = createImmutablePageTree({read:hash => store.read(hash), write:async bytes => {
    if (++attempts === 2) throw new Error('invented interruption');
    return store.write(bytes);
  }}, {maxEntries:3, maxChildren:3});
  await assert.rejects(failing.set(root, k(40), {synthetic:'changed'}), /invented interruption/);
  assert.deepEqual(await collect(tree.entries(root)), initial);
  assert.equal((await tree.verify(root)).count, '100');
});

test('a later store corruption is reread and fails rather than reusing a caller trust token', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store), root = await tree.build(fixture(10));
  await tree.verify(root);
  store.files.get(root)[10] ^= 1;
  await assert.rejects(tree.get(root, k(0)), {code:'hash-mismatch'});
});

test('all node and write-readback reads carry the configured transport byte bound', async () => {
  const store = new MemoryStore();
  let checked = 0;
  const tree = createImmutablePageTree({read:async (hash, options) => {
    assert.equal(options.maxBytes, 2048); checked++; return store.read(hash);
  }, write:bytes => store.write(bytes)}, {maxNodeBytes:2048, maxEntries:4, maxChildren:4});
  const root = await tree.build(fixture(30));
  await tree.get(root, k(10));
  await tree.set(root, k(10), 'amended');
  await tree.verify(root);
  assert.ok(checked > 10);
});

test('decorated oversized store views fail before hashing, decoding or JSON parsing', async t => {
  const bytes = encoder.encode(JSON.stringify(leaf([['a', 'x'.repeat(1600000)]])));
  const root = digest(bytes);
  Object.defineProperties(bytes, {byteLength:{value:0}, length:{value:0}, buffer:{value:new ArrayBuffer(0)}});
  const hashSpy = t.mock.method(globalThis.crypto.subtle, 'digest', () => { throw new Error('must reject before digest'); });
  const decodeSpy = t.mock.method(TextDecoder.prototype, 'decode', () => { throw new Error('must reject before decode'); });
  const parseSpy = t.mock.method(JSON, 'parse', () => { throw new Error('must reject before parse'); });
  const tree = createImmutablePageTree({read:async () => bytes});
  await assert.rejects(tree.verify(root), {code:'node-byte-limit'});
  assert.equal(hashSpy.mock.callCount(), 0);
  assert.equal(decodeSpy.mock.callCount(), 0);
  assert.equal(parseSpy.mock.callCount(), 0);
});

test('shadowed shared backing buffers and typed-array impostors fail closed', async () => {
  if (typeof SharedArrayBuffer !== 'undefined') {
    const bytes = new Uint8Array(new SharedArrayBuffer(10));
    Object.defineProperty(bytes, 'buffer', {value:new ArrayBuffer(10)});
    const tree = createImmutablePageTree({read:async () => bytes});
    await assert.rejects(tree.verify('0'.repeat(64)), {code:'invalid-bytes'});
  }
  for (const bytes of [new Proxy(new Uint8Array(10), {}), Object.create(Uint8Array.prototype)]) {
    const tree = createImmutablePageTree({read:async () => bytes});
    await assert.rejects(tree.verify('0'.repeat(64)), {code:'invalid-bytes'});
  }
});

test('Buffer slices are copied before digest and do not alias adapter memory', async t => {
  const original = encode(leaf([['a', {synthetic:'original'}]]));
  const backing = Buffer.alloc(original.length + 20, 0);
  backing.set(original, 10);
  const view = backing.slice(10, 10 + original.length), root = digest(original);
  // These methods/properties must never determine the bytes being verified.
  Object.defineProperties(view, {byteLength:{get() { throw new Error('shadow getter'); }},
    buffer:{get() { throw new Error('shadow getter'); }},
    slice:{value() { throw new Error('Buffer.slice must not be used'); }},
    [Symbol.iterator]:{value() { throw new Error('custom iterator must not be used'); }}});
  const digestOriginal = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, 'digest', (algorithm, bytes) => {
    backing.fill(0); // Mutation occurs after admission, before digest consumes bytes.
    return digestOriginal(algorithm, bytes);
  });
  const tree = createImmutablePageTree({read:async () => view});
  assert.deepEqual(await tree.get(root, 'a'), {synthetic:'original'});
});

test('resizable store buffers cannot resize the private copy during digest', async t => {
  const original = encode(leaf([['a', {synthetic:'resizable'}]]));
  const backing = new ArrayBuffer(original.length, {maxByteLength:original.length * 2});
  if (!backing.resizable) { t.skip('Resizable ArrayBuffer is unavailable in this runtime.'); return; }
  const view = new Uint8Array(backing); view.set(original);
  const root = digest(original), digestOriginal = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, 'digest', (algorithm, bytes) => {
    backing.resize(0);
    return digestOriginal(algorithm, bytes);
  });
  const tree = createImmutablePageTree({read:async () => view});
  assert.deepEqual(await tree.get(root, 'a'), {synthetic:'resizable'});
});

// Pinned outputs from pre-optimization commit40049ad. Length bookkeeping must
// not alter packing, canonical bytes, mutation roots or exact boundary behavior.
for(const [maxNodeBytes,expected] of [
  [4096,['ea5508a7b6f6cfbb93371949dcc9d6fbc4864e236eae5743b22f9c54822faad9','7c1edab7e0f4cb3db4890c837d29ce2d0534add7432b0178794767c47299f63c','185689e3a0bc26e67559f27d530a5ea7e33d8237dfec5b0ab79348c933ad8296']],
  [8192,['406470b8f38b156342ea310a1411a3aa699adc5da110a726649268782e1795e8','d108ea2de961c198fdd31e542054c4200ed517e386da8d0fcb8d55509c5b0a1e','fac4e240ab29118bf5fc79cce6d6d81a4f0a2fae356b4e27ff9eeb5c6831b240']],
  [65536,['f1ae9b45ea3cdb03eff69fbfe5917d9d655e42c8b4dfabab12e31c8d8ebd146c','f9e287b7e6c133ffbb378185363a5edac01584067853aa54a7a826c21a836078','d76f19cb5d0b6bdda6c86b6763e09667278be58cf03025d70503fd5a4c8469c9']]
])test(`exact owned item lengths preserve original build/set/delete hashes at ${maxNodeBytes}bytes`,async()=>{
  const store=new MemoryStore(),tree=createImmutablePageTree(store,{maxNodeBytes,maxEntries:128,maxChildren:128});
  const entries=Array.from({length:181},(_,i)=>[String(i).padStart(4,'0'),{message:'Invented 雪😀 '+String(i)+'x'.repeat(i%53),items:[i,null,true]}]);
  const root=await tree.build(entries),changed=await tree.set(root,'0090',{message:'Invented é revised',items:[90,false]}),deleted=await tree.delete(changed,'0001');
  assert.deepEqual([root,changed,deleted],expected);await tree.verify(deleted);
});

test('checked entries validate and yield every page once without retaining caller mutations', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:4,maxChildren:3});
  const expected = fixture(65), root = await tree.build(expected), info = await tree.verify(root);
  store.reset(); await tree.verify(root); assert.deepEqual(await collect(tree.entries(root)),expected);
  assert.equal(store.reads,2*Number(info.nodes));
  store.reset(); const options = {expectedCount:'65'}, iterator = tree.checkedEntries(root,options);
  options.expectedCount = '66';
  const actual = await collect(iterator);
  assert.deepEqual(actual,expected); assert.equal(store.reads,Number(info.nodes));
  actual[0][0] = 'changed'; actual[1][1].text = 'changed';
  assert.deepEqual(await collect(tree.checkedEntries(root)),expected);
  assert.throws(() => tree.checkedEntries(root,{expectedCount:'065'}),{code:'invalid-count'});
  assert.throws(() => tree.checkedEntries(root,{gte:'a'}),{code:'invalid-options'});
});

test('checked count disagreements expose no values and still reject corrupt trailing pages', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store, {maxEntries:2,maxChildren:2});
  const root = await tree.build(fixture(9)), pages = await collect(tree.walk(root));
  const seen = [];
  store.reset();
  await assert.rejects(async () => { for await (const entry of tree.checkedEntries(root,{expectedCount:'8'})) seen.push(entry); },{code:'expected-count-mismatch'});
  assert.deepEqual(seen,[]); assert.equal(store.reads,pages.length);
  store.files.set(pages.at(-1).hash,encode({corrupt:'invented trailing page'}));
  for (const expectedCount of ['8','9']) {
    await assert.rejects(collect(tree.checkedEntries(root,{expectedCount})),{code:'hash-mismatch'});
  }
});

test('checked entries preserve structural parent checks and cancellation between entries', async () => {
  const store = new MemoryStore(), tree = createImmutablePageTree(store);
  const a = ref(store,store.put(leaf([['a',1],['b',2]]))), b = ref(store,store.put(leaf([['x',3],['z',4]])));
  const forged = store.put(branch([a,{...b,count:'3'}]));
  for (const expectedCount of ['4','5']) await assert.rejects(collect(tree.checkedEntries(forged,{expectedCount})),{code:'child-mismatch'});
  const root = await tree.build(fixture(4)), control = new AbortController();
  const iterator = tree.checkedEntries(root,{signal:control.signal});
  assert.deepEqual((await iterator.next()).value,fixture(4)[0]);
  control.abort(); await assert.rejects(iterator.next(),{name:'AbortError'});
  store.reset(); await assert.rejects(collect(tree.checkedEntries(root,{signal:control.signal})),{name:'AbortError'});
  assert.equal(store.reads,0);
  const finalControl = new AbortController(), single = await tree.build([['a',1]]);
  const finalEntry = tree.checkedEntries(single,{signal:finalControl.signal});
  assert.deepEqual((await finalEntry.next()).value,['a',1]);
  finalControl.abort(); await assert.rejects(finalEntry.next(),{name:'AbortError'});
});
