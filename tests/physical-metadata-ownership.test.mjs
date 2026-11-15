import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
test('repeated metadata returns cannot mutate retained opening/closing witness',async()=>{
 const source={id:'invented-id',trashed:false,parents:['invented-folder'],version:'1',size:'1',appProperties:{financeTrackerKind:'snapshot-object'}};
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([['invented-id',structuredClone(source)]])};
 const p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await p.beginVerification();
 for(let i=0;i<4;i++){
  const result=await p.readMetadata('invented-id');assert.equal(result.version,'1');assert.equal(result.parents[0],'invented-folder');assert.equal(result.appProperties.financeTrackerKind,'snapshot-object');
  result.parents[0]='other';result.appProperties.financeTrackerKind='other';result.version='9';
 }
 await p.closeVerification(token);
});
test('repeated metadata cache hit still rejects changed closing witness',async()=>{
 const source={id:'invented-id',trashed:false,parents:['invented-folder'],version:'1',size:'1'};
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([['invented-id',structuredClone(source)]])};
 const p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await p.beginVerification();
 await p.readMetadata('invented-id');await p.readMetadata('invented-id');source.trashed=true;
 await assert.rejects(p.closeVerification(token));
});
test('first observation snapshots a custom metadata accessor once before retaining witness',async()=>{
 let observations=0,snapshots=0;
 const stable={id:'invented-id',trashed:false,parents:['invented-folder'],version:'1',size:'1'};
 const source={...stable,get version(){return String(++observations);}};
 const adapter={folderId:'invented-folder',readMetadata:async()=>source,readMetadataSnapshot:async()=>++snapshots===1?new Map():new Map([['invented-id',structuredClone(stable)]])};
 const p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await p.beginVerification();
 assert.equal((await p.readMetadata('invented-id')).version,'1');assert.equal(observations,1);
 assert.equal((await p.readMetadata('invented-id')).version,'1');assert.equal(observations,1);
 await p.closeVerification(token);
});
test('scoped metadata byte bound uses exact canonical UTF-8 length and original option accesses',async()=>{
 const {canonicalizeJcs}=await import('../js/transaction-protocol.mjs');
 const source={id:'invented-id',trashed:false,parents:['invented-folder'],version:'1',size:'1',name:'Invented é漢'};
 const length=new TextEncoder().encode(canonicalizeJcs(source)).length;
 for(const maximum of [length,length-1]){
  const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([['invented-id',structuredClone(source)]])};
  const p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await p.beginVerification();let accesses=0;
  const opts={get maxBytes(){accesses++;return maximum;}};
  if(maximum===length){assert.deepEqual(await p.readMetadata('invented-id',opts),source);await p.closeVerification(token);}
  else {await assert.rejects(p.readMetadata('invented-id',opts),{code:'byte-limit'});await assert.rejects(p.closeVerification(token));}
  assert.equal(accesses,2);
 }
});
test('unscoped metadata retains accessor serialization occurrence',async()=>{
 let reads=0;
 const source={id:'invented-id',trashed:false,parents:['invented-folder'],get version(){reads++;return '1';},size:'1'};
 const p=createPhysicalDriveAdapter({folderId:'invented-folder',readMetadata:async()=>source},{manifestFileId:'unused',assertWritable:async()=>{}});
 await p.readMetadata('invented-id',{maxBytes:16384});assert.equal(reads,4);
});
test('scoped canonical failures still poison the verification scope',async()=>{
 for(const extra of ['\ud800',NaN]){
  const source={id:'invented-id',trashed:false,parents:['invented-folder'],version:'1',size:'1',extra};
  const p=createPhysicalDriveAdapter({folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([['invented-id',source]])},{manifestFileId:'unused',assertWritable:async()=>{}}),token=await p.beginVerification();
  await assert.rejects(p.readMetadata('invented-id',{maxBytes:16384}));await assert.rejects(p.closeVerification(token));
 }
});
