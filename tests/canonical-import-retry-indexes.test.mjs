import test from 'node:test';
import assert from 'node:assert/strict';
import * as current from '../js/canonical-import.mjs';

import {options,fixture,lifecycleFixture} from './helpers/canonical-retry-fixture.mjs';
function counted(fn) {
  let visits=0;
  const original=Array.prototype.find;
  Array.prototype.find=function(callback,thisArg){return original.call(this,(...args)=>{visits++;return callback.apply(thisArg,args);});};
  try {return {value:fn(),visits};} finally {Array.prototype.find=original;}
}
for(const size of [1000,10000]) test(`retry ${size} overlap rows uses bounded find work and retains accepted evidence`,()=>{
  const {ledger,input}=fixture(size),before=structuredClone(ledger);
  const {value:result,visits}=counted(()=>current.prepareCanonicalImport(ledger,input,options(1000000)));
  assert.ok(visits<size*8,`${visits} find callback visits`);
  assert.deepEqual(ledger,before);
  assert.deepEqual(result.ledger.activities,ledger.activities);
  assert.deepEqual(result.ledger.observations,ledger.observations);
  assert.deepEqual(result.ledger.imports.at(-1).retryAttempts[0].priorCounts,ledger.imports.at(-1).counts);
  assert.equal(result.ledger.imports.at(-1).counts.review,size);
  assert.equal(result.ledger.imports.at(-1).counts.created,1);
  assert.equal(result.ledger.imports.at(-1).counts.rejected,1);
  assert.equal(result.ledger.imports.at(-1).latestActivityDate,'2026-01-15');
});
test('retry keeps first duplicate ordinal and rejects normalization changes or missing rows',()=>{
  const {ledger,input}=fixture(3);
  const same=structuredClone(input);
  same.parsed.records.push({...same.parsed.records[0],sourceDescription:'CHANGED LATER DUPLICATE'});
  assert.deepEqual(current.prepareCanonicalImport(ledger,same,options(1000000)),current.prepareCanonicalImport(ledger,input,options(1000000)));
  const changed=structuredClone(input);changed.parsed.records[0].sourceDescription='CHANGED FIRST';
  assert.throws(()=>current.prepareCanonicalImport(ledger,changed,options(1000000)),/retry-normalization-changed/);
  const missing=structuredClone(input);missing.parsed.records.shift();
  assert.throws(()=>current.prepareCanonicalImport(ledger,missing,options(1000000)),/retry-row-missing/);
});

test('lifecycle event observation lookup is linear and preserves source links',()=>{
  const {ledger,input}=lifecycleFixture(1000);
  const {value:result,visits}=counted(()=>current.prepareCanonicalImport(ledger,input,options(1000000)));
  assert.ok(visits<8000,`${visits} find callback visits`);
  assert.equal(result.ledger.events.length,1000);
  assert.deepEqual(result.ledger.events.map(e=>e.sourceObservationId),result.ledger.imports.at(-1).observationIds);
  assert.equal(result.ledger.imports.at(-1).latestActivityDate,'2026-01-17');
});
