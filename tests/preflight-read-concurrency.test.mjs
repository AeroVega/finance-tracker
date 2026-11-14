import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

for(const mode of ['success','permission','offline','occupied'])test(`owned preflight reads are bounded and drained: ${mode}`,async()=>{
  const h=await setupHttpCanonicalWorkbench(),before=h.http.json(h.manifestFileId),seen=new Set(),planned=new Set();
  let active=0,peak=0,failed=false,staged=0;
  const refreshPlan=()=>{
    for(const file of h.http.files.values()) {
      if(file.metadata.appProperties?.financeTrackerKind!=='protocol-object')continue;
      const value=JSON.parse(new TextDecoder().decode(file.bytes));
      if(value.format==='finance-tracker-copy-object-plan')for(const e of value.entries)planned.add(e.fileId);
    }
  };
  h.http.beforeResponse=async({category,fileId})=>{
    refreshPlan();
    if(category==='update')assert.equal(active,0,'no authority publication with pending preflight reads');
    if(category!=='metadata'||!planned.has(fileId)||seen.has(fileId))return;
    seen.add(fileId);active++;peak=Math.max(peak,active);
    const reject=mode!=='success'&&!failed&&active===2;
    if(reject)failed=true;
    try {
      if(reject&&mode==='occupied') {
        const bytes=new Uint8Array([1]);
        h.http.files.set(fileId,{bytes,metadata:{id:fileId,name:fileId,parents:[h.http.folderId],trashed:false,version:'1',size:'1',
          appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:'0'.repeat(64),financeTrackerTransaction:'invented-collision'}}});
      }
      if(reject&&mode==='offline')await h.lifecycle.handleOffline();
      await delay(reject?1:20);
      if(reject&&mode==='permission')throw Object.assign(new Error('invented forbidden metadata'),{code:'drive-request-failed',details:{status:403}});
    }finally{active--;}
  };
  const respond=h.http.respond.bind(h.http);
  h.http.respond=async(target,options,category,id,row)=>{
    if(category==='create') {const {metadata}=await h.http.multipart(options);if(planned.has(metadata.id))staged++;}
    return respond(target,options,category,id,row);
  };
  const ledger=replayFixture(10).ledger;
  if(mode==='success') {
    await h.driver.save(ledger);assert.deepEqual(await h.driver.reopen(),ledger);
    assert.ok(seen.size>4);assert.equal(peak,4);
  } else {
    await assert.rejects(h.driver.save(ledger));assert.equal(failed,true);assert.equal(staged,0);
    assert.deepEqual(h.http.json(h.manifestFileId),before);
    assert.equal(seen.size,4,'no next batch after failure');
    const count=h.http.requests.length;await delay(50);assert.equal(h.http.requests.length,count);
  }
  assert.equal(active,0);assert.ok(peak<=4);h.http.beforeResponse=null;
  if(mode==='success')await h.driver.release();
});
