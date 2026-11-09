import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import * as candidate from '../js/canonical-import.mjs';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
const baseline=process.argv[2]?await import(pathToFileURL(process.argv[2]).href):null;
const sizes=(process.env.DENSE_YEARS??'1,5,10').split(',').map(Number);
const repeats=Number(process.env.DENSE_REPEATS??3);
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const options=()=>({now:'2026-11-08T00:00:00.000Z',idFactory:()=> 'de050002-0000-4000-8000-000000000001'});
console.log(JSON.stringify({node:process.version,repeats,scope:'Invented parsed-input CPU only. Concurrent workloads can distort timings.'}));
for(const years of sizes) {
  const setupStart=performance.now(),{ledger,range}=denseLedgerFixture(years);
  console.log(JSON.stringify({years,setupMs:performance.now()-setupStart,activities:ledger.activities.length,events:ledger.events.length,observations:ledger.observations.length,accounts:ledger.accounts.length,rssMiB:process.memoryUsage().rss/1048576}));
  const command={type:'classification',activityId:ledger.activities[0].activityId,activityKind:'income',categoryId:'invented-reclassified',commandId:'dense:measured-command'};
  const operations={validate:api=>api.validateLedger(ledger),project:api=>api.getEffectiveActivities(ledger),summary:api=>api.summarizeLedger(ledger,range),command:api=>api.applyFinancialEvent(ledger,command,options())};
  for(const [operation,run] of Object.entries(operations)) {
    const times={baseline:[],candidate:[]};
    for(let i=0;i<repeats;i++) {
      let a,b;
      for(const key of (i%2?['candidate','baseline']:['baseline','candidate'])) {
        const api=key==='baseline'?baseline:candidate;if(!api)continue;
        const start=performance.now(),result=run(api);times[key].push(performance.now()-start);
        if(key==='baseline')a=result;else b=result;
      }
      if(baseline)assert.deepEqual(b,a);
    }
    const before=baseline?median(times.baseline):null,after=median(times.candidate);
    console.log(JSON.stringify({years,operation,baselineMs:before,candidateMs:after,speedup:before?before/after:null,fullOutputEqual:!!baseline,rssMiB:process.memoryUsage().rss/1048576}));
  }
  // Read-count evidence is independent of machine speed; getter preserves event values.
  let reads=0;
  const counted={...ledger,events:ledger.events.map(event=>{const copy={...event};Object.defineProperty(copy,'eventType',{enumerable:true,get(){reads++;return event.eventType;}});return copy;})};
  candidate.validateLedger(counted);
  assert.ok(reads <= 12*ledger.events.length+100, `event reads exceeded linear fixture bound: ${reads}`);
  console.log(JSON.stringify({years,operation:'validate-event-type-reads',reads,events:ledger.events.length,readsPerEvent:reads/ledger.events.length}));
}
