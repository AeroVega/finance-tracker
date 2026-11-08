import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFinancialEvent,applyFinancialEvents,getEffectiveActivities,validateLedger,summarizeLedger} from '../js/canonical-import.mjs';
import {replayFixture,replayRow} from './helpers/ledger-replay-fixtures.mjs';
const options=()=>{let ids=0,ticks=0;return {idFactory:()=>`c0de0002-0000-4000-8000-${String(++ids).padStart(12,'0')}`,
  now:()=>new Date(Date.UTC(2026,10,8,0,0,ticks++)).toISOString()};};
const sequential=(ledger,commands,opt)=>commands.reduce((current,command)=>applyFinancialEvent(current,command,opt),ledger);
const totals=ledger=>summarizeLedger(ledger,{start:'2026-01-01',end:'2026-12-31',currency:'USD'});

function scenario() {
  const {ledger}=replayFixture(4,[replayRow(0,{amountText:'-9007199254740993.01'}),replayRow(1,{amountText:'2.00',postedDate:'2026-02-02'}),
    replayRow(2,{amountText:'3.00',postedDate:'2026-02-03'}),replayRow(3)]);
  const [purchase,refund,second,other]=ledger.activities.map(a=>a.activityId);
  let sequence=0;
  const commands=[{type:'classification',activityId:purchase,activityKind:'spending',categoryId:'purchase'},
    {type:'refund-link',activityId:refund,originalActivityId:purchase,evidence:{reason:'Invented partial refund'}},
    {type:'refund-link',activityId:second,originalActivityId:purchase,evidence:{reason:'Invented second partial refund'}},
    {type:'bank-correction',activityId:refund,amountText:'4.00',evidence:{reason:'Invented corrected refund'}},
    {type:'category-correction',activityId:purchase,categoryId:'follow-purchase'},
    {type:'classification',activityId:refund,activityKind:'refund',categoryId:null},
    {type:'category-correction',activityId:refund,categoryId:'explicit-refund'},
    {type:'bank-correction',activityId:purchase,amountText:'-20.00',evidence:{reason:'Invented purchase correction'}},
    ...Array.from({length:40},(_,i)=>({type:'classification',activityId:other,activityKind:'spending',categoryId:`invented-${i}`})),
  ].map(command=>({...command,commandId:`invented-batch-${++sequence}`}));
  return {ledger,commands,purchase,refund,second};
}

test('batch produces identical ordered immutable evidence, IDs, timestamps and financial output',()=>{
  const {ledger,commands}=scenario(),before=structuredClone(ledger);
  const separate=sequential(ledger,commands,options()),batch=applyFinancialEvents(ledger,commands,options());
  assert.deepEqual(batch,separate);assert.deepEqual(ledger,before);
  assert.deepEqual(getEffectiveActivities(batch),getEffectiveActivities(separate));assert.deepEqual(totals(batch),totals(separate));
  assert.equal(validateLedger(JSON.parse(JSON.stringify(batch))),true);
  batch.activities[0].sourceFields.Description='output-only';assert.deepEqual(ledger,before);
});

test('each intermediate refund constraint is checked even if later commands would repair it',()=>{
  const {ledger,commands,purchase,refund}=scenario();
  const accepted=applyFinancialEvents(ledger,commands,options()),before=structuredClone(accepted);
  const variants=[
    [{type:'bank-correction',activityId:purchase,amountText:'-1.00',evidence:true},{type:'bank-correction',activityId:purchase,amountText:'-20.00',evidence:true},'refund-exceeds-original'],
    [{type:'bank-correction',activityId:refund,amountText:'-1.00',evidence:true},{type:'bank-correction',activityId:refund,amountText:'4.00',evidence:true},'invalid-effective-refund'],
    [{type:'classification',activityId:purchase,activityKind:'transfer'},{type:'classification',activityId:purchase,activityKind:'spending'},'invalid-effective-refund'],
    [{type:'classification',activityId:refund,activityKind:'income'},{type:'classification',activityId:refund,activityKind:'refund'},'invalid-effective-refund'],
    [{type:'classification',activityId:purchase,activityKind:'spending',categoryId:0},{type:'classification',activityId:purchase,activityKind:'spending',categoryId:'fixed'},'invalid-classification'],
  ];
  for(const [first,second,message] of variants) {
    const list=[{...first,commandId:'invalid-first'},{...second,commandId:'repair-later'}];
    const opt={...options(),idFactory:()=> 'c0de0003-0000-4000-8000-000000000001'};
    assert.throws(()=>applyFinancialEvents(accepted,list,opt),{name:'TypeError',message});
    assert.throws(()=>sequential(accepted,list,opt),{name:'TypeError',message});
    assert.deepEqual(accepted,before);
  }
});

test('command retries within and across batches preserve idempotency and reject signature conflicts',()=>{
  const {ledger}=replayFixture(),command={type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',categoryId:'same',commandId:'repeat'};
  let calls=0;const opt={...options(),idFactory:()=>{calls++;return 'c0de0004-0000-4000-8000-000000000001';}};
  const result=applyFinancialEvents(ledger,[command,structuredClone(command)],opt);
  assert.equal(result.events.length,1);assert.equal(calls,1);
  assert.deepEqual(applyFinancialEvents(result,[command,command],opt),result);assert.equal(calls,1);
  assert.throws(()=>applyFinancialEvents(ledger,[command,{...command,categoryId:'different'}],options()),/event-command-conflict/);
  assert.throws(()=>applyFinancialEvents(ledger,[command],{...options(),idFactory:()=>ledger.observations[0].observationId}),/invalid-or-duplicate-record-id/);
  assert.throws(()=>applyFinancialEvents(ledger,null),/invalid-financial-commands/);
  assert.deepEqual(applyFinancialEvents(ledger,[]),ledger);
});

test('a batch clones the ledger once, rather than once per command',()=>{
  const {ledger,commands}=scenario(),clone=globalThis.structuredClone;let ledgerClones=0;
  globalThis.structuredClone=(value,...args)=>{if(value?.format==='finance-tracker-canonical-ledger')ledgerClones++;return clone(value,...args);};
  try {applyFinancialEvents(ledger,commands,options());}finally{globalThis.structuredClone=clone;}
  assert.equal(ledgerClones,1);
});

test('malformed generated event fails before later commands run',()=>{
  const {ledger}=replayFixture();delete ledger.activities[0].categoryId;
  const commands=[{type:'category-correction',activityId:ledger.activities[0].activityId,categoryId:'new',commandId:'invented-omitted-prior'},
    {type:'classification',activityId:'missing',activityKind:'spending',commandId:'invented-later-error'}];
  assert.equal(validateLedger(ledger),true);
  assert.throws(()=>applyFinancialEvents(ledger,commands,options()),{name:'TypeError',message:'non-json-ledger'});
});

test('structured legacy category prior values retain sequential clone identity checks',()=>{
  for(const categoryId of [{legacy:'category'},['legacy-category']]) {
    const {ledger}=replayFixture();ledger.activities[0].categoryId=categoryId;
    assert.equal(validateLedger(ledger),true);
    const commands=[{type:'category-correction',activityId:ledger.activities[0].activityId,categoryId:'new',commandId:'invented-structured-prior'},
      {type:'classification',activityId:'missing',activityKind:'spending',commandId:'invented-later-error'}];
    assert.throws(()=>applyFinancialEvents(ledger,commands,options()),{name:'TypeError',message:'invalid-category-correction'});
    ledger.events.push({eventId:options().idFactory(),commandId:'invented-shared-prior',eventType:'classification',
      activityId:ledger.activities[0].activityId,recordedAt:'2026-11-08T00:00:00Z',appendOnly:true,
      activityKind:'spending',categoryId:'new',priorActivityKind:'unclassified',priorCategoryId:categoryId});
    assert.throws(()=>validateLedger(ledger),{name:'TypeError',message:'classification-history-mismatch'});
  }
});

test('new category rules do not retain caller-owned structured match fields',()=>{
  for(const sourceAction of [{kind:{label:'invented'}},['invented',{label:'action'}]]) {
    const {ledger}=replayFixture();ledger.activities[0].sourceAction=sourceAction;
    const command={type:'category-correction',activityId:ledger.activities[0].activityId,categoryId:'new',commandId:'invented-source-alias'};
    const next=applyFinancialEvents(ledger,[command],options()),before=structuredClone(next);
    if(Array.isArray(sourceAction))sourceAction[1].label='changed input';else sourceAction.kind.label='changed input';
    assert.deepEqual(next,before);assert.equal(validateLedger(next),true);
    next.events[0].prospectiveRule.key.sourceAction.extra='changed output';
    assert.equal(Object.hasOwn(sourceAction,'extra'),false);
  }
});
