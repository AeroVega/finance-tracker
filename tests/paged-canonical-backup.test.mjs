import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {initializePagedCanonicalCopy,inspectPagedCanonicalCopy,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {exportPagedCanonicalArchive,restorePagedCanonicalArchive,backupPagedCanonicalCopy,verifyPagedCopy} from '../js/paged-canonical-backup.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
const gate=fn=>fn(),guard=async()=>{};
const plans=()=>canonicalPartitionVerificationPlans();
function target(name) {
 const drive=new HttpCatalogDrive({folderId:name,idPrefix:name+'-file-'});
 const adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0});
 return {drive,adapter};
}
async function fixture() {
 const source=target('invented-source');
 const manifestFileId=await initializePagedCanonicalCopy({adapter:source.adapter,guard});
 const options={sourceAdapter:source.adapter,sourceManifestFileId:manifestFileId,withSourceLock:gate,assertSourceWritable:guard,verificationPlans:plans()};
 return {...source,manifestFileId,options};
}
async function archive(options) {const chunks=[];await exportPagedCanonicalArchive({...options,sink:{write:async c=>chunks.push(c)}});return chunks;}
function restore(source,dest,extra={}) {return restorePagedCanonicalArchive({source,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans(),...extra});}
const published=drive=>[...drive.files.values()].filter(x=>x.metadata?.name==='ft-synthetic-paged-manifest.json');
function application(f) {return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:withSourceEvidenceVerification(plans()),
 folderName:'Invented synthetic archive reopen',folderId:f.adapter.folderId,manifestFileId:f.manifestFileId,accessToken:()=> 'invented-test-token',fetchImpl:f.drive.fetch,
 makeManifest:()=>{},initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},
 setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});}
test('real Drive adapters copy v5 directly, rebind locators and reopen without source',async()=>{
 const f=await fixture(),dest=target('invented-direct');
 const originalCopyId=(await f.adapter.readJson(f.manifestFileId)).copyId;
 const result=await backupPagedCanonicalCopy({...f.options,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard});
 assert.equal(result.manifest.version,4);assert.equal(result.manifest.role,'backup');
 f.drive.stopped=true;
 assert.equal((await inspectPagedCanonicalCopy(dest.adapter)).manifestFileId,result.manifestFileId);
 assert.equal(await verifyPagedCopy({adapter:dest.adapter,manifest:result.manifest,verificationPlans:plans()}),true);
 assert.equal(published(dest.drive).length,1);
 const primary=target('invented-from-backup');
 const restored=await backupPagedCanonicalCopy({sourceAdapter:dest.adapter,sourceManifestFileId:result.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,
   targetAdapter:primary.adapter,withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans(),role:'primary'});
 assert.equal(restored.manifest.role,'primary');assert.equal((await inspectPagedCanonicalCopy(dest.adapter)).manifest.role,'backup');
 const collision=target('invented-ancestor-collision');
 await assert.rejects(backupPagedCanonicalCopy({sourceAdapter:dest.adapter,sourceManifestFileId:result.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,
   targetAdapter:collision.adapter,withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans(),role:'primary',newCopyId:originalCopyId}),e=>e.code==='invalid-copy-identity'||e.cause?.code==='invalid-copy-identity');
 assert.equal(published(collision.drive).length,0);
});
test('actual framed file bytes restore source-offline with fresh physical IDs',async()=>{
 const f=await fixture(),chunks=await archive(f.options),dest=target('invented-restore');f.drive.stopped=true;
 const result=await restore(chunks,dest);
 assert.equal(result.manifest.revision,'0');assert.equal(result.manifest.role,'primary');
 assert.equal(published(dest.drive).length,1);
 assert.ok([...dest.drive.files.keys()].every(id=>!f.drive.files.has(id)));
 await assert.rejects(restore(chunks,dest),e=>e.cause?.code==='fresh-destination-required');
 assert.equal(published(dest.drive).length,1);
});
test('terminal corruption, truncation and ownership interruption never publish',async()=>{
 const f=await fixture(),chunks=await archive(f.options);
 for(const [name,data] of [['truncated',chunks.slice(0,-1)],['corrupt',[...chunks.slice(0,-1),new Uint8Array(32)]]]) {
   const dest=target('invented-'+name);await assert.rejects(restore(data,dest));assert.equal(published(dest.drive).length,0);
   assert.ok(dest.drive.files.size>0);
 }
 const dest=target('invented-interruption');dest.drive.stopAfterMutation=3;await assert.rejects(restore(chunks,dest));dest.drive.reboot();
 assert.equal(published(dest.drive).length,0);await assert.rejects(restore(chunks,dest));
});
test('source change prevents stream sealing and destination publication',async()=>{
 const f=await fixture(),dest=target('invented-source-conflict');
 const original=f.adapter.readBytes.bind(f.adapter);let reads=0;
 f.adapter.readBytes=async(id,opts)=>{const raw=await original(id,opts);if(id===f.manifestFileId&&++reads===2){const m=JSON.parse(new TextDecoder().decode(raw));m.copyId='invented-changed';return new TextEncoder().encode(JSON.stringify(m));}return raw;};
 await assert.rejects(backupPagedCanonicalCopy({...f.options,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard}));
 assert.equal(published(dest.drive).length,0);
});
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent} from '../js/canonical-import.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {readVerifiedPartitionedLedger} from '../js/canonical-paged-storage.mjs';
test('ambiguous final publication never retries and leaves exactly one manifest',async()=>{
 const f=await fixture(),chunks=await archive(f.options),reference=target('invented-count');await restore(chunks,reference);
 const dest=target('invented-ambiguous');dest.drive.stopAfterMutation=reference.drive.mutations;
 await assert.rejects(restore(chunks,dest));dest.drive.reboot();
 assert.equal(published(dest.drive).length,1);
 const existing=await inspectPagedCanonicalCopy(dest.adapter);await verifyPagedCopy({adapter:dest.adapter,manifest:existing.manifest,verificationPlans:plans()});
 await assert.rejects(restore(chunks,dest),e=>e.cause?.code==='fresh-destination-required');assert.equal(published(dest.drive).length,1);
});
test('moved/renamed source manifests and external original retention are not silently exported',async()=>{
 const f=await fixture();f.drive.files.get(f.manifestFileId).metadata.name='invented-wrong-name';
 await assert.rejects(archive(f.options),{code:'manifest-metadata-mismatch'});
 const g=await fixture();g.drive.files.set('invented-external-original',{bytes:new Uint8Array(),metadata:{id:'invented-external-original',name:'ft-synthetic-original-imports.json',parents:[g.adapter.folderId],trashed:false,appProperties:{financeTrackerKind:'synthetic-original-import-index'}}});
 await assert.rejects(archive(g.options),{code:'external-original-retention-not-supported'});
});
test('direct copy keeps source ownership gate through target publication and rechecks it',async()=>{
 const f=await fixture(),dest=target('invented-gated');let held=false,finished=false;
 const create=dest.adapter.createImmutable.bind(dest.adapter);
 dest.adapter.createImmutable=async input=>{assert.equal(held,true);await create(input);if(input.kind==='paged-canonical-manifest')finished=true;};
 await backupPagedCanonicalCopy({...f.options,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,
   withSourceLock:async fn=>{held=true;try{return await fn();}finally{assert.equal(finished,true);held=false;}},
   assertSourceWritable:async()=>assert.equal(held,true)});
 const lost=target('invented-lost-owner');let owned=true;
 await assert.rejects(backupPagedCanonicalCopy({...f.options,targetAdapter:lost.adapter,withTargetLock:gate,assertTargetWritable:guard,
   assertSourceWritable:async()=>{if(!owned)throw Object.assign(new Error('Invented owner lost'),{code:'ownership-lost'});},beforePublish:async()=>{owned=false;}}),{code:'ownership-lost'});
 assert.equal(published(lost.drive).length,0);
});
test('source changed after a complete sealed stream still prevents target publication',async()=>{
 const f=await fixture(),dest=target('invented-final-source-change');
 await assert.rejects(backupPagedCanonicalCopy({...f.options,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,
   beforePublish:async()=>{const file=f.drive.files.get(f.manifestFileId);const m=JSON.parse(new TextDecoder().decode(file.bytes));m.copyId='invented-later-copy';file.bytes=new TextEncoder().encode(JSON.stringify(m));file.metadata.size=String(file.bytes.length);file.metadata.version=String(Number(file.metadata.version)+1);}}),{code:'source-changed'});
 assert.equal(published(dest.drive).length,0);
});

test('same-bytes source manifest version changes are not treated as a pinned source',async()=>{
 const f=await fixture(),dest=target('invented-version-only');
 await assert.rejects(backupPagedCanonicalCopy({...f.options,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,
   beforePublish:async()=>{const file=f.drive.files.get(f.manifestFileId);file.metadata.version=String(Number(file.metadata.version)+1);}}),{code:'source-changed'});
 assert.equal(published(dest.drive).length,0);
});
import {encodeFramedBackup,restoreFramedBackup} from '../js/framed-backup-stream.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';
import {PagedApplicationStorage} from '../js/paged-application-storage.mjs';
async function unpack(chunks){
 const records=new Map(),objects=new Map();let root;
 await restoreFramedBackup({source:chunks,staging:{begin:async input=>{root=input.root;},write:async(raw,{descriptor})=>{const hash=await partitionDigest(raw);records.set(hash,raw);objects.set(descriptor.kind+':'+hash,{hash,bytes:raw,descriptor});return hash;},read:async hash=>records.get(hash)},verifyStructure:async()=>true});
 return {root,records,objects};
}
test('physical receipt/plan provenance is required, source-offline verified and not replaceable by logical history',async()=>{
 const f=await fixture();
 const engine=new PagedApplicationStorage({adapter:f.adapter,assertWritable:guard,verificationPlans:plans(),manifestFileId:f.manifestFileId});engine.binding();
 const initial=await engine.readSnapshot();
 await engine.transact({expectedBase:initial.manifest,rootHash:initial.rootHash,objects:[],preparationStore:{read:()=>assert.fail('no new application bodies')},operation:'synthetic-canonical-import'});
 const framed=await archive(f.options),decoded=await unpack(framed);
 const evidence=JSON.parse(new TextDecoder().decode(decoded.records.get(decoded.root.sourceEvidence.sha256)));
 const mapping=createImmutablePageTree({read:async hash=>decoded.records.get(hash)});
 let receipt,plan;
 for await(const [,entry] of mapping.entries(evidence.metadataRoot)) {
   const raw=decoded.records.get(entry.sha256);assert.ok(raw);
   const body=JSON.parse(new TextDecoder().decode(raw));
   if(body.format==='finance-tracker-copy-root-receipt')receipt=entry;
   if(body.format==='finance-tracker-copy-object-plan')plan=entry;
 }
 assert.ok(receipt);assert.ok(plan);
 f.drive.stopped=true;
 for(const [name,missing] of [['receipt',receipt],['plan',plan]]) {
   const dest=target('invented-missing-'+name);
   const damaged=[...decoded.objects.values()].filter(item=>!(item.descriptor.kind==='data-object'&&item.hash===missing.sha256));
   await assert.rejects(restore(encodeFramedBackup({root:decoded.root,objects:damaged,limits:{maxObjectBytes:65536}}),dest));
   assert.equal(published(dest.drive).length,0);
 }
 const additions=new Map();
 const proofStore={read:async hash=>additions.get(hash)??decoded.records.get(hash),write:async raw=>{const hash=await partitionDigest(raw);additions.set(hash,raw);return hash;}};
 const proofTree=createImmutablePageTree(proofStore);
 const unrelated={sha256:decoded.root.canonical.sha256,metadata:{id:'invented-unrelated',name:'invented-extra',parents:[f.adapter.folderId],trashed:false,version:'1',
   size:String(decoded.records.get(decoded.root.canonical.sha256).length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerHash:decoded.root.canonical.sha256}}};
 const metadataRoot=await proofTree.set(evidence.metadataRoot,'invented-unrelated',unrelated);
 const proofHash=await proofStore.write(new TextEncoder().encode(JSON.stringify({...evidence,metadataRoot})));
 const extra=target('invented-disconnected-provenance');
 await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,sourceEvidence:{version:1,sha256:proofHash}},
   objects:[...decoded.objects.values(),...[...additions].map(([hash,raw])=>({hash,bytes:raw,descriptor:{kind:'data-object',identity:hash}}))],limits:{maxObjectBytes:65536}}),extra),
   error=>error.cause?.code==='source-evidence-unreferenced-file');
 assert.equal(published(extra.drive).length,0);
 const stripped=target('invented-stripped-evidence');
 await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,sourceEvidence:null},objects:decoded.objects.values(),limits:{maxObjectBytes:65536}}),stripped));
 assert.equal(published(stripped.drive).length,0);
 const dest=target('invented-physical-evidence-restored');const result=await restore(framed,dest);
 assert.deepEqual(result.manifest.sourceEvidence,decoded.root.sourceEvidence);
 await verifyPagedCopy({adapter:dest.adapter,manifest:result.manifest,verificationPlans:plans()});
});
import {withSourceEvidenceVerification} from '../js/paged-canonical-backup.mjs';
test('concurrent public provenance audits cannot share proof state or borrow another store bytes',async()=>{
 const f=await fixture(),decoded=await unpack(await archive(f.options));
 const verifier=withSourceEvidenceVerification(plans());
 const root=decoded.root.sourceEvidence.sha256;
 const evidence=JSON.parse(new TextDecoder().decode(decoded.records.get(root)));
 const input={manifest:{copyId:'invented-audit-target',databaseId:decoded.root.databaseId},evidenceRoot:root,
   readObject:async q=>{await Promise.resolve();const raw=decoded.records.get(q.sha256);assert.ok(raw);return raw;}};
 await Promise.all([verifier.verifySourceEvidence(input),verifier.verifySourceEvidence({...input,manifest:{...input.manifest,copyId:'invented-second-target'}})]);
 const result=await Promise.allSettled([verifier.verifySourceEvidence(input),verifier.verifySourceEvidence({...input,
   readObject:async q=>{if(q.sha256===evidence.manifestSha256)throw Object.assign(new Error('Invented missing bytes'),{code:'missing-in-second-store'});return input.readObject(q);}})]);
 assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.equal(result[1].reason.code,'missing-in-second-store');
});
test('target evidence hash-binding changes at the final publication boundary prevent manifest creation',async()=>{
 const f=await fixture(),chunks=await archive(f.options),dest=target('invented-target-version');
 await assert.rejects(restore(chunks,dest,{beforePublish:async()=>{
   const file=[...dest.drive.files.values()].find(item=>item.metadata.appProperties?.financeTrackerKind==='snapshot-object');
   assert.ok(file);
   // Identical-byte version drift is benign; a changed immutable hash is not.
   file.metadata.appProperties.financeTrackerHash='0'.repeat(64);
   file.metadata.version=String(Number(file.metadata.version)+1);
 }}),{code:'verification-metadata-changed'});
 assert.equal(published(dest.drive).length,0);
});
test('descriptor reuse remains private to one audit and cannot mask a changed or missing mapping',async()=>{
 const f=await fixture(),decoded=await unpack(await archive(f.options));
 const verifier=withSourceEvidenceVerification(plans()),root=decoded.root.sourceEvidence.sha256;
 const evidence=JSON.parse(new TextDecoder().decode(decoded.records.get(root)));
 const input={manifest:{copyId:'invented-private-cache-target',databaseId:decoded.root.databaseId},evidenceRoot:root,
   readObject:async q=>decoded.records.get(q.sha256)};
 await verifier.verifySourceEvidence(input);
 // Reusing the public registry is allowed; reusing its earlier source bytes or
 // parsed descriptor records would incorrectly hide this missing tree page.
 let missingReads=0;
 await assert.rejects(verifier.verifySourceEvidence({...input,readObject:async q=>{
   if(q.sha256===evidence.metadataRoot){missingReads++;throw Object.assign(new Error('Invented missing mapping'),{code:'missing-mapping'});}
   return input.readObject(q);
 }}),{code:'missing-mapping'});
 assert.equal(missingReads,1);
 const additions=new Map(),store={read:async hash=>additions.get(hash)??decoded.records.get(hash),
   write:async raw=>{const hash=await partitionDigest(raw);additions.set(hash,raw);return hash;}};
 const tree=createImmutablePageTree(store);
 const prior=await tree.get(evidence.metadataRoot,evidence.manifestFileId);
 const metadataRoot=await tree.set(evidence.metadataRoot,evidence.manifestFileId,
   {...prior,metadata:{...prior.metadata,id:'invented-wrong-alias'}});
 const changed=await store.write(new TextEncoder().encode(JSON.stringify({...evidence,metadataRoot})));
 await assert.rejects(verifier.verifySourceEvidence({...input,evidenceRoot:changed,
   readObject:async q=>store.read(q.sha256)}),{code:'source-evidence-missing-file'});
 // A failed independent audit also must not poison the original read source.
 await verifier.verifySourceEvidence(input);
});

for(const version of [5])test(`canonical v${version} archives retain exact history, profile and financial results through source-offline app reopen`,async()=>{
 const f=await fixture({version}),app=application(f);await app.start();
 let expected;const snapshots=[];
 try {
   const store=new CanonicalLedgerStore({lifecycle:app});assert.equal(await store.load(),null);
   expected=replayFixture(2).ledger;
   for(const activity of expected.activities)expected=applyFinancialEvent(expected,{activityId:activity.activityId,type:'classification',activityKind:'spending',commandId:'invented-classify-'+activity.activityId});
   await store.save(expected);snapshots.push(structuredClone(expected));
   expected=applyFinancialEvent(expected,{activityId:expected.activities[0].activityId,type:'bank-correction',amountText:'-10.03',
     commandId:'invented-archive-correction',evidence:{rationale:'Invented archive correction'}});
   await store.save(expected);snapshots.push(structuredClone(expected));
 } finally {await app.release();}
 const decoded=await unpack(await archive(f.options));
 assert.equal(decoded.root.profile,`canonical${version}-physical4`);assert.equal(decoded.root.canonical.version,version);
 assert.equal(decoded.root.protocol.version,4);assert.equal(decoded.root.catalog,null);
 const commits=[...decoded.objects.values()].filter(item=>item.descriptor.kind==='commit-record').map(item=>JSON.parse(new TextDecoder().decode(item.bytes)))
   .sort((a,b)=>Number(a.revision)-Number(b.revision));
 assert.equal(commits.length,3);
 for(let i=1;i<commits.length;i++) {
   assert.equal(commits[i].semanticVersion,`canonical-partitions-v${version}`);
   const audited=await readVerifiedPartitionedLedger({read:async hash=>decoded.records.get(hash)},commits[i].root);
   assert.deepEqual(audited.ledger,snapshots[i-1]);
 }
 f.drive.stopped=true;
 const dest=target(`invented-v${version}-populated-restore`);
 const result=await restore(encodeFramedBackup({root:decoded.root,objects:decoded.objects.values()}),dest);
 assert.equal(result.manifest.root,decoded.root.canonical.sha256);assert.equal(result.manifest.headCommit.sha256,decoded.root.protocol.sha256);
 const reopened=application({...dest,manifestFileId:result.manifestFileId});await reopened.start();
 try {
   const store=new CanonicalLedgerStore({lifecycle:reopened});assert.deepEqual(await store.load(),expected);assert.equal(store.layout,`partitions-v${version}`);
   const {createCanonicalMonthIndex}=await import('../js/canonical-month-index.mjs');
   const scope={start:'2026-01-01',end:'2026-01-31',currency:'USD'};
   assert.deepEqual(store.monthIndex.report(scope),createCanonicalMonthIndex(expected).report(scope));
   assert.equal(store.monthIndex.report(scope).report.cash,'-22.37');
 } finally {await reopened.release();}
 const again=await unpack(await archive({sourceAdapter:dest.adapter,sourceManifestFileId:result.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,verificationPlans:plans()}));
 assert.equal(again.root.profile,decoded.root.profile);assert.equal(again.root.canonical.sha256,decoded.root.canonical.sha256);
 for(const item of decoded.objects.values())if(item.descriptor.kind==='commit-record')assert.deepEqual(again.objects.get('commit-record:'+item.hash),item);
});

test('rehashed physical archive profile substitutions fail even for shared empty canonical bytes',async()=>{
 for(const version of [5]) {
   const f=await fixture({version}),decoded=await unpack(await archive(f.options)),other=version===4?5:4;
   const dest=target(`invented-profile-substitution-${version}`);
   await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,profile:`canonical${other}-physical4`,canonical:{...decoded.root.canonical,version:other}},
     objects:decoded.objects.values()}),dest),e=>e.cause?.code==='unsupported-root-profile');
   assert.equal(published(dest.drive).length,0);
   const head=JSON.parse(new TextDecoder().decode(decoded.records.get(decoded.root.protocol.sha256)));
   for(const semanticVersion of [`canonical-partitions-v${other}`,'canonical-partitions-v6']) {
     const raw=new TextEncoder().encode(canonicalizeJcs({...head,semanticVersion})),hash=await partitionDigest(raw);
     const records=[...[...decoded.objects.values()].filter(item=>!(item.descriptor.kind==='commit-record'&&item.hash===decoded.root.protocol.sha256)),
       {hash,bytes:raw,descriptor:{kind:'commit-record',identity:hash}}];
     const mismatched=target(`invented-head-substitution-${version}-${semanticVersion}`);
     await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,protocol:{version:4,sha256:hash}},objects:records}),mismatched),
       e=>e.cause?.code==='unsupported-canonical-profile');
     assert.equal(published(mismatched.drive).length,0);
   }
 }
});

test('v5 restore checks every durable boundary and never retries an uncertain manifest',async t=>{
 const f=await fixture(),chunks=await archive(f.options),probe=target('invented-restore-boundaries');await restore(chunks,probe);
 const boundaries=probe.drive.mutations;
 for(const phase of ['before','after'])for(let at=1;at<=boundaries;at++) {
   const dest=target(`invented-restore-${phase}-${at}`);
   if(phase==='after')dest.drive.stopAfterMutation=at;
   else {let count=0;dest.drive.beforeResponse=({category})=>{if(['create','update'].includes(category)&&++count===at){dest.drive.stopped=true;dest.drive.check();}};}
   await assert.rejects(restore(chunks,dest));dest.drive.beforeResponse=null;dest.drive.reboot();
   const complete=phase==='after'&&at===boundaries;
   assert.equal(published(dest.drive).length,complete?1:0);
   const preserved=new Map([...dest.drive.files].map(([id,file])=>[id,file.bytes.slice()]));
   if(complete) {
     const found=await inspectPagedCanonicalCopy(dest.adapter);await verifyPagedCopy({adapter:dest.adapter,manifest:found.manifest,verificationPlans:plans()});
   }
   if(preserved.size) {
     const mutations=dest.drive.mutations;
     await assert.rejects(restore(chunks,dest),e=>e.cause?.code==='fresh-destination-required');
     assert.equal(dest.drive.mutations,mutations);
     for(const [id,raw] of preserved)assert.deepEqual(dest.drive.files.get(id).bytes,raw);
   } else await restore(chunks,dest);
 }
 t.diagnostic(`V5 restore durable write boundaries checked before and after: ${boundaries}`);
});

const copyOptions=(f,dest)=>({sourceAdapter:f.adapter,sourceManifestFileId:f.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,
 targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans()});
for(const operation of ['backup'])for(const boundary of ['target-close','manifest-id','manifest-token'])test(`${operation} rechecks source pin at final publication after ${boundary}`,async()=>{
 const f=await fixture(),dest=target(`invented-late-source-${operation}-${boundary}`);
 let armed=false,changed=false,creatingManifest=false;
 const change=()=>{if(armed&&!changed){const file=f.drive.files.get(f.manifestFileId);file.metadata.version=String(Number(file.metadata.version)+1);changed=true;}};
 if(boundary==='target-close') {
   const read=dest.adapter.readMetadataSnapshot.bind(dest.adapter);dest.adapter.readMetadataSnapshot=async(...args)=>{
     const result=await read(...args);if(armed)assert.equal(published(dest.drive).length,0);change();return result;
   };
 } else if(boundary==='manifest-id') {
   const allocate=dest.adapter.allocateFileId.bind(dest.adapter);dest.adapter.allocateFileId=async(...args)=>{const result=await allocate(...args);change();return result;};
 } else {
   const create=dest.adapter.createImmutable.bind(dest.adapter);dest.adapter.createImmutable=async input=>{if(input.kind===PAGED_MANIFEST_KIND)creatingManifest=true;return create(input);};
   dest.adapter.accessToken=async()=>{if(creatingManifest)change();return 'invented-test-token';};
 }
 const options={...copyOptions(f,dest),beforePublish:async()=>{armed=true;}};
 await assert.rejects(backupPagedCanonicalCopy(options),{code:'source-changed'});
 assert.equal(changed,true);assert.equal(published(dest.drive).length,0);assert.ok(dest.drive.files.size>0);
 const preserved=new Map([...dest.drive.files].map(([id,file])=>[id,file.bytes.slice()]));
 await assert.rejects(backupPagedCanonicalCopy(copyOptions(f,dest)));
 for(const [id,raw] of preserved)assert.deepEqual(dest.drive.files.get(id).bytes,raw);
});

test('target ownership remains guarded after the final source publication check',async()=>{
 const f=await fixture(),dest=target('invented-target-lost-during-source-guard');let creatingManifest=false,owned=true,lost=false;
 const create=dest.adapter.createImmutable.bind(dest.adapter);dest.adapter.createImmutable=async input=>{if(input.kind===PAGED_MANIFEST_KIND)creatingManifest=true;return create(input);};
 const read=f.adapter.readMetadata.bind(f.adapter);f.adapter.readMetadata=async(...args)=>{
   const result=await read(...args);if(creatingManifest){owned=false;lost=true;}return result;
 };
 await assert.rejects(backupPagedCanonicalCopy({...copyOptions(f,dest),assertTargetWritable:async()=>{
   if(!owned)throw Object.assign(new Error('Invented late owner loss'),{code:'ownership-lost'});
 }}),{code:'ownership-lost'});
 assert.equal(lost,true);assert.equal(published(dest.drive).length,0);
});

for(const operation of ['backup'])test(`${operation} reports source loss after publication without retrying or removing the committed target`,async()=>{
 const f=await fixture(),dest=target(`invented-source-lost-after-${operation}`);
 let changed=false;const create=dest.adapter.createImmutable.bind(dest.adapter);
 dest.adapter.createImmutable=async input=>{
   const result=await create(input);
   if(input.kind===PAGED_MANIFEST_KIND){const file=f.drive.files.get(f.manifestFileId);file.metadata.version=String(Number(file.metadata.version)+1);changed=true;}
   return result;
 };
 await assert.rejects(backupPagedCanonicalCopy(copyOptions(f,dest)),{code:'source-changed'});
 assert.equal(changed,true);assert.equal(published(dest.drive).length,1);
 const found=await inspectPagedCanonicalCopy(dest.adapter),raw=dest.drive.files.get(found.manifestFileId).bytes.slice();
 await verifyPagedCopy({adapter:dest.adapter,manifest:found.manifest,verificationPlans:plans()});
 await assert.rejects(backupPagedCanonicalCopy(copyOptions(f,dest)));
 assert.equal(published(dest.drive).length,1);assert.deepEqual(dest.drive.files.get(found.manifestFileId).bytes,raw);
});

test('final source validation stays inside the target gate after manifest readback',async()=>{
 const f=await fixture(),dest=target('invented-final-source-gate');let targetHeld=false,afterPublicationReads=0;
 const read=f.adapter.readMetadata.bind(f.adapter);f.adapter.readMetadata=async(...args)=>{
   if(published(dest.drive).length){assert.equal(targetHeld,true);afterPublicationReads++;}return read(...args);
 };
 const result=await backupPagedCanonicalCopy({...copyOptions(f,dest),withTargetLock:async fn=>{
   targetHeld=true;try{return await fn();}finally{targetHeld=false;}
 }});
 assert.ok(afterPublicationReads>0);assert.equal(targetHeld,false);assert.equal(result.manifestFileId,published(dest.drive)[0].metadata.id);
});

for(const mutation of ['folder','abort'])test(`final copy completion rejects ${mutation} changes during its last async guard`,async()=>{
 const f=await fixture(),dest=target(`invented-final-guard-${mutation}`),folderId=dest.adapter.folderId,controller=new AbortController();
 let afterTargetClosure=false,changed=false,targetHeld=false;
 const readTarget=dest.adapter.readMetadataSnapshot.bind(dest.adapter);dest.adapter.readMetadataSnapshot=async(...args)=>{
   const result=await readTarget(...args);if(published(dest.drive).length)afterTargetClosure=true;return result;
 };
 const readSource=f.adapter.readMetadata.bind(f.adapter);f.adapter.readMetadata=async(...args)=>{
   const result=await readSource(...args);
   if(afterTargetClosure&&!changed){assert.equal(targetHeld,true);if(mutation==='folder')dest.adapter.folderId='invented-other-target';changed=true;}
   return result;
 };
 await assert.rejects(backupPagedCanonicalCopy({...copyOptions(f,dest),signal:controller.signal,withTargetLock:async fn=>{
   targetHeld=true;try{return await fn();}finally{targetHeld=false;}
 },assertTargetWritable:async()=>{
   if(mutation==='abort'&&changed){await Promise.resolve();controller.abort();}
 }}),mutation==='folder'?{code:'copy-mismatch'}:{name:'AbortError'});
 assert.equal(changed,true);assert.equal(published(dest.drive).length,1);
 dest.adapter.folderId=folderId;const found=await inspectPagedCanonicalCopy(dest.adapter),raw=dest.drive.files.get(found.manifestFileId).bytes.slice();
 assert.equal(found.manifest.storageBinding.folderId,folderId);
 await verifyPagedCopy({adapter:dest.adapter,manifest:found.manifest,verificationPlans:plans()});
 await assert.rejects(backupPagedCanonicalCopy(copyOptions(f,dest)));
 assert.equal(published(dest.drive).length,1);assert.deepEqual(dest.drive.files.get(found.manifestFileId).bytes,raw);
});

for(const phase of ['entry','completion'])test(`restore keeps its entry destination pinned through target gate ${phase}`,async()=>{
 const f=await fixture(),chunks=await archive(f.options),dest=target(`invented-target-gate-${phase}`),folderId=dest.adapter.folderId;
 await assert.rejects(restore(chunks,dest,{withTargetLock:async fn=>{
   if(phase==='entry'){dest.adapter.folderId='invented-other-target';return fn();}
   const result=await fn();dest.adapter.folderId='invented-other-target';return result;
 }}),{code:'copy-mismatch'});
 assert.equal(published(dest.drive).length,phase==='entry'?0:1);
 if(phase==='entry')assert.equal(dest.drive.mutations,0);
 else {dest.adapter.folderId=folderId;const found=await inspectPagedCanonicalCopy(dest.adapter);await verifyPagedCopy({adapter:dest.adapter,manifest:found.manifest,verificationPlans:plans()});}
});

test('v5 restore refuses absent provenance and rehashed unexpected source evidence fields',async()=>{
 const f=await fixture(),decoded=await unpack(await archive(f.options));
 const absent=target('invented-no-source-evidence');
 await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,sourceEvidence:null},objects:decoded.objects.values()}),absent),e=>e.cause?.code==='source-evidence-required');
 assert.equal(published(absent.drive).length,0);
 const evidence=JSON.parse(new TextDecoder().decode(decoded.records.get(decoded.root.sourceEvidence.sha256)));
 const raw=new TextEncoder().encode(canonicalizeJcs({...evidence,unexpected:true})),hash=await partitionDigest(raw);
 const objects=[...[...decoded.objects.values()].filter(item=>item.hash!==decoded.root.sourceEvidence.sha256),{hash,bytes:raw,descriptor:{kind:'data-object',identity:hash}}];
 const extra=target('invented-extra-source-evidence');
 await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,sourceEvidence:{version:1,sha256:hash}},objects}),extra),e=>e.cause?.code==='source-evidence-format');
 assert.equal(published(extra.drive).length,0);
});

test('v5 archive without source evidence is refused before any destination preparation',async()=>{
 const f=await fixture(),decoded=await unpack(await archive(f.options)),dest=target('invented-no-source-evidence');
 const before=structuredClone(dest.drive.files),mutations=dest.drive.mutations;
 await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,sourceEvidence:null},objects:decoded.objects.values()}),dest),
   e=>e.cause?.code==='source-evidence-required');
 assert.equal(dest.drive.mutations,mutations);assert.deepEqual(dest.drive.files,before);
});
