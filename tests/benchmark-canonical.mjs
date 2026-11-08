// Opt-in, invented-data CPU probe. Run: node tests/benchmark-canonical.mjs
// This is not a test threshold or a browser, device, network, or Drive benchmark.
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {
  createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent,
  summarizeLedger, validateLedger, getEffectiveActivities,
} from '../js/canonical-import.mjs';

function setup(size) {
  let n=0;
  const options={now:()=> '2026-11-06T00:00:00.000Z',idFactory:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`};
  let ledger=createLedger(options);
  ledger=registerAccount(ledger,{institutionId:'sofi',name:'Invented benchmark account',currency:'USD',accountType:'checking'},options);
  const accountId=ledger.accounts[0].accountId;
  const records=Array.from({length:size},(_,i)=>({
    sourceAccountKey:'default',sourceFields:{Description:`INVENTED SHOP ${i}`,Amount:'-12.34'},
    rowOrdinal:i+1,physicalLine:i+2,sourceDescription:`INVENTED SHOP ${i}`,normalizedDescription:`invented shop ${i}`,
    sourceAction:'Card purchase',sourceRecordId:null,amountText:'-12.34',currency:null,
    effectiveDate:'2026-01-15',postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null,
  }));
  ledger=prepareCanonicalImport(ledger,{
    syntheticOnly:true,
    parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:`invented-${size}`,
      rowsSeen:size+1,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},
    accountMappings:{default:accountId},
    coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-02-28',provenance:'user-confirmed'}},
  },options).ledger;
  return {ledger,options};
}
function measure(operation) {
  const samples=Array.from({length:3},()=>{
    const start=performance.now();operation();return performance.now()-start;
  }).sort((a,b)=>a-b);
  return {medianMs:+samples[1].toFixed(2),rangeMs:[+samples[0].toFixed(2),+samples[2].toFixed(2)]};
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,repeats:3,
  scenario:'Synthetic one-account, one-import ledger with N activities and observations, initially no events; no network'}));
for(const size of [250,500,1000]) {
  const {ledger}=setup(size);
  console.log(JSON.stringify({rows:size,operation:'getEffectiveActivities',...measure(()=>{
    const result=getEffectiveActivities(ledger);assert.equal(result.length,size);assert.ok(result.every(a=>a.active));
  })}));
}
const {ledger,options}=setup(10000);
for(const [operation,run] of Object.entries({
  validate:()=>validateLedger(ledger),
  classify:()=>applyFinancialEvent(ledger,{type:'classification',activityId:ledger.activities[0].activityId,
    activityKind:'spending',categoryId:'invented',commandId:'invented'},options),
  summarize:()=>summarizeLedger(ledger,{start:'2026-01-01',end:'2026-01-31',currency:'USD'}),
})) console.log(JSON.stringify({rows:10000,operation,...measure(run)}));
