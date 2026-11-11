import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPartitionValueCodec,validatePartitionValue,partitionDigest,partitionOrdinal} from '../js/canonical-partitions.mjs';
import {createImmutablePageTree} from '../js/immutable-page-tree.mjs';

// Deliberately invented JSON, with no application records or external service.
function memoryStore() {
  const objects = new Map(); let reads = 0, beforeRead = null;
  return {objects,get reads() { return reads; },set beforeRead(value) { beforeRead = value; },
    async read(hash,{maxBytes}) {
      reads++; assert.equal(maxBytes,65536); if (beforeRead) await beforeRead();
      const bytes = objects.get(hash); if (!bytes) throw Error('missing-invented-object');
      return bytes.slice();
    },
    async write(bytes) { const hash = await partitionDigest(bytes); objects.set(hash,bytes.slice()); return hash; }};
}
const nested = depth => { let value = 0; while (depth--) value = [value]; return value; };
const error = message => ({name:'TypeError',message});
const budgetError = error('partition-materialization-budget');

async function rejectsEveryEntry(ref,expected,version = 2) {
  const codec = createPartitionValueCodec(memoryStore(),{version});
  assert.throws(() => validatePartitionValue(ref,version),expected);
  assert.throws(() => codec.validate(ref),expected);
  await assert.rejects(codec.materialize(ref),expected);
  await assert.rejects(codec.page(ref),expected);
}

test('public validation snapshots aliases, negative zero and prototype-named properties independently',async () => {
  const shared = {invented:[-0,'Synthetic']};
  const ref = {kind:'json',value:{a:shared,b:shared,...JSON.parse('{"__proto__":{"invented":true}}')}};
  const result = validatePartitionValue(ref,2);
  assert.deepEqual(result.value.a,{invented:[0,'Synthetic']});
  assert.notEqual(result,ref); assert.notEqual(result.value,ref.value);
  assert.notEqual(result.value.a,result.value.b); assert.notEqual(result.value.a,shared);
  result.value.a.invented.push('changed'); ref.value.b.invented.push('caller');
  assert.deepEqual(result.value.b.invented,[0,'Synthetic']);
  assert.equal(Object.getPrototypeOf(result.value),Object.prototype);
  assert.equal(Object.hasOwn(result.value,'__proto__'),true); assert.equal({}.invented,undefined);
});

test('inline byte, Unicode byte, depth and scalar boundaries preserve exact failure categories',async () => {
  const codec = createPartitionValueCodec(memoryStore(),{version:2});
  for (const value of [{x:'x'.repeat(4088)},{x:'𐐀'.repeat(1022)},nested(24)]) {
    assert.equal((await codec.encode(value)).kind,'json');
    assert.deepEqual(await codec.materialize({kind:'json',value}),value);
  }
  for (const value of [{x:'x'.repeat(4089)},{x:'𐐀'.repeat(1023)}]) {
    await rejectsEveryEntry({kind:'json',value},error('partition-object-too-large'));
    assert.equal((await codec.encode(value)).kind,'object');
  }
  await rejectsEveryEntry({kind:'json',value:nested(25)},error('partition-input-depth-limit'));
  assert.equal((await codec.encode(nested(25))).kind,'array');
  for (const version of [1,2]) {
    const scalar = {kind:'scalar',value:'x'.repeat(1024)};
    assert.deepEqual(validatePartitionValue(scalar,version),scalar);
    await rejectsEveryEntry({...scalar,value:scalar.value+'x'},error('oversized-partition-scalar'),version);
  }
  const exact = {kind:'unknown',value:''};
  exact.value = 'x'.repeat(65536-Buffer.byteLength(JSON.stringify(exact)));
  assert.equal(Buffer.byteLength(JSON.stringify(exact)),65536);
  await rejectsEveryEntry(exact,error('invalid-partition-value'));
  await rejectsEveryEntry({...exact,value:exact.value+'x'},error('partition-object-too-large'));
  await rejectsEveryEntry({kind:'unknown',value:nested(128)},error('partition-input-depth-limit'));
  await rejectsEveryEntry({kind:'unknown',value:nested(127)},error('invalid-partition-value'));
});

test('hostile descriptors and JSON are rejected before getters execute',async () => {
  let getterCalls = 0;
  const accessor = {}; Object.defineProperty(accessor,'x',{enumerable:true,get() { getterCalls++; return 1; }});
  const hidden = Object.defineProperty({},'hidden',{value:1});
  const sparse = [1,,2], extraArray = Object.assign([1],{extra:2});
  const hiddenArray = Object.defineProperty([1],'hidden',{value:2});
  const cycle = {}; cycle.self = cycle;
  const invalid = [
    [accessor,'non-json-partition-accessor'],[hidden,'non-json-partition-properties'],
    [sparse,'non-json-partition-properties'],[extraArray,'non-json-partition-properties'],[hiddenArray,'non-json-partition-properties'],
    [cycle,'cyclic-partition-input'],[{[Symbol('invented')]:1},'non-json-partition-input'],
    [Object.create(null),'non-json-partition-input'],[Object.create({x:1}),'non-json-partition-input'],
    [vm.runInNewContext('({x:1})'),'non-json-partition-input'],[new Date(0),'non-json-partition-input'],
    [{x:undefined},'non-json-partition-input'],[{x:1n},'non-json-partition-input'],
  ];
  for (const [value,message] of invalid) await rejectsEveryEntry({kind:'json',value},error(message));
  for (const field of ['kind','value']) {
    const ref = {kind:'json',value:{}};
    Object.defineProperty(ref,field,{enumerable:true,get() { getterCalls++; return field === 'kind' ? 'json' : {}; }});
    await rejectsEveryEntry(ref,error('non-json-partition-accessor'));
  }
  for (const value of ['\ud800',{'\udfff':0}]) await rejectsEveryEntry({kind:'json',value},
    {name:'TransactionProtocolError',code:'invalid-unicode',message:'Canonical JSON cannot contain unpaired UTF-16 surrogates.'});
  await rejectsEveryEntry({kind:'json',value:NaN},
    {name:'TransactionProtocolError',code:'invalid-number',message:'Canonical JSON cannot contain non-finite numbers.'});
  assert.equal(getterCalls,0);
});

test('descriptor kinds, fields, hashes, counts and versions retain exact checks',async () => {
  const hash = 'a'.repeat(64);
  const invalid = [
    [null,'invalid-partition-value'],[{kind:'unknown'},'invalid-partition-value'],
    [{kind:'scalar',value:[]},'invalid-partition-scalar'],[{kind:'json'},'invalid-partition-shape'],
    [{kind:'scalar',value:0,extra:1},'invalid-partition-shape'],
    [{kind:'array',root:'bad',count:'0'},'invalid-partition-hash'],
    [{kind:'object',root:hash,count:'01'},'invalid-partition-count'],
    [{kind:'string',root:hash,count:'1',codeUnits:'1025'},'invalid-partition-string'],
    [{kind:'string',root:hash,count:'2',codeUnits:'1024'},'invalid-partition-string'],
  ];
  for (const [ref,message] of invalid) await rejectsEveryEntry(ref,error(message));
  await rejectsEveryEntry({kind:'json',value:{}},error('invalid-partition-value'),1);
  assert.throws(() => validatePartitionValue({kind:'scalar',value:0},3),error('unsupported-partition-value-version'));
});

test('materialization budgets count inline keys, values, string units and paged children exactly',async () => {
  const store = memoryStore(), compact = createPartitionValueCodec(store,{version:2});
  const value = {abc:['de','f']}, ref = await compact.encode(value);
  assert.deepEqual(await compact.materialize(ref,{maxValues:5,maxStringCodeUnits:6}),value);
  await assert.rejects(compact.materialize(ref,{maxValues:4}),budgetError);
  await assert.rejects(compact.materialize(ref,{maxStringCodeUnits:5}),budgetError);
  const paged = createPartitionValueCodec(store), pagedRef = await paged.encode(value);
  assert.deepEqual(await paged.materialize(pagedRef,{maxValues:5,maxStringCodeUnits:6}),value);
  await assert.rejects(paged.materialize(pagedRef,{maxValues:4}),budgetError);
  await assert.rejects(paged.materialize(pagedRef,{maxStringCodeUnits:5}),budgetError);
  const long = await compact.encode('𐐀'.repeat(513));
  assert.equal((await compact.materialize(long,{maxValues:3,maxStringCodeUnits:1026})).length,1026);
  await assert.rejects(compact.materialize(long,{maxValues:2}),budgetError);
  await assert.rejects(compact.materialize(long,{maxStringCodeUnits:1025}),budgetError);
  for (const options of [{maxValues:0},{maxStringCodeUnits:1.5},{maxValues:Infinity}]) {
    await assert.rejects(compact.materialize(ref,options),error('invalid-materialization-budget'));
  }
});

test('inline page and materialize own input, output, aliases and cursors across awaits',async () => {
  const codec = createPartitionValueCodec(memoryStore(),{version:2}), shared = {nested:['invented']};
  const ref = {kind:'json',value:[shared,shared]};
  const materialized = codec.materialize(ref), pendingPage = codec.page(ref,{limit:1});
  shared.nested.push('caller'); ref.value.push('caller');
  const first = await pendingPage, result = await materialized;
  assert.deepEqual(result,[{nested:['invented']},{nested:['invented']}]);
  assert.notEqual(result[0],result[1]); assert.notEqual(result[0].nested,result[1].nested);
  assert.deepEqual(first.entries[0][1].value,{nested:['invented']});
  first.entries[0][1].value.nested.push('output');
  assert.deepEqual(result[0].nested,['invented']); assert.deepEqual(shared.nested,['invented','caller']);
  const clean = {kind:'json',value:[{x:1},{x:2},{x:3}]};
  const page = await codec.page(clean,{limit:1}), cursor = {...page.cursor};
  const pending = codec.page(clean,{limit:1,cursor}); cursor.next = 1000; clean.value[1].x = 99;
  assert.deepEqual((await pending).entries[0][1].value,{x:2});
  assert.equal((await codec.page({kind:'json',value:[{x:1},{x:2},{x:3}]},{limit:1,cursor:page.cursor})).entries[0][1].value.x,2);
});

test('materialization depth budget is retained across paged descriptors',async () => {
  const store = memoryStore(), codec = createPartitionValueCodec(store,{version:2}), tree = createImmutablePageTree(store);
  let ref = {kind:'scalar',value:0};
  for (let depth = 0; depth < 128; depth++) ref = {kind:'array',root:await tree.build([[partitionOrdinal(0),ref]]),count:'1'};
  assert.deepEqual(await codec.materialize(ref,{maxValues:129}),nested(128));
  await assert.rejects(codec.materialize(ref,{maxValues:128}),budgetError);
  ref = {kind:'array',root:await tree.build([[partitionOrdinal(0),ref]]),count:'1'};
  await assert.rejects(codec.materialize(ref,{maxValues:1000}),budgetError);
});

test('paged reads own descriptors before a store await and returned pages cannot change later reads',async () => {
  for (const method of ['page','materialize']) {
    const store = memoryStore(), codec = createPartitionValueCodec(store), value = {invented:[1,2]};
    const ref = await codec.encode(value), original = {...ref};
    let resume, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    store.beforeRead = async () => { entered(); await gate; };
    const pending = codec[method](ref); await started;
    ref.kind = 'scalar'; ref.value = 'changed'; ref.root = '0'.repeat(64); ref.count = '99';
    resume(); const result = await pending; store.beforeRead = null;
    if (method === 'materialize') assert.deepEqual(result,value);
    else {
      result.entries[0][1].key.value = 'changed';
      assert.equal((await codec.page(original)).entries[0][1].key.value,'invented');
    }
    assert.deepEqual(await codec.materialize(original),value);
  }
});

test('nested paged fallback keeps full reads, ordered membership and exact reconstruction',async () => {
  const store = memoryStore(), codec = createPartitionValueCodec(store,{version:2});
  const value = {padding:'invented'.repeat(700),deep:nested(25),rows:Array.from({length:25},(_,i)=>({i,tags:['invented',null]})),
    ...JSON.parse('{"__proto__":{"safe":true}}')};
  const ref = await codec.encode(value); assert.equal(ref.kind,'object');
  assert.deepEqual(await codec.materialize(ref),value);
  const reads = store.reads;
  assert.deepEqual(await codec.materialize(ref),value); assert.ok(store.reads > reads);
  const rootBytes = store.objects.get(ref.root); store.objects.delete(ref.root);
  await assert.rejects(codec.materialize(ref),{message:'missing-invented-object'}); store.objects.set(ref.root,rootBytes);
  const tree = createImmutablePageTree(store), ordinal = partitionOrdinal;
  const malformed = [
    [{kind:'array',root:await tree.build([[ordinal(1),{kind:'scalar',value:1}]]),count:'1'},'partition-value-order-mismatch'],
    [{kind:'array',root:await tree.build([[ordinal(0),{kind:'scalar',value:1}]]),count:'2'},'partition-value-count-mismatch'],
    [{kind:'object',root:await tree.build([[ordinal(0),{key:{kind:'scalar',value:'z'},value:{kind:'scalar',value:0}}],
      [ordinal(1),{key:{kind:'scalar',value:'a'},value:{kind:'scalar',value:0}}]]),count:'2'},'partition-property-order-mismatch'],
    [{kind:'string',root:await tree.build([[ordinal(0),'x'.repeat(1024)],[ordinal(1),'x']]),count:'2',codeUnits:'1026'},'partition-string-length-mismatch'],
  ];
  for (const [bad,message] of malformed) await assert.rejects(codec.materialize(bad),error(message));
});

test('tree children retain compact and scalar checks before page exposure or recursion',async () => {
  const store = memoryStore(), codec = createPartitionValueCodec(store,{version:2}), tree = createImmutablePageTree(store);
  for (const [child,message] of [
    [{kind:'json',value:{x:'x'.repeat(4089)}},'partition-object-too-large'],
    [{kind:'json',value:nested(25)},'partition-input-depth-limit'],
    [{kind:'scalar',value:'x'.repeat(1025)},'oversized-partition-scalar'],
    [{kind:'json',value:[],extra:1},'invalid-partition-shape'],
  ]) {
    const ref = {kind:'array',root:await tree.build([[partitionOrdinal(0),child]]),count:'1'};
    await assert.rejects(codec.page(ref),error(message)); await assert.rejects(codec.materialize(ref),error(message));
  }
});

test('private readers cannot be replaced through the exposed tree object',async () => {
  const store = memoryStore(), codec = createPartitionValueCodec(store,{version:2});
  const ref = await codec.encode({padding:'x'.repeat(5000),child:{invented:[1,2]}});
  const expected = await codec.materialize(ref); let calls = 0;
  assert.equal(Object.isFrozen(codec.tree),true);
  for (const method of ['inspect','verify','page','entries']) {
    assert.throws(() => { codec.tree[method] = () => { calls++; throw Error('public-method-replaced'); }; },TypeError);
  }
  assert.deepEqual(await codec.materialize(ref),expected);
  assert.equal((await codec.page(ref)).entries.length,2); assert.equal(calls,0);
});
