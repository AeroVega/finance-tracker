// Invented CPU scaling only. No browser, network, Drive or private records.
// Optional first argument: path to an unchanged baseline canonical-import.mjs.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as indexed from '../js/canonical-import.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
const baseline=process.argv[2]?await import(pathToFileURL(resolve(process.argv[2]))):null;
const measure=fn=>{const samples=[];let value;for(let i=0;i<3;i++){const start=performance.now();value=fn();samples.push(performance.now()-start);}return {value,medianMs:+samples.sort((a,b)=>a-b)[1].toFixed(2)};};
function compareCase(kind,ledger,scope) {
  const options=()=>{let n=0;return {now:()=> '2026-11-08T00:00:00.000Z',idFactory:()=>`c0de9999-0000-4000-8000-${String(++n).padStart(12,'0')}`};};
  for(const [operation,run] of Object.entries({validate:module=>module.validateLedger(ledger),
    project:module=>module.getEffectiveActivities(ledger),summary:module=>module.summarizeLedger(ledger,scope),
    command:module=>module.applyFinancialEvent(ledger,{type:'classification',activityId:ledger.activities[0].activityId,
      activityKind:ledger.activities[0].amountMinor>0?'income':'spending',categoryId:'invented-benchmark',commandId:'invented-benchmark-next'},options())})) {
    const before=baseline?measure(()=>run(baseline)):null,after=measure(()=>run(indexed));
    if(before)assert.deepEqual(after.value,before.value);
    console.log(JSON.stringify({kind,activities:ledger.activities.length,events:ledger.events.length,operation,
      baselineMs:before?.medianMs??null,indexedMs:after.medianMs,speedup:before?+(before.medianMs/after.medianMs).toFixed(2):null}));
  }
}
console.log(JSON.stringify({node:process.version,repeats:3,scope:'Synthetic CPU only, each result compared with baseline when provided'}));
for(const count of [1000,3000,6000]) {
  const {ledger,options}=replayFixture(1000);
  for(let i=0;i<count;i++)ledger.events.push({eventId:options.idFactory(),commandId:`invented-benchmark-${i}`,eventType:'classification',
    activityId:ledger.activities[i%1000].activityId,recordedAt:options.now(),appendOnly:true,activityKind:'spending',categoryId:'invented',
    priorActivityKind:i<1000?'unclassified':'spending',priorCategoryId:i<1000?null:'invented'});
  compareCase('classification-history',ledger,{start:'2026-01-01',end:'2026-12-31',currency:'USD'});
}
let combined;
for(let offset=0;offset<10;offset++) {
  const year=2016+offset,fixture=await createSyntheticFinancialYear({year});
  if(!combined)combined=structuredClone(fixture.ledger);
  else {
    // Same four invented accounts across years; independent source imports and
    // original evidence, UUIDs and command IDs remain unique to each year.
    let serialized=JSON.stringify(fixture.ledger);
    for(let i=0;i<fixture.ledger.accounts.length;i++)serialized=serialized.replaceAll(fixture.ledger.accounts[i].accountId,combined.accounts[i].accountId);
    const next=JSON.parse(serialized);
    for(const collection of ['imports','observations','activities','events','reviewDecisions'])combined[collection].push(...next[collection]);
  }
  if([1,5,10].includes(offset+1))compareCase(`${offset+1}-financial-years`,combined,{start:'2016-01-01',end:`${year}-12-31`,currency:'USD'});
}
