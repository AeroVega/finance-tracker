import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createPhysicalDriveAdapter,getOwnedReceiptAuditRunner} from '../js/physical-drive-adapter.mjs';
import {PhysicalRootBinding} from '../js/physical-root-binding.mjs';
import {getEffectiveActivities} from '../js/canonical-import.mjs';

const bump=file=>{file.metadata.version=String(BigInt(file.metadata.version)+1n);file.metadata.size=String(file.bytes.length);};
async function setup(){
 const h=await setupHttpCanonicalWorkbench();await h.driver.save(replayFixture(1).ledger);
 const session=new CanonicalWorkspaceSession({storage:{lifecycle:h.lifecycle}});await session.loadVerified();
 const correct=i=>session.correct({activityId:getEffectiveActivities(session.ledger)[0].activityId,type:'category-correction',categoryId:'invented-audit-'+i,rationale:'Invented receipt fault test'});
 for(let i=0;i<3;i++){correct(i);await session.save();}
 const manifest=h.http.json(h.manifestFileId),receipts=[];let ref=manifest.receiptHead;
 while(ref){const receipt=h.http.json(ref.fileId);receipts.push({ref,receipt});ref=receipt.intent.baseManifest.receiptHead;}
 assert.equal(receipts.length,4);return {...h,session,correct,manifest,receipts};
}
const close=async h=>{h.http.beforeResponse=null;await h.lifecycle.release().catch(()=>{});};
const noNewWrites=(h,start)=>assert.equal(h.http.requests.slice(start).filter(r=>['create','update','generate-id'].includes(r.category)).length,0);
for(const kind of ['receipt','plan','body','index'])test('long native audit rejects corrupted intermediate '+kind,async()=>{
 const h=await setup();
 try{
  const middle=h.receipts[1],plan=h.http.json(middle.receipt.intent.planRoot.fileId);
  let id=middle.ref.fileId;
  if(kind==='plan')id=middle.receipt.intent.planRoot.fileId;
  if(kind==='body')id=plan.entries.find(e=>e.kind!=='commit-record'&&e.kind!=='protocol-object').fileId;
  if(kind==='index')id=middle.receipt.locatorRoot.fileId;
  const file=h.http.files.get(id);assert.ok(file);
  file.bytes=file.bytes.slice();file.bytes[0]^=1;bump(file);
  h.lifecycle.engine.physical.invalidateReadCache();const start=h.http.requests.length;
  await assert.rejects(h.lifecycle.engine.readSnapshot());noNewWrites(h,start);
 }finally{await close(h);}
});
for(const change of ['owner','root','control-flow'])test('full-fallback save cannot stage after '+change+' changes during intermediate receipt read',async()=>{
 const h=await setup();let forgedCalls=0;
 try{
  const middleId=h.receipts[1].ref.fileId;h.correct('pending');
  // Exercise the full-history fallback, not the approved reduced-save path.
  h.lifecycle.engine.invalidateHistory();
  let entered=false,after=-1;
  h.http.beforeResponse=async({category,fileId})=>{
   if(entered||category!=='media'||fileId!==middleId)return;
   entered=true;after=h.http.requests.length;
   if(change==='owner'){
    const file=[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerSession==='v1');
    const record=JSON.parse(new TextDecoder().decode(file.bytes));record.sessionId='invented-foreign-owner';
    file.bytes=new TextEncoder().encode(JSON.stringify(record));bump(file);
   }else if(change==='control-flow'){
    h.lifecycle.coordinator.assertCanWrite=async()=>{forgedCalls++;};
   }else{
    const file=h.http.files.get(h.manifestFileId),manifest=JSON.parse(new TextDecoder().decode(file.bytes));
    manifest.revision=String(BigInt(manifest.revision)+1n);
    file.bytes=new TextEncoder().encode(JSON.stringify(manifest));bump(file);
   }
  };
  h.lifecycle.engine.physical.invalidateReadCache();
  await assert.rejects(h.session.save());assert.equal(entered,true);noNewWrites(h,after);assert.equal(forgedCalls,0);
 }finally{if(change==='control-flow')delete h.lifecycle.coordinator.assertCanWrite;await close(h);}
});
for(const stop of ['invalidate','closing'])test('blocked read rejects without audit success after '+stop,async()=>{
 const h=await setup();
 try{
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  let blocked=false,settled=false;
  h.http.beforeResponse=async({category,fileId})=>{if(!blocked&&category==='media'&&fileId===h.receipts[1].ref.fileId){blocked=true;entered();await gate;}};
  let p=h.lifecycle.engine.physical,token,read;
  if(stop==='closing'){
   p=createPhysicalDriveAdapter(h.lifecycle.transactionAdapter,{manifestFileId:h.manifestFileId,assertWritable:h.lifecycle.engine.assertWritable});
   token=await p.beginVerification();
   const binding=new PhysicalRootBinding({adapter:p,assertWritable:h.lifecycle.engine.assertWritable,verificationPlans:h.lifecycle.verificationPlans});
   // Explicit physical close is a runner boundary test; the standalone
   // binding keeps generic operation-guard semantics.
   read=()=>getOwnedReceiptAuditRunner(p).run(p.captureVerificationLifetime(token),()=>binding.verifyBaseline());
  }else{p.invalidateReadCache();read=()=>h.lifecycle.engine.readSnapshot();}
  const start=h.http.requests.length;
  const pending=read().then(()=>{settled=true;return null;},e=>{settled=true;return e;});
  await started;
  let closing;
  if(stop==='invalidate')p.invalidateReadCache();
  else closing=p.closeVerification(token).then(()=>null,e=>e);
  await new Promise(r=>setImmediate(r));assert.equal(settled,false,'blocked read remains unsettled before its response arrives');
  release();assert.ok(await pending);if(closing)await closing;
  noNewWrites(h,start);
 }finally{await close(h);}
});
