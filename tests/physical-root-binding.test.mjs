import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {PhysicalRootBinding, createPortableLogicalCommit, createPhysicalRootManifest, PORTABLE_COMMIT_FORMAT, PHYSICAL_ROOT_LIMITS} from '../js/physical-root-binding.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const encode = x => enc.encode(canonicalizeJcs(x));
const decode = x => JSON.parse(dec.decode(x));
const hash = x => createHash('sha256').update(x).digest('hex');
const copy = x => structuredClone(x);
const query = (kind, sha256) => ({kind, sha256});
const sort = values => values.sort((a, b) => a.kind + ':' + a.sha256 < b.kind + ':' + b.sha256 ? -1 : 1);
const notFound = () => Object.assign(new Error('invented missing object'), {code:'object-not-found'});
class Adapter {
  files = new Map(); next = 0; writable = true; disconnected = false; prefix; manifest; events = []; hook = null;
  stats = {reads:0, metadata:0, writes:0, maximum:0};
  constructor(prefix = 'invented-source') { this.prefix = prefix; this.folderId = prefix + '-folder'; }
  async allocateFileId() { return this.prefix + '-file-' + String(this.next++).padStart(6, '0'); }
  async readMetadata(fileId, {maxBytes} = {}) { if (this.disconnected) throw new Error('invented disconnected'); assert.ok(maxBytes > 0 && maxBytes <= 16384); this.stats.metadata++; const f = this.files.get(fileId); if (!f) throw notFound(); return f.metadata; }
  async readBytes(fileId, {maxBytes}) { if (this.disconnected) throw new Error('invented disconnected'); assert.ok(maxBytes <= 65536); this.stats.reads++; const f = this.files.get(fileId); if (!f) throw notFound(); assert.ok(f.bytes.length <= maxBytes); return f.bytes; }
  save(fileId, bytes, kind, transactionId) {
    assert.ok(!this.files.has(fileId), 'immutable provider cannot overwrite');
    this.files.set(fileId, {bytes:new Uint8Array(bytes), metadata:{id:fileId, version:'1', size:String(bytes.length), trashed:false, parents:[this.folderId],
      appProperties:{financeTrackerKind:kind === 'data-object' ? 'snapshot-object' : kind, financeTrackerHash:hash(bytes), financeTrackerTransaction:transactionId}}});
    return {fileId, sha256:hash(bytes)};
  }
  async createImmutable({fileId, kind, transactionId, content, expectedSha256, maxBytes, beforeMutation}) {
    assert.ok(content.length <= maxBytes); assert.equal(hash(content), expectedSha256);
    await this.hook?.({point:'before-guard', type:'create', fileId, kind});
    await beforeMutation();
    await this.hook?.({point:'before', type:'create', fileId, kind});
    this.save(fileId, content, kind, transactionId); this.stats.writes++; this.stats.maximum = Math.max(this.stats.maximum, content.length);
    this.events.push({type:'create', fileId, kind, state:this.manifest ? decode(this.manifest).pending?.state ?? 'clean' : 'setup'});
    await this.hook?.({point:'after', type:'create', fileId, kind});
  }
  async readManifest({maxBytes}) { if (this.disconnected) throw new Error('invented disconnected'); assert.equal(maxBytes, PHYSICAL_ROOT_LIMITS.manifestBytes); return this.manifest; }
  async writeManifest(bytes, {beforeMutation}) {
    const next = decode(bytes), state = next.pending?.state ?? 'clean';
    await this.hook?.({point:'before-guard', type:'manifest', state, next});
    await beforeMutation(); await this.hook?.({point:'before', type:'manifest', state, next});
    this.manifest = new Uint8Array(bytes); this.events.push({type:'manifest', state}); this.stats.writes++;
    await this.hook?.({point:'after', type:'manifest', state, next});
  }
  guard = async () => { if (!this.writable) throw Object.assign(new Error('invented ownership lost'), {code:'ownership-lost'}); };
  tree() { const m = decode(this.manifest); return createPagedPhysicalLocators(this, {databaseId:m.databaseId, copyId:m.copyId, folderId:this.folderId, assertWritable:this.guard, maxEntries:4, maxChildren:3}); }
  current() { return decode(this.manifest); }
  json(ref) { return decode(this.files.get(ref.fileId).bytes); }
}
// Complete invented domain: one immutable source and one computed summary per
// revision. The source carries exact decimal units and an append-only parent.
// This verifies all source ancestry and the independent sum, not a trust flag.
async function domain({manifest, commit, baseManifest, phase, readObject, readBaseObject}) {
  const root = decode(await readObject(query('data-object', manifest.root)));
  assert.deepEqual(Object.keys(root).sort(), ['count', 'format', 'source', 'sum']); assert.equal(root.format, 'invented-sum-root');
  let ref = root.source, count = 0n, sum = 0n;
  while (ref !== null) {
    const source = decode(await readObject(query('data-object', ref)));
    assert.deepEqual(Object.keys(source).sort(), ['format', 'previous', 'units']); assert.equal(source.format, 'invented-source');
    assert.match(source.units, /^(0|[1-9][0-9]*)$/); sum += BigInt(source.units); count++; ref = source.previous;
  }
  assert.equal(String(sum), root.sum, 'summary must equal all original sources');
  assert.equal(String(count), root.count, 'summary must include every source');
  assert.equal(root.count, String(BigInt(manifest.revision) + 1n));
  assert.equal(commit.root, manifest.root);
  if (commit.previousRoot != null) {
    const prior = decode(await readObject(query('data-object', commit.previousRoot)));
    const source = decode(await readObject(query('data-object', root.source)));
    assert.equal(source.previous, prior.source, 'historical append preserves the prior committed source');
    assert.equal(commit.operation, 'append-invented-source');
  }
  if (baseManifest) {
    const base = decode(await readBaseObject(query('data-object', baseManifest.root)));
    const source = decode(await readObject(query('data-object', root.source)));
    assert.equal(source.previous, base.source, 'append preserves complete source history');
    assert.equal(commit.operation, 'append-invented-source'); assert.notEqual(phase, 'history');
  }
}
function engine(adapter, options = {}) {
  return new PhysicalRootBinding({adapter, assertWritable:adapter.guard, verificationPlans:new Map([['invented-sum-v1', domain]]),
    locatorOptions:{maxEntries:4, maxChildren:3}, ...options});
}
async function fixture() {
  const adapter = new Adapter();
  const source = encode({format:'invented-source', previous:null, units:'7'});
  const root = encode({format:'invented-sum-root', source:hash(source), count:'1', sum:'7'});
  const logical = createPortableLogicalCommit({databaseId:'invented-db', parent:null, revision:'0', previousRoot:null, root:hash(root),
    transactionId:'invented-genesis', operation:'genesis', semanticVersion:'invented-sum-v1'});
  const c = encode(logical), entries = [];
  for (const [kind, bytes] of [['data-object', source], ['data-object', root], ['commit-record', c]]) {
    const ref = adapter.save(await adapter.allocateFileId(), bytes, kind, 'invented-genesis'); entries.push({kind, identity:ref.sha256, ...ref});
  }
  const tree = createPagedPhysicalLocators(adapter, {databaseId:'invented-db', copyId:'invented-copy', folderId:adapter.folderId, assertWritable:adapter.guard, maxEntries:4, maxChildren:3});
  const locatorRoot = await tree.build(sort(entries));
  adapter.manifest = encode(createPhysicalRootManifest({databaseId:'invented-db', copyId:'invented-copy', folderId:adapter.folderId, revision:'0', root:hash(root),
    headCommit:{format:PORTABLE_COMMIT_FORMAT, version:4, sha256:hash(c)}, locatorRoot}));
  adapter.events = []; adapter.stats = {reads:0, metadata:0, writes:0, maximum:0};
  return {adapter, source, root, logical, engine:engine(adapter)};
}
async function prepared(f, {units = '11', wrongSum = false, transactionId = 'invented-append'} = {}) {
  const base = f.adapter.current(), before = decode(await f.adapter.tree().readObject(base.locatorRoot, query('data-object', base.root)));
  const source = encode({format:'invented-source', previous:before.source, units});
  const root = encode({format:'invented-sum-root', source:hash(source), count:String(BigInt(base.revision) + 2n), sum:wrongSum ? '999' : String(BigInt(before.sum) + BigInt(units))});
  const bodies = new Map([[hash(source), source], [hash(root), root]]);
  const preparationStore = {read:async ({kind, sha256}, {maxBytes}) => { assert.equal(kind, 'data-object'); assert.equal(maxBytes, 65536); if (!bodies.has(sha256)) throw notFound(); return bodies.get(sha256); }};
  const descriptors = sort([...bodies].map(([sha256, raw]) => ({kind:'data-object', identity:sha256, sha256, byteLength:raw.length})));
  const verifiedBase = await f.engine.verifyBaseline();
  const intent = await f.engine.prepare({verifiedBase, root:hash(root), transactionId, operation:'append-invented-source', semanticVersion:'invented-sum-v1', objects:descriptors, preparationStore});
  return {intent, preparationStore, bodies};
}
async function stopAt(f, p, state) {
  f.adapter.hook = e => { if (e.type === 'manifest' && e.point === 'before' && e.state === state) throw new Error('invented interruption'); };
  await assert.rejects(f.engine.transact(p)); f.adapter.hook = null;
}

test('portable logical commits exclude every copy-local field and keep exact typed parents', async () => {
  const f = await fixture(), p = await prepared(f);
  assert.deepEqual(Object.keys(p.intent.logicalCommit).sort(), ['changeEvidenceRoot', 'databaseId', 'format', 'operation', 'parent', 'previousRoot', 'revision', 'root', 'semanticVersion', 'transactionId', 'version']);
  for (const forbidden of ['copyId', 'folderId', 'fileId', 'locatorRoot', 'baseManifestHash']) assert.ok(!Object.hasOwn(p.intent.logicalCommit, forbidden));
  assert.deepEqual(p.intent.logicalCommit.parent, f.adapter.current().headCommit);
  assert.equal(p.intent.logicalHead.sha256, hash(encode(p.intent.logicalCommit)));
});

test('exact clean/admitted/ready/published/clean states and completed retry evidence', async t => {
  const f = await fixture(), p = await prepared(f), base = f.adapter.current();
  assert.ok(f.adapter.events.every(e => e.type === 'create' && e.kind === 'protocol-object' && e.state === 'clean'), 'only inert direct plan pages precede admission');
  const result = await f.engine.transact(p); assert.equal(result.status, 'committed');
  assert.deepEqual(f.adapter.events.filter(e => e.type === 'manifest').map(e => e.state), ['admitted', 'ready', 'published', 'clean']);
  assert.equal(result.manifest.root, p.intent.logicalCommit.root); assert.deepEqual(result.manifest.headCommit, p.intent.logicalHead);
  assert.notDeepEqual(result.manifest.locatorRoot, base.locatorRoot); assert.equal(result.manifest.revision, '1');
  const receipt = f.adapter.json(result.manifest.receiptHead); assert.deepEqual(receipt.baseLocatorRoot, base.locatorRoot); assert.deepEqual(receipt.previousReceiptHead, null);
  const tree = f.adapter.tree(); assert.equal((await tree.verify(result.manifest.locatorRoot)).entryCount, '7');
  assert.equal(await tree.get(result.manifest.locatorRoot, query('protocol-object', result.manifest.receiptHead.sha256)), undefined, 'receipt stays outside its catalog');
  t.diagnostic('one-change synthetic counters ' + JSON.stringify(f.adapter.stats));
  const writes = f.adapter.stats.writes;
  assert.equal((await f.engine.transact(p)).status, 'already-committed'); assert.equal(f.adapter.stats.writes, writes);
  assert.deepEqual(await f.engine.recover(), {status:'idle', manifest:result.manifest});
});

test('wrong computed summary blocks admission, retains staged evidence and never publishes', async () => {
  const f = await fixture(), p = await prepared(f, {wrongSum:true});
  await assert.rejects(f.engine.transact(p), /summary must equal/);
  assert.equal(f.adapter.current().pending, null); assert.equal(f.adapter.current().root, p.intent.baseManifest.root);
});

test('missing preparation leaves exact pending fixed IDs and resumes only with original bytes', async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'ready');
  const page = f.adapter.json(p.intent.planRoot), e = page.entries.find(e => e.kind === 'data-object');
  f.adapter.files.delete(e.fileId); const next = f.adapter.next;
  await assert.rejects(f.engine.recover(), {code:'pending-incomplete'}); assert.equal(f.adapter.current().pending.state, 'admitted'); assert.equal(f.adapter.next, next);
  const result = await f.engine.recover({preparationStore:p.preparationStore}); assert.equal(result.status, 'committed');
  assert.ok(f.adapter.files.has(e.fileId));
});

test('ready state pins exact receipt and candidate, including missing deterministic bodies', async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'published');
  const ready = f.adapter.current(); assert.equal(ready.pending.state, 'ready');
  const e = f.adapter.json(p.intent.planRoot).entries.find(e => e.kind === 'commit-record'); f.adapter.files.delete(e.fileId);
  const writes = f.adapter.stats.writes;
  await assert.rejects(f.engine.recover({preparationStore:p.preparationStore}), {code:'pending-incomplete'});
  assert.equal(f.adapter.stats.writes, writes); assert.deepEqual(f.adapter.current(), ready);
});

test('base locator changes conflict even with identical canonical head/root/revision', async () => {
  const f = await fixture(), p = await prepared(f), m = f.adapter.current();
  const root = f.adapter.json(m.locatorRoot), raw = encode(root), ref = f.adapter.save(await f.adapter.allocateFileId(), raw, 'locator-catalog', 'paged-locators');
  f.adapter.manifest = encode({...m, locatorRoot:ref}); const writes = f.adapter.stats.writes;
  await assert.rejects(f.engine.transact(p), {code:'base-conflict'}); assert.equal(f.adapter.stats.writes, writes);
});

test('lost immutable-create and manifest responses resolve by exact readback', async () => {
  const f = await fixture(), p = await prepared(f); let losses = 0;
  f.adapter.hook = e => { if (e.point === 'after') { losses++; throw undefined; } };
  assert.equal((await f.engine.transact(p)).status, 'committed'); assert.ok(losses > 10);
});

test('ownership loss immediately before a physical mutation preserves pending state', async () => {
  const f = await fixture(), p = await prepared(f); let calls = 0;
  f.adapter.hook = e => { if (e.point === 'before-guard' && ++calls === 3) f.adapter.writable = false; };
  await assert.rejects(f.engine.transact(p), {code:'ownership-lost'});
  assert.equal(f.adapter.current().pending, null);
  f.adapter.hook = null; f.adapter.writable = true; assert.equal((await f.engine.transact(p)).status, 'committed');
});

test('registered verifier is required and boolean proof is rejected', async () => {
  const f = await fixture(); const invalid = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async () => true]])});
  await assert.rejects(invalid.verifyBaseline(), {code:'invalid-verification-result'});
  const unavailable = engine(f.adapter, {verificationPlans:new Map([['other', domain]])}); await assert.rejects(unavailable.verifyBaseline(), {code:'verification-plan-unavailable'});
});

test('verifier reads are typed, scoped, single-flight, drained and sticky on falsy rejection', async () => {
  const f = await fixture(); let saved;
  const scoped = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async ctx => { saved = ctx.readObject; await domain(ctx); }]])});
  await scoped.verifyBaseline(); await assert.rejects(saved(query('data-object', f.adapter.current().root)), {code:'verification-scope-closed'});
  const booleanKind = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async ({readObject, manifest}) => { await readObject(manifest.root).catch(() => {}); }]])});
  await assert.rejects(booleanKind.verifyBaseline(), {code:'invalid-shape'});
  const falsy = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async () => { throw null; }]])});
  let caught = false; try { await falsy.verifyBaseline(); } catch (e) { caught = true; assert.equal(e, null); } assert.ok(caught);
});

for (const reason of [undefined, null, false, 0, '', new Error('invented verification failure')]) {
  const label = reason instanceof Error ? 'Error' : String(reason);
  for (const mode of ['callback', 'caught-read']) test(`${mode} rejection with ${JSON.stringify(label)} stops recovery and revokes read access`, async () => {
    const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'ready');
    const before = f.adapter.current(), readBytes = f.adapter.readBytes.bind(f.adapter); let rejectReads = false, savedRead, hit = false;
    f.adapter.readBytes = (fileId, options) => { if (rejectReads) return Promise.reject(reason); return readBytes(fileId, options); };
    const verifier = async ctx => {
      if (ctx.phase !== 'before-ready') return domain(ctx);
      hit = true; savedRead = ctx.readObject;
      if (mode === 'callback') throw reason;
      rejectReads = true;
      try { await ctx.readObject(query('data-object', ctx.manifest.root)); } catch {}
    };
    const binding = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', verifier]])});
    let rejected = false;
    try { await binding.recover(); } catch (caught) { rejected = true; assert.equal(caught, reason); }
    assert.ok(hit); assert.ok(rejected); assert.deepEqual(f.adapter.current(), before);
    await assert.rejects(savedRead(query('data-object', before.root)), {code:'verification-scope-closed'});
  });
}

test('verification failure after publication preserves pending until a fresh recovery verifies it', async () => {
  const f = await fixture(), p = await prepared(f);
  const verifier = async ctx => { await domain(ctx); if (ctx.phase === 'before-finalization') throw new Error('invented final verification failure'); };
  await assert.rejects(engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', verifier]])}).transact(p), /invented final verification failure/);
  assert.equal(f.adapter.current().pending.state, 'published'); assert.equal(f.adapter.current().revision, '1');
  const result = await engine(f.adapter).recover(); assert.equal(result.manifest.pending, null); assert.equal(result.manifest.revision, '1');
});

test('changing the caller verifier registry cannot replace the registered implementation', async () => {
  const f = await fixture(), plans = new Map([['invented-sum-v1', async () => { throw new Error('invented registered rejection'); }]]);
  const binding = engine(f.adapter, {verificationPlans:plans}); plans.set('invented-sum-v1', async () => {});
  await assert.rejects(binding.verifyBaseline(), /invented registered rejection/); assert.equal(f.adapter.stats.writes, 0);
});

test('forged baseline and wrong-copy physical references cannot authorize a write', async () => {
  const f = await fixture();
  await assert.rejects(f.engine.prepare({verifiedBase:{}, root:hash(f.root), transactionId:'x', operation:'x', semanticVersion:'invented-sum-v1'}), {code:'verified-baseline-required'});
  const m = f.adapter.current(); f.adapter.manifest = encode({...m, copyId:'wrong-copy'});
  await assert.rejects(f.engine.verifyBaseline(), {code:'copy-mismatch'});
});

test('duplicate allocated body IDs are rejected before admission', async () => {
  const f = await fixture(), original = f.adapter.allocateFileId.bind(f.adapter); let repeated;
  f.adapter.allocateFileId = async () => repeated ??= await original();
  f.engine = engine(f.adapter);
  const p = await prepared(f); // Plan page takes same ID, so no body can replace it.
  await assert.rejects(f.engine.transact(p), e => ['physical-id-in-use', 'invalid-plan'].includes(e.code)); assert.equal(f.adapter.current().pending, null);
});

test('completed retry refuses corrupted receipt or retained base evidence', async () => {
  for (const target of ['receipt', 'base']) {
    const f = await fixture(), p = await prepared(f); await f.engine.transact(p);
    const ref = target === 'receipt' ? f.adapter.current().receiptHead : f.adapter.json(p.intent.planRoot).entries.find(e => e.kind === 'protocol-object');
    f.adapter.files.get(ref.fileId).bytes[0] ^= 1;
    await assert.rejects(f.engine.transact(p), {code:'hash-mismatch'});
  }
});

test('cancellation before mutation and during verifier keeps publication stopped', async () => {
  const f = await fixture(), p = await prepared(f), controller = new AbortController(); controller.abort();
  await assert.rejects(f.engine.transact({...p, signal:controller.signal}), {name:'AbortError'}); assert.equal(f.adapter.current().pending, null);
  const controller2 = new AbortController();
  f.engine = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async ctx => { await domain(ctx); if (ctx.phase === 'before-ready') controller2.abort(); }]])});
  await assert.rejects(f.engine.transact({...p, signal:controller2.signal}), {name:'AbortError'}); assert.equal(f.adapter.current().pending.state, 'admitted');
});

test('old typed lineage blocks without a registered version-specific verifier', async () => {
  const f = await fixture(), m = f.adapter.current(); f.adapter.manifest = encode({...m, headCommit:{...m.headCommit, format:'finance-tracker-root-commit', version:3}});
  await assert.rejects(f.engine.verifyBaseline(), {code:'lineage-verifier-unavailable'});
});

test('synthetic byte-preserving rebind uses every new target ID with source unavailable', async () => {
  const f = await fixture(), p = await prepared(f); await f.engine.transact(p); const sourceManifest = f.adapter.current();
  const destination = new Adapter('invented-destination'), entries = []; const copiedLogical = [];
  for await (const e of f.adapter.tree().entries(sourceManifest.locatorRoot)) {
    const raw = new Uint8Array(f.adapter.files.get(e.fileId).bytes);
    const ref = destination.save(await destination.allocateFileId(), raw, e.kind, e.transactionId ?? 'invented-rebind');
    entries.push({...e, ...ref}); if (e.kind === 'commit-record') copiedLogical.push(raw);
    assert.notEqual(ref.fileId, e.fileId);
  }
  const destinationTree = createPagedPhysicalLocators(destination, {databaseId:sourceManifest.databaseId, copyId:'invented-restored-copy', folderId:destination.folderId, assertWritable:destination.guard, maxEntries:4, maxChildren:3});
  const root = await destinationTree.build(sort(entries));
  destination.manifest = encode(createPhysicalRootManifest({databaseId:sourceManifest.databaseId, copyId:'invented-restored-copy', folderId:destination.folderId,
    revision:sourceManifest.revision, root:sourceManifest.root, headCommit:sourceManifest.headCommit, locatorRoot:root}));
  // Historical base evidence still contains source IDs. It is data, never an address.
  const historical = entries.find(e => e.kind === 'protocol-object'); assert.equal(decode(destination.files.get(historical.fileId).bytes).storageBinding.folderId, f.adapter.folderId);
  f.adapter.files.clear(); f.adapter.readBytes = () => { throw new Error('source unavailable'); };
  await engine(destination).verifyBaseline();
  assert.deepEqual(destination.current().headCommit, sourceManifest.headCommit); assert.equal(destination.current().root, sourceManifest.root);
  assert.equal(copiedLogical.length, 2); assert.deepEqual(new Set(copiedLogical.map(hash)), new Set([sourceManifest.headCommit.sha256, p.intent.baseManifest.headCommit.sha256]));
});

for (const point of ['before', 'after']) test(`interrupt ${point} every transaction durable write and recover exact admitted IDs`, async t => {
  const reference = await fixture(), plan = await prepared(reference); reference.adapter.events = [];
  await reference.engine.transact(plan); const durableWrites = reference.adapter.events.length;
  assert.ok(durableWrites >= 10); t.diagnostic(point + ' fault cases: ' + durableWrites);
  for (let target = 1; target <= durableWrites; target++) {
    const f = await fixture(), p = await prepared(f); let at = 0, hit = false;
    f.adapter.hook = e => {
      if (e.point === point && ++at === target) { hit = true; f.adapter.disconnected = true; throw new Error('invented process interruption'); }
    };
    await assert.rejects(f.engine.transact(p)); assert.ok(hit, `${point} write ${target} reached`);
    f.adapter.hook = null; f.adapter.disconnected = false; f.engine = engine(f.adapter);
    const result = await f.engine.transact(p);
    assert.ok(['committed', 'already-committed'].includes(result.status));
    assert.equal(result.manifest.root, p.intent.logicalCommit.root); assert.equal(result.manifest.pending, null);
    for (const e of f.adapter.json(p.intent.planRoot).entries) assert.ok(f.adapter.files.has(e.fileId));
  }
});

for (const mode of ['omission', 'unauthorized-addition', 'replacement', 'corruption']) test(`ready candidate ${mode} cannot publish`, async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'published'); const ready = f.adapter.current();
  if (mode === 'corruption') {
    f.adapter.files.get(ready.pending.locatorRoot.fileId).bytes[0] ^= 1;
  } else {
    let replacement;
    if (mode === 'omission') replacement = p.intent.baseManifest.locatorRoot;
    else {
      const tree = f.adapter.tree(), raw = encode({inventedExtra:'unadmitted'}), ref = f.adapter.save(await f.adapter.allocateFileId(), raw, 'data-object', p.intent.transactionId);
      const extra = {kind:'data-object', identity:ref.sha256, ...ref};
      if (mode === 'unauthorized-addition') replacement = await tree.set(ready.pending.locatorRoot, extra);
      else {
        const entries = []; for await (const e of tree.entries(ready.pending.locatorRoot)) entries.push(e);
        entries.splice(entries.findIndex(e => e.sha256 === p.intent.baseManifest.root), 1, extra);
        replacement = await tree.build(sort(entries));
      }
    }
    const receipt = f.adapter.json(ready.pending.receipt); receipt.locatorRoot = replacement;
    const pointer = f.adapter.save(await f.adapter.allocateFileId(), encode(receipt), 'protocol-object', p.intent.transactionId);
    f.adapter.manifest = encode({...ready, pending:{...ready.pending, locatorRoot:replacement, receipt:pointer}});
  }
  await assert.rejects(f.engine.recover(), e => ['candidate-mismatch', 'hash-mismatch'].includes(e.code));
  assert.equal(f.adapter.current().pending.state, 'ready');
});

test('restart reads only the clean manifest and never searches for or adopts orphan plans', async () => {
  const f = await fixture(); f.adapter.hook = e => { if (e.type === 'create' && e.point === 'after') { f.adapter.disconnected = true; throw new Error('invented preparation crash'); } };
  await assert.rejects(prepared(f)); f.adapter.hook = null; f.adapter.disconnected = false;
  assert.equal(f.adapter.current().pending, null); const before = f.adapter.current(), writes = f.adapter.stats.writes, files = f.adapter.files.size;
  for (const method of ['readBytes', 'readMetadata', 'allocateFileId', 'listFiles', 'findFiles']) f.adapter[method] = () => assert.fail('idle recovery must not inspect or adopt orphan evidence');
  assert.deepEqual(await engine(f.adapter).recover(), {status:'idle', manifest:before});
  assert.equal(f.adapter.stats.writes, writes); assert.equal(f.adapter.files.size, files);
  assert.ok(f.adapter.events.some(e => e.kind === 'protocol-object' && e.state === 'clean'));
});

test('physical metadata/media/metadata brackets detect version changes', async () => {
  const f = await fixture(), p = await prepared(f), original = f.adapter.readBytes.bind(f.adapter); let changed = false;
  f.adapter.readBytes = async (fileId, options) => {
    const bytes = await original(fileId, options);
    if (!changed && fileId === p.intent.planRoot.fileId) { changed = true; f.adapter.files.get(fileId).metadata.version = '2'; }
    return bytes;
  };
  f.engine = engine(f.adapter); await assert.rejects(f.engine.transact(p), {code:'version-mismatch'});
  assert.equal(f.adapter.current().pending, null);
});

test('candidate node mutations obey exact manifest guards, even after same-root locator replacement', async () => {
  const f = await fixture(), p = await prepared(f); let hit = false;
  f.adapter.hook = e => {
    if (!hit && e.type === 'create' && e.point === 'before-guard' && e.kind === 'locator-catalog-page') {
      hit = true; const m = f.adapter.current(); m.locatorRoot.fileId = 'invented-external-change'; f.adapter.manifest = encode(m);
    }
  };
  await assert.rejects(f.engine.transact(p), e => e.code === 'guard-scope' || e.code === 'write-unresolved' || e.code === 'base-conflict'); assert.ok(hit);
  assert.equal(f.adapter.current().pending, null);
});

test('verifier unfinished and overlapping reads drain before returning or publishing', async () => {
  for (const mode of ['unfinished', 'overlapping', 'swallowed-falsy']) {
    const f = await fixture(); let settled = false, release, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    const original = f.adapter.readBytes.bind(f.adapter);
    f.adapter.readBytes = async (fileId, options) => {
      if (held) { await gate; settled = true; if (mode === 'swallowed-falsy') throw false; }
      return original(fileId, options);
    };
    const fn = async ({readObject, manifest}) => {
      held = true; const first = readObject(query('data-object', manifest.root)); first.catch(() => {});
      if (mode === 'overlapping') await readObject(query('data-object', manifest.root)).catch(() => {});
      setTimeout(release, 2);
      if (mode === 'swallowed-falsy') await first.catch(() => {});
    };
    const binding = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', fn]])});
    let caught = false;
    try { await binding.verifyBaseline(); } catch (e) { caught = true; if (mode === 'swallowed-falsy') assert.equal(e, false); else assert.equal(e.code, mode === 'unfinished' ? 'unfinished-verification-read' : 'verification-read-limit'); }
    assert.ok(caught); assert.ok(settled); assert.equal(f.adapter.current().pending, null);
  }
});

test('late mutation guards cannot authorize continuing publication', async () => {
  const f = await fixture(), p = await prepared(f), original = f.adapter.createImmutable.bind(f.adapter); let escaped;
  f.adapter.createImmutable = async options => { escaped = options.beforeMutation; return original(options); };
  f.engine = engine(f.adapter); await f.engine.transact(p);
  await assert.rejects(escaped(), e => e.code === 'guard-scope');
});

test('post-create cancellation reports an unresolved exact physical ID and keeps pending', async () => {
  const f = await fixture(), p = await prepared(f), controller = new AbortController();
  f.adapter.hook = e => { if (e.type === 'create' && e.point === 'after') controller.abort(); };
  await assert.rejects(f.engine.transact({...p, signal:controller.signal}), e => e.code === 'write-unresolved' && Boolean(e.details.reference?.fileId));
  assert.equal(f.adapter.current().pending, null); f.adapter.hook = null;
  assert.equal((await f.engine.transact(p)).status, 'committed');
});

test('two changes retain exact receipt ancestry and baseline rejects earlier evidence loss', async () => {
  const f = await fixture(), first = await prepared(f); await f.engine.transact(first); const m1 = f.adapter.current();
  const second = await prepared(f, {units:'5', transactionId:'invented-second'}); await f.engine.transact(second);
  const m2 = f.adapter.current(); assert.equal(m2.revision, '2'); assert.deepEqual(f.adapter.json(m2.receiptHead).previousReceiptHead, m1.receiptHead);
  await f.engine.verifyBaseline(); f.adapter.files.delete(m1.receiptHead.fileId);
  await assert.rejects(f.engine.verifyBaseline(), {code:'object-not-found'});
});

test('plan pages stream beyond one page with bounded bodies and exact counters', async () => {
  const f = await fixture(), base = f.adapter.current(), verifiedBase = await f.engine.verifyBaseline();
  const bodies = [];
  for (let i = 0; i < 67; i++) { const raw = encode({inventedAuxiliary:i}); bodies.push({kind:'data-object', identity:hash(raw), sha256:hash(raw), byteLength:raw.length, raw}); }
  const prep = {read:async q => bodies.find(x => x.sha256 === q.sha256).raw}; let emitted = 0;
  const objects = (async function* () { for (const {raw, ...d} of sort(bodies)) {
    if (emitted === PHYSICAL_ROOT_LIMITS.planEntries) assert.ok(f.adapter.events.some(e => e.kind === 'protocol-object'), 'flush a durable plan page before requesting the remaining descriptors');
    emitted++; yield d;
  } })();
  const value = await f.engine.prepare({verifiedBase, root:base.root, transactionId:'invented-many-plan', operation:'append-invented-source', semanticVersion:'invented-sum-v1', objects, preparationStore:prep});
  assert.equal(emitted, 67); assert.equal(value.objectCount, '69');
  let pointer = value.planRoot, remaining = 69n, pages = 0;
  while (pointer) { const page = f.adapter.json(pointer); pages++; assert.ok(page.entries.length <= 32); assert.equal(BigInt(page.beforeCount) + BigInt(page.entries.length), remaining); remaining = BigInt(page.beforeCount); pointer = page.previous; }
  assert.equal(remaining, 0n); assert.equal(pages, 3); assert.ok(f.adapter.stats.maximum <= PHYSICAL_ROOT_LIMITS.objectBytes); assert.equal(f.adapter.current().pending, null);
});

for (const state of ['ready', 'published']) test(`${state} recovery never allocates a replacement candidate or receipt`, async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, state === 'ready' ? 'published' : 'clean');
  const before = f.adapter.current(), next = f.adapter.next, pending = copy(before.pending);
  assert.equal(pending.state, state); f.adapter.allocateFileId = () => { throw new Error('must use exact ready evidence'); }; f.engine = engine(f.adapter);
  const result = await f.engine.recover(); assert.equal(result.status, 'committed'); assert.equal(f.adapter.next, next);
  assert.deepEqual(result.manifest.locatorRoot, pending.locatorRoot); assert.deepEqual(result.manifest.receiptHead, pending.receipt);
});

test('caller edits to admitted intent and callback snapshots cannot change queued publication', async () => {
  const f = await fixture(), p = await prepared(f), original = copy(p.intent);
  f.engine = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async ctx => { await domain(ctx); ctx.manifest.root = '0'.repeat(64); ctx.commit.root = '0'.repeat(64); if (ctx.baseManifest) ctx.baseManifest.copyId = 'caller-edit'; }]])});
  const pending = f.engine.transact(p); p.intent.logicalCommit.root = '0'.repeat(64); p.intent.planRoot.fileId = 'caller-edit';
  const result = await pending; assert.equal(result.manifest.root, original.logicalCommit.root); assert.deepEqual(result.manifest.headCommit, original.logicalHead);
});

test('shared preparation bytes are rejected before admission or proposed body writes', async () => {
  const f = await fixture(), verifiedBase = await f.engine.verifyBaseline();
  const raw = encode({invented:'shared'}), shared = new Uint8Array(new SharedArrayBuffer(raw.length)); shared.set(raw);
  const sha256 = hash(raw), objects = [{kind:'data-object', identity:sha256, sha256, byteLength:raw.length}];
  await assert.rejects(f.engine.prepare({verifiedBase, root:sha256, transactionId:'invented-shared', operation:'append-invented-source', semanticVersion:'invented-sum-v1', objects,
    preparationStore:{read:async () => shared}}), {code:'invalid-bytes'});
  assert.equal(f.adapter.current().pending, null); assert.equal(f.adapter.events.length, 0);
});

test('cross-realm shared buffers cannot cross manifest or preparation byte boundaries', async () => {
  const shared = new Uint8Array(runInNewContext('new SharedArrayBuffer(8)'));
  Object.defineProperty(shared, 'buffer', {value:new ArrayBuffer(8)});
  const f = await fixture(); f.adapter.readManifest = async () => shared;
  await assert.rejects(engine(f.adapter).recover(), {code:'invalid-bytes'});
  const g = await fixture(), p = await prepared(g), before = g.adapter.current(), events = g.adapter.events.length;
  await assert.rejects(g.engine.transact({...p, preparationStore:{read:async () => shared}}), {code:'invalid-bytes'});
  assert.deepEqual(g.adapter.current(), before);
  assert.ok(g.adapter.events.slice(events).every(e => e.type === 'create' && e.kind !== 'data-object' && e.state === 'clean'), 'only inert generated evidence may precede an invalid body');
});

test('cross-realm ordinary buffers remain usable through ordinary Uint8Array views', async () => {
  const f = await fixture(), p = await prepared(f);
  const foreign = bytes => { const result = new Uint8Array(runInNewContext(`new ArrayBuffer(${bytes.length})`)); result.set(bytes); return result; };
  f.adapter.manifest = foreign(f.adapter.manifest);
  const read = f.adapter.readBytes.bind(f.adapter); f.adapter.readBytes = async (fileId, options) => foreign(await read(fileId, options));
  assert.equal((await engine(f.adapter).transact(p)).status, 'committed');
});

test('decorated oversized manifests and preparation bodies cannot bypass intrinsic byte bounds', async () => {
  for (const boundary of ['manifest', 'preparation']) {
    const f = await fixture(), p = await prepared(f), maximum = boundary === 'manifest' ? PHYSICAL_ROOT_LIMITS.manifestBytes : PHYSICAL_ROOT_LIMITS.objectBytes;
    const raw = new Uint8Array(maximum + 1);
    Object.defineProperties(raw, {length:{value:1}, byteLength:{value:1}, buffer:{value:new ArrayBuffer(1)}, slice:{value:() => f.adapter.manifest}});
    if (boundary === 'manifest') f.adapter.readManifest = async () => raw;
    const events = f.adapter.events.length;
    await assert.rejects(boundary === 'manifest' ? engine(f.adapter).recover() : f.engine.transact({...p, preparationStore:{read:async () => raw}}), {code:'byte-limit'});
    assert.ok(f.adapter.events.slice(events).every(e => e.type === 'create' && e.kind !== 'data-object' && e.state === 'clean'));
    assert.equal(f.adapter.current().pending, null);
  }
});

test('Buffer-backed direct reads and preparation bodies are copied before digest awaits', async () => {
  const f = await fixture(), p = await prepared(f), read = f.adapter.readBytes.bind(f.adapter), borrowed = new Set();
  const borrow = bytes => { const buffer = Buffer.from(bytes); borrowed.add(buffer); return buffer; };
  f.adapter.readBytes = async (fileId, options) => borrow(await read(fileId, options));
  const preparationStore = {read:async (query, options) => borrow(await p.preparationStore.read(query, options))};
  const originalCrypto = globalThis.crypto; let mutations = 0;
  Object.defineProperty(globalThis, 'crypto', {configurable:true, value:{subtle:{digest:async (algorithm, bytes) => {
    for (const buffer of borrowed) { buffer.fill(0); mutations++; } borrowed.clear();
    return webcrypto.subtle.digest(algorithm, bytes);
  }}}});
  try { assert.equal((await engine(f.adapter).transact({...p, preparationStore})).status, 'committed'); }
  finally { Object.defineProperty(globalThis, 'crypto', {configurable:true, value:originalCrypto}); }
  assert.ok(mutations > 0);
});

test('strict manifest decoding rejects alternate JSON, unknown fields and future versions', async () => {
  for (const [mutate, code] of [
    [m => enc.encode(JSON.stringify(m, null, 2)), 'noncanonical-json'],
    [m => encode({...m, extra:true}), 'invalid-shape'],
    [m => encode({...m, version:99}), 'unsupported-manifest']
  ]) {
    const f = await fixture(); f.adapter.manifest = mutate(f.adapter.current());
    await assert.rejects(engine(f.adapter).recover(), {code}); assert.equal(f.adapter.stats.writes, 0);
  }
});

for (const field of ['root', 'headCommit', 'revision', 'databaseId', 'copyId', 'role']) test(`recovery rejects pending manifest ${field} substitution`, async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'ready');
  const m = f.adapter.current();
  m[field] = field === 'root' ? '0'.repeat(64) : field === 'headCommit' ? {...m.headCommit, sha256:'0'.repeat(64)} : field === 'revision' ? '9' : field === 'role' ? 'backup' : 'invented-substitution';
  f.adapter.manifest = encode(m); const writes = f.adapter.stats.writes;
  await assert.rejects(engine(f.adapter).recover(), {code:'pending-mismatch'});
  assert.deepEqual(f.adapter.current(), m); assert.equal(f.adapter.stats.writes, writes);
});

test('unknown metadata read failures never authorize a replacement immutable create', async () => {
  const f = await fixture(), p = await prepared(f), read = f.adapter.readMetadata.bind(f.adapter), writes = f.adapter.stats.writes;
  const entry = f.adapter.json(p.intent.planRoot).entries.find(e => e.kind === 'data-object');
  f.adapter.readMetadata = (fileId, options) => fileId === entry.fileId ? Promise.reject(new Error('invented permission failure')) : read(fileId, options);
  await assert.rejects(engine(f.adapter).transact(p), /invented permission failure/);
  assert.equal(f.adapter.stats.writes, writes); assert.equal(f.adapter.current().pending, null); assert.equal(f.adapter.files.has(entry.fileId), false);
});

for (const type of ['create', 'manifest']) test(`adapter that bypasses its ${type} guard cannot report successful publication`, async () => {
  const f = await fixture(), p = await prepared(f); let attempted, mutations = 0;
  if (type === 'create') f.adapter.createImmutable = async ({fileId, content, kind, transactionId}) => {
    attempted = fileId; mutations++; f.adapter.save(fileId, content, kind, transactionId);
  };
  else f.adapter.writeManifest = async bytes => { mutations++; f.adapter.manifest = new Uint8Array(bytes); };
  await assert.rejects(engine(f.adapter).transact(p), {code:'adapter-contract'}); assert.ok(mutations >= 1 && mutations <= (type === 'create' ? 4 : 1));
  assert.equal(f.adapter.current().root, p.intent.baseManifest.root);
  if (type === 'create') { assert.ok(f.adapter.files.has(attempted)); assert.equal(f.adapter.current().pending, null); }
  else assert.equal(f.adapter.current().pending.state, 'admitted');
});

test('changing supplied preparation bytes fails fixed-ID hash validation and keeps admission', async () => {
  const f = await fixture(), p = await prepared(f); for (const raw of p.bodies.values()) raw[0] ^= 1;
  await assert.rejects(f.engine.transact(p), {code:'hash-mismatch'}); assert.equal(f.adapter.current().pending, null);
});

test('malformed plan count and wrong-copy plan binding are rejected before admission', async () => {
  for (const field of ['beforeCount', 'copyId']) {
    const f = await fixture(), p = await prepared(f), page = f.adapter.json(p.intent.planRoot);
    page[field] = field === 'beforeCount' ? '1' : 'invented-other-copy';
    p.intent.planRoot = f.adapter.save(await f.adapter.allocateFileId(), encode(page), 'protocol-object', p.intent.transactionId);
    await assert.rejects(f.engine.transact(p), {code:'invalid-plan'}); assert.equal(f.adapter.current().pending, null);
  }
});

test('individually sorted plan pages cannot reorder descriptors across their boundary', async () => {
  const f = await fixture(), base = f.adapter.current(), verifiedBase = await f.engine.verifyBaseline(), bodies = new Map();
  for (let i = 0; i < PHYSICAL_ROOT_LIMITS.planEntries + 2; i++) {
    const raw = encode({inventedBoundaryObject:i}); bodies.set(hash(raw), raw);
  }
  const objects = sort([...bodies].map(([sha256, raw]) => ({kind:'data-object', identity:sha256, sha256, byteLength:raw.length})));
  const preparationStore = {read:async q => bodies.get(q.sha256)};
  const intent = await f.engine.prepare({verifiedBase, root:base.root, transactionId:'invented-cross-page', operation:'append-invented-source', semanticVersion:'invented-sum-v1', objects, preparationStore});
  const later = f.adapter.json(intent.planRoot), earlier = f.adapter.json(later.previous);
  // Swap unique adjacent descriptors so each page remains sorted and every
  // descriptor is retained, but the earlier page now ends after the later starts.
  [earlier.entries[earlier.entries.length - 1], later.entries[0]] = [later.entries[0], earlier.entries.at(-1)];
  for (const page of [earlier, later]) assert.deepEqual(page.entries, sort([...page.entries]));
  later.previous = f.adapter.save(await f.adapter.allocateFileId(), encode(earlier), 'protocol-object', intent.transactionId);
  intent.planRoot = f.adapter.save(await f.adapter.allocateFileId(), encode(later), 'protocol-object', intent.transactionId);
  const writes = f.adapter.stats.writes;
  await assert.rejects(f.engine.transact({intent, preparationStore}), {code:'invalid-plan'});
  assert.deepEqual(f.adapter.current(), base); assert.equal(f.adapter.stats.writes, writes);
});

test('missing original direct plan never falls back to a catalog or folder search', async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'ready');
  const originalPlan = f.adapter.files.get(p.intent.planRoot.fileId);
  const orphan = f.adapter.save(await f.adapter.allocateFileId(), originalPlan.bytes, 'protocol-object', p.intent.transactionId);
  f.adapter.files.delete(p.intent.planRoot.fileId); const before = f.adapter.current(), next = f.adapter.next;
  for (const method of ['listFiles', 'findFiles']) f.adapter[method] = () => assert.fail('recovery must use the admitted physical ID');
  await assert.rejects(engine(f.adapter).recover({preparationStore:p.preparationStore}), {code:'object-not-found'});
  assert.deepEqual(f.adapter.current(), before); assert.equal(f.adapter.next, next);
  assert.ok(f.adapter.files.has(orphan.fileId), 'identical orphan bytes are preserved but never adopted');
});

test('a registered historical verifier can retain exact old bytes without reinterpretation', async () => {
  const f = await fixture(), old = f.adapter.current();
  // Deliberately different invented old schema, not a fake implementation of v2/v3.
  const raw = encode({format:'invented-legacy-commit', version:1, originalRoot:old.root, exactRevision:'0', logicalDatabase:'invented-db'});
  const entry = {kind:'commit-record', identity:hash(raw), ...f.adapter.save(await f.adapter.allocateFileId(), raw, 'commit-record', 'invented-legacy')};
  const entries = []; for await (const e of f.adapter.tree().entries(old.locatorRoot)) if (e.kind !== 'commit-record') entries.push(e);
  entries.push(entry); const locatorRoot = await f.adapter.tree().build(sort(entries));
  f.adapter.manifest = encode({...old, locatorRoot, headCommit:{format:'invented-legacy-commit', version:1, sha256:hash(raw)}});
  let checked = 0;
  const lineageVerifiers = new Map([['invented-legacy-commit:1', async ({bytes, reference, readObject}) => {
    assert.deepEqual(bytes, raw); assert.equal(reference.sha256, hash(raw)); const original = decode(bytes);
    const fakeCommit = {root:original.originalRoot}; await domain({manifest:{...old, root:original.originalRoot}, commit:fakeCommit, readObject}); checked++;
    return {databaseId:original.logicalDatabase, revision:original.exactRevision, root:original.originalRoot, parent:null, previousRoot:null};
  }]]);
  f.engine = engine(f.adapter, {lineageVerifiers}); const p = await prepared(f); await f.engine.transact(p); assert.ok(checked > 0);
  assert.deepEqual(await f.adapter.tree().readObject(f.adapter.current().locatorRoot, query('commit-record', hash(raw))), raw);
});

test('original adapter destination changes are refused before any provider write', async () => {
  const f = await fixture(), verifiedBase = await f.engine.verifyBaseline(), base = f.adapter.current(), writes = f.adapter.stats.writes;
  f.adapter.folderId = 'invented-wrong-destination';
  await assert.rejects(f.engine.prepare({verifiedBase, root:base.root, transactionId:'invented-scope', operation:'append-invented-source', semanticVersion:'invented-sum-v1',
    objects:[], preparationStore:{read:async () => { throw new Error('unused'); }}}), {code:'copy-mismatch'});
  assert.equal(f.adapter.stats.writes, writes);
});

test('ready recovery refuses corruption in base secondary pages no longer shared by candidate', async () => {
  const f = await fixture(), p = await prepared(f); await stopAt(f, p, 'published');
  const base = f.adapter.json(p.intent.baseManifest.locatorRoot); f.adapter.files.get(base.identities.fileId).bytes[0] ^= 1;
  await assert.rejects(f.engine.recover(), {code:'hash-mismatch'}); assert.equal(f.adapter.current().pending.state, 'ready');
});

for (const missing of ['receipt', 'plan']) for (const phase of ['ready', 'completed']) test(`${phase} verification refuses missing earlier ${missing} evidence`, async () => {
  const f = await fixture(), first = await prepared(f); await f.engine.transact(first); const m1 = f.adapter.current();
  const second = await prepared(f, {units:'5', transactionId:'invented-second'});
  if (phase === 'ready') await stopAt(f, second, 'published'); else await f.engine.transact(second);
  f.adapter.files.delete(missing === 'receipt' ? m1.receiptHead.fileId : first.intent.planRoot.fileId);
  await assert.rejects(phase === 'ready' ? f.engine.recover() : f.engine.transact(second), {code:'object-not-found'});
  if (phase === 'ready') assert.equal(f.adapter.current().pending.state, 'ready');
});

for (const invalid of ['duplicate-file', 'duplicate-identity', 'missing-commit', 'missing-base', 'wrong-length']) test(`pre-admission preflight rejects ${invalid} using per-transaction descriptor identity sets`, async () => {
  const f = await fixture(), p = await prepared(f), page = f.adapter.json(p.intent.planRoot);
  if (invalid === 'duplicate-file') page.entries[1].fileId = page.entries[0].fileId;
  else if (invalid === 'duplicate-identity') {
    for (const e of page.entries.filter(e => e.kind === 'data-object')) { e.kind = 'migration-record'; e.identity = 'invented-duplicate'; }
    page.entries = sort(page.entries);
  } else if (invalid === 'wrong-length') page.entries.find(e => e.kind === 'commit-record').byteLength++;
  else {
    const index = page.entries.findIndex(e => e.kind === (invalid === 'missing-commit' ? 'commit-record' : 'protocol-object'));
    page.entries.splice(index, 1); p.intent.objectCount = String(BigInt(p.intent.objectCount) - 1n);
  }
  p.intent.planRoot = f.adapter.save(await f.adapter.allocateFileId(), encode(page), 'protocol-object', p.intent.transactionId);
  await assert.rejects(f.engine.transact(p), {code:'invalid-plan'}); assert.equal(f.adapter.current().pending, null);
});

for (const method of ['map', 'join']) test(`inherited array ${method} cannot replace inspected physical metadata`, async () => {
  const f = await fixture(), p = await prepared(f), metadata = f.adapter.files.get(p.intent.planRoot.fileId).metadata;
  metadata.parents = ['invented-wrong-folder']; const proto = Object.create(Array.prototype); let called = false;
  proto[method] = () => { called = true; return method === 'map' ? [JSON.stringify(f.adapter.folderId)] : JSON.stringify(f.adapter.folderId); };
  Object.setPrototypeOf(metadata.parents, proto);
  await assert.rejects(f.engine.transact(p), {code:'metadata-mismatch'}); assert.equal(called, false); assert.equal(f.adapter.current().pending, null);
});

for (const type of ['create', 'manifest']) test(`failed guard after a possible ${type} reports unresolved evidence`, async () => {
  const f = await fixture(), p = await prepared(f), original = f.adapter[type === 'create' ? 'createImmutable' : 'writeManifest'].bind(f.adapter); let attempted;
  if (type === 'create') f.adapter.createImmutable = async options => { await original(options); attempted = options.fileId; f.adapter.writable = false; await options.beforeMutation(); };
  else f.adapter.writeManifest = async (bytes, options) => { await original(bytes, options); f.adapter.writable = false; await options.beforeMutation(); };
  f.engine = engine(f.adapter);
  await assert.rejects(f.engine.transact(p), e => e.code === 'write-unresolved' && (type === 'create' ? e.details.reference.fileId === attempted : /^[0-9a-f]{64}$/.test(e.details.intendedManifestHash)));
  if (type === 'create') { assert.ok(f.adapter.files.has(attempted)); assert.equal(f.adapter.current().pending,null); } else assert.equal(f.adapter.current().pending.state,'admitted');
});

test('fresh-copy bootstrap checks historical append transitions without local receipts', async () => {
  const f = await fixture(), p = await prepared(f); await f.engine.transact(p); const m = f.adapter.current();
  const unrelated = encode({format:'invented-source', previous:null, units:'2'}), source = encode({format:'invented-source', previous:hash(unrelated), units:'4'});
  const root = encode({format:'invented-sum-root', source:hash(source), count:'2', sum:'6'});
  const logical = {...p.intent.logicalCommit, root:hash(root)}, head = encode(logical), entries = [];
  for await (const e of f.adapter.tree().entries(m.locatorRoot)) if (e.sha256 !== m.headCommit.sha256) entries.push(e);
  for (const [kind, bytes] of [['data-object', unrelated], ['data-object', source], ['data-object', root], ['commit-record', head]]) {
    const ref = f.adapter.save(await f.adapter.allocateFileId(), bytes, kind, 'invented-forged-history'); entries.push({kind, identity:ref.sha256, ...ref});
  }
  const locatorRoot = await f.adapter.tree().build(sort(entries));
  f.adapter.manifest = encode({...m, root:hash(root), headCommit:{format:PORTABLE_COMMIT_FORMAT, version:4, sha256:hash(head)}, locatorRoot, receiptHead:null});
  await assert.rejects(f.engine.verifyBaseline(), /historical append preserves/);
});

test('receipt-edge verification does not recursively replay semantic history prefixes', async () => {
  const f = await fixture(); let historicalCalls = 0;
  f.engine = engine(f.adapter, {verificationPlans:new Map([['invented-sum-v1', async ctx => { if (ctx.phase === 'history') historicalCalls++; await domain(ctx); }]])});
  for (let revision = 1; revision <= 3; revision++) {
    const p = await prepared(f, {units:'2', transactionId:'invented-depth-' + revision}); historicalCalls = 0;
    await f.engine.transact(p);
    // One clean-base lineage and one complete candidate lineage per publication
    // phase. Physical receipt edges retain all mapping and body checks separately.
    assert.equal(historicalCalls, revision + 4 * (revision + 1));
  }
});

test('read-only copy audit verifies all history but grants no writable baseline',async()=>{
 const f=await fixture();f.adapter.manifest=encode({...f.adapter.current(),role:'backup'});
 assert.equal((await f.engine.verifyCopy()).role,'backup');
 await assert.rejects(f.engine.verifyBaseline(),{code:'read-only-copy'});
});

test('authenticated source evidence is optional for old manifests and requires its scoped verifier when present',async()=>{
 const f=await fixture(),m=f.adapter.current();f.adapter.manifest=encode({...m,sourceEvidence:{version:1,sha256:m.root}});
 await assert.rejects(f.engine.verifyCopy(),{code:'source-evidence-verifier-required'});let checked=0;
 const audited=engine(f.adapter,{verifySourceEvidence:async({evidenceRoot,readObject})=>{assert.equal(evidenceRoot,m.root);assert.equal(hash(await readObject({kind:'data-object',sha256:evidenceRoot})),m.root);checked++;}});
 assert.equal((await audited.verifyCopy()).sourceEvidence.sha256,m.root);assert.equal(checked,1);
 await assert.rejects(engine(f.adapter,{verifySourceEvidence:async()=>true}).verifyCopy(),{code:'invalid-verification-result'});
});

for(const phase of ['allocation','staging','pointer'])test(`changed base during ${phase} permits only unreachable immutable evidence, never publication`,async()=>{
 const f=await fixture(),base=f.adapter.current();let changed=false;
 const change=()=>{changed=true;f.adapter.manifest=encode({...base,copyId:'invented-external-copy'});};
 if(phase==='allocation') {
  const allocate=f.adapter.allocateFileId.bind(f.adapter);f.adapter.allocateFileId=async()=>{const id=await allocate();if(!changed)change();return id;};f.engine=engine(f.adapter);
  await assert.rejects(prepared(f),{code:'base-conflict'});
 }else {
  const p=await prepared(f);f.adapter.events=[];
  f.adapter.hook=e=>{if(!changed&&((phase==='staging'&&e.type==='create'&&e.point==='after')||(phase==='pointer'&&e.type==='manifest'&&e.point==='before-guard')))change();};
  await assert.rejects(f.engine.transact(p),{code:'base-conflict'});
 }
 assert.ok(changed);assert.equal(f.adapter.current().copyId,'invented-external-copy');assert.equal(f.adapter.current().pending,null);
 assert.ok(f.adapter.events.some(e=>e.type==='create'));assert.equal(f.adapter.events.some(e=>e.type==='manifest'),false);
});

test('retained receipt staging ignores unregistered scalar verifier callbacks',async()=>{
 const f=await fixture(),p=await prepared(f);await f.engine.transact(p);
 let injected=0;f.adapter.verifyImmutableObject=async()=>{injected++;return {byteLength:1};};
 const reopened=engine(f.adapter);await reopened.verifyBaseline();
 assert.equal(injected,0,'unregistered adapter retains actual-byte verification');
 const body=[...f.adapter.files.values()].find(x=>x.metadata.appProperties.financeTrackerKind==='snapshot-object');
 body.bytes[0]^=1;
 await assert.rejects(reopened.verifyBaseline());assert.equal(injected,0);
});
