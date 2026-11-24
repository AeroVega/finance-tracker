import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {
 createFullSnapshotStorage,createProspectiveStorageForSimulation,inspectSyntheticManifest
} from '../js/full-snapshot-storage.mjs';
import {encodeProspectiveProductionBackup,decodeProspectiveProductionBackup} from '../js/full-snapshot-backup.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

const options={cryptoImpl:webcrypto,password:'invented-archive-password'};
const fixture=()=>replayFixture(1).ledger;
const prospective=({syntheticOnly,...ledger})=>({...ledger,version:3,dataClass:'production'});
const connect=http=>createProspectiveStorageForSimulation({folderId:http.folderId,fetchImpl:http.fetch,cryptoImpl:webcrypto});

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
  await assert.rejects(inspectSyntheticManifest(store.adapter,store.manifestFileId),{code:'invalid-shape'});
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

test('native invented v2 archive round-trip restores to fresh lineage and v1 engine stays strict',async()=>{
 const sourceHttp=new HttpFullSnapshotDrive(),source=await connect(sourceHttp);
 const destinationHttp=new HttpFullSnapshotDrive(),destination=await connect(destinationHttp);
 const syntheticHttp=new HttpFullSnapshotDrive();
 const synthetic=createFullSnapshotStorage({folderId:syntheticHttp.folderId,accessToken:()=> 'invented-test-token',
  fetchImpl:syntheticHttp.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},
  // Untrusted caller options cannot select the profile of the app factory.
  dataClass:'production'});
 const ledger=prospective(fixture());
 try{
  await source.start({initialize:true});
  await source.save(ledger);
  const archive=await encodeProspectiveProductionBackup(await source.open(),options);
  const restored=await decodeProspectiveProductionBackup(archive,options);
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

test('simulator factory supplies neither default network transport nor caller credentials',async()=>{
 await assert.rejects(createProspectiveStorageForSimulation({folderId:'invented-folder',cryptoImpl:webcrypto}),{code:'invalid-engine-config'});
 await assert.rejects(createProspectiveStorageForSimulation({folderId:'invented-folder',
  fetchImpl:globalThis.fetch,cryptoImpl:webcrypto}),{code:'invalid-engine-config'});
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
