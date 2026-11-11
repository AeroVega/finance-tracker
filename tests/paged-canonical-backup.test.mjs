import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {initializePagedCanonicalCopy,inspectPagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {exportPagedCanonicalArchive,restorePagedCanonicalArchive,backupPagedCanonicalCopy,verifyPagedCopy,verifyCanonicalMigrationEvidence} from '../js/paged-canonical-backup.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
const gate=fn=>fn(),guard=async()=>{};
const plans=()=>canonicalPartitionVerificationPlans({verifyMigrationEvidence:verifyCanonicalMigrationEvidence});
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
test('real Drive adapters copy v4 directly, rebind locators and reopen without source',async()=>{
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
async function legacyFixture(){
 const source=target('invented-legacy');
 const {manifestFileId}=await initializeCatalogCopy({adapter:source.adapter,guard});
 const engine=new CatalogTransactionEngine({adapter:source.adapter,assertWritable:guard,isOnline:()=>true});
 const lifecycle={manifestFileId,readManifest:()=>source.adapter.readJson(manifestFileId),
   readObject:async path=>{const manifest=await source.adapter.readJson(manifestFileId);const verified=await verifyCatalogHistory(source.adapter,manifest);return verified.objects.get('data-object:'+manifest.snapshot[path]);},
   transact:t=>engine.transact(t)};
 const store=new CanonicalLedgerStore({lifecycle});await store.load();let ledger=replayFixture(1).ledger;await store.save(ledger);
 ledger=applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-100',commandId:'invented-correct',evidence:{rationale:'Invented correction'}});await store.save(ledger);
 return {...source,manifestFileId,ledger};
}
test('explicit v3 migration preserves all old history as offline verified evidence and exact latest ledger',async()=>{
 const f=await legacyFixture(),dest=target('invented-migrated');
 const original=await f.adapter.readJson(f.manifestFileId);
 const result=await migrateLegacyCanonicalCopy({sourceAdapter:f.adapter,sourceManifestFileId:f.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,targetAdapter:dest.adapter,
   withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans()});
 assert.deepEqual(await f.adapter.readJson(f.manifestFileId),original);f.drive.stopped=true;
 assert.equal(result.manifest.revision,'0');
 const tree=createPagedPhysicalLocators(dest.adapter,{databaseId:result.manifest.databaseId,copyId:result.manifest.copyId,folderId:dest.adapter.folderId});
 const readObject=q=>tree.readObject(result.manifest.locatorRoot,q);
 const commit=JSON.parse(new TextDecoder().decode(await readObject({kind:'commit-record',sha256:result.manifest.headCommit.sha256})));
 const migrated=await readVerifiedPartitionedLedger({read:hash=>readObject({kind:'data-object',sha256:hash})},result.manifest.root);
 assert.deepEqual(migrated.ledger,f.ledger);assert.equal(commit.operation,'migrate-legacy-v4');
 const {validateSyntheticApplicationSnapshot}=await import('../js/synthetic-application-structure.mjs');
 const old=await verifyLegacyMigrationEvidence({evidenceRoot:commit.changeEvidenceRoot,readObject,validateStructure:validateSyntheticApplicationSnapshot});
 assert.equal(old.manifest.revision,original.revision);assert.deepEqual(old.sourceManifest,original);
 assert.equal([...old.objects.keys()].filter(k=>k.startsWith('commit-record:')).length,original.revision+1);
 await verifyPagedCopy({adapter:dest.adapter,manifest:result.manifest,verificationPlans:plans()});
 await assert.rejects(verifyCanonicalMigrationEvidence({manifest:{...result.manifest,copyId:original.copyId},commit,currentLedger:f.ledger,readObject}),{code:'invalid-copy-identity'});
 const changed=structuredClone(f.ledger);changed.createdAt='2025-01-01T00:00:00Z';
 await assert.rejects(verifyCanonicalMigrationEvidence({manifest:result.manifest,commit,currentLedger:changed,readObject}),{code:'migration-latest-ledger-mismatch'});
 const saved=await archive({sourceAdapter:dest.adapter,sourceManifestFileId:result.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,verificationPlans:plans()});
 dest.drive.stopped=true;
 const restored=target('invented-migration-offline-roundtrip');
 const reopened=await restore(saved,restored);
 await verifyPagedCopy({adapter:restored.adapter,manifest:reopened.manifest,verificationPlans:plans()});
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
