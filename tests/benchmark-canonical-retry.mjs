// Synthetic-only full-output comparison. Supply an unchanged baseline module
// beside canonical-import.mjs so its relative imports resolve identically.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as current from '../js/canonical-import.mjs';
import {fixture,lifecycleFixture,options} from './helpers/canonical-retry-fixture.mjs';
if(!process.argv[2]) throw new Error('Pass the baseline module path');
const baseline=await import(pathToFileURL(resolve(process.argv[2])));
for(const [scenario,build] of Object.entries({retry:fixture,lifecycle:lifecycleFixture})) for(const size of [1000,10000]) {
  const {ledger,input}=build(size,baseline);
  const run=api=>{const start=performance.now();const result=api.prepareCanonicalImport(ledger,input,options(1000000));return {result,ms:performance.now()-start};};
  const before=run(baseline),after=run(current);
  assert.deepEqual(after.result,before.result);
  console.log(JSON.stringify({scenario,size,baselineMs:before.ms,indexedMs:after.ms,speedup:before.ms/after.ms,completeOutputEqual:true}));
}
