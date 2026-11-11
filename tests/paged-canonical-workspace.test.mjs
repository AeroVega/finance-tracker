import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {verifyPartitionedCanonicalCommit,readVerifiedPartitionedLedger,canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {EMPTY_CANONICAL_BYTES,emptyCanonicalRootHash,PAGED_CANONICAL_VERIFIER} from '../js/paged-canonical-format.mjs';
import {assertCanonicalLedgerTransition} from '../js/canonical-history.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {fixture as retryFixture,lifecycleFixture,options as retryOptions} from './helpers/canonical-retry-fixture.mjs';
import {getEffectiveActivities,applyFinancialEvent,prepareCanonicalImport} from '../js/canonical-import.mjs';

async function fixture() {
  const initial=await emptyCanonicalRootHash(),objects=new Map([[initial,EMPTY_CANONICAL_BYTES.slice()]]),commits=[];
  let manifest={format:'finance-tracker-physical-root-manifest',version:4,syntheticOnly:true,revision:'0',root:initial,pending:null,databaseId:'invented-db',copyId:'invented-copy',role:'primary'};
  const lifecycle={pagedCanonical:true,state:'ready',acceptingWrites:true,folderId:'invented-folder',
    readManifest:async()=>structuredClone(manifest),
    assertCurrentManifest:async expected=>assert.deepEqual(expected,manifest),
    readPartitionedSnapshot:async()=>({manifest:structuredClone(manifest),rootHash:manifest.root,semanticVersion:PAGED_CANONICAL_VERIFIER,
      store:{read:async hash=>{assert.ok(objects.has(hash));return objects.get(hash).slice();}}}),
    async savePartitionedRoot({expectedBase,rootHash,objects:descriptors,preparationStore,semanticVersion,prepare}) {
      assert.deepEqual(expectedBase,manifest);assert.equal(semanticVersion,PAGED_CANONICAL_VERIFIER);
      if(prepare)({rootHash,objects:descriptors,preparationStore}=await prepare({rootHash:manifest.root,semanticVersion,store:{read:async hash=>{assert.ok(objects.has(hash));return objects.get(hash).slice();}}}));
      for(const d of descriptors)objects.set(d.sha256,await preparationStore.read(d.sha256));
      const commit={root:rootHash,previousRoot:manifest.root,revision:String(BigInt(manifest.revision)+1n),semanticVersion,operation:'synthetic-canonical-import',changeEvidenceRoot:null};
      const next={...manifest,root:rootHash,revision:commit.revision};
      await verifyPartitionedCanonicalCommit({manifest:next,commit,readObject:async q=>objects.get(q.sha256)});
      manifest=next;commits.push(commit);
    }};
  return {lifecycle,objects,commits,ledger:replayFixture(2).ledger};
}

test('actual canonical store dispatches paged lifecycle, saves true v5, and workspace corrects/reopens exact source',async()=>{
  const h=await fixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  assert.equal(store.layout,'partitions-v5');assert.equal(await store.load(),null);
  await store.save(h.ledger);
  const root=JSON.parse(new TextDecoder().decode(h.objects.get(store.base.root)));
  assert.equal(root.version,5);assert.equal(root.format,'finance-tracker-partitioned-canonical');
  const session=new CanonicalWorkspaceSession({storage:{lifecycle:h.lifecycle}});
  await session.loadVerified();const before=structuredClone(session.ledger);
  session.correct({activityId:session.ledger.activities[0].activityId,type:'posting-status-correction',lifecycleStatus:'pending',postedDate:null,rationale:'Invented pending evidence'});
  assert.equal(h.commits.length,1);assert.equal(session.dirty,true);
  await session.save();assert.equal(h.commits.length,2);await session.reopen();
  assert.deepEqual(session.ledger.activities,before.activities);assert.deepEqual(session.ledger.observations,before.observations);
  assert.deepEqual(session.ledger.events.slice(0,before.events.length),before.events);
  assert.equal(getEffectiveActivities(session.ledger)[0].lifecycleStatus,'pending');
  assert.equal(session.dirty,false);assert.equal(session.store.reader.verification().derived,'semantic-verified');
});

test('paged writer snapshots input before asynchronous preparation and refuses history rewrite',async()=>{
  const h=await fixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});await store.load();await store.save(h.ledger);
  const proposal=applyFinancialEvent(h.ledger,{activityId:h.ledger.activities[0].activityId,type:'bank-correction',amountText:'-100',commandId:'invented-correct',evidence:{rationale:'Invented correction'}});
  const expected=structuredClone(proposal),operation=store.save(proposal);proposal.activities[0].sourceDescription='caller mutation';await operation;
  assert.deepEqual(await store.load(),expected);
  const rewrite=structuredClone(expected);rewrite.activities[0].sourceDescription='forged history';
  await assert.rejects(store.save(rewrite),{code:'history-rewrite-refused'});
});

test('retained canonical edge rejects independently valid historical metadata substitution',async()=>{
  const h=await fixture(),before=h.ledger,after=structuredClone(before);after.createdAt='2025-01-02T00:00:00Z';
  assert.throws(()=>assertCanonicalLedgerTransition(before,after),{code:'ledger-metadata-rewrite-refused'});
});

test('corrupted canonical bytes prevent reopening and remove writable baseline',async()=>{
  const h=await fixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});await store.load();await store.save(h.ledger);
  const root=store.base.root;h.objects.get(root)[0]^=1;
  await assert.rejects(store.load());assert.equal(store.base,null);await assert.rejects(store.save(h.ledger),{code:'verified-base-required'});
});

test('empty canonical sentinel is not an invented empty financial ledger',async()=>{
  const h=await fixture(),snapshot=await h.lifecycle.readPartitionedSnapshot();
  assert.deepEqual(await readVerifiedPartitionedLedger(snapshot.store,snapshot.rootHash),{ledger:null,reader:null});
});

test('semantic audit admitted by an expired scope cannot populate or close its successor',async()=>{
  const root=await emptyCanonicalRootHash(),plans=canonicalPartitionVerificationPlans(),verify=plans.get(PAGED_CANONICAL_VERIFIER);
  const input={manifest:{root},commit:{root,previousRoot:null,revision:'0',semanticVersion:PAGED_CANONICAL_VERIFIER,operation:'genesis',changeEvidenceRoot:null}};
  let finish;const first=plans.beginVerification();
  const pending=verify({...input,readObject:()=>new Promise(resolve=>{finish=resolve;})});
  plans.endVerification(first);const second=plans.beginVerification();
  finish(EMPTY_CANONICAL_BYTES.slice());await pending;
  await assert.rejects(verify({...input,readObject:async()=>{throw new Error('missing bytes');}}),/missing bytes/);
  const third=plans.beginVerification();
  let reads=0;
  const readObject=async()=>{reads++;return EMPTY_CANONICAL_BYTES.slice();};
  await verify({...input,readObject});assert.equal(reads,1);
  plans.endVerification(first);plans.endVerification(second);await verify({...input,readObject});assert.equal(reads,1);
  plans.endVerification(third);await verify({...input,readObject});assert.equal(reads,2);
});

test('both roots of an in-flight edge retain the original semantic scope owner',async()=>{
  const h=await fixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});await store.load();await store.save(h.ledger);
  const empty=await emptyCanonicalRootHash(),root=store.base.root,plans=canonicalPartitionVerificationPlans(),verify=plans.get(PAGED_CANONICAL_VERIFIER);
  let release;const held=new Promise(resolve=>{release=resolve;});let first=true;
  const a=plans.beginVerification();
  const pending=verify({manifest:{root},commit:{root,previousRoot:empty,revision:'1',semanticVersion:PAGED_CANONICAL_VERIFIER,operation:'synthetic-canonical-import',changeEvidenceRoot:null},readObject:async q=>{if(first){first=false;await held;}return h.objects.get(q.sha256);}});
  plans.endVerification(a);const b=plans.beginVerification();release();await pending;
  let reads=0;
  await assert.rejects(verify({manifest:{root:empty},commit:{root:empty,previousRoot:null,revision:'0',semanticVersion:PAGED_CANONICAL_VERIFIER,operation:'genesis',changeEvidenceRoot:null},readObject:async()=>{reads++;throw new Error('new scope missing');}}),/new scope missing/);
  assert.equal(reads,1);plans.endVerification(b);
});

test('exact edge memo snapshots commit fields before asynchronous audit',async()=>{
  const root=await emptyCanonicalRootHash(),plans=canonicalPartitionVerificationPlans(),verify=plans.get(PAGED_CANONICAL_VERIFIER);
  const commit={root,previousRoot:null,revision:'0',semanticVersion:PAGED_CANONICAL_VERIFIER,operation:'unsupported-operation',changeEvidenceRoot:null};
  let release;const held=new Promise(resolve=>{release=resolve;});const scope=plans.beginVerification();
  const pending=verify({manifest:{root},commit,readObject:async()=>{await held;return EMPTY_CANONICAL_BYTES.slice();}});
  commit.operation='genesis';release();await assert.rejects(pending,{code:'canonical-genesis-mismatch'});
  const next=plans.beginVerification();commit.operation='unsupported-operation';
  await assert.rejects(verify({manifest:{root},commit,readObject:async()=>{throw new Error('still cold');}}),/still cold/);
  plans.endVerification(scope);plans.endVerification(next);
});


test('v5 retained edges preserve exact optional source fields and unknown extra evidence',async()=>{
  const h=await fixture();
  for(const edit of [ledger=>{ledger.observations[0].extraEvidence=null;},ledger=>{delete ledger.observations[0].physicalLine;},ledger=>{ledger.imports[0].sourceIgnoredCount=99;}]){
    const proposed=structuredClone(h.ledger);edit(proposed);
    assert.throws(()=>assertCanonicalLedgerTransition(h.ledger,proposed),e=>['source-evidence-rewrite-refused','import-evidence-rewrite-refused'].includes(e.code));
  }
});

test('actual v5 saves retries and reimports without overriding manual posting correction',async()=>{
  for(const scenario of ['retry','posting']) {
    const h=await fixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});await store.load();
    const f=scenario==='retry'?retryFixture(2):lifecycleFixture(2);let ledger=f.ledger;
    if(scenario==='posting'){ledger=prepareCanonicalImport(ledger,f.input,retryOptions(500)).ledger;f.input.parsed.fileFingerprint='invented-posted-overlap';}
    await store.save(ledger);
    if(scenario==='posting'){ledger=applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'posting-status-correction',lifecycleStatus:'pending',postedDate:null,commandId:'invented-posting',evidence:{rationale:'Invented manual pending correction'}},retryOptions(1000));await store.save(ledger);}
    const before=structuredClone(ledger);ledger=prepareCanonicalImport(ledger,f.input,retryOptions(2000)).ledger;
    await store.save(ledger);assert.deepEqual(await store.load(),ledger);
    assert.deepEqual(ledger.activities.slice(0,before.activities.length),before.activities);
    assert.deepEqual(ledger.events.slice(0,before.events.length),before.events);
    if(scenario==='posting')assert.equal(getEffectiveActivities(ledger)[0].lifecycleStatus,'pending');
    else assert.equal(ledger.imports.at(-1).retryAttempts.length,before.imports.at(-1).retryAttempts.length+1);
  }
});


test('workspace local preview creates a genuine v5 copy through explicit new-copy controller',async()=>{
  const h=await fixture(),calls=[];
  const storage={lifecycle:null,async connect(options){calls.push(options);this.lifecycle=h.lifecycle;}};
  const session=new CanonicalWorkspaceSession({storage});session.preview(h.ledger);await session.savePreviewToNewCopy();
  assert.deepEqual(calls,[{requireEmpty:true,canonicalLayout:'partitions-v5'}]);assert.equal(session.store.layout,'partitions-v5');
  const root=JSON.parse(new TextDecoder().decode(h.objects.get(session.store.base.root)));assert.equal(root.version,5);assert.equal(root.valueCodec,'compact-json-v1');
  assert.deepEqual(session.ledger,h.ledger);assert.equal(session.mode,'saved');assert.equal(session.dirty,false);await session.reopen();
});

test('empty sentinel audits do not evict either materialized ledger or hide missing empty-copy bytes',async()=>{
  const h=await fixture(),store=new CanonicalLedgerStore({lifecycle:h.lifecycle});await store.load();await store.save(h.ledger);
  const first=h.commits[0],firstRoot=store.base.root;
  const proposal=applyFinancialEvent(h.ledger,{activityId:h.ledger.activities[0].activityId,type:'bank-correction',amountText:'-100',
    commandId:'invented-slot-correction',evidence:{rationale:'Invented sentinel slot regression'}});
  await store.save(proposal);const second=h.commits[1],empty=await emptyCanonicalRootHash();
  const plans=canonicalPartitionVerificationPlans(),verify=plans.get(PAGED_CANONICAL_VERIFIER),reads=new Map();
  const readObject=async q=>{reads.set(q.sha256,(reads.get(q.sha256)??0)+1);return h.objects.get(q.sha256).slice();};
  const scope=plans.beginVerification();
  await verify({manifest:{root:first.root},commit:first,readObject});
  const firstReads=reads.get(firstRoot);assert.ok(firstReads>0);
  await verify({manifest:{root:second.root},commit:second,readObject});
  assert.equal(reads.get(firstRoot),firstReads,'the old materialized ledger survives the intervening genesis sentinel');
  plans.endVerification(scope);
  assert.deepEqual((await readVerifiedPartitionedLedger({read:async hash=>h.objects.get(hash).slice()},second.root)).ledger,proposal);
  const next=plans.beginVerification();await verify({manifest:{root:first.root},commit:first,readObject});
  const genesis={root:empty,previousRoot:null,revision:'0',semanticVersion:PAGED_CANONICAL_VERIFIER,operation:'genesis',changeEvidenceRoot:null};
  await assert.rejects(verify({manifest:{root:empty},commit:genesis,readObject:async()=>{throw new Error('missing sentinel bytes');}}),/missing sentinel bytes/);
  plans.endVerification(next);
});
