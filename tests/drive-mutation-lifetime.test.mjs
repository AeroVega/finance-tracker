import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
const enc=new TextEncoder();
async function fixture(){
 const drive=new HttpCatalogDrive(),bytes=enc.encode('{"invented":true}'),sha256=await partitionDigest(bytes);let generation=0,expired=0;
 const adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,
  visibilityDelayMs:0,visibilityMaxDelayMs:0,captureMutationGuard:()=>{const captured=generation;return ()=>{
   if(captured!==generation)throw Object.assign(new Error('Invented expired lifetime'),{code:'verification-scope-closed'});
  };},onExpiredMutation:()=>{expired++;}});
 drive.files.set('invented-manifest',{bytes:enc.encode('{}'),metadata:{id:'invented-manifest',name:'invented-manifest',parents:[drive.folderId],trashed:false,version:'1',size:'2',appProperties:{financeTrackerKind:'paged-canonical-manifest'}}});
 const create=()=>adapter.createImmutable({fileId:'invented-http-file-body',name:'invented-body',kind:'snapshot-object',transactionId:'invented-tx',content:bytes,expectedSha256:sha256,beforeMutation:async()=>{}});
 const publish=()=>adapter.publishManifest('invented-manifest',{revision:'1'},{beforeMutation:async()=>{}});
 return {drive,adapter,create,publish,invalidate:()=>{generation++;},get expired(){return expired;}};
}

for(const operation of ['create','publish'])test(`${operation} captures its origin before its first awaited preparation`,async()=>{
 const f=await fixture();let enter,resolve;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 if(operation==='create')f.adapter.crypto={subtle:{digest:async(...args)=>{enter();await gate;return crypto.subtle.digest(...args);}}};
 else {const read=f.adapter.readMetadata.bind(f.adapter);let first=true;f.adapter.readMetadata=async(...args)=>{const result=await read(...args);if(first){first=false;enter();await gate;}return result;};}
 const old=f[operation]();await entered;f.invalidate();resolve();await assert.rejects(old,{code:'verification-scope-closed'});
 assert.equal(f.drive.mutations,0);assert.equal(f.expired,0,'No issued write exists to report as uncertain.');
});

for(const operation of ['create','publish'])test(`${operation} expiry during final readback notification reports its issued outcome`,async()=>{
 const f=await fixture();let enter,resolve;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.adapter.afterMutation=async()=>{enter();await gate;};const old=f[operation]();await entered;assert.equal(f.drive.mutations,1);
 f.invalidate();resolve();await assert.rejects(old,{code:'verification-scope-closed'});assert.equal(f.expired,1);assert.equal(f.drive.mutations,1);
});

for(const method of ['POST','PATCH','DELETE'])test(`the common ${method} transport fence is pinned and synchronous after its async guard`,async()=>{
 const f=await fixture();let calls=0;f.adapter.fetch=async()=>{calls++;return new Response('{}');};
 f.adapter.captureMutationGuard=()=>()=>{};f.adapter.onExpiredMutation=()=>assert.fail('The public property cannot replace the installed callback.');
 await assert.rejects(f.adapter.request('https://www.googleapis.com/drive/v3/invented',{method},{beforeMutation:async()=>{queueMicrotask(f.invalidate);}}),{code:'verification-scope-closed'});
 assert.equal(calls,0);assert.equal(f.expired,0);
});

test('current transport failure cannot forge an expired-operation notification',async()=>{
 const f=await fixture();f.adapter.fetch=async()=>{throw Object.assign(new Error('Invented current provider failure'),{code:'verification-scope-closed'});};
 await assert.rejects(f.publish(),{code:'drive-network-error'});assert.equal(f.expired,0);
});

test('mutation operation handles cannot be forged, transferred, or replayed after closure',async()=>{
 const f=await fixture(),other=await fixture(),request=f.adapter.request.bind(f.adapter);let captured;
 f.adapter.request=(url,options,limits)=>{if(limits?.mutationScope)captured=limits.mutationScope;return request(url,options,limits);};
 await f.create();assert.ok(Object.isFrozen(captured));
 for(const [adapter,scope] of [[f.adapter,{}],[f.adapter,captured],[other.adapter,captured]]){
  const before=f.drive.requests.length+other.drive.requests.length;
  await assert.rejects(adapter.request('https://www.googleapis.com/drive/v3/invented',{method:'PATCH'},{mutationScope:scope}),{code:'invalid-guard'});
  assert.equal(f.drive.requests.length+other.drive.requests.length,before);
 }
});
