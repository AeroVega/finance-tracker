import test from 'node:test';
import assert from 'node:assert/strict';
import {updatePartitionedCanonicalLedger,createPartitionObjectIO,createPartitionValueCodec,partitionDigest} from '../js/canonical-partitions.mjs';
import {createCanonicalPartitionReader} from '../js/canonical-partition-reader.mjs';
import {readVerifiedPartitionedLedger,verifyPartitionedCanonicalCommit,canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';
import {applyFinancialEvents,applyFinancialEvent} from '../js/canonical-import.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

function memory() {
  const objects=new Map(),writes=[];
  return {objects,writes,
    read:async hash=>{const raw=objects.get(hash);if(!raw)throw new Error('missing-invented-object');return raw.slice();},
    write:async raw=>{const hash=await partitionDigest(raw);objects.set(hash,raw.slice());writes.push(hash);return hash;}};
}
async function fixture(count=12) {
  const {ledger,options}=replayFixture(count),store=memory(),built=await updatePartitionedCanonicalLedger(ledger,store);
  const io=createPartitionObjectIO(store),tree=createImmutablePageTree(store),codec=createPartitionValueCodec(store,{version:2});
  return {ledger,options,store,built,io,tree,codec,root:await io.read(built.rootHash),source:await io.read(built.sourceHash),derived:await io.read(built.derivedHash)};
}
async function entries(tree,root) {const result=[];for await(const entry of tree.entries(root))result.push(entry);return result;}
async function derivedRoot(f,derived,version=5) {
  const hash=await f.io.write(derived);
  return f.io.write({...f.root,version,derived:hash});
}

test('v5 freezes exact compact root/header shapes and uses a distinct verifier',async()=>{
  const f=await fixture();
  assert.deepEqual(Object.keys(f.root).sort(),['derived','format','source','syntheticOnly','valueCodec','version']);
  assert.equal(f.root.version,5);assert.equal(f.root.valueCodec,'compact-json-v1');assert.equal(f.source.version,2);assert.equal(f.derived.version,2);
  assert.deepEqual(Object.keys(f.derived).sort(),['effectiveActivities','format','monthActivities','source','summaries','version']);
  const plans=canonicalPartitionVerificationPlans();assert.equal(plans.has('canonical-partitions-v4'),false);assert.ok(plans.has('canonical-partitions-v5'));
  for(const bad of [{...f.root,version:6},{...f.root,valueCodec:'future'},{...f.root,relations:f.root.source},
    Object.fromEntries(Object.entries(f.root).filter(([key])=>key!=='valueCodec'))]) {
    await assert.rejects(createCanonicalPartitionReader(f.store,await f.io.write(bad)));
  }
  const input={manifest:{root:f.built.rootHash},commit:{root:f.built.rootHash,previousRoot:null,revision:'0',operation:'genesis',changeEvidenceRoot:null,semanticVersion:'canonical-partitions-v4'},readObject:q=>f.store.read(q.sha256)};
  await assert.rejects(verifyPartitionedCanonicalCommit(input),{code:'unsupported-canonical-profile'});
  await assert.rejects(plans.get('canonical-partitions-v5')(input),{code:'canonical-commit-mismatch'});
});

test('v5 accepts different valid derived topologies and rejects older root versions',async()=>{
  const f=await fixture(32),alternative=createImmutablePageTree(f.store,{maxEntries:2,maxChildren:2}),derived={...f.derived};
  for(const name of ['effectiveActivities','monthActivities','summaries']) {
    derived[name]=await alternative.build(await entries(f.tree,f.derived[name]));
  }
  assert.notEqual(derived.effectiveActivities,f.derived.effectiveActivities);
  for(const root of [f.built.rootHash,await derivedRoot(f,derived)]) {
    const result=await readVerifiedPartitionedLedger(f.store,root);assert.deepEqual(result.ledger,f.ledger);
  }
  for (const version of [1,2,3,4]) await assert.rejects(readVerifiedPartitionedLedger(f.store,await derivedRoot(f,derived,version)),/unsupported/);
});

for(const attack of ['wrong-summary','changed-effective','omitted-membership','extra-membership','missing-nested'])test(`v5 full logical oracle rejects rehashed ${attack}`,async()=>{
  const f=await fixture(),derived={...f.derived};
  const name=attack==='wrong-summary'?'summaries':attack.includes('membership')?'monthActivities':'effectiveActivities';
  const rows=await entries(f.tree,derived[name]);
  if(attack==='omitted-membership')rows.pop();
  else if(attack==='extra-membership')rows.push([rows.at(-1)[0]+'z',rows.at(-1)[1]]);
  else {
    const value=await f.codec.materialize(rows[0][1]);
    if(attack==='wrong-summary')value.spending='999999.99';
    else if(attack==='changed-effective')value.amountText='999999.99';
    else value.extraInventedEvidence='x'.repeat(10000);
    rows[0][1]=await f.codec.encode(value);
    if(attack==='missing-nested')f.store.objects.delete(rows[0][1].root);
  }
  derived[name]=await f.tree.build(rows);
  const root=await derivedRoot(f,derived);
  await assert.rejects(readVerifiedPartitionedLedger(f.store,root));
});

test('v5 batches a complete mixed edit once per tree, preserving unchanged roots and records',async()=>{
  const f=await fixture(132),beforeCollections=new Map(await entries(f.tree,f.source.collections));
  const expected=applyFinancialEvents(f.ledger,f.ledger.activities.slice(0,8).map((activity,i)=>({type:i%2?'posting-status-correction':'bank-correction',activityId:activity.activityId,
    ...(i%2?{lifecycleStatus:'pending',postedDate:null}:{amountText:'-123.45'}),commandId:'invented-v5-mixed-'+i,evidence:{rationale:'Invented mixed save'}})),f.options);
  f.store.writes.length=0;
  const built=await updatePartitionedCanonicalLedger(expected,f.store,{baseRootHash:f.built.rootHash,baseLedger:f.ledger}),source=await f.io.read(built.sourceHash),afterCollections=new Map(await entries(f.tree,source.collections));
  assert.deepEqual((await readVerifiedPartitionedLedger(f.store,built.rootHash)).ledger,expected);
  assert.deepEqual((await readVerifiedPartitionedLedger(f.store,f.built.rootHash)).ledger,f.ledger);
  for(const name of ['accounts','imports','observations','activities','reviewDecisions'])assert.deepEqual(afterCollections.get(name),beforeCollections.get(name),name);
  assert.notEqual(afterCollections.get('events').byId,beforeCollections.get('events').byId);
  assert.notEqual(afterCollections.get('events').order,beforeCollections.get('events').order);
  assert.deepEqual(source.metadata,f.source.metadata);
  const derived=await f.io.read(built.derivedHash);
  assert.notEqual(derived.effectiveActivities,f.derived.effectiveActivities);
  assert.ok(f.store.writes.length<30,'one coalesced update replaces shared paths for all edits');
});

test('v5 builder owns inputs before asynchronous reads and refuses v4 as an incremental base',async()=>{
  const f=await fixture(),next=applyFinancialEvent(f.ledger,{type:'bank-correction',activityId:f.ledger.activities[0].activityId,amountText:'-9',commandId:'invented-v5-own',evidence:{rationale:'Invented ownership'}},f.options),expected=structuredClone(next);
  const pending=updatePartitionedCanonicalLedger(next,f.store,{baseRootHash:f.built.rootHash,baseLedger:f.ledger});next.activities[0].sourceDescription='mutated';
  const built=await pending;assert.deepEqual((await readVerifiedPartitionedLedger(f.store,built.rootHash)).ledger,expected);
  const old=await f.io.write({...f.root,version:4});
  await assert.rejects(updatePartitionedCanonicalLedger(expected,f.store,{baseRootHash:old,baseLedger:f.ledger}),/unsupported-partitioned-canonical/);
});

test('shared empty sentinel cannot silently change a lineage from v4 to v5',async()=>{
 const f=await fixture(1),{EMPTY_CANONICAL_BYTES}=await import('../js/paged-canonical-format.mjs');
 const empty=await f.store.write(EMPTY_CANONICAL_BYTES),parent=await f.io.write({semanticVersion:'canonical-partitions-v4'});
 const commit={root:f.built.rootHash,previousRoot:empty,parent:{sha256:parent},revision:'1',operation:'synthetic-canonical-import',changeEvidenceRoot:null,semanticVersion:'canonical-partitions-v5'};
 await assert.rejects(verifyPartitionedCanonicalCommit({manifest:{root:commit.root},commit,readObject:q=>f.store.read(q.sha256)}),{code:'canonical-profile-mismatch'});
});
