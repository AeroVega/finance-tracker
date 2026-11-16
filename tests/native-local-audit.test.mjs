import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';
register(new URL('./helpers/local-audit-test-loader.mjs',import.meta.url));
const {setupHttpCanonicalWorkbench}=await import('./helpers/pr28-http-workbench.mjs');
const {replayFixture}=await import('./helpers/ledger-replay-fixtures.mjs');
const {applyFinancialEvent}=await import('../js/canonical-import.mjs');
const changed=(ledger,n)=>applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:`-${n+50}.00`,commandId:`invented-local-${n}`,evidence:{rationale:'Invented correction'}});
const close=async h=>{delete globalThis.__localAuditDisabled;delete globalThis.__localAuditEntered;delete globalThis.__localAuditPublished;delete globalThis.__localAuditGuards;h.http.beforeResponse=null;h.http.reboot();await h.lifecycle.release().catch(()=>{});};
for(const prior of [0,1,2])test(`local audit reduces observations only, retained saves=${prior}`,async t=>{
 const results=[];
 for(const disabled of [true,false]){const h=await setupHttpCanonicalWorkbench();try{
  let ledger=replayFixture(2).ledger;
  for(let i=0;i<prior;i++){await h.driver.save(ledger);ledger=changed(ledger,i);}
  globalThis.__localAuditDisabled=disabled;globalThis.__localAuditGuards=0;const start=h.http.requests.length;
  await h.driver.save(ledger);const rows=h.http.requests.slice(start);
  results.push({guards:globalThis.__localAuditGuards,list:rows.filter(r=>r.category==='list').length,patch:rows.filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length});
  assert.deepEqual(await h.driver.reopen(),ledger);
 }finally{await close(h);}}
 t.diagnostic(JSON.stringify({prior,control:results[0],local:results[1]}));
 assert.equal(results[0].patch,2);assert.equal(results[1].patch,2);
 assert.ok(results[1].guards<results[0].guards);assert.equal(results[0].list-results[1].list,results[0].guards-results[1].guards);
});
for(const mode of ['loss-resume','root-change','remote-owner','cancel','replacement','heartbeat'])test(`native audit ${mode} retains decisive checks`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),start=h.http.requests.length;let entered=false;try{
  globalThis.__localAuditEntered=async()=>{entered=true;
   if(mode==='loss-resume'){h.lifecycle.coordinator.cancelPending();await h.lifecycle.coordinator.resume();}
   if(mode==='heartbeat')await h.lifecycle.coordinator.heartbeat();
   if(mode==='cancel')h.lifecycle.engine.invalidateHistory();
   if(mode==='replacement'){const read=h.lifecycle.transactionAdapter.readBytes.bind(h.lifecycle.transactionAdapter);h.lifecycle.transactionAdapter.readBytes=(...args)=>read(...args);}
   if(mode==='remote-owner'){const f=[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerSession==='v1');assert.ok(f);const record=JSON.parse(new TextDecoder().decode(f.bytes));record.sessionId='invented-other-owner';f.bytes=new TextEncoder().encode(JSON.stringify(record));f.metadata.size=String(f.bytes.length);f.metadata.version=String(Number(f.metadata.version)+1);}
   if(mode==='root-change'){const f=h.http.files.get(h.manifestFileId),m=h.http.json(h.manifestFileId);m.root='0'.repeat(64);f.bytes=new TextEncoder().encode(JSON.stringify(m));f.metadata.size=String(f.bytes.length);f.metadata.version=String(Number(f.metadata.version)+1);}
  };
  if(mode==='heartbeat')await h.driver.save(replayFixture(2).ledger);else await assert.rejects(h.driver.save(replayFixture(2).ledger));
  assert.equal(entered,true);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,mode==='heartbeat'?2:0);
 }finally{await close(h);}
});
test('generic transport never enters native local audit',async()=>{
 const h=await setupHttpCanonicalWorkbench();try{
  const create=h.lifecycle.transactionAdapter.createImmutable.bind(h.lifecycle.transactionAdapter);h.lifecycle.transactionAdapter.createImmutable=(...args)=>create(...args);
  globalThis.__localAuditEntered=()=>assert.fail('generic operation entered local audit');await h.driver.save(replayFixture(1).ledger);
 }finally{await close(h);}
});
for(const mode of ['remote-owner','root-conflict','physical-phase','successor','receipt','index'])test(`refreshed published audit rejects ${mode} before final PATCH`,async()=>{
 const h=await setupHttpCanonicalWorkbench(),start=h.http.requests.length;let hit=false,successor=null;try{
  globalThis.__localAuditPublished=async()=>{
   hit=true;assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
   if(mode==='physical-phase')h.lifecycle.engine.physical.invalidateReadCache();
   else if(mode==='successor'){h.lifecycle.engine.invalidateHistory();successor=h.lifecycle.engine.readSnapshot().then(()=>null,error=>error);}
   else {
    let file,value;
    if(mode==='remote-owner'){file=[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerSession==='v1');value=JSON.parse(new TextDecoder().decode(file.bytes));value.sessionId='invented-next-owner';}
    if(mode==='root-conflict'){file=h.http.files.get(h.manifestFileId);value=h.http.json(h.manifestFileId);value.root='0'.repeat(64);}
    if(mode==='receipt')file=h.http.files.get(h.http.json(h.manifestFileId).pending.receipt.fileId);
    if(mode==='index'){const root=h.http.json(h.http.json(h.manifestFileId).locatorRoot.fileId);file=h.http.files.get(root.identities.fileId);}
    assert.ok(file);if(value)file.bytes=new TextEncoder().encode(JSON.stringify(value));else {file.bytes=file.bytes.slice();file.bytes[0]^=1;}
    file.metadata.size=String(file.bytes.length);file.metadata.version=String(Number(file.metadata.version)+1);
   }
  };
  await assert.rejects(h.driver.save(replayFixture(2).ledger));if(successor)assert.ok(await successor);assert.equal(hit,true);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update'&&r.fileId===h.manifestFileId).length,1);
  assert.equal(h.http.json(h.manifestFileId).pending.state,'published');
 }finally{await close(h);}
});
