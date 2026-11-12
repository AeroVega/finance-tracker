import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {updatePartitionedCanonicalLedger,createPartitionObjectIO,createPartitionValueCodec,
  validatePartitionValue,partitionDigest,partitionOrdinal,PARTITION_INLINE_BYTES,PARTITION_INLINE_DEPTH} from '../js/canonical-partitions.mjs';
import {createCanonicalPartitionReader} from '../js/canonical-partition-reader.mjs';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';
import {createCanonicalMonthIndex} from '../js/canonical-month-index.mjs';
import {applyFinancialEvent,applyFinancialEvents,prepareCanonicalImport,validateLedger,summarizeLedger} from '../js/canonical-import.mjs';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
import {replayFixture,replayRow,replayInput} from './helpers/ledger-replay-fixtures.mjs';

function memoryStore() {
  const objects = new Map(); let reads = 0, writes = 0, bytesRead = 0;
  return {objects,reset() { reads = writes = bytesRead = 0; },metrics() { return {reads,writes,bytesRead}; },
    async read(hash,{maxBytes} = {}) {
      assert.equal(maxBytes,65536); reads++; const bytes = objects.get(hash);
      if (!bytes) throw new Error('missing-invented-object'); bytesRead += bytes.length; return bytes.slice();
    },
    async write(bytes) { writes++; const hash = await partitionDigest(bytes); objects.set(hash,bytes.slice()); return hash; }};
}
async function graph(ledger = replayFixture(2).ledger,builder = updatePartitionedCanonicalLedger) {
  const store = memoryStore(), built = await builder(ledger,store), io = createPartitionObjectIO(store);
  return {ledger,store,built,io,tree:createImmutablePageTree(store),codec:createPartitionValueCodec(store,{version:2}),
    root:await io.read(built.rootHash),source:await io.read(built.sourceHash),derived:await io.read(built.derivedHash),
    reader:await createCanonicalPartitionReader(store,built.rootHash)};
}
test('inline UTF-8 boundary and nesting limit fall back to pages instead of limiting total value size',async () => {
  const store = memoryStore(), codec = createPartitionValueCodec(store,{version:2});
  const exact = {x:'x'.repeat(PARTITION_INLINE_BYTES - 8)};
  assert.equal(Buffer.byteLength(JSON.stringify(exact)),4096);
  assert.equal((await codec.encode(exact)).kind,'json');
  assert.equal((await codec.encode({...exact,x:exact.x+'x'})).kind,'object');
  assert.equal((await codec.encode({x:'𐐀'.repeat(1022)})).kind,'json');
  assert.equal((await codec.encode({x:'𐐀'.repeat(1023)})).kind,'object');
  const nested = depth => { let value = 0; for (let i = 0; i < depth; i++) value = [value]; return value; };
  assert.equal((await codec.encode(nested(PARTITION_INLINE_DEPTH))).kind,'json');
  const fallback = await codec.encode(nested(PARTITION_INLINE_DEPTH+1)); assert.equal(fallback.kind,'array');
  assert.deepEqual(await codec.materialize(fallback),nested(PARTITION_INLINE_DEPTH+1));
  const long = 'Invented 𐐀\u0000'.repeat(9000), wide = Array.from({length:1800},(_,i) => ({ordinal:i,nested:[String(i),null]}));
  const value = JSON.parse('{"__proto__":{"invented":true},"constructor":"own","empty":[],"null":null}');
  value[long] = long; value.wide = wide;
  const ref = await codec.encode(value); assert.equal(ref.kind,'object');
  assert.deepEqual(await codec.materialize(ref,{maxStringCodeUnits:2000000}),value);
  assert.equal({}.invented,undefined);
  for (const bytes of store.objects.values()) assert.ok(bytes.length <= 65536);
  assert.throws(() => validatePartitionValue({kind:'json',value:{x:exact.x+'x'}},2),/too-large/);
  assert.throws(() => validatePartitionValue({kind:'json',value:nested(PARTITION_INLINE_DEPTH+1)},2),/depth-limit/);
});


test('inline expansions charge every JSON node, object key and string against caller budgets',async () => {
  const codec = createPartitionValueCodec(memoryStore(),{version:2});
  const ref = await codec.encode({x:[1,2]});
  await assert.rejects(codec.materialize(ref,{maxValues:4}),/materialization-budget/);
  assert.deepEqual(await codec.materialize(ref,{maxValues:5,maxStringCodeUnits:1}),{x:[1,2]});
  const string = await codec.encode({abc:['de','f']});
  await assert.rejects(codec.materialize(string,{maxStringCodeUnits:5}),/materialization-budget/);
  assert.deepEqual(await codec.materialize(string,{maxStringCodeUnits:6}),{abc:['de','f']});
  const long = {x:'a'.repeat(1500)}, large = {padding:'x'.repeat(6000),child:long};
  const fallback = await codec.encode(large); assert.equal(fallback.kind,'object');
  await assert.rejects(codec.materialize(fallback,{maxStringCodeUnits:7499}),/materialization-budget/);
});


test('v5 builder and codec preserve pre-await ownership and reject unsafe JSON without invoking accessors',async () => {
  const ledger = replayFixture(2).ledger, expected = structuredClone(ledger), store = memoryStore();
  const pending = updatePartitionedCanonicalLedger(ledger,store);
  ledger.ledgerId = ledger.accounts[0].accountId; ledger.activities[0].sourceDescription = 'Changed after call';
  const built = await pending, reader = await createCanonicalPartitionReader(store,built.rootHash);
  assert.deepEqual((await reader.fullAudit()).ledger,expected);
  const codec = createPartitionValueCodec(store,{version:2}), input = {nested:[{x:1}]};
  const encoded = codec.encode(input); input.nested[0].x = 2;
  assert.deepEqual(await codec.materialize(await encoded),{nested:[{x:1}]});
  let calls = 0; const getter = {}; Object.defineProperty(getter,'x',{enumerable:true,get() { calls++; return 1; }});
  const hidden = {}; Object.defineProperty(hidden,'x',{value:1});
  const cycle = {}; cycle.x = cycle; const extra = [1]; extra.extra = true;
  for (const value of [getter,hidden,cycle,extra,[,1],{x:NaN},{x:'\ud800'},{[Symbol()]:1},new Date(),Object.create({x:1}),vm.runInNewContext('({x:1})')]) {
    await assert.rejects(codec.encode(value));
    assert.throws(() => validatePartitionValue({kind:'json',value},2));
  }
  assert.equal(calls,0);
});


test('descriptor accessors cannot change inline values or kinds between validation and use',async () => {
  const codec = createPartitionValueCodec(memoryStore(),{version:2});
  for (const member of ['kind','value']) {
    let calls = 0; const ref = {kind:'json',value:{}};
    Object.defineProperty(ref,member,{enumerable:true,get() { calls++; return member === 'kind' ? 'json' : {oversized:'x'.repeat(100000)}; }});
    assert.throws(() => validatePartitionValue(ref,2),/accessor/);
    await assert.rejects(codec.page(ref),/accessor/);
    await assert.rejects(codec.materialize(ref),/accessor/);
    assert.equal(calls,0);
  }
});


test('bounded descriptor validation rejects huge keys before canonical serialization',() => {
  const key = 'x'.repeat(1000000), original = JSON.stringify; let largestString = 0;
  JSON.stringify = function (value,...rest) {
    if (typeof value === 'string') largestString = Math.max(largestString,value.length);
    return original(value,...rest);
  };
  try { assert.throws(() => validatePartitionValue({kind:'json',value:{[key]:0}},2),/too-large/); }
  finally { JSON.stringify = original; }
  assert.ok(largestString < 4096);
});


test('inline handles are deeply immutable and field/page cursors bind exact value and top root',async () => {
  const g = await graph(), record = (await g.reader.getRecord('activities',g.ledger.activities[0].activityId)).value;
  assert.equal(record.ref.kind,'json'); assert.ok(Object.isFrozen(record.ref.value));
  assert.throws(() => { record.ref.value.sourceDescription = 'changed'; },TypeError);
  assert.equal((await g.reader.materialize(record)).value.sourceDescription,g.ledger.activities[0].sourceDescription);
  const field = (await g.reader.field(record,'sourceDescription')).value;
  assert.equal((await g.reader.materialize(field)).value,g.ledger.activities[0].sourceDescription);
  assert.equal((await g.reader.field(record,'absent')).value,null);
  await assert.rejects(g.reader.materialize(structuredClone(record)),/foreign/);
  const first = await g.reader.pageValue(record,{limit:1}); assert.ok(first.cursor);
  const secondRecord = (await g.reader.getRecord('activities',g.ledger.activities[1].activityId)).value;
  await assert.rejects(g.reader.pageValue(secondRecord,{cursor:first.cursor}),/cursor-mismatch/);
  const other = await graph(replayFixture(3).ledger), otherRecord = (await other.reader.getRecord('activities',other.ledger.activities[0].activityId)).value;
  await assert.rejects(other.reader.pageValue(otherRecord,{cursor:first.cursor}),/cursor-mismatch/);
  let cursor = null, keys = [];
  do {
    const page = await g.reader.pageValue(record,{limit:2,cursor});
    for (const entry of page.entries) keys.push((await g.reader.materialize(entry.key)).value);
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(keys,Object.keys(g.ledger.activities[0]).sort());
  const codec = g.codec, array = await codec.encode([1,2,3]);
  assert.deepEqual((await codec.page(array,{limit:2})).entries.map(([ordinal,ref]) => [ordinal,ref.value]),[['a:0',1],['a:1',2]]);
  const directPage = await codec.page(array,{limit:1}), originalCursor = structuredClone(directPage.cursor);
  const pendingPage = codec.page(array,{limit:1,cursor:directPage.cursor}); directPage.cursor.next = 10000;
  assert.equal((await pendingPage).entries[0][0],'a:1');
  let calls = 0; Object.defineProperty(originalCursor,'next',{enumerable:true,get() { calls++; return 1; }});
  await assert.rejects(codec.page(array,{cursor:originalCursor}),/accessor/); assert.equal(calls,0);
  const fieldsRoot = await g.tree.build([[partitionOrdinal(0),{key:{kind:'json',value:'x'},value:{kind:'json',value:[1]}}]]);
  assert.deepEqual(await codec.materialize({kind:'object',root:fieldsRoot,count:'1'}),{x:[1]});
  await assert.rejects(codec.page({kind:'json',value:1}),/not-paged/);
  const signal = AbortSignal.abort(); await assert.rejects(g.reader.pageValue(record,{signal}),{name:'AbortError'});
});


test('compact codec keeps byte ownership and shared-memory rejection at object boundaries',async () => {
  const g = await graph(), bytes = g.store.objects.get(g.built.rootHash);
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
  const crossRealmShared = vm.runInNewContext(`new SharedArrayBuffer(${bytes.length})`);
  const alias = new Uint8Array(crossRealmShared); alias.set(bytes);
  for (const result of [shared,alias]) {
    await assert.rejects(createPartitionObjectIO({read:async () => result}).read(g.built.rootHash),/invalid-partition-bytes/);
  }
  const input = {format:'invented',nested:{x:1}}, expected = structuredClone(input), io = createPartitionObjectIO(g.store);
  const pending = io.write(input); input.nested.x = 2;
  assert.deepEqual(await io.read(await pending),expected);
});

// Request counts, unique stored bytes and exact reconstruction are reproducible
// in-memory observations, not Drive latency or mobile/application memory claims.

test('v5 rejects legacy roots, mismatched source versions and unknown codecs',async()=>{
  const modern=await graph(replayFixture(0).ledger);
  assert.equal(modern.root.version,5);assert.equal(modern.root.valueCodec,'compact-json-v1');
  assert.equal(modern.source.version,2);assert.equal(modern.derived.version,2);
  const badSource=await modern.io.write({...modern.source,version:1});
  const badDerived=await modern.io.write({...modern.derived,version:1});
  for(const root of [...[1,2,3,4,6].map(version=>({...modern.root,version})),
    {...modern.root,valueCodec:'unknown'},{...modern.root,audit:'0'.repeat(64)},
    {...modern.root,source:badSource},{...modern.root,derived:badDerived},
    Object.fromEntries(Object.entries(modern.root).filter(([key])=>key!=='valueCodec'))]) {
    const hash=await modern.io.write(root);await assert.rejects(createCanonicalPartitionReader(modern.store,hash));
  }
  assert.throws(()=>createPartitionValueCodec(modern.store,{version:1}),/unsupported-partition-value-version/);
});

test('v5 rejects non-JSON derived refund safely without altering source',async()=>{
  const {ledger,options}=replayFixture(2,[replayRow(0),replayRow(1,{amountText:'2.00',postedDate:'2026-02-02'})]);
  const [purchase,refund]=ledger.activities;delete purchase.categoryId;
  ledger.events=[{eventId:options.idFactory(),commandId:'invented-classification',eventType:'classification',activityId:purchase.activityId,recordedAt:options.now(),appendOnly:true,activityKind:'spending',categoryId:null,priorActivityKind:'unclassified'},
    {eventId:options.idFactory(),commandId:'invented-refund',eventType:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,recordedAt:options.now(),appendOnly:true,evidence:{reason:'invented'}}];
  assert.equal(validateLedger(ledger),true);const before=structuredClone(ledger);
  await assert.rejects(updatePartitionedCanonicalLedger(ledger,memoryStore()),{code:'unsupported-derived-projection'});
  assert.deepEqual(ledger,before);assert.equal(Object.hasOwn(ledger.activities[0],'categoryId'),false);
});

test('compact full audit preserves financial position, exact corrections, source fields and source-bound summaries',async () => {
  let {ledger,options} = replayFixture(0,[]);
  const input = replayInput(ledger.accounts[0],[replayRow(0,{effectiveDate:'2025-12-31',amountText:'-900719925474099.99'}),replayRow(1,{effectiveDate:'2026-01-01',postedDate:'2026-02-01',amountText:'0.01'})],'invented-compact-cross-year');
  input.coverageByAccount[ledger.accounts[0].accountId].start = '2025-12-01';
  ledger = prepareCanonicalImport(ledger,input,options).ledger;
  ledger = applyFinancialEvents(ledger,[{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',commandId:'invented-spend'},
    {type:'refund-link',activityId:ledger.activities[1].activityId,originalActivityId:ledger.activities[0].activityId,commandId:'invented-refund',evidence:{reason:'Invented cross-year refund'}}],options);
  ledger = applyFinancialEvent(ledger,{type:'bank-correction',activityId:ledger.activities[0].activityId,amountText:'-900719925474099.98',commandId:'invented-correct',evidence:{reason:'Invented correction'}},options);
  for (const fixture of [ledger,(await createSyntheticFinancialPosition()).ledger]) {
    const g = await graph(fixture), before = g.reader.verification();
    const reference = createCanonicalMonthIndex(fixture);
    for (const summary of reference.monthlySummaries()) {
      const handle = (await g.reader.getMonthlySummary({accountId:summary.accountId,month:summary.month,currency:summary.currency})).value;
      const actual = (await g.reader.materialize(handle)).value;
      assert.deepEqual(actual,{...summary,availability:{...summary.availability,eligibleActivityCount:String(summary.availability.eligibleActivityCount)}});
      const oracle = summarizeLedger(fixture,{accountIds:[summary.accountId],currency:summary.currency,start:summary.start,end:summary.end});
      assert.equal(actual.spending,oracle.spending); assert.equal(actual.income,oracle.income); assert.equal(actual.cash,oracle.cash);
    }
    g.store.reset(); const audit = await g.reader.fullAudit();
    assert.deepEqual(audit.ledger,fixture); assert.equal(validateLedger(audit.ledger),true);
    assert.equal(audit.verification.derived,'semantic-verified'); assert.equal(g.store.metrics().writes,0);
  }
});


test('rehashed compact summary corruption never gains semantic authority or rewrites the original source',async()=>{
  const g=await graph(),source=g.built.sourceHash;
  const key=(await g.tree.page(g.derived.summaries,{limit:1})).entries[0][0];
  const ref=await g.tree.get(g.derived.summaries,key),summary=await g.codec.materialize(ref);
  summary.spending='999999.99';
  const summaries=await g.tree.set(g.derived.summaries,key,await g.codec.encode(summary));
  const derived=await g.io.write({...g.derived,summaries});
  const bad=await g.io.write({...g.root,derived});
  const reader=await createCanonicalPartitionReader(g.store,bad);const audited=await reader.fullAudit();
  assert.equal(audited.verification.derived,'invalid');assert.deepEqual(audited.ledger,g.ledger);
  assert.equal((await g.io.read(g.built.rootHash)).source,source);
  assert.equal((await g.reader.fullAudit()).verification.derived,'semantic-verified');
});
