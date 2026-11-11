import test from 'node:test';
import assert from 'node:assert/strict';
import {LocatorBatchAdapter,ordered,collect,enumerateCatalog,assertUnion,assertFinalWrites,hash} from './helpers/paged-locator-batch-fixture.mjs';

const limits={maxEntries:8,maxChildren:4,maxNodeBytes:4096};
function entries(adapter,count,start=0,options={}) {return ordered(Array.from({length:count},(_,i)=>adapter.object(start+i,options)));}

for(const count of [0,1,8,33,129])test(`coalesced batch preserves the exact union and only creates its final closure: ${count} existing`,async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,count),root=await tree.build(values);
  const additions=entries(adapter,19,1000),input=[...additions.slice().reverse(),...values.slice(0,4),...additions.slice(0,5)];adapter.reset();
  const next=await tree.setMany(root,(async function*(){for(const value of input)yield value;})());
  const expected=ordered([...values,...additions]),state=assertUnion(adapter,next,expected);assertFinalWrites(adapter,next);
  assert.equal(state.root.generation,'1');assert.deepEqual(state.root.previous,root);assert.equal(state.root.version,3);
  assert.deepEqual(await collect(tree.entries(next)),expected);assert.equal((await tree.verify(next)).entryCount,String(expected.length));
  assertUnion(adapter,root,values);
  adapter.reset();assert.deepEqual(await tree.setMany(next,[...expected,...expected]),next);assert.equal(adapter.allocations.length,0);
  assert.ok(adapter.reads>expected.length,'an identical batch still performs full physical verification');
});

test('batch preserves typed identities and every journal metadata field across generations',async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits);
  const original=adapter.object(1,{kind:'commit-record',identity:'shared-identity'}),root=await tree.build([original]);
  const additions=[adapter.object(2,{kind:'journal-event',identity:'shared-identity',transactionId:'invented-journal-transaction',sequence:Number.MAX_SAFE_INTEGER}),
    adapter.object(3,{kind:'migration-record',identity:'shared-identity'}),adapter.object(4,{kind:'protocol-object',identity:'shared-identity'})];
  const next=await tree.setMany(root,additions),last=adapter.object(5);adapter.reset();const final=await tree.setMany(next,[last,original]);
  const state=assertUnion(adapter,final,[original,...additions,last]);assert.equal(state.root.generation,'2');assert.deepEqual(state.root.previous,next);assertFinalWrites(adapter,final);
  for(const e of additions)assert.deepEqual(await tree.get(final,{kind:e.kind,sha256:e.sha256}),e);
});

test('the same content hash remains a distinct typed key in different object kinds',async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),old=adapter.object(1,{kind:'commit-record',fileId:'invented-commit'}),root=await tree.build([old]);
  const addition=adapter.object(1,{kind:'migration-record',fileId:'invented-migration'});assert.equal(old.sha256,addition.sha256);adapter.reset();
  const next=await tree.setMany(root,[addition,old]);assertUnion(adapter,next,[old,addition]);assertFinalWrites(adapter,next);
});

for(const which of ['batch identity','existing identity','batch file','existing file','existing primary','duplicate primary','invalid entry','invalid journal','oversized identity','oversized body','missing body','changed body','wrong journal binding'])test(`batch preflight refuses ${which} without creating pages`,async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),old=adapter.object(1,{kind:'commit-record'}),root=await tree.build([old]);
  const a=adapter.object(2,{kind:'commit-record'}),b=adapter.object(3,{kind:'commit-record'});let input=[a,b],code;
  if(which==='batch identity'){b.identity=a.identity;code='replacement-forbidden';}
  if(which==='existing identity'){b.identity=old.identity;code='replacement-forbidden';}
  if(which==='batch file'){b.fileId=a.fileId;code='duplicate-physical-locator';}
  if(which==='existing file'){b.fileId=old.fileId;code='duplicate-physical-locator';}
  if(which==='existing primary'){input=[a,{...old,identity:'different'}];code='replacement-forbidden';}
  if(which==='duplicate primary'){input=[a,{...a,identity:'different'}];code='replacement-forbidden';}
  if(which==='invalid entry'){input=[a,{...b,trusted:true}];code='invalid-shape';}
  if(which==='invalid journal'){input=[a,{...adapter.object(4,{kind:'journal-event'}),sequence:'4'}];code='invalid-journal';}
  if(which==='oversized identity'){input=[a,{...b,identity:'x'.repeat(255)}];code='invalid-identity';}
  if(which==='oversized body'){const ref=adapter.save('invented-oversized-body',new Uint8Array(65537),'data-object');input=[a,{kind:'data-object',identity:ref.sha256,...ref}];code='byte-limit';}
  if(which==='missing body'){adapter.files.delete(b.fileId);code='object-not-found';}
  if(which==='changed body'){adapter.files.get(b.fileId).bytes.fill(0);code='hash-mismatch';}
  if(which==='wrong journal binding'){input=[a,{...adapter.object(4,{kind:'journal-event'}),transactionId:'wrong-transaction'}];code='metadata-mismatch';}
  adapter.reset();await assert.rejects(tree.setMany(root,input),{code});assert.equal(adapter.allocations.length,0);assert.equal(adapter.created.length,0);assertUnion(adapter,root,[old]);
});

test('batch never treats matching hashes as permission to skip the full physical audit',async()=>{
  for(const changed of ['body','page','metadata','secondary']) {
    const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,16),root=await tree.build(values),addition=adapter.object(1000);
    const state=enumerateCatalog(adapter,root);adapter.reset();
    const input=(async function*(){yield addition;
      if(changed==='body')adapter.files.get(values[0].fileId).bytes.fill(0);
      if(changed==='page')adapter.files.get(state.root.objects.fileId).bytes.fill(0);
      if(changed==='metadata')adapter.files.get(values[0].fileId).metadata.trashed=true;
      if(changed==='secondary')adapter.files.delete(state.root.files.fileId);
    })();
    await assert.rejects(tree.setMany(root,input));assert.equal(adapter.created.length,0);assert.equal(adapter.allocations.length,0);
  }
});

test('cancelled or failed input closes before any physical writes and owns descriptor snapshots',async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,8),root=await tree.build(values),addition=adapter.object(100);
  let closed=false;const controller=new AbortController();adapter.reset();
  await assert.rejects(tree.setMany(root,(async function*(){try{yield addition;controller.abort();yield addition;}finally{closed=true;}})(),{signal:controller.signal}),{name:'AbortError'});
  assert.equal(closed,true);assert.equal(adapter.created.length,0);
  await assert.rejects(tree.setMany(root,null),{code:'invalid-input'});
  await assert.rejects(tree.setMany(root,(async function*(){yield addition;throw new Error('invented iterator failure');})()),/invented iterator failure/);
  assert.equal(adapter.created.length,0);
  const expected={...addition};const next=await tree.setMany(root,(async function*(){yield addition;addition.fileId='mutated-input';})());assertUnion(adapter,next,[...values,expected]);
});

test('high fanout and byte-limited batches preserve count, branch arity and page budgets',async()=>{
  for(const options of [{maxEntries:128,maxChildren:128,maxNodeBytes:65536},{maxEntries:128,maxChildren:128,maxNodeBytes:4096},{maxEntries:2,maxChildren:3,maxNodeBytes:4096}]) {
    const adapter=new LocatorBatchAdapter({databaseId:'d'.repeat(254),copyId:'c'.repeat(254)}),tree=adapter.tree(options);
    const make=i=>adapter.object(i,{kind:'journal-event',identity:'identity-'+String(i).padStart(4,'0')+'i'.repeat(230),fileId:'body-'+String(i).padStart(4,'0')+'f'.repeat(240),transactionId:'t'.repeat(254),sequence:i});
    const values=ordered(Array.from({length:260},(_,i)=>make(i*2))),root=await tree.build(values),additions=Array.from({length:35},(_,i)=>make(i*2+1));adapter.reset();
    const next=await tree.setMany(root,additions),state=assertUnion(adapter,next,[...values,...additions]);assertFinalWrites(adapter,next);
    for(const id of state.pages) {
      const file=adapter.files.get(id),node=JSON.parse(new TextDecoder().decode(file.bytes));
      assert.ok(file.bytes.length<=(id===next.fileId?16384:options.maxNodeBytes));
      if(node.nodeType==='leaf')assert.ok(node.entries.length>=1 && node.entries.length<=options.maxEntries);
      if(node.nodeType==='branch')assert.ok(node.children.length>=2 && node.children.length<=options.maxChildren);
    }
    assert.equal((await tree.verify(next)).entryCount,'295');
  }
});

test('localized batches reuse old subtrees as the catalog grows, with no superseded paths',async t=>{
  const report=[];
  for(const count of [32,128,512]) {
    const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),pool=entries(adapter,528);
    // File IDs have the same order as content hashes for this measurement, so
    // the fixed four additions overlap one path in all three independent indexes.
    for(let i=0;i<pool.length;i++){const e=pool[i],file=adapter.files.get(e.fileId);e.fileId='ranked-body-'+String(i).padStart(6,'0');adapter.save(e.fileId,file.bytes,e.kind);}
    const values=[...pool.slice(0,count/2),...pool.slice(-count/2)],additions=pool.slice(262,266),root=await tree.build(values),old=enumerateCatalog(adapter,root);adapter.reset();
    const next=await tree.setMany(root,additions),counts=assertFinalWrites(adapter,next),state=assertUnion(adapter,next,[...values,...additions]);
    const reused=[...state.pages].filter(id=>old.pages.has(id)).length;assert.ok(reused>0);
    const heights=['objects','identities','files'].map(index=>Number(old.root[index].height));
    assert.ok(counts.generated<=1+heights.reduce((sum,height)=>sum+2*(height+1)+1,0));
    const readCount=adapter.reads;adapter.reset();await tree.build(ordered([...values,...additions]));const rebuild=adapter.created.length;assert.ok(counts.durableCreated<rebuild);
    report.push({existing:count,additions:additions.length,heights,...counts,reused,wholeCatalogRebuild:rebuild,physicalReadsIncludingFullAudit:readCount});
  }
  t.diagnostic(JSON.stringify(report));
});

test('many overlapping updates share one rewritten ancestor instead of sequential paths',async t=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree({maxEntries:128,maxChildren:128}),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,20,1000);adapter.reset();
  const next=await tree.setMany(root,additions);assertUnion(adapter,next,[...values,...additions]);const counts=assertFinalWrites(adapter,next);
  assert.equal(counts.generated,4,'one leaf per index plus one catalog, not 20 intermediate catalogs and paths');
  adapter.reset();let sequential=root;for(const e of additions)sequential=await tree.set(sequential,e);
  assertUnion(adapter,sequential,[...values,...additions]);assert.equal(adapter.created.length,80);
  t.diagnostic(JSON.stringify({existing:values.length,additions:additions.length,coalesced:counts,sequentialCreates:adapter.created.length}));
});

test('interruption at every batch write preserves the prior root and exact unresolved physical ID',async()=>{
  async function setup() {const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,4,1000);adapter.reset();return {adapter,tree,values,root,additions};}
  const baseline=await setup(),complete=await baseline.tree.setMany(baseline.root,baseline.additions),writes=baseline.adapter.created.length;assertFinalWrites(baseline.adapter,complete);
  for(const phase of ['before','after'])for(let cut=1;cut<=writes;cut++) {
    const {adapter,tree,values,root,additions}=await setup(),create=adapter.createImmutable.bind(adapter),controller=new AbortController();let attempts=0,uncertain;
    adapter.createImmutable=async args=>{if(++attempts===cut && phase==='before'){await args.beforeMutation();throw new Error('invented interrupted create');}await create(args);if(attempts===cut && phase==='after')controller.abort();};
    await assert.rejects(adapter.tree(limits).setMany(root,additions,{signal:controller.signal}),error=>{assert.equal(error.code,'write-unresolved');uncertain=error.details;assert.ok(uncertain.fileId && uncertain.sha256);return true;});
    assert.equal(attempts,cut);assert.equal(adapter.allocations.length,writes,'all final IDs were planned before any create');
    if(phase==='after')assert.equal(hash(adapter.files.get(uncertain.fileId).bytes),uncertain.sha256);
    else assert.equal(adapter.files.has(uncertain.fileId),false);
    assertUnion(adapter,root,values);assert.equal((await tree.verify(root)).entryCount,String(values.length));
  }
});

test('lost create results resolve by exact readback without retrying or leaking intermediate pages',async()=>{
  for(const lost of [new Error('invented lost response'),undefined,false]) {
    const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,4,1000),create=adapter.createImmutable.bind(adapter);
    adapter.createImmutable=async args=>{await create(args);throw lost;};adapter.reset();
    const next=await adapter.tree(limits).setMany(root,additions);assertUnion(adapter,next,[...values,...additions]);assertFinalWrites(adapter,next);
    assert.equal(adapter.guards,adapter.created.length);
  }
});

test('ownership loss blocks the next batch page without publishing a catalog',async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,4,1000),create=adapter.createImmutable.bind(adapter);
  adapter.createImmutable=async args=>{await create(args);adapter.writable=false;};adapter.reset();
  await assert.rejects(adapter.tree(limits).setMany(root,additions),{code:'guard-scope'});assert.equal(adapter.created.length,1);
  assert.ok(adapter.attempts.every(item=>item.kind==='locator-catalog-page'));assertUnion(adapter,root,values);
});

for(const failure of ['invalid late ID','duplicate late ID','retained late ID','cancelled allocation','failed allocation'])test(`private planning ${failure} creates no durable pages`,async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,4,1000);
  const allocate=adapter.allocateFileId.bind(adapter),controller=new AbortController();let calls=0,first;
  adapter.allocateFileId=async args=>{
    const id=await allocate(args);first??=id;
    if(++calls!==3)return id;
    if(failure==='invalid late ID')return 'x'.repeat(255);
    if(failure==='duplicate late ID')return first;
    if(failure==='retained late ID')return root.fileId;
    if(failure==='cancelled allocation'){controller.abort();return id;}
    throw new Error('invented allocation failure');
  };
  adapter.reset();
  await assert.rejects(adapter.tree(limits).setMany(root,additions,{signal:controller.signal}));
  assert.equal(adapter.created.length,0);assert.equal(adapter.attempts.length,0);assert.equal(adapter.guards,0);assertUnion(adapter,root,values);
});

// Deliberately corrupt the private producer at its verifier boundary. This
// checks the separate verification gate without adding a production test hook.
async function faultyPlanner(injection) {
  const {readFile}=await import('node:fs/promises');
  let source=await readFile(new URL('../js/paged-physical-locators.mjs',import.meta.url),'utf8');
  const gate='    const writes=await verifyPlannedCatalog(plan,candidate,signal);';assert.equal(source.split(gate).length,2);
  source=source.replace(gate,injection+'\n'+gate).replace(/from '(\.\/[^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL('../js/'+path.slice(2),import.meta.url).href));
  return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).createPagedPhysicalLocators;
}
for(const [name,injection] of [
  ['unreachable prepared page',`const record=plan.records.values().next().value,fileId=identifier(await allocate({signal}));plan.records.set(fileId,{...record,fileId});`],
  ['altered prepared bytes',`candidate.bytes[0]=0;`],
  ['changed entry with valid hashes',`const record=plan.records.get(root.objects.fileId),node=JSON.parse(decoder.decode(record.bytes));
    node.entries[0][1].identity='invented-rebound';record.bytes=encode(node,maxNodeBytes);record.sha256=await digest(record.bytes);
    root.objects.sha256=record.sha256;candidate.bytes=encode(root,PAGED_LOCATOR_ROOT_BYTES);candidate.sha256=await digest(candidate.bytes);`],
  ['omitted expected key',`plan.entries.objects.set('commit-record:'+('0'.repeat(64)),{kind:'commit-record',identity:'invented-missing',fileId:'invented-missing',sha256:'0'.repeat(64)});`]
])test(`independent planned closure gate rejects ${name} before the first create`,async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),root=await tree.build([]),addition=adapter.object(1,{kind:'commit-record'}),factory=await faultyPlanner(injection);
  const damaged=factory(adapter,{databaseId:adapter.databaseId,copyId:adapter.copyId,folderId:adapter.folderId,...limits,assertWritable:async()=>{adapter.guards++;}});adapter.reset();
  await assert.rejects(damaged.setMany(root,[addition]),{code:'invalid-plan'});
  assert.equal(adapter.created.length,0);assert.equal(adapter.attempts.length,0);assert.equal(adapter.guards,0);assertUnion(adapter,root,[]);
});

test('independent planned closure gate rejects a changed retained frontier before creates',async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,32),root=await tree.build(values),addition=adapter.object(1000);
  const factory=await faultyPlanner(`plan.reused.objects.clear();`),damaged=factory(adapter,{databaseId:adapter.databaseId,copyId:adapter.copyId,folderId:adapter.folderId,...limits,assertWritable:async()=>{adapter.guards++;}});adapter.reset();
  await assert.rejects(damaged.setMany(root,[addition]),{code:'invalid-plan'});assert.equal(adapter.created.length,0);assert.equal(adapter.attempts.length,0);assert.equal(adapter.guards,0);assertUnion(adapter,root,values);
});

for(const collision of ['retained body','nested retained page','previous catalog','previous-only page','unrelated physical file'])test(`pre-create identity gate rejects ${collision} collisions with zero writes`,async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,128),first=await tree.build(values);
  const retained=adapter.object(900),root=await tree.setMany(first,[retained]),additions=entries(adapter,4,1000);
  const before=enumerateCatalog(adapter,root),firstPages=enumerateCatalog(adapter,first).pages;
  let target;
  if(collision==='retained body')target=values[0].fileId;
  if(collision==='nested retained page') {
    const objects=adapter.json(before.root.objects);assert.equal(objects.nodeType,'branch');
    const branch=objects.children[0];assert.equal(adapter.json(branch).nodeType,'branch');target=adapter.json(branch).children[0].fileId;
  }
  if(collision==='previous catalog')target=first.fileId;
  if(collision==='previous-only page')target=[...firstPages].find(id=>id!==first.fileId && !before.pages.has(id));
  if(collision==='unrelated physical file')target=adapter.object(9999).fileId;
  assert.ok(target);const saved=new Map([...adapter.files].map(([id,file])=>[id,file.bytes.slice()]));
  const allocate=adapter.allocateFileId.bind(adapter);let count=0;adapter.allocateFileId=async args=>++count===3?target:allocate(args);adapter.reset();
  await assert.rejects(adapter.tree(limits).setMany(root,additions),{code:'invalid-plan'});
  assert.equal(adapter.created.length,0);assert.equal(adapter.attempts.length,0);assert.equal(adapter.guards,0);
  for(const [id,bytes] of saved)assert.deepEqual(adapter.files.get(id).bytes,bytes);assertUnion(adapter,root,[...values,retained]);
});

for(const problem of ['permission denied','transport failed','raw 404','cancelled','folder changed'])test(`pre-create identity gate fails closed on ${problem}`,async()=>{
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,4,1000);
  const readMetadata=adapter.readMetadata.bind(adapter),controller=new AbortController();
  adapter.readMetadata=async(id,options)=>{
    if(adapter.files.has(id))return readMetadata(id,options);
    if(problem==='cancelled')controller.abort();
    if(problem==='folder changed')adapter.folderId='invented-wrong-folder';
    if(problem==='permission denied')throw Object.assign(new Error('invented permission denied'),{code:'permission-denied',details:{status:403}});
    if(problem==='transport failed')throw new Error('invented offline');
    if(problem==='raw 404')throw Object.assign(new Error('unclassified missing result'),{details:{status:404}});
    return readMetadata(id,options);
  };
  adapter.reset();await assert.rejects(adapter.tree(limits).setMany(root,additions,{signal:controller.signal}));
  assert.equal(adapter.created.length,0);assert.equal(adapter.attempts.length,0);assert.equal(adapter.guards,0);assertUnion(adapter,root,values);
});

test('pre-create identity gate rejects a late absent result from an expired physical lifetime',async()=>{
  const {createPhysicalDriveAdapter}=await import('../js/physical-drive-adapter.mjs');
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree(limits),values=entries(adapter,12),root=await tree.build(values),additions=entries(adapter,4,1000);
  let finish,started;const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
  const raw={folderId:adapter.folderId,allocateFileId:adapter.allocateFileId.bind(adapter),createImmutable:adapter.createImmutable.bind(adapter),readBytes:adapter.readBytes.bind(adapter),
    readMetadataSnapshot:async()=>new Map([...adapter.files].map(([id,file])=>[id,structuredClone(file.metadata)])),
    readMetadata:async(id,options)=>{if(adapter.files.has(id))return adapter.readMetadata(id,options);started();await gate;throw Object.assign(new Error('invented absent ID'),{code:'drive-request-failed',details:{status:404}});}};
  const physical=createPhysicalDriveAdapter(raw,{manifestFileId:'unused',assertWritable:async()=>{}});await physical.beginVerification();
  const {createPagedPhysicalLocators}=await import('../js/paged-physical-locators.mjs');
  const guarded=createPagedPhysicalLocators(physical,{databaseId:adapter.databaseId,copyId:adapter.copyId,folderId:adapter.folderId,...limits,assertWritable:async()=>{adapter.guards++;}});adapter.reset();
  const pending=guarded.setMany(root,additions);await ready;physical.invalidateReadCache();finish();
  await assert.rejects(pending,{code:'verification-scope-closed'});assert.equal(adapter.attempts.length,0);assert.equal(adapter.guards,0);assertUnion(adapter,root,values);
});
