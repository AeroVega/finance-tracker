import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage,inspectManifest} from '../js/full-snapshot-storage.mjs';
import {encodeFullSnapshotBackup,decodeFullSnapshotBackup} from '../js/full-snapshot-backup.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

const options={cryptoImpl:webcrypto,password:'invented-archive-password',dataClass:'production'};
const fixture=()=>replayFixture(1).ledger;
const prospective=({syntheticOnly,...ledger})=>({...ledger,version:3,dataClass:'production'});
// The production engine is the same native engine with class-bound headers.
// Engine construction is not the release gate; see the application tests.
const engine=(http,dataClass)=>createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',
 fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},dataClass});
const connect=async http=>engine(http,'production');

test('native simulator recovers a durably pending v2 publication and independently reopens',async()=>{
 const http=new HttpFullSnapshotDrive(),store=await connect(http),ledger=prospective(fixture());
 const original=http.respond.bind(http);
 let fresh;
 try{
  assert.equal(await store.start({initialize:true}),null);
  assert.equal(http.json(store.manifestFileId).dataClass,'production');
  const initial=http.mutations;
  await assert.rejects(store.save(fixture()),{code:'invalid-canonical-ledger'});
  assert.equal(http.mutations,initial);
  // Ordinary interrupted save: the provider accepted the authority PATCH
  // before the previous local save stopped. Keep production writes disabled.
  let interrupted=false;
  http.respond=async(target,opts,category,id,row)=>{
   const result=await original(target,opts,category,id,row);
   if(!interrupted&&category==='update'&&id===store.manifestFileId){
    interrupted=true;
    store.invalidate();
   }
   return result;
  };
  await assert.rejects(store.save(ledger),{code:'write-unresolved'});
  const pending=http.json(store.manifestFileId);
  assert.equal(pending.pending.state,'published');
  assert.equal(pending.pending.base.dataClass,'production');
  assert.equal(pending.pending.base.revision,'0');
  const commit=http.json(pending.head.fileId);
  assert.equal(commit.version,2);
  assert.equal(commit.profile,'canonical-ledger-production-v3');
  assert.equal(commit.dataClass,'production');
  assert.equal(commit.snapshot.fileId.length>0,true);
  assert.equal(store.verifiedManifest,null);
  await assert.rejects(inspectManifest(store.adapter,store.manifestFileId),{code:'data-class-mismatch'});
  assert.equal((await inspectManifest(store.adapter,store.manifestFileId,{dataClass:'production'})).dataClass,'production');
  http.respond=original;
  assert.deepEqual(await store.recover(),ledger);
  assert.equal(store.verifiedManifest,null);
  assert.equal(http.json(store.manifestFileId).pending,null);
  await store.release();
  fresh=await connect(http);
  assert.deepEqual(await fresh.start(),ledger);
  assert.equal(fresh.verifiedManifest.revision,'1');
 }finally{
  http.respond=original;
  await fresh?.release().catch(()=>{});
  await store.release().catch(()=>{});
 }
});

test('native invented v2 archive round-trip restores to fresh lineage and the synthetic engine stays strict',async()=>{
 const sourceHttp=new HttpFullSnapshotDrive(),source=await connect(sourceHttp);
 const destinationHttp=new HttpFullSnapshotDrive(),destination=await connect(destinationHttp);
 const syntheticHttp=new HttpFullSnapshotDrive();
 const synthetic=createFullSnapshotStorage({folderId:syntheticHttp.folderId,accessToken:()=> 'invented-test-token',
  fetchImpl:syntheticHttp.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},
  dataClass:'synthetic'});
 const ledger=prospective(fixture());
 try{
  await source.start({initialize:true});
  await source.save(ledger);
  const archive=await encodeFullSnapshotBackup(await source.open(),options);
  const restored=await decodeFullSnapshotBackup(archive,options);
  await destination.start({initialize:true});
  await destination.save(restored);
  assert.deepEqual(await destination.open(),ledger);
  assert.notEqual(destination.verifiedManifest.copyId,source.verifiedManifest.copyId);
  await synthetic.start({initialize:true});
  assert.equal(synthetic.verifiedManifest.syntheticOnly,true);
  await assert.rejects(synthetic.save(restored),{code:'invalid-canonical-ledger'});
 }finally{
  await source.release().catch(()=>{});
  await destination.release().catch(()=>{});
  await synthetic.release().catch(()=>{});
 }
});

test('engine refuses an unknown class and a synthetic engine refuses a production folder before any write',async()=>{
 assert.throws(()=>engine(new HttpFullSnapshotDrive(),'reserved-production'),{code:'invalid-engine-config'});
 assert.throws(()=>engine(new HttpFullSnapshotDrive(),'unknown'),{code:'invalid-engine-config'});
 const http=new HttpFullSnapshotDrive(),production=engine(http,'production');let synthetic;
 try{
  await production.start({initialize:true});await production.save(prospective(fixture()));await production.release();
  const start=http.requests.length,manifest=structuredClone(http.files.get(production.manifestFileId));synthetic=engine(http,'synthetic');
  await assert.rejects(synthetic.start(),{code:'data-class-mismatch'});
  // Only session-marker requests may write; the production copy is untouched.
  const writes=http.requests.slice(start).filter(row=>!['GET'].includes(row.method));
  assert.ok(writes.length>0);assert.deepEqual(writes.filter(row=>row.kind!=='session-marker'&&row.category!=='generate-id'),[]);
  assert.deepEqual(http.files.get(production.manifestFileId),manifest);
  assert.equal(http.json(production.manifestFileId).dataClass,'production');
 }finally{await synthetic?.release().catch(()=>{});await production.release().catch(()=>{});}
});

for(const part of ['commit','snapshot'])test('v2 refuses ambiguous '+part+' parent without writing',async()=>{
 const http=new HttpFullSnapshotDrive(),store=await connect(http);
 try{
  await store.start({initialize:true});
  await store.save(prospective(fixture()));
  const manifest=http.json(store.manifestFileId),commit=http.json(manifest.head.fileId);
  const file=http.files.get(part==='commit'?manifest.head.fileId:commit.snapshot.fileId);
  file.metadata.parents.push('other-invented-folder');
  file.metadata.version=String(BigInt(file.metadata.version)+1n);
  const mutations=http.mutations;
  await assert.rejects(store.open(),{code:'metadata-mismatch'});
  assert.equal(http.mutations,mutations);
 }finally{await store.release().catch(()=>{});}
});
