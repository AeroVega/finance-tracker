import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {applyFinancialEvent,validateLedger,getEffectiveActivities,prepareCanonicalImport,summarizeLedger} from '../js/canonical-import.mjs';
import {replayFixture,replayRow,replayInput} from './helpers/ledger-replay-fixtures.mjs';

// Independent reference to the pre-index replay. Keep its intentionally slow
// scan/recursion so differential tests cannot accidentally share the new logic.
function reference(ledger,activity,visited=new Set()) {
  if(visited.has(activity.activityId)) throw new TypeError('cyclic-refund-link');
  const ancestry=new Set(visited);ancestry.add(activity.activityId);
  const result=structuredClone(activity),key=a=>({accountId:a.accountId,institutionId:a.institutionId,currency:a.currency,
    normalizedDescription:a.normalizedDescription??a.sourceDescription,sourceAction:a.sourceAction});
  for(const e of ledger.events) {
    if(e.eventType==='category-correction'&&e.prospectiveRule?.enabled&&!e.prospectiveRule.existingActivityIds.includes(activity.activityId)&&canonicalizeJcs(e.prospectiveRule.key)===canonicalizeJcs(key(activity))) result.categoryId=e.categoryId;
    if(e.activityId!==activity.activityId) continue;
    if(e.eventType==='bank-correction')Object.assign(result,e.proposedValues);
    if(e.eventType==='category-correction')result.categoryId=e.categoryId;
    if(e.eventType==='classification'){result.activityKind=e.activityKind;if(e.categoryId!==null)result.categoryId=e.categoryId;}
    if(e.eventType==='refund-link') {
      result.activityKind='refund';result.originalActivityId=e.originalActivityId;
      result.categoryId=reference(ledger,ledger.activities.find(a=>a.activityId===e.originalActivityId),ancestry).categoryId;
      if(e.confirmedPostedDate)result.postedDate=e.confirmedPostedDate;
    }
    if(e.eventType==='lifecycle-transition'){result.lifecycleStatus=e.to;result.effectiveDate=e.effectiveDate;result.postedDate=e.postedDate;result.settlementDate=e.settlementDate;}
    if(e.eventType==='posting-status-correction'){result.lifecycleStatus=e.proposedValues.lifecycleStatus;result.postedDate=e.proposedValues.postedDate;}
  }
  return result;
}
const referenceView=ledger=>ledger.activities.map(activity=>({...reference(ledger,activity),active:ledger.observations.some(o=>o.activityId===activity.activityId&&['created','matched'].includes(o.disposition))}));
const assertView=ledger=>{assert.deepEqual(getEffectiveActivities(ledger),referenceView(ledger));assert.equal(validateLedger(ledger),true);};

test('chronological projection matches scan replay through mixed prospective and refund history',()=>{
  let {ledger,options}=replayFixture(3,[replayRow(0),replayRow(1,{amountText:'2.00',postedDate:'2026-02-02'}),replayRow(2)]);
  const [purchase,refund,other]=ledger.activities.map(a=>a.activityId);
  let command=0;
  const apply=change=>{const before=structuredClone(ledger);ledger=applyFinancialEvent(ledger,{commandId:`invented-mixed-${++command}`,...change},options);assert.deepEqual(ledger.events.slice(0,-1),before.events);assertView(ledger);};
  apply({type:'classification',activityId:purchase,activityKind:'spending',categoryId:'initial'});
  apply({type:'refund-link',activityId:refund,originalActivityId:purchase,evidence:{reason:'Invented partial refund'}});
  apply({type:'posting-status-correction',activityId:refund,lifecycleStatus:'pending',postedDate:null,evidence:{rationale:'Invented pending refund'}});
  apply({type:'posting-status-correction',activityId:refund,lifecycleStatus:'posted',postedDate:'2026-02-03',evidence:{rationale:'Invented posted refund'}});
  apply({type:'category-correction',activityId:purchase,categoryId:'purchase-new'});
  apply({type:'classification',activityId:refund,activityKind:'refund',categoryId:null});
  apply({type:'category-correction',activityId:purchase,categoryId:'purchase-later'});
  apply({type:'classification',activityId:refund,activityKind:'refund',categoryId:'explicit-refund'});
  apply({type:'bank-correction',activityId:purchase,amountText:'-9007199254740993.01',evidence:{reason:'Invented exact decimal'}});
  apply({type:'category-correction',activityId:purchase,categoryId:'prospective'});
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0,{effectiveDate:'2026-01-01'})],'invented-backdated'),options).ledger;
  assertView(ledger);assert.equal(getEffectiveActivities(ledger).at(-1).categoryId,'prospective');
  for(let i=0;i<120;i++) {
    const activityId=i%3===0?purchase:i%3===1?refund:other;
    if(i%4===0)apply({type:'category-correction',activityId,categoryId:`invented-${i%7}`});
    else apply({type:'classification',activityId,activityKind:activityId===refund?'refund':'spending',categoryId:i%5===0?null:`invented-${i%11}`});
  }
  assertView(JSON.parse(canonicalizeJcs(ledger)));
  const snapshot=structuredClone(ledger),view=getEffectiveActivities(ledger);view[0].sourceFields.Description='mutated output';view[0].amountDecimal='0';
  assert.deepEqual(ledger,snapshot);
  ledger.events.at(-1).categoryId='changed-between-calls';assertView(ledger);
});

test('prefix prior values remain mandatory even when later events restore the final value',()=>{
  let {ledger,options}=replayFixture();const activityId=ledger.activities[0].activityId;
  for(let i=0;i<8;i++)ledger=applyFinancialEvent(ledger,{type:'classification',activityId,activityKind:'spending',categoryId:`category-${i}`,commandId:`invented-prefix-${i}`},options);
  for(const field of ['priorCategoryId','priorActivityKind'])for(const index of [0,3,7]) {
    const bad=structuredClone(ledger);bad.events[index][field]='incorrect';
    assert.throws(()=>validateLedger(bad),/classification-history-mismatch/);
  }
  const reordered=structuredClone(ledger);[reordered.events[2],reordered.events[3]]=[reordered.events[3],reordered.events[2]];
  assert.throws(()=>validateLedger(reordered),/classification-history-mismatch/);
  const missing=structuredClone(ledger);delete missing.activities[0].categoryId;missing.events=[];
  assert.deepEqual(getEffectiveActivities(missing),referenceView(missing));
});

test('overridden category references still reject a cycle in retained refund links',()=>{
  let {ledger,options}=replayFixture(2,[replayRow(0),replayRow(1,{amountText:'2.00',postedDate:'2026-02-02'})]);
  const [purchase,refund]=ledger.activities.map(a=>a.activityId);
  ledger=applyFinancialEvent(ledger,{type:'classification',activityId:purchase,activityKind:'spending',categoryId:'purchase',commandId:'invented-cycle-classify'},options);
  ledger=applyFinancialEvent(ledger,{type:'refund-link',activityId:refund,originalActivityId:purchase,evidence:{reason:'Invented link'},commandId:'invented-cycle-link'},options);
  ledger=applyFinancialEvent(ledger,{type:'category-correction',activityId:refund,categoryId:'overridden',commandId:'invented-cycle-override'},options);
  ledger.events.push({...ledger.events[1],eventId:options.idFactory(),activityId:purchase,originalActivityId:refund,commandId:'invented-cycle-return'});
  assert.throws(()=>validateLedger(ledger),/cyclic-refund-link|invalid-effective-refund/);
});

for(const operation of [validateLedger,getEffectiveActivities,ledger=>summarizeLedger(ledger,{start:'2026-01-01',end:'2026-12-31',currency:'USD'})]) {
  test(`event visits grow linearly for ${operation.name||'summary'} with one hot activity`,()=>{
    const measure=size=>{
      const {ledger,options}=replayFixture();
      for(let i=0;i<size;i++)ledger.events.push({eventId:options.idFactory(),commandId:`invented-count-${i}`,eventType:'classification',activityId:ledger.activities[0].activityId,
        recordedAt:options.now(),appendOnly:true,activityKind:'spending',categoryId:'same',priorActivityKind:i===0?'unclassified':'spending',priorCategoryId:i===0?null:'same'});
      let reads=0;for(const event of ledger.events)Object.defineProperty(event,'eventType',{enumerable:true,get(){reads++;return 'classification';}});
      operation(ledger);return reads;
    };
    const small=measure(200),large=measure(400);
    assert.ok(large<=small*2.1,`event reads grew from ${small} to ${large}`);
    assert.ok(large<=400*16,`event replay read event types ${large} times`);
  });
}
