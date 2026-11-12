import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter,getOwnedLocatorDecoder,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from '../js/physical-drive-adapter.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
const enc=new TextEncoder();
const root={format:'finance-tracker-locator-catalog',version:3,databaseId:'invented-db',copyId:'invented-copy',generation:'0',previous:null,entryCount:'0',objects:null,identities:null,files:null};
const profile={schema:'root',version:3,databaseId:'invented-db',copyId:'invented-copy',index:null,maxNodeBytes:65536,maxEntries:128,maxChildren:128};

for(const action of ['metadata','bytes','manifest-metadata','manifest-bytes','opening','closure','publication-guard','proof','decode','decoder-only','locator-read','null-scope-body'])for(const outcome of ['success','failure'])
 test(`late ${action} ${outcome} cannot change successor evidence`,async()=>{
  const locatorBytes=enc.encode(canonicalizeJcs(root)),bytes=action==='locator-read'?locatorBytes:enc.encode('Invented physical lifetime body'),sha256=await partitionDigest(bytes);
  const query={bytes:locatorBytes,sha256:await partitionDigest(locatorBytes),profile};
  const data={id:'invented-body',name:'invented-body',version:'1',size:String(bytes.length),trashed:false,parents:['invented-folder'],
    appProperties:{financeTrackerKind:action==='locator-read'?'locator-catalog':'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:action==='locator-read'?'paged-locators':'invented-tx'}};
  const manifest={...structuredClone(data),id:'invented-manifest',name:PAGED_MANIFEST_NAME,appProperties:{financeTrackerKind:PAGED_MANIFEST_KIND}};
  let enter,resolve,enterDecode,resolveDecode,held=false,snapshots=0,locatorHashes=0;
  const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r),decodeEntered=new Promise(r=>enterDecode=r),decodeGate=new Promise(r=>resolveDecode=r);
  const hold=async value=>{held=true;enter();await gate;if(outcome==='failure')throw Object.assign(new Error('Invented expired provider failure'),{code:'drive-request-failed',details:{status:503}});return value;};
  const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>{
    snapshots++;const result=new Map([[data.id,structuredClone(data)],[manifest.id,structuredClone(manifest)]]);
    if(action==='metadata'&&snapshots===1)result.delete(data.id);
    if(!held&&((action==='opening'&&snapshots===1)||(action==='closure'&&snapshots===2)))return hold(result);return result;
   },readMetadata:async id=>{const value=structuredClone(id===manifest.id?manifest:data);
    if(!held&&((action==='metadata'&&id===data.id)||(action==='manifest-metadata'&&id===manifest.id)))return hold(value);return value;
   },readBytes:async id=>{const value=bytes.slice();
    if(!held&&(['bytes','proof','locator-read','null-scope-body'].includes(action)&&id===data.id||action==='manifest-bytes'&&id===manifest.id))return hold(value);return value;
   }};
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:manifest.id,assertWritable:async()=>{if(action==='publication-guard'&&!held)await hold(null);}}),decoder=getOwnedLocatorDecoder(physical);
  const digest=crypto.subtle.digest;
  crypto.subtle.digest=async function(algorithm,input){if(Buffer.from(input).equals(Buffer.from(locatorBytes))){
    locatorHashes++;
    if(['decode','decoder-only'].includes(action)&&locatorHashes===1)await hold(null);
    else {enterDecode();await decodeGate;}
   }return digest.call(this,algorithm,input);};
  try {
   let old,token;
   if(action==='opening')old=physical.beginVerification();
   else {
    if(action!=='null-scope-body')token=await physical.beginVerification();
    if(action==='metadata')old=physical.readMetadata(data.id,{maxBytes:16384});
    if(['bytes','null-scope-body'].includes(action)){await physical.readMetadata(data.id,{maxBytes:16384});old=physical.readBytes(data.id,{maxBytes:65536});}
    if(action.startsWith('manifest-'))old=physical.readManifest();
    if(action==='closure')old=physical.closeVerification(token);
    if(action==='publication-guard')old=physical.writeManifest(enc.encode('{}'));
    if(action==='proof')old=physical.verifyImmutableObject({fileId:data.id,sha256,kind:'snapshot-object'});
    if(['decode','decoder-only'].includes(action))old=decoder.decode(query);
    if(action==='locator-read')old=createPagedPhysicalLocators(physical,{databaseId:profile.databaseId,copyId:profile.copyId,folderId:adapter.folderId}).get({fileId:data.id,sha256},{kind:'data-object',sha256:'1'.repeat(64)});
   }
   const oldResult=old.then(()=>null,error=>error);await Promise.race([entered,oldResult.then(error=>{throw error??new Error('Old call did not reach its delayed boundary.');})]);
   let nextToken;
   if(action==='null-scope-body'){const intervening=await physical.beginVerification();await physical.closeVerification(intervening);}
   else if(action==='decoder-only'){decoder.invalidate();nextToken=token;}
   else {physical.invalidateReadCache();nextToken=await physical.beginVerification();}
   const next=decoder.decode(query);await decodeEntered;resolve();assert.ok(await oldResult,'expired read must not return authority or bytes');
   resolveDecode();assert.deepEqual(await next,root);
   if(nextToken){
    if(action==='locator-read'){await physical.readMetadata(data.id);assert.deepEqual(await physical.readBytes(data.id),bytes);}
    else await physical.verifyImmutableObject({fileId:data.id,sha256,kind:data.appProperties.financeTrackerKind});
    await physical.closeVerification(nextToken);
   }
  }finally{resolve();resolveDecode();crypto.subtle.digest=digest;}
 });

for(const guarded of [true,false])for(const outcome of ['success','failure'])test(`a late ${guarded?'guarded':'unknown'} publication ${outcome} invalidates shared evidence`,async()=>{
 const bytes=enc.encode(canonicalizeJcs(root)),query={bytes,sha256:await partitionDigest(bytes),profile};
 let enter,resolve,enterDecode,resolveDecode,mutations=0;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r),decodeEntered=new Promise(r=>enterDecode=r),decodeGate=new Promise(r=>resolveDecode=r);
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map(),publishManifest:async(id,value,{beforeMutation})=>{
  if(guarded)await beforeMutation();enter();await gate;mutations++;
  if(outcome==='failure')throw Object.assign(new Error('Invented uncertain publication outcome'),{code:'drive-request-failed',details:{status:503}});
 }};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'invented-manifest',assertWritable:async()=>{}}),decoder=getOwnedLocatorDecoder(physical);
 await physical.beginVerification();const old=physical.writeManifest(enc.encode('{}')).then(()=>null,error=>error);await entered;
 physical.invalidateReadCache();await physical.beginVerification();
 const digest=crypto.subtle.digest;
 crypto.subtle.digest=async function(...args){enterDecode();await decodeGate;return digest.apply(this,args);};
 try {
  const next=decoder.decode(query);await decodeEntered;resolve();assert.ok(await old);assert.equal(mutations,1,'An already-issued write may still finish; do not roll it back or retry.');
  resolveDecode();await assert.rejects(next,{code:'verification-scope-closed'});
  physical.invalidateReadCache();const token=await physical.beginVerification();assert.deepEqual(await decoder.decode(query),root);await physical.closeVerification(token);
 }finally{resolve();resolveDecode();crypto.subtle.digest=digest;}
});

for(const boundary of ['inner-owner','inner-beforeMutation'])for(const retry of [false,true])for(const outcome of ['success','failure'])
 test(`expired ${boundary} ${outcome} ${retry?'after an earlier attempt':'before first dispatch'} preserves the correct evidence boundary`,async()=>{
  const bytes=enc.encode(canonicalizeJcs(root)),query={bytes,sha256:await partitionDigest(bytes),profile};
  let enter,resolve,enterDecode,resolveDecode,owners=0,callbacks=0,mutations=0;
  const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r),decodeEntered=new Promise(r=>enterDecode=r),decodeGate=new Promise(r=>resolveDecode=r);
  const delay=async()=>{enter();await gate;if(outcome==='failure')throw new Error('Invented final guard failure');};
  const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map(),publishManifest:async(id,value,{beforeMutation})=>{
   await beforeMutation();mutations++;
   if(retry){await beforeMutation();mutations++;}
  }};
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'invented-manifest',assertWritable:async()=>{
   if(++owners===(retry?3:2)&&boundary==='inner-owner')await delay();
  }}),decoder=getOwnedLocatorDecoder(physical);
  await physical.beginVerification();
  const old=physical.writeManifest(enc.encode('{}'),{beforeMutation:async()=>{
   if(++callbacks===(retry?2:1)&&boundary==='inner-beforeMutation')await delay();
  }}).then(()=>null,error=>error);await entered;
  physical.invalidateReadCache();const token=await physical.beginVerification();
  const digest=crypto.subtle.digest;crypto.subtle.digest=async function(...args){enterDecode();await decodeGate;return digest.apply(this,args);};
  try {
   const next=decoder.decode(query);await decodeEntered;resolve();assert.ok(await old);assert.equal(mutations,retry?1:0);
   resolveDecode();
   if(retry){await assert.rejects(next,{code:'verification-scope-closed'});physical.invalidateReadCache();}
   else{assert.deepEqual(await next,root);await physical.closeVerification(token);}
  }finally{resolve();resolveDecode();crypto.subtle.digest=digest;}
 });

test('a captured physical lifetime allows internal publication phases but not closure or null-scope ABA',async()=>{
 let physical,guard;const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map(),publishManifest:async(id,value,{beforeMutation})=>{await beforeMutation();guard();}};
 physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'invented-manifest',assertWritable:async()=>{}});
 const unscoped=physical.captureVerificationLifetime(),token=await physical.beginVerification();guard=physical.captureVerificationLifetime(token);
 assert.throws(()=>physical.captureVerificationLifetime({}),{code:'verification-scope-closed'});
 guard();await physical.writeManifest(enc.encode('{}'));guard();await physical.closeVerification(token);
 assert.throws(guard,{code:'verification-scope-closed'});assert.throws(unscoped,{code:'verification-scope-closed'});
});
