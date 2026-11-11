// Invented canonical JSON only. No Drive, browser, credentials or device claim.
// node tests/benchmark-fragment-codec.mjs --baseline-ref=<commit>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as current from '../js/canonical-fragments.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !/^--baseline-ref=[0-9a-f]{7,40}$/i.test(arg))) {
  throw new Error('Use --baseline-ref=<hexadecimal commit>');
}
const INDEX = 'synthetic/canonical-v1/index.json', variants = [{ name: 'current', codec: current }];
const root = fileURLToPath(new URL('../', import.meta.url));
let scratch;
try {
  if (args.length) {
    const revision = execFileSync('git', ['rev-parse', '--verify', args[0].split('=')[1] + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
    scratch = await mkdtemp(join(tmpdir(), 'finance-fragment-codec-'));
    for (const name of ['canonical-fragments.mjs', 'transaction-protocol.mjs']) {
      const source = execFileSync('git', ['show', revision + ':js/' + name], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
      await writeFile(join(scratch, name), source);
    }
    variants.unshift({ name: revision, codec: await import(pathToFileURL(join(scratch, 'canonical-fragments.mjs')).href) });
  }
  for (const groupCount of [16, 128]) {
    const logical = new Map([[INDEX, '{}']]);
    for (let group = 0; group < groupCount; group++) logical.set(
      'synthetic/canonical-v1/chunks/observations/' + String(group).padStart(6, '0') + '.json',
      canonicalizeJcs({ invented: '漢😀é:invented;'.repeat(3600), group }));
    const physical = current.fragmentCanonicalObjects(logical), inventory = JSON.parse(physical.get(INDEX));
    const expectedBytes = [...logical.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    const samples = [];
    // Verify both implementations against the same exact logical and physical
    // output before timed samples. Assertions are outside each timed interval.
    for (const { codec } of variants) {
      assert.deepEqual(codec.fragmentCanonicalObjects(logical), physical);
      assert.deepEqual(codec.reassembleCanonicalObjects(inventory, physical), logical);
    }
    for (let run = 0; run < 5; run++) for (const { name, codec } of run % 2 ? [...variants].reverse() : variants) {
      const start = performance.now();
      const encoded = codec.fragmentCanonicalObjects(logical);
      const encodedAt = performance.now();
      const decoded = codec.reassembleCanonicalObjects(inventory, physical);
      const decodedAt = performance.now();
      assert.deepEqual(encoded, physical);
      assert.deepEqual(decoded, logical);
      samples.push({ variant: name, run, encodeMs: encodedAt - start, decodeMs: decodedAt - encodedAt });
    }
    console.log(JSON.stringify({ node: process.version, groupCount, logicalBytes: expectedBytes,
      physicalObjects: physical.size, samples,
      note: 'Exact-output fragment encoding and reconstruction only. Five alternating runs after one warmup. Excludes ledger validation, Drive, catalog history, DOM and device memory.' }));
  }
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
