import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
const sourceFormat = 'wells-fargo-csv-v1';
const bytesFor = n => new TextEncoder().encode('DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\r\n' + Array.from({ length: n }, (_, i) => `03/02/2026,"Invented ${i}, ""shop""\r\nbranch",-12.34,,Posted`).join('\r\n'));
const hash = value => createHash('sha256').update(value).digest('hex');
async function withDigest(replace, body) {
  const original = globalThis.crypto.subtle.digest;
  globalThis.crypto.subtle.digest = replace(original.bind(globalThis.crypto.subtle));
  try { await body(); } finally { globalThis.crypto.subtle.digest = original; }
}
test('bounded crypto jobs preserve row order, exact evidence, ordinals and partial batches', async () => {
  let active = 0, maximum = 0, calls = 0;
  await withDigest(real => async (...args) => {
    const ordinal = calls++;
    active++; maximum = Math.max(maximum, active);
    try { await new Promise(resolve => setTimeout(resolve, ordinal % 3)); return await real(...args); }
    finally { active--; }
  }, async () => {
    const bytes = bytesFor(1031);
    const result = await parseProviderCsv({ bytes, sourceFormat });
    assert.equal(maximum, 16); assert.equal(active, 0); assert.equal(calls, 1032);
    assert.equal(result.fileFingerprint, hash(bytes));
    assert.equal(result.rowsSeen, 1032); assert.equal(result.ignoredCount, 1);
    result.records.forEach((row, i) => {
      assert.equal(row.rowOrdinal, i + 2); assert.equal(row.physicalLine, 2 + i * 2);
      assert.equal(row.sourceDescription, `Invented ${i}, "shop"\r\nbranch`);
      assert.equal(row.sourceRowFingerprint, hash(canonicalizeJcs(row.sourceFields)));
      assert.equal(row.valid, true);
    });
  });
});
test('earliest source-row rejection wins; all active jobs settle and no later batch starts', async () => {
  let calls = 0, active = 0, unhandled = 0;
  const listener = () => { unhandled++; };
  process.on('unhandledRejection', listener);
  try {
    await withDigest(() => async () => {
      const ordinal = calls++; active++;
      await new Promise(resolve => setTimeout(resolve, ordinal === 0 ? 15 : 1));
      active--; throw new Error(`invented failure ${ordinal}`);
    }, async () => {
      await assert.rejects(parseProviderCsv({ bytes: bytesFor(100), sourceFormat }), /invented failure 0$/);
      assert.equal(calls, 16); assert.equal(active, 0);
      await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(unhandled, 0);
    });
  } finally { process.off('unhandledRejection', listener); }
});
test('whole-file quote errors still precede header errors and start no hashes', async () => {
  await withDigest(() => () => { throw new Error('hash must not start'); }, async () => {
    await assert.rejects(parseProviderCsv({ sourceFormat, bytes: new TextEncoder().encode('wrong,header\n"unfinished') }), { code: 'invalid-csv-quoting' });
  });
});
test('caller mutation after starting parse cannot change source bytes or fingerprints', async () => {
  for (const arrayBuffer of [false, true]) {
    const bytes = bytesFor(35), saved = bytes.slice();
    const promise = parseProviderCsv({ bytes: arrayBuffer ? bytes.buffer : bytes, sourceFormat });
    bytes.fill(0);
    const result = await promise;
    assert.equal(result.fileFingerprint, hash(saved)); assert.equal(result.records.length, 35);
    assert.equal(result.records[0].sourceDescription, 'Invented 0, "shop"\r\nbranch');
  }
});
test('file digest rejection remains observed after the last row batch', async () => {
  let calls = 0;
  await withDigest(real => (...args) => ++calls === 2 ? Promise.reject(new Error('file failure')) : real(...args), async () => {
    await assert.rejects(parseProviderCsv({ bytes: bytesFor(1), sourceFormat }), /file failure/);
    assert.equal(calls, 2);
  });
});
