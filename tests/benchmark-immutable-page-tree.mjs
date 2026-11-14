// Invented in-memory I/O work counts. Not Drive, heap or device measurements.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';
const sizes = process.argv.slice(2).map(Number);
if (!sizes.length) sizes.push(1000, 10000, 50000);
const key = i => String(i).padStart(12, '0');
for (const size of sizes) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Sizes must be positive safe integers.');
  const objects = new Map();
  let work;
  const reset = () => { work = {reads:0, writes:0, readBytes:0, writeBytes:0, maxNodeBytes:0}; };
  reset();
  const store = {
    async read(hash) { const bytes = objects.get(hash); work.reads++; work.readBytes += bytes.length; return bytes; },
    async write(bytes) {
      const hash = createHash('sha256').update(bytes).digest('hex');
      work.writes++; work.writeBytes += bytes.length; work.maxNodeBytes = Math.max(work.maxNodeBytes, bytes.length);
      objects.set(hash, bytes); return hash;
    }
  };
  const tree = createImmutablePageTree(store);
  const root = await tree.build((async function* () {
    for (let i = 0; i < size; i++) yield [key(i), {syntheticId:`invented-${i}`, amountMinor:String(10000 + i), memo:'Invented benchmark record'}];
  })());
  const build = {...work}, rootBytes = root.length;
  reset();
  const structural = await tree.verify(root), verification = {...work};
  assert.equal(structural.count, String(size));
  reset();
  const middle = Math.floor(size / 2), value = await tree.get(root, key(middle)), lookup = {...work};
  assert.equal(value.syntheticId, `invented-${middle}`);
  reset();
  const page = await tree.page(root, {gte:key(middle), limit:16}), paging = {...work};
  assert.equal(page.entries[0][0], key(middle));
  assert.equal(page.entries.length, Math.min(16, size - middle));
  reset();
  const changed = await tree.set(root, key(middle), {...value, memo:'Invented amended record'}), update = {...work};
  assert.notEqual(changed, root);
  assert.equal((await tree.get(root, key(middle))).memo, 'Invented benchmark record');
  assert.equal((await tree.get(changed, key(middle))).memo, 'Invented amended record');
  assert.equal((await tree.verify(changed)).count, String(size));
  console.log(JSON.stringify({node:process.version, records:size, height:structural.height, nodes:structural.nodes, rootBytes,
    build, verification, lookup, paging, update}));
}
