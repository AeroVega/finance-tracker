/** Invented in-memory canonical audit, not HTTP/Drive or whole-app latency.
 * Run with node --expose-gc --max-old-space-size=768 tests/benchmark-canonical-audit.mjs.
 * For a comparison, run this same script in each checkout and alternate their
 * order. Source hashes identify the measured reader and tree implementations.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
import {partitionDigest,updatePartitionedCanonicalLedger} from '../js/canonical-partitions.mjs';
import {readVerifiedPartitionedLedger} from '../js/canonical-paged-storage.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';

if (typeof globalThis.gc !== 'function') throw new Error('Run with node --expose-gc --max-old-space-size=768 tests/benchmark-canonical-audit.mjs');
const {ledger}=denseLedgerFixture(1), objects=new Map();let reads=0,bytesRead=0;
const store={
  read:async hash=>{const raw=objects.get(hash);reads++;bytesRead+=raw.length;return raw.slice();},
  write:async raw=>{const hash=await partitionDigest(raw);objects.set(hash,raw.slice());return hash;}
};
const built=await updatePartitionedCanonicalLedger(ledger,store);
assert.deepEqual((await readVerifiedPartitionedLedger(store,built.rootHash)).ledger,ledger);
const samples=[];
for(let repeat=0;repeat<3;repeat++) {
  globalThis.gc(); reads=bytesRead=0;
  const cpuStart=process.cpuUsage(),start=performance.now();
  const actual=await readVerifiedPartitionedLedger(store,built.rootHash);
  const ms=performance.now()-start,cpu=process.cpuUsage(cpuStart);
  assert.deepEqual(actual.ledger,ledger);
  assert.equal(actual.reader.verification().source,'full-ledger-validated');
  assert.equal(actual.reader.verification().derived,'semantic-verified');
  samples.push({repeat,ms,cpuMicroseconds:cpu,reads,bytesRead});
}
const files=['js/immutable-page-tree.mjs','js/canonical-partition-reader.mjs'];
console.log(JSON.stringify({label:'current',node:process.version,activities:ledger.activities.length,events:ledger.events.length,root:built.rootHash,
  ledgerSha256:createHash('sha256').update(canonicalizeJcs(ledger)).digest('hex'),
  sourceHashes:Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')])),
  samples,note:'One warmup and three forced-GC-separated full audits per fresh process. All invented in-memory data. No physical/HTTP lifecycle included. Timing excludes fixture build, assertions and GC; uncontrolled machine scheduling.'}));
