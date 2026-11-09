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

test('dense CPU capacity does not imply grouped storage can hold whole-period imports',async()=>{
  const {serializePackedCanonicalLedger,CANONICAL_CHUNK_BYTES}=await import('../js/canonical-ledger-storage.mjs');
  const {canonicalizeJcs}=await import('../js/transaction-protocol.mjs');
  const {ledger}=denseLedgerFixture(5);
  assert.ok(ledger.imports.some(run=>Buffer.byteLength(canonicalizeJcs(run))>CANONICAL_CHUNK_BYTES));
  assert.throws(()=>serializePackedCanonicalLedger(ledger),{code:'canonical-chunk-too-large'});
});
