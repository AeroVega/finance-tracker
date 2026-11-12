import test from 'node:test';
import assert from 'node:assert/strict';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
import {getEffectiveActivities,validateLedger,summarizeLedger} from '../js/canonical-import.mjs';
test('dense invented year uses supported imports and audited commands across four accounts',()=>{
  const {ledger,range}=denseLedgerFixture(1);
  assert.equal(ledger.accounts.length,4);
  assert.equal(ledger.activities.length,195*12);
  assert.equal(ledger.events.length,193*12);
  assert.equal(ledger.observations.length,ledger.activities.length);
  assert.equal(ledger.imports.length,4);
  assert.equal(new Set(ledger.activities.map(a=>a.sourceRecordId)).size,ledger.activities.length);
  assert.ok(ledger.imports.every(run=>run.declaredCoverage.start===range.start&&run.declaredCoverage.end===range.end&&run.sourceFileRetentionStatus==='not-retained'));
  assert.equal(ledger.events.filter(e=>e.eventType==='bank-correction').length,12);
  assert.equal(ledger.events.filter(e=>e.eventType==='refund-link').length,12);
  const projected=getEffectiveActivities(ledger);
  assert.equal(projected.filter(a=>a.lifecycleStatus==='unknown').length,48);
  const summary=summarizeLedger(ledger,range);
  assert.equal(summary.income,'108150.78');
  assert.equal(summary.spending,'60264.48');
  assert.equal(summary.cash,'83541.78');
  assert.equal(summary.complete,false);
  assert.equal(summary.excluded.length,48);
  validateLedger(ledger);
});
test('dense fixture rejects accidental unbounded size requests',()=>assert.throws(()=>denseLedgerFixture(100),/unsupported-fixture-years/));

test('dense five-year history writes bounded v5 pages',async()=>{
  const {updatePartitionedCanonicalLedger,partitionDigest}=await import('../js/canonical-partitions.mjs');
  const {PAGE_TREE_MAX_BYTES}=await import('../js/immutable-page-tree.mjs');
  const {ledger}=denseLedgerFixture(5),objects=new Map();
  const store={read:async hash=>objects.get(hash),write:async bytes=>{const hash=await partitionDigest(bytes);objects.set(hash,bytes);return hash;}};
  const result=await updatePartitionedCanonicalLedger(ledger,store);
  assert.equal(JSON.parse(new TextDecoder().decode(objects.get(result.rootHash))).version,5);
  assert.ok([...objects.values()].every(bytes=>bytes.length<=PAGE_TREE_MAX_BYTES));
});
