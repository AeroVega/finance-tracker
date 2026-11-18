import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
const manifestKind='finance-tracker-full-snapshot-manifest';
async function setup(){
 const http=new ScenarioFullSnapshotDrive({profile:'server-settling'}),state={online:true};
 const create=()=>new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null,isOnline:()=>state.online});
 const storage={lifecycle:null,async connect(){this.lifecycle=create();await this.lifecycle.start({initialize:true});},createLedgerStore(){return this.lifecycle.createLedgerStore();},async release(){const result=await this.lifecycle.release();this.lifecycle=null;return result;}};
 const session=new CanonicalWorkspaceSession({storage,online:()=>state.online});
 session.preview(replayFixture(1).ledger);await session.savePreviewToNewCopy();
 const base=structuredClone(session.ledger);
 session.correct({activityId:session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented-recovery',rationale:'Invented recovery case'});
 return {http,state,storage,session,create,base,draft:structuredClone(session.ledger)};
}
async function cleanup(h){h.state.online=true;h.http.rules=[];h.http.reboot();await h.storage.lifecycle?.recover().catch(()=>{});await h.storage.lifecycle?.release().catch(()=>{});}
const cases=[
 ['snapshot before',{category:'create',occurrence:1},'not-saved'],
 ['snapshot after',{category:'create',occurrence:1,after:true},'normal-saved'],
 ['commit before',{category:'create',occurrence:2},'not-saved'],
 ['commit after',{category:'create',occurrence:2,after:true},'normal-saved'],
 ['pending before',{category:'update',kind:manifestKind,occurrence:1},'unverifiable'],
 ['pending after',{category:'update',kind:manifestKind,occurrence:1,after:true},'saved'],
 ['final before',{category:'update',kind:manifestKind,occurrence:2},'saved'],
 ['final after',{category:'update',kind:manifestKind,occurrence:2,after:true},'saved'],
];
for(const [name,rule,outcome] of cases)test(`uncertain save reconciles ${name} without duplicate save`,async()=>{
 const h=await setup();try{
  h.http.phase='attempt';h.http.fault({...rule,effect:rule.after?'lost-response':'status',status:503});
  if(outcome==='saved'||outcome==='normal-saved')assert.deepEqual(await h.session.save(),h.draft);else await assert.rejects(h.session.save());
  assert.equal(h.http.rules[0].fired,true,'scheduled fault fired');
  assert.equal(h.session.recoveryOutcome,outcome==='normal-saved'?null:outcome);
  assert.deepEqual(h.session.ledger,h.draft,'logical draft never replaced with base');
  assert.equal(h.session.dirty,!['saved','normal-saved'].includes(outcome));
  const creates=h.http.requests.filter(r=>r.phase==='attempt'&&r.category==='create');
  assert.ok(creates.length<=2,'no automatic resubmission of candidate');
  if(outcome==='saved'||outcome==='normal-saved'){
   assert.equal(h.session.unverified,false);assert.equal(h.session.canEdit(),true);
   await h.session.release();h.storage.lifecycle=h.create();await h.storage.lifecycle.start({initialize:false});
   assert.deepEqual(await h.storage.lifecycle.load(),h.draft,'fresh session sees committed candidate');
  }else if(outcome==='not-saved'){
   const mutations=h.http.mutations;
   await assert.rejects(h.session.retryUncertainSave());assert.equal(h.http.mutations,mutations,'retry needs explicit confirmation');
   await h.session.retryUncertainSave({confirm:true});assert.equal(h.session.dirty,false);
   await h.session.reopen();assert.deepEqual(h.session.ledger,h.draft);
  }else{
   const mutations=h.http.mutations;
   await assert.rejects(h.session.retryUncertainSave({confirm:true}));assert.equal(h.http.mutations,mutations,'ambiguous dispatched publication cannot be retried');
  }
 }finally{await cleanup(h);}
});

test('offline during uncertain publication keeps draft unresolved and performs no recovery mutation',async()=>{
 const h=await setup();try{
  h.http.fault({category:'update',kind:manifestKind,after:true,effect:'lost-response'});
  const original=h.http.applyRules.bind(h.http);
  h.http.applyRules=async(...args)=>{try{return await original(...args);}catch(error){h.state.online=false;throw error;}};
  await assert.rejects(h.session.save());assert.equal(h.http.rules[0].fired,true);
  assert.equal(h.session.recoveryOutcome,'unverifiable');assert.deepEqual(h.session.ledger,h.draft);assert.equal(h.session.dirty,true);
  const writes=h.http.mutations;await h.session.resolveUncertainSave().catch(()=>{});assert.equal(h.http.mutations,writes);
  h.state.online=true;h.http.applyRules=original;
 }finally{await cleanup(h);}
});

test('normal successful save adds no recovery publication or reopen',async()=>{
 const h=await setup();try{
  let recovered=0;const original=h.storage.lifecycle.recover.bind(h.storage.lifecycle);h.storage.lifecycle.recover=async()=>{recovered++;return original();};
  h.http.phase='normal';await h.session.save();assert.equal(recovered,0);
  assert.equal(h.http.requests.filter(r=>r.phase==='normal'&&r.category==='update'&&r.kind===manifestKind).length,2);
  assert.equal(h.session.dirty,false);
 }finally{await cleanup(h);}
});

test('rejected PATCH may apply later: unchanged base never authorizes retry',async()=>{
 const h=await setup();try{
  const original=h.http.respond.bind(h.http);let delayed=null,fired=false;
  h.http.respond=async(...args)=>{
   if(!fired&&args[2]==='update'&&args[4].kind===manifestKind){fired=true;delayed=()=>original(...args);throw new TypeError('Invented lost response before delayed remote application');}
   return original(...args);
  };
  await assert.rejects(h.session.save());assert.equal(fired,true);assert.equal(h.session.recoveryOutcome,'unverifiable');
  assert.deepEqual(h.session.ledger,h.draft);
  const writes=h.http.mutations;
  await assert.rejects(h.session.retryUncertainSave({confirm:true}));assert.equal(h.http.mutations,writes);
  const reads=h.http.requests.length;
  for(const method of ['open','reopen','loadVerified','release'])await assert.rejects(h.session[method](),{code:'recovery-required'});
  assert.equal(h.http.requests.length,reads,'unknown publication cannot bypass reconciliation through reconnect/release');
  assert.equal(h.http.mutations,writes);assert.deepEqual(h.session.ledger,h.draft);
  await delayed();h.http.respond=original;
  const result=await h.session.resolveUncertainSave();assert.equal(result.outcome,'saved');
  assert.deepEqual(h.session.ledger,h.draft);assert.equal(h.session.dirty,false);
 }finally{await cleanup(h);}
});

for(const scenario of ['corrupt-authority','ownership-lost'])test(`automatic recovery fails closed on ${scenario}`,async()=>{
 const h=await setup();try{
  h.http.fault({category:'update',kind:manifestKind,after:true,effect:'lost-response'});
  const original=h.http.applyRules.bind(h.http);let triggered=false;
  h.http.applyRules=async(...args)=>{try{return await original(...args);}catch(error){
   if(!triggered){triggered=true;if(scenario==='ownership-lost')h.storage.lifecycle.coordinator.cancelPending();else h.http.fault({category:'media',kind:manifestKind,after:true,effect:'corrupt-media'});}
   throw error;
  }};
  await assert.rejects(h.session.save());assert.equal(triggered,true);assert.equal(h.http.rules[0].fired,true);
  if(scenario==='corrupt-authority')assert.equal(h.http.rules[1].fired,true,'recovery actually encountered corrupt bytes');
  assert.equal(h.session.recoveryOutcome,'unverifiable');assert.deepEqual(h.session.ledger,h.draft);assert.equal(h.session.dirty,true);
  const writes=h.http.mutations;await assert.rejects(h.session.retryUncertainSave({confirm:true}));assert.equal(h.http.mutations,writes);
 }finally{await cleanup(h);}
});

test('manual resolution is single-flight and rejects concurrent retry without writes',async()=>{
 const h=await setup();let unblock;try{
  h.http.fault({category:'update',kind:manifestKind,effect:'status',status:503});
  await assert.rejects(h.session.save());assert.equal(h.session.recoveryOutcome,'unverifiable');
  const original=h.storage.lifecycle.recover.bind(h.storage.lifecycle);let entered,invocations=0;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>unblock=resolve);
  h.storage.lifecycle.recover=async()=>{invocations++;entered();await gate;return original();};
  const resolving=h.session.resolveUncertainSave();await started;
  const writes=h.http.mutations;
  await assert.rejects(h.session.resolveUncertainSave(),{code:'operation-in-progress'});
  await assert.rejects(h.session.retryUncertainSave({confirm:true}),{code:'verified-retry-required'});
  assert.equal(invocations,1);assert.equal(h.http.mutations,writes);
  unblock();assert.equal((await resolving).outcome,'unverifiable');assert.deepEqual(h.session.ledger,h.draft);
 }finally{unblock?.();await cleanup(h);}
});

test('new workspace without attempted-save evidence never infers saved from matching data',async()=>{
 const h=await setup();try{
  await h.session.save();
  const fresh=new CanonicalWorkspaceSession({storage:h.storage,online:()=>true});
  await fresh.loadVerified();assert.deepEqual(fresh.ledger,h.draft);assert.equal(fresh.pendingSave,null);
  const writes=h.http.mutations;const result=await fresh.resolveUncertainSave();
  assert.equal(result.outcome,'unverifiable');assert.equal(h.http.mutations,writes);
  assert.equal(fresh.pendingSave,null);assert.deepEqual(fresh.ledger,h.draft);
 }finally{await cleanup(h);}
});
