import test from 'node:test';
import assert from 'node:assert/strict';
import { fragmentCanonicalObjects, reassembleCanonicalObjects, FRAGMENT_BYTES } from '../js/canonical-fragments.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';

const INDEX = 'synthetic/canonical-v1/index.json';
const GROUP = 'synthetic/canonical-v1/chunks/accounts/000000.json';
const encoder = new TextEncoder();

test('fragment codec matches independent base64 bytes at chunk, padding and Unicode boundaries', () => {
  const payloads = ['', 'x', 'xx', 'xxx', '漢😀é\\\n',
    String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index)),
    ...[8191, 8192, 8193, FRAGMENT_BYTES - 3, FRAGMENT_BYTES - 2, FRAGMENT_BYTES - 1,
      FRAGMENT_BYTES, FRAGMENT_BYTES + 1, 2 * FRAGMENT_BYTES + 1].map(length => 'x'.repeat(length)),
    '😀'.repeat(FRAGMENT_BYTES / 4)];
  for (const payload of payloads) {
    const logical = new Map([[INDEX, '{}'], [GROUP, canonicalizeJcs({ invented: payload })]]);
    const physical = fragmentCanonicalObjects(logical), root = JSON.parse(physical.get(INDEX));
    for (const [path, text] of physical) {
      if (path === INDEX) continue;
      const fragment = JSON.parse(text), bytes = encoder.encode(logical.get(fragment.path));
      const expected = Buffer.from(bytes.subarray(fragment.ordinal * FRAGMENT_BYTES,
        (fragment.ordinal + 1) * FRAGMENT_BYTES)).toString('base64');
      assert.equal(fragment.data, expected);
    }
    assert.deepEqual(reassembleCanonicalObjects(root, physical), logical);
  }
});

test('fragment codec still rejects noncanonical base64 and preserves empty retained padding', () => {
  const logical = new Map([[INDEX, '{}'], [GROUP, '"x"']]);
  const physical = fragmentCanonicalObjects(logical), root = JSON.parse(physical.get(INDEX));
  const path = [...physical.keys()].find(value => value.includes('fragments/index/'));
  const fragment = JSON.parse(physical.get(path));
  assert.equal(fragment.data, 'e30=');
  // Some atob implementations accept whitespace, missing padding or nonzero
  // pad bits. Canonical re-encoding must continue to reject all of them.
  for (const data of ['e30', 'e30=\n', 'e30==', 'e31=', '____', 'AAAA']) {
    const corrupted = new Map(physical);
    corrupted.set(path, canonicalizeJcs({ ...fragment, data }));
    assert.throws(() => reassembleCanonicalObjects(root, corrupted), { code: 'invalid-canonical-fragments' });
  }
  const larger = fragmentCanonicalObjects(new Map([[INDEX, '{}'], [GROUP, canonicalizeJcs('x'.repeat(2 * FRAGMENT_BYTES))]]));
  const smaller = fragmentCanonicalObjects(logical, JSON.parse(larger.get(INDEX)));
  assert.ok([...smaller.values()].some(text => JSON.parse(text).data === ''));
  assert.deepEqual(reassembleCanonicalObjects(JSON.parse(smaller.get(INDEX)), smaller), logical);
});
