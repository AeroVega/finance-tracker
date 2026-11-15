import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/native-published-test-loader.mjs',import.meta.url));
const {setupHttpCanonicalWorkbench}=await import('./helpers/pr28-http-workbench.mjs');
const {replayFixture}=await import('./helpers/ledger-replay-fixtures.mjs');
const close=async h=>{delete globalThis.__publishedForceLegacy;h.http.beforeResponse=null;h.http.reboot();await h.lifecycle.release().catch(()=>{});};
for(const legacy of [false,true])test(`native publication sequence (legacy=${legacy}) preserves final ledger`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),states=[];try{
  globalThis.__publishedForceLegacy=legacy;
  const original=h.http.mutate.bind(h.http);
  h.http.mutate=()=>{original();states.push(h.http.json(h.manifestFileId).pending?.state??'clean');};
  const start=h.http.requests.length;await h.driver.save(replayFixture(2).ledger);
  const patches=h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId);
  assert.equal(patches.length,legacy?4:2);
  assert.deepEqual([...new Set(states)],legacy?['clean','admitted','ready','published']:['clean','published']);
  assert.equal(h.http.json(h.manifestFileId).pending,null);
  assert.deepEqual(await h.driver.reopen(),replayFixture(2).ledger);
 }finally{await close(h);}
});
for(const legacy of [false,true])for(const boundary of (legacy?[1,2,3]:[1,2]))test(`lost publication response recovers actual durable state legacy=${legacy} boundary=${boundary}`,async()=>{
 const h=await setupHttpCanonicalWorkbench();let patches=0;try{
  globalThis.__publishedForceLegacy=legacy;
  h.http.beforeResponse=({category,fileId})=>{if(category==='update'&&fileId===h.manifestFileId&&++patches===boundary)h.http.stopAfterMutation=h.http.mutations+1;};
  await assert.rejects(h.driver.save(replayFixture(1).ledger));
  assert.equal(patches,boundary);
  assert.equal(h.http.json(h.manifestFileId).pending?.state??'clean',legacy?['admitted','ready','published'][boundary-1]:['published','clean'][boundary-1]);
  delete globalThis.__publishedForceLegacy;h.http.beforeResponse=null;h.http.reboot();
  await h.lifecycle.recoverBeforeUse();
  assert.equal(h.http.json(h.manifestFileId).pending,null);
  assert.deepEqual(await h.driver.reopen(),replayFixture(1).ledger);
 }finally{await close(h);}
});
test('actual unchanged main recovers a directly published transaction without preparation', {skip:!process.env.FINANCE_BASELINE_REPO&&!process.env.FINANCE_EXTENDED_STORAGE_TESTS},async()=>{
 assert.ok(process.env.FINANCE_BASELINE_REPO,'Extended validation requires an explicit pinned baseline checkout');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const {fileURLToPath}=await import('node:url');
 const h=await setupHttpCanonicalWorkbench(),dir=await mkdtemp(join(tmpdir(),'invented-published-'));try{
  h.http.beforeResponse=({category,fileId})=>{if(category==='update'&&fileId===h.manifestFileId)h.http.stopAfterMutation=h.http.mutations+1;};
  await assert.rejects(h.driver.save(replayFixture(1).ledger));
  assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
  const input=join(dir,'invented.json');await writeFile(input,JSON.stringify({manifestFileId:h.manifestFileId,nextId:h.http.nextId,ledger:replayFixture(1).ledger,files:[...h.http.files].map(([id,f])=>[id,{metadata:f.metadata,bytes:[...f.bytes]}])}));
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./helpers/old-source-published-recovery.mjs',import.meta.url)),process.env.FINANCE_BASELINE_REPO,input]);
  assert.match(result.stdout,/old-source-recovery-ok/);
 }finally{await close(h);await rm(dir,{recursive:true,force:true});}
});
for(const target of ['receipt','plan','body'])test(`post-publication ${target} corruption keeps published quarantine`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),start=h.http.requests.length;let changed=false;try{
  const mutate=h.http.mutate.bind(h.http);
  h.http.mutate=()=>{mutate();const manifest=h.http.json(h.manifestFileId);if(changed||manifest.pending?.state!=='published')return;changed=true;
   const pending=manifest.pending;
   const id=target==='receipt'?pending.receipt.fileId:target==='plan'?pending.intent.planRoot.fileId:[...h.http.files].find(([,f])=>f.metadata.appProperties?.financeTrackerKind==='snapshot-object')?.[0];
   assert.ok(id,`${target} target`);const file=h.http.files.get(id);file.bytes=file.bytes.slice();file.bytes[0]^=1;file.metadata.version=String(Number(file.metadata.version)+1);
  };
  await assert.rejects(h.driver.save(replayFixture(1).ledger));assert.equal(changed,true);
  assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,1);
  await assert.rejects(h.lifecycle.recoverBeforeUse());
  assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
 }finally{await close(h);}
});
for(const when of ['before-publication','after-publication'])test(`ownership loss ${when} rejects without advancing further`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),start=h.http.requests.length;let triggered=false;try{
  h.http.beforeResponse=async({category})=>{const state=h.http.json(h.manifestFileId).pending?.state;
   if(triggered||(when==='before-publication'?category!=='create':state!=='published'))return;
   triggered=true;await h.lifecycle.handleOffline();
  };
  await assert.rejects(h.driver.save(replayFixture(1).ledger));assert.equal(triggered,true);
  assert.equal(h.http.json(h.manifestFileId).pending?.state??'clean',when==='before-publication'?'clean':'published');
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,when==='before-publication'?0:1);
 }finally{await close(h);}
});
test('mixed custom genesis retains four-publication callback path',async()=>{
 globalThis.__publishedMixedHistory=true;const h=await setupHttpCanonicalWorkbench();try{
  const start=h.http.requests.length;globalThis.__publishedCustomCalls=0;
  await h.driver.save(replayFixture(1).ledger);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,4);
  assert.ok(globalThis.__publishedCustomCalls>4);
  assert.deepEqual(await h.driver.reopen(),replayFixture(1).ledger);
 }finally{delete globalThis.__publishedMixedHistory;delete globalThis.__publishedCustomCalls;await close(h);}
});
for(const state of ['admitted','ready'])test(`captured epoch rejects loss and same-session resume in ${state}`,async()=>{
 globalThis.__publishedMixedHistory=true;const h=await setupHttpCanonicalWorkbench();let hit=false;try{
  globalThis.__publishedPendingHook=async observed=>{if(hit||observed!==state)return;hit=true;h.lifecycle.coordinator.cancelPending();await h.lifecycle.coordinator.resume();};
  const start=h.http.requests.length;await assert.rejects(h.driver.save(replayFixture(1).ledger));assert.equal(hit,true);
  assert.equal(h.http.json(h.manifestFileId).pending.state,state);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,state==='admitted'?1:2);
 }finally{delete globalThis.__publishedPendingHook;delete globalThis.__publishedMixedHistory;delete globalThis.__publishedCustomCalls;await close(h);}
});
for(const action of ['crash','conflict'])test(`durable receipt before first authority: ${action} cannot advance root`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),before=structuredClone(h.http.json(h.manifestFileId)),start=h.http.requests.length;let hit=false;try{
  const mutate=h.http.mutate.bind(h.http);
  h.http.mutate=()=>{mutate();if(hit)return;
   const receipt=[...h.http.files.values()].find(f=>{try{return JSON.parse(new TextDecoder().decode(f.bytes)).format==='finance-tracker-copy-root-receipt';}catch{return false;}});
   if(!receipt)return;hit=true;
   if(action==='crash'){h.http.stopped=true;h.http.check();}
   else {const file=h.http.files.get(h.manifestFileId),changed={...before,root:'0'.repeat(64)};file.bytes=new TextEncoder().encode(JSON.stringify(changed));file.metadata.size=String(file.bytes.length);file.metadata.version=String(Number(file.metadata.version)+1);}
  };
  await assert.rejects(h.driver.save(replayFixture(1).ledger));assert.equal(hit,true);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,0);
  assert.equal(h.http.json(h.manifestFileId).pending,null);
  if(action==='crash'){
   assert.deepEqual(h.http.json(h.manifestFileId),before);h.http.reboot();h.http.mutate=mutate;
   await h.lifecycle.recoverBeforeUse();assert.deepEqual(h.http.json(h.manifestFileId),before);assert.equal(await h.driver.reopen(),null);
  }
 }finally{await close(h);}
});
for(const target of ['catalog','objects','identities','files'])test(`published ${target} corruption cannot clear pending`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),start=h.http.requests.length;let hit=false;try{
  const mutate=h.http.mutate.bind(h.http);
  h.http.mutate=()=>{mutate();const m=h.http.json(h.manifestFileId);if(hit||m.pending?.state!=='published')return;hit=true;
   const catalog=h.http.files.get(m.locatorRoot.fileId),root=JSON.parse(new TextDecoder().decode(catalog.bytes));
   const file=target==='catalog'?catalog:h.http.files.get(root[target].fileId);assert.ok(file);
   file.bytes=file.bytes.slice();file.bytes[0]^=1;file.metadata.version=String(Number(file.metadata.version)+1);
  };
  await assert.rejects(h.driver.save(replayFixture(1).ledger));assert.equal(hit,true);
  assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,1);
  await assert.rejects(h.lifecycle.recoverBeforeUse());assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
 }finally{await close(h);}
});
for(const when of ['before','after'])test(`custom adapter installed ${when} native capture has explicit eligibility behavior`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),start=h.http.requests.length;let hit=false;try{
  const wrap=()=>{hit=true;const create=h.lifecycle.transactionAdapter.createImmutable.bind(h.lifecycle.transactionAdapter);h.lifecycle.transactionAdapter.createImmutable=(...args)=>create(...args);};
  if(when==='before')wrap();else globalThis.__publishedCapturedHook=wrap;
  if(when==='before'){await h.driver.save(replayFixture(1).ledger);assert.deepEqual(await h.driver.reopen(),replayFixture(1).ledger);}
  else await assert.rejects(h.driver.save(replayFixture(1).ledger));
  assert.equal(hit,true);assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,when==='before'?4:0);
 }finally{delete globalThis.__publishedCapturedHook;await close(h);}
});
