import test from 'node:test';
import assert from 'node:assert/strict';
import {LocatorBatchAdapter} from './helpers/paged-locator-batch-fixture.mjs';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';

for(const mode of ['owned','generic','corrupt-identities','corrupt-files','cancel','invalidate'])test(`cross-index reads remain bounded, verified and drained: ${mode}`,async()=>{
 const adapter=new LocatorBatchAdapter(),entries=[adapter.object(1),adapter.object(2)].sort((a,b)=>a.sha256.localeCompare(b.sha256));
 const root=await adapter.tree().build(entries),catalog=adapter.json(root);
 const targetIds=new Set([catalog.identities.fileId,catalog.files.fileId]);
 adapter.readMetadataSnapshot=async()=>new Map([...adapter.files].map(([id,f])=>[id,structuredClone(f.metadata)]));
 const read=adapter.readBytes.bind(adapter),controller=new AbortController();
 let active=0,peak=0,issued=0,finished=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 let physical;
 adapter.readBytes=async(id,opts)=>{
  if(!targetIds.has(id))return read(id,opts);
  active++;issued++;peak=Math.max(peak,active);
  try {
   if(mode==='generic')await Promise.resolve();
   else {if(active===2)release();await barrier;}
   if(mode==='cancel')controller.abort();
   if(mode==='invalidate')physical.invalidateReadCache();
   if((mode==='corrupt-identities'&&id===catalog.identities.fileId)||(mode==='corrupt-files'&&id===catalog.files.fileId)){
    const bytes=(await read(id,opts)).slice();bytes[0]^=1;return bytes;
   }
   return await read(id,opts);
  }finally{active--;finished++;}
 };
 physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
 const selected=mode==='generic'?adapter:physical;
 const tree=createPagedPhysicalLocators(selected,{databaseId:adapter.databaseId,copyId:adapter.copyId,folderId:adapter.folderId});
 const token=mode==='generic'?null:await physical.beginVerification();
 if(['owned','generic'].includes(mode)){
  assert.equal((await tree.verify(root,{signal:controller.signal})).entryCount,'2');
  if(token)await physical.closeVerification(token);
 }else{
  await assert.rejects(tree.verify(root,{signal:controller.signal}),mode.startsWith('corrupt')?{code:'hash-mismatch'}:undefined);
  await assert.rejects(physical.closeVerification(token));
 }
 assert.equal(active,0);assert.equal(issued,finished);assert.equal(peak,mode==='generic'?1:2);
});

test('index overlap and pending body verification together stay within eight physical reads',async()=>{
 const adapter=new LocatorBatchAdapter(),limits={maxEntries:2,maxChildren:3,maxNodeBytes:4096};
 const entries=Array.from({length:16},(_,i)=>adapter.object(i)).sort((a,b)=>a.sha256.localeCompare(b.sha256));
 const root=await adapter.tree(limits).build(entries);
 adapter.readMetadataSnapshot=async()=>new Map([...adapter.files].map(([id,f])=>[id,structuredClone(f.metadata)]));
 const read=adapter.readBytes.bind(adapter);let active=0,peak=0;
 adapter.readBytes=async(id,opts)=>{active++;peak=Math.max(peak,active);try{
  await new Promise(resolve=>setTimeout(resolve,id.startsWith('invented-body')?12:2));return await read(id,opts);
 }finally{active--;}};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
 const tree=createPagedPhysicalLocators(physical,{databaseId:adapter.databaseId,copyId:adapter.copyId,folderId:adapter.folderId,...limits});
 const token=await physical.beginVerification();assert.equal((await tree.verify(root)).entryCount,'16');
 await physical.closeVerification(token);assert.ok(peak<=8);assert.ok(peak>1);assert.equal(active,0);
});
