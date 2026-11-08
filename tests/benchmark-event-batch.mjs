// Pure invented commands. Not a timing-based CI test or a storage benchmark.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {applyFinancialEvents,applyFinancialEvent} from '../js/canonical-import.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
const measure=fn=>{const times=[];let result;for(let i=0;i<3;i++){const start=performance.now();result=fn();times.push(performance.now()-start);}return {result,medianMs:+times.sort((a,b)=>a-b)[1].toFixed(2)};};
for(const size of [100,1000]) {
  const {ledger}=replayFixture(size),commands=ledger.activities.map(a=>({type:'classification',activityId:a.activityId,activityKind:'spending',categoryId:'invented',commandId:a.activityId}));
  const opt=()=>{let i=0;return {now:'2026-11-08T00:00:00Z',idFactory:()=>`c0de0002-0000-4000-8000-${String(++i).padStart(12,'0')}`};};
  const separate=measure(()=>{const options=opt();return commands.reduce((current,command)=>applyFinancialEvent(current,command,options),ledger);});
  const batch=measure(()=>applyFinancialEvents(ledger,commands,opt()));
  assert.deepEqual(batch.result,separate.result);
  console.log(JSON.stringify({node:process.version,size,separateMs:separate.medianMs,batchMs:batch.medianMs,identical:true}));
}
