import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/incremental-save-test-loader.mjs',import.meta.url));
const {setupHttpCanonicalWorkbench}=await import('./helpers/pr28-http-workbench.mjs');
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent} from '../js/canonical-import.mjs';
const {isOwnedCanonicalPreparation}=await import('../js/canonical-paged-storage.mjs');
const changed=(ledger,n)=>applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:`-${n+70}.00`,commandId:`invented-incremental-${n}`,evidence:{rationale:'Invented correction'}});
const close=async h=>{delete globalThis.__incrementalRetaining;delete globalThis.__incrementalCaptured;delete globalThis.__incrementalPrepared;delete globalThis.__incrementalPublished;delete globalThis.__incrementalStructural;h.http.beforeResponse=null;h.http.reboot();await h.lifecycle.release().catch(()=>{});};
const mutate=file=>{file.bytes=file.bytes.slice();file.bytes[0]^=1;file.metadata.version=String(Number(file.metadata.version)+1);};
const fileForHash=(h,hash)=>[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerHash===hash);
async function seeded(){const h=await setupHttpCanonicalWorkbench();const genesis=h.http.json(h.manifestFileId).headCommit.sha256;let ledger=replayFixture(2).ledger;await h.driver.save(ledger);ledger=changed(ledger,1);await h.driver.save(ledger);ledger=changed(ledger,2);await h.driver.save(ledger);return {h,ledger,genesis};}

test('incremental native saves preserve complete financial reopen and two publications',async()=>{
 const h=await setupHttpCanonicalWorkbench();try{let ledger=replayFixture(2).ledger,lastSaved;
 for(let i=0;i<4;i++){const at=h.http.requests.length;await h.driver.save(ledger);lastSaved=ledger;assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,2);ledger=changed(ledger,i);}
 assert.deepEqual(await h.driver.reopen(),lastSaved);
 }finally{await close(h);}
});
test('historical-only commit corruption is deferred on save but full reopen rejects',async()=>{
 const {h,ledger,genesis}=await seeded();try{const historical=fileForHash(h,genesis);assert.ok(historical);mutate(historical);
 const next=changed(ledger,3);await h.driver.save(next);assert.equal(h.http.json(h.manifestFileId).pending,null);
 await assert.rejects(h.driver.reopen());
 }finally{await close(h);}
});
test('current shared dependency corruption still rejects before publication',async()=>{
 const {h,ledger}=await seeded();try{mutate(fileForHash(h,h.http.json(h.manifestFileId).root));const at=h.http.requests.length;
 await assert.rejects(h.driver.save(changed(ledger,3)));assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 }finally{await close(h);}
});
for(const index of ['objects','identities','files'])test(`current ${index} locator corruption cannot use historical deferral`,async()=>{
 const {h,ledger}=await seeded();try{const root=h.http.json(h.http.json(h.manifestFileId).locatorRoot.fileId);mutate(h.http.files.get(root[index].fileId));const at=h.http.requests.length;
 await assert.rejects(h.driver.save(changed(ledger,3)));assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 }finally{await close(h);}
});
test('recovery never trusts an incremental baseline after historical corruption',async()=>{
 const {h,genesis}=await seeded();try{mutate(fileForHash(h,genesis));await assert.rejects(h.lifecycle.engine.recover());}finally{await close(h);}
});
test('custom preparation functions cannot claim native preparation provenance',()=>{
 const fake=async()=>({});assert.equal(isOwnedCanonicalPreparation(fake),false);assert.equal(isOwnedCanonicalPreparation(new Proxy(fake,{})),false);assert.equal(isOwnedCanonicalPreparation(fake.bind(null)),false);
});

for(const boundary of ['open','save'])test(`reentrant invalidation during ${boundary} baseline retention cannot resurrect success`,async()=>{
 const h=await setupHttpCanonicalWorkbench();let retaining=false,hit=false;const online=h.lifecycle.isOnline;
 try{if(boundary==='save')await h.driver.save(replayFixture(2).ledger);
 globalThis.__incrementalRetaining=()=>{retaining=true;};
 h.lifecycle.isOnline=()=>{if(retaining&&!hit){hit=true;h.lifecycle.engine.invalidateHistory();}return true;};
 await assert.rejects(boundary==='open'?h.driver.reopen():h.driver.save(changed(replayFixture(2).ledger,7)));
 assert.equal(hit,true);
 }finally{h.lifecycle.isOnline=online;await close(h);}
});
test('transport replacement after incremental capture rejects instead of continuing structural-only',async()=>{
 const {h,ledger}=await seeded();let hit=false;const original=h.lifecycle.transactionAdapter.readMetadata;
 try{globalThis.__incrementalCaptured=()=>{if(hit)return;hit=true;h.lifecycle.transactionAdapter.readMetadata=(...args)=>original.apply(h.lifecycle.transactionAdapter,args);};
 const at=h.http.requests.length;await assert.rejects(h.driver.save(changed(ledger,4)));assert.equal(hit,true);
 assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 }finally{h.lifecycle.transactionAdapter.readMetadata=original;await close(h);}
});
test('custom preparation after native open cannot promote history proof for next save',async()=>{
 const h=await setupHttpCanonicalWorkbench(),original=h.lifecycle.savePartitionedRoot;let captured=0;
 try{
  globalThis.__incrementalCaptured=()=>{captured++;};
  h.lifecycle.savePartitionedRoot=function(input){const prepare=input.prepare;return original.call(this,{...input,prepare:(...args)=>prepare(...args)});};
  const ledger=replayFixture(2).ledger;await h.driver.save(ledger);assert.equal(captured,0);
  h.lifecycle.savePartitionedRoot=original;
  const next=changed(ledger,9);await h.driver.save(next);assert.equal(captured,0,'Next save must rebuild a full baseline after custom preparation');
  await h.driver.save(changed(next,10));assert.ok(captured>0,'Only completed native transition can promote again');
 }finally{h.lifecycle.savePartitionedRoot=original;await close(h);}
});

test('current base corruption after preparation may stage orphans but never publishes',async()=>{
 const {h,ledger}=await seeded();let hit=false,faultAt=null;try{
 const base=h.http.json(h.manifestFileId),at=h.http.requests.length;
 globalThis.__incrementalPrepared=()=>{hit=true;faultAt=h.http.requests.length;mutate(fileForHash(h,base.root));};
 await assert.rejects(h.driver.save(changed(ledger,20)));assert.equal(hit,true);
 const rows=h.http.requests.slice(at);assert.equal(rows.filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 assert.ok(h.http.requests.slice(faultAt).some(r=>r.category==='create'),'Delayed detection stages unreachable immutable evidence after the injected corruption');
 assert.equal(h.http.json(h.manifestFileId).root,base.root);
 }finally{await close(h);}
});
for(const fault of ['intent-parent','selected-root'])test(`changed ${fault} after preparation cannot publish`,async()=>{
 const {h,ledger}=await seeded();let hit=false;try{const at=h.http.requests.length;
 globalThis.__incrementalPrepared=intent=>{hit=true;if(fault==='intent-parent')intent.logicalCommit.previousRoot='0'.repeat(64);
 else {const f=h.http.files.get(h.manifestFileId),m=h.http.json(h.manifestFileId);m.root='0'.repeat(64);f.bytes=new TextEncoder().encode(JSON.stringify(m));f.metadata.size=String(f.bytes.length);f.metadata.version=String(Number(f.metadata.version)+1);}};
 await assert.rejects(h.driver.save(changed(ledger,21)));assert.equal(hit,true);
 assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 }finally{await close(h);}
});
test('postpublication corruption of retained current dependency refuses finalization',async()=>{
 const {h,ledger}=await seeded();let hit=false;try{const base=h.http.json(h.manifestFileId),at=h.http.requests.length;
 globalThis.__incrementalPublished=()=>{hit=true;mutate(fileForHash(h,base.root));};
 await assert.rejects(h.driver.save(changed(ledger,22)));assert.equal(hit,true);
 assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,1);
 assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
 }finally{await close(h);}
});
test('malformed financial transition is rejected at or before publication (early rejection allowed)',async()=>{
 const {h,ledger}=await seeded();try{const next=structuredClone(ledger);next.activities=[];const at=h.http.requests.length;
 await assert.rejects(h.driver.save(next));assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 }finally{await close(h);}
});

test('previous snapshot root used only by old edge is deferred until full reopen',async()=>{
 const {h,ledger}=await seeded();try{
 const manifest=h.http.json(h.manifestFileId),headFile=fileForHash(h,manifest.headCommit.sha256);
 const head=JSON.parse(new TextDecoder().decode(headFile.bytes));assert.notEqual(head.previousRoot,manifest.root);
 const historical=fileForHash(h,head.previousRoot);assert.ok(historical);mutate(historical);
 const at=h.http.requests.length;await h.driver.save(changed(ledger,30));
 assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,2);
 await assert.rejects(h.driver.reopen());
 }finally{await close(h);}
});


test('unknown publication retires baseline; recovery audits history and next save rebuilds proof',async()=>{
 const {h,ledger,genesis}=await seeded();let captured=0,patches=0;
 try{
  globalThis.__incrementalCaptured=()=>{captured++;};
  const next=changed(ledger,40);
  h.http.beforeResponse=({category,fileId})=>{if(category==='update'&&fileId===h.manifestFileId&&++patches===1)h.http.stopAfterMutation=h.http.mutations+1;};
  await assert.rejects(h.driver.save(next));assert.ok(captured>0);assert.equal(patches,1);
  h.http.beforeResponse=null;h.http.reboot();captured=0;
  const historical=fileForHash(h,genesis),bytes=historical.bytes.slice();mutate(historical);
  await assert.rejects(h.lifecycle.recoverBeforeUse());assert.equal(captured,0,'Recovery must never use the saved incremental certificate');
  historical.bytes=bytes;historical.metadata.version=String(Number(historical.metadata.version)+1);
  await h.lifecycle.recoverBeforeUse();assert.equal(captured,0);
  // Do not call reopen here: that would deliberately mint a fresh full-open certificate.
  await assert.rejects(h.driver.save(changed(next,41)),e=>e.code==='verified-base-required');assert.equal(captured,0,'Unknown outcome must not leave a reusable store baseline');
  assert.deepEqual(await h.driver.reopen(),next);assert.equal(captured,0,'Reopen must perform full audit');
  await h.driver.save(changed(next,42));assert.ok(captured>0,'Only a new full-open certificate can enable reduced save again');
 }finally{await close(h);}
});
test('same-session resume after observed loss cannot revive an incremental save baseline',async()=>{
 const {h,ledger}=await seeded();let captured=0,hit=false;
 try{
  globalThis.__incrementalCaptured=()=>{captured++;};
  globalThis.__incrementalPrepared=async()=>{hit=true;const sessionId=h.lifecycle.coordinator.session.sessionId;h.lifecycle.coordinator.cancelPending();await h.lifecycle.coordinator.resume();assert.equal(h.lifecycle.coordinator.session.sessionId,sessionId);};
  const at=h.http.requests.length;await assert.rejects(h.driver.save(changed(ledger,43)));
  assert.ok(hit&&captured>0);assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
  delete globalThis.__incrementalPrepared;captured=0;
  assert.equal(h.lifecycle.state,'recovery-required');await h.lifecycle.recoverBeforeUse();assert.equal(captured,0);
  const next=changed(ledger,44);await assert.rejects(h.driver.save(next),e=>e.code==='verified-base-required');assert.equal(captured,0,'Resuming must not revive the old baseline');
  assert.deepEqual(await h.driver.reopen(),ledger);assert.equal(captured,0);
  await h.driver.save(next);assert.ok(captured>0);assert.deepEqual(await h.driver.reopen(),next);
 }finally{await close(h);}
});
test('structural-only verification cannot satisfy a same-phase full-body memo',async()=>{
 const {h,ledger,genesis}=await seeded();let hit=false;
 try{
  const historical=fileForHash(h,genesis);mutate(historical);
  globalThis.__incrementalStructural=async(adapter,m,signal)=>{
   hit=true;
   const {createPagedPhysicalLocators}=await import('../js/paged-physical-locators.mjs');
   const full=createPagedPhysicalLocators(adapter,{databaseId:m.databaseId,copyId:m.copyId,folderId:m.storageBinding.folderId,assertWritable:async()=>{}});
   const at=h.http.requests.length;
   await assert.rejects(full.verify(m.locatorRoot,{signal}),e=>e.code==='hash-mismatch');
   assert.ok(h.http.requests.slice(at).some(r=>r.category==='media'&&r.fileId===historical.metadata.id),'Normal full verification must actually read the bad historical body');
   throw new Error('Oracle completed; stop the synthetic save');
  };
  const at=h.http.requests.length;await assert.rejects(h.driver.save(changed(ledger,45)),/Oracle completed/);assert.equal(hit,true);
  assert.equal(h.http.requests.slice(at).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
 }finally{await close(h);}
});

test('integrated incremental saves retain detached success diagnostics only after successful closure',async()=>{
 const {h,ledger}=await seeded();try{
  let captures=0;globalThis.__incrementalCaptured=()=>{captures++;};
  const window=h.lifecycle.requestMetrics.openWindow(),previous=h.lifecycle.engine.lastSuccessfulPublication;
  await h.driver.save(changed(ledger,7));assert.ok(captures>0,'actual incremental capability used');
  const observation=h.lifecycle.engine.lastSuccessfulPublication,rows=window.purposes();
  assert.equal(observation.path,'native');assert.equal(observation.reason,'none');assert.ok(observation.sequence>previous.sequence);
  assert.equal(window.manifestPatches(),2);assert.equal(rows.find(row=>row.purpose==='manifest-patch').count,2);
  assert.equal(rows.reduce((sum,row)=>sum+row.count,0),window.snapshot().requests);assert.equal(rows.find(row=>row.purpose==='unknown').count,0);
  observation.path='untrusted';assert.equal(h.lifecycle.engine.lastSuccessfulPublication.path,'native');window.close();
  const saved=h.lifecycle.engine.lastSuccessfulPublication;
  mutate(fileForHash(h,h.http.json(h.manifestFileId).root));await assert.rejects(h.driver.save(changed(ledger,8)));
  assert.deepEqual(h.lifecycle.engine.lastSuccessfulPublication,saved,'failed save cannot publish a diagnostic success');
 }finally{await close(h);}
});
