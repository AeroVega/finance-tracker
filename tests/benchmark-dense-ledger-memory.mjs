import {performance} from 'node:perf_hooks';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
import {getEffectiveActivities} from '../js/canonical-import.mjs';
if(typeof globalThis.gc!=='function')throw new Error('Run with node --expose-gc');
const years=Number(process.argv[2]??1);
const snapshot=stage=>{
  const memory=process.memoryUsage();
  console.log(JSON.stringify({years,stage,node:process.version,rssMiB:memory.rss/1048576,heapUsedMiB:memory.heapUsed/1048576,heapTotalMiB:memory.heapTotal/1048576,externalMiB:memory.external/1048576,processHighWaterRssMiB:process.resourceUsage().maxRSS/1024}));
};
globalThis.gc();snapshot('before-fixture-after-gc');
let start=performance.now();
const {ledger}=denseLedgerFixture(years);
console.log(JSON.stringify({years,stage:'fixture-created',elapsedMs:performance.now()-start,activities:ledger.activities.length,events:ledger.events.length}));
globalThis.gc();snapshot('retained-ledger-after-gc');
start=performance.now();
const projected=getEffectiveActivities(ledger);
console.log(JSON.stringify({years,stage:'projection-created',elapsedMs:performance.now()-start,projectedActivities:projected.length}));
snapshot('projection-before-gc');
globalThis.gc();snapshot('retained-ledger-and-projection-after-gc');
// Ensure both graphs remain live through the final snapshot.
console.log(JSON.stringify({retainedActivities:ledger.activities.length+projected.length,trueOperationPeak:'unavailable; synchronous operation prevents in-process sampling',highWaterScope:'whole fresh Node process including setup; Linux maxRSS in KiB'}));
