import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createFullSnapshotStorage,FULL_SNAPSHOT_LIMITS,FULL_SNAPSHOT_MANIFEST_NAME} from '../js/full-snapshot-storage.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {replayFixture,replayRow} from './helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent,getEffectiveActivities,validateLedger,summarizeLedger} from '../js/canonical-import.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {assertCanonicalLedgerTransition} from '../js/canonical-history.mjs';

const MANIFEST_KIND='finance-tracker-full-snapshot-manifest';
const make=(http,factory=createFullSnapshotStorage)=>factory({folderId:http.folderId,accessToken:()=> 'invented-test-token',
 fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
const financialWrites=(http,start=0)=>http.requests.slice(start).filter(r=>['create','update'].includes(r.category)&&r.kind!=='session-marker');
const manifestPatches=(http,start=0)=>financialWrites(http,start).filter(r=>r.category==='update'&&r.kind===MANIFEST_KIND);
const bump=file=>{file.metadata.version=String(BigInt(file.metadata.version)+1n);file.metadata.size=String(file.bytes.length);};
const corrupt=file=>{file.bytes=file.bytes.slice();file.bytes[0]^=1;bump(file);};
let sequence=100;
function correction(ledger,label='new'){
 const next=applyFinancialEvent(ledger,{activityId:getEffectiveActivities(ledger)[0].activityId,type:'category-correction',
  categoryId:'invented-'+label,commandId:'invented-full-command-'+(++sequence),evidence:{rationale:'Invented full snapshot test'}},
  {now:()=> '2026-11-16T00:00:00.000Z',idFactory:()=> 'f0110001-0000-4000-8000-'+String(++sequence).padStart(12,'0')});
 validateLedger(next);assertCanonicalLedgerTransition(ledger,next);return next;
}
async function setup(factory){
 const http=new HttpFullSnapshotDrive(),store=make(http,factory);assert.equal(await store.start({initialize:true}),null);
 return {http,store};
}
async function seed(h){const ledger=replayFixture(1).ledger;await h.store.save(ledger);return ledger;}
const close=async h=>{h.http.beforeResponse=null;h.http.reboot();await h.store.release().catch(()=>{});};
function selected(h){const manifest=h.http.json(h.store.manifestFileId),envelope=manifest.head&&h.http.json(manifest.head.fileId);return {manifest,envelope};}

test('new format saves exact ledger with two immutable creates and two authority patches',async()=>{
 const h=await setup();
 try{
  assert.equal(h.http.files.get(h.store.manifestFileId).metadata.name,FULL_SNAPSHOT_MANIFEST_NAME);
  const ledger=replayFixture(1).ledger,start=h.http.requests.length;
  assert.deepEqual(await h.store.save(ledger),ledger);
  const writes=financialWrites(h.http,start);
  assert.equal(writes.filter(r=>r.category==='create').length,2);
  assert.deepEqual(writes.filter(r=>r.category==='create').map(r=>r.kind).sort(),['commit-record','snapshot-object']);
  assert.equal(manifestPatches(h.http,start).length,2);
  assert.equal(selected(h).manifest.pending,null);
  const noOpStart=h.http.requests.length,noOpResult=await h.store.save(ledger);
  assert.deepEqual(noOpResult,ledger);assert.notStrictEqual(noOpResult,ledger);
  assert.equal(financialWrites(h.http,noOpStart).length,0);
  assert.deepEqual(await h.store.open(),ledger);
  const report={start:'2026-01-01',end:'2026-01-31',currency:'USD'};
  assert.deepEqual(summarizeLedger(await h.store.open(),report),summarizeLedger(ledger,report));
 }finally{await close(h);}
});

test('ordinary save defers only old snapshot damage; explicit full open rejects it',async()=>{
 const h=await setup();
 try{
  const first=await seed(h),historic=selected(h).envelope.snapshot.fileId;
  const second=correction(first,'second');await h.store.save(second);
  corrupt(h.http.files.get(historic));
  const third=correction(second,'third');assert.deepEqual(await h.store.save(third),third);
  const start=h.http.requests.length;await assert.rejects(h.store.open());assert.equal(financialWrites(h.http,start).length,0);
  assert.equal(h.store.recoveryRequired,true);
  await assert.rejects(h.store.save(correction(third,'no-baseline')));
 }finally{await close(h);}
});

test('current snapshot corruption refuses save before authority writes',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h);corrupt(h.http.files.get(selected(h).envelope.snapshot.fileId));
  const start=h.http.requests.length;await assert.rejects(h.store.save(correction(ledger)));
  assert.equal(financialWrites(h.http,start).length,0);
 }finally{await close(h);}
});

test('input snapshot cap rejects before any financial mutation',async()=>{
 const h=await setup();
 try{
  const ledger=replayFixture(1,[replayRow(0,{sourceDescription:'X'.repeat(FULL_SNAPSHOT_LIMITS.snapshotBytes+1)})]).ledger;
  validateLedger(ledger);const start=h.http.requests.length;
  await assert.rejects(h.store.save(ledger),{code:'byte-limit'});
  assert.equal(financialWrites(h.http,start).length,0);
 }finally{await close(h);}
});

test('fixed-ID collision never overwrites or publishes a different object',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),occupied=selected(h).envelope.snapshot.fileId;
  const old=structuredClone(h.http.files.get(occupied));h.store.adapter.generatedFileIds.unshift(occupied);
  const start=h.http.requests.length;await assert.rejects(h.store.save(correction(ledger)));
  assert.deepEqual(h.http.files.get(occupied),old);assert.equal(manifestPatches(h.http,start).length,0);
  // The refused snapshot and its concurrently uploaded envelope, an unpublished orphan.
  assert.equal(financialWrites(h.http,start).filter(r=>r.category==='create').length,2);
 }finally{await close(h);}
});

for(const boundary of [1,2,3,4])test('lost response at financial mutation '+boundary+' remains recoverable or explicitly refused',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),next=correction(ledger,'lost-'+boundary);
  h.http.stopAfterMutation=h.http.mutations+boundary;
  await assert.rejects(h.store.save(next),error=>error.code==='write-unresolved'&&Boolean(error.cause));
  assert.equal(h.store.recoveryRequired,true);h.http.reboot();
  const recovered=await h.store.recover();
  const durable=selected(h).manifest;
  assert.equal(durable.pending,null);
  const expected=boundary<3?ledger:next;
  assert.deepEqual(recovered,expected);assert.equal(h.store.recoveryRequired,false);
  await assert.rejects(h.store.save(correction(expected,'requires-open')));
  assert.deepEqual(await h.store.open(),expected);
 }finally{await close(h);}
});

test('owner change before publication refuses both authority patches',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),start=h.http.requests.length;let changed=false;
  h.http.beforeResponse=async({category,fileId})=>{
   if(changed||category!=='media'||h.http.files.get(fileId)?.metadata.appProperties?.financeTrackerKind!=='commit-record')return;
   // The current envelope read may precede staging; any observed ownership
   // change must still stop publication rather than certify the candidate.
   changed=true;const file=[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerSession==='v1');
   const record=JSON.parse(new TextDecoder().decode(file.bytes));record.sessionId='invented-foreign-owner';
   file.bytes=new TextEncoder().encode(JSON.stringify(record));bump(file);
  };
  await assert.rejects(h.store.save(correction(ledger)));assert.equal(changed,true);
  assert.equal(manifestPatches(h.http,start).length,0);
 }finally{await close(h);}
});

test('late issued PATCH cannot report success or admit a successor before settling',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),next=correction(ledger,'late');let release,entered,blocked=false;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  h.http.beforeResponse=async({category,fileId})=>{if(!blocked&&category==='update'&&fileId===h.store.manifestFileId){blocked=true;entered();await gate;}};
  const pending=h.store.save(next).then(()=>null,error=>error);await started;h.store.invalidate();
  await assert.rejects(h.store.open());
  release();const error=await pending;assert.equal(error.code,'write-unresolved');assert.ok(error.cause);assert.equal(h.store.recoveryRequired,true);h.http.beforeResponse=null;
  assert.deepEqual(await h.store.recover(),next);assert.deepEqual(await h.store.open(),next);
 }finally{await close(h);}
});

for(const mode of ['duplicate','foreign','unsupported'])test('fresh start refuses '+mode+' manifest without financial writes',async()=>{
 const h=await setup();
 try{
  await seed(h);await h.store.release();
  const original=h.http.files.get(h.store.manifestFileId),m=h.http.json(h.store.manifestFileId);
  if(mode==='duplicate'){
   const copy=structuredClone(original);copy.metadata.id+='-duplicate';h.http.files.set(copy.metadata.id,copy);
  }else{
   if(mode==='unsupported')m.version=999;else m.copyId='invented-foreign-copy';
   original.bytes=new TextEncoder().encode(JSON.stringify(m));bump(original);
  }
  const next=make(h.http),start=h.http.requests.length;
  await assert.rejects(next.start());assert.equal(financialWrites(h.http,start).length,0);await next.release().catch(()=>{});
 }finally{await close(h);}
});

test('direct invalidation during current read stops before allocation or mutation',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),id=selected(h).envelope.snapshot.fileId,start=h.http.requests.length;let invalidated=false;
  h.http.beforeResponse=async({category,fileId})=>{if(!invalidated&&category==='media'&&fileId===id){invalidated=true;h.store.invalidate();}};
  await assert.rejects(h.store.save(correction(ledger)),{code:'verification-scope-closed'});
  assert.equal(invalidated,true);assert.equal(financialWrites(h.http,start).length,0);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='generate-id').length,0);
  assert.equal(h.store.recoveryRequired,true);
 }finally{await close(h);}
});
test('direct invalidation after published PATCH is uncertain and cannot finalize',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),next=correction(ledger,'post-publication'),start=h.http.requests.length;
  const original=h.http.respond.bind(h.http);let invalidated=false;
  h.http.respond=async(target,options,category,id,row)=>{
   const result=await original(target,options,category,id,row);
   if(!invalidated&&category==='update'&&id===h.store.manifestFileId){invalidated=true;h.store.invalidate();}
   return result;
  };
  await assert.rejects(h.store.save(next),error=>error.code==='write-unresolved'&&Boolean(error.cause));
  assert.equal(manifestPatches(h.http,start).length,1);assert.equal(h.store.recoveryRequired,true);
  assert.equal(selected(h).manifest.pending.state,'published');
  h.http.respond=original;assert.deepEqual(await h.store.recover(),next);assert.equal(h.store.recoveryRequired,false);
 }finally{await close(h);}
});
test('prospective history limit refuses next save without writes',async()=>{
 // Load an otherwise identical local module with only a smaller test bound;
 // do not create ten thousand provider objects or edit runtime source.
 const sourceURL=new URL('../js/full-snapshot-storage.mjs',import.meta.url);
 let source=await readFile(sourceURL,'utf8');
 assert.equal((source.match(/maxHistory:10000/g)||[]).length,1);
 source=source.replace('maxHistory:10000','maxHistory:2').replace(/from '\.\/(.*?)'/g,
  (_,path)=>'from '+JSON.stringify(new URL(path,sourceURL).href));
 const {createFullSnapshotStorage:smallFactory}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const h=await setup(smallFactory);
 try{
  const first=await seed(h),second=correction(first,'limit');await h.store.save(second);
  const start=h.http.requests.length;await assert.rejects(h.store.save(correction(second,'over-limit')),{code:'byte-limit'});
  assert.equal(financialWrites(h.http,start).length,0);assert.deepEqual(await h.store.open(),second);
 }finally{await close(h);}
});

async function replaceImmutableJson(http,ref,value){
 const raw=new TextEncoder().encode(canonicalizeJcs(value));
 const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',raw)).toString('hex');
 const file=http.files.get(ref.fileId);file.bytes=raw;file.metadata.name='ft-full-'+sha256+'.bin';
 file.metadata.appProperties.financeTrackerHash=sha256;bump(file);
 return {fileId:ref.fileId,sha256,byteLength:raw.length};
}
async function replaceManifest(h,m){
 const file=h.http.files.get(h.store.manifestFileId);file.bytes=new TextEncoder().encode(canonicalizeJcs(m));bump(file);
}
for(const fault of ['missing-parent','wrong-prior-hash','foreign-copy','revision-gap','unsupported-profile','repeated-parent-id'])
test('full audit refuses hash-valid envelope with '+fault,async()=>{
 const h=await setup();
 try{
  const first=await seed(h);await h.store.save(correction(first,'history'));
  const {manifest:m,envelope:e}=selected(h);
  if(fault==='missing-parent'){
   e.parent={...e.parent,fileId:'invented-missing-parent'};
   const prior={...m,revision:String(BigInt(m.revision)-1n),head:e.parent,pending:null};
   e.previousManifestHash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalizeJcs(prior)))).toString('hex');
  }
  if(fault==='wrong-prior-hash')e.previousManifestHash='0'.repeat(64);
  if(fault==='foreign-copy')e.copyId='invented-other-copy';
  if(fault==='revision-gap')e.revision='99';
  if(fault==='unsupported-profile')e.profile='invented-unsupported-profile';
  if(fault==='repeated-parent-id')e.parent={...m.head};
  m.head=await replaceImmutableJson(h.http,m.head,e);await replaceManifest(h,m);
  const start=h.http.requests.length;await assert.rejects(h.store.open());assert.equal(financialWrites(h.http,start).length,0);
 }finally{await close(h);}
});
test('full audit checks append-only financial transitions even when hashes are recomputed',async()=>{
 const h=await setup();
 try{
  const first=await seed(h),second=correction(first,'second');await h.store.save(second);
  const {manifest:m,envelope:e}=selected(h),altered=structuredClone(second);
  altered.accounts[0].displayName='Invented rewritten historical account';validateLedger(altered);
  e.snapshot=await replaceImmutableJson(h.http,e.snapshot,altered);
  m.head=await replaceImmutableJson(h.http,m.head,e);await replaceManifest(h,m);
  const start=h.http.requests.length;await assert.rejects(h.store.open());assert.equal(financialWrites(h.http,start).length,0);
 }finally{await close(h);}
});


test('initializer durable manifest create with lost reply requires verified genesis recovery',async()=>{
 const http=new HttpFullSnapshotDrive(),store=make(http),h={http,store};
 const original=http.respond.bind(http);let lost=false;
 http.respond=async(target,options,category,id,row)=>{
  const response=await original(target,options,category,id,row);
  if(!lost&&category==='create'&&row.kind===MANIFEST_KIND){lost=true;http.stopped=true;throw new Error('Invented lost initializer response with unavailable reconciliation');}
  return response;
 };
 try{
  await assert.rejects(store.start({initialize:true}),error=>error.code==='write-unresolved'&&Boolean(error.cause));
  assert.equal(lost,true);assert.equal(store.recoveryRequired,true);
  assert.equal([...http.files.values()].filter(f=>f.metadata.appProperties?.financeTrackerKind===MANIFEST_KIND).length,1);
  http.respond=original;http.reboot();
  assert.equal(await store.recover(),null);assert.equal(store.recoveryRequired,false);
  assert.equal(store.verifiedManifest,null);
  assert.equal(await store.open(),null);assert.equal(store.verifiedManifest.revision,'0');
  assert.equal(store.verifiedManifest.head,null);assert.equal(store.verifiedManifest.pending,null);
 }finally{http.respond=original;await close(h);}
});

for(const api of ['verifiedManifest','assertVerifiedBaseline'])
test(api+' refuses proof handoff if captured clock reentrantly invalidates storage',async()=>{
 const realNow=Date.now;let armed=false,invalidations=0,store;
 Date.now=()=>{if(armed){armed=false;invalidations++;store.invalidate();}return realNow();};
 let h;
 try{h=await setup();store=h.store;}finally{Date.now=realNow;}
 try{
  const expected=store.verifiedManifest;assert.equal(expected.revision,'0');
  armed=true;
  assert.throws(()=>api==='verifiedManifest'?store.verifiedManifest:store.assertVerifiedBaseline(expected),{code:'verified-base-required'});
  assert.equal(invalidations,1);assert.equal(store.verifiedManifest,null);
 }finally{armed=false;await close(h);}
});


test('initializer lost reply reconciles successfully when exact-ID reads remain available',async()=>{
 const http=new HttpFullSnapshotDrive(),store=make(http),h={http,store};
 const original=http.respond.bind(http);let lost=false;
 http.respond=async(target,options,category,id,row)=>{
  const response=await original(target,options,category,id,row);
  if(!lost&&category==='create'&&row.kind===MANIFEST_KIND){lost=true;throw new Error('Invented lost initializer reply');}
  return response;
 };
 try{
  assert.equal(await store.start({initialize:true}),null);
  assert.equal(lost,true);assert.equal(store.recoveryRequired,false);
  assert.equal([...http.files.values()].filter(f=>f.metadata.appProperties?.financeTrackerKind===MANIFEST_KIND).length,1);
  assert.equal(store.verifiedManifest.revision,'0');assert.equal(store.verifiedManifest.pending,null);
  assert.equal(await store.open(),null);
 }finally{http.respond=original;await close(h);}
});

test('selected folder is immutable and adapter destination mismatch refuses proof and save',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),expected=h.store.verifiedManifest,folder=h.store.folderId;
  assert.throws(()=>{h.store.folderId='invented-other-folder';},TypeError);
  assert.equal(h.store.folderId,folder);
  h.store.adapter.folderId='invented-other-folder';
  const start=h.http.requests.length;
  assert.throws(()=>h.store.verifiedManifest);
  assert.throws(()=>h.store.assertVerifiedBaseline(expected));
  await assert.rejects(h.store.save(correction(ledger,'wrong-folder')));
  assert.equal(financialWrites(h.http,start).length,0);
 }finally{h.store.adapter.folderId=h.http.folderId;await close(h);}
});

for(const fault of ['wrong-name','wrong-parent','wrong-id','wrong-size','wrong-media'])
test('new immutable exact-GET receipt rejects '+fault+' before publication',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),original=h.http.respond.bind(h.http);let target=null,injected=false;
  h.http.respond=async(url,options,category,id,row)=>{
   const response=await original(url,options,category,id,row);
   if(category==='create'&&row.kind==='snapshot-object')target=row.fileId;
   if(!injected&&target===id&&category===(fault==='wrong-media'?'media':'metadata')){
    injected=true;
    if(fault==='wrong-media'){
     const body=new Uint8Array(await response.arrayBuffer());body[0]^=1;
     return new Response(body,{status:200,headers:{'Content-Length':String(body.length)}});
    }
    const metadata=await response.json();
    if(fault==='wrong-name')metadata.name='invented-wrong-name';
    if(fault==='wrong-parent')metadata.parents=['invented-other-folder'];
    if(fault==='wrong-id')metadata.id='invented-wrong-id';
    if(fault==='wrong-size')metadata.size=String(Number(metadata.size)+1);
    const body=JSON.stringify(metadata);
    return new Response(body,{status:200,headers:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))}});
   }
   return response;
  };
  const start=h.http.requests.length;
  await assert.rejects(h.store.save(correction(ledger,fault)));
  assert.equal(injected,true);assert.equal(manifestPatches(h.http,start).length,0);
  h.http.respond=original;
 }finally{await close(h);}
});

for(const fault of ['metadata','body'])
test('new '+fault+' changes after create GET refuse publication',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),original=h.http.respond.bind(h.http);let target=null,changed=false;
  h.http.respond=async(url,options,category,id,row)=>{
   const response=await original(url,options,category,id,row);
   if(category==='create'&&row.kind==='snapshot-object')target=row.fileId;
   if(!changed&&target===id&&category==='media'){
    changed=true;const file=h.http.files.get(id);
    if(fault==='body')corrupt(file);else{file.metadata.name='invented-renamed-object';bump(file);}
   }
   return response;
  };
  const start=h.http.requests.length;await assert.rejects(h.store.save(correction(ledger,fault)));
  assert.equal(changed,true);assert.equal(manifestPatches(h.http,start).length,0);
  h.http.respond=original;
 }finally{await close(h);}
});

test('new snapshot corruption immediately after publication requires recovery and cannot finalize',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),original=h.http.respond.bind(h.http);let changed=false;
  h.http.respond=async(url,options,category,id,row)=>{
   const response=await original(url,options,category,id,row);
   if(!changed&&category==='update'&&id===h.store.manifestFileId){
    changed=true;corrupt(h.http.files.get(selected(h).envelope.snapshot.fileId));
   }
   return response;
  };
  const start=h.http.requests.length;await assert.rejects(h.store.save(correction(ledger,'post-publish')));
  assert.equal(changed,true);assert.equal(manifestPatches(h.http,start).length,1);
  assert.equal(h.store.recoveryRequired,true);assert.equal(selected(h).manifest.pending.state,'published');
  h.http.respond=original;const recoveryStart=h.http.requests.length;
  await assert.rejects(h.store.recover());assert.equal(h.store.recoveryRequired,true);
  assert.equal(financialWrites(h.http,recoveryStart).length,0);
 }finally{await close(h);}
});

for(const transactionId of ['', 'X'.repeat(257)])
test('generated '+(transactionId.length?'oversized':'empty')+' transaction identity cannot publish invalid envelope',async()=>{
 const h=await setup();
 try{
  const ledger=await seed(h),before=structuredClone(selected(h).manifest),start=h.http.requests.length;
  // Only storage's generated envelope identity is injected; the native
  // provider adapter and its captured crypto dependency remain untouched.
  h.store.crypto={subtle:webcrypto.subtle,randomUUID:()=>transactionId};
  await assert.rejects(h.store.save(correction(ledger,'invalid-transaction')),error=>
   error.code==='invalid-identity'||(error.code==='write-unresolved'&&Boolean(error.cause)));
  assert.equal(manifestPatches(h.http,start).length,0);
  assert.deepEqual(selected(h).manifest,before);
 }finally{await close(h);}
});
