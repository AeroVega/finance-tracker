import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';

test('opaque proofs preserve phase, binding, cancellation and closure invariants',async()=>{
const {default:assert}=await import('node:assert/strict');
const {createPhysicalDriveAdapter}=await import('../js/paged-application-storage.mjs');
const {partitionDigest}=await import('../js/canonical-partitions.mjs');
const bytes=new TextEncoder().encode('invented physical body'),sha256=await partitionDigest(bytes);
function fixture(){let m={id:'invented-file',name:'invented-name',parents:['invented-folder'],trashed:false,version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}};let gate=null,reads=0,owner=async()=>{};const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([[m.id,structuredClone(m)]]),readMetadata:async()=>structuredClone(m),readBytes:async()=>{reads++;if(gate)await gate;return bytes.slice();},publishManifest:async()=>{}};const p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:()=>owner()});return {p,adapter,get m(){return m;},set m(x){m=x;},get reads(){return reads;},set gate(x){gate=x;},set owner(x){owner=x;}};}
const q={fileId:'invented-file',sha256,kind:'snapshot-object',transactionId:'invented-tx'};
let cases=0;
for(const mutate of [m=>{m.id='invented-wrong';},m=>{m.name='renamed';},m=>{m.parents=['wrong-folder'];},m=>{m.trashed=true;},m=>{delete m.trashed;},m=>{m.version='2';},m=>{m.size='1';},m=>{m.appProperties.financeTrackerKind='commit-record';},m=>{m.appProperties.financeTrackerHash='0'.repeat(64);},m=>{m.appProperties.financeTrackerTransaction='wrong-tx';}]){const f=fixture(),t=await f.p.beginVerification();await f.p.verifyImmutableObject(q);mutate(f.m);await f.p.verifyImmutableObject(q);await assert.rejects(f.p.closeVerification(t));cases++;}
for(const change of [{kind:'commit-record'},{sha256:'0'.repeat(64)},{transactionId:'wrong-tx'},{maxBytes:1},{fileId:'wrong-file'}]){const f=fixture(),t=await f.p.beginVerification();await f.p.verifyImmutableObject(q);await assert.rejects(f.p.verifyImmutableObject({...q,...change}));await assert.rejects(f.p.closeVerification(t));cases++;}
// Late old epoch cannot mint into replacement phase, even if caller mutates request.
{const f=fixture(),t=await f.p.beginVerification();let release;f.gate=new Promise(r=>release=r);let arg={...q};const pending=f.p.verifyImmutableObject(arg);arg.sha256='0'.repeat(64);await new Promise(r=>setTimeout(r,0));f.p.invalidateReadCache();const newer=await f.p.beginVerification();release();await assert.rejects(pending,{code:'verification-scope-closed'});f.gate=null;const start=f.reads;await f.p.verifyImmutableObject(q);assert.ok(f.reads>=start);await f.p.closeVerification(newer);cases++;}
// Abort at asynchronous read blocks proof admission and all subsequent use/closure.
{const f=fixture(),t=await f.p.beginVerification(),controller=new AbortController();let release;f.gate=new Promise(r=>release=r);const pending=f.p.verifyImmutableObject({...q,signal:controller.signal});await new Promise(r=>setTimeout(r,0));controller.abort();release();await assert.rejects(pending,{name:'AbortError'});await assert.rejects(f.p.verifyImmutableObject(q));await assert.rejects(f.p.closeVerification(t));cases++;}
// Concurrent final closure drains even an unawaited body verification.
{const f=fixture(),t=await f.p.beginVerification();let release;f.gate=new Promise(r=>release=r);const pending=f.p.verifyImmutableObject(q);await new Promise(r=>setTimeout(r,0));let settled=false;const closure=f.p.closeVerification(t).then(()=>settled=true);await new Promise(r=>setTimeout(r,10));assert.equal(settled,false);release();await pending;await closure;assert.equal(settled,true);cases++;}
assert.equal(cases,18);

});

test('opaque proofs survive byte eviction with finite overflow and real byte reads',async()=>{
const {default:assert}=await import('node:assert/strict');
const {GoogleDriveTransactionAdapter}=await import('../js/drive-transaction-engine.mjs');
const {createPhysicalDriveAdapter}=await import('../js/paged-application-storage.mjs');
const {createPagedPhysicalLocators}=await import('../js/paged-physical-locators.mjs');
const {partitionDigest}=await import('../js/canonical-partitions.mjs');
const {HttpCatalogDrive}=await import('./helpers/http-catalog-drive.mjs');
const drive=new HttpCatalogDrive(),adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch}),p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
const queries=[];
for(let i=0;i<520;i++){const id='invented-proof-'+i,bytes=new Uint8Array(17000).fill(i);new DataView(bytes.buffer).setUint32(0,i);const sha256=await partitionDigest(bytes);drive.files.set(id,{bytes,metadata:{id,name:id,mimeType:'application/octet-stream',parents:[drive.folderId],appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'},trashed:false,version:'1',size:String(bytes.length)}});queries.push({fileId:id,sha256,kind:'snapshot-object',maxBytes:65536});}
const media=()=>drive.requests.filter(r=>r.category==='media').length;
let token=await p.beginVerification();for(const q of queries){assert.equal((await p.verifyImmutableObject(q)).byteLength,17000);assert.equal((await p.verifyImmutableObject({...q,transactionId:'invented-tx'})).byteLength,17000);}
const first=media();for(const q of queries.slice(0,512))await p.verifyImmutableObject(q);assert.equal(media(),first,'proof hits beyond8MiB do not reread bytes');
// Push the unproved suffix out of the8MiB byte cache with distinct arbitrary reads.
for(let i=0;i<145;i++){const id='invented-evict-'+i,bytes=new Uint8Array(60000).fill(i),sha256=await partitionDigest(bytes);drive.files.set(id,{bytes,metadata:{id,name:id,parents:[drive.folderId],appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'},trashed:false,version:'1',size:'60000'}});await p.readMetadata(id);await p.readBytes(id,{maxBytes:65536});}
const beforeOverflow=media();await p.verifyImmutableObject(queries[0]);await p.verifyImmutableObject({...queries[511],transactionId:'invented-tx'});assert.equal(media(),beforeOverflow,'omitted and explicit transaction aliases preserve512 distinct facts');await p.verifyImmutableObject(queries[519]);assert.equal(media(),beforeOverflow+1,'proof overflow really falls back after byte eviction');
const beforeBytes=media();await p.readMetadata(queries[0].fileId);const actual=await p.readBytes(queries[0].fileId,{maxBytes:65536});assert.equal(media(),beforeBytes+1,'byte request cannot fabricate body from proof');assert.equal(await partitionDigest(actual),queries[0].sha256);
await p.closeVerification(token);
// Session facts remain bounded independently of byte reuse and register fresh witnesses.
token=await p.beginVerification();
for(let i=0;i<145;i++){const id='invented-evict-'+i;await p.readMetadata(id);await p.readBytes(id,{maxBytes:65536});}
const sessionStart=media();await p.verifyImmutableObject(queries[1]);assert.equal(media(),sessionStart,'closed fact avoids evicted bytes in a new operation');
await p.verifyImmutableObject(queries[518]);assert.equal(media(),sessionStart+1,'session fact overflow falls back to real bytes');
drive.files.get(queries[1].fileId).metadata.version='2';const beforeReverify=media();await p.closeVerification(token);assert.equal(media(),beforeReverify+1,'version-only change triggers exact-byte revalidation');
token=await p.beginVerification();const afterRevalidation=media();await p.verifyImmutableObject(queries[2]);assert.equal(media(),afterRevalidation+1,'unverified bytes still require a real read');await p.closeVerification(token);
// New scope cannot reuse proof0 after byte0 is evicted again.
p.invalidateReadCache();token=await p.beginVerification();const beforeScope=media();await p.verifyImmutableObject(queries[0]);assert.equal(media(),beforeScope+1);
drive.files.get(queries[0].fileId).metadata.version='2';await p.verifyImmutableObject(queries[0]);const beforeCloseReverify=media();await p.closeVerification(token);assert.equal(media(),beforeCloseReverify+1,'changed version is rehashed before accepting the scope');


});


test('authority PATCH drains an unawaited proof before closing its phase',async()=>{
 const bytes=new TextEncoder().encode('invented body'),sha256=await partitionDigest(bytes),m={id:'invented-file',name:'invented-object',parents:['invented-folder'],trashed:false,version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}};
 let release,entered,published=0;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([[m.id,structuredClone(m)]]),readMetadata:async()=>structuredClone(m),readBytes:async()=>{entered();await gate;return bytes.slice();},publishManifest:async()=>{published++;}};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await physical.beginVerification();
 const proof=physical.verifyImmutableObject({fileId:m.id,sha256,kind:'snapshot-object'});await started;
 let settled=false;const publication=physical.writeManifest(new TextEncoder().encode('{}'),{}).then(()=>{settled=true;});
 await new Promise(r=>setTimeout(r,10));assert.equal(published,0);assert.equal(settled,false);release();
 assert.equal((await proof).byteLength,bytes.length);await publication;assert.equal(published,1);await physical.closeVerification(token);
});

test('intrinsic byte bounds reject decorated oversized buffers before proof minting',async()=>{
 const bytes=new Uint8Array(70000).fill(42),sha256=await partitionDigest(bytes);Object.defineProperty(bytes,'length',{value:1});
 const m={id:'invented-file',parents:['invented-folder'],trashed:false,version:'1',size:'1',appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}};
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([[m.id,structuredClone(m)]]),readMetadata:async()=>structuredClone(m),readBytes:async()=>bytes};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await physical.beginVerification();
 await assert.rejects(physical.verifyImmutableObject({fileId:m.id,sha256,kind:'snapshot-object',maxBytes:65536}),{code:'byte-limit'});
 await assert.rejects(physical.closeVerification(token),{code:'byte-limit'});
});

test('only factory-owned fixed forwarding views preserve the private verifier',async()=>{
 const {getOwnedPhysicalBodyVerifier,snapshotPhysicalAdapter}=await import('../js/physical-drive-adapter.mjs');
 const bytes=new TextEncoder().encode('invented'),sha256=await partitionDigest(bytes),m={id:'invented-file',parents:['invented-folder'],trashed:false,version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}};
 const physical=createPhysicalDriveAdapter({folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([[m.id,structuredClone(m)]]),readMetadata:async()=>structuredClone(m),readBytes:async()=>bytes},{manifestFileId:'unused',assertWritable:async()=>{}});
 const view=snapshotPhysicalAdapter(physical);assert.ok(Object.isFrozen(view));assert.equal(getOwnedPhysicalBodyVerifier({...view}),null);assert.equal(getOwnedPhysicalBodyVerifier({verifyImmutableObject:async()=>({byteLength:7})}),null);
 const token=await physical.beginVerification(),verify=getOwnedPhysicalBodyVerifier(view);assert.equal((await verify({fileId:m.id,sha256,kind:'snapshot-object',folderId:'invented-folder'})).byteLength,bytes.length);
 await assert.rejects(verify({fileId:m.id,sha256,kind:'snapshot-object',folderId:'another-folder'}),{code:'copy-mismatch'});await assert.rejects(physical.closeVerification(token),{code:'copy-mismatch'});
});


test('manifest publication rejects invalidation during final ownership await',async()=>{
 let physical,owners=0,published=0;
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map(),publishManifest:async()=>{published++;}};
 physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{if(++owners===2)physical.invalidateReadCache();}});
 await physical.beginVerification();
 await assert.rejects(physical.writeManifest(new TextEncoder().encode('{}'),{}),{code:'verification-scope-closed'});
 assert.equal(published,0);
});

test('caught raw byte admission failure still poisons closure',async()=>{
 const bytes=new Uint8Array(70000);Object.defineProperty(bytes,'length',{value:1});
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map(),readBytes:async()=>bytes};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
 const token=await physical.beginVerification();
 await assert.rejects(physical.readBytes('invented-body',{maxBytes:65536}),{code:'byte-limit'});
 await assert.rejects(physical.closeVerification(token),{code:'byte-limit'});
});


test('freshly closed physical facts survive phases but require fresh operation metadata',async()=>{
const files=new Map(),queries=[];for(let i=0;i<145;i++){const bytes=new Uint8Array(60000).fill(i),sha256=await partitionDigest(bytes),fileId='invented-'+i;files.set(fileId,{bytes,metadata:{id:fileId,name:fileId,parents:['invented-folder'],trashed:false,version:'1',size:'60000',appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}}});queries.push({fileId,sha256,kind:'snapshot-object'});}
let reads=0,published=0;const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([...files].map(([id,x])=>[id,structuredClone(x.metadata)])),readMetadata:async id=>structuredClone(files.get(id).metadata),readBytes:async id=>{reads++;return files.get(id).bytes.slice();},publishManifest:async()=>{published++;}};
const p=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}),token=await p.beginVerification();for(const q of queries)await p.verifyImmutableObject(q);const before=reads;await p.verifyImmutableObject(queries[0]);assert.equal(reads,before);await p.writeManifest(new TextEncoder().encode('{}'),{});assert.equal(published,1);await p.verifyImmutableObject(queries[0]);assert.equal(reads,before,'successful phase closure promotes only physical facts');await p.closeVerification(token);
const next=await p.beginVerification();await p.verifyImmutableObject(queries[0]);assert.equal(reads,before,'new operation may reuse exact physical fact after fresh opening');await p.closeVerification(next);
files.get(queries[0].fileId).metadata.version='2';const changed=await p.beginVerification();await p.verifyImmutableObject(queries[0]);assert.equal(reads,before+1,'changed version requires actual body verification');await p.closeVerification(changed);
p.invalidateReadCache();const cold=await p.beginVerification();await p.verifyImmutableObject(queries[0]);assert.equal(reads,before+2,'session invalidation discards facts and bytes');await p.closeVerification(cold);
});


test('every publication ownership boundary rejects invalidation and poisoned admission',async()=>{
const bytes=new TextEncoder().encode('invented'),sha256=await partitionDigest(bytes),m={id:'invented-body',parents:['invented-folder'],trashed:false,version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}};
for(const point of ['second-owner','post-token','inside-final-guard','forbidden-admission']){
 let physical,owners=0,published=0;const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([[m.id,structuredClone(m)]]),readMetadata:async()=>structuredClone(m),readBytes:async()=>bytes.slice(),publishManifest:async(id,x,opts)=>{if(point==='post-token')physical.invalidateReadCache();await opts.beforeMutation();published++;}};
 physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{if(++owners===2){if(point==='second-owner')physical.invalidateReadCache();if(point==='forbidden-admission')await assert.rejects(physical.verifyImmutableObject({fileId:m.id,sha256,kind:'snapshot-object'}),{code:'verification-scope-closed'});}}});
 await physical.beginVerification();await physical.verifyImmutableObject({fileId:m.id,sha256,kind:'snapshot-object'});
 await assert.rejects(physical.writeManifest(new TextEncoder().encode('{}'),{beforeMutation:async()=>{if(point==='inside-final-guard')physical.invalidateReadCache();}}),{code:'verification-scope-closed'});
 assert.equal(published,0,point);
}

});


test('factory-owned verifier surface cannot be replaced after capability registration',async()=>{
 const bytes=new TextEncoder().encode('invented original'),sha256=await partitionDigest(bytes);
 const metadata={id:'invented-body',parents:['invented-folder'],trashed:false,version:'2',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:sha256,financeTrackerTransaction:'invented-tx'}};
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map([[metadata.id,metadata]]),readMetadata:async()=>metadata,readBytes:async()=>new Uint8Array(bytes.length)};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
 assert.ok(Object.isFrozen(physical));
 assert.throws(()=>{physical.readBytes=async()=>bytes;},TypeError);
 assert.throws(()=>{physical.readMetadata=async()=>metadata;},TypeError);
 const token=await physical.beginVerification();
 await assert.rejects(physical.verifyImmutableObject({fileId:metadata.id,sha256,kind:'snapshot-object'}),{code:'hash-mismatch'});
 await assert.rejects(physical.closeVerification(token));
});


test('application selection cannot replace the adapter or manifest retaining physical facts',async()=>{
 const {PagedApplicationStorage}=await import('../js/paged-application-storage.mjs');
 const adapter={folderId:'invented-folder'};
 const app=new PagedApplicationStorage({adapter,assertWritable:async()=>{},verificationPlans:new Map(),manifestFileId:'invented-manifest'});
 assert.throws(()=>{app.adapter={folderId:'other'};},TypeError);
 assert.throws(()=>app.binding('other-manifest'),{code:'copy-mismatch'});
 assert.equal(app.manifestFileId,'invented-manifest');
});
