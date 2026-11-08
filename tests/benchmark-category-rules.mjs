// Invented-data CPU/size probe. No network or Drive operations.
// Run: node tests/benchmark-category-rules.mjs [--baseline-ref=<commit>]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as current from '../js/canonical-import.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {serializePackedCanonicalLedger} from '../js/canonical-ledger-storage.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';

const args=process.argv.slice(2);
if(args.length>1 || (args.length && !/^--baseline-ref=[A-Za-z0-9._/-]+$/.test(args[0]))) throw new Error('Usage: node tests/benchmark-category-rules.mjs [--baseline-ref=<commit>]');
const implementations=[['current',current]];
if(args.length) {
  const ref=args[0].slice('--baseline-ref='.length),cwd=fileURLToPath(new URL('..',import.meta.url));
  let source=execFileSync('git',['show',`${ref}:js/canonical-import.mjs`],{cwd,encoding:'utf8'});
  for(const dependency of ['transaction-protocol','import-reconciliation']) source=source.replace(`'./${dependency}.mjs'`,JSON.stringify(new URL(`../js/${dependency}.mjs`,import.meta.url).href));
  implementations.unshift([ref,await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))]);
}
const options=()=>{let n=0;return {now:()=> '2026-11-08T00:00:00.000Z',idFactory:()=>`f00d0002-0000-4000-8000-${String(++n).padStart(12,'0')}`};};
function setup(size) {
  const opt=options();let ledger=current.registerAccount(current.createLedger(opt),{institutionId:'sofi',name:'Invented category benchmark',currency:'USD',accountType:'checking'},opt);
  const accountId=ledger.accounts[0].accountId;
  const records=Array.from({length:size},(_,i)=>({sourceAccountKey:'default',sourceFields:{Description:`INVENTED SHOP ${i}`,Amount:'-12.34'},rowOrdinal:i+1,sourceDescription:`INVENTED SHOP ${i}`,normalizedDescription:`invented shop ${i}`,sourceAction:'Card purchase',sourceRecordId:null,amountText:'-12.34',currency:'USD',effectiveDate:'2025-01-15',postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null}));
  ledger=current.prepareCanonicalImport(ledger,{syntheticOnly:true,parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:`invented-${size}`,rowsSeen:size,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start:'2025-01-01',end:'2025-12-31',provenance:'source-confirmed'}}},opt).ledger;
  return {ledger,opt};
}
function measure(run) {const samples=Array.from({length:3},()=>{const start=performance.now();run();return performance.now()-start;}).sort((a,b)=>a-b);return {medianMs:+samples[1].toFixed(2),rangeMs:samples.map(ms=>+ms.toFixed(2))};}
console.log(JSON.stringify({node:process.version,repeats:3,scope:'Synthetic CPU and serialized bytes only; not browser or Drive timing'}));
for(const size of [1000,2000]) {
  let expected;
  for(const [label,api] of implementations) {
    const {ledger:base,opt}=setup(size);let four=base;
    for(let n=1;n<=4;n++)four=api.applyFinancialEvent(four,{type:'category-correction',activityId:base.activities[0].activityId,categoryId:`invented-${n}`,commandId:`invented-${n}`},opt);
    let packed;try{serializePackedCanonicalLedger(four);packed='success';}catch(error){packed=error.code;}
    console.log(JSON.stringify({implementation:label,activities:size,corrections:4,eventBytes:Buffer.byteLength(canonicalizeJcs(four.events)),membersPerRule:four.events[0].prospectiveRule.existingActivityIds.length,packed}));
    // Use an actual event as the template; build the longer valid history outside timing.
    const ledger=structuredClone(base),template=four.events[0];
    for(let i=1;i<=100;i++)ledger.events.push({...structuredClone(template),eventId:opt.idFactory(),commandId:`invented-history-${i}`,commandSignature:canonicalizeJcs({type:'category-correction',activityId:template.activityId,categoryId:`invented-${i}`,commandId:`invented-history-${i}`}),categoryId:`invented-${i}`,priorCategoryId:i===1?null:`invented-${i-1}`});
    assert.equal(api.validateLedger(ledger),true);
    const projected=api.getEffectiveActivities(ledger);expected??=projected;assert.deepEqual(projected,expected);
    console.log(JSON.stringify({implementation:label,activities:size,corrections:100,operation:'getEffectiveActivities',...measure(()=>api.getEffectiveActivities(ledger))}));
  }
}
const {ledger:year}=await createSyntheticFinancialYear();
for(const [label,api] of implementations) {
  const opt=options(),target=year.activities.find(a=>a.sourceDescription==='INVENTED UTILITY');
  const result=api.applyFinancialEvent(year,{type:'category-correction',activityId:target.activityId,categoryId:'invented-utility',commandId:'invented-utility'},opt),event=result.events.at(-1);
  assert.deepEqual(api.summarizeLedger(result,{start:'2025-01-01',end:'2025-12-31',currency:'USD'}),current.summarizeLedger(year,{start:'2025-01-01',end:'2025-12-31',currency:'USD'}));
  console.log(JSON.stringify({implementation:label,scenario:'year-utility',activities:year.activities.length,eventBytes:Buffer.byteLength(canonicalizeJcs(event)),membersPerRule:event.prospectiveRule.existingActivityIds.length}));
}
