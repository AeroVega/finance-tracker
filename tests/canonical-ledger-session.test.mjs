import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../js/canonical-import.mjs';
import {replayFixture,replayRow} from './helpers/ledger-replay-fixtures.mjs';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
const now='2026-11-08T00:00:00Z';
const id=n=>`cafe0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const open=ledger=>api.createLedgerSessionOwner().open(JSON.stringify(ledger),'invented-copy:base-1');
const entry=(command,n=1)=>({command,eventId:id(n),recordedAt:now});
const apply=(session,entries,revision=session.revision())=>session.applyBatchJson(JSON.stringify(entries),revision);
const category=(ledger,n=1)=>({type:'category-correction',activityId:ledger.activities[0].activityId,categoryId:'invented-'+n,commandId:'category-'+n});
const pure=(ledger,entries)=>{
  // IDs are allocated only for new commands, just like the public API.
  for(const e of entries)ledger=api.applyFinancialEvent(ledger,e.command,{now:e.recordedAt,idFactory:()=>e.eventId});
  return ledger;
};

test('owned snapshots are deeply immutable and projections are detached',()=>{
  const {ledger}=replayFixture(),session=open(ledger),snapshot=session.snapshot();
  ledger.activities[0].sourceFields.extra='caller mutation';
  assert.equal(snapshot.activities[0].sourceFields.extra,undefined);
  assert.throws(()=>{snapshot.activities[0].sourceFields.extra='no';},TypeError);
  const command=category(snapshot);apply(session,[entry(command)]);command.categoryId='caller mutation';
  assert.equal(snapshot.events.length,0);assert.equal(session.snapshot().events.length,1);
  assert.throws(()=>{session.snapshot().events[0].prospectiveRule.key.currency='XXX';},TypeError);
  const effective=session.effectiveActivity(snapshot.activities[0].activityId);
  effective.sourceFields.extra='detached';effective.categoryId='detached';
  assert.equal(session.effectiveActivity(snapshot.activities[0].activityId).categoryId,'invented-1');
  assert.equal(session.snapshot().activities[0].sourceFields.extra,undefined);
  assert.deepEqual(session.effectiveActivities(),api.getEffectiveActivities(session.snapshot()));
});

test('ordered batch matches pure commands and repeated commands consume no event identity',()=>{
  const {ledger}=replayFixture(),session=open(ledger),a=category(ledger),b=category(ledger,2);
  const entries=[entry(a),entry(a,99),entry(b,2)];apply(session,entries);
  assert.deepEqual(session.validatedSnapshot(),pure(ledger,entries));assert.equal(session.revision(),1);
  apply(session,[entry(a,44)]);assert.equal(session.revision(),1);
  assert.deepEqual(session.snapshot(),pure(ledger,entries));
});

for(const position of [0,1,2])test(`batch failure at position ${position} rolls back records and every index`,()=>{
  const {ledger}=replayFixture(),session=open(ledger),before=session.snapshot();
  const entries=[1,2,3].map(n=>entry(category(ledger,n),n));
  entries[position].command.categoryId=null;
  assert.throws(()=>apply(session,entries),/category-required/);
  assert.equal(session.snapshot(),before);assert.equal(session.revision(),0);
  const repaired=[1,2,3].map(n=>entry(category(ledger,n),n));apply(session,repaired);
  assert.deepEqual(session.validatedSnapshot(),pure(ledger,repaired));
});

test('revision rejects stale concurrent proposals and generation invalidates old handles',()=>{
  const {ledger}=replayFixture(),owner=api.createLedgerSessionOwner();
  const first=owner.open(JSON.stringify(ledger),'copy:base-1');
  apply(first,[entry(category(ledger))],0);
  assert.throws(()=>apply(first,[entry(category(ledger,2),2)],0),/stale-ledger-session-revision/);
  const second=owner.open(first.exportJson(),'copy:base-2');
  assert.equal(second.binding().generation,2);assert.equal(second.binding().storageBinding,'copy:base-2');
  assert.throws(()=>first.snapshot(),/ledger-session-closed/);
  owner.invalidate();owner.invalidate();
  for(const use of [()=>second.snapshot(),()=>second.exportJson(),()=>second.revision(),()=>second.binding(),()=>second.validatedSnapshot(),()=>second.effectiveActivities(),()=>second.effectiveActivity('x'),()=>second.summarizePeriodsJson('[]'),()=>apply(second,[],0)])assert.throws(use,/ledger-session-closed/);
  second.close();
});

test('failed replacement closes old session and input objects never execute getters',()=>{
  const {ledger}=replayFixture(),owner=api.createLedgerSessionOwner(),session=owner.open(JSON.stringify(ledger),'base');
  let invoked=false;const hostile={get toString(){invoked=true;throw Error('getter');}};
  assert.throws(()=>session.applyBatchJson(hostile,0),/session-json-required/);
  assert.throws(()=>session.effectiveActivity(hostile),/session-activity-id-required/);
  assert.throws(()=>session.summarizePeriodsJson(hostile),/session-json-required/);
  assert.throws(()=>owner.open(hostile,'base'),/session-json-and-storage-binding-required/);
  assert.equal(invoked,false);assert.throws(()=>session.snapshot(),/ledger-session-closed/);
});

test('failure to rebuild poisons session rather than retaining partially changed caches',()=>{
  const {ledger}=replayFixture(),session=open(ledger),OriginalMap=globalThis.Map;
  try {
    globalThis.Map=class {constructor(){throw Error('injected allocation failure');}};
    assert.throws(()=>apply(session,[entry({...category(ledger),categoryId:null})]),/category-required/);
  } finally {globalThis.Map=OriginalMap;}
  assert.throws(()=>session.snapshot(),/ledger-session-closed/);
});

test('reentrant command attempt cannot enter a preparation already in progress',()=>{
  const {ledger}=replayFixture(),session=open(ledger),originalFreeze=Object.freeze;
  let attempts=0;
  try {
    Object.freeze=value=>{
      if(value?.eventType){attempts++;assert.throws(()=>apply(session,[],0),/ledger-session-busy/);}
      return originalFreeze(value);
    };
    apply(session,[entry(category(ledger))]);
  } finally {Object.freeze=originalFreeze;}
  assert.equal(attempts,1);assert.equal(session.revision(),1);api.validateLedger(session.snapshot());
});

test('refund constraints precede JSON failure and rollback retains valid refund totals',()=>{
  let {ledger}=replayFixture(2,[replayRow(0,{amountText:'-10.00'}),replayRow(1,{amountText:'2.00'})]);
  const [purchase,refund]=ledger.activities;purchase.activityKind='spending';delete purchase.categoryId;delete refund.categoryId;
  ledger=pure(ledger,[entry({type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,evidence:true,commandId:'link'})]);
  const session=open(ledger),command={type:'classification',activityId:purchase.activityId,activityKind:'transfer',commandId:'bad'};
  assert.throws(()=>apply(session,[entry(command,2)]),/invalid-effective-refund/);
  assert.throws(()=>pure(ledger,[entry(command,2)]),/invalid-effective-refund/);
  assert.deepEqual(session.validatedSnapshot(),ledger);
});

test('seeded differential commands preserve accepted graphs and exact rejection errors',()=>{
  let seed=0x12345678;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/65536)%n;};
  let {ledger}=replayFixture(4,[-10,2,3,-20].map((n,i)=>replayRow(i,{amountText:String(n)})));
  const session=open(ledger);
  for(let i=1;i<=1000;i++) {
    const activityId=ledger.activities[rand(4)].activityId,type=['classification','category-correction','bank-correction','refund-link'][rand(4)];
    const command={type,activityId,commandId:'c'+rand(100),...({
      classification:()=>({activityKind:['spending','income','refund','transfer','unclassified','invalid'][rand(6)],categoryId:[null,'a','b',0,{},''][rand(6)]}),
      'category-correction':()=>({categoryId:[null,'a','b',0,{},''][rand(6)]}),
      'bank-correction':()=>({amountText:['-1','0','1','2','-100','1.0001','bad'][rand(7)],evidence:[true,null,{},'yes'][rand(4)]}),
      'refund-link':()=>({originalActivityId:ledger.activities[rand(4)].activityId,evidence:[true,null,{},'yes'][rand(4)]}),
    }[type]())};
    let expected,errorA,errorB;
    try {expected=pure(ledger,[entry(command,i)]);}catch(error){errorA=error.name+':'+error.message;}
    try {apply(session,[entry(command,i)]);}catch(error){errorB=error.name+':'+error.message;}
    assert.equal(errorB,errorA,JSON.stringify({i,command}));if(!errorA)ledger=expected;
    assert.deepEqual(session.validatedSnapshot(),ledger);
  }
});

test('dense ledger session reports and batch match pure API without leaking projected state',()=>{
  const {ledger,range}=denseLedgerFixture(1),session=open(ledger);
  const entries=[entry({type:'classification',activityId:ledger.activities[0].activityId,activityKind:'income',categoryId:'invented-new',commandId:'dense-session'})];
  apply(session,entries);const expected=pure(ledger,entries);
  assert.deepEqual(session.validatedSnapshot(),expected);
  assert.deepEqual(session.effectiveActivities(),api.getEffectiveActivities(expected));
  const reports=session.summarizePeriodsJson(JSON.stringify([range]));
  assert.deepEqual(reports,api.summarizeLedgerPeriods(expected,[range]));
  reports[0].reasons.push('mutated');assert.deepEqual(session.summarizePeriodsJson(JSON.stringify([range])),api.summarizeLedgerPeriods(expected,[range]));
});

test('late refund failure rolls back newly linked refund totals and command identities',()=>{
  let {ledger}=replayFixture(2,[replayRow(0,{amountText:'-10.00'}),replayRow(1,{amountText:'2.00'})]);
  const [purchase,refund]=ledger.activities;purchase.activityKind='spending';
  const session=open(ledger);
  const link=entry({type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,evidence:true,commandId:'link'},1);
  const invalid=entry({type:'bank-correction',activityId:purchase.activityId,amountText:'-1.00',evidence:true,commandId:'correct'},2);
  assert.throws(()=>apply(session,[link,invalid]),/refund-exceeds-original/);
  assert.deepEqual(session.snapshot(),ledger);
  const valid={...invalid,command:{...invalid.command,amountText:'-5.00'}};
  apply(session,[link,valid]);assert.deepEqual(session.validatedSnapshot(),pure(ledger,[link,valid]));
});

test('conflicting command and duplicate record identity roll back preceding batch events',()=>{
  const {ledger}=replayFixture(),session=open(ledger),a=entry(category(ledger),1),b=entry(category(ledger,2),2);
  assert.throws(()=>apply(session,[a,{...b,eventId:a.eventId}]),/invalid-or-duplicate-record-id/);
  assert.throws(()=>apply(session,[a,{...b,command:{...b.command,commandId:a.command.commandId}}]),/event-command-conflict/);
  assert.equal(session.revision(),0);apply(session,[a,b]);assert.deepEqual(session.snapshot(),pure(ledger,[a,b]));
});
