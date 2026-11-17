import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent,
  applyReviewDecision, reverseReviewDecision, getEffectiveActivities, summarizeLedger, validateLedger} from '../js/canonical-import.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';

const now='2026-11-08T00:00:00.000Z';
const options=()=>{let n=0;return {now:()=>now,idFactory:()=>`f00d0001-0000-4000-8000-${String(++n).padStart(12,'0')}`};};
const row=(i=0,overrides={})=>({sourceAccountKey:'default',sourceFields:{Description:`INVENTED SHOP ${i}`,Amount:'-12.34'},
  rowOrdinal:i+1,physicalLine:i+2,sourceDescription:`INVENTED SHOP ${i}`,normalizedDescription:`invented shop ${i}`,
  sourceAction:'Card purchase',sourceRecordId:null,amountText:'-12.34',currency:'USD',effectiveDate:'2025-01-15',
  postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null,...overrides});
const input=(account,records,fingerprint)=>({syntheticOnly:true,
  parsed:{sourceFormat:account.institutionId==='wells-fargo'?'wells-fargo-csv-v1':'sofi-csv-v1',institutionId:account.institutionId,
    fileFingerprint:fingerprint,rowsSeen:records.length,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},
  accountMappings:{default:account.accountId},coverageByAccount:{[account.accountId]:{start:'2025-01-01',end:'2025-12-31',provenance:'source-confirmed'}}});
function setup(records=Array.from({length:1000},(_,i)=>row(i))) {
  const opt=options();
  let ledger=registerAccount(createLedger(opt),{institutionId:'sofi',name:'Invented category account',currency:'USD',accountType:'checking'},opt);
  ledger=prepareCanonicalImport(ledger,input(ledger.accounts[0],records,'invented-first-import'),opt).ledger;
  return {ledger,opt};
}
const correct=(ledger,opt,activityId,categoryId,commandId=categoryId)=>applyFinancialEvent(ledger,{type:'category-correction',activityId,categoryId,commandId},opt);
const scope=a=>({accountId:a.accountId,institutionId:a.institutionId,currency:a.currency,
  normalizedDescription:a.normalizedDescription??a.sourceDescription,sourceAction:a.sourceAction});
const matchingIds=(ledger,a)=>ledger.activities.filter(peer=>canonicalizeJcs(scope(peer))===canonicalizeJcs(scope(a))).map(peer=>peer.activityId);
const annual=ledger=>summarizeLedger(ledger,{start:'2025-01-01',end:'2025-12-31',currency:'USD'});
const year=await createSyntheticFinancialYear();

function storage() {
  const http=new HttpFullSnapshotDrive();
  const store=createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',
    fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
  return {http,store};
}
async function persisted(ledger) {
  const {store}=storage();
  try {
    await store.start({initialize:true});await store.save(ledger);await store.release();
    await store.start();const reopened=await store.open();
    assert.deepEqual(reopened,ledger);
    return reopened;
  } finally {await store.release().catch(()=>{});}
}

test('new category rules retain only exact-key peers and preserve every scope boundary',()=>{
  const {opt,ledger:initial}=setup([row(0),row(1,{normalizedDescription:'invented shop 0'}),
    row(2,{normalizedDescription:'invented shop 0',currency:'EUR'}),row(3,{normalizedDescription:'invented shop 0',sourceAction:'Different action'}),row(4)]);
  let ledger=registerAccount(initial,{institutionId:'sofi',name:'Other invented account',currency:'USD',accountType:'checking'},opt);
  ledger=prepareCanonicalImport(ledger,input(ledger.accounts[1],[row(0)],'other-account'),opt).ledger;
  const target=ledger.activities[0],before=structuredClone(ledger);
  ledger=correct(ledger,opt,target.activityId,'corrected');
  assert.deepEqual(ledger.events.at(-1).prospectiveRule.existingActivityIds,[target.activityId,ledger.activities[1].activityId]);
  assert.deepEqual(ledger.activities,before.activities);assert.deepEqual(ledger.observations,before.observations);
  assert.deepEqual(getEffectiveActivities(ledger).map(a=>a.categoryId),['corrected',null,null,null,null,null]);
});

test('blank descriptions keep a disabled rule with only the target identity',()=>{
  const {opt,ledger:initial}=setup([row(0,{sourceDescription:' ',normalizedDescription:' '}),row(1,{normalizedDescription:' '}),row(2)]);
  const ledger=correct(initial,opt,initial.activities[0].activityId,'explicit-only');
  assert.equal(ledger.events[0].prospectiveRule.enabled,false);
  assert.deepEqual(ledger.events[0].prospectiveRule.existingActivityIds,[initial.activities[0].activityId]);
  const later=prepareCanonicalImport(ledger,input(ledger.accounts[0],[row(0,{normalizedDescription:' ',effectiveDate:'2025-02-01'})],'late-blank'),opt).ledger;
  assert.equal(getEffectiveActivities(later).at(-1).categoryId,null);
});

test('description fallback and exact normalized text preserve existing matching semantics',()=>{
  const {opt,ledger:initial}=setup([row(0,{normalizedDescription:null}),row(1,{normalizedDescription:null,sourceDescription:'INVENTED SHOP 0'}),row(2,{normalizedDescription:'invented shop 0'})]);
  const ledger=correct(initial,opt,initial.activities[0].activityId,'fallback-category');
  assert.deepEqual(ledger.events[0].prospectiveRule.existingActivityIds,initial.activities.slice(0,2).map(a=>a.activityId));
  assert.equal(validateLedger(JSON.parse(canonicalizeJcs(ledger))),true);
});

test('inactive retained peers stay excluded from prospective recategorization',()=>{
  const {opt,ledger:initial}=setup([row(0)]);let ledger=prepareCanonicalImport(initial,input(initial.accounts[0],[row(0)],'invented-overlap'),opt).ledger;
  ledger=applyReviewDecision(ledger,{observationId:ledger.observations.at(-1).observationId,action:'keep-separate'},opt);
  const inactiveId=ledger.activities.at(-1).activityId;
  ledger=reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId},opt);
  assert.equal(getEffectiveActivities(ledger).at(-1).active,false);
  ledger=correct(ledger,opt,ledger.activities[0].activityId,'new-category');
  assert.ok(ledger.events.at(-1).prospectiveRule.existingActivityIds.includes(inactiveId));
  assert.equal(getEffectiveActivities(ledger).find(a=>a.activityId===inactiveId).categoryId,null);
});

test('1,000 distinct activities retain compact corrections through full-snapshot reopen',async()=>{
  const {opt,ledger:initial}=setup();let ledger=initial;
  for(let i=1;i<=4;i++)ledger=correct(ledger,opt,ledger.activities[0].activityId,`invented-${i}`);
  assert.ok(ledger.events.every(event=>event.prospectiveRule.existingActivityIds.length===1));
  assert.ok(Buffer.byteLength(canonicalizeJcs(ledger.events))<4000);
  const current=await persisted(ledger);
  const legacy=structuredClone(ledger);for(const event of legacy.events)event.prospectiveRule.existingActivityIds=initial.activities.map(a=>a.activityId);
  assert.equal(validateLedger(legacy),true);
  const expanded=await persisted(legacy);
  assert.ok(Buffer.byteLength(canonicalizeJcs(expanded))>Buffer.byteLength(canonicalizeJcs(current)));
  assert.deepEqual(getEffectiveActivities(ledger),getEffectiveActivities(legacy));
});

test('year fixture corrections preserve old peers, late backdated imports and refund dependencies',()=>{
  const opt=options(),before=year.ledger;
  const target=before.activities.find(a=>a.sourceDescription==='INVENTED SEASONAL PURCHASE'&&a.effectiveDate==='2025-06-22');
  let ledger=correct(before,opt,target.activityId,'corrected-travel');
  const rule=ledger.events.at(-1).prospectiveRule;
  assert.deepEqual(rule.existingActivityIds,matchingIds(before,target));assert.equal(rule.existingActivityIds.length,12);
  const refundId=before.events.find(e=>e.eventType==='refund-link').activityId;
  assert.equal(getEffectiveActivities(ledger).find(a=>a.activityId===refundId).categoryId,'corrected-travel');
  assert.deepEqual(annual(ledger),year.summary);
  const record=row(0,{sourceDescription:target.sourceDescription,normalizedDescription:target.normalizedDescription,
    sourceAction:target.sourceAction,effectiveDate:'2025-01-01',amountText:'-30.00'});
  ledger=prepareCanonicalImport(ledger,input(ledger.accounts.find(a=>a.accountId===target.accountId),[record],'invented-late-backdated'),opt).ledger;
  const lateId=ledger.activities.at(-1).activityId;
  assert.equal(getEffectiveActivities(ledger).at(-1).categoryId,'corrected-travel');
  ledger=correct(ledger,opt,refundId,'explicit-refund-category');
  ledger=correct(ledger,opt,target.activityId,'latest-travel');
  let view=getEffectiveActivities(ledger);
  assert.equal(view.find(a=>a.activityId===refundId).categoryId,'explicit-refund-category');
  assert.equal(view.find(a=>a.activityId===lateId).categoryId,'corrected-travel');
  ledger=prepareCanonicalImport(ledger,input(ledger.accounts.find(a=>a.accountId===target.accountId),[{...record,effectiveDate:'2025-01-02'}],'invented-later-backdated'),opt).ledger;
  view=getEffectiveActivities(ledger);assert.equal(view.at(-1).categoryId,'latest-travel');
  assert.deepEqual(ledger.activities.slice(0,before.activities.length),before.activities);
  assert.deepEqual(ledger.events.slice(0,before.events.length),before.events);
});

test('year fixture retains existing broad rule membership when appending scoped rules and reopening',async()=>{
  const opt=options(),target=year.ledger.activities.find(a=>a.sourceDescription==='INVENTED UTILITY');
  let ledger=correct(year.ledger,opt,target.activityId,'broad-utility');
  // Broad membership is still a valid logical event, independent of physical format.
  ledger.events.at(-1).prospectiveRule.existingActivityIds=year.ledger.activities.map(a=>a.activityId);
  const originalEvent=canonicalizeJcs(ledger.events.at(-1)),baseline=annual(ledger);
  const {store}=storage();
  try {
    await store.start({initialize:true});await store.save(ledger);
    for(let i=1;i<=4;i++)ledger=correct(ledger,opt,target.activityId,`scoped-utility-${i}`);
    assert.equal(canonicalizeJcs(ledger.events[year.ledger.events.length]),originalEvent);
    assert.ok(ledger.events.slice(-4).every(e=>e.prospectiveRule.existingActivityIds.length===12));
    await store.save(ledger);await store.release();await store.start();
    const reopened=await store.open();
    assert.deepEqual(reopened,ledger);assert.deepEqual(annual(reopened),baseline);
    const changed=structuredClone(reopened);changed.events[year.ledger.events.length].prospectiveRule.existingActivityIds=[target.activityId];
    await assert.rejects(store.save(changed),{code:'history-rewrite-refused'});
  } finally {await store.release().catch(()=>{});}
});

test('unrelated legacy membership arrays are not searched during effective projection',()=>{
  const {opt,ledger:initial}=setup(Array.from({length:40},(_,i)=>row(i)));
  const ledger=correct(initial,opt,initial.activities[0].activityId,'corrected');
  const ids=ledger.events[0].prospectiveRule.existingActivityIds=initial.activities.map(a=>a.activityId);
  let searches=0;const includes=ids.includes;
  Object.defineProperty(ids,'includes',{value(...args){searches++;return includes.apply(this,args);}});
  getEffectiveActivities(ledger);
  // One validation check for the event target. Replay uses a per-event membership Set.
  assert.equal(searches,1);
});

test('bank corrections and pending-to-posted transitions preserve scoped rule identity',()=>{
  const {opt,ledger:initial}=setup([row(0,{sourceRecordId:'invented-bank-id',lifecycleStatus:'pending'})]);
  const target=initial.activities[0];let ledger=correct(initial,opt,target.activityId,'corrected-category');
  const key=structuredClone(ledger.events[0].prospectiveRule.key);
  ledger=applyFinancialEvent(ledger,{type:'bank-correction',activityId:target.activityId,commandId:'invented-bank-correction',amountText:'-10.00',evidence:{reason:'Invented source correction'}},opt);
  ledger=prepareCanonicalImport(ledger,input(ledger.accounts[0],[row(0,{sourceRecordId:'invented-bank-id',amountText:'-10.00',effectiveDate:'2025-01-17',postedDate:'2025-01-17'})],'invented-posted'),opt).ledger;
  assert.equal(ledger.activities.length,1);assert.equal(ledger.events.at(-1).eventType,'lifecycle-transition');
  ledger=prepareCanonicalImport(ledger,input(ledger.accounts[0],[row(0,{amountText:'-5.00',effectiveDate:'2025-01-18'})],'invented-future-peer'),opt).ledger;
  const view=getEffectiveActivities(ledger);
  assert.equal(view[0].amountMinor,-1000);assert.equal(view[0].lifecycleStatus,'posted');
  assert.equal(view[0].categoryId,'corrected-category');assert.equal(view[1].categoryId,'corrected-category');
  assert.deepEqual(ledger.events[0].prospectiveRule.key,key);
  assert.deepEqual(scope(view[0]),key);assert.deepEqual(ledger.activities[0],target);
  assert.equal(validateLedger(JSON.parse(canonicalizeJcs(ledger))),true);
});

test('structured source-action JSON retains accepted legacy JCS equality',()=>{
  const {opt,ledger:initial}=setup([row(0,{sourceAction:{type:'invented',metadata:{b:2,a:1}}}),
    row(1,{normalizedDescription:'invented shop 0',sourceAction:{metadata:{a:1,b:2},type:'invented'}})]);
  assert.equal(validateLedger(initial),true);
  const ledger=correct(initial,opt,initial.activities[0].activityId,'structured-action');
  assert.deepEqual(ledger.events[0].prospectiveRule.existingActivityIds,initial.activities.map(a=>a.activityId));
  const later=prepareCanonicalImport(ledger,input(ledger.accounts[0],[row(0,{effectiveDate:'2025-01-20',sourceAction:{metadata:{a:1,b:2},type:'invented'}})],'invented-late-structured'),opt).ledger;
  assert.equal(getEffectiveActivities(later).at(-1).categoryId,'structured-action');
  assert.equal(validateLedger(JSON.parse(canonicalizeJcs(later))),true);
});

test('dense same-key history preserves complete membership through full-snapshot reopen',async()=>{
  const {opt,ledger:initial}=setup(Array.from({length:1000},(_,i)=>row(i,{normalizedDescription:'invented recurring merchant'})));
  let ledger=initial;
  for(let i=1;i<=4;i++)ledger=correct(ledger,opt,ledger.activities[0].activityId,`dense-${i}`);
  assert.ok(ledger.events.every(event=>event.prospectiveRule.existingActivityIds.length===1000));
  const reopened=await persisted(ledger);
  assert.deepEqual(reopened.events.map(event=>event.prospectiveRule.existingActivityIds),
    ledger.events.map(event=>event.prospectiveRule.existingActivityIds));
});
