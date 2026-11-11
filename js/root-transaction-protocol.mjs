/** Synthetic-only, explicit-adapter root transactions. No default persistence,
 * folder enumeration, garbage collection, or claim of server-side CAS. */
import {canonicalizeJcs} from './transaction-protocol.mjs';

export const ROOT_MANIFEST_FORMAT = 'finance-tracker-root-manifest';
export const ROOT_PROTOCOL_VERSION = 3;
export const ROOT_OBJECT_MAX_BYTES = 64 * 1024;
export const ROOT_MANIFEST_MAX_BYTES = 16 * 1024;
export const ROOT_PLAN_PAGE_ENTRIES = 128;
const INTENT = 'finance-tracker-root-intent';
const PLAN = 'finance-tracker-root-object-plan';
const COMMIT = 'finance-tracker-root-commit';
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const ordinaryBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export class RootTransactionError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'RootTransactionError'; this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new RootTransactionError(code, message, details); };
const abort = signal => { if (signal?.aborted) throw new DOMException('Root transaction cancelled.', 'AbortError'); };
function fields(value, expected) {
  if (!plain(value) || Object.keys(value).length !== expected.length || expected.some(k => !Object.hasOwn(value, k)) ||
      Object.getOwnPropertySymbols(value).length || expected.some(k => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) {
    fail('invalid-shape', 'Unexpected protocol fields or accessors.');
  }
}
function hash(value) { if (typeof value !== 'string' || !HASH.test(value)) fail('invalid-hash', 'Expected a lowercase SHA-256 address.'); return value; }
function count(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) fail('invalid-count', 'Expected an exact unsigned decimal counter.');
  return BigInt(value);
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail('invalid-identity', 'Expected a bounded protocol identity.');
  return value;
}
function bytes(value, maximum = ROOT_OBJECT_MAX_BYTES) {
  if (!(value instanceof Uint8Array)) fail('object-byte-limit', 'Expected bounded unshared bytes.');
  let length;
  try {
    length = byteLengthOf.call(value);
    // An ordinary ArrayBuffer intrinsic rejects shared buffers across realms,
    // including when SharedArrayBuffer is absent from this realm's globals.
    ordinaryBufferByteLength.call(bufferOf.call(value));
  } catch { fail('object-byte-limit', 'Expected bounded unshared bytes.'); }
  if (length > maximum) fail('object-byte-limit', 'Expected bounded unshared bytes.');
  return new Uint8Array(value);
}
// Reject large or accessor-bearing input before canonical serialization. The
// budget counts containers as well as characters and is never a database limit.
function encode(value, maximum = ROOT_OBJECT_MAX_BYTES) {
  let remaining = maximum;
  function inspect(x, depth) {
    if (--remaining < 0 || depth > 32) fail('metadata-limit', 'Protocol metadata exceeds its bounded shape.');
    if (typeof x === 'string') { remaining -= x.length; if (remaining < 0) fail('metadata-limit', 'Protocol metadata is too large.'); return; }
    if (x === null || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) return;
    if (!plain(x) && !Array.isArray(x)) fail('invalid-json', 'Expected plain protocol JSON.');
    if (Object.getOwnPropertySymbols(x).length) fail('invalid-json', 'Symbol fields are not supported.');
    if (Array.isArray(x) && (x.length > ROOT_PLAN_PAGE_ENTRIES || Object.keys(x).length !== x.length)) fail('invalid-json', 'Expected a bounded dense protocol array.');
    for (const key in x) if (Object.hasOwn(x, key)) {
      remaining -= key.length;
      const d = Object.getOwnPropertyDescriptor(x, key);
      if (!d || !Object.hasOwn(d, 'value')) fail('invalid-json', 'Accessors are not protocol data.');
      inspect(d.value, depth + 1);
    }
  }
  inspect(value, 0);
  const result = encoder.encode(canonicalizeJcs(value));
  if (result.length > maximum) fail('metadata-limit', 'Encoded protocol metadata exceeds its byte budget.');
  return result;
}
const snapshot = value => JSON.parse(decoder.decode(encode(value)));
async function digest(value) {
  const result = await globalThis.crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
function decode(value, maximum = ROOT_OBJECT_MAX_BYTES) {
  const raw = bytes(value, maximum);
  let result;
  try { result = JSON.parse(decoder.decode(raw)); } catch { fail('invalid-json', 'Stored metadata is not UTF-8 JSON.'); }
  if (!equalBytes(raw, encode(result, maximum))) fail('noncanonical-json', 'Stored protocol JSON must be canonical.');
  return result;
}
function validateManifest(value, allowPending = true) {
  fields(value, ['format', 'version', 'databaseId', 'copyId', 'role', 'revision', 'root', 'headCommit', 'pending']);
  if (value.format !== ROOT_MANIFEST_FORMAT || value.version !== ROOT_PROTOCOL_VERSION) fail('unsupported-manifest', 'Unsupported root-manifest format.');
  identifier(value.databaseId); identifier(value.copyId); count(value.revision); hash(value.root);
  if (!['primary', 'backup'].includes(value.role)) fail('invalid-role', 'Unsupported manifest role.');
  if (value.headCommit !== null) hash(value.headCommit);
  if (value.pending !== null) {
    if (!allowPending) fail('pending-base', 'A transaction base must have no pending intent.');
    validateIntent(value.pending);
  }
  return value;
}
function validateIntent(value) {
  fields(value, ['format', 'version', 'transactionId', 'baseManifest', 'baseManifestHash', 'newRoot', 'planRoot', 'objectCount', 'verificationPlan']);
  if (value.format !== INTENT || value.version !== ROOT_PROTOCOL_VERSION) fail('unsupported-intent', 'Unsupported pending intent.');
  identifier(value.transactionId); identifier(value.verificationPlan); validateManifest(value.baseManifest, false);
  if (value.baseManifest.role !== 'primary') fail('read-only-copy', 'Backup copies cannot admit transactions.');
  hash(value.baseManifestHash); hash(value.newRoot); count(value.objectCount);
  if (value.planRoot !== null) hash(value.planRoot);
  if ((value.planRoot === null) !== (value.objectCount === '0')) fail('invalid-plan', 'Plan root and count disagree.');
  return value;
}
function validatePage(value, expectedCount) {
  fields(value, ['format', 'version', 'previous', 'beforeCount', 'entries']);
  if (value.format !== PLAN || value.version !== ROOT_PROTOCOL_VERSION || !Array.isArray(value.entries) ||
      !value.entries.length || value.entries.length > ROOT_PLAN_PAGE_ENTRIES) fail('invalid-plan', 'Unsupported or oversized object plan page.');
  const before = count(value.beforeCount);
  if (before + BigInt(value.entries.length) !== expectedCount || (value.previous === null) !== (before === 0n)) fail('invalid-plan', 'Object plan counts or links disagree.');
  if (value.previous !== null) hash(value.previous);
  let previous = null;
  for (const entry of value.entries) {
    fields(entry, ['hash', 'byteLength']); hash(entry.hash);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength > ROOT_OBJECT_MAX_BYTES ||
        (previous !== null && previous >= entry.hash)) fail('invalid-plan', 'Plan entries must have strictly ordered addresses and bounded sizes.');
    previous = entry.hash;
  }
  return value;
}
async function readVerified(read, address, signal) {
  abort(signal); hash(address);
  const result = bytes(await read(address, {signal, maxBytes: ROOT_OBJECT_MAX_BYTES}));
  abort(signal);
  if (await digest(result) !== address) fail('object-hash-mismatch', 'Content does not match its exact address.');
  abort(signal); return result;
}

/** Creates metadata only. Initial destination setup is deliberately outside this
 * protocol; this function does not write or infer storage authorization. */
export function createRootManifest({databaseId, copyId, root, role = 'primary'}) {
  return snapshot(validateManifest({format: ROOT_MANIFEST_FORMAT, version: ROOT_PROTOCOL_VERSION,
    databaseId, copyId, role, revision: '0', root, headCommit: null, pending: null}));
}

/** Explicit preparation only. `objects` streams distinct {hash, byteLength}
 * descriptors in ascending hash order. Their bytes must already exist in the
 * caller-owned preparation store. Only bounded plan pages are added there.
 * Never pass the live publication adapter as this preparation store. */
export async function prepareRootTransaction({baseManifest, newRoot, transactionId, verificationPlan, objects, preparationStore, signal}) {
  const base = snapshot(baseManifest); validateManifest(base, false); hash(newRoot); identifier(transactionId); identifier(verificationPlan);
  if (base.role !== 'primary') fail('read-only-copy', 'Backup copies cannot admit transactions.');
  if (typeof preparationStore?.read !== 'function' || typeof preparationStore?.write !== 'function' ||
      !objects || (typeof objects[Symbol.asyncIterator] !== 'function' && typeof objects[Symbol.iterator] !== 'function')) fail('invalid-preparation', 'An explicit preparation store and descriptor stream are required.');
  const read = preparationStore.read.bind(preparationStore), write = preparationStore.write.bind(preparationStore);
  let planRoot = null, total = 0n, previousHash = null, entries = [];
  async function flush() {
    if (!entries.length) return;
    const page = {format: PLAN, version: ROOT_PROTOCOL_VERSION, previous: planRoot, beforeCount: String(total), entries};
    const raw = encode(page), address = await digest(raw);
    abort(signal); const returned = await write(raw.slice(), {signal}); abort(signal);
    if (returned !== address || !equalBytes(await readVerified(read, address, signal), raw)) fail('preparation-readback-mismatch', 'Prepared plan page did not read back exactly.');
    planRoot = address; total += BigInt(entries.length); entries = [];
  }
  for await (const input of objects) {
    abort(signal); const entry = snapshot(input); fields(entry, ['hash', 'byteLength']); hash(entry.hash);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength > ROOT_OBJECT_MAX_BYTES ||
        (previousHash !== null && previousHash >= entry.hash)) fail('invalid-plan', 'Prepared descriptors must be unique, ordered and bounded.');
    if ((await readVerified(read, entry.hash, signal)).length !== entry.byteLength) fail('object-size-mismatch', 'Prepared object length disagrees with its descriptor.');
    entries.push(entry); previousHash = entry.hash;
    if (entries.length === ROOT_PLAN_PAGE_ENTRIES) await flush();
  }
  await flush();
  const intent = {format: INTENT, version: ROOT_PROTOCOL_VERSION, transactionId, baseManifest: base,
    baseManifestHash: await digest(encode(base, ROOT_MANIFEST_MAX_BYTES)), newRoot, planRoot,
    objectCount: String(total), verificationPlan};
  validateIntent(intent); return snapshot(intent);
}

/**
 * Adapter, scoped to one physical synthetic copy:
 * readManifest({maxBytes,signal}) -> canonical Uint8Array
 * writeManifest(bytes,{beforeMutation,signal}) -> void
 * readObject(hash,{maxBytes,signal}) -> Uint8Array; missing => code object-not-found
 * writeObject(hash,bytes,{beforeMutation,signal}) -> void, immutable create only
 *
 * Read limits must apply during transport, before allocation. Writes must call
 * beforeMutation immediately before EACH durable attempt, and settle all their
 * attempts before returning. Reads must observe completed writes. No listing or
 * deletion method exists. assertWritable checks online state and copy/session
 * ownership; it must throw on lost, stale or unknown ownership.
 *
 * verificationPlans is a Map of stable plan ID to trusted application code. A
 * verifier must check complete root reachability AND the domain's change rules,
 * throw on failure, and return undefined. It gets only verified read access.
 * This protocol does not implement financial semantics or accept boolean proof.
 */
export class RootTransactionProtocol {
  #adapter; #assertWritable; #plans; #queue = Promise.resolve();
  constructor({adapter, assertWritable, verificationPlans}) {
    if (!adapter || ['readManifest', 'writeManifest', 'readObject', 'writeObject'].some(k => typeof adapter[k] !== 'function') ||
        typeof assertWritable !== 'function' || !(verificationPlans instanceof Map) || !verificationPlans.size) fail('invalid-adapter', 'An explicit adapter, ownership guard and verifier registry are required.');
    this.#adapter = Object.fromEntries(['readManifest', 'writeManifest', 'readObject', 'writeObject'].map(k => [k, adapter[k].bind(adapter)]));
    this.#assertWritable = assertWritable; this.#plans = new Map(verificationPlans);
    for (const [id, verifier] of this.#plans) { identifier(id); if (typeof verifier !== 'function') fail('invalid-verifier', 'A verification plan must be executable code.'); }
  }
  #enqueue(work) { const run = this.#queue.then(work); this.#queue = run.catch(() => {}); return run; }
  async #manifest(signal) {
    abort(signal);
    const raw = bytes(await this.#adapter.readManifest({signal, maxBytes: ROOT_MANIFEST_MAX_BYTES}), ROOT_MANIFEST_MAX_BYTES);
    abort(signal); return validateManifest(decode(raw, ROOT_MANIFEST_MAX_BYTES));
  }
  async #exact(expected, signal) {
    if (!equalBytes(encode(await this.#manifest(signal)), encode(expected))) fail('base-conflict', 'The exact authoritative manifest changed.');
  }
  async #guard(expected, signal) {
    abort(signal); await this.#assertWritable(); abort(signal); await this.#exact(expected, signal); abort(signal);
  }
  async #writeManifest(expected, next, stage, signal) {
    await this.#guard(expected, signal);
    let cause, guarded = false;
    try {
      await this.#adapter.writeManifest(encode(next, ROOT_MANIFEST_MAX_BYTES), {signal, beforeMutation: async () => {
        await this.#guard(expected, signal); guarded = true;
      }});
      if (!guarded) fail('adapter-contract', 'The adapter omitted its durable-mutation guard.');
    } catch (error) { cause = error; }
    let actual;
    try { actual = await this.#manifest(signal); }
    catch (error) { fail('mutation-unresolved', 'Manifest write outcome is unknown. Preserve evidence and recover.', {stage, outcome: 'unknown', cause: cause?.code || error.code || error.name}); }
    if (equalBytes(encode(actual), encode(next))) {
      if (!guarded) fail('adapter-contract', 'The adapter mutated without its durable-mutation guard.');
      return actual;
    }
    if (!equalBytes(encode(actual), encode(expected))) fail('base-conflict', 'Manifest matches neither the exact base nor intended publication.', {stage});
    fail('mutation-unresolved', 'Intended manifest was not observed. Reinspect before retrying.', {stage, outcome: 'not-observed', cause: cause?.code || cause?.name || 'readback-mismatch'});
  }
  async #readObject(address, signal) { return readVerified(this.#adapter.readObject, address, signal); }
  async #ensureObject(address, raw, expected, stage, signal) {
    const wanted = bytes(raw);
    if (await digest(wanted) !== address) fail('object-hash-mismatch', 'Staging bytes differ from the admitted address.');
    try {
      if (!equalBytes(await this.#readObject(address, signal), wanted)) fail('object-readback-mismatch', 'Existing immutable bytes differ.');
      return;
    } catch (error) { if (error.code !== 'object-not-found') throw error; }
    await this.#guard(expected, signal);
    let cause, guarded = false;
    try {
      await this.#adapter.writeObject(address, wanted.slice(), {signal, beforeMutation: async () => {
        await this.#guard(expected, signal); guarded = true;
      }});
      if (!guarded) fail('adapter-contract', 'The adapter omitted its durable-mutation guard.');
    } catch (error) { cause = error; }
    try {
      if (!equalBytes(await this.#readObject(address, signal), wanted)) fail('object-readback-mismatch', 'Staged object failed exact readback.');
    } catch (error) { fail('mutation-unresolved', 'Object write outcome is unresolved. Preserve its exact address and recover.', {stage, outcome: 'unknown', cause: cause?.code || error.code || error.name}); }
    if (!guarded) fail('adapter-contract', 'The adapter mutated without its durable-mutation guard.');
  }
  async #binding(intent) {
    validateIntent(intent);
    if (!this.#plans.has(intent.verificationPlan)) fail('verification-plan-unavailable', 'The admitted application verification plan is unavailable.');
    if (await digest(encode(intent.baseManifest, ROOT_MANIFEST_MAX_BYTES)) !== intent.baseManifestHash) fail('intent-base-mismatch', 'Intent does not bind the exact base manifest.');
    const commitBytes = encode({format: COMMIT, version: ROOT_PROTOCOL_VERSION, intent});
    const commitHash = await digest(commitBytes);
    const admitted = {...intent.baseManifest, pending: intent};
    const published = {...admitted, root: intent.newRoot, revision: String(count(intent.baseManifest.revision) + 1n), headCommit: commitHash};
    validateManifest(published);
    return {commitBytes, commitHash, admitted, published, final: {...published, pending: null}};
  }
  // Preparation pages precede admission. They are inert preserved evidence,
  // never candidate transactions. All pages must read back before pending points
  // at their root, so recovery can enumerate exactly the missing object bodies.
  async #preparePlan(intent, expected, preparation, signal) {
    let address = intent.planRoot, remaining = count(intent.objectCount), laterHash = null;
    while (address !== null) {
      let raw;
      try { raw = await this.#readObject(address, signal); }
      catch (error) {
        if (error.code !== 'object-not-found') throw error;
        if (!preparation) fail('preparation-required', 'Original plan pages are required before admitting this intent.');
        raw = await readVerified(preparation, address, signal);
      }
      const page = validatePage(decode(raw), remaining);
      if (laterHash !== null && page.entries.at(-1).hash >= laterHash) fail('invalid-plan', 'Object plan pages are not globally ordered.');
      await this.#ensureObject(address, raw, expected, 'prepare-plan', signal);
      laterHash = page.entries[0].hash; remaining = count(page.beforeCount); address = page.previous;
    }
    if (remaining !== 0n) fail('invalid-plan', 'Object plan ended before its admitted count.');
  }
  async #plan(intent, expected, preparation, signal) {
    let address = intent.planRoot, remaining = count(intent.objectCount), laterHash = null;
    const staged = async target => {
      try { return await this.#readObject(target, signal); }
      catch (error) {
        if (error.code !== 'object-not-found') throw error;
        if (!preparation) fail('pending-incomplete', 'Pending content is missing. Supply the original preparation store to resume.', {missingObject: target});
        const raw = await readVerified(preparation, target, signal);
        await this.#ensureObject(target, raw, expected, 'stage-content', signal); return raw;
      }
    };
    while (address !== null) {
      // Never reconstruct a missing authoritative plan from a folder scan.
      const page = validatePage(decode(await this.#readObject(address, signal)), remaining);
      if (laterHash !== null && page.entries.at(-1).hash >= laterHash) fail('invalid-plan', 'Object plan pages are not globally ordered.');
      for (let i = page.entries.length - 1; i >= 0; i--) {
        const entry = page.entries[i];
        if ((await staged(entry.hash)).length !== entry.byteLength) fail('object-size-mismatch', 'Staged object length differs from the pending plan.');
      }
      laterHash = page.entries[0].hash; remaining = count(page.beforeCount); address = page.previous;
    }
    if (remaining !== 0n) fail('invalid-plan', 'Object plan ended before its admitted count.');
  }
  async #verify(intent, phase, signal) {
    // Hash checks are not semantic proof. Trusted application code still owns
    // base/head admissibility, full reachability and the domain's change rules.
    await this.#readObject(intent.baseManifest.root, signal);
    await this.#readObject(intent.newRoot, signal);
    let open = true, active = null, readRejected = false, verifierRejected = false;
    let readFailure, verifierFailure, result;
    const rejectRead = reason => { if (!readRejected) { readRejected = true; readFailure = reason; } };
    const readObject = address => {
      if (!open) return Promise.reject(new RootTransactionError('verification-scope-closed', 'Verification read access has expired.'));
      if (active) {
        const reason = new RootTransactionError('verification-read-limit', 'Verification must read one bounded object at a time.');
        rejectRead(reason); return Promise.reject(reason);
      }
      const pending = this.#readObject(address, signal).catch(error => { rejectRead(error); throw error; });
      active = pending;
      pending.then(() => { if (active === pending) active = null; }, () => { if (active === pending) active = null; });
      return pending;
    };
    try {
      result = await this.#plans.get(intent.verificationPlan)({baseManifest: snapshot(intent.baseManifest),
        newRoot: intent.newRoot, transactionId: intent.transactionId, phase, signal, readObject});
    } catch (error) { verifierRejected = true; verifierFailure = error; }
    const unfinished = active !== null;
    open = false;
    // All admitted reads settle even when callback code throws or swallows its
    // own errors. No late read can overlap later publication or another task.
    if (active) await active.catch(() => {});
    if (verifierRejected) throw verifierFailure;
    if (readRejected) throw readFailure;
    if (unfinished) fail('unfinished-verification-read', 'Verification returned before its admitted read settled.');
    abort(signal);
    if (result !== undefined) fail('invalid-verification-result', 'Verification plans must throw on failure and return no public trust token.');
  }
  async #resume(current, intent, preparation, signal) {
    const binding = await this.#binding(intent);
    const same = target => equalBytes(encode(current), encode(target));
    if (!same(binding.admitted) && !same(binding.published)) fail('pending-manifest-mismatch', 'Manifest does not match either admitted state of its exact intent.');
    await this.#plan(intent, current, preparation, signal);
    const baseBytes = encode(intent.baseManifest, ROOT_MANIFEST_MAX_BYTES);
    await this.#ensureObject(intent.baseManifestHash, baseBytes, current, 'retain-base', signal);
    if (same(binding.admitted)) {
      await this.#verify(intent, 'before-publication', signal);
      await this.#ensureObject(binding.commitHash, binding.commitBytes, current, 'stage-commit', signal);
      current = await this.#writeManifest(current, binding.published, 'publish-root', signal);
    }
    if (!equalBytes(await this.#readObject(binding.commitHash, signal), binding.commitBytes)) fail('commit-readback-mismatch', 'Published commit differs from its admitted intent.');
    await this.#verify(intent, 'before-finalization', signal);
    current = await this.#writeManifest(current, binding.final, 'clear-pending', signal);
    return {status: 'committed', transactionId: intent.transactionId, manifest: snapshot(current)};
  }
  transact({intent: input, preparationStore, signal}) {
    // Snapshot before queuing so later caller edits cannot change the operation.
    const intent = snapshot(input);
    const preparation = preparationStore?.read?.bind(preparationStore);
    return this.#enqueue(async () => {
      const binding = await this.#binding(intent);
      let current = await this.#manifest(signal);
      if (equalBytes(encode(current), encode(binding.final))) {
        await this.#plan(intent, current, null, signal);
        if (!equalBytes(await this.#readObject(intent.baseManifestHash, signal), encode(intent.baseManifest)) ||
            !equalBytes(await this.#readObject(binding.commitHash, signal), binding.commitBytes)) fail('commit-readback-mismatch', 'Completed transaction evidence differs.');
        await this.#verify(intent, 'retry-completed', signal); await this.#exact(current, signal);
        return {status: 'already-committed', transactionId: intent.transactionId, manifest: snapshot(current)};
      }
      if (equalBytes(encode(current), encode(intent.baseManifest))) {
        await this.#preparePlan(intent, current, preparation, signal);
        current = await this.#writeManifest(current, binding.admitted, 'admit-pending', signal);
      }
      return this.#resume(current, intent, preparation, signal);
    });
  }
  recover({preparationStore, signal} = {}) {
    const preparation = preparationStore?.read?.bind(preparationStore);
    return this.#enqueue(async () => {
      const current = await this.#manifest(signal);
      if (current.pending === null) return {status: 'idle', manifest: snapshot(current)};
      return this.#resume(current, snapshot(current.pending), preparation, signal);
    });
  }
}
