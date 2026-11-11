import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {initializePagedCanonicalCopy,inspectPagedCanonicalCopy,PAGED_INITIALIZATION_FORMAT,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {exportPagedCanonicalArchive,restorePagedCanonicalArchive,backupPagedCanonicalCopy,verifyPagedCopy,verifyCanonicalMigrationEvidence} from '../js/paged-canonical-backup.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
const gate=fn=>fn(),guard=async()=>{};
const plans=()=>canonicalPartitionVerificationPlans({verifyMigrationEvidence:verifyCanonicalMigrationEvidence});
function target(name) {
 const drive=new HttpCatalogDrive({folderId:name,idPrefix:name+'-file-'});
 const adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0});
 return {drive,adapter};
}
async function fixture({version=5}={}) {
 const source=target('invented-source');
 if(version===4) {
   // Recover an actual old initialization intent rather than relabeling a v5
   // commit or changing any already-published source history.
   const marker={format:PAGED_INITIALIZATION_FORMAT,version:1,syntheticOnly:true,folderId:source.adapter.folderId,
     databaseId:crypto.randomUUID(),copyId:crypto.randomUUID(),transactionId:crypto.randomUUID(),
     rootFileId:await source.adapter.allocateFileId(),commitFileId:await source.adapter.allocateFileId()};
   const raw=new TextEncoder().encode(canonicalizeJcs(marker));
   await source.adapter.createImmutable({fileId:await source.adapter.allocateFileId(),name:PAGED_MANIFEST_NAME,kind:PAGED_MANIFEST_KIND,
     transactionId:marker.transactionId,content:raw,expectedSha256:await partitionDigest(raw),beforeMutation:guard});
 }
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
// Enumerate stored references independently of the canonical reader/builder.
// Inline JSON is source data, never a collection of implicit hash pointers.
async function canonicalClosure(read,rootHash) {
 const hashes=new Set();
 const body=async hash=>{const raw=await read(hash);assert.equal(await partitionDigest(raw),hash);hashes.add(hash);return JSON.parse(new TextDecoder().decode(raw));};
 async function tree(hash,visit=async()=>{}) {
   const page=await body(hash);assert.equal(page.format,'finance-tracker-immutable-page-tree');
   if(page.kind==='branch'){for(const child of page.children)await tree(child.hash,visit);}
   else for(const [,value] of page.entries)await visit(value);
 }
 async function value(ref) {
   if(['json','scalar'].includes(ref.kind))return;
   await tree(ref.root,ref.kind==='array'?value:ref.kind==='object'?async entry=>{await value(entry.key);await value(entry.value);}:undefined);
 }
 const root=await body(rootHash),source=await body(root.source),derived=await body(root.derived);
 await value(source.metadata);
 await tree(source.collections,async collection=>{await tree(collection.byId,value);await tree(collection.order);});
 await tree(derived.effectiveActivities,value);await tree(derived.monthActivities);await tree(derived.summaries,value);
 return hashes;
}
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
import {initializeCatalogCopy,verifyCatalogHistory} from '../js/catalog-storage.mjs';
import {CatalogTransactionEngine} from '../js/catalog-transaction-engine.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent} from '../js/canonical-import.mjs';
import {migrateLegacyCanonicalCopy,verifyLegacyMigrationEvidence} from '../js/paged-canonical-backup.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {readVerifiedPartitionedLedger} from '../js/canonical-paged-storage.mjs';
async function legacyFixture(layout='fragments-v3',input=null){
 const source=target('invented-legacy');
 const {manifestFileId}=await initializeCatalogCopy({adapter:source.adapter,guard});
 const engine=new CatalogTransactionEngine({adapter:source.adapter,assertWritable:guard,isOnline:()=>true});
 const lifecycle={manifestFileId,readManifest:()=>source.adapter.readJson(manifestFileId),
   readObject:async path=>{const manifest=await source.adapter.readJson(manifestFileId);const verified=await verifyCatalogHistory(source.adapter,manifest);return verified.objects.get('data-object:'+manifest.snapshot[path]);},
   transact:t=>engine.transact(t)};
 const store=new CanonicalLedgerStore({lifecycle,layout});await store.load();let ledger=input??replayFixture(1).ledger;await store.save(ledger);
 if(!input){ledger=applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-100',commandId:'invented-correct',evidence:{rationale:'Invented correction'}});await store.save(ledger);}
 return {...source,manifestFileId,ledger,engine,store,lifecycle};
}
for(const layout of ['records-v1','fragments-v3'])test(`explicit ${layout} migration preserves all old history and only final canonical pages in a v5 copy`,async()=>{
 const f=await legacyFixture(layout),dest=target('invented-migrated');
 const original=await f.adapter.readJson(f.manifestFileId);
 const originalHistory=await verifyCatalogHistory(f.adapter,original);
 const result=await migrateLegacyCanonicalCopy({sourceAdapter:f.adapter,sourceManifestFileId:f.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,targetAdapter:dest.adapter,
   withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans()});
 assert.deepEqual(await f.adapter.readJson(f.manifestFileId),original);f.drive.stopped=true;
 assert.equal(result.manifest.revision,'0');
 const tree=createPagedPhysicalLocators(dest.adapter,{databaseId:result.manifest.databaseId,copyId:result.manifest.copyId,folderId:dest.adapter.folderId});
 const readObject=q=>tree.readObject(result.manifest.locatorRoot,q);
 const commit=JSON.parse(new TextDecoder().decode(await readObject({kind:'commit-record',sha256:result.manifest.headCommit.sha256})));
 const migrated=await readVerifiedPartitionedLedger({read:hash=>readObject({kind:'data-object',sha256:hash})},result.manifest.root);
 assert.deepEqual(migrated.ledger,f.ledger);assert.equal(migrated.version,5);assert.equal(commit.operation,'migrate-legacy-v5');
 assert.equal(commit.semanticVersion,'canonical-partitions-v5');
 const {validateSyntheticApplicationSnapshot}=await import('../js/synthetic-application-structure.mjs');
 const old=await verifyLegacyMigrationEvidence({evidenceRoot:commit.changeEvidenceRoot,readObject,validateStructure:validateSyntheticApplicationSnapshot});
 assert.equal(old.manifest.revision,original.revision);assert.deepEqual(old.sourceManifest,original);
 assert.equal([...old.objects.keys()].filter(k=>k.startsWith('commit-record:')).length,original.revision+1);
 assert.deepEqual(old.objects,originalHistory.objects);
 const expected=await canonicalClosure(hash=>readObject({kind:'data-object',sha256:hash}),result.manifest.root);
 let evidenceHash=commit.changeEvidenceRoot;
 while(evidenceHash!==null) {
   expected.add(evidenceHash);const body=JSON.parse(new TextDecoder().decode(await readObject({kind:'data-object',sha256:evidenceHash})));
   evidenceHash=body.format==='finance-tracker-legacy-archive-evidence'?body.first:body.next;
 }
 const actual=new Set();for await(const entry of tree.entries(result.manifest.locatorRoot))if(entry.kind==='data-object')actual.add(entry.sha256);
 assert.deepEqual(actual,expected,'migration stores exactly the final canonical closure plus every legacy evidence chunk');
 await verifyPagedCopy({adapter:dest.adapter,manifest:result.manifest,verificationPlans:plans()});
 await assert.rejects(verifyCanonicalMigrationEvidence({manifest:{...result.manifest,copyId:original.copyId},commit,currentLedger:f.ledger,readObject}),{code:'invalid-copy-identity'});
 const changed=structuredClone(f.ledger);changed.createdAt='2025-01-01T00:00:00Z';
 await assert.rejects(verifyCanonicalMigrationEvidence({manifest:result.manifest,commit,currentLedger:changed,readObject}),{code:'migration-latest-ledger-mismatch'});
 const saved=await archive({sourceAdapter:dest.adapter,sourceManifestFileId:result.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,verificationPlans:plans()});
 assert.equal((await unpack(saved)).root.profile,'canonical5-physical4');
 dest.drive.stopped=true;
 const restored=target('invented-migration-offline-roundtrip');
 const reopened=await restore(saved,restored);
 await verifyPagedCopy({adapter:restored.adapter,manifest:reopened.manifest,verificationPlans:plans()});
 const collision=target('invented-migration-original-identity');
 await assert.rejects(restore(saved,collision,{newCopyId:original.copyId}),e=>e.cause?.code==='invalid-copy-identity');
 assert.equal(published(collision.drive).length,0);
});
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
test('target evidence version changes at the final publication boundary prevent manifest creation',async()=>{
 const f=await fixture(),chunks=await archive(f.options),dest=target('invented-target-version');
 await assert.rejects(restore(chunks,dest,{beforePublish:async()=>{
   const file=[...dest.drive.files.values()].find(item=>item.metadata.appProperties?.financeTrackerKind==='snapshot-object');
   assert.ok(file);file.metadata.version=String(Number(file.metadata.version)+1);
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

for(const version of [4,5])test(`canonical v${version} archives retain exact history, profile and financial results through source-offline app reopen`,async()=>{
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

test('original untagged v4 archive remains original v4 after independent restore',async()=>{
 const f=await fixture({version:4}),ledger=replayFixture(1).ledger,prepared=new Map();
 const store={write:async raw=>{const hash=await partitionDigest(raw);prepared.set(hash,raw);return hash;},read:async hash=>prepared.get(hash)};
 const {buildPartitionedCanonicalLedger}=await import('../js/canonical-partitions.mjs');
 const built=await buildPartitionedCanonicalLedger(ledger,store);
 const engine=new PagedApplicationStorage({adapter:f.adapter,manifestFileId:f.manifestFileId,assertWritable:guard,verificationPlans:plans()});
 const initial=await engine.readSnapshot();
 await engine.transact({expectedBase:initial.manifest,rootHash:built.rootHash,preparationStore:store,semanticVersion:'canonical-partitions-v4',operation:'synthetic-canonical-import',
   objects:[...prepared].map(([sha256,raw])=>({kind:'data-object',identity:sha256,sha256,byteLength:raw.length})).sort((a,b)=>a.sha256<b.sha256?-1:1)});
 const framed=await archive(f.options),decoded=await unpack(framed);assert.equal(decoded.root.profile,'canonical4-physical4');
 f.drive.stopped=true;const dest=target('invented-original-v4'),result=await restore(framed,dest);
 const tree=createPagedPhysicalLocators(dest.adapter,{databaseId:result.manifest.databaseId,copyId:result.manifest.copyId,folderId:dest.adapter.folderId});
 const audited=await readVerifiedPartitionedLedger({read:hash=>tree.readObject(result.manifest.locatorRoot,{kind:'data-object',sha256:hash})},result.manifest.root);
 assert.equal(audited.version,4);assert.equal(audited.valueCodec,null);assert.deepEqual(audited.ledger,ledger);assert.equal(result.manifest.root,built.rootHash);
});

test('rehashed physical archive profile substitutions fail even for shared empty canonical bytes',async()=>{
 for(const version of [4,5]) {
   const f=await fixture({version}),decoded=await unpack(await archive(f.options)),other=version===4?5:4;
   const dest=target(`invented-profile-substitution-${version}`);
   await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,profile:`canonical${other}-physical4`,canonical:{...decoded.root.canonical,version:other}},
     objects:decoded.objects.values()}),dest),e=>e.cause?.code==='archive-canonical-profile-mismatch');
   assert.equal(published(dest.drive).length,0);
   const head=JSON.parse(new TextDecoder().decode(decoded.records.get(decoded.root.protocol.sha256)));
   for(const semanticVersion of [`canonical-partitions-v${other}`,'canonical-partitions-v6']) {
     const raw=new TextEncoder().encode(canonicalizeJcs({...head,semanticVersion})),hash=await partitionDigest(raw);
     const records=[...[...decoded.objects.values()].filter(item=>!(item.descriptor.kind==='commit-record'&&item.hash===decoded.root.protocol.sha256)),
       {hash,bytes:raw,descriptor:{kind:'commit-record',identity:hash}}];
     const mismatched=target(`invented-head-substitution-${version}-${semanticVersion}`);
     await assert.rejects(restore(encodeFramedBackup({root:{...decoded.root,protocol:{version:4,sha256:hash}},objects:records}),mismatched),
       e=>e.cause?.code===(semanticVersion.endsWith('v6')?'unsupported-canonical-profile':'archive-canonical-profile-mismatch'));
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

test('an older v4 migration archive restores without silently upgrading its root, verifier or source evidence',async()=>{
 const f=await legacyFixture('records-v1'),sourceManifest=await f.adapter.readJson(f.manifestFileId);
 const {exportCatalogArchive}=await import('../js/catalog-backup.mjs');
 const {validateSyntheticApplicationSnapshot}=await import('../js/synthetic-application-structure.mjs');
 const {writeLegacyMigrationEvidence}=await import('../js/paged-canonical-backup.mjs');
 const {buildCompactPartitionedCanonicalLedger}=await import('../js/canonical-partitions.mjs');
 const {createPortableLogicalCommit}=await import('../js/physical-root-binding.mjs');
 const old=await exportCatalogArchive({adapter:f.adapter,manifestFileId:f.manifestFileId,withSourceLock:gate,validateStructure:validateSyntheticApplicationSnapshot});
 const objects=new Map(),store={read:async hash=>objects.get(hash),write:async raw=>{const hash=await partitionDigest(raw);objects.set(hash,raw);return hash;}};
 const {rootHash}=await buildCompactPartitionedCanonicalLedger(f.ledger,store);
 const changeEvidenceRoot=await writeLegacyMigrationEvidence({archive:old,sourceManifest,store,validateStructure:validateSyntheticApplicationSnapshot});
 const commit=createPortableLogicalCommit({databaseId:sourceManifest.databaseId,parent:null,revision:'0',previousRoot:null,root:rootHash,
   transactionId:crypto.randomUUID(),operation:'migrate-legacy-v4',semanticVersion:'canonical-partitions-v4',changeEvidenceRoot});
 const raw=new TextEncoder().encode(canonicalizeJcs(commit)),hash=await partitionDigest(raw);
 const root={profile:'canonical4-physical4',databaseId:sourceManifest.databaseId,sourceCopyId:sourceManifest.copyId,revision:'0',
   canonical:{version:4,sha256:rootHash},catalog:null,protocol:{version:4,sha256:hash},sourceEvidence:null};
 const records=[...[...objects].map(([hash,bytes])=>({hash,bytes,descriptor:{kind:'data-object',identity:hash}})),{hash,bytes:raw,descriptor:{kind:'commit-record',identity:hash}}];
 f.drive.stopped=true;const dest=target('invented-old-migration-restored');
 const result=await restore(encodeFramedBackup({root,objects:records}),dest);
 assert.equal(result.manifest.root,rootHash);assert.equal(result.manifest.headCommit.sha256,hash);assert.equal(Object.hasOwn(result.manifest,'sourceEvidence'),false);
 const firstChunk=JSON.parse(new TextDecoder().decode(objects.get(changeEvidenceRoot))).first;
 const incomplete=target('invented-old-migration-missing-evidence');
 await assert.rejects(restore(encodeFramedBackup({root,objects:records.filter(item=>item.hash!==firstChunk)}),incomplete));
 assert.equal(published(incomplete.drive).length,0);
 const reopened=application({...dest,manifestFileId:result.manifestFileId});await reopened.start();
 try {const store=new CanonicalLedgerStore({lifecycle:reopened});assert.deepEqual(await store.load(),f.ledger);assert.equal(store.layout,'partitions-v4');}
 finally {await reopened.release();}
 const decoded=await unpack(await archive({sourceAdapter:dest.adapter,sourceManifestFileId:result.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,verificationPlans:plans()}));
 assert.equal(decoded.root.profile,'canonical4-physical4');assert.equal(decoded.root.canonical.sha256,rootHash);
 assert.deepEqual(decoded.records.get(changeEvidenceRoot),objects.get(changeEvidenceRoot));
 const collision=target('invented-old-migration-origin-collision');
 await assert.rejects(restore(encodeFramedBackup({root:decoded.root,objects:decoded.objects.values()}),collision,{newCopyId:sourceManifest.copyId}),e=>e.cause?.code==='invalid-copy-identity');
 assert.equal(published(collision.drive).length,0);
});

const migrationOptions=(f,dest)=>({sourceAdapter:f.adapter,sourceManifestFileId:f.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,
 targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans()});
test('migration refuses empty legacy, standalone v2, external originals and existing paged copies before target writes',async()=>{
 const empty=target('invented-empty-legacy');Object.assign(empty,await initializeCatalogCopy({adapter:empty.adapter,guard}));
 const v2=await legacyFixture('records-v1');
 const {CANONICAL_INDEX}=await import('../js/canonical-ledger-storage.mjs');
 const oldIndex=JSON.parse(v2.store.storageObjects.get(CANONICAL_INDEX));
 await v2.engine.transact({manifestFileId:v2.manifestFileId,expectedBase:await v2.adapter.readJson(v2.manifestFileId),
   objects:[{logicalPath:CANONICAL_INDEX,content:canonicalizeJcs({...oldIndex,version:2})}],commitRecord:{operationType:'synthetic-canonical-import',schemaVersion:1}});
 const retained=await legacyFixture();retained.drive.files.set('invented-external-original',{bytes:new Uint8Array(),metadata:{id:'invented-external-original',name:'ft-synthetic-original-imports.json',parents:[retained.adapter.folderId],trashed:false,appProperties:{financeTrackerKind:'synthetic-original-import-index'}}});
 for(const [name,f] of [['empty',empty],['v2',v2],['external',retained],['v4',await fixture({version:4})],['v5',await fixture()]]) {
   const dest=target('invented-refused-'+name),before=new Map([...f.drive.files].map(([id,file])=>[id,file.bytes.slice()]));
   await assert.rejects(migrateLegacyCanonicalCopy(migrationOptions(f,dest)));
   assert.equal(dest.drive.mutations,0);assert.equal(published(dest.drive).length,0);
   for(const [id,raw] of before)assert.deepEqual(f.drive.files.get(id).bytes,raw);
 }
});

test('migration preserves refusal of legacy-valid undefined derived refund fields',async()=>{
 const {replayRow}=await import('./helpers/ledger-replay-fixtures.mjs');
 const {ledger,options}=replayFixture(2,[replayRow(0),replayRow(1,{amountText:'2.00',postedDate:'2026-02-02'})]);
 const [purchase,refund]=ledger.activities;delete purchase.categoryId;
 ledger.events=[{eventId:options.idFactory(),commandId:'invented-classification',eventType:'classification',activityId:purchase.activityId,recordedAt:options.now(),appendOnly:true,activityKind:'spending',categoryId:null,priorActivityKind:'unclassified'},
   {eventId:options.idFactory(),commandId:'invented-refund',eventType:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,recordedAt:options.now(),appendOnly:true,evidence:{reason:'invented'}}];
 const f=await legacyFixture('records-v1',ledger),dest=target('invented-unsupported-refund'),before=await f.adapter.readJson(f.manifestFileId);
 await assert.rejects(migrateLegacyCanonicalCopy(migrationOptions(f,dest)),{code:'unsupported-derived-projection'});
 assert.equal(dest.drive.mutations,0);assert.deepEqual(await f.adapter.readJson(f.manifestFileId),before);
 assert.deepEqual(await f.store.load(),ledger);assert.equal(Object.hasOwn(ledger.activities[0],'categoryId'),false);
});

test('migration rechecks pinned source metadata after complete staging and before publication',async()=>{
 const f=await legacyFixture('records-v1'),dest=target('invented-migration-source-changed');
 await assert.rejects(migrateLegacyCanonicalCopy({...migrationOptions(f,dest),beforePublish:async()=>{
   const file=f.drive.files.get(f.manifestFileId);file.metadata.version=String(Number(file.metadata.version)+1);
 }}),{code:'source-changed'});
 assert.equal(published(dest.drive).length,0);assert.ok(dest.drive.files.size>0);
});

for(const operation of ['backup','migration'])for(const boundary of ['target-close','manifest-id','manifest-token'])test(`${operation} rechecks source pin at final publication after ${boundary}`,async()=>{
 const f=operation==='backup'?await fixture():await legacyFixture('records-v1'),dest=target(`invented-late-source-${operation}-${boundary}`);
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
 const options={...migrationOptions(f,dest),beforePublish:async()=>{armed=true;}};
 await assert.rejects(operation==='backup'?backupPagedCanonicalCopy(options):migrateLegacyCanonicalCopy(options),{code:'source-changed'});
 assert.equal(changed,true);assert.equal(published(dest.drive).length,0);assert.ok(dest.drive.files.size>0);
 const preserved=new Map([...dest.drive.files].map(([id,file])=>[id,file.bytes.slice()]));
 await assert.rejects(operation==='backup'?backupPagedCanonicalCopy(migrationOptions(f,dest)):migrateLegacyCanonicalCopy(migrationOptions(f,dest)));
 for(const [id,raw] of preserved)assert.deepEqual(dest.drive.files.get(id).bytes,raw);
});

test('target ownership remains guarded after the final source publication check',async()=>{
 const f=await fixture(),dest=target('invented-target-lost-during-source-guard');let creatingManifest=false,owned=true,lost=false;
 const create=dest.adapter.createImmutable.bind(dest.adapter);dest.adapter.createImmutable=async input=>{if(input.kind===PAGED_MANIFEST_KIND)creatingManifest=true;return create(input);};
 const read=f.adapter.readMetadata.bind(f.adapter);f.adapter.readMetadata=async(...args)=>{
   const result=await read(...args);if(creatingManifest){owned=false;lost=true;}return result;
 };
 await assert.rejects(backupPagedCanonicalCopy({...migrationOptions(f,dest),assertTargetWritable:async()=>{
   if(!owned)throw Object.assign(new Error('Invented late owner loss'),{code:'ownership-lost'});
 }}),{code:'ownership-lost'});
 assert.equal(lost,true);assert.equal(published(dest.drive).length,0);
});

for(const operation of ['backup','migration'])test(`${operation} reports source loss after publication without retrying or removing the committed target`,async()=>{
 const f=operation==='backup'?await fixture():await legacyFixture('records-v1'),dest=target(`invented-source-lost-after-${operation}`);
 let changed=false;const create=dest.adapter.createImmutable.bind(dest.adapter);
 dest.adapter.createImmutable=async input=>{
   const result=await create(input);
   if(input.kind===PAGED_MANIFEST_KIND){const file=f.drive.files.get(f.manifestFileId);file.metadata.version=String(Number(file.metadata.version)+1);changed=true;}
   return result;
 };
 await assert.rejects(operation==='backup'?backupPagedCanonicalCopy(migrationOptions(f,dest)):migrateLegacyCanonicalCopy(migrationOptions(f,dest)),{code:'source-changed'});
 assert.equal(changed,true);assert.equal(published(dest.drive).length,1);
 const found=await inspectPagedCanonicalCopy(dest.adapter),raw=dest.drive.files.get(found.manifestFileId).bytes.slice();
 await verifyPagedCopy({adapter:dest.adapter,manifest:found.manifest,verificationPlans:plans()});
 await assert.rejects(operation==='backup'?backupPagedCanonicalCopy(migrationOptions(f,dest)):migrateLegacyCanonicalCopy(migrationOptions(f,dest)));
 assert.equal(published(dest.drive).length,1);assert.deepEqual(dest.drive.files.get(found.manifestFileId).bytes,raw);
});

test('final source validation stays inside the target gate after manifest readback',async()=>{
 const f=await fixture(),dest=target('invented-final-source-gate');let targetHeld=false,afterPublicationReads=0;
 const read=f.adapter.readMetadata.bind(f.adapter);f.adapter.readMetadata=async(...args)=>{
   if(published(dest.drive).length){assert.equal(targetHeld,true);afterPublicationReads++;}return read(...args);
 };
 const result=await backupPagedCanonicalCopy({...migrationOptions(f,dest),withTargetLock:async fn=>{
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
 await assert.rejects(backupPagedCanonicalCopy({...migrationOptions(f,dest),signal:controller.signal,withTargetLock:async fn=>{
   targetHeld=true;try{return await fn();}finally{targetHeld=false;}
 },assertTargetWritable:async()=>{
   if(mutation==='abort'&&changed){await Promise.resolve();controller.abort();}
 }}),mutation==='folder'?{code:'copy-mismatch'}:{name:'AbortError'});
 assert.equal(changed,true);assert.equal(published(dest.drive).length,1);
 dest.adapter.folderId=folderId;const found=await inspectPagedCanonicalCopy(dest.adapter),raw=dest.drive.files.get(found.manifestFileId).bytes.slice();
 assert.equal(found.manifest.storageBinding.folderId,folderId);
 await verifyPagedCopy({adapter:dest.adapter,manifest:found.manifest,verificationPlans:plans()});
 await assert.rejects(backupPagedCanonicalCopy(migrationOptions(f,dest)));
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

test('v5 migration evidence rejects rehashed extra root, chunk and payload fields while v4 keeps its interpretation',async()=>{
 const f=await legacyFixture('records-v1'),sourceManifest=await f.adapter.readJson(f.manifestFileId);
 const {exportCatalogArchive}=await import('../js/catalog-backup.mjs');
 const {validateSyntheticApplicationSnapshot}=await import('../js/synthetic-application-structure.mjs');
 const {writeLegacyMigrationEvidence}=await import('../js/paged-canonical-backup.mjs');
 const {buildCompactPartitionedCanonicalLedger,updatePartitionedCanonicalLedger}=await import('../js/canonical-partitions.mjs');
 const {createPortableLogicalCommit}=await import('../js/physical-root-binding.mjs');
 const old=await exportCatalogArchive({adapter:f.adapter,manifestFileId:f.manifestFileId,withSourceLock:gate,validateStructure:validateSyntheticApplicationSnapshot});
 f.drive.stopped=true;
 for(const version of [4,5]) {
   const objects=new Map(),store={read:async hash=>objects.get(hash),write:async raw=>{const hash=await partitionDigest(raw);objects.set(hash,raw);return hash;}};
   const {rootHash}=await (version===4?buildCompactPartitionedCanonicalLedger:updatePartitionedCanonicalLedger)(f.ledger,store);
   const evidenceRoot=await writeLegacyMigrationEvidence({archive:old,sourceManifest,store,validateStructure:validateSyntheticApplicationSnapshot});
   const evidence=JSON.parse(new TextDecoder().decode(objects.get(evidenceRoot)));
   for(const mutation of ['root','chunk','payload']) {
     const local=new Map(objects),put=async value=>{const raw=new TextEncoder().encode(canonicalizeJcs(value)),hash=await partitionDigest(raw);local.set(hash,raw);return hash;};
     let changeEvidenceRoot;
     if(mutation==='root')changeEvidenceRoot=await put({...evidence,unexpected:true});
     if(mutation==='chunk') {
       const first=await put({...JSON.parse(new TextDecoder().decode(local.get(evidence.first))),unexpected:true});
       changeEvidenceRoot=await put({...evidence,first});
     }
     if(mutation==='payload') {
       const raw=new TextEncoder().encode(canonicalizeJcs({archive:old,sourceManifest,unexpected:true}));let next=null;
       for(let end=raw.length;end>0;){const start=Math.max(0,end-24000);next=await put({format:'finance-tracker-legacy-evidence-chunk',version:1,next,base64:Buffer.from(raw.subarray(start,end)).toString('base64')});end=start;}
       changeEvidenceRoot=await put({...evidence,first:next,payloadBytes:String(raw.length),payloadSha256:await partitionDigest(raw)});
     }
     const commit=createPortableLogicalCommit({databaseId:sourceManifest.databaseId,parent:null,revision:'0',previousRoot:null,root:rootHash,
       transactionId:crypto.randomUUID(),operation:`migrate-legacy-v${version}`,semanticVersion:`canonical-partitions-v${version}`,changeEvidenceRoot});
     const raw=new TextEncoder().encode(canonicalizeJcs(commit)),hash=await partitionDigest(raw);
     const root={profile:`canonical${version}-physical4`,databaseId:sourceManifest.databaseId,sourceCopyId:sourceManifest.copyId,revision:'0',
       canonical:{version,sha256:rootHash},catalog:null,protocol:{version:4,sha256:hash},sourceEvidence:null};
     const records=[...[...local].map(([hash,bytes])=>({hash,bytes,descriptor:{kind:'data-object',identity:hash}})),{hash,bytes:raw,descriptor:{kind:'commit-record',identity:hash}}];
     const dest=target(`invented-evidence-extra-v${version}-${mutation}`),source=encodeFramedBackup({root,objects:records});
     if(version===5) {
       await assert.rejects(restore(source,dest),e=>e.cause?.code===`migration-${mutation==='root'?'evidence':mutation}-format`);
       assert.equal(published(dest.drive).length,0);
     } else {
       const result=await restore(source,dest);assert.equal(result.manifest.root,rootHash);assert.equal(result.manifest.headCommit.sha256,hash);
       assert.equal(published(dest.drive).length,1);
     }
   }
 }
});
