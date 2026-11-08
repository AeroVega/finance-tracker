import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger, registerAccount, prepareCanonicalImport, applyReviewDecision,
  reverseReviewDecision, applyFinancialEvent, getEffectiveActivities, validateLedger,
} from '../js/canonical-import.mjs';

const options=()=>{
  let n=0;
  return {now:()=> '2026-11-06T00:00:00.000Z',idFactory:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`};
};
const row=(index=0,overrides={})=>({
  sourceAccountKey:'default',sourceFields:{Description:`INVENTED SHOP ${index}`,Amount:'-12.34'},
  rowOrdinal:index+1,physicalLine:index+2,sourceDescription:`INVENTED SHOP ${index}`,
  normalizedDescription:`invented shop ${index}`,sourceAction:'Card purchase',sourceRecordId:null,
  amountText:'-12.34',currency:null,effectiveDate:'2026-01-15',postedDate:null,settlementDate:null,
  lifecycleStatus:'posted',valid:true,errorCode:null,...overrides,
});
function input(accountId,records,fingerprint='invented-index-fixture') {
  return {
    syntheticOnly:true,
    parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:fingerprint,
      rowsSeen:records.length,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},
    accountMappings:{default:accountId},
    coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-02-28',provenance:'user-confirmed'}},
  };
}
function setup(size=4,records=Array.from({length:size},(_,i)=>row(i))) {
  const opt=options();
  let ledger=createLedger(opt);
  ledger=registerAccount(ledger,{institutionId:'sofi',name:'Invented index account',currency:'USD',accountType:'checking'},opt);
  const accountId=ledger.accounts[0].accountId;
  ledger=prepareCanonicalImport(ledger,input(accountId,records),opt).ledger;
  return {ledger,opt,accountId};
}
function recount(ledger) {
  for(const run of ledger.imports) {
    const observations=ledger.observations.filter(o=>run.observationIds.includes(o.observationId));
    run.counts={rowsSeen:observations.length,rowsRecognized:observations.length,created:0,matched:0,review:0,rejected:0,ignored:0};
    for(const observation of observations) run.counts[observation.disposition]++;
    run.status=observations.some(o=>!o.resolved&&['review','rejected'].includes(o.disposition))?'needs-review':'processed';
  }
}

// Deliberately fan out an invented, validated ledger to exercise each lookup.
// Building the shape outside the measured operation avoids counting setup work.
function splitImportsAndAccounts(ledger,opt) {
  const accountTemplate=ledger.accounts[0],runTemplate=ledger.imports[0];
  ledger.accounts=[];ledger.imports=[];
  ledger.observations.forEach((observation,i)=>{
    const account={...accountTemplate,accountId:opt.idFactory(),displayName:`Invented account ${i}`};
    const run={...structuredClone(runTemplate),importRunId:opt.idFactory(),accountId:account.accountId,
      fileFingerprint:`invented-split-${i}`,observationIds:[observation.observationId]};
    ledger.accounts.push(account);ledger.imports.push(run);
    observation.accountId=account.accountId;observation.candidate.accountId=account.accountId;
    observation.importRunId=run.importRunId;observation.resolved=true;
    ledger.activities[i].accountId=account.accountId;
    ledger.reviewDecisions.push({reviewDecisionId:opt.idFactory(),observationId:observation.observationId,
      activityId:observation.activityId,action:'keep-separate',priorDisposition:'review',rationale:'Invented decision',
      currency:null,existingEventIds:[],reviewer:'user',createdAt:opt.now()});
  });
  recount(ledger);
  assert.equal(validateLedger(ledger),true);
}
function instrumentReads(ledger) {
  const reads={};
  const count=(record,key,label)=>{
    const value=record[key];
    reads[label]??=0;
    Object.defineProperty(record,key,{enumerable:true,configurable:true,get(){reads[label]++;return value;}});
  };
  for(const account of ledger.accounts) count(account,'accountId','accounts');
  for(const run of ledger.imports) {
    count(run,'importRunId','imports');
    for(let i=0;i<run.observationIds.length;i++) count(run.observationIds,i,'memberships');
  }
  for(const observation of ledger.observations) {
    count(observation,'observationId','observations');
    count(observation,'activityId','support');
  }
  for(const activity of ledger.activities) count(activity,'activityId','activities');
  for(const decision of ledger.reviewDecisions) {
    count(decision,'reviewDecisionId','decisions');
    count(decision,'observationId','decisionObservations');
  }
  return reads;
}
for(const [name,operation] of Object.entries({validate:validateLedger,project:getEffectiveActivities})) {
  for(const split of [false,true]) {
    test(`${name} uses bounded reference reads as ${split?'accounts, imports and decisions':'activities and import membership'} grow`,()=>{
      const measure=size=>{
        const {ledger,opt}=setup(size);
        if(split) splitImportsAndAccounts(ledger,opt);
        const reads=instrumentReads(ledger);
        operation(ledger);
        return reads;
      };
      const small=measure(40),large=measure(80);
      for(const [field,count] of Object.entries(large)) {
        assert.ok(count<=80*32,`${field}: ${count} reference reads exceeded the linear budget`);
        assert.ok(count<=small[field]*2.25+16,`${field}: doubling rows grew reads from ${small[field]} to ${count}`);
      }
    });
  }
}

test('projection preserves order and requires created or matched support, including multiple observations',()=>{
  const {ledger,opt}=setup();
  ledger.observations[0].disposition='ignored';
  ledger.observations[2].disposition='matched';
  ledger.activities[2].lifecycleStatus='reversed';
  ledger.observations[3].disposition='ignored';ledger.observations[3].activityId=null;
  for(const [disposition,activityId] of [['matched',ledger.activities[1].activityId],['review',null],['rejected',null],['ignored',null]]) {
    const observation={...structuredClone(ledger.observations[1]),observationId:opt.idFactory(),disposition,activityId};
    ledger.observations.push(observation);ledger.imports[0].observationIds.push(observation.observationId);
  }
  recount(ledger);
  const snapshot=structuredClone(ledger),view=getEffectiveActivities(ledger);
  assert.deepEqual(view.map(a=>a.activityId),ledger.activities.map(a=>a.activityId));
  assert.deepEqual(view.map(a=>a.active),[false,true,true,false]);
  assert.deepEqual(view,ledger.activities.map((a,i)=>({...a,active:[false,true,true,false][i]})));
  assert.deepEqual(ledger,snapshot);
  // Indexes must not survive an operation or become part of the persisted graph.
  ledger.observations[0].disposition='created';recount(ledger);
  assert.equal(getEffectiveActivities(ledger)[0].active,true);
  assert.equal(validateLedger(JSON.parse(JSON.stringify(ledger))),true);
});

test('keep-separate, reversal and later match preserve retained history and activity support',()=>{
  let {ledger,opt,accountId}=setup(1);
  ledger=prepareCanonicalImport(ledger,input(accountId,[row(),row(0,{rowOrdinal:2})],'invented-overlap'),opt).ledger;
  const [first,second]=ledger.observations.slice(1);
  ledger=applyReviewDecision(ledger,{observationId:first.observationId,action:'keep-separate'},opt);
  ledger=applyReviewDecision(ledger,{observationId:second.observationId,action:'match',activityId:ledger.activities[0].activityId},opt);
  const retained=structuredClone(ledger.activities[1]),decision=structuredClone(ledger.reviewDecisions[0]);
  assert.deepEqual(getEffectiveActivities(ledger).map(a=>a.active),[true,true]);
  ledger=reverseReviewDecision(ledger,{reviewDecisionId:decision.reviewDecisionId},opt);
  assert.deepEqual(getEffectiveActivities(ledger).map(a=>a.active),[true,false]);
  assert.deepEqual(ledger.activities[1],retained);assert.deepEqual(ledger.reviewDecisions[0],decision);
  assert.throws(()=>applyFinancialEvent(ledger,{type:'classification',activityId:retained.activityId,
    activityKind:'spending',commandId:'invented-inactive'},opt),/inactive-financial-target/);
  ledger=applyReviewDecision(ledger,{observationId:first.observationId,action:'match',activityId:ledger.activities[0].activityId},opt);
  assert.deepEqual(getEffectiveActivities(ledger).map(a=>a.active),[true,false]);
  assert.equal(ledger.imports.at(-1).counts.matched,2);
  assert.equal(ledger.imports.at(-1).status,'processed');
  assert.equal(validateLedger(JSON.parse(JSON.stringify(ledger))),true);
});

test('indexed validation preserves prospective boundaries, bank correction and refund category replay',()=>{
  // A same-description peer imported before the rule must retain its category.
  let {ledger,opt,accountId}=setup(2,[row(),row(0,{rowOrdinal:2,effectiveDate:'2026-01-16'})]);
  const purchaseId=ledger.activities[0].activityId;
  ledger=applyFinancialEvent(ledger,{type:'classification',activityId:purchaseId,activityKind:'spending',categoryId:'initial',commandId:'invented-classify'},opt);
  ledger=applyFinancialEvent(ledger,{type:'bank-correction',activityId:purchaseId,amountText:'-10.00',commandId:'invented-correction',evidence:{reason:'Invented correction'}},opt);
  ledger=applyFinancialEvent(ledger,{type:'category-correction',activityId:purchaseId,categoryId:'groceries',commandId:'invented-rule'},opt);
  ledger=prepareCanonicalImport(ledger,input(accountId,[row(0,{effectiveDate:'2026-01-20'}),row(2,{amountText:'2.00',postedDate:'2026-02-02'})],'invented-future'),opt).ledger;
  const refundId=ledger.activities.at(-1).activityId;
  ledger=applyFinancialEvent(ledger,{type:'refund-link',activityId:refundId,originalActivityId:purchaseId,commandId:'invented-refund',evidence:{reason:'Invented link'}},opt);
  let view=getEffectiveActivities(ledger);
  assert.deepEqual(view.map(a=>a.categoryId),['groceries',null,'groceries','groceries']);
  assert.equal(view[0].amountMinor,-1000);assert.equal(ledger.activities[0].amountMinor,-1234);
  ledger=applyFinancialEvent(ledger,{type:'category-correction',activityId:purchaseId,categoryId:'updated',commandId:'invented-rule-update'},opt);
  view=getEffectiveActivities(ledger);
  assert.deepEqual(view.map(a=>a.categoryId),['updated',null,'groceries','updated']);
  assert.equal(view[3].activityKind,'refund');assert.equal(view[3].postedDate,'2026-02-02');
  assert.deepEqual(getEffectiveActivities(JSON.parse(JSON.stringify(ledger))),view);
});

test('indexed graph checks reject missing, duplicate and malformed references before projection',async t=>{
  const {ledger,opt}=setup(2),missing=opt.idFactory();
  const cases=[
    ['missing collection',bad=>delete bad.accounts,'invalid-ledger-collection'],
    ['malformed record',bad=>bad.observations[0]=null,'invalid-or-duplicate-record-id'],
    ['malformed ID',bad=>bad.activities[0].activityId='not-a-uuid','invalid-or-duplicate-record-id'],
    ['duplicate ID',bad=>bad.activities[1].activityId=bad.activities[0].activityId,'invalid-or-duplicate-record-id'],
    ['cross-collection duplicate ID',bad=>bad.activities[0].activityId=bad.accounts[0].accountId,'invalid-or-duplicate-record-id'],
    ['missing activity account',bad=>bad.activities[0].accountId=missing,'unknown-account'],
    ['missing import account',bad=>bad.imports[0].accountId=missing,'unknown-account'],
    ['missing observation account',bad=>bad.observations[0].accountId=missing,'unknown-account'],
    ['malformed membership',bad=>bad.imports[0].observationIds=null,'invalid-import-observations'],
    ['duplicate membership',bad=>bad.imports[0].observationIds.push(bad.observations[0].observationId),'invalid-import-observations'],
    ['dangling membership',bad=>bad.imports[0].observationIds[0]=missing,'invalid-import-observations'],
    ['missing source import',bad=>bad.observations[0].importRunId=missing,'invalid-observation'],
    ['unlisted observation',bad=>{bad.imports[0].observationIds.shift();recount(bad);},'invalid-observation'],
    ['unknown activity',bad=>bad.observations[0].activityId=missing,'unknown-activity'],
    ['null created target',bad=>bad.observations[0].activityId=null,'invalid-observation-state'],
    ['unrecorded decision',bad=>bad.observations[0].resolved=true,'observation-resolution-without-decision'],
    ['changed evidence',bad=>bad.observations[0].sourceFields={...bad.observations[0].sourceFields,Amount:'-1.00'},'observation-evidence-mismatch'],
    ['wrong counts',bad=>{bad.imports[0].counts.created--;bad.imports[0].counts.matched++;},'import-counts-mismatch'],
    ['wrong status',bad=>bad.imports[0].status='needs-review','import-status-mismatch'],
    ['non-JSON value',bad=>bad.activities[0].extra=undefined,'non-json-ledger'],
  ];
  for(const [name,mutate,message] of cases) await t.test(name,()=>{
    const bad=structuredClone(ledger);mutate(bad);
    for(const operation of [validateLedger,getEffectiveActivities]) assert.throws(()=>operation(bad),{name:'TypeError',message});
  });
});

test('latest decision and earlier-only reversal references remain ordered and scoped',()=>{
  let {ledger,opt,accountId}=setup(1);
  ledger=prepareCanonicalImport(ledger,input(accountId,[row()],'invented-review'),opt).ledger;
  const observationId=ledger.observations.at(-1).observationId;
  ledger=applyReviewDecision(ledger,{observationId,action:'keep-separate'},opt);
  ledger=reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions[0].reviewDecisionId},opt);
  const reversed=structuredClone(ledger);
  ledger=applyReviewDecision(ledger,{observationId,action:'reject'},opt);
  assert.equal(validateLedger(ledger),true);
  const stale=structuredClone(ledger);
  stale.reviewDecisions.pop();
  assert.throws(()=>validateLedger(stale),/observation-resolution-without-decision/);
  for(const mutate of [
    bad=>bad.reviewDecisions.reverse(),
    bad=>bad.reviewDecisions[1].supersedesDecisionId=bad.reviewDecisions[1].reviewDecisionId,
    bad=>bad.reviewDecisions[1].supersedesDecisionId=opt.idFactory(),
    bad=>bad.reviewDecisions[0].observationId=bad.observations[0].observationId,
    bad=>bad.reviewDecisions.push({...bad.reviewDecisions[1],reviewDecisionId:opt.idFactory(),supersedesDecisionId:bad.reviewDecisions[1].reviewDecisionId}),
  ]) {
    const bad=structuredClone(reversed);mutate(bad);
    assert.throws(()=>validateLedger(bad),/invalid-review-reversal/);
  }
  const missing=structuredClone(reversed);missing.reviewDecisions[0].observationId=opt.idFactory();
  assert.throws(()=>validateLedger(missing),/invalid-review-decision/);
});

test('category membership and lifecycle source references still fail closed',()=>{
  let {ledger,opt,accountId}=setup(2,[row(0,{sourceRecordId:'invented-pending',lifecycleStatus:'pending'}),row(1)]);
  ledger=applyFinancialEvent(ledger,{type:'category-correction',activityId:ledger.activities[0].activityId,
    categoryId:'invented-category',commandId:'invented-rule-reference'},opt);
  for(const membership of [null,[opt.idFactory()],[ledger.activities[0].activityId,opt.idFactory()],[ledger.activities[0].activityId,ledger.activities[0].activityId],[ledger.activities[1].activityId]]) {
    const bad=structuredClone(ledger);bad.events[0].prospectiveRule.existingActivityIds=membership;
    assert.throws(()=>validateLedger(bad),/invalid-prospective-category-rule/);
  }
  ledger=prepareCanonicalImport(ledger,input(accountId,[row(0,{sourceRecordId:'invented-pending',postedDate:'2026-01-15'})],'invented-posted'),opt).ledger;
  assert.equal(ledger.events.at(-1).eventType,'lifecycle-transition');
  assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'posted');
  for(const sourceObservationId of [null,opt.idFactory(),ledger.observations[1].observationId]) {
    const bad=structuredClone(ledger);bad.events.at(-1).sourceObservationId=sourceObservationId;
    assert.throws(()=>validateLedger(bad),/invalid-lifecycle-event/);
  }
});

for(const stage of ['import','review']) {
  test(`${stage} refresh visits observations a bounded number of times as the run grows`,()=>{
    const measure=size=>{
      const records=Array.from({length:size},(_,i)=>row(i));
      if(stage==='review') records.at(-1).valid=false;
      const {ledger,opt,accountId}=setup(stage==='review'?size:0,stage==='review'?records:[]);
      const observationId=ledger.observations.at(-1)?.observationId;
      let visits=0;
      const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,'find'),find=descriptor.value;
      // Count private refresh lookups through public operations, including their
      // cloned/new observations. Restore the spy before leaving this measurement.
      Object.defineProperty(Array.prototype,'find',{...descriptor,value:function(predicate,thisArg) {
        const first=this[0];
        const observations=first && typeof first==='object' && Object.hasOwn(first,'observationId') && Object.hasOwn(first,'importRunId');
        return find.call(this,(value,index,array)=>{
          if(observations) visits++;
          return predicate.call(thisArg,value,index,array);
        });
      }});
      let next;
      try {
        next=stage==='import'
          ?prepareCanonicalImport(ledger,input(accountId,records,'invented-refresh'),opt).ledger
          :applyReviewDecision(ledger,{observationId,action:'reject'},opt);
      } finally { Object.defineProperty(Array.prototype,'find',descriptor); }
      const run=next.imports.at(-1);
      assert.equal(run.counts.rowsRecognized,size);
      assert.equal(run.counts.created,size-(stage==='review'?1:0));
      assert.equal(run.counts.rejected,stage==='review'?1:0);
      assert.equal(run.latestActivityDate,'2026-01-15');
      assert.equal(run.status,'processed');assert.equal(run.errorCode,null);
      return visits;
    };
    const small=measure(40),large=measure(80);
    assert.ok(large<=80*2,`observation searches visited ${large} records during ${stage}`);
    assert.ok(large<=small*2.25+16,`doubling the run grew ${stage} search visits from ${small} to ${large}`);
  });
}

test('fresh duplicate observation IDs still fail the final identity check during import',()=>{
  const {ledger,opt,accountId}=setup(0);
  const generated=[opt.idFactory(),opt.idFactory(),opt.idFactory(),opt.idFactory()];
  // The run and both activities are distinct. The two new observations collide.
  const generatedObservationId=generated.at(-1);
  const duplicateOptions={...opt,idFactory:()=>generated.shift()??generatedObservationId};
  assert.throws(()=>prepareCanonicalImport(ledger,input(accountId,[row(0),row(1)],'invented-duplicate'),duplicateOptions),
    {name:'TypeError',message:'invalid-or-duplicate-record-id'});
});
