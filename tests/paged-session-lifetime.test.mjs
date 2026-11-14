import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {createPortableLogicalCommit,PORTABLE_COMMIT_FORMAT} from '../js/physical-root-binding.mjs';
import {EMPTY_CANONICAL_BYTES,PAGED_CANONICAL_VERIFIER} from '../js/paged-canonical-format.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
const enc=new TextEncoder(),decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const encode=value=>enc.encode(canonicalizeJcs(value));
const order=entries=>entries.sort((a,b)=>(a.kind+':'+a.sha256).localeCompare(b.kind+':'+b.sha256));
function application(drive,plans=canonicalPartitionVerificationPlans()) {
 return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:plans,
  folderName:'Invented synthetic session lifetime',folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,makeManifest:()=>{},
  initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),
  adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});
}
async function rawSnapshot(app) {const snapshot=await app.readPartitionedSnapshot();await app.assertCurrentManifest(snapshot.manifest);return snapshot;}
function treeFor(app,m) {return createPagedPhysicalLocators(app.engine.physical,{databaseId:m.databaseId,copyId:m.copyId,folderId:app.folderId,assertWritable:async()=>{}});}
async function entriesFor(app,m) {const result=[];for await(const e of treeFor(app,m).entries(m.locatorRoot))result.push(e);return result;}
async function put(drive,bytes,kind='data-object') {
 const sha256=await partitionDigest(bytes),fileId='invented-lifetime-'+drive.nextId++;
 drive.files.set(fileId,{bytes:bytes.slice(),metadata:{id:fileId,name:fileId,mimeType:'application/octet-stream',parents:[drive.folderId],trashed:false,
  version:'1',size:String(bytes.length),appProperties:{financeTrackerHash:sha256,financeTrackerKind:kind==='data-object'?'snapshot-object':kind,financeTrackerTransaction:'invented-history'}}});
 return {kind,identity:sha256,sha256,fileId};
}
async function publish(app,drive,m) {const file=drive.files.get(app.manifestFileId);file.bytes=encode(m);file.metadata.size=String(file.bytes.length);file.metadata.version=String(BigInt(file.metadata.version)+1n);}
async function fixture({revisions=3,plans}={}) {
 const drive=new HttpCatalogDrive(),app=application(drive,plans);await app.start();
 let m=drive.json(app.manifestFileId);const entries=await entriesFor(app,m);
 const target=m.root;
 for(let revision=1;revision<=revisions;revision++){
  const c=createPortableLogicalCommit({databaseId:m.databaseId,parent:m.headCommit,revision:String(revision),previousRoot:m.root,root:target,
   transactionId:'invented-lifetime-'+revision,operation:'synthetic-canonical-import',semanticVersion:PAGED_CANONICAL_VERIFIER});
  const entry=await put(drive,encode(c),'commit-record');entries.push(entry);
  m={...m,root:target,revision:String(revision),headCommit:{format:PORTABLE_COMMIT_FORMAT,version:4,sha256:entry.sha256}};
 }
 m.locatorRoot=await treeFor(app,m).build(order(entries));await publish(app,drive,m);app.engine.invalidateHistory();
 return {app,drive,manifest:m,entries};
}
async function warmFixture(options) {const f=await fixture(options);await rawSnapshot(f.app);await rawSnapshot(f.app);return f;}

for(const phase of ['verifyBaseline','prepare','transact'])test(`invalidation after ${phase} cannot continue or complete an older save`,async()=>{
 const f=await warmFixture(),binding=f.app.engine.engine,original=binding[phase].bind(binding);
 let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 binding[phase]=async(...args)=>{const result=await original(...args);if(once){once=false;enter();await gate;}return result;};
 const old=f.app.savePartitionedRoot({expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}}).then(()=>null,error=>error);
 await entered;f.app.engine.invalidateHistory();await rawSnapshot(f.app);
 const mutations=f.drive.mutations,revision=f.drive.json(f.app.manifestFileId).revision;
 resolve();assert.ok(await old);assert.equal(f.drive.mutations,mutations);assert.equal(f.drive.json(f.app.manifestFileId).revision,revision);assert.equal(f.app.state,'ready');
 await rawSnapshot(f.app);await f.app.recover();await f.app.release();
});

for(const method of ['readPartitionedSnapshot','readManifest'])for(const depth of [1,2,3,4,5])test(`${method} rejects an old outer entry at microtask depth ${depth}`,async()=>{
 const f=await warmFixture(),guard=f.app.coordinator.assertCanWrite.bind(f.app.coordinator);let first=true,successor;
 f.app.coordinator.assertCanWrite=async options=>{await guard(options);if(first){first=false;
  let fn=()=>{f.app.engine.invalidateHistory();f.app.coordinator.assertCanWrite=guard;successor=rawSnapshot(f.app).then(()=>true,error=>error);};
  for(let i=0;i<depth;i++){const inner=fn;fn=()=>queueMicrotask(inner);}fn();
 }};
 const old=await f.app[method]().then(()=>null,error=>error);await new Promise(setImmediate);
 assert.ok(old);assert.equal(await successor,true);assert.equal(f.app.state,'ready');await f.app.release();
});

for(const outcome of ['success','failure'])test(`obsolete ${outcome} during physical close cannot erase its successor`,async()=>{
 const f=await warmFixture(),snapshot=await f.app.readPartitionedSnapshot(),read=f.app.transactionAdapter.readMetadataSnapshot.bind(f.app.transactionAdapter);
 let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.app.transactionAdapter.readMetadataSnapshot=async()=>{if(once){once=false;enter();await gate;if(outcome==='failure')throw new Error('invented old close failure');}return read();};
 const old=f.app.assertCurrentManifest(snapshot.manifest).then(()=>null,error=>error);await entered;
 f.app.engine.invalidateHistory();f.app.transactionAdapter.readMetadataSnapshot=read;await rawSnapshot(f.app);resolve();assert.ok(await old);assert.equal(f.app.state,'ready');
 await rawSnapshot(f.app);await f.app.release();
});

for(const outcome of ['success','failure'])test(`old opening owner ${outcome} cannot enter a successor`,async()=>{
 const f=await warmFixture(),guard=f.app.coordinator.assertCanWrite.bind(f.app.coordinator);let calls=0,enter,resolve;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.app.coordinator.assertCanWrite=async options=>{if(++calls===2){enter();await gate;if(outcome==='failure')throw new Error('invented old opening failure');}return guard(options);};
 const old=f.app.readPartitionedSnapshot().then(()=>null,error=>error);await entered;f.app.engine.invalidateHistory();f.app.coordinator.assertCanWrite=guard;
 await rawSnapshot(f.app);resolve();assert.ok(await old);assert.equal(f.app.state,'ready');await rawSnapshot(f.app);await f.app.release();
});

for(const outcome of ['success','failure'])test(`old final readiness ${outcome} cannot affect a successor`,async()=>{
 const f=await warmFixture(),snapshot=await f.app.readPartitionedSnapshot(),guard=f.app.coordinator.assertCanWrite.bind(f.app.coordinator);
 let calls=0,enter,resolve;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.app.coordinator.assertCanWrite=async options=>{if(++calls===3){enter();await gate;if(outcome==='failure')throw Object.assign(new Error('invented late ownership failure'),{code:'ownership-lost'});}return guard(options);};
 const old=f.app.assertCurrentManifest(snapshot.manifest).then(()=>null,error=>error);await entered;f.app.engine.invalidateHistory();f.app.coordinator.assertCanWrite=guard;
 await rawSnapshot(f.app);resolve();assert.ok(await old);assert.equal(f.app.state,'ready');await rawSnapshot(f.app);await f.app.release();
});

test('queued lifecycle write retains its original generation',async()=>{
 const f=await warmFixture();let resolve;f.app.coordinator.writeQueue=new Promise(r=>resolve=r);
 const old=f.app.savePartitionedRoot({expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}}).then(()=>null,error=>error);
 await new Promise(setImmediate);f.app.engine.invalidateHistory();await rawSnapshot(f.app);const mutations=f.drive.mutations;
 resolve();assert.ok(await old);assert.equal(f.drive.mutations,mutations);assert.equal(f.app.state,'ready');await f.app.release();
});

test('save awaiting snapshot closure cannot begin in a successor',async()=>{
 const f=await warmFixture();await f.app.readPartitionedSnapshot();const read=f.app.transactionAdapter.readMetadataSnapshot.bind(f.app.transactionAdapter);
 let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.app.transactionAdapter.readMetadataSnapshot=async()=>{if(once){once=false;enter();await gate;}return read();};
 const old=f.app.savePartitionedRoot({expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}}).then(()=>null,error=>error);
 await entered;f.app.engine.invalidateHistory();f.app.transactionAdapter.readMetadataSnapshot=read;await rawSnapshot(f.app);const mutations=f.drive.mutations;
 resolve();assert.ok(await old);assert.equal(f.drive.mutations,mutations);assert.equal(f.app.state,'ready');await rawSnapshot(f.app);await f.app.release();
});

test('forged stale codes do not suppress a current failure',async()=>{
 const f=await warmFixture(),read=f.app.transactionAdapter.readMetadataSnapshot;
 f.app.transactionAdapter.readMetadataSnapshot=async()=>{throw Object.assign(new Error('invented forged stale error'),{code:'verification-scope-closed',obsolete:true});};
 await assert.rejects(rawSnapshot(f.app));assert.equal(f.app.state,'recovery-required');
 f.app.transactionAdapter.readMetadataSnapshot=read;await f.app.recover();await f.app.release();
});

test('replayed authentic Error stays current while its older concurrent use stays obsolete',async()=>{
 const f=await warmFixture(),read=f.app.transactionAdapter.readMetadataSnapshot.bind(f.app.transactionAdapter);
 async function delayedClose(error){const snapshot=await f.app.readPartitionedSnapshot();let enter,resolve,once=true;
  const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
  f.app.transactionAdapter.readMetadataSnapshot=async()=>{if(once){once=false;enter();await gate;if(error)throw error;}return read();};
  const pending=f.app.assertCurrentManifest(snapshot.manifest).then(()=>null,error=>error);await entered;
  f.app.engine.invalidateHistory();f.app.transactionAdapter.readMetadataSnapshot=read;await rawSnapshot(f.app);return {pending,resolve};
 }
 const first=await delayedClose();first.resolve();const shared=await first.pending;
 const second=await delayedClose(shared),guard=f.app.coordinator.assertCanWrite.bind(f.app.coordinator);
 f.app.coordinator.assertCanWrite=async()=>{throw shared;};await assert.rejects(rawSnapshot(f.app));assert.equal(f.app.state,'recovery-required');
 f.app.coordinator.assertCanWrite=guard;await f.app.recover();await rawSnapshot(f.app);second.resolve();assert.ok(await second.pending);assert.equal(f.app.state,'ready');
 await rawSnapshot(f.app);await f.app.release();
});

test('invalidation during an awaited allocation fences the running binding before any durable write',async()=>{
 const f=await warmFixture(),allocate=f.app.transactionAdapter.allocateFileId.bind(f.app.transactionAdapter);
 let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.app.transactionAdapter.allocateFileId=async(...args)=>{const id=await allocate(...args);if(once){once=false;enter();await gate;}return id;};
 const old=f.app.savePartitionedRoot({expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}}).then(()=>null,error=>error);
 await entered;f.app.engine.invalidateHistory();const successor=rawSnapshot(f.app);await new Promise(setImmediate);const mutations=f.drive.mutations;
 resolve();assert.ok(await old);await successor;assert.equal(f.drive.mutations,mutations);assert.equal(f.drive.json(f.app.manifestFileId).revision,f.manifest.revision);assert.equal(f.app.state,'ready');
 await f.app.recover();await f.app.release();
});

test('current provider failure retains diagnostic details while pausing the lifecycle',async()=>{
 const f=await warmFixture(),read=f.app.transactionAdapter.readMetadataSnapshot,details={status:503,attempts:2};
 f.app.transactionAdapter.readMetadataSnapshot=async()=>{throw Object.assign(new Error('invented provider failure'),{code:'drive-request-failed',details});};
 await assert.rejects(rawSnapshot(f.app),error=>error.code==='drive-request-failed'&&error.message==='invented provider failure'&&assert.deepEqual(error.details,details)===undefined);
 assert.equal(f.app.state,'recovery-required');f.app.transactionAdapter.readMetadataSnapshot=read;await f.app.recover();await f.app.release();
});

test('a closed application context cannot authorize a new raw binding operation',async()=>{
 const f=await warmFixture();await f.app.engine.readSnapshot();await f.app.engine.finishSnapshot();
 const mutations=f.drive.mutations;await assert.rejects(f.app.engine.engine.verifyBaseline(),{code:'verification-scope-closed'});assert.equal(f.drive.mutations,mutations);
 f.app.engine.invalidateHistory();await f.app.release();
});

for(const outcome of ['success','failure'])test(`an expired raw body ${outcome} cannot poison the queued successor`,async()=>{
 const f=await warmFixture();f.app.engine.invalidateHistory();
 const read=f.app.transactionAdapter.readBytes.bind(f.app.transactionAdapter),binding=f.app.engine.engine,verify=binding.verifyBaseline.bind(binding);
 let calls=0,queued;const secondQueued=new Promise(r=>queued=r);binding.verifyBaseline=(...args)=>{if(++calls===2)queued();return verify(...args);};
 let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
 f.app.transactionAdapter.readBytes=async(...args)=>{if(once&&args[0]!==f.app.manifestFileId){once=false;enter();await gate;
   if(outcome==='failure')throw Object.assign(new Error('invented old raw body failure'),{code:'drive-request-failed',details:{status:503}});
  }return read(...args);};
 const old=f.app.readPartitionedSnapshot().then(()=>null,error=>error);await entered;
 f.app.engine.invalidateHistory();f.app.transactionAdapter.readBytes=read;const next=rawSnapshot(f.app);
 await secondQueued;resolve();assert.ok(await old);await next;assert.equal(f.app.state,'ready');await rawSnapshot(f.app);await f.app.release();
});

for(const boundary of ['application','physical','folder','plans'])for(const method of ['POST','PATCH'])test(`the final async guard cannot dispatch an expired ${method} after ${boundary} changes`,async()=>{
 const f=await warmFixture(),adapter=f.app.transactionAdapter,request=adapter.request.bind(adapter),fetch=adapter.fetch;
 let armed=true,expired=false,baseline;const afterExpiry=[];
 adapter.request=(url,options={},limits={})=>{
  if(armed&&options.method===method&&limits.beforeMutation){armed=false;const guard=limits.beforeMutation;
   limits={...limits,beforeMutation:async()=>{await guard();queueMicrotask(()=>{expired=true;baseline=f.drive.mutations;
    if(boundary==='physical')f.app.engine.physical.invalidateReadCache();
    else if(boundary==='folder')adapter.folderId='invented-other-folder';
    else if(boundary==='plans')f.app.engine.verificationPlans.set('invented-extra-plan',()=>{});
    else f.app.engine.invalidateHistory();
   });}};
  }return request(url,options,limits);
 };
 adapter.fetch=(...args)=>{if(expired&&['POST','PATCH'].includes(args[1]?.method))afterExpiry.push(args[1].method);return fetch(...args);};
 await assert.rejects(f.app.savePartitionedRoot({expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}}));
 assert.equal(expired,true);assert.deepEqual(afterExpiry,[]);assert.equal(f.drive.mutations,baseline);
 assert.equal(f.drive.json(f.app.manifestFileId).revision,f.manifest.revision);assert.equal(f.drive.json(f.app.manifestFileId).pending,null);
 adapter.request=request;adapter.fetch=fetch;adapter.folderId=f.drive.folderId;f.app.engine.verificationPlans.delete('invented-extra-plan');
 await f.app.recover();await f.app.release();
});

for(const boundary of ['application','physical'])for(const category of ['create','update'])for(const withSuccessor of [false,true])for(const lostResponse of [false,true])
 test(`an issued ${category} with ${lostResponse?'lost':'successful'} response requires recovery after ${boundary} expiry ${withSuccessor?'with':'without'} a successor`,async()=>{
  const f=await warmFixture();let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
  f.drive.beforeResponse=async info=>{if(once&&info.category===category){once=false;enter();await gate;}};
  const old=f.app.savePartitionedRoot({expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}}).then(()=>null,error=>error);
  await entered;const mutations=f.drive.mutations,requests=f.drive.requests.filter(r=>['create','update'].includes(r.category)).length;
  if(boundary==='physical')f.app.engine.physical.invalidateReadCache();else f.app.engine.invalidateHistory();
  const next=withSuccessor?rawSnapshot(f.app).then(()=>null,error=>error):null;
  if(lostResponse)f.drive.stopAfterMutation=mutations+1;
  resolve();assert.ok(await old);if(next)assert.ok(await next);
  assert.equal(f.drive.mutations,mutations+1,'The already-issued mutation may complete exactly once.');
  assert.equal(f.drive.requests.filter(r=>['create','update'].includes(r.category)).length,requests,'Expired continuations cannot dispatch a later mutation.');
  assert.equal(f.app.state,'recovery-required');assert.equal(f.app.engine.recoveryRequired,true);await assert.rejects(f.app.requireReady());
  if(category==='update')assert.equal(f.drive.json(f.app.manifestFileId).pending?.state,'admitted');
  f.drive.reboot();f.drive.beforeResponse=null;
  if(!withSuccessor){await f.app.recover();await rawSnapshot(f.app);await f.app.release();}
 });

for(const boundary of ['application','physical'])for(const operation of ['requireReady','readPartitionedSnapshot','savePartitionedRoot','recover'])
 test(`an issued PATCH after ${boundary} expiry blocks ${operation} until its provider outcome settles`,async()=>{
  const f=await warmFixture();let enter,resolve,once=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>resolve=r);
  f.drive.beforeResponse=async({category})=>{if(once&&category==='update'){once=false;enter();await gate;}};
  const transaction={expectedBase:f.manifest,rootHash:f.manifest.root,objects:[],preparationStore:{read:()=>assert.fail('unused')}};
  const old=f.app.savePartitionedRoot(transaction).then(()=>null,error=>error);await entered;
  if(boundary==='physical')f.app.engine.physical.invalidateReadCache();else f.app.engine.invalidateHistory();
  const mutations=f.drive.mutations,requests=f.drive.requests.filter(r=>['create','update'].includes(r.category)).length;
  await assert.rejects(f.app[operation](transaction));assert.equal(f.app.state,'recovery-required');
  assert.equal(f.drive.mutations,mutations);assert.equal(f.drive.requests.filter(r=>['create','update'].includes(r.category)).length,requests);
  resolve();assert.ok(await old);assert.equal(f.drive.mutations,mutations+1);
  f.drive.beforeResponse=null;await f.app.recover();await rawSnapshot(f.app);await f.app.release();
 });

test('the selected physical adapter is pinned and a closed token cannot authorize mutation',async()=>{
 const f=await warmFixture();await f.app.readPartitionedSnapshot();const physical=f.app.engine.physical,guard=f.app.engine.captureMutationGuard();
 assert.throws(()=>{f.app.engine.physical={assertVerificationLifetime:()=>{}};},TypeError);
 assert.throws(()=>Object.defineProperty(f.app.engine,'physical',{value:physical}),TypeError);
 guard();await f.app.engine.finishSnapshot();assert.throws(guard,{code:'verification-scope-closed'});
 f.app.engine.invalidateHistory();await f.app.release();
});
