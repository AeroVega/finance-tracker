import test from 'node:test';
import assert from 'node:assert/strict';
import {LocatorBatchAdapter} from './helpers/paged-locator-batch-fixture.mjs';
import {createPhysicalDriveAdapter,getOwnedLocatorDecoder,snapshotPhysicalAdapter} from '../js/physical-drive-adapter.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
async function fixture(){
 const a=new LocatorBatchAdapter(),entries=Array.from({length:9},(_,i)=>a.object(i)).sort((a,b)=>a.sha256.localeCompare(b.sha256));
 const root=await a.tree().build(entries);
 a.readMetadataSnapshot=async()=>new Map([...a.files].map(([id,f])=>[id,structuredClone(f.metadata)]));
 const p=createPhysicalDriveAdapter(a,{manifestFileId:'unused',assertWritable:async()=>{}});
 const tree=(adapter=p,extra={})=>createPagedPhysicalLocators(adapter,{databaseId:a.databaseId,copyId:a.copyId,folderId:a.folderId,...extra});
 return {a,p,root,tree};
}
async function digests(fn){const original=crypto.subtle.digest.bind(crypto.subtle);let count=0;
 crypto.subtle.digest=(...args)=>{count++;return original(...args);};
 try{return {result:await fn(),count};}finally{crypto.subtle.digest=original;}}
test('complete results reuse across owned snapshots, copy totals, and retire at closure',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();
 const first=await digests(()=>tree().verify(root));assert.ok(first.count>0);first.result.entryCount='0';
 const hit=await digests(()=>tree(snapshotPhysicalAdapter(p)).verify(root));assert.equal(hit.count,0);assert.equal(hit.result.entryCount,'9');
 await p.closeVerification(t);const next=await p.beginVerification();
 assert.ok((await digests(()=>tree().verify(root))).count>0);await p.closeVerification(next);
});
test('profile changes and decoder invalidation cannot reuse a complete result',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();await tree().verify(root);
 assert.ok((await digests(()=>tree(p,{maxEntries:127}).verify(root))).count>0);
 getOwnedLocatorDecoder(p).invalidate();assert.ok((await digests(()=>tree().verify(root))).count>0);
 await p.closeVerification(t);
});
test('cancelled cache hits reject and do not change immutable totals',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();await tree().verify(root);
 const controller=new AbortController();controller.abort();await assert.rejects(tree().verify(root,{signal:controller.signal}),{name:'AbortError'});
 assert.equal((await tree().verify(root)).entryCount,'9');await p.closeVerification(t);
});
test('generic copies and no-scope owned verification do not memoize',async()=>{
 const {p,root,tree}=await fixture();
 for(const adapter of [p,{...p}]){
  await tree(adapter).verify(root);assert.ok((await digests(()=>tree(adapter).verify(root))).count>0);
 }
});
test('cached complete verification retains metadata witnesses for closing corruption',async()=>{
 const {a,p,root,tree}=await fixture();const t=await p.beginVerification();await tree().verify(root);await tree().verify(root);
 a.files.get(root.fileId).metadata.trashed=true;
 await assert.rejects(p.closeVerification(t));
});
test('failed verification retires same-phase memo and never admits its partial result',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();await tree().verify(root);
 await assert.rejects(tree().verify({...root,sha256:'0'.repeat(64)}));
 assert.ok((await digests(()=>tree().verify(root))).count>0);await p.closeVerification(t);
});
test('bounded root/profile memo evicts rather than accepting unchecked totals',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();await tree().verify(root);
 for(let maxEntries=9;maxEntries<73;maxEntries++)await tree(p,{maxEntries}).verify(root);
 assert.ok((await digests(()=>tree().verify(root))).count>0);await p.closeVerification(t);
});
test('late invalidation tokens cannot retire a successor phase',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();
 const old=getOwnedLocatorDecoder(p).captureVerification();await tree().verify(root);await p.closeVerification(t);
 const next=await p.beginVerification();await tree().verify(root);old.invalidate();
 assert.throws(()=>old.assertCurrent(),{code:'verification-scope-closed'});
 assert.equal((await digests(()=>tree().verify(root))).count,0);await p.closeVerification(next);
});
test('same-phase invalidation retires captured identities before a concurrent mint',async()=>{
 const {p,root,tree}=await fixture();const t=await p.beginVerification();
 const old=getOwnedLocatorDecoder(p).captureVerification();await tree().verify(root);old.invalidate();
 assert.throws(()=>old.assertCurrent(),{code:'verification-scope-closed'});
 assert.notEqual(getOwnedLocatorDecoder(p).captureVerification().identity,old.identity);
 assert.ok((await digests(()=>tree().verify(root))).count>0);await p.closeVerification(t);
});
test('abort precedes changed-folder diagnostics for owned and generic verification',async()=>{
 for(const generic of [false,true]){
  const {a,p,root,tree}=await fixture(),t=await p.beginVerification(),selected=tree(generic?{...p}:p);
  const controller=new AbortController();controller.abort();const folder=a.folderId;a.folderId='invented-changed-folder';
  await assert.rejects(selected.verify(root,{signal:controller.signal}),{name:'AbortError'});
  a.folderId=folder;await p.closeVerification(t);
 }
});
test('late old verification failure cannot erase a successful successor memo',async()=>{
 const {p,root,tree}=await fixture();await p.beginVerification();
 const original=crypto.subtle.digest.bind(crypto.subtle);let entered,release,once=true;
 const started=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
 crypto.subtle.digest=async(...args)=>{if(once){once=false;entered();await blocked;}return original(...args);};
 let old,next;
 try {
  old=tree().verify(root).then(()=>({ok:true}),error=>({error}));await started;
  p.invalidateReadCache();next=await p.beginVerification();await tree().verify(root);
  release();assert.ok((await old).error);
 }finally{release();if(old)await old;crypto.subtle.digest=original;}
 assert.equal((await digests(()=>tree().verify(root))).count,0);await p.closeVerification(next);
});
test('real manifest publication rotates same-scope memo identity',async()=>{
 const {a,p,root,tree}=await fixture();let published=0,guards=0;
 a.publishManifest=async(id,value,opts)=>{assert.equal(id,'unused');await opts.beforeMutation();published++;return value;};
 const t=await p.beginVerification();await tree().verify(root);
 const before=getOwnedLocatorDecoder(p).captureVerification().identity;
 await p.writeManifest(new TextEncoder().encode('{}'),{beforeMutation:async()=>{guards++;}});
 assert.equal(published,1);assert.equal(guards,1);
 assert.notEqual(getOwnedLocatorDecoder(p).captureVerification().identity,before);
 assert.ok((await digests(()=>tree().verify(root))).count>0);await p.closeVerification(t);
});
test('cached result refuses admission while closing metadata inventory is pending',async()=>{
 const {a,p,root,tree}=await fixture();const t=await p.beginVerification();await tree().verify(root);
 const original=a.readMetadataSnapshot;let release,entered;
 const blocked=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 a.readMetadataSnapshot=async()=>{entered();await blocked;return original();};
 const closing=p.closeVerification(t);await started;
 try{await assert.rejects(tree().verify(root),{code:'verification-scope-closed'});}
 finally{release();await closing;}
});

test('no-op setMany iterator cannot publish body changes after a complete phase memo',async()=>{
 const {a,p,root,tree}=await fixture();let publisherCalls=0;
 a.publishManifest=async(_id,value,opts)=>{publisherCalls++;await opts.beforeMutation();return value;};
 const token=await p.beginVerification(),catalog=tree();await catalog.verify(root);
 const file=[...a.files].find(([id])=>id.startsWith('invented-body'))[1];
 const oldLength=file.bytes.length,oldVersion=file.metadata.version;
 async function* noOp(){
  file.bytes=file.bytes.slice();file.bytes[0]^=1;
  file.metadata.version=String(BigInt(oldVersion)+1n);
 }
 // The returned root is still only a candidate. The owned opening snapshot
 // permits reuse here, but the closing inventory must refuse publication.
 assert.deepEqual(await catalog.setMany(root,noOp()),root);
 assert.equal(file.bytes.length,oldLength);
 await assert.rejects(p.writeManifest(new TextEncoder().encode('{}')),{code:'hash-mismatch'});
 assert.equal(publisherCalls,0);
 await assert.rejects(p.closeVerification(token));
});
