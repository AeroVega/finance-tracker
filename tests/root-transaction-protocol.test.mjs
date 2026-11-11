import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {RootTransactionProtocol, createRootManifest, prepareRootTransaction,
  ROOT_MANIFEST_MAX_BYTES, ROOT_OBJECT_MAX_BYTES, ROOT_PLAN_PAGE_ENTRIES} from '../js/root-transaction-protocol.mjs';

const encode = value => new TextEncoder().encode(canonicalizeJcs(value));
const decode = value => JSON.parse(new TextDecoder().decode(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const error = code => Object.assign(new Error(code), {code});
class PreparationStore {
  files = new Map(); writes = 0;
  put(value) { const raw = encode(value), hash = digest(raw); this.files.set(hash, raw); return hash; }
  async read(hash, {maxBytes} = {}) {
    assert.equal(maxBytes, ROOT_OBJECT_MAX_BYTES);
    if (!this.files.has(hash)) throw error('object-not-found');
    return this.files.get(hash);
  }
  async write(raw) { const hash = digest(raw); this.files.set(hash, new Uint8Array(raw)); this.writes++; return hash; }
}
class Adapter {
  files = new Map(); mutations = []; attempts = 0; guards = 0; owned = true;
  beforeAttempt = null; afterAttempt = null; failRead = false; objectReads = 0;
  constructor(manifest) { this.manifest = encode(manifest); }
  async assertWritable() { this.guards++; if (!this.owned) throw error('not-owner'); }
  async readManifest({maxBytes}) {
    assert.equal(maxBytes, ROOT_MANIFEST_MAX_BYTES);
    if (this.failRead) { this.failRead = false; throw error('read-unavailable'); }
    return this.manifest;
  }
  async readObject(hash, {maxBytes}) {
    this.objectReads++; assert.equal(maxBytes, ROOT_OBJECT_MAX_BYTES);
    if (this.failRead) { this.failRead = false; throw error('read-unavailable'); }
    if (!this.files.has(hash)) throw error('object-not-found');
    return this.files.get(hash);
  }
  async mutate(kind, key, raw, {beforeMutation}) {
    const attempt = ++this.attempts;
    await this.beforeAttempt?.({attempt, kind, key});
    const guards = this.guards;
    await beforeMutation();
    assert.ok(this.guards > guards, 'fresh ownership gate immediately precedes durable mutation');
    assert.equal(this.owned, true);
    if (kind === 'object') {
      if (this.files.has(key)) assert.deepEqual(this.files.get(key), raw, 'never overwrite another immutable object');
      this.files.set(key, new Uint8Array(raw));
    } else this.manifest = new Uint8Array(raw);
    this.mutations.push({kind, key, raw: new Uint8Array(raw)});
    await this.afterAttempt?.({attempt, kind, key});
  }
  writeObject(hash, raw, options) { return this.mutate('object', hash, raw, options); }
  writeManifest(raw, options) { return this.mutate('manifest', null, raw, options); }
  listChildren() { throw new Error('Folder scans are forbidden'); }
  delete() { throw new Error('Evidence deletion is forbidden'); }
}
async function fixture({n = 3, verifier} = {}) {
  const preparation = new PreparationStore();
  const oldRoot = preparation.put({format: 'synthetic-root', total: 0, dependencies: []});
  const base = createRootManifest({databaseId: 'invented-db', copyId: 'invented-copy', root: oldRoot});
  const dependencies = [];
  for (let i = 0; i < n; i++) dependencies.push(preparation.put({synthetic: i, amount: i + 1}));
  const newRoot = preparation.put({format: 'synthetic-root', total: n * (n + 1) / 2, dependencies});
  const descriptors = [...dependencies, newRoot].sort().map(hash => ({hash, byteLength: preparation.files.get(hash).length}));
  const intent = await prepareRootTransaction({baseManifest: base, newRoot, transactionId: 'invented-tx-1',
    verificationPlan: 'synthetic-domain-v1', objects: descriptors, preparationStore: preparation});
  const adapter = new Adapter(base); adapter.files.set(oldRoot, preparation.files.get(oldRoot));
  const phases = [];
  const verify = verifier || (async ({baseManifest, newRoot: root, readObject, phase}) => {
    phases.push(phase);
    assert.equal(decode(await readObject(baseManifest.root)).format, 'synthetic-root');
    const next = decode(await readObject(root));
    assert.equal(next.format, 'synthetic-root');
    let total = 0;
    for (const hash of next.dependencies) total += decode(await readObject(hash)).amount;
    if (total !== next.total) throw error('invalid-synthetic-total');
  });
  const makeProtocol = () => new RootTransactionProtocol({adapter, assertWritable: () => adapter.assertWritable(),
    verificationPlans: new Map([['synthetic-domain-v1', verify]])});
  return {preparation, base, newRoot, dependencies, intent, adapter, phases, protocol: makeProtocol(), makeProtocol};
}
const execute = f => f.protocol.transact({intent: f.intent, preparationStore: f.preparation});
const savedManifest = f => decode(f.adapter.manifest);

test('small root publication retains exact base, commit, plan and every old object', async () => {
  const f = await fixture();
  const result = await execute(f);
  assert.equal(result.status, 'committed');
  assert.equal(result.manifest.root, f.newRoot); assert.equal(result.manifest.pending, null);
  assert.equal(result.manifest.revision, '1');
  const commit = decode(f.adapter.files.get(result.manifest.headCommit));
  assert.deepEqual(commit.intent, f.intent);
  assert.deepEqual(decode(f.adapter.files.get(f.intent.baseManifestHash)), f.base);
  assert.ok(f.adapter.files.has(f.base.root));
  assert.deepEqual(f.phases, ['before-publication', 'before-finalization']);
  const manifests = f.adapter.mutations.filter(x => x.kind === 'manifest').map(x => decode(x.raw));
  assert.equal(manifests.length, 3);
  assert.equal(manifests[0].root, f.base.root); assert.deepEqual(manifests[0].pending, f.intent);
  assert.equal(manifests[1].root, f.newRoot); assert.deepEqual(manifests[1].pending, f.intent);
  assert.equal(manifests[2].pending, null);
  const admission = f.adapter.mutations.findIndex(x => x.kind === 'manifest');
  for (const before of f.adapter.mutations.slice(0, admission)) assert.equal(decode(before.raw).format, 'finance-tracker-root-object-plan');
  assert.ok(f.adapter.manifest.length < 1024);
});

test('clean retry verifies retained exact evidence without another mutation', async () => {
  const f = await fixture(); await execute(f);
  const count = f.adapter.mutations.length;
  assert.equal((await execute(f)).status, 'already-committed');
  assert.equal(f.adapter.mutations.length, count);
  assert.equal(f.phases.at(-1), 'retry-completed');
  assert.equal((await f.protocol.recover()).status, 'idle');
});

test('recovery ignores unrelated and abandoned evidence and needs no folder list', async () => {
  const f = await fixture();
  f.adapter.files.set('f'.repeat(64), encode({format: 'malformed-unrelated-journal'}));
  assert.equal((await f.protocol.recover()).status, 'idle');
  assert.equal(f.adapter.objectReads, 0);
  await execute(f);
  assert.ok(f.adapter.files.has('f'.repeat(64)));
});

test('complete plan is durable before admission, and restart names a missing body without caller memory', async () => {
  const f = await fixture({n: 260});
  f.adapter.afterAttempt = ({kind}) => {
    if (kind === 'manifest') { f.adapter.failRead = true; throw error('lost-response'); }
  };
  await assert.rejects(execute(f), {code: 'mutation-unresolved'});
  assert.deepEqual(savedManifest(f).pending, f.intent);
  assert.ok(f.adapter.files.size >= 4, 'all plan pages and old root exist');
  f.adapter.afterAttempt = null;
  await assert.rejects(f.makeProtocol().recover(), e => e.code === 'pending-incomplete' && /^[0-9a-f]{64}$/.test(e.details.missingObject));
  const result = await f.makeProtocol().recover({preparationStore: f.preparation});
  assert.equal(result.status, 'committed');
});

test('pre-admission interruptions retain inert pages but never adopt a transaction', async () => {
  const f = await fixture();
  f.adapter.afterAttempt = () => { f.adapter.failRead = true; throw error('lost-response'); };
  await assert.rejects(execute(f), {code: 'mutation-unresolved'});
  assert.deepEqual(savedManifest(f), f.base);
  assert.equal((await f.makeProtocol().recover()).status, 'idle');
  assert.ok(f.adapter.files.has(f.intent.planRoot));
  f.adapter.afterAttempt = null;
  assert.equal((await execute(f)).status, 'committed');
});

test('lost successful responses resolve by one exact readback at every durable mutation', async () => {
  const baseline = await fixture(); await execute(baseline);
  for (let at = 1; at <= baseline.adapter.attempts; at++) {
    const f = await fixture();
    f.adapter.afterAttempt = ({attempt}) => { if (attempt === at) throw error('lost-response'); };
    assert.equal((await execute(f)).status, 'committed', `mutation ${at}`);
    assert.equal(f.adapter.attempts, baseline.adapter.attempts, 'no blind write retry');
  }
});

test('unknown responses at every durable mutation preserve evidence and converge after explicit retry', async () => {
  const baseline = await fixture(); await execute(baseline);
  for (let at = 1; at <= baseline.adapter.attempts; at++) {
    const f = await fixture();
    f.adapter.afterAttempt = ({attempt}) => {
      if (attempt === at) { f.adapter.failRead = true; throw error('lost-response'); }
    };
    await assert.rejects(execute(f), {code: 'mutation-unresolved'}, `mutation ${at}`);
    const evidence = new Map(f.adapter.files);
    f.adapter.afterAttempt = null;
    const current = savedManifest(f);
    if (current.pending) await f.makeProtocol().recover({preparationStore: f.preparation});
    else await execute(f);
    assert.equal(savedManifest(f).root, f.newRoot); assert.equal(savedManifest(f).pending, null);
    for (const [hash, raw] of evidence) assert.deepEqual(f.adapter.files.get(hash), raw, 'evidence retained');
  }
});

test('ownership loss immediately before every durable mutation prevents that mutation', async () => {
  const baseline = await fixture(); await execute(baseline);
  for (let at = 1; at <= baseline.adapter.attempts; at++) {
    const f = await fixture();
    f.adapter.beforeAttempt = ({attempt}) => { if (attempt === at) f.adapter.owned = false; };
    await assert.rejects(execute(f));
    assert.equal(f.adapter.mutations.length, at - 1);
    f.adapter.beforeAttempt = null; f.adapter.owned = true;
    await execute(f); assert.equal(savedManifest(f).pending, null);
  }
});

test('changed base immediately before every durable mutation stops without overwriting it', async () => {
  const baseline = await fixture(); await execute(baseline);
  for (let at = 1; at <= baseline.adapter.attempts; at++) {
    const f = await fixture(); let foreign;
    f.adapter.beforeAttempt = ({attempt}) => {
      if (attempt === at) { foreign = {...savedManifest(f), copyId: 'other-copy'}; f.adapter.manifest = encode(foreign); }
    };
    await assert.rejects(execute(f));
    assert.equal(f.adapter.mutations.length, at - 1); assert.deepEqual(savedManifest(f), foreign);
  }
});

test('cancellation at every mutation stops further writes and supports explicit retry', async () => {
  const baseline = await fixture(); await execute(baseline);
  for (let at = 1; at <= baseline.adapter.attempts; at++) {
    const f = await fixture(), controller = new AbortController();
    f.adapter.afterAttempt = ({attempt}) => { if (attempt === at) controller.abort(); };
    await assert.rejects(f.protocol.transact({intent: f.intent, preparationStore: f.preparation, signal: controller.signal}));
    assert.equal(f.adapter.mutations.length, at);
    f.adapter.afterAttempt = null; await execute(f);
    assert.equal(savedManifest(f).root, f.newRoot);
  }
});

for (const field of ['root', 'headCommit', 'revision', 'databaseId', 'copyId', 'role']) {
  test(`recovery rejects ${field} substitution in the authoritative pending manifest`, async () => {
    const f = await fixture();
    f.adapter.afterAttempt = ({kind}) => { if (kind === 'manifest') { f.adapter.failRead = true; throw error('interrupted'); } };
    await assert.rejects(execute(f)); f.adapter.afterAttempt = null;
    const changed = savedManifest(f);
    changed[field] = {root: 'e'.repeat(64), headCommit: 'd'.repeat(64), revision: '2', databaseId: 'other-db', copyId: 'other-copy', role: 'backup'}[field];
    f.adapter.manifest = encode(changed);
    const count = f.adapter.mutations.length;
    await assert.rejects(f.makeProtocol().recover({preparationStore: f.preparation}), {code: 'pending-manifest-mismatch'});
    assert.equal(f.adapter.mutations.length, count);
  });
}

test('base hash, target root, pending plan, and verifier substitutions fail closed', async () => {
  const f = await fixture();
  for (const update of [
    {baseManifestHash: 'e'.repeat(64)},
    {verificationPlan: 'not-registered'},
    {planRoot: null},
  ]) {
    await assert.rejects(f.protocol.transact({intent: {...f.intent, ...update}, preparationStore: f.preparation}));
    assert.equal(f.adapter.mutations.length, 0);
  }
  await assert.rejects(f.protocol.transact({intent: {...f.intent, newRoot: 'b'.repeat(64)}, preparationStore: f.preparation}), {code: 'object-not-found'});
  assert.equal(savedManifest(f).root, f.base.root); assert.ok(savedManifest(f).pending);
});

test('corrupt staged object cannot publish or be silently overwritten', async () => {
  const f = await fixture();
  f.adapter.files.set(f.dependencies[0], encode({corruption: true}));
  await assert.rejects(execute(f), {code: 'object-hash-mismatch'});
  assert.equal(savedManifest(f).root, f.base.root); assert.ok(savedManifest(f).pending);
  assert.deepEqual(decode(f.adapter.files.get(f.dependencies[0])), {corruption: true});
});

test('semantic verifier failure and a public true result cannot publish a root', async () => {
  for (const verifier of [async () => { throw error('domain-invalid'); }, async () => true]) {
    const f = await fixture({verifier});
    await assert.rejects(execute(f));
    assert.equal(savedManifest(f).root, f.base.root); assert.ok(savedManifest(f).pending);
    assert.equal(f.adapter.mutations.filter(x => x.kind === 'manifest').length, 1);
  }
});

test('verification reruns after publication before pending can clear', async () => {
  const f = await fixture({verifier: async ({phase}) => { if (phase === 'before-finalization') throw error('domain-invalid'); }});
  await assert.rejects(execute(f), {code: 'domain-invalid'});
  assert.equal(savedManifest(f).root, f.newRoot); assert.ok(savedManifest(f).pending);
  const count = f.adapter.mutations.length;
  await assert.rejects(f.makeProtocol().recover(), {code: 'domain-invalid'});
  assert.equal(f.adapter.mutations.length, count);
});

test('a root hash and a short object plan do not establish complete semantic closure', async () => {
  const f = await fixture();
  const missing = f.preparation.put({synthetic: 'omitted-dependency', amount: 99});
  const root = f.preparation.put({format: 'synthetic-root', total: 99, dependencies: [missing]});
  const intent = await prepareRootTransaction({baseManifest: f.base, newRoot: root, transactionId: 'closure-gap', verificationPlan: 'synthetic-domain-v1',
    preparationStore: f.preparation, objects: [{hash: root, byteLength: f.preparation.files.get(root).length}]});
  await assert.rejects(f.protocol.transact({intent, preparationStore: f.preparation}), {code: 'object-not-found'});
  assert.equal(savedManifest(f).root, f.base.root);
});

test('paged plan scales by changed objects with bounded pages and decimal counters', async () => {
  const f = await fixture({n: 700});
  assert.equal(f.intent.objectCount, '701');
  let address = f.intent.planRoot, pages = 0, count = 0;
  while (address) {
    const raw = f.preparation.files.get(address), page = decode(raw);
    assert.ok(raw.length <= ROOT_OBJECT_MAX_BYTES); assert.ok(page.entries.length <= ROOT_PLAN_PAGE_ENTRIES);
    pages++; count += page.entries.length; address = page.previous;
  }
  assert.equal(pages, 6); assert.equal(count, 701);
  await execute(f);
  assert.ok(f.adapter.manifest.length < 1024);
  const maximum = Math.max(...f.adapter.mutations.map(x => x.raw.length));
  assert.ok(maximum <= ROOT_OBJECT_MAX_BYTES);
});

test('preparation streams descriptor pages before consuming the whole inventory', async () => {
  const f = await fixture({n: 300});
  const descriptors = [...f.dependencies, f.newRoot].sort().map(hash => ({hash, byteLength: f.preparation.files.get(hash).length}));
  const initial = f.preparation.writes;
  await prepareRootTransaction({baseManifest: f.base, newRoot: f.newRoot, transactionId: 'streamed-plan', verificationPlan: 'synthetic-domain-v1', preparationStore: f.preparation,
    objects: (async function* () { for (let i = 0; i < descriptors.length; i++) {
      if (i === 129) assert.ok(f.preparation.writes > initial);
      yield descriptors[i];
    } })()});
});

test('preparation rejects duplicates, wrong lengths and oversized bodies', async () => {
  const f = await fixture();
  const entry = {hash: f.newRoot, byteLength: f.preparation.files.get(f.newRoot).length};
  for (const objects of [[entry, entry], [{...entry, byteLength: entry.byteLength + 1}], [{...entry, byteLength: ROOT_OBJECT_MAX_BYTES + 1}]]) {
    await assert.rejects(prepareRootTransaction({baseManifest: f.base, newRoot: f.newRoot, transactionId: 'bad-plan', verificationPlan: 'synthetic-domain-v1', preparationStore: f.preparation, objects}));
  }
  assert.equal(f.adapter.mutations.length, 0);
});

test('strict manifest parsing rejects alternate JSON, unknown fields and future versions', async () => {
  for (const raw of [
    new TextEncoder().encode(JSON.stringify((await fixture()).base, null, 2)),
    encode({... (await fixture()).base, extra: true}),
    encode({... (await fixture()).base, version: 99}),
  ]) {
    const f = await fixture(); f.adapter.manifest = raw;
    await assert.rejects(f.protocol.recover()); assert.equal(f.adapter.mutations.length, 0);
  }
});

test('caller intent changes after invocation cannot change queued publication', async () => {
  const f = await fixture(), intent = copy(f.intent);
  const run = f.protocol.transact({intent, preparationStore: f.preparation});
  intent.newRoot = 'f'.repeat(64); intent.baseManifest.copyId = 'changed-after-call';
  assert.equal((await run).manifest.root, f.newRoot);
});

test('Buffer-backed adapter bytes are copied before awaiting hashes', async () => {
  const f = await fixture();
  const original = f.adapter.readObject.bind(f.adapter);
  f.adapter.readObject = async (hash, options) => {
    const raw = Buffer.from(await original(hash, options));
    // A deferred mutation runs during SHA-256. Buffer.slice would alias it.
    setTimeout(() => raw.fill(0), 0);
    return raw;
  };
  f.protocol = f.makeProtocol();
  await execute(f); assert.equal(savedManifest(f).root, f.newRoot);
});

test('hostile typed-array length, buffer and slice properties cannot bypass bounds or copies', async () => {
  const f = await fixture();
  const oversized = new Uint8Array(ROOT_MANIFEST_MAX_BYTES + 1);
  Object.defineProperties(oversized, {length: {value: 1}, byteLength: {value: 1}, slice: {value: () => encode(f.base)}});
  f.adapter.readManifest = async () => oversized;
  await assert.rejects(f.makeProtocol().recover(), {code: 'object-byte-limit'});
  const g = await fixture();
  const oversizedObject = new Uint8Array(ROOT_OBJECT_MAX_BYTES + 1);
  Object.defineProperties(oversizedObject, {length: {value: 1}, byteLength: {value: 1}, slice: {value: () => encode({fake: true})}});
  g.preparation.read = async () => oversizedObject;
  await assert.rejects(execute(g), {code: 'object-byte-limit'});
});

test('forged public semantic flags and changed verifier registry cannot confer trust', async () => {
  const f = await fixture();
  await assert.rejects(f.protocol.transact({intent: {...f.intent, semanticVerified: true}, preparationStore: f.preparation}), {code: 'invalid-shape'});
  const plans = new Map([['synthetic-domain-v1', async () => { throw error('correct-verifier'); }]]);
  const protocol = new RootTransactionProtocol({adapter: f.adapter, assertWritable: () => f.adapter.assertWritable(), verificationPlans: plans});
  plans.set('synthetic-domain-v1', async () => undefined);
  await assert.rejects(protocol.transact({intent: f.intent, preparationStore: f.preparation}), {code: 'correct-verifier'});
});

test('consecutive root transactions retain the complete prior commit chain without snapshot maps', async () => {
  const f = await fixture();
  let current = (await execute(f)).manifest;
  const retained = new Map(f.adapter.files), manifests = [f.base, current];
  for (let i = 2; i <= 8; i++) {
    const intent = await prepareRootTransaction({baseManifest: current, newRoot: current.root,
      transactionId: `invented-tx-${i}`, verificationPlan: 'synthetic-domain-v1', objects: [], preparationStore: f.preparation});
    current = (await f.protocol.transact({intent, preparationStore: f.preparation})).manifest;
    manifests.push(current); assert.equal(current.revision, String(i));
    assert.ok(f.adapter.manifest.length < 1024);
  }
  for (const [hash, raw] of retained) assert.deepEqual(f.adapter.files.get(hash), raw);
  for (let i = manifests.length - 1; i > 0; i--) {
    const commit = decode(f.adapter.files.get(manifests[i].headCommit));
    assert.deepEqual(commit.intent.baseManifest, manifests[i - 1]);
    assert.deepEqual(decode(f.adapter.files.get(commit.intent.baseManifestHash)), manifests[i - 1]);
  }
});

test('malformed plan count and cross-page order fail before pending admission', async () => {
  const f = await fixture({n: 260});
  const original = decode(f.preparation.files.get(f.intent.planRoot));
  const mutated = {...original, beforeCount: '0'};
  const planRoot = f.preparation.put(mutated);
  await assert.rejects(f.protocol.transact({intent: {...f.intent, planRoot}, preparationStore: f.preparation}), {code: 'invalid-plan'});
  assert.deepEqual(savedManifest(f), f.base);
  const last = original.entries.at(-1);
  const earlier = decode(f.preparation.files.get(original.previous));
  earlier.entries[earlier.entries.length - 1] = {...last};
  // Keep entries locally sorted, but make the last earlier entry overlap the next page.
  const previous = f.preparation.put(earlier);
  const root = f.preparation.put({...original, previous});
  await assert.rejects(f.protocol.transact({intent: {...f.intent, planRoot: root}, preparationStore: f.preparation}), {code: 'invalid-plan'});
  assert.deepEqual(savedManifest(f), f.base);
});

test('an unknown read error is not treated as an absent object or overwritten', async () => {
  const f = await fixture();
  f.adapter.readObject = async () => { throw error('permission-denied'); };
  await assert.rejects(f.makeProtocol().transact({intent: f.intent, preparationStore: f.preparation}), {code: 'permission-denied'});
  assert.equal(f.adapter.mutations.length, 0);
});

test('missing published commit or damaged authoritative plan keeps pending evidence', async () => {
  for (const remove of ['commit', 'plan']) {
    const f = await fixture();
    f.adapter.afterAttempt = ({kind}) => {
      if (kind === 'manifest' && savedManifest(f).root === f.newRoot) { f.adapter.failRead = true; throw error('interrupted'); }
    };
    await assert.rejects(execute(f)); f.adapter.afterAttempt = null;
    const current = savedManifest(f), count = f.adapter.mutations.length;
    assert.equal(current.root, f.newRoot); assert.ok(current.pending);
    f.adapter.files.delete(remove === 'commit' ? current.headCommit : f.intent.planRoot);
    await assert.rejects(f.makeProtocol().recover(), {code: 'object-not-found'});
    assert.equal(f.adapter.mutations.length, count); assert.deepEqual(savedManifest(f), current);
  }
});

test('an adapter that skips its mutation guard is rejected even if exact bytes appear', async () => {
  const f = await fixture();
  f.adapter.writeObject = async (hash, raw) => { f.adapter.files.set(hash, new Uint8Array(raw)); };
  await assert.rejects(f.makeProtocol().transact({intent: f.intent, preparationStore: f.preparation}), {code: 'adapter-contract'});
  assert.deepEqual(savedManifest(f), f.base);
});

test('verification read access is revoked after success and failure', async () => {
  for (const throwError of [false, true]) {
    let read;
    const f = await fixture({verifier: async ({readObject}) => { read = readObject; if (throwError) throw error('domain-invalid'); }});
    if (throwError) await assert.rejects(execute(f), {code: 'domain-invalid'}); else await execute(f);
    const reads = f.adapter.objectReads;
    await assert.rejects(read(f.newRoot), {code: 'verification-scope-closed'});
    assert.equal(f.adapter.objectReads, reads);
  }
});

test('caught verifier read failures poison verification and preserve pending', async () => {
  const f = await fixture({verifier: async ({readObject}) => { try { await readObject('a'.repeat(64)); } catch {} }});
  await assert.rejects(execute(f), {code: 'object-not-found'});
  assert.equal(savedManifest(f).root, f.base.root); assert.ok(savedManifest(f).pending);
});

test('unfinished verifier reads drain before rejection and cannot overlap later work', async () => {
  for (const throwError of [false, true]) {
    let active = 0;
    const f = await fixture({verifier: async ({readObject}) => {
      readObject(f.newRoot).catch(() => {});
      if (throwError) throw error('domain-invalid');
    }});
    const original = f.adapter.readObject.bind(f.adapter);
    let delay = false;
    f.adapter.readObject = async (hash, options) => {
      if (delay) { active++; await new Promise(resolve => setTimeout(resolve, 5)); active--; }
      return original(hash, options);
    };
    f.protocol = new RootTransactionProtocol({adapter: f.adapter, assertWritable: () => f.adapter.assertWritable(),
      verificationPlans: new Map([['synthetic-domain-v1', async ({readObject}) => {
        delay = true; readObject(f.newRoot).catch(() => {});
        if (throwError) throw error('domain-invalid');
      }]])});
    await assert.rejects(execute(f), {code: throwError ? 'domain-invalid' : 'unfinished-verification-read'});
    assert.equal(active, 0); assert.equal(savedManifest(f).root, f.base.root);
  }
});

test('concurrent verifier reads are bounded even if the verifier catches the limit error', async () => {
  let maximum = 0, active = 0;
  const f = await fixture();
  const original = f.adapter.readObject.bind(f.adapter);
  f.adapter.readObject = async (hash, options) => {
    active++; maximum = Math.max(maximum, active);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await original(hash, options); }
    finally { active--; }
  };
  f.protocol = new RootTransactionProtocol({adapter: f.adapter, assertWritable: () => f.adapter.assertWritable(),
    verificationPlans: new Map([['synthetic-domain-v1', async ({readObject}) => {
      await Promise.allSettled([readObject(f.newRoot), readObject(f.newRoot)]);
    }]])});
  await assert.rejects(execute(f), {code: 'verification-read-limit'});
  assert.equal(maximum, 1); assert.equal(active, 0); assert.equal(savedManifest(f).root, f.base.root);
});

for (const reason of [undefined, null, false, 0, '', new Error('explicit failure')]) {
  const label = reason instanceof Error ? 'Error' : String(reason);
  test(`verifier rejection with ${JSON.stringify(label)} cannot become success`, async () => {
    const f = await fixture({verifier: async () => { throw reason; }});
    let rejected = false, observed;
    try { await execute(f); } catch (caught) { rejected = true; observed = caught; }
    assert.equal(rejected, true); assert.equal(observed, reason);
    assert.equal(savedManifest(f).root, f.base.root); assert.ok(savedManifest(f).pending);
  });
  test(`caught verifier read rejection with ${JSON.stringify(label)} poisons verification`, async () => {
    const f = await fixture({verifier: async ({readObject}) => { try { await readObject('a'.repeat(64)); } catch {} }});
    const original = f.adapter.readObject.bind(f.adapter);
    f.adapter.readObject = async (hash, options) => { if (hash === 'a'.repeat(64)) throw reason; return original(hash, options); };
    f.protocol = f.makeProtocol();
    let rejected = false, observed;
    try { await execute(f); } catch (caught) { rejected = true; observed = caught; }
    assert.equal(rejected, true); assert.equal(observed, reason);
    assert.equal(savedManifest(f).root, f.base.root); assert.ok(savedManifest(f).pending);
  });
}


test('cross-realm shared buffers cannot cross manifest or object byte boundaries', async () => {
  const f = await fixture();
  const shared = new Uint8Array(runInNewContext('new SharedArrayBuffer(8)'));
  Object.defineProperty(shared, 'buffer', {value: new ArrayBuffer(8)});
  f.adapter.readManifest = async () => shared;
  await assert.rejects(f.makeProtocol().recover(), {code: 'object-byte-limit'});
  const g = await fixture();
  g.preparation.read = async () => shared;
  await assert.rejects(execute(g), {code: 'object-byte-limit'});
  assert.equal(g.adapter.mutations.length, 0);
});

test('cross-realm ordinary buffers remain usable through an ordinary Uint8Array', async () => {
  const f = await fixture();
  const raw = new Uint8Array(runInNewContext(`new ArrayBuffer(${f.adapter.manifest.length})`));
  raw.set(f.adapter.manifest); f.adapter.manifest = raw;
  assert.equal((await f.makeProtocol().recover()).status, 'idle');
});
