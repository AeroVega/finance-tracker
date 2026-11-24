import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {persistenceDataClass as classify} from '../js/persistence-data-class.mjs';
import {createLedger,validateLedger} from '../js/canonical-import.mjs';
import {encodeFullSnapshotBackup,decodeFullSnapshotBackup} from '../js/full-snapshot-backup.mjs';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {canonicalizeJcs,sha256Hex} from '../js/transaction-protocol.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';

const bytes=value=>new TextEncoder().encode(canonicalizeJcs(value));
const cryptoImpl=webcrypto;
const production=({syntheticOnly,...record},version)=>({...record,version,dataClass:'production'});
const ledger=()=>createLedger({now:'2026-11-23T00:00:00Z',idFactory:()=> '00000000-0000-4000-8000-000000000001'});

test('headers discriminate supported synthetic and production without ambiguous relabelling',()=>{
 for(const [kind,format,legacy,future] of [
  ['ledger','finance-tracker-canonical-ledger',[1,2],3],
  ['manifest','finance-tracker-full-snapshot-manifest',[1],2],
  ['backup','finance-tracker-full-snapshot-backup',[1],2]
 ]){
  for(const version of legacy){
   const old={format,version,syntheticOnly:true};
   assert.equal(classify(kind,old),'synthetic');
   assert.equal(classify(kind,{...old,dataClass:'production'}),null);
   assert.equal(classify(kind,{...old,syntheticOnly:false}),null);
  }
  const next={format,version:future,dataClass:'production'};
  assert.equal(classify(kind,next),'production');
  assert.equal(classify(kind,{...next,syntheticOnly:true}),null);
  assert.equal(classify(kind,{...next,dataClass:'invented'}),null);
  assert.equal(classify(kind,{...next,version:String(future)}),null);
  assert.equal(classify(kind,Object.create(next)),null);
 }
});

test('current ledger validator and backup writer reject future or mixed headers',async()=>{
 const old=ledger();
 assert.equal(validateLedger(old),true);
 for(const value of [production(old,3),{...old,dataClass:'production'}]){
  assert.throws(()=>validateLedger(value),{code:'invalid-canonical-ledger'});
  await assert.rejects(encodeFullSnapshotBackup(value,{cryptoImpl}),error=>error.code==='invalid-backup-source'&&error.cause?.code==='invalid-canonical-ledger');
 }
});

test('backup reader refuses both a production outer header and a checksummed cross-class inner ledger',async()=>{
 const old=ledger();
 const archive=await encodeFullSnapshotBackup(old,{cryptoImpl});
 assert.deepEqual(await decodeFullSnapshotBackup(archive,{cryptoImpl}),old);
 const decoded=JSON.parse(new TextDecoder().decode(archive));
 await assert.rejects(decodeFullSnapshotBackup(bytes(production(decoded,2)),{cryptoImpl}),{code:'data-class-mismatch'});
 const next=production(old,3),sha256=await sha256Hex(canonicalizeJcs(next),cryptoImpl);
 await assert.rejects(decodeFullSnapshotBackup(bytes({...decoded,ledger:next,sha256}),{cryptoImpl}),error=>error.code==='invalid-backup-source'&&error.cause?.code==='invalid-canonical-ledger');
});

test('active synthetic storage refuses cross-class saves and refuses a production manifest on verified open',async()=>{
 const http=new HttpFullSnapshotDrive();
 const store=createFullSnapshotStorage({
  folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,
  cryptoImpl,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}
 });
 try{
  await store.start({initialize:true});
  await store.save(ledger());
  const previous=http.mutations;
  await assert.rejects(store.save(production(ledger(),3)),{code:'invalid-canonical-ledger'});
  assert.equal(http.mutations,previous);
  const file=http.files.get(store.manifestFileId);
  file.bytes=bytes(production(http.json(store.manifestFileId),2));
  file.metadata.size=String(file.bytes.length);
  file.metadata.version=String(BigInt(file.metadata.version)+1n);
  await assert.rejects(store.open(),{code:'data-class-mismatch'});
  assert.equal(http.mutations,previous);
  assert.equal(store.verifiedManifest,null);
 }finally{ await store.release().catch(()=>{}); }
});

test('session start detects a changed manifest after read-only admission, without publishing financial data',async()=>{
 const {inspectManifest}=await import('../js/full-snapshot-storage.mjs');
 const http=new HttpFullSnapshotDrive();
 const settings={folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,
  cryptoImpl,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}};
 const prior=createFullSnapshotStorage(settings);
 await prior.start({initialize:true});
 const fileId=prior.manifestFileId;
 await prior.release();
 const fresh=createFullSnapshotStorage(settings),reads=http.requests.length;
 const admission=await inspectManifest(fresh.adapter,fileId);
 assert.equal(http.requests.slice(reads).some(row=>row.method!=='GET'),false);
 const file=http.files.get(fileId);
 file.bytes=bytes({...http.json(fileId),databaseId:'other-invented-database'});
 file.metadata.size=String(file.bytes.length);
 file.metadata.version=String(BigInt(file.metadata.version)+1n);
 const requests=http.requests.length;
 try{
  await assert.rejects(fresh.start({admission}),{code:'base-conflict'});
  assert.equal(fresh.verifiedManifest,null);
  assert.equal(http.requests.slice(requests).some(row=>
   row.method!=='GET'&&row.kind!=='session-marker'),false);
  assert.equal(fresh.recoveryRequired,false);
  assert.equal(fresh.coordinator.canWrite,false);
  const next=createFullSnapshotStorage(settings);
  assert.equal(await next.start(),null,'a different session can open immediately, without waiting for expiry');
  await next.release();
 }finally{await fresh.release().catch(()=>{});}
});

test('read-only admission refuses ambiguous manifest parents before reading contents',async()=>{
 const {inspectManifest,FULL_SNAPSHOT_MANIFEST_NAME}=await import('../js/full-snapshot-storage.mjs');
 const adapter={folderId:'invented-folder',async readMetadata(){
  return {id:'invented-manifest',name:FULL_SNAPSHOT_MANIFEST_NAME,trashed:false,
   parents:[this.folderId,'other-invented-folder'],version:'1',size:'32',
   appProperties:{financeTrackerKind:'finance-tracker-full-snapshot-manifest'}};
 },async readBytes(){ assert.fail('ambiguous parent must refuse before reading the body'); }};
 await assert.rejects(inspectManifest(adapter,'invented-manifest'),{code:'manifest-metadata-mismatch'});
});

test('read-only admission spends at most nine GETs on non-settling manifest versions',async()=>{
 const {inspectManifest,FULL_SNAPSHOT_MANIFEST_NAME}=await import('../js/full-snapshot-storage.mjs');
 const manifest=bytes({format:'finance-tracker-full-snapshot-manifest',version:1,
  syntheticOnly:true,databaseId:'invented-database',copyId:'invented-copy',revision:'0',head:null,pending:null});
 let metadataReads=0,bodyReads=0;
 const adapter={folderId:'invented-folder',async readMetadata(){
  return {id:'invented-manifest',name:FULL_SNAPSHOT_MANIFEST_NAME,trashed:false,
   parents:[this.folderId],version:String(++metadataReads),size:String(manifest.length),
   appProperties:{financeTrackerKind:'finance-tracker-full-snapshot-manifest'}};
 },async readBytes(){bodyReads++;return manifest;}};
 await assert.rejects(inspectManifest(adapter,'invented-manifest'),{code:'manifest-version-mismatch'});
 assert.equal(metadataReads,5);
 assert.equal(bodyReads,4);
});

test('admission rejection does not release an existing claim with an unresolved publication',async()=>{
 const http=new HttpFullSnapshotDrive();
 const store=createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',
  fetchImpl:http.fetch,cryptoImpl,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
 const original=http.respond.bind(http);
 try{
  await store.start({initialize:true});
  let interrupted=false;
  http.respond=async(target,opts,category,id,row)=>{
   const result=await original(target,opts,category,id,row);
   if(!interrupted&&category==='update'&&id===store.manifestFileId){interrupted=true;store.invalidate();}
   return result;
  };
  await assert.rejects(store.save(ledger()),{code:'write-unresolved'});
  assert.equal(http.json(store.manifestFileId).pending.state,'published');
  const marker=store.coordinator.session.sessionId,mutations=http.mutations;
  http.respond=original;
  await assert.rejects(store.start({admission:{folderId:http.folderId,fileId:store.manifestFileId,canonical:'stale-fixture-receipt'}}),{code:'base-conflict'});
  assert.equal(store.recoveryRequired,true);
  assert.equal(store.coordinator.session.sessionId,marker);
  assert.equal(store.coordinator.canWrite,true);
  assert.equal(http.mutations,mutations);
  await assert.rejects(store.release(),{code:'recovery-required'});
  await store.recover();
 }finally{http.respond=original;await store.release().catch(()=>{});}
});
