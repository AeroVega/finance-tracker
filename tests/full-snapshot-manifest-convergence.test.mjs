import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
const kind='finance-tracker-full-snapshot-manifest';
const make=http=>createFullSnapshotStorage({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
const patches=http=>http.requests.filter(r=>r.category==='update'&&r.kind===kind);
const bump=file=>{file.metadata.version=String(BigInt(file.metadata.version)+1n);};
async function setup(){const http=new HttpFullSnapshotDrive(),store=make(http);return {http,store,ledger:replayFixture(1).ledger};}
async function cleanup(h){h.http.beforeResponse=null;h.http.reboot();await h.store.release().catch(()=>{});}

for(const phase of ['initialize','post-two-patches','open','recover'])test('manifest version-only drift converges at '+phase,async()=>{
 const h=await setup();try{
  if(phase!=='initialize')await h.store.start({initialize:true});
  if(['open','recover'].includes(phase))await h.store.save(h.ledger);
  let changed=false,postPatchMedia=0;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(category!=='media'||row.kind!==kind||changed)return;
   if(phase==='post-two-patches'&&(patches(h.http).length!==2||++postPatchMedia!==1))return;
   // For init skip create receipt's unbracketed media and reach #selected.
   if(phase==='initialize'&&h.http.requests.filter(r=>r.kind===kind&&r.category==='media').length===1)return;
   bump(h.http.files.get(fileId));changed=true;
  };
  const result=await (phase==='initialize'?h.store.start({initialize:true}):phase==='post-two-patches'?h.store.save(h.ledger):phase==='open'?h.store.open():h.store.recover());
  assert.equal(changed,true);assert.deepEqual(result,phase==='initialize'?null:h.ledger);assert.equal(h.store.recoveryRequired,false);
  if(phase==='recover')assert.equal(h.store.verifiedManifest,null,'recovery does not seed baseline');
  if(phase==='post-two-patches')assert.equal(patches(h.http).length,2);
 }finally{await cleanup(h);}
});

for(const mutation of ['body','name','extra','backwards'])test('manifest convergence refuses '+mutation+' change',async()=>{
 const h=await setup();try{
  await h.store.start({initialize:true});await h.store.save(h.ledger);
  let changed=false;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(category!=='media'||row.kind!==kind||changed)return;
   const file=h.http.files.get(fileId);bump(file);changed=true;
   // Change bytes only after the first body was obtained so the anchor differs.
   if(mutation==='body')return;
   if(mutation==='name')file.metadata.name='unexpected';
   if(mutation==='extra')file.metadata.unexpected='extra';
   if(mutation==='backwards')file.metadata.version='1';
  };
  if(mutation==='body'){
   let medias=0;
   h.http.beforeResponse=({category,fileId,row})=>{
    if(category!=='media'||row.kind!==kind)return;
    const file=h.http.files.get(fileId);medias++;
    if(medias===1){bump(file);changed=true;}
    if(medias===2){const text=new TextDecoder().decode(file.bytes);file.bytes=new TextEncoder().encode(text.replace('"revision":"1"','"revision":"2"'));}
   };
  }
  const before=patches(h.http).length;
  await assert.rejects(h.store.open());assert.equal(changed,true);assert.equal(patches(h.http).length,before);
  assert.equal(h.store.recoveryRequired,true);assert.equal(h.store.verifiedManifest,null);
 }finally{await cleanup(h);}
});

test('perpetual manifest drift is bounded and cannot recover a baseline',async()=>{
 const h=await setup();try{
  await h.store.start({initialize:true});await h.store.save(h.ledger);let count=0;
  h.http.beforeResponse=({category,fileId,row})=>{if(category==='metadata'&&row.kind===kind){bump(h.http.files.get(fileId));count++;}};
  await assert.rejects(h.store.recover(),{code:'manifest-version-mismatch'});
  assert.ok(count<=10);assert.equal(h.store.verifiedManifest,null);assert.equal(h.store.recoveryRequired,true);
 }finally{await cleanup(h);}
});

test('scope invalidation during manifest revalidation cannot restore baseline',async()=>{
 const h=await setup();try{
  await h.store.start({initialize:true});let media=0;
  h.http.beforeResponse=({category,fileId,row})=>{
   if(category==='media'&&row.kind===kind){media++;if(media===1)bump(h.http.files.get(fileId));else h.store.invalidate();}
  };
  await assert.rejects(h.store.open(),{code:'verification-scope-closed'});
  assert.equal(media,2);assert.equal(h.store.verifiedManifest,null);assert.equal(patches(h.http).length,0);
 }finally{await cleanup(h);}
});

test('manifest revalidation has a whole-operation extra-media budget',async()=>{
 const h=await setup();try{
  await h.store.start({initialize:true});let reads=0;
  h.http.beforeResponse=({category,fileId,row})=>{
   // Every manifest media read is a bracket read. Three of every four drift.
   if(category==='media'&&row.kind===kind){reads++;if(reads%4!==0)bump(h.http.files.get(fileId));}
  };
  await assert.rejects(h.store.save(h.ledger),error=>error.code==='manifest-version-mismatch'||error.cause?.code==='manifest-version-mismatch');
  assert.equal(reads,11,'two brackets spend six extra reads; the third stops at the budget of eight');
  assert.ok(reads<=20,'extra media reads cannot grow without bound');
  assert.equal(h.store.verifiedManifest,null);assert.equal(h.store.recoveryRequired,true);
 }finally{await cleanup(h);}
});


test('preview initialization failure recovery does not save proposal; release and new copy have separate metrics',async()=>{
 const first=new HttpFullSnapshotDrive(),second=new HttpFullSnapshotDrive();let selected=first;
 const storage={lifecycle:null,accessToken:'',tokenExpiresAt:0,
  async connect(){this.lifecycle=new FullSnapshotApplication({folderId:selected.folderId,accessToken:()=> 'invented-test-token',fetchImpl:selected.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null,isOnline:()=>true});await this.lifecycle.start({initialize:true});},
  createLedgerStore(){return this.lifecycle.createLedgerStore();},
  async release(){const result=await this.lifecycle.release();this.lifecycle=null;return result;}
 };
 const session=new CanonicalWorkspaceSession({storage,online:()=>true}),ledger=replayFixture(1).ledger;
 session.preview(ledger);
 first.beforeResponse=({category,fileId,row})=>{if(category==='metadata'&&row.kind===kind)bump(first.files.get(fileId));};
 try{
  await assert.rejects(session.savePreviewToNewCopy(),{code:'manifest-version-mismatch'});
  const old=storage.lifecycle;assert.equal(old.state,'recovery-required');
  first.beforeResponse=null;
  await session.recover();
  assert.equal(old.engine.verifiedManifest,null);assert.equal(session.needsReopen,true);
  assert.deepEqual(session.ledger,ledger);assert.equal(session.mode,'preview');
  const manifest=first.json(old.engine.manifestFileId);assert.equal(manifest.revision,'0');assert.equal(manifest.head,null,'recovery did not seed the retained proposal');
  await session.release();assert.equal(storage.lifecycle,null);
  assert.equal(session.ledger,null,'privacy release clears the local preview');
  const oldMetrics=old.requestMetrics.snapshot();selected=second;
  session.preview(ledger); // Explicitly reload the invented source after closing.
  assert.deepEqual(await session.savePreviewToNewCopy(),ledger);
  assert.notStrictEqual(storage.lifecycle,old);assert.deepEqual(session.ledger,ledger);assert.equal(session.mode,'saved');
  assert.equal(storage.lifecycle.requestMetrics.snapshot().requests,second.requests.length,'latest lifecycle excludes prior folder requests');
  assert.equal(old.requestMetrics.snapshot().requests,oldMetrics.requests);
  assert.equal(first.json(old.engine.manifestFileId).head,null,'new save does not alter prior folder');
 }finally{first.beforeResponse=null;second.beforeResponse=null;await storage.lifecycle?.release().catch(()=>{});}
});
