import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

for (const interrupted of [false,true]) test(`bounded immutable staging ${interrupted?'drains interrupted siblings without publication':'overlaps writes and reopens exactly'}`,async()=>{
  const h=await setupHttpCanonicalWorkbench();
  const ledger=replayFixture(10).ledger;
  const before=h.http.json(h.manifestFileId);
  let inFlight=0,peak=0,issued=0,failed=false;
  h.http.beforeResponse=async({category})=>{
    if(category==='update') assert.equal(inFlight,0,'authority cannot publish with immutable writes pending');
    if(category!=='create')return;
    ++issued;inFlight++;peak=Math.max(peak,inFlight);
    const rejectThis=interrupted&&!failed&&inFlight>=2;
    if(rejectThis)failed=true;
    try {
      await delay(30);
      if(rejectThis){throw Object.assign(new Error('Invented definitive rejection'),{code:'drive-request-failed',details:{status:400}});}
    } finally {inFlight--;}
  };
  h.http.phase='bounded-stage';
  if(interrupted){
    await assert.rejects(h.driver.save(ledger));
    assert.ok(failed);assert.ok(peak>1);assert.equal(inFlight,0);
    assert.deepEqual(h.http.json(h.manifestFileId),before,'old authoritative root remains');
    const count=h.http.requests.length;await delay(80);assert.equal(h.http.requests.length,count,'no orphaned asynchronous stage work');
  }else{
    await h.driver.save(ledger);
    assert.deepEqual(await h.driver.reopen(),ledger);
    assert.ok(peak>1,`expected overlapping immutable writes, got ${peak}`);
  }
  assert.ok(peak<=4,`bounded immutable create concurrency: ${peak}`);
  h.http.beforeResponse=null;
  if(!interrupted)await h.driver.release();
});

test('offline invalidation drains overlapping stage writes and blocks publication',async()=>{
  const h=await setupHttpCanonicalWorkbench(),before=h.http.json(h.manifestFileId);
  let pending=0,invalidated=false;
  h.http.beforeResponse=async({category})=>{
    if(category!=='create')return;
    pending++;
    try {
      if(pending>=2&&!invalidated){invalidated=true;await h.lifecycle.handleOffline();}
      await delay(30);
    }finally{pending--;}
  };
  await assert.rejects(h.driver.save(replayFixture(10).ledger));
  assert.equal(invalidated,true);assert.equal(pending,0);
  assert.deepEqual(h.http.json(h.manifestFileId),before);
  const count=h.http.requests.length;await delay(80);assert.equal(h.http.requests.length,count);
  assert.equal(h.lifecycle.acceptingWrites,false);
});

test('a fixed ID occupied after the absence check cannot publish different bytes',async()=>{
  const h=await setupHttpCanonicalWorkbench(),before=h.http.json(h.manifestFileId),respond=h.http.respond.bind(h.http);
  let collided=false;
  h.http.respond=async(target,options,category,id,row)=>{
    if(category==='create'&&!collided){
      const {metadata,bytes}=await h.http.multipart(options);
      if(metadata.appProperties.financeTrackerKind==='snapshot-object'){
        collided=true;const wrong=bytes.slice();wrong[0]^=1;
        h.http.files.set(metadata.id,{metadata:{...metadata,trashed:false,version:'1',size:String(wrong.length)},bytes:wrong});
      }
    }
    return respond(target,options,category,id,row);
  };
  await assert.rejects(h.driver.save(replayFixture(10).ledger));
  assert.equal(collided,true);assert.deepEqual(h.http.json(h.manifestFileId),before);
});
