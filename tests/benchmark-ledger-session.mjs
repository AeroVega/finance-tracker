// Synthetic-only isolated process benchmark. No timing assertions.
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
import {createLedgerSessionOwner,applyFinancialEvent,validateLedger} from '../js/canonical-import.mjs';
if(typeof globalThis.gc!=='function')throw new Error('Run with node --expose-gc');
const mode=process.argv[2]??'session',years=Number(process.argv[3]??10);
if(!['session','pure'].includes(mode))throw new Error('Mode must be session or pure');
const memory=stage=>{
  globalThis.gc();const m=process.memoryUsage();
  console.log(JSON.stringify({mode,years,stage,node:process.version,rssMiB:m.rss/1048576,heapUsedMiB:m.heapUsed/1048576,processHighWaterRssMiB:process.resourceUsage().maxRSS/1024}));
};
memory('before-fixture');
let {ledger}=denseLedgerFixture(years),session=null;
const activityId=ledger.activities[0].activityId;
console.log(JSON.stringify({mode,years,activities:ledger.activities.length,events:ledger.events.length}));
memory('retained-source');
if(mode==='session') {
  const start=performance.now();session=createLedgerSessionOwner().open(JSON.stringify(ledger),'invented-copy:verified-base');
  console.log(JSON.stringify({mode,operation:'open',elapsedMs:performance.now()-start}));
  ledger=null;
}
memory('retained-working-state');
const times=[];
for(let i=0;i<10;i++) {
  const command={type:'classification',activityId,activityKind:'income',categoryId:'invented-session-'+i,commandId:'session-benchmark-'+i};
  const eventId=`cafe0000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,now='2026-11-08T00:00:00Z';
  const start=performance.now();
  if(session)session.applyBatchJson(JSON.stringify([{command,eventId,recordedAt:now}]),session.revision());
  else ledger=applyFinancialEvent(ledger,command,{now,idFactory:()=>eventId});
  times.push(performance.now()-start);
}
console.log(JSON.stringify({mode,operation:'ten-commands',timesMs:times,medianMs:[...times].sort((a,b)=>a-b)[5]}));
memory('after-commands');
const start=performance.now();
let json;
if(session)json=session.exportJson();else {validateLedger(ledger);json=JSON.stringify(ledger);}
console.log(JSON.stringify({mode,operation:'validated-export',elapsedMs:performance.now()-start,sha256:createHash('sha256').update(json).digest('hex')}));
json=null;
if(session){session.close();session=null;}ledger=null;
memory('released');
console.log(JSON.stringify({trueOperationPeak:'unavailable; synchronous operation prevents in-process sampling',highWaterScope:'whole fresh Node process including fixture setup; Linux maxRSS in KiB',scope:'CPU-only invented fixture; no browser, network, storage or mobile claim'}));
