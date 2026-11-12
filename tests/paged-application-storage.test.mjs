import {GoogleDriveTransactionAdapter} from "../js/drive-transaction-engine.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy,PAGED_INITIALIZATION_FORMAT,PAGED_MANIFEST_KIND,PAGED_MANIFEST_NAME,createPhysicalDriveAdapter} from '../js/paged-application-storage.mjs';
import {EMPTY_CANONICAL_BYTES,PAGED_CANONICAL_VERIFIER} from '../js/paged-canonical-format.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
const plans = new Map([[PAGED_CANONICAL_VERIFIER,async ({manifest,readObject}) => { assert.deepEqual(await readObject({kind:'data-object',sha256:manifest.root}),EMPTY_CANONICAL_BYTES); }]]);
function lifecycle(drive) { return new ApplicationStorageLifecycle({syntheticOnly:true,folderName:'invented synthetic',folderId:drive.folderId,
  accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,makeManifest:()=>{},pagedCanonical:true,verificationPlans:plans,
  initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},
  setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null}); }
test('real lifecycle and Drive HTTP adapters initialize, save and reopen the paged sentinel',async ()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start();
 const old=await app.readPartitionedSnapshot(); assert.equal(old.manifest.version,4);
 assert.deepEqual(await old.store.read(old.rootHash),EMPTY_CANONICAL_BYTES);
 await app.savePartitionedRoot({expectedBase:old.manifest,rootHash:old.rootHash,objects:[],preparationStore:{read:()=>assert.fail('no application additions')}});
 assert.equal((await app.readPartitionedSnapshot()).manifest.revision,'1');
 await app.release(); const reopened=lifecycle(drive); await reopened.start();
 assert.equal((await reopened.readPartitionedSnapshot()).manifest.revision,'1'); await reopened.release();
 assert.ok(drive.summary().requests>0);
});
test('HTTP interruption after initialization marker recovers without removing evidence',async()=>{
 const drive=new HttpCatalogDrive(); drive.stopAfterMutation=2; const app=lifecycle(drive); await assert.rejects(app.start());
 drive.reboot(); const count=drive.files.size;
 await app.recover(); assert.equal(app.state,'ready'); assert.ok(drive.files.size>=count);
 assert.equal((await app.readPartitionedSnapshot()).rootHash,await partitionDigest(EMPTY_CANONICAL_BYTES));
 await app.release();
});

test('every HTTP save mutation interruption reopens exact old or new root without preparation',async t=>{
 const probe=new HttpCatalogDrive(), probeApp=lifecycle(probe); await probeApp.start(); const base=await probeApp.readPartitionedSnapshot();
 const begin=probe.mutations; await probeApp.savePartitionedRoot({expectedBase:base.manifest,rootHash:base.rootHash,objects:[],preparationStore:{read:()=>assert.fail('unused')}});
 const boundaries=probe.mutations-begin; await probeApp.release();
 for (const phase of ["before","after"]) for(let at=1;at<=boundaries;at++) {
  const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start(); const before=await app.readPartitionedSnapshot();
  if (phase === "after") drive.stopAfterMutation=drive.mutations+at;
  else { let mutation=0; drive.beforeResponse=({category}) => { if (["create","update"].includes(category) && ++mutation === at) { drive.stopped=true; drive.check(); } }; }
  await assert.rejects(app.savePartitionedRoot({expectedBase:before.manifest,rootHash:before.rootHash,objects:[],preparationStore:{read:()=>assert.fail('unused')}}));
  drive.beforeResponse=null; drive.reboot(); await app.recover(); const recovered=await app.readPartitionedSnapshot();
  assert.ok(['0','1'].includes(recovered.manifest.revision)); assert.equal(recovered.manifest.pending,null);
  await app.release(); const reopened=lifecycle(drive); await reopened.start(); assert.equal((await reopened.readPartitionedSnapshot()).manifest.revision,recovered.manifest.revision); await reopened.release();
 }
 t.diagnostic('HTTP durable save boundaries: '+boundaries+'; baseline HTTP: '+JSON.stringify(probe.summary()));
});

test('physical media bounds and per-attempt guard failures reject before mutation',async()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start(); const snapshot=await app.readPartitionedSnapshot();
 const file=[...drive.files.values()].find(f=>f.metadata.appProperties?.financeTrackerHash===snapshot.rootHash);
 await assert.rejects(app.transactionAdapter.readBytes(file.metadata.id,{maxBytes:1}),{code:'drive-response-too-large'});
 const before=drive.mutations;
 await assert.rejects(app.transactionAdapter.createImmutable({fileId:await app.transactionAdapter.allocateFileId(),name:'invented',kind:'snapshot-object',transactionId:'invented',content:EMPTY_CANONICAL_BYTES,expectedSha256:snapshot.rootHash,beforeMutation:async()=>{throw Object.assign(new Error('lost'),{code:'ownership-lost'});}}),{code:'ownership-lost'});
 assert.equal(drive.mutations,before); await app.release();
});

test('selected manifest requires exact name, kind, explicit nontrash and a stable read bracket',async()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start();
 const metadata=drive.files.get(app.manifestFileId).metadata, original=structuredClone(metadata);
 for(const corrupt of [m=>{delete m.trashed;},m=>{m.name='other';},m=>{m.appProperties.financeTrackerKind='other';}]) {
  corrupt(metadata); await assert.rejects(app.engine.physical.readManifest(),{code:'manifest-metadata-mismatch'});
  Object.keys(metadata).forEach(k=>delete metadata[k]); Object.assign(metadata,structuredClone(original));
 }
 app.engine.physical.invalidateReadCache();
 let altered=false; drive.beforeResponse=({category,fileId})=>{if(category==='media'&&fileId===app.manifestFileId&&!altered){altered=true;metadata.version=String(Number(metadata.version)+1);}};
 const beforeMedia=drive.requests.filter(r=>r.category==='media'&&r.fileId===app.manifestFileId).length;
 await app.engine.physical.readManifest();assert.equal(altered,true);assert.equal(drive.requests.filter(r=>r.category==='media'&&r.fileId===app.manifestFileId).length,beforeMedia+2,'version change triggers a stable reread');drive.beforeResponse=null;
 await app.release();
});

test('private physical byte reuse is gated by fresh metadata and changed versions refetch',async()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start();
 const snapshot=await app.readPartitionedSnapshot(), id=[...drive.files.values()].find(f=>f.metadata.appProperties?.financeTrackerHash===snapshot.rootHash).metadata.id;
 const physical=app.engine.physical; physical.invalidateReadCache();
 await physical.readMetadata(id,{maxBytes:16384}); await physical.readBytes(id,{maxBytes:65536});
 const count=()=>drive.requests.filter(r=>r.category==='media').length, first=count();
 await physical.readMetadata(id,{maxBytes:16384}); await physical.readBytes(id,{maxBytes:65536}); assert.equal(count(),first);
 drive.files.get(id).metadata.version='2'; await physical.readMetadata(id,{maxBytes:16384}); await physical.readBytes(id,{maxBytes:65536}); assert.equal(count(),first+1);
 await app.release();
});

test('scope closure catches midway metadata changes and escaped readers cannot reuse authority',async()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start();
 const snapshot=await app.readPartitionedSnapshot(); await snapshot.store.read(snapshot.rootHash);
 const file=[...drive.files.values()].find(f=>f.metadata.appProperties?.financeTrackerHash===snapshot.rootHash);
 file.metadata.version=String(Number(file.metadata.version)+1);
 // Owned evidence remains provisional until final closure.
 await snapshot.store.read(snapshot.rootHash);
 await assert.rejects(app.assertCurrentManifest(snapshot.manifest),{code:'verification-metadata-changed'});
 assert.equal(app.state,'recovery-required'); await assert.rejects(snapshot.store.read(snapshot.rootHash),{code:'verification-scope-closed'});
 await app.recover(); const next=await app.readPartitionedSnapshot(); await app.assertCurrentManifest(next.manifest);
 await assert.rejects(next.store.read(next.rootHash),{code:'verification-scope-closed'}); await app.release();
});

test('scope finalization drains admitted reads and rejects newly escaped reads',async()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive); await app.start(); const snapshot=await app.readPartitionedSnapshot();
 const pending=snapshot.store.read(snapshot.rootHash); await app.assertCurrentManifest(snapshot.manifest);
 assert.deepEqual(await pending,EMPTY_CANONICAL_BYTES); await assert.rejects(snapshot.store.read(snapshot.rootHash),{code:'verification-scope-closed'}); await app.release();
});

test('caught metadata admission errors remain sticky and scopes expose no mutable witnesses',async()=>{
 const drive=new HttpCatalogDrive(), app=lifecycle(drive);await app.start();const physical=app.engine.physical;
 const file=[...drive.files.values()].find(f=>f.metadata.appProperties?.financeTrackerKind==='snapshot-object');
 const version=file.metadata.version;file.metadata.version=2;
 const token=await physical.beginVerification();assert.deepEqual(Object.keys(token),[]);assert.equal(Object.isFrozen(token),true);
 await assert.rejects(physical.readMetadata(file.metadata.id,{maxBytes:16384}),{code:'metadata-mismatch'});
 file.metadata.version=version;await assert.rejects(physical.closeVerification(token),{code:'metadata-mismatch'});
 await app.release();
});

test('initialization selection metadata changes stop before staging or publication',async()=>{
 for(const mutate of [m=>{m.name='unrelated';},m=>{m.appProperties.financeTrackerKind='unrelated';},m=>{delete m.trashed;}]){
  const drive=new HttpCatalogDrive();const adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0,afterMutation:({kind})=>{if(kind===PAGED_MANIFEST_KIND)mutate([...drive.files.values()].find(f=>f.metadata.name===PAGED_MANIFEST_NAME).metadata);}});
  await assert.rejects(initializePagedCanonicalCopy({adapter,guard:async()=>{}}),{code:'manifest-metadata-mismatch'});
  assert.equal(drive.summary().categories.update,0);assert.equal(drive.summary().categories.create,1);
 }
});

test('eight MiB byte eviction never removes the complete scope metadata witnesses',async()=>{
 const files=new Map();let reads=0;
 for(let n=0;n<129;n++) {const bytes=new Uint8Array(65536);new DataView(bytes.buffer).setUint32(0,n);const id='invented-cache-'+n;
  files.set(id,{bytes,metadata:{id,name:id,trashed:false,parents:['invented-folder'],version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:await partitionDigest(bytes)}}});}
 const adapter={folderId:'invented-folder',readMetadata:async id=>structuredClone(files.get(id).metadata),readBytes:async id=>{reads++;return files.get(id).bytes.slice();},readMetadataSnapshot:async()=>new Map([...files].map(([id,f])=>[id,structuredClone(f.metadata)]))};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}}), token=await physical.beginVerification();
 for(const id of files.keys()){await physical.readMetadata(id,{maxBytes:16384});await physical.readBytes(id,{maxBytes:65536});}
 assert.equal(reads,129);await physical.readMetadata('invented-cache-0',{maxBytes:16384});await physical.readBytes('invented-cache-0',{maxBytes:65536});assert.equal(reads,130,'first body was evicted');
 for(let n=1;n<=33;n++)files.get(`invented-cache-${n}`).metadata.version='2';const beforeReverify=reads;await physical.closeVerification(token);assert.equal(reads,beforeReverify+33,'more than32 version-only changes trigger exact-byte revalidation');
});

test('scope invalidation while opening or draining cannot return a successful proof',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>{await gate;return new Map();}};
 const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
 const opening=physical.beginVerification();physical.invalidateReadCache();release();await assert.rejects(opening,{code:'verification-scope-closed'});
 const token=await physical.beginVerification();let finish;const read=new Promise(resolve=>{finish=resolve;});physical.trackRead(token,read);
 const closing=physical.closeVerification(token);physical.invalidateReadCache();finish();await assert.rejects(closing,{code:'verification-scope-closed'});
});

test('concurrent manifest assertions share the same unsettled closure and revalidation',async()=>{
 const drive=new HttpCatalogDrive(),app=lifecycle(drive);await app.start();const snapshot=await app.readPartitionedSnapshot();await snapshot.store.read(snapshot.rootHash);
 const file=[...drive.files.values()].find(f=>f.metadata.appProperties?.financeTrackerHash===snapshot.rootHash);file.metadata.version='2';
 const original=app.transactionAdapter.readMetadataSnapshot.bind(app.transactionAdapter);let unblock,entered;
 const gate=new Promise(resolve=>{unblock=resolve;}),started=new Promise(resolve=>{entered=resolve;});let once=true;
 app.transactionAdapter.readMetadataSnapshot=async()=>{if(once){once=false;entered();await gate;}return original();};
 const first=app.assertCurrentManifest(snapshot.manifest).then(()=> 'success',e=>e.code);await started;
 let settled=false;const second=app.assertCurrentManifest(snapshot.manifest).then(()=>{settled=true;return 'success';},e=>{settled=true;return e.code;});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(settled,false);
 unblock();assert.equal(await first,'success');assert.equal(await second,'success');assert.notEqual(app.state,'recovery-required');
 app.transactionAdapter.readMetadataSnapshot=original;await app.release();
});

test('manifest cache always reads fresh strict metadata and refetches changed versions',async()=>{
 const drive=new HttpCatalogDrive(),app=lifecycle(drive);await app.start();const physical=app.engine.physical,id=app.manifestFileId;
 physical.invalidateReadCache();const count=category=>drive.requests.filter(r=>r.category===category&&r.fileId===id).length;
 const first=await physical.readManifest(),media=count('media'),metadata=count('metadata');first.fill(0);
 const reused=await physical.readManifest();assert.notEqual(reused[0],0);assert.equal(count('media'),media);assert.equal(count('metadata'),metadata+1);
 drive.files.get(id).metadata.version=String(Number(drive.files.get(id).metadata.version)+1);
 await physical.readManifest();assert.equal(count('media'),media+1);assert.equal(count('metadata'),metadata+3);
 const name=drive.files.get(id).metadata.name;drive.files.get(id).metadata.name='unrelated';await assert.rejects(physical.readManifest(),{code:'manifest-metadata-mismatch'});
 drive.files.get(id).metadata.name=name;await physical.readManifest();assert.equal(count('media'),media+2,'error invalidates the cached bytes');
 await app.release();
});

test('final owner-await invalidation cannot authorize a closed verification',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const physical=createPhysicalDriveAdapter({folderId:'invented-folder',readMetadataSnapshot:async()=>new Map()},{manifestFileId:'unused',assertWritable:async()=>{entered();await gate;}});
 const token=await physical.beginVerification(),closing=physical.closeVerification(token);await started;physical.invalidateReadCache();release();await assert.rejects(closing,{code:'verification-scope-closed'});
});

test('immutable mutation checks ownership after asynchronous token acquisition',async()=>{
 const drive=new HttpCatalogDrive();let writable=true;
 const adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,fetchImpl:drive.fetch,accessToken:async()=>{writable=false;return 'invented-test-token';},visibilityDelayMs:0,visibilityMaxDelayMs:0});
 await assert.rejects(adapter.createImmutable({fileId:drive.idPrefix+'guard',name:'invented',kind:'snapshot-object',transactionId:'invented',content:EMPTY_CANONICAL_BYTES,expectedSha256:await partitionDigest(EMPTY_CANONICAL_BYTES),beforeMutation:async()=>{if(!writable)throw Object.assign(new Error('lost'),{code:'ownership-lost'});}}),{code:'ownership-lost'});
 assert.equal(drive.requests.length,0,'no POST or ambiguous-write retry after the denied final guard');
});

test('pointer mutation rechecks exact selected manifest after asynchronous token acquisition',async()=>{
 const drive=new HttpCatalogDrive(),app=lifecycle(drive);await app.start();const original=structuredClone(drive.files.get(app.manifestFileId));
 const expected=JSON.parse(new TextDecoder().decode(original.bytes));let tokens=0;
 app.transactionAdapter.accessToken=async()=>{if(++tokens===2){const file=drive.files.get(app.manifestFileId);file.bytes=new TextEncoder().encode(JSON.stringify({...expected,copyId:'invented-changed-copy'}));file.metadata.version=String(Number(file.metadata.version)+1);file.metadata.size=String(file.bytes.length);}return 'invented-test-token';};
 const updates=drive.summary().categories.update;
 await assert.rejects(app.transactionAdapter.publishManifest(app.manifestFileId,expected,{beforeMutation:async()=>{const current=JSON.parse(new TextDecoder().decode(await app.engine.physical.readManifest()));if(current.copyId!==expected.copyId)throw Object.assign(new Error('changed'),{code:'base-conflict'});}}),{code:'base-conflict'});
 assert.equal(drive.summary().categories.update,updates);app.transactionAdapter.accessToken=()=> 'invented-test-token';drive.files.set(app.manifestFileId,original);await app.release();
});


for(const version of [1,2])test(`interrupted initialization marker ${version} recovers v5 or refuses obsolete profiles without writing`,async()=>{
 const {canonicalPartitionVerificationPlans}=await import('../js/canonical-paged-storage.mjs');
 const {CanonicalLedgerStore}=await import('../js/canonical-ledger-storage.mjs');
 const {replayFixture}=await import('./helpers/ledger-replay-fixtures.mjs');
 const drive=new HttpCatalogDrive();drive.stopAfterMutation=2;
 const make=()=>new ApplicationStorageLifecycle({syntheticOnly:true,folderName:'Invented synthetic interrupted profile',folderId:drive.folderId,
  accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,makeManifest:()=>{},pagedCanonical:true,verificationPlans:canonicalPartitionVerificationPlans(),
  initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},
  setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});
 const app=make();await assert.rejects(app.start());drive.reboot();
 const file=[...drive.files.values()].find(f=>f.metadata.name===PAGED_MANIFEST_NAME),marker=JSON.parse(new TextDecoder().decode(file.bytes));
 assert.equal(marker.format,PAGED_INITIALIZATION_FORMAT);assert.equal(marker.version,2);assert.equal(marker.canonicalProfile,'partitions-v5');
 if(version===1) {
  const {canonicalizeJcs}=await import('../js/transaction-protocol.mjs');marker.version=1;delete marker.canonicalProfile;
  file.bytes=new TextEncoder().encode(canonicalizeJcs(marker));file.metadata.size=String(file.bytes.length);file.metadata.version='2';file.metadata.appProperties.financeTrackerHash=await partitionDigest(file.bytes);
 }
 if(version===1) {
  const before=structuredClone(drive.files),mutations=drive.mutations;
  await assert.rejects(app.recover());assert.equal(drive.mutations,mutations);assert.deepEqual(drive.files,before);return;
 }
 await app.recover();const snapshot=await app.readPartitionedSnapshot();
 assert.equal(snapshot.semanticVersion,PAGED_CANONICAL_VERIFIER);await app.assertCurrentManifest(snapshot.manifest);
 const store=new CanonicalLedgerStore({lifecycle:app});assert.equal(await store.load(),null);await store.save(replayFixture(2).ledger);
 assert.equal(store.layout,'partitions-v5');const root=store.base.root;await app.release();
 const reopened=make();await reopened.start();const cold=new CanonicalLedgerStore({lifecycle:reopened});await cold.load();assert.equal(cold.base.root,root);assert.equal(cold.layout,store.layout);await reopened.release();
});

test('missing v5 verifier registration refuses a copy before any financial write',async()=>{
 const {canonicalPartitionVerificationPlans}=await import('../js/canonical-paged-storage.mjs');
 const drive=new HttpCatalogDrive(),source=lifecycle(drive);await source.start();await source.release();
 const financial=()=>new Map([...drive.files].filter(([,file])=>file.metadata.appProperties?.financeTrackerSession!=='v1'));
 const before=structuredClone(financial()),legacy=new Map([['unsupported-invented-verifier',async()=>assert.fail('unknown verifier must not run')]]);
 const old=new ApplicationStorageLifecycle({syntheticOnly:true,folderName:'Invented synthetic old reader',folderId:drive.folderId,
  accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,makeManifest:()=>{},pagedCanonical:true,verificationPlans:legacy,
  initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},
  setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});
 await assert.rejects(old.start(),{code:'verification-plan-unavailable'});assert.deepEqual(financial(),before);
 await assert.rejects(old.release(),{code:'recovery-required'});
});
