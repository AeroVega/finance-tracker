import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import * as api from '../js/canonical-import.mjs';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
const baseline=process.argv[2]?await import(pathToFileURL(process.argv[2]).href):api;
const repeats=Number(process.env.DENSE_REPEATS??3);
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
console.log(JSON.stringify({node:process.version,repeats,scope:'Invented local CPU only; no network. Full outputs compared.'}));
for(const years of (process.env.DENSE_YEARS??'1,5,10').split(',').map(Number)) {
  const {ledger,range}=denseLedgerFixture(years);
  const scopes=[range,...Array.from({length:12},(_,i)=>({start:`2015-${String(i+1).padStart(2,'0')}-01`,end:`2015-${String(i+1).padStart(2,'0')}-${new Date(Date.UTC(2015,i+1,0)).getUTCDate()}`,currency:'USD'}))];
  const times={separate:[],batch:[]};
  for(let i=0;i<repeats;i++) {
    const results={};
    for(const name of i%2?['batch','separate']:['separate','batch']) {
      const start=performance.now();results[name]=name==='batch'?api.summarizeLedgerPeriods(ledger,scopes):scopes.map(scope=>baseline.summarizeLedger(ledger,scope));times[name].push(performance.now()-start);
    }
    assert.deepEqual(results.batch,results.separate);
  }
  let reads=0;
  const counted={...ledger,events:ledger.events.map(event=>{const copy={...event};Object.defineProperty(copy,'eventType',{enumerable:true,get(){reads++;return event.eventType;}});return copy;})};
  scopes.map(scope=>baseline.summarizeLedger(counted,scope));const separateReads=reads;reads=0;
  api.summarizeLedgerPeriods(counted,scopes);
  console.log(JSON.stringify({years,activities:ledger.activities.length,events:ledger.events.length,scopes:scopes.length,separateMs:median(times.separate),batchMs:median(times.batch),speedup:median(times.separate)/median(times.batch),separateEventReads:separateReads,batchEventReads:reads,fullOutputEqual:true,rssMiB:process.memoryUsage().rss/1048576}));
}
