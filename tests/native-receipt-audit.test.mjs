import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {getEffectiveActivities} from '../js/canonical-import.mjs';
import {getNativeOwnershipCapability} from '../js/session-coordination.mjs';
import {PagedApplicationStorage} from '../js/paged-application-storage.mjs';
import {getOwnedReceiptAuditRunner,snapshotPhysicalAdapter} from '../js/physical-drive-adapter.mjs';

test('native receipt chains retain first/final authority observations without short-chain regression',async()=>{
 const h=await setupHttpCanonicalWorkbench();const counts=[];
 const original=h.http.respond.bind(h.http);let markerLists=0;
 h.http.respond=async(target,...args)=>{if(target.pathname==='/drive/v3/files'&&target.searchParams.get('q')?.includes('financeTrackerSession'))markerLists++;return original(target,...args);};
 const audit=async()=>{
  markerLists=0;await h.lifecycle.engine.readSnapshot();await h.lifecycle.engine.finishSnapshot();counts.push(markerLists);
 };
 await audit();
 await h.driver.save(replayFixture(1).ledger);
 const session=new CanonicalWorkspaceSession({storage:{lifecycle:h.lifecycle}});await session.loadVerified();
 assert.ok(getNativeOwnershipCapability(h.lifecycle.engine.assertWritable));
 assert.ok(getOwnedReceiptAuditRunner(h.lifecycle.engine.physical));
 await audit();
 for(let i=0;i<3;i++){
  const activity=getEffectiveActivities(session.ledger)[0];
  session.correct({activityId:activity.activityId,type:'category-correction',categoryId:'test-'+i,rationale:'Synthetic receipt audit'});
  await session.save();await audit();
 }
 // Baseline guard count rises for first/second receipts, then remains capped.
 assert.equal(counts[1],counts[0]+1);
 assert.equal(counts[2],counts[1]+1);
 assert.equal(counts[3],counts[2]);assert.equal(counts[4],counts[2]);
 const generic=new PagedApplicationStorage({adapter:h.lifecycle.transactionAdapter,manifestFileId:h.manifestFileId,
  verificationPlans:h.lifecycle.verificationPlans,assertWritable:async()=>h.lifecycle.coordinator.assertCanWrite({online:true})});
 markerLists=0;await generic.readSnapshot();await generic.finishSnapshot();
 assert.equal(markerLists,counts[4]+2,'custom guard retains all four receipt observations');
 const manifest=h.http.json(h.manifestFileId);
 const newest=h.http.json(manifest.receiptHead.fileId);
 const middleId=newest.intent.baseManifest.receiptHead.fileId;
 const marker=[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerSession==='v1');
 let changed=false;
 h.http.beforeResponse=async({category,fileId})=>{
  if(!changed&&category==='media'&&fileId===middleId){
   changed=true;const record=JSON.parse(new TextDecoder().decode(marker.bytes));record.sessionId='foreign-owner';
   marker.bytes=new TextEncoder().encode(JSON.stringify(record));marker.metadata.size=String(marker.bytes.length);
   marker.metadata.version=String(BigInt(marker.metadata.version)+1n);
  }
 };
 h.lifecycle.engine.physical.invalidateReadCache();const requestStart=h.http.requests.length;
 await assert.rejects(h.lifecycle.engine.readSnapshot());
 assert.equal(changed,true,'loss injected within retained receipt reads');
 assert.equal(h.http.requests.slice(requestStart).filter(r=>r.category==='create'||r.category==='update').length,0);
 await h.lifecycle.release().catch(()=>{});
});

test('owned read audit rejects changed transport control flow and cannot brand copied adapters',async()=>{
 const h=await setupHttpCanonicalWorkbench(),p=h.lifecycle.engine.physical;
 assert.equal(getOwnedReceiptAuditRunner({...p}),null);
 const runner=getOwnedReceiptAuditRunner(p),adapter=h.lifecycle.transactionAdapter;
 await h.lifecycle.engine.readSnapshot();
 const original=adapter.readMetadata,check=runner.capture();let forgedCalls=0;
 await assert.rejects(runner.run(()=>{},async()=>{
  adapter.readMetadata=()=>{forgedCalls++;return {};};
  check();
  await p.readMetadata(h.manifestFileId);
 }),{code:'verification-scope-closed'});
 delete adapter.readMetadata;assert.equal(adapter.readMetadata,original);assert.equal(forgedCalls,0);
 await h.lifecycle.engine.finishSnapshot().catch(()=>{});
 await h.lifecycle.release().catch(()=>{});
});
test('late old receipt audit cannot poison a successor physical scope',async()=>{
 const h=await setupHttpCanonicalWorkbench(),p=h.lifecycle.engine.physical,runner=getOwnedReceiptAuditRunner(p);
 await h.lifecycle.engine.readSnapshot();
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const pending=runner.run(()=>{},async()=>{entered();await gate;});
 await started;p.invalidateReadCache();
 const token=await p.beginVerification();
 await runner.run(()=>{},async()=>{await p.readMetadata(h.manifestFileId);});
 release();await assert.rejects(pending,{code:'verification-scope-closed'});
 await p.closeVerification(token);
 await h.lifecycle.release().catch(()=>{});
});
test('known loss then native same-session resume cannot revive a blocked audit',async()=>{
 const h=await setupHttpCanonicalWorkbench(),p=h.lifecycle.engine.physical,runner=getOwnedReceiptAuditRunner(p);
 await h.lifecycle.engine.readSnapshot();
 const check=getNativeOwnershipCapability(h.lifecycle.engine.assertWritable).capture();
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const pending=runner.run(check,async()=>{entered();await gate;await p.readMetadata(h.manifestFileId);});
 await started;h.http.stopped=true;
 assert.equal((await h.lifecycle.coordinator.inspect()).status,'unknown');
 h.http.stopped=false;await h.lifecycle.coordinator.resume();
 assert.equal(h.lifecycle.coordinator.canWrite,true);
 release();await assert.rejects(pending,{code:'verification-scope-closed'});
 await h.lifecycle.engine.finishSnapshot().catch(()=>{});
 await h.lifecycle.release().catch(()=>{});
});
test('native ownership lifetime binds the original application engine',async()=>{
 const h=await setupHttpCanonicalWorkbench(),engine=h.lifecycle.engine;
 const check=getNativeOwnershipCapability(engine.assertWritable).capture();
 h.lifecycle.engine={};assert.throws(check,{code:'verification-scope-closed'});
 h.lifecycle.engine=engine;assert.throws(check,{code:'verification-scope-closed'});
 await h.lifecycle.release();
});

test('owned snapshot cannot transfer capability through a forged function bind',async()=>{
 const h=await setupHttpCanonicalWorkbench(),p=h.lifecycle.engine.physical;let forged=0;
 const fn=p.readMetadata;
 fn.bind=()=>{forged++;return async()=>({});};
 try{
  const view=snapshotPhysicalAdapter(p);assert.ok(getOwnedReceiptAuditRunner(view));
  const metadata=await view.readMetadata(h.manifestFileId);
  assert.equal(metadata.id,h.manifestFileId);assert.equal(forged,0);
 }finally{delete fn.bind;await h.lifecycle.release();}
});
test('old audit phase cannot poison reads after same-scope publication',async()=>{
 const h=await setupHttpCanonicalWorkbench(),p=h.lifecycle.engine.physical,runner=getOwnedReceiptAuditRunner(p);
 await h.lifecycle.engine.readSnapshot();
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const pending=runner.run(()=>{},async()=>{entered();await gate;});
 await started;
 await p.writeManifest(h.http.files.get(h.manifestFileId).bytes.slice(),{beforeMutation:async()=>{}});
 await p.readMetadata(h.manifestFileId);
 await runner.run(()=>{},async()=>{await p.readMetadata(h.manifestFileId);});
 release();await assert.rejects(pending,{code:'verification-scope-closed'});
 await h.lifecycle.engine.finishSnapshot();
 await h.lifecycle.release();
});
