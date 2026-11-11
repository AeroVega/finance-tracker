import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPartitionedCanonicalLedger,createPartitionValueCodec,createPartitionObjectIO,
  partitionDigest,partitionOrdinal,PARTITION_VALUE_CHARS} from '../js/canonical-partitions.mjs';
import {createCanonicalPartitionReader} from '../js/canonical-partition-reader.mjs';
import {createCanonicalMonthIndex} from '../js/canonical-month-index.mjs';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';
import {applyFinancialEvent,applyFinancialEvents,prepareCanonicalImport,applyReviewDecision,
  reverseReviewDecision,registerAccount,validateLedger,summarizeLedger} from '../js/canonical-import.mjs';
import {applyPositionEvent} from '../js/financial-position.mjs';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
import {serializeCanonicalLedger,serializeFragmentedCanonicalLedger,CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {replayFixture,replayRow,replayInput} from './helpers/ledger-replay-fixtures.mjs';

function memoryStore() {
  const objects = new Map(); let reads = 0, writes = 0, bytesRead = 0;
  return {objects,reset() { reads = writes = bytesRead = 0; },metrics() { return {reads,writes,bytesRead}; },
    async read(hash) { reads++; const bytes = objects.get(hash); if (!bytes) throw new Error('missing-invented-object'); bytesRead += bytes.length; return bytes.slice(); },
    async write(bytes) { writes++; const hash = await partitionDigest(bytes); objects.set(hash,bytes.slice()); return hash; }};
}
async function builtReader(ledger) {
  const store = memoryStore(), built = await buildPartitionedCanonicalLedger(ledger,store);
  const reader = await createCanonicalPartitionReader(store,built.rootHash);
  return {store,built,reader};
}
async function values(reader,method,scope,limit = 7) {
  let cursor = null; const result = [];
  do {
    const page = await reader[method](scope,{cursor,limit});
    for (const entry of page.entries) result.push((await reader.materialize(entry.value)).value);
    cursor = page.cursor;
  } while (cursor);
  return result;
}
async function member(reader,parent,name) { return (await reader.field(parent,name)).value; }
async function readSummary(reader,scope) {
  const result = await reader.getMonthlySummary({accountId:scope.accountId,month:scope.month,currency:scope.currency});
  return result.value && (await reader.materialize(result.value)).value;
}
function exactCountSummary(value) {
  const result = structuredClone(value); result.availability.eligibleActivityCount = String(result.availability.eligibleActivityCount); return result;
}

test('v1 and fragmented v3 graph conversion preserve metadata, collection/event order and optional position history',async () => {
  const old = replayFixture(12).ledger, current = (await createSyntheticFinancialPosition()).ledger;
  old.activities.reverse(); old.observations.reverse();
  // JSON evidence keys must remain own data without prototype mutation.
  old.inventedEvidence = JSON.parse('{"__proto__":{"invented":true},"constructor":"own","empty":[],"absentIsDifferent":null}');
  for (const ledger of [old,current]) for (const serialize of [serializeCanonicalLedger,serializeFragmentedCanonicalLedger]) {
    const legacy = serialize(ledger), lifecycle = {async readManifest() { return {syntheticOnly:true,snapshot:Object.fromEntries([...legacy.keys()].map(path => [path,'invented-hash']))}; },
      async readObject(path) { return new TextEncoder().encode(legacy.get(path)); },async transact() { assert.fail('read-only conversion must not save legacy data'); }};
    const loaded = await new CanonicalLedgerStore({lifecycle}).load();
    const {reader,store} = await builtReader(loaded); store.reset();
    const audited = await reader.fullAudit();
    assert.deepEqual(audited.ledger,ledger); assert.equal(validateLedger(audited.ledger),true);
    assert.equal(audited.verification.source,'full-ledger-validated'); assert.equal(audited.verification.derived,'semantic-verified');
    assert.equal(store.metrics().writes,0,'audit writes only to its private reference store');
    assert.equal(Object.hasOwn(audited.ledger,'positionEvents'),Object.hasOwn(ledger,'positionEvents'));
    assert.deepEqual(await values(reader,'pageCollection','events',2),ledger.events);
    assert.equal({}.invented,undefined);
  }
});

test('paged month membership and exact summaries match canonical corrections, refunds, transfers, currency and missing coverage',async () => {
  let {ledger,options} = replayFixture(0,[]);
  const input = replayInput(ledger.accounts[0],[
    replayRow(0,{effectiveDate:'2025-12-31',amountText:'-900719925474099.99'}),
    replayRow(1,{effectiveDate:'2026-01-01',postedDate:'2026-02-01',amountText:'0.01'}),
    replayRow(2,{lifecycleStatus:'pending'}), replayRow(3,{lifecycleStatus:'unknown',currency:'EUR'}),
    replayRow(4,{amountText:null}), replayRow(5,{valid:false,errorCode:'invented-bad-date',effectiveDate:null}),
    replayRow(6,{amountText:'1.00'})],'invented-v4-cross-year');
  input.coverageByAccount[ledger.accounts[0].accountId] = {start:'2025-12-15',end:'2026-12-31',provenance:'source-confirmed'};
  ledger = prepareCanonicalImport(ledger,input,options).ledger;
  ledger = applyFinancialEvents(ledger,[
    {type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',categoryId:'invented-original',commandId:'spend'},
    {type:'classification',activityId:ledger.activities.at(-1).activityId,activityKind:'refund',commandId:'undated'},
    {type:'classification',activityId:ledger.activities[2].activityId,activityKind:'transfer',commandId:'transfer'}],options);
  ledger = applyFinancialEvent(ledger,{type:'refund-link',activityId:ledger.activities[1].activityId,originalActivityId:ledger.activities[0].activityId,commandId:'refund-link',evidence:{reason:'Invented cross-year refund'}},options);
  ledger = applyFinancialEvent(ledger,{type:'bank-correction',activityId:ledger.activities[0].activityId,amountText:'-900719925474099.98',commandId:'correct',evidence:{reason:'Invented correction'}},options);
  ledger = prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(2)],'invented-v4-overlap'),options).ledger;
  ledger = applyReviewDecision(ledger,{observationId:ledger.observations.at(-1).observationId,action:'keep-separate'},options);
  ledger = reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId,rationale:'Invented reversal'},options);
  const {reader} = await builtReader(ledger), reference = createCanonicalMonthIndex(ledger), accountId = ledger.accounts[0].accountId;
  assert.equal(reader.verification().derived,'not-semantically-validated');
  for (const month of ['2025-12','2026-01','2026-02','2027-01']) {
    assert.deepEqual(await values(reader,'pageMonthActivities',{accountId,month},1),reference.activities({accountIds:[accountId],month}));
  }
  for (const expected of reference.monthlySummaries()) assert.deepEqual(await readSummary(reader,expected),exactCountSummary(expected));
  const december = await readSummary(reader,{accountId,month:'2025-12',currency:'USD'});
  assert.equal(december.spending,'900719925474099.98'); assert.ok(december.reasons.includes('missing-declared-coverage'));
  assert.equal((await readSummary(reader,{accountId,month:'2026-02',currency:'USD'})).spending,'-0.01');
  assert.equal((await reader.getMonthlySummary({accountId,month:'2099-01',currency:'USD'})).availability,'not-indexed');
  assert.equal((await reader.fullAudit()).verification.derived,'semantic-verified');
  assert.equal(december.complete,false); assert.equal('balance' in december,false);
  // Independent financial oracle, apart from the builder's monthly index.
  for (const expected of reference.monthlySummaries()) {
    const scope = {start:expected.start,end:expected.end,currency:expected.currency,accountIds:[accountId]};
    const report = summarizeLedger(ledger,scope);
    assert.equal(expected.income,report.income); assert.equal(expected.spending,report.spending); assert.equal(expected.cash,report.cash);
  }
});

test('large import, retry, rule, review, holdings and conflict memberships are paged values',async () => {
  let {ledger,options} = replayFixture(160);
  ledger = applyFinancialEvents(ledger,ledger.activities.map((a,i) => ({type:'classification',activityId:a.activityId,activityKind:'spending',commandId:`invented-classify-${i}`})),options);
  ledger = applyFinancialEvent(ledger,{type:'category-correction',activityId:ledger.activities[0].activityId,categoryId:'invented-category',commandId:'invented-rule'},options);
  ledger.events.at(-1).prospectiveRule.existingActivityIds = ledger.activities.map(activity => activity.activityId);
  ledger = prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0)],'invented-review'),options).ledger;
  ledger = applyReviewDecision(ledger,{observationId:ledger.observations.at(-1).observationId,action:'keep-separate'},options);
  const run = ledger.imports[0];
  run.retryAttempts = Array.from({length:150},() => ({attemptId:options.idFactory(),startedAt:options.now(),completedAt:options.now(),priorStatus:run.status,status:run.status,priorCounts:structuredClone(run.counts),counts:structuredClone(run.counts)}));
  ledger = registerAccount(ledger,{institutionId:'fidelity',name:'Invented paged holding account',currency:'USD',accountType:'brokerage'},options);
  const accountId = ledger.accounts.at(-1).accountId, source = {kind:'statement',reference:'Invented bounded statement'};
  ledger = applyPositionEvent(ledger,{type:'holdings-snapshot',accountId,commandId:'invented-holdings',effectiveDate:'2026-01-31',scope:'complete',source,
    holdings:Array.from({length:150},(_,i) => ({symbol:`INVENTED${i}`,assetType:'stock',quantity:'1',valueText:'1.00'}))},options);
  ledger = applyPositionEvent(ledger,{type:'balance-snapshot',accountId,commandId:'invented-balance',effectiveDate:'2026-01-31',amountText:'150.00',basis:'statement',source},options);
  const balance = ledger.positionEvents.at(-1);
  for (let i = 0; i < 130; i++) ledger.positionEvents.push({...structuredClone(balance),eventId:options.idFactory(),commandId:`invented-candidate-${i}`});
  const candidateEventIds = ledger.positionEvents.filter(e => e.eventType === 'balance-snapshot').map(e => e.eventId);
  ledger = applyPositionEvent(ledger,{type:'balance-resolution',accountId,commandId:'invented-resolution',effectiveDate:'2026-01-31',candidateEventIds,selectedEventId:candidateEventIds[0],reason:'Invented corroborating selection'},options);
  assert.equal(validateLedger(ledger),true);
  const {reader,store} = await builtReader(ledger);
  const probes = [
    ['imports',run.importRunId,['observationIds'],160],['imports',run.importRunId,['retryAttempts'],150],
    ['events',ledger.events.at(-1).eventId,['prospectiveRule','existingActivityIds'],160],
    ['reviewDecisions',ledger.reviewDecisions[0].reviewDecisionId,['existingEventIds'],161],
    ['positionEvents',ledger.positionEvents[0].eventId,['holdings'],150],
    ['positionEvents',ledger.positionEvents.at(-1).eventId,['candidateEventIds'],131],
  ];
  for (const [collection,id,path,count] of probes) {
    let ref = (await reader.getRecord(collection,id)).value;
    for (const name of path) ref = await member(reader,ref,name);
    assert.equal(ref.ref.kind,'array'); assert.equal(ref.ref.count,String(count));
    const page = await reader.pageValue(ref,{limit:5}); assert.equal(page.entries.length,5); assert.ok(page.cursor);
    assert.equal((await reader.materialize(ref)).value.length,count);
  }
  assert.deepEqual((await reader.fullAudit()).ledger,ledger);
  for (const bytes of store.objects.values()) {
    assert.ok(bytes.length <= 65536);
    const object = JSON.parse(new TextDecoder().decode(bytes));
    if (object.kind === 'leaf') assert.ok(object.entries.length <= 128);
    if (object.kind === 'branch') assert.ok(object.children.length <= 128);
  }
});

test('linked transfer sides in different months remain separate auditable detail without spending or income',async () => {
  let {ledger,options} = replayFixture(1,[replayRow(0,{amountText:'-25.00'})]);
  ledger = registerAccount(ledger,{institutionId:'sofi',name:'Invented receiving savings',currency:'USD',accountType:'savings'},options);
  ledger = prepareCanonicalImport(ledger,replayInput(ledger.accounts[1],[replayRow(0,{amountText:'25.00',effectiveDate:'2026-02-01'})],'invented-incoming-transfer'),options).ledger;
  ledger = applyFinancialEvents(ledger,ledger.activities.map((activity,i) => ({type:'classification',activityId:activity.activityId,activityKind:'transfer',commandId:`invented-transfer-classify-${i}`})),options);
  ledger = applyFinancialEvent(ledger,{type:'transfer-link',activityId:ledger.activities[0].activityId,counterpartyActivityId:ledger.activities[1].activityId,
    commandId:'invented-transfer-link',evidence:{rationale:'Invented manually confirmed opposite sides'}},options);
  const {reader} = await builtReader(ledger), reference = createCanonicalMonthIndex(ledger);
  for (const [index,month] of ['2026-01','2026-02'].entries()) {
    const accountId = ledger.accounts[index].accountId, detail = await values(reader,'pageMonthActivities',{accountId,month});
    assert.deepEqual(detail,reference.activities({accountIds:[accountId],month}));
    assert.equal(detail[0].transferGroupId,ledger.events.at(-1).eventId);
    const summary = await readSummary(reader,{accountId,month,currency:'USD'});
    assert.equal(summary.income,'0'); assert.equal(summary.spending,'0');
  }
  assert.deepEqual((await reader.fullAudit()).ledger,ledger);
});

test('large strings and property names offer chunk reads with explicit materialization budgets',async () => {
  const {ledger} = replayFixture(1), long = ('INVENTED \ud83d\ude42\u0000').repeat(12000);
  ledger.inventedEvidence = {[long]:'invented long key',description:long};
  ledger.activities[0].sourceDescription = long;
  const {reader} = await builtReader(ledger);
  const record = (await reader.getRecord('activities',ledger.activities[0].activityId)).value;
  const ref = await member(reader,record,'sourceDescription');
  assert.equal(ref.ref.kind,'string'); assert.equal(ref.ref.codeUnits,String(long.length));
  let cursor = null, text = '';
  do {
    const page = await reader.pageValue(ref,{limit:3,cursor});
    for (const entry of page.entries) { assert.ok(entry.text.length <= PARTITION_VALUE_CHARS); text += entry.text; }
    cursor = page.cursor;
  } while (cursor);
  assert.equal(text,long);
  await assert.rejects(reader.materialize(ref,{maxStringCodeUnits:100}),/materialization-budget/);
  assert.deepEqual((await reader.fullAudit()).ledger,ledger);
});

test('root/query-bound cursors, private handles, cancellation and unsupported position methods fail explicitly',async () => {
  const {ledger} = replayFixture(20), {reader,store,built} = await builtReader(ledger);
  const accountId = ledger.accounts[0].accountId;
  const first = await reader.pageMonthActivities({accountId,month:'2026-01'},{limit:3}); assert.ok(first.cursor);
  await assert.rejects(reader.pageMonthActivities({accountId,month:'2026-02'},{cursor:first.cursor}),/cursor-mismatch/);
  const changed = structuredClone(ledger); changed.accounts[0].displayName += ' changed';
  const next = await buildPartitionedCanonicalLedger(changed,store), other = await createCanonicalPartitionReader(store,next.rootHash);
  await assert.rejects(other.pageMonthActivities({accountId,month:'2026-01'},{cursor:first.cursor}),/cursor-mismatch/);
  const ordered = await reader.pageCollection('activities',{limit:1});
  await assert.rejects(other.pageCollection('activities',{cursor:ordered.cursor}),/cursor-mismatch/);
  const nested = await reader.pageValue(first.entries[0].value,{limit:1});
  const otherActivity = (await other.pageMonthActivities({accountId,month:'2026-01'},{limit:1})).entries[0].value;
  await assert.rejects(other.pageValue(otherActivity,{cursor:nested.cursor}),/cursor-mismatch/);
  await assert.rejects(reader.materialize(structuredClone(first.entries[0].value)),/foreign-partition-value-handle/);
  await assert.rejects(reader.fullAudit({trusted:true}),/invalid-partition-options/);
  await assert.rejects(createCanonicalPartitionReader(store,built.rootHash,{trusted:true}),/invalid-partition-options/);
  const controller = new AbortController(); controller.abort();
  for (const operation of [() => reader.fullAudit({signal:controller.signal}),() => reader.pageCollection('events',{signal:controller.signal}),
    () => reader.pageMonthActivities({accountId,month:'2026-01'},{signal:controller.signal}),
    () => reader.materialize(first.entries[0].value,{signal:controller.signal}),() => buildPartitionedCanonicalLedger(ledger,store,{signal:controller.signal})]) {
    await assert.rejects(operation(),{name:'AbortError'});
  }
  assert.throws(() => reader.position({asOf:'2026-01-31'}),/not-implemented/);
  assert.throws(() => reader.reconciliation({month:'2026-01'}),/not-implemented/);
});

test('same source hash and recomputed forged derived totals or membership cannot confer semantic verification',async () => {
  const {ledger} = replayFixture(4), {store,built} = await builtReader(ledger);
  const io = createPartitionObjectIO(store), root = await io.read(built.rootHash), original = await io.read(root.derived), tree = createImmutablePageTree(store), codec = createPartitionValueCodec(store);
  for (const kind of ['summary','membership','effective']) {
    const derived = structuredClone(original);
    if (kind === 'summary') {
      const [key,ref] = (await tree.page(derived.summaries,{limit:1})).entries[0];
      const forged = await codec.materialize(ref); forged.spending = '999999.00'; forged.complete = true;
      derived.summaries = await tree.set(derived.summaries,key,await codec.encode(forged));
    } else if (kind === 'membership') {
      const [key] = (await tree.page(derived.monthActivities,{limit:1})).entries[0];
      derived.monthActivities = await tree.delete(derived.monthActivities,key);
    } else {
      const [key,ref] = (await tree.page(derived.effectiveActivities,{limit:1})).entries[0];
      const forged = await codec.materialize(ref); forged.amountMinor = 42;
      derived.effectiveActivities = await tree.set(derived.effectiveActivities,key,await codec.encode(forged));
    }
    const forgedRoot = await io.write({...root,derived:await io.write(derived)}), reader = await createCanonicalPartitionReader(store,forgedRoot);
    const scope = {accountId:ledger.accounts[0].accountId,month:'2026-01',currency:'USD'};
    assert.equal((await reader.getMonthlySummary(scope)).verification.derived,'not-semantically-validated');
    const result = await reader.fullAudit(); assert.deepEqual(result.ledger,ledger);
    assert.equal(result.verification.source,'full-ledger-validated'); assert.equal(result.verification.derived,'invalid');
    assert.equal((await reader.pageMonthActivities({accountId:scope.accountId,month:scope.month})).verification.derived,'invalid');
  }
});

test('corrupt bytes, malformed versions, unsupported collections and forged source order/frontiers fail closed',async () => {
  const {ledger} = replayFixture(4), {store,built} = await builtReader(ledger), io = createPartitionObjectIO(store), tree = createImmutablePageTree(store);
  const root = await io.read(built.rootHash), source = await io.read(root.source), derived = await io.read(root.derived);
  const originalBytes = store.objects.get(root.source); store.objects.set(root.source,new TextEncoder().encode('{}'));
  await assert.rejects(createCanonicalPartitionReader(store,built.rootHash),/hash-mismatch/); store.objects.set(root.source,originalBytes);
  await assert.rejects(createCanonicalPartitionReader(store,await io.write({...root,version:99})),/unsupported/);
  for (const kind of ['unknown-collection','frontier','order','count']) {
    const forged = structuredClone(source);
    if (kind === 'unknown-collection') forged.collections = await tree.set(forged.collections,'futureCollection',await tree.get(source.collections,'activities'));
    else if (kind === 'frontier') forged.eventFrontier = '9007199254740993';
    else {
      const descriptor = await tree.get(forged.collections,'activities');
      if (kind === 'count') descriptor.count = '9007199254740993';
      else descriptor.order = await tree.set(descriptor.order,partitionOrdinal(1n),ledger.activities[0].activityId);
      forged.collections = await tree.set(forged.collections,'activities',descriptor);
    }
    const sourceHash = await io.write(forged), derivedHash = await io.write({...derived,source:sourceHash});
    const reader = await createCanonicalPartitionReader(store,await io.write({...root,source:sourceHash,derived:derivedHash}));
    await assert.rejects(reader.fullAudit(),/unsupported|frontier|order|budget|count/);
    assert.notEqual(reader.verification().derived,'semantic-verified');
  }
});

test('strict owned codec rejects non-JSON values and works without SharedArrayBuffer',async () => {
  const store = memoryStore(), codec = createPartitionValueCodec(store), cycle = {}; cycle.loop = cycle;
  let accessed = false; const accessor = {get dangerous() { accessed = true; return 1; }};
  const hidden = Object.defineProperty({},'hidden',{value:1}), extraArray = Object.assign([1],{extra:2}), symbolArray = [1]; symbolArray[Symbol('x')] = 1;
  const hiddenArray = Object.defineProperty([1],'hidden',{value:2});
  for (const value of [cycle,accessor,new Date(),[undefined],Array(2),{x:NaN},{x:1n},{x:'\ud800'},new Map(),{[Symbol('x')]:1},hidden,extraArray,symbolArray,hiddenArray]) await assert.rejects(codec.encode(value));
  assert.equal(accessed,false);
  const input = {a:[1,2,3],z:'original'}, promise = codec.encode(input); input.z = 'mutated'; input.a.push(4);
  assert.deepEqual(await codec.materialize(await promise),{a:[1,2,3],z:'original'});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'SharedArrayBuffer');
  try {
    Object.defineProperty(globalThis,'SharedArrayBuffer',{value:undefined,configurable:true,writable:true});
    const {ledger} = replayFixture(1), built = await buildPartitionedCanonicalLedger(ledger,store);
    assert.equal((await (await createCanonicalPartitionReader(store,built.rootHash)).fullAudit()).verification.derived,'semantic-verified');
  } finally { Object.defineProperty(globalThis,'SharedArrayBuffer',descriptor); }
});

test('root IO owns Buffer bytes across hashing and enforces intrinsic byte bounds and read profiles',async () => {
  const original = Buffer.from('{"value":"aaaaaaaa"}'), replacement = Buffer.from('{"value":"bbbbbbbb"}'), hash = await partitionDigest(original);
  const io = createPartitionObjectIO({async read(requested,options) {
    assert.equal(requested,hash); assert.equal(options.maxBytes,65536);
    setImmediate(() => original.set(replacement)); return original;
  }});
  assert.deepEqual(await io.read(hash),{value:'aaaaaaaa'});
  const oversized = new Uint8Array(65537); Object.defineProperty(oversized,'byteLength',{value:0});
  await assert.rejects(createPartitionObjectIO({async read() { return oversized; }}).read(hash),/invalid-partition-bytes/);
  let called = false;
  await assert.rejects(createPartitionObjectIO(memoryStore()).write({get value() { called = true; return 1; }}),/non-json-partition-accessor/);
  assert.equal(called,false);
});

test('failed expansion, missing nested source and cancellation never validate a partial ledger',async () => {
  const {ledger} = replayFixture(4), {reader,store,built} = await builtReader(ledger);
  await assert.rejects(reader.fullAudit({maxValues:1}),/materialization-budget/);
  assert.equal(reader.verification().source,'not-semantically-validated');
  const io = createPartitionObjectIO(store), root = await io.read(built.rootHash), source = await io.read(root.source);
  store.objects.delete(source.metadata.root);
  await assert.rejects(reader.fullAudit(),/missing-invented-object/);
  assert.equal(reader.verification().source,'not-semantically-validated');
  assert.equal(reader.verification().derived,'not-semantically-validated');
});

test('growing invented fixtures keep roots fixed and read selected detail pages without full source loading',async t => {
  const measurements = [];
  for (const size of [24,144,576]) {
    const {ledger} = replayFixture(size,Array.from({length:size},(_,i) => replayRow(i,{effectiveDate:`2026-${String(i % 12 + 1).padStart(2,'0')}-15`})));
    const store = memoryStore(), built = await buildPartitionedCanonicalLedger(ledger,store);
    const totalObjects = store.objects.size; store.reset();
    const reader = await createCanonicalPartitionReader(store,built.rootHash);
    const openReads = store.metrics().reads; assert.equal(openReads,3);
    store.reset();
    const selected = await reader.pageMonthActivities({accountId:ledger.accounts[0].accountId,month:'2026-01'},{limit:2});
    const selectedReads = store.metrics().reads;
    assert.equal(selected.entries.length,2); assert.ok(selectedReads < totalObjects / 3);
    assert.equal(selected.verification.derived,'not-semantically-validated');
    const rootBytes = store.objects.get(built.rootHash).length;
    store.reset();
    const record = await reader.getRecord('activities',ledger.activities[0].activityId);
    const recordReads = store.metrics().reads; store.reset();
    await reader.materialize(record.value); const expandedRecordReads = store.metrics().reads; store.reset();
    const summary = await reader.getMonthlySummary({accountId:ledger.accounts[0].accountId,month:'2026-01',currency:'USD'});
    await reader.materialize(summary.value); const expandedSummaryReads = store.metrics().reads;
    const root = JSON.parse(new TextDecoder().decode(store.objects.get(built.rootHash)));
    assert.deepEqual(Object.keys(root).sort(),['derived','format','source','syntheticOnly','version']);
    for (const bytes of store.objects.values()) assert.ok(bytes.length <= 65536);
    const totalBytes = [...store.objects.values()].reduce((sum,bytes) => sum + bytes.length,0);
    measurements.push({activities:size,totalObjects,totalBytes,rootBytes,openReads,selectedReads,recordReads,expandedRecordReads,expandedSummaryReads});
  }
  assert.equal(new Set(measurements.map(value => value.rootBytes)).size,1);
  t.diagnostic(JSON.stringify(measurements));
});
