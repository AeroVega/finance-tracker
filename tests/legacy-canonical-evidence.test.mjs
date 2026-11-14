import test from 'node:test';
import {seedExistingMigration} from './helpers/existing-migrated-v5.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {restorePagedCanonicalArchive,backupPagedCanonicalCopy,exportPagedCanonicalArchive,withSourceEvidenceVerification} from '../js/paged-canonical-backup.mjs';
import {CANONICAL_COLLECTIONS} from '../js/canonical-history.mjs';
import {verifyLegacyMigrationEvidence,legacyMigrationLedger,verifyCanonicalMigrationEvidence,validateLegacyApplicationSnapshot} from '../js/legacy-canonical-evidence.mjs';
import {applyFinancialEvent} from '../js/canonical-import.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
const gate=fn=>fn(),guard=async()=>{},plans=()=>withSourceEvidenceVerification(canonicalPartitionVerificationPlans());
const bytes=value=>new TextEncoder().encode(canonicalizeJcs(value));
function target(name){const drive=new HttpCatalogDrive({folderId:name,idPrefix:name+'-file-'});return {drive,adapter:new GoogleDriveTransactionAdapter({folderId:name,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0})};}
const restore=(source,dest,extra={})=>restorePagedCanonicalArchive({source,targetAdapter:dest.adapter,withTargetLock:gate,assertTargetWritable:guard,verificationPlans:plans(),...extra});
const published=dest=>[...dest.drive.files.values()].filter(f=>f.metadata.name==='ft-synthetic-paged-manifest.json');
async function fixture(layout){const f=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/migrated-v5/existing-v5-'+layout+'.json.gz',import.meta.url))));f.originalCopyId=f.sourceManifest.copyId;return f;}
function application(dest,id){return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:plans(),folderName:'Invented synthetic existing migrated v5',folderId:dest.adapter.folderId,manifestFileId:id,accessToken:()=> 'invented-test-token',fetchImpl:dest.drive.fetch,makeManifest:()=>{},adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});}
for(const layout of ['records-v1','fragments-v3'])test(`existing ${layout}-origin v5 restores, edits and backs up with full old evidence`,async()=>{
 const f=await fixture(layout),dest=target('invented-existing-'+layout),saved=await seedExistingMigration(f,dest);
 const app=application(dest,saved.manifestFileId);await app.start();
 const store=new CanonicalLedgerStore({lifecycle:app});assert.deepEqual(await store.load(),f.ledger);
 const next=applyFinancialEvent(f.ledger,{activityId:f.ledger.activities[0].activityId,type:'bank-correction',amountText:'-101',commandId:'invented-post-migration',evidence:{rationale:'Invented v5 continuation'}});
 await store.save(next);assert.deepEqual(await store.load(),next);await app.release();
 const source={sourceAdapter:dest.adapter,sourceManifestFileId:saved.manifestFileId,withSourceLock:gate,assertSourceWritable:guard,verificationPlans:plans()};
 const backup=target('invented-existing-backup-'+layout);await backupPagedCanonicalCopy({...source,targetAdapter:backup.adapter,withTargetLock:gate,assertTargetWritable:guard});
 const chunks=[];await exportPagedCanonicalArchive({...source,sink:{write:async c=>chunks.push(c)}});dest.drive.stopped=true;
 const reopened=target('invented-existing-offline-'+layout),restored=await restore(chunks,reopened),cold=application(reopened,restored.manifestFileId);await cold.start();assert.deepEqual(await new CanonicalLedgerStore({lifecycle:cold}).load(),next);await cold.release();
 const collision=target('invented-old-origin-collision-'+layout);await assert.rejects(restore(chunks,collision,{newCopyId:f.originalCopyId}),e=>e.cause?.code==='invalid-copy-identity');assert.equal(published(collision).length,0);
});

test('existing migration evidence verifies all snapshots and rejects identity, changed ledger and rehashed extra fields',async()=>{
 const f=await fixture('fragments-v3'),dest=target('invented-evidence-validation'),{objects,commit}=await seedExistingMigration(f,dest);
 const readObject=async q=>objects.get(q.sha256)?.bytes;
 const verified=await verifyLegacyMigrationEvidence({evidenceRoot:commit.changeEvidenceRoot,readObject});assert.deepEqual(await legacyMigrationLedger(verified),f.ledger);
 await assert.rejects(verifyCanonicalMigrationEvidence({manifest:{copyId:f.originalCopyId},commit,currentLedger:f.ledger,readObject}),{code:'invalid-copy-identity'});
 await assert.rejects(verifyCanonicalMigrationEvidence({manifest:{copyId:'invented-safe-copy'},commit,currentLedger:{...f.ledger,createdAt:'2025-01-01T00:00:00Z'},readObject}),{code:'migration-latest-ledger-mismatch'});
 const evidence=JSON.parse(new TextDecoder().decode(objects.get(commit.changeEvidenceRoot).bytes));
 for(const mutation of ['root','chunk','payload']){
  const altered=new Map(objects),put=async value=>{const raw=bytes(value),hash=await partitionDigest(raw);altered.set(hash,{bytes:raw});return hash;};
  let hash;
  if(mutation==='root')hash=await put({...evidence,unexpected:true});
  else if(mutation==='chunk')hash=await put({...evidence,first:await put({...JSON.parse(new TextDecoder().decode(objects.get(evidence.first).bytes)),unexpected:true})});
  else {
    const raw=bytes({archive:f.archive,sourceManifest:f.sourceManifest,unexpected:true});let next=null;
    for(let end=raw.length;end>0;){const start=Math.max(0,end-24000);next=await put({format:'finance-tracker-legacy-evidence-chunk',version:1,next,base64:Buffer.from(raw.subarray(start,end)).toString('base64')});end=start;}
    hash=await put({...evidence,first:next,payloadBytes:String(raw.length),payloadSha256:await partitionDigest(raw)});
  }
  await assert.rejects(verifyLegacyMigrationEvidence({evidenceRoot:hash,readObject:async q=>altered.get(q.sha256)?.bytes}),{code:'migration-'+(mutation==='root'?'evidence':mutation)+'-format'});
 }
 const missing=target('invented-missing-old-history'),seed=await seedExistingMigration(f,missing);
 const file=[...missing.drive.files.values()].find(file=>file.metadata.appProperties.financeTrackerHash===JSON.parse(new TextDecoder().decode(seed.objects.get(seed.commit.changeEvidenceRoot).bytes)).first);
 missing.drive.files.delete(file.metadata.id);const broken=application(missing,seed.manifestFileId);await assert.rejects(broken.start(),{code:'object-not-found'});assert.notEqual(broken.state,'ready');

});

test('archived application snapshots retain dashboard and disposable month-index compatibility only',()=>{
 const dashboard=bytes({format:'finance-tracker-dashboard-snapshot',syntheticOnly:true,transactions:[{id:'invented',date:'2026-01-01',description:'Invented',amount:1,syntheticOnly:true}]});
 assert.equal(validateLegacyApplicationSnapshot({objects:{'synthetic/dashboard-transactions.json':dashboard}}),true);
 assert.equal(validateLegacyApplicationSnapshot({objects:{'synthetic/canonical-month-index-v1/root.json':new Uint8Array([0xff])}}),true);
 assert.equal(validateLegacyApplicationSnapshot({objects:{'unexpected.json':dashboard}}),false);
 assert.equal(validateLegacyApplicationSnapshot({objects:{'synthetic/dashboard-transactions.json':bytes({syntheticOnly:true})}}),false);
});

test('archived fragmented v3 accepts its historical grouped2 inner index but not standalone grouped2',async()=>{
 const {ledger}=await fixture('fragments-v3'),prefix='synthetic/canonical-v1/',indexPath=prefix+'index.json';
 const metadata={...ledger},collections={},chunks={},logical=new Map();
 for(const [name,idField] of Object.entries(CANONICAL_COLLECTIONS)){
   if(!Object.hasOwn(ledger,name))continue;
   collections[name]=ledger[name].map(record=>record[idField]);chunks[name]=[];delete metadata[name];
   for(let offset=0;offset<ledger[name].length;offset+=64){const path=prefix+'chunks/'+name+'/'+String(offset/64).padStart(6,'0')+'.json';chunks[name].push(path);logical.set(path,bytes({format:'finance-tracker-canonical-chunk',version:1,collection:name,records:ledger[name].slice(offset,offset+64)}));}
 }
 logical.set(indexPath,bytes({format:'finance-tracker-canonical-index',version:2,syntheticOnly:true,metadata,collections,chunks}));
 assert.throws(()=>validateLegacyApplicationSnapshot({objects:Object.fromEntries(logical)}),{code:'deprecated-canonical-layout'});
 const root={format:'finance-tracker-canonical-index',version:3,syntheticOnly:true,fragments:{}},objects={};
 for(const [path,raw] of logical){assert.ok(raw.length<65536);root.fragments[path]={bytes:raw.length,parts:1};objects[prefix+'fragments/'+path.slice(prefix.length,-5)+'/000000.json']=bytes({format:'finance-tracker-canonical-fragment',version:1,path,ordinal:0,data:Buffer.from(raw).toString('base64')});}
 objects[indexPath]=bytes(root);assert.equal(validateLegacyApplicationSnapshot({objects}),true);
 delete objects[Object.keys(objects)[0]];assert.throws(()=>validateLegacyApplicationSnapshot({objects}),{code:'invalid-canonical-fragments'});
});
