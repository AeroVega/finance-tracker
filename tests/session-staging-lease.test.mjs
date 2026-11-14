import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionCoordinator} from '../js/session-coordination.mjs';
async function fixture(){
  let record=null,now=10000,reads=0;
  const adapter={read:async()=>{reads++;return structuredClone(record);},write:async r=>{record=structuredClone(r);}};
  const c=new SessionCoordinator({adapter,now:()=>now,createSessionId:()=> 'invented-owner',staleAfterMs:2000});
  await c.start();
  return {c,reads:()=>reads,advance:()=>{now+=2001;},takeover:()=>{record.sessionId='invented-other';}};
}
test('local staging is available only inside an already admitted live write',async()=>{
  const f=await fixture();assert.throws(()=>f.c.assertCanStage(),{code:'not-owner'});
  await f.c.withWrite(async()=>{const before=f.reads();for(let i=0;i<50;i++)f.c.assertCanStage();assert.equal(f.reads(),before);});
  assert.throws(()=>f.c.assertCanStage(),{code:'not-owner'});
});
test('lease expiry and offline invalidate staging immediately',async()=>{
  for(const mode of ['expiry','offline']){
    const f=await fixture();await f.c.withWrite(async()=>{
      if(mode==='expiry')f.advance();
      assert.throws(()=>f.c.assertCanStage({online:mode!=='offline'}),{code:mode==='expiry'?'stale-session':'offline'});
      assert.equal(f.c.canWrite,false);
    });
  }
});
test('external takeover may leave immutable staging but fresh publication guard refuses it',async()=>{
  const f=await fixture();await f.c.withWrite(async()=>{
    f.takeover();f.c.assertCanStage();
    await assert.rejects(f.c.assertCanWrite(),{code:'ownership-lost'});
    assert.throws(()=>f.c.assertCanStage(),{code:'not-owner'});
  });
});
test('queued write cannot stage before its remote admission completes',async()=>{
  const f=await fixture(),read=f.c.adapter.read;let release;
  f.c.adapter.read=async()=>{await new Promise(resolve=>release=resolve);return read();};
  const write=f.c.withWrite(async()=>f.c.assertCanStage());
  await new Promise(resolve=>setImmediate(resolve));
  assert.throws(()=>f.c.assertCanStage(),{code:'not-owner'});
  release();await write;
});
