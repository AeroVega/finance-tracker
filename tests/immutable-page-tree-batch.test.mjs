import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createImmutablePageTree, PAGE_TREE_FORMAT} from '../js/immutable-page-tree.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const key = n => String(n).padStart(8, '0');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = map => [...map].sort(([a], [b]) => order(a, b));
const changes = commands => commands.sort((a, b) => order(a.key, b.key));
const set = (key, value) => ({type:'set', key, value});
const remove = key => ({type:'delete', key});
const fixture = count => Array.from({length:count}, (_, i) => [key(i), {invented:i, text:'synthetic'}]);
async function collect(iterable) { const values = []; for await (const value of iterable) values.push(value); return values; }
class Store {
  files = new Map(); writes = []; reads = [];
  async read(hash, {maxBytes} = {}) {
    this.reads.push(hash);
    const bytes = this.files.get(hash);
    assert.ok(bytes, `Expected stored page ${hash}`);
    if (maxBytes !== undefined) assert.ok(bytes.length <= maxBytes);
    return bytes;
  }
  async write(bytes) {
    const hash = digest(bytes);
    this.writes.push(hash); this.files.set(hash, bytes);
    return hash;
  }
  put(node) { const bytes = encoder.encode(canonicalizeJcs(node)), hash = digest(bytes); this.files.set(hash, bytes); return hash; }
  node(hash) { return JSON.parse(decoder.decode(this.files.get(hash))); }
  reset() { this.writes = []; this.reads = []; }
}
async function closure(tree, root) { return new Map((await collect(tree.walk(root))).map(({hash, bytes}) => [hash, bytes])); }
async function assertFinalWrites(tree, root, written) {
  const reachable = await closure(tree, root);
  assert.equal(new Set(written).size, written.length, 'No final page is emitted twice');
  for (const hash of written) assert.ok(reachable.has(hash), 'No intermediate path or collapsed root is emitted');
  return reachable;
}
function reference(store, hash) {
  const {count, min, max, height} = store.node(hash);
  return {hash, count, min, max, height};
}
const leaf = entries => ({format:PAGE_TREE_FORMAT, version:1, kind:'leaf', height:'0', count:String(entries.length),
  min:entries[0]?.[0] ?? null, max:entries.at(-1)?.[0] ?? null, entries});
const branch = children => ({format:PAGE_TREE_FORMAT, version:1, kind:'branch', height:String(BigInt(children[0].height) + 1n),
  count:String(children.reduce((n, child) => n + BigInt(child.count), 0n)), min:children[0].min, max:children.at(-1).max, children});

for (const limits of [
  {maxEntries:3, maxChildren:3, maxNodeBytes:1024},
  {maxEntries:5, maxChildren:2, maxNodeBytes:2048},
  {maxEntries:128, maxChildren:128, maxNodeBytes:1024}
]) test(`mixed coalesced batches match an independent Map with ${JSON.stringify(limits)}`, async () => {
  const store = new Store(), tree = createImmutablePageTree(store, limits);
  let root = await tree.build([]), seed = 91;
  const oracle = new Map(), historical = [];
  for (let round = 0; round < 35; round++) {
    const commands = new Map();
    for (let j = 0; j < 17; j++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const k = key(seed % 85);
      commands.set(k, seed % 3 === 0 ? remove(k) : set(k, {invented:round, text:'🧪'.repeat(seed % 60)}));
    }
    const batch = changes([...commands.values()]);
    for (const command of batch) {
      if (command.type === 'set') oracle.set(command.key, structuredClone(command.value));
      else oracle.delete(command.key);
    }
    store.reset(); root = await tree.updateMany(root, batch);
    await assertFinalWrites(tree, root, [...store.writes]);
    assert.deepEqual(await collect(tree.entries(root)), sorted(oracle));
    assert.equal((await tree.verify(root)).count, String(oracle.size));
    if (round % 10 === 0) historical.push({root, entries:sorted(oracle)});
  }
  for (const previous of historical) assert.deepEqual(await collect(tree.entries(previous.root)), previous.entries);
});

test('localized same-leaf batches write one path and preserve untouched subtrees at increasing record counts', async t => {
  for (const count of [256, 4096]) {
    const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:16, maxChildren:8});
    const initial = fixture(count), root = await tree.build(initial), before = await closure(tree, root);
    const height = Number((await tree.inspect(root)).height), at = count / 2;
    store.reset();
    const next = await tree.updateMany(root, Array.from({length:12}, (_, i) => set(key(at + i), {invented:'changed', i})));
    const written = [...store.writes], read = [...store.reads];
    const reachable = await assertFinalWrites(tree, next, written);
    assert.equal(written.length, height + 1, 'A batch rewrites the shared path once, not once per command');
    assert.equal(read.length, 2 * (height + 1), 'One read per old path page plus exact write read-back');
    for (const hash of before.keys()) assert.ok(read.filter(value => value === hash).length <= 1, 'No old page is revisited for the next command');
    assert.equal([...before.keys()].filter(hash => reachable.has(hash)).length, before.size - height - 1);
    for (const [hash, bytes] of before) assert.deepEqual(store.files.get(hash), bytes, 'Previous page bytes stay exact');
    const oracle = new Map(initial);
    for (let i = 0; i < 12; i++) oracle.set(key(at + i), {invented:'changed', i});
    assert.deepEqual(await collect(tree.entries(next)), sorted(oracle));
    assert.deepEqual(await collect(tree.entries(root)), initial);
    t.diagnostic(JSON.stringify({records:count, height, oldPages:before.size, generatedPages:written.length,
      finalPages:reachable.size, reusedPages:before.size - written.length, readsIncludingReadback:read.length}));
  }
});

test('disjoint changed leaves coalesce shared ancestors and retain every other subtree', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:8, maxChildren:4});
  const initial = fixture(256), root = await tree.build(initial), before = await closure(tree, root);
  const commands = [set(key(0), 'first'), remove(key(41)), set(key(160), 'middle'), set(key(255), 'last')];
  store.reset();
  const next = await tree.updateMany(root, commands), writes = [...store.writes], reads = [...store.reads];
  const reachable = await assertFinalWrites(tree, next, writes);
  const oldReads = reads.filter(hash => before.has(hash));
  assert.equal(new Set(oldReads).size, oldReads.length, 'Shared ancestors are read once');
  assert.ok(oldReads.length < before.size);
  const oracle = new Map(initial);
  for (const command of commands) command.type === 'delete' ? oracle.delete(command.key) : oracle.set(command.key, command.value);
  assert.deepEqual(await collect(tree.entries(next)), sorted(oracle));
  assert.equal((await tree.verify(next)).count, '255');
  for (const hash of before.keys()) if (!oldReads.includes(hash)) assert.ok(reachable.has(hash));
});

test('root collapse emits only the surviving final closure, including unchanged and empty roots', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:2, maxChildren:2});
  const initial = fixture(64), root = await tree.build(initial);
  // Preserve an existing complete leaf. Every newly planned ancestor is discarded.
  store.reset();
  const retained = await tree.updateMany(root, initial.slice(2).map(([k]) => remove(k)));
  assert.equal(store.writes.length, 0);
  assert.equal((await tree.inspect(retained)).height, '0');
  assert.deepEqual(await collect(tree.entries(retained)), initial.slice(0, 2));
  // Change the sole surviving record: only its final leaf may be emitted.
  store.reset();
  const changed = await tree.updateMany(root, [set(key(0), {invented:'survivor'}), ...initial.slice(1).map(([k]) => remove(k))]);
  assert.equal(store.writes.length, 1);
  await assertFinalWrites(tree, changed, [...store.writes]);
  assert.deepEqual(await collect(tree.entries(changed)), [[key(0), {invented:'survivor'}]]);
  store.reset();
  const empty = await tree.updateMany(root, initial.map(([k]) => remove(k)));
  assert.equal(store.writes.length, 1);
  await assertFinalWrites(tree, empty, [...store.writes]);
  assert.deepEqual(await tree.verify(empty), {count:'0', min:null, max:null, height:'0', nodes:'1'});
  assert.deepEqual(await collect(tree.entries(root)), initial);
});

test('empty-tree batches and byte/entry splits emit exactly the final pages', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:3, maxChildren:3, maxNodeBytes:1024});
  let root = await tree.build([]);
  const keys = ['', '\u0000', 'a', 'e\u0301', 'é', '中', '🧪', '\uE000'].sort();
  const oracle = new Map(keys.map(k => [k, {invented:k, text:'🧪'.repeat(80)}]));
  store.reset();
  root = await tree.updateMany(root, sorted(oracle).map(([k, value]) => set(k, value)));
  let reachable = await assertFinalWrites(tree, root, [...store.writes]);
  assert.equal(store.writes.length, reachable.size);
  assert.deepEqual(await collect(tree.entries(root)), sorted(oracle));
  assert.equal((await tree.verify(root)).count, String(keys.length));
  for (const bytes of reachable.values()) assert.ok(bytes.length <= 1024);
  // Values expand and contract without rebuilding unrelated leaves.
  store.reset();
  const commands = changes([set('b', 'x'.repeat(500)), set('c', 'x'.repeat(500)), set('中', null), remove('é')]);
  for (const command of commands) command.type === 'set' ? oracle.set(command.key, command.value) : oracle.delete(command.key);
  root = await tree.updateMany(root, commands);
  reachable = await assertFinalWrites(tree, root, [...store.writes]);
  assert.deepEqual(await collect(tree.entries(root)), sorted(oracle));
  assert.equal((await tree.verify(root)).count, String(oracle.size));
  for (const bytes of reachable.values()) assert.ok(bytes.length <= 1024);
});

test('empty/no-op batches preserve root identity and single-command wrappers have the same output', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:2, maxChildren:2});
  const initial = fixture(20), root = await tree.build(initial);
  for (const commands of [[], [remove('!')], [...initial.map(([k, value]) => set(k, {...value})), remove('missing')]]) {
    store.reset();
    assert.equal(await tree.updateMany(root, commands), root);
    assert.equal(store.writes.length, 0);
  }
  assert.equal(await tree.set(root, key(10), 'amended'), await tree.updateMany(root, [set(key(10), 'amended')]));
  assert.equal(await tree.delete(root, key(10)), await tree.updateMany(root, [remove(key(10))]));
});

test('all commands are owned before asynchronous reads can mutate the caller batch', async () => {
  const store = new Store(), tree = createImmutablePageTree(store), root = await tree.build([['a', 1]]);
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const delayed = createImmutablePageTree({read:async (hash, opts) => { await gate; return store.read(hash, opts); }, write:bytes => store.write(bytes)});
  const commands = [set('a', {nested:{invented:1}}), set('b', {nested:{invented:2}})];
  const pending = delayed.updateMany(root, commands);
  commands[0].value.nested.invented = 99; commands[1].key = 'z'; commands.splice(0, commands.length, remove('a'));
  resume();
  assert.deepEqual(await collect(tree.entries(await pending)), [['a', {nested:{invented:1}}], ['b', {nested:{invented:2}}]]);
});

test('malformed, conflicting, unordered and oversized commands reject before any store work', async t => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxNodeBytes:1024}), root = await tree.build([]);
  const accessor = {}; Object.defineProperty(accessor, 'type', {enumerable:true, get() { throw new Error('Do not call command accessors'); }});
  const arrayAccessor = [set('a', 1)]; Object.defineProperty(arrayAccessor, '0', {get() { throw new Error('Do not call array accessors'); }});
  const cyclic = {}; cyclic.self = cyclic;
  for (const [label, commands, code] of [
    ['not array', {}, 'invalid-input'], ['sparse', Array(1), 'invalid-input'], ['array accessor', arrayAccessor, 'invalid-input'],
    ['command accessor', [accessor], 'invalid-value'], ['unknown type', [{type:'append', key:'a', value:1}], 'invalid-command'],
    ['extra field', [{...remove('a'), value:1}], 'invalid-command'], ['missing field', [{type:'set', key:'a'}], 'invalid-command'],
    ['conflicting duplicate', [set('a', 1), remove('a')], 'invalid-order'], ['identical duplicate', [set('a', 1), set('a', 1)], 'invalid-order'],
    ['reversed', [set('z', 1), set('a', 1)], 'invalid-order'], ['oversized', [set('a', 1), set('b', '🧪'.repeat(300))], 'node-byte-limit'],
    ['bad number', [set('a', NaN)], 'invalid-number'], ['cycle', [set('a', cyclic)], 'cyclic-value'],
    ['oversized key', [remove('a'.repeat(65))], 'key-byte-limit'], ['unpaired surrogate', [set('\uD800', 1)], 'invalid-unicode']
  ]) await t.test(label, async () => {
    store.reset(); await assert.rejects(tree.updateMany(root, commands), {code});
    assert.equal(store.reads.length + store.writes.length, 0);
  });
  await assert.rejects(tree.updateMany(root, [], {trusted:true}), {code:'invalid-options'});
});

test('batch structural validation rejects corrupt touched pages and never trusts untouched references', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:2, maxChildren:2});
  const a = store.put(leaf([['a', 1], ['b', 2]])), z = store.put(leaf([['x', 3], ['z', 4]]));
  const badReference = {...reference(store, a), count:'3'};
  const mismatch = store.put(branch([badReference, reference(store, z)]));
  store.reset();
  await assert.rejects(tree.updateMany(mismatch, [set('a', 9)]), {code:'child-mismatch'});
  assert.equal(store.writes.length, 0);
  const malformed = leaf([['a', 1], ['a', 2]]), malformedRoot = store.put(malformed);
  await assert.rejects(tree.updateMany(malformedRoot, [set('a', 9)]), {code:'invalid-order'});
  const root = store.put(branch([reference(store, a), reference(store, z)]));
  store.files.get(z)[0] ^= 1;
  const next = await tree.updateMany(root, [set('a', 9)]);
  await assert.rejects(tree.verify(next), {code:'hash-mismatch'}, 'Updates are not full-tree integrity certificates');
});

test('batch cancellation and write verification preserve the old root at every write boundary', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:3, maxChildren:3});
  const initial = fixture(30), root = await tree.build(initial), commands = [set(key(1), 1), set(key(20), 20)];
  store.reset(); await tree.updateMany(root, commands);
  const writeCount = store.writes.length;
  for (let stop = 1; stop <= writeCount; stop++) {
    let attempts = 0;
    const failing = createImmutablePageTree({read:(...args) => store.read(...args), write:async bytes => {
      if (++attempts === stop) throw new Error('invented interruption');
      return store.write(bytes);
    }}, {maxEntries:3, maxChildren:3});
    await assert.rejects(failing.updateMany(root, commands), /invented interruption/);
    assert.deepEqual(await collect(tree.entries(root)), initial);
  }
  const cancelled = new AbortController(); cancelled.abort(); store.reset();
  await assert.rejects(tree.updateMany(root, commands, {signal:cancelled.signal}), {name:'AbortError'});
  assert.equal(store.reads.length + store.writes.length, 0);
  const duringRead = new AbortController();
  const cancelling = createImmutablePageTree({read:async (...args) => { duringRead.abort(); return store.read(...args); }, write:bytes => store.write(bytes)}, {maxEntries:3, maxChildren:3});
  await assert.rejects(cancelling.updateMany(root, commands, {signal:duringRead.signal}), {name:'AbortError'});
  assert.equal(store.writes.length, 0);
  const dishonest = createImmutablePageTree({read:(...args) => store.read(...args), write:async bytes => { await store.write(bytes); return '0'.repeat(64); }}, {maxEntries:3, maxChildren:3});
  await assert.rejects(dishonest.updateMany(root, commands), {code:'write-hash-mismatch'});
  assert.deepEqual(await collect(tree.entries(root)), initial);
});

test('batch admission preserves exact key, encoded-page and nesting boundaries', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxNodeBytes:1024, maxEntries:2, maxChildren:2});
  const empty = await tree.build([]), longKey = 'k'.repeat(tree.limits.maxKeyBytes - 2);
  const envelopeBytes = encoder.encode(canonicalizeJcs(leaf([[longKey, '']]))).length;
  const value = 'x'.repeat(1024 - envelopeBytes);
  store.reset();
  const exact = await tree.updateMany(empty, [set(longKey, value)]);
  assert.equal(store.files.get(exact).length, 1024);
  assert.deepEqual(await collect(tree.entries(exact)), [[longKey, value]]);
  store.reset();
  await assert.rejects(tree.updateMany(exact, [set(longKey, `${value}x`)]), {code:'node-byte-limit'});
  assert.equal(store.reads.length + store.writes.length, 0);
  let nested = 0;
  for (let i = 0; i < 61; i++) nested = [nested];
  const accepted = await tree.updateMany(empty, [set('a', nested)]);
  assert.deepEqual(await tree.get(accepted, 'a'), nested);
  await tree.verify(accepted);
  store.reset();
  await assert.rejects(tree.updateMany(empty, [set('a', [nested])]), {code:'value-depth-limit'});
  assert.equal(store.reads.length + store.writes.length, 0);
});

test('valid tall sparse trees do not add a recursive flush stack limit', async () => {
  const store = new Store(), tree = createImmutablePageTree(store, {maxEntries:2, maxChildren:2});
  let left = store.put(leaf([['a', 1]])), right = store.put(leaf([['z', 2]]));
  for (let height = 0; height < 4096; height++) {
    left = store.put(branch([reference(store, left)]));
    right = store.put(branch([reference(store, right)]));
  }
  const root = store.put(branch([reference(store, left), reference(store, right)]));
  store.reset();
  const next = await tree.updateMany(root, [set('a', 3)]), written = [...store.writes];
  assert.equal(written.length, 4098);
  await assertFinalWrites(tree, next, written);
  assert.deepEqual(await collect(tree.entries(next)), [['a', 3], ['z', 2]]);
  assert.equal((await tree.verify(next)).count, '2');
  assert.equal(await tree.get(root, 'a'), 1);
});
