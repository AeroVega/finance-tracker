import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

function application(drive) {
 return new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:canonicalPartitionVerificationPlans(),
  folderName:'Invented synthetic owned preparation',folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,makeManifest:()=>{},
  initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},
  setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});
}

test('canonical save uses its transaction baseline and only opens the post-save application snapshot',async()=>{
 const drive=new HttpCatalogDrive(),app=application(drive);await app.start();
 try {
  const store=new CanonicalLedgerStore({lifecycle:app});await store.load();
  const read=app.readPartitionedSnapshot.bind(app);let snapshots=0;
  app.readPartitionedSnapshot=(...args)=>{snapshots++;return read(...args);};
  const ledger=replayFixture(2).ledger;assert.deepEqual(await store.save(ledger),ledger);
  assert.equal(snapshots,1,'the owned transaction already verifies the exact base; only final readback opens a snapshot');
  const writes=drive.mutations;await store.save(ledger);assert.equal(drive.mutations,writes);assert.equal(snapshots,1);
 }finally{await app.release();}
});

import {EMPTY_CANONICAL_BYTES,PAGED_CANONICAL_VERIFIER} from '../js/paged-canonical-format.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const sentinel=rootHash=>({rootHash,objects:[],preparationStore:{read:()=>assert.fail('No new data objects are submitted.')}});
async function fixture(){const drive=new HttpCatalogDrive(),app=application(drive);await app.start();return {drive,app,base:await app.readManifest()};}
async function release(app){if(app.engine.recoveryRequired)await app.recover();await app.release();}
function digestGate(){
 const original=crypto.subtle.digest.bind(crypto.subtle),entered=gate(),pending=gate();let enabled=false,once=true;
 crypto.subtle.digest=async(...args)=>{if(enabled&&once){once=false;entered.resolve();await pending.promise;}return original(...args);};
 return {entered:entered.promise,open:()=>{enabled=true;},finish:()=>pending.resolve(),fail:error=>pending.reject(error),restore:()=>{crypto.subtle.digest=original;}};
}

test('preparation starts after authoritative baseline verification and receives only a frozen read capability',async()=>{
 const {drive,app,base}=await fixture();let read;
 try {
  const binding=app.engine.binding(),verify=binding.verifyBaseline.bind(binding);let verified=false,called=0;
  binding.verifyBaseline=async(...args)=>{const result=await verify(...args);verified=true;return result;};
  await app.savePartitionedRoot({expectedBase:base,prepare:async context=>{
   called++;assert.equal(verified,true);assert.deepEqual(Object.keys(context).sort(),['rootHash','semanticVersion','store']);
   assert.equal(Object.isFrozen(context),true);assert.equal(Object.isFrozen(context.store),true);assert.deepEqual(Object.keys(context.store),['read']);
   assert.equal(context.rootHash,base.root);assert.equal(context.semanticVersion,PAGED_CANONICAL_VERIFIER);read=context.store.read;
   const raw=await read(base.root);assert.deepEqual(raw,EMPTY_CANONICAL_BYTES);raw.fill(0);assert.deepEqual(await read(base.root),EMPTY_CANONICAL_BYTES);
   return sentinel(context.rootHash);
  }});
  assert.equal(called,1);assert.equal(drive.json(app.manifestFileId).revision,'1');const requests=drive.requests.length;
  await assert.rejects(read(base.root),{code:'verification-scope-closed'});assert.equal(drive.requests.length,requests);
  const snapshot=await app.readPartitionedSnapshot();await assert.rejects(read(base.root),{code:'verification-scope-closed'});
  assert.deepEqual(await snapshot.store.read(base.root),EMPTY_CANONICAL_BYTES);await app.assertCurrentManifest(snapshot.manifest);
 }finally{await release(app);}
});

test('stale expected base never invokes preparation or creates evidence',async()=>{
 const {drive,app,base}=await fixture();let called=false;const writes=drive.mutations;
 try {await assert.rejects(app.savePartitionedRoot({expectedBase:{...base,revision:'7'},prepare:()=>{called=true;return sentinel(base.root);}}),{code:'base-conflict'});
  assert.equal(called,false);assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);
 }finally{await release(app);}
});

test('expected base is owned before lifecycle readiness or transaction queue awaits',async()=>{
 const {drive,app,base}=await fixture(),entered=gate(),pending=gate(),ready=app.requireReady.bind(app);let once=true,observed;
 app.requireReady=async()=>{if(once){once=false;entered.resolve();await pending.promise;}return ready();};
 try {
  const saving=app.savePartitionedRoot({expectedBase:base,prepare:context=>{observed=context.rootHash;return sentinel(context.rootHash);}});
  await entered.promise;const originalRoot=base.root;base.root='f'.repeat(64);base.copyId='invented-retarget';pending.resolve();
  await saving;assert.equal(observed,originalRoot);assert.equal(drive.json(app.manifestFileId).root,originalRoot);
 }finally{pending.resolve();app.requireReady=ready;await release(app);}
});

for(const thrown of [false,true])test(`callback ${thrown?'failure':'success'} drains admitted reads before any mutation and expires further admissions`,async()=>{
 const {drive,app,base}=await fixture(),digest=digestGate();const writes=drive.mutations;let reader,readResult,settled=false;
 try {
  const outcome=app.savePartitionedRoot({expectedBase:base,prepare:context=>{
   reader=context.store.read;digest.open();readResult=reader(base.root);
   if(thrown)throw Object.assign(new Error('Invented callback failure'),{code:'invented-callback-failure'});
   return sentinel(base.root);
  }}).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
  await digest.entered;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.equal(drive.mutations,writes);await assert.rejects(reader(base.root),{code:'verification-scope-closed'});
  assert.throws(app.engine.captureMutationGuard(),{code:'verification-scope-closed'});
  digest.finish();assert.deepEqual(await readResult,EMPTY_CANONICAL_BYTES);const result=await outcome;
  if(thrown){assert.equal(result.error.code,'invented-callback-failure');assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);assert.equal(app.state,'recovery-required');}
  else assert.equal(result.error,undefined);
 }finally{digest.finish();digest.restore();await release(app);}
});

for(const caught of [false,true])test(`${caught?'caught':'unawaited'} preparation read rejection remains fatal before staging`,async()=>{
 const {drive,app,base}=await fixture(),writes=drive.mutations;
 try {
  await assert.rejects(app.savePartitionedRoot({expectedBase:base,prepare:async({store,rootHash})=>{
   const reading=store.read('f'.repeat(64));if(caught)await assert.rejects(reading,{code:'object-not-found'});
   return sentinel(rootHash);
  }}),{code:'object-not-found'});
  assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);assert.equal(app.state,'recovery-required');
 }finally{await release(app);}
});

for(const reason of [undefined,null,false,0,'',NaN])test(`falsy preparation rejection ${String(reason)} cannot turn into success`,async()=>{
 const {drive,app,base}=await fixture(),writes=drive.mutations;let reader;
 try {
  await assert.rejects(app.savePartitionedRoot({expectedBase:base,prepare:context=>{reader=context.store.read;throw reason;}}));
  assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);await assert.rejects(reader(base.root),{code:'verification-scope-closed'});
 }finally{await release(app);}
});

for(const failure of [false,true])test(`obsolete admitted read ${failure?'failure':'success'} cannot poison a recovered successor`,async()=>{
 const {drive,app,base}=await fixture(),digest=digestGate(),writes=drive.mutations;let reader;
 try {
  const outcome=app.savePartitionedRoot({expectedBase:base,prepare:context=>{reader=context.store.read;digest.open();void reader(base.root);return sentinel(base.root);}}).then(value=>({value}),error=>({error}));
  await digest.entered;await app.engine.recover();assert.equal(app.engine.recoveryRequired,false);
  if(failure)digest.fail(Object.assign(new Error('Invented delayed failure'),{code:'invented-delayed-failure'}));else digest.finish();
  assert.ok((await outcome).error);assert.equal(app.state,'ready');assert.equal(app.acceptingWrites,true);assert.equal(app.engine.recoveryRequired,false);assert.equal(drive.mutations,writes);
  await assert.rejects(reader(base.root),{code:'verification-scope-closed'});
  const next=await app.readPartitionedSnapshot();assert.deepEqual(await next.store.read(base.root),EMPTY_CANONICAL_BYTES);await app.assertCurrentManifest(next.manifest);
 }finally{digest.finish();digest.restore();await release(app);}
});

test('invalidation while callback awaits cannot stage or return old authority',async()=>{
 const {drive,app,base}=await fixture(),entered=gate(),pending=gate(),writes=drive.mutations;
 try {
  const outcome=app.savePartitionedRoot({expectedBase:base,prepare:async({rootHash})=>{entered.resolve();await pending.promise;return sentinel(rootHash);}}).then(value=>({value}),error=>({error}));
  await entered.promise;await app.engine.recover();pending.resolve();assert.ok((await outcome).error);
  assert.equal(drive.mutations,writes);assert.equal(app.engine.recoveryRequired,false);assert.equal(app.state,'ready');
 }finally{pending.resolve();await release(app);}
});

for(const change of ['folder','verifier','manifest','ownership'])test(`${change} changes during preparation fail before mutation`,async()=>{
 const {drive,app,base}=await fixture(),writes=drive.mutations,original=structuredClone(drive.files.get(app.manifestFileId)),plans=app.engine.verificationPlans,verifier=plans.get(PAGED_CANONICAL_VERIFIER),folder=app.transactionAdapter.folderId;
 try {
  await assert.rejects(app.savePartitionedRoot({expectedBase:base,prepare:({rootHash})=>{
   if(change==='folder')app.transactionAdapter.folderId='invented-wrong-folder';
   if(change==='verifier')plans.set(PAGED_CANONICAL_VERIFIER,async()=>{});
   if(change==='manifest'){const file=drive.files.get(app.manifestFileId);file.bytes=new TextEncoder().encode(canonicalizeJcs({...base,copyId:'invented-other-copy'}));file.metadata.version='99';file.metadata.size=String(file.bytes.length);}
   if(change==='ownership')app.coordinator.ownership='unknown';
   return sentinel(rootHash);
  }}));
  assert.equal(drive.mutations,writes);
 }finally{app.transactionAdapter.folderId=folder;plans.set(PAGED_CANONICAL_VERIFIER,verifier);drive.files.set(app.manifestFileId,original);app.coordinator.ownership='owned';await release(app);}
});

test('canonical input remains owned and preparation base fallback expires after callback',async()=>{
 const {drive,app}=await fixture();let escaped,baseRoot;const save=app.savePartitionedRoot.bind(app);
 try {
  const store=new CanonicalLedgerStore({lifecycle:app});await store.load();const input=replayFixture(3).ledger,expected=structuredClone(input);
  app.savePartitionedRoot=args=>save({...args,prepare:async context=>{baseRoot=context.rootHash;const result=await args.prepare(context);escaped=result.preparationStore;return result;}});
  const saving=store.save(input);input.accounts[0].displayName='Invented caller mutation';input.activities.length=0;
  assert.deepEqual(await saving,expected);const requests=drive.requests.length;
  await assert.rejects(escaped.read(baseRoot),{code:'verification-scope-closed'});assert.equal(drive.requests.length,requests);
 }finally{await release(app);}
});

for(const reason of [undefined,null,false,0,'',NaN])test(`caught falsy read rejection ${String(reason)} remains a preparation failure`,async()=>{
 const {drive,app,base}=await fixture(),digest=digestGate(),writes=drive.mutations;
 try {
  const outcome=app.savePartitionedRoot({expectedBase:base,prepare:async context=>{
   digest.open();await context.store.read(base.root).catch(()=>{});return sentinel(base.root);
  }}).then(value=>({value}),error=>({error}));
  await digest.entered;digest.fail(reason);assert.ok((await outcome).error);assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);
 }finally{digest.finish();digest.restore();await release(app);}
});

for(const kind of ['invalid-bound','small-bound','aborted-read'])test(`${kind} cannot be caught to admit a preparation`,async()=>{
 const {drive,app,base}=await fixture(),writes=drive.mutations;
 try {
  await assert.rejects(app.savePartitionedRoot({expectedBase:base,prepare:async({store})=>{
   const controller=new AbortController();controller.abort();
   await assert.rejects(store.read(base.root,kind==='aborted-read'?{signal:controller.signal}:{maxBytes:kind==='small-bound'?1:0}));
   return sentinel(base.root);
  }}));assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);
 }finally{await release(app);}
});

test('retained prepared parent does not hide newly required descendants from final reachability or upload',async()=>{
 const {updatePartitionedCanonicalLedger,partitionDigest}=await import('../js/canonical-partitions.mjs');
 const {inspectFinalClosures}=await import('./helpers/paged-final-closures.mjs');
 const {drive,app,base}=await fixture(),ledger=replayFixture(2).ledger,prepared=new Map();
 const preparationStore={read:async hash=>{assert.ok(prepared.has(hash));return prepared.get(hash).slice();},write:async raw=>{const hash=await partitionDigest(raw);prepared.set(hash,raw.slice());return hash;}};
 try {
  const built=await updatePartitionedCanonicalLedger(ledger,preparationStore),raw=prepared.get(built.rootHash);
  // A retained but previously unreachable data object is legal physical history.
  // Its future child bytes are deliberately not retained by this sentinel save.
  await app.savePartitionedRoot({expectedBase:base,rootHash:base.root,objects:[{kind:'data-object',identity:built.rootHash,sha256:built.rootHash,byteLength:raw.length}],preparationStore});
  const store=new CanonicalLedgerStore({lifecycle:app});assert.equal(await store.load(),null);
  const before=inspectFinalClosures(drive,store.base),start=drive.requests.length;assert.ok(before.retainedData.has(built.rootHash));
  assert.deepEqual(await store.save(ledger),ledger);assert.equal(store.base.root,built.rootHash);
  const final=inspectFinalClosures(drive,store.base),uploaded=drive.requests.slice(start).filter(row=>row.category==='create'&&row.status===200&&row.kind==='snapshot-object').map(row=>drive.files.get(row.fileId).metadata.appProperties.financeTrackerHash);
  assert.ok(!uploaded.includes(built.rootHash),'retained parent is reused');
  assert.deepEqual(uploaded.toSorted(),[...final.canonicalHashes].filter(hash=>!before.retainedData.has(hash)).sort());
  assert.ok(uploaded.length>0,'new required descendants were not pruned with the retained parent');
 }finally{await release(app);}
});

test('ambiguous preparation authority is rejected before opening or invoking a callback',async()=>{
 const {drive,app,base}=await fixture(),writes=drive.mutations;let called=false;
 try {await assert.rejects(app.savePartitionedRoot({expectedBase:base,rootHash:base.root,objects:[],preparationStore:{read:async()=>EMPTY_CANONICAL_BYTES},prepare:()=>{called=true;return sentinel(base.root);}}),{code:'invalid-preparation'});
  assert.equal(called,false);assert.equal(drive.mutations,writes);
 }finally{await release(app);}
});

test('callback result and descriptor mutations during drain cannot retarget the prepared root or bytes',async()=>{
 const {partitionDigest}=await import('../js/canonical-partitions.mjs');
 const {drive,app,base}=await fixture(),digest=digestGate(),raw=new TextEncoder().encode('{"invented":"owned callback result"}'),hash=await partitionDigest(raw);let result;
 try {
  const saving=app.savePartitionedRoot({expectedBase:base,prepare:context=>{
   digest.open();void context.store.read(base.root);
   result={rootHash:base.root,objects:[{kind:'data-object',identity:hash,sha256:hash,byteLength:raw.length}],preparationStore:{read:async()=>raw.slice()}};
   return result;
  }});
  await digest.entered;result.rootHash='f'.repeat(64);result.objects[0].sha256='e'.repeat(64);result.objects.length=0;result.preparationStore.read=()=>assert.fail('Changed returned method cannot replace the owned reader.');
  digest.finish();await saving;assert.equal(drive.json(app.manifestFileId).root,base.root);
  assert.ok([...drive.files.values()].some(file=>file.metadata.appProperties?.financeTrackerHash===hash),'the snapshotted descriptor was staged');
 }finally{digest.finish();digest.restore();await release(app);}
});

test('synchronous callback result is owned before its queued mutations execute',async()=>{
 const {drive,app,base}=await fixture();
 try {
  await app.savePartitionedRoot({expectedBase:base,prepare:({rootHash})=>{
   const result=sentinel(rootHash);queueMicrotask(()=>{result.rootHash='f'.repeat(64);result.objects.push({invented:'invalid'});});return result;
  }});assert.equal(drive.json(app.manifestFileId).root,base.root);
 }finally{await release(app);}
});

test('a complete prepared financial audit failure preserves the exact old manifest and requires recovery',async()=>{
 const {updatePartitionedCanonicalLedger,partitionDigest,createPartitionObjectIO,createPartitionValueCodec}=await import('../js/canonical-partitions.mjs');
 const {readVerifiedPartitionedLedger}=await import('../js/canonical-paged-storage.mjs');
 const {drive,app,base}=await fixture(),writes=drive.mutations;let escaped;
 try {
  await assert.rejects(app.savePartitionedRoot({expectedBase:base,prepare:async({store})=>{
   escaped=store.read;const bytes=new Map(),prepared={read:async hash=>{assert.ok(bytes.has(hash));return bytes.get(hash).slice();},write:async raw=>{const hash=await partitionDigest(raw);bytes.set(hash,raw.slice());return hash;}};
   const built=await updatePartitionedCanonicalLedger(replayFixture(2).ledger,prepared),io=createPartitionObjectIO(prepared),codec=createPartitionValueCodec(prepared,{version:2}),root=await io.read(built.rootHash),derived=await io.read(root.derived),rows=[];
   for await(const row of codec.tree.entries(derived.summaries))rows.push(row);
   const summary=await codec.materialize(rows[0][1]);summary.spending='999999.99';rows[0][1]=await codec.encode(summary);
   derived.summaries=await codec.tree.build(rows);root.derived=await io.write(derived);const forged=await io.write(root);
   await readVerifiedPartitionedLedger(prepared,forged);assert.fail('Full independent financial audit must reject the rehashed projection.');
  }}),{code:'canonical-derived-mismatch'});
  assert.equal(drive.mutations,writes);assert.deepEqual(drive.json(app.manifestFileId),base);assert.equal(app.state,'recovery-required');
  await assert.rejects(escaped(base.root),{code:'verification-scope-closed'});await app.recover();assert.equal(app.state,'ready');assert.deepEqual(drive.json(app.manifestFileId),base);
 }finally{await release(app);}
});


test('a newer manifest before baseline verification rejects the exact caller base before preparation',async()=>{
 const {drive,app,base}=await fixture(),original=structuredClone(drive.files.get(app.manifestFileId));
 try {
  await app.savePartitionedRoot({expectedBase:base,...sentinel(base.root)});
  const newer=structuredClone(drive.files.get(app.manifestFileId));
  const select=file=>{const version=String(BigInt(drive.files.get(app.manifestFileId).metadata.version)+1n);file=structuredClone(file);file.metadata.version=version;drive.files.set(app.manifestFileId,file);};
  select(original);app.engine.invalidateHistory();
  const store=new CanonicalLedgerStore({lifecycle:app});await store.load();
  const binding=app.engine.binding(),verify=binding.verifyBaseline.bind(binding);let called=false,once=true;
  binding.verifyBaseline=(...args)=>{if(once){once=false;select(newer);}return verify(...args);};
  const save=app.savePartitionedRoot.bind(app);
  app.savePartitionedRoot=args=>save({...args,prepare:context=>{called=true;return args.prepare(context);}});
  const writes=drive.mutations;
  await assert.rejects(store.save(replayFixture(2).ledger),{code:'base-conflict'});
  assert.equal(called,false);assert.equal(drive.mutations,writes);assert.equal(drive.json(app.manifestFileId).revision,'1');
  binding.verifyBaseline=verify;
 }finally{await release(app);}
});
