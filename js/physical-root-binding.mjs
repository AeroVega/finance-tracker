import {bindPreparationRead,getOwnedPreparationReader} from './owned-preparation-reader.mjs';
import {snapshotPhysicalAdapter,getOwnedPhysicalBodyVerifier} from './physical-drive-adapter.mjs';
/** Synthetic v4 publication. Logical commits are portable; admission,
 * locators and receipts are copy-local. This does not change root protocol v3. */
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {createPagedPhysicalLocators} from './paged-physical-locators.mjs';

export const PHYSICAL_ROOT_VERSION = 4;
export const PHYSICAL_MANIFEST_FORMAT = 'finance-tracker-physical-root-manifest';
export const PORTABLE_COMMIT_FORMAT = 'finance-tracker-portable-root-commit';
export const PHYSICAL_ROOT_LIMITS = Object.freeze({objectBytes:65536, manifestBytes:16384, planEntries:32});
const INTENT = 'finance-tracker-copy-root-intent', PLAN = 'finance-tracker-copy-object-plan', RECEIPT = 'finance-tracker-copy-root-receipt';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const typed = Object.getPrototypeOf(Uint8Array.prototype), nativeLength = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const nativeBuffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get, ordinaryLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const plain = x => x !== null && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const kinds = ['data-object', 'commit-record', 'journal-event', 'migration-record', 'protocol-object'];
export class PhysicalRootError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PhysicalRootError'; this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new PhysicalRootError(code, message, details); };
const abort = signal => { if (signal?.aborted) throw new DOMException('Physical root operation cancelled.', 'AbortError'); };
function fields(x, keys) {
  if (!plain(x) || Object.getOwnPropertyNames(x).length !== keys.length || Object.getOwnPropertySymbols(x).length ||
      keys.some(k => !Object.hasOwn(x, k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), 'value'))) fail('invalid-shape', 'Unexpected fields or accessors.');
}
function id(x) { if (typeof x !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)) fail('invalid-identity', 'Expected a bounded protocol identity.'); return x; }
function hash(x) { if (typeof x !== 'string' || !/^[0-9a-f]{64}$/.test(x)) fail('invalid-hash', 'Expected lowercase SHA-256.'); return x; }
function count(x) { if (typeof x !== 'string' || !/^(0|[1-9][0-9]*)$/.test(x)) fail('invalid-count', 'Expected an exact unsigned decimal string.'); return BigInt(x); }
function owned(x, maximum = PHYSICAL_ROOT_LIMITS.objectBytes) {
  let length;
  try { length = nativeLength.call(x); ordinaryLength.call(nativeBuffer.call(x)); } catch { fail('invalid-bytes', 'Expected unshared Uint8Array bytes.'); }
  if (!(x instanceof Uint8Array) || length > maximum) fail('byte-limit', 'Expected bounded Uint8Array bytes.');
  return new Uint8Array(x);
}
function encode(x, maximum = PHYSICAL_ROOT_LIMITS.objectBytes) {
  let remaining = maximum;
  // Reconstruct owned containers from data descriptors. Calling caller-supplied
  // array map/join/toJSON methods after inspection would not preserve the bytes
  // that were inspected, even if those methods were inherited.
  function normalize(v, depth) {
    if (--remaining < 0 || depth > 24) fail('metadata-limit', 'Protocol metadata exceeds its bounded shape.');
    if (typeof v === 'string') {
      remaining -= v.length;
      if (remaining < 0 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)) fail('metadata-limit', 'Invalid or oversized protocol text.');
      return v;
    }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
    if ((!plain(v) && !Array.isArray(v)) || Object.getOwnPropertySymbols(v).length) fail('invalid-json', 'Expected plain JSON data.');
    if (Array.isArray(v)) {
      if (v.length > PHYSICAL_ROOT_LIMITS.planEntries || Object.getOwnPropertyNames(v).length !== v.length + 1) fail('metadata-limit', 'Expected a bounded dense array.');
      const result = [];
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('invalid-json', 'Array holes and accessors are not protocol data.');
        result.push(normalize(d.value, depth + 1));
      }
      return result;
    }
    const result = Object.create(null);
    for (const k in v) if (Object.hasOwn(v, k)) {
      remaining -= k.length;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d.enumerable || !Object.hasOwn(d, 'value')) fail('invalid-json', 'Accessors and hidden fields are not protocol data.');
      result[k] = normalize(d.value, depth + 1);
    }
    if (Object.getOwnPropertyNames(v).length !== Object.keys(result).length) fail('invalid-json', 'Hidden fields are not protocol data.');
    return result;
  }
  const raw = encoder.encode(canonicalizeJcs(normalize(x, 0)));
  if (raw.length > maximum) fail('metadata-limit', 'Encoded metadata exceeds its byte budget.');
  return raw;
}
const copy = (x, maximum = PHYSICAL_ROOT_LIMITS.objectBytes) => JSON.parse(decoder.decode(encode(x, maximum)));
const same = (a, b) => equal(encode(a), encode(b));
async function digest(raw) { return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', raw)), x => x.toString(16).padStart(2, '0')).join(''); }
function decode(raw, maximum = PHYSICAL_ROOT_LIMITS.objectBytes) {
  raw = owned(raw, maximum); let x;
  try { x = JSON.parse(decoder.decode(raw)); } catch { fail('invalid-json', 'Expected UTF-8 JSON.'); }
  if (!equal(raw, encode(x, maximum))) fail('noncanonical-json', 'Protocol bytes must be canonical JSON.');
  return x;
}
function pointer(x) { fields(x, ['fileId', 'sha256']); id(x.fileId); hash(x.sha256); return x; }
function typedHead(x) { fields(x, ['format', 'version', 'sha256']); id(x.format); hash(x.sha256); if (!Number.isSafeInteger(x.version) || x.version < 1) fail('invalid-version', 'Expected an explicit positive format version.'); return x; }
function commit(x) {
  fields(x, ['format', 'version', 'databaseId', 'parent', 'revision', 'previousRoot', 'root', 'transactionId', 'operation', 'semanticVersion', 'changeEvidenceRoot']);
  if (x.format !== PORTABLE_COMMIT_FORMAT || x.version !== 4) fail('unsupported-commit', 'Expected portable logical commit v4.');
  id(x.databaseId); id(x.transactionId); id(x.operation); id(x.semanticVersion); hash(x.root);
  const revision = count(x.revision);
  if ((x.parent === null) !== (revision === 0n) || (x.previousRoot === null) !== (revision === 0n)) fail('invalid-lineage', 'Only revision zero has no parent and previous root.');
  if (x.parent !== null) typedHead(x.parent);
  if (x.previousRoot !== null) hash(x.previousRoot);
  if (x.changeEvidenceRoot !== null) hash(x.changeEvidenceRoot);
  return x;
}
export function createPortableLogicalCommit({databaseId, parent, revision, previousRoot, root, transactionId, operation, semanticVersion, changeEvidenceRoot = null}) {
  return copy(commit({format:PORTABLE_COMMIT_FORMAT, version:4, databaseId, parent, revision, previousRoot, root, transactionId, operation, semanticVersion, changeEvidenceRoot}));
}
function manifest(x, clean = false) {
  fields(x, ['format', 'version', 'databaseId', 'copyId', 'role', 'syntheticOnly', 'lifecycleStatus', 'storageBinding', 'revision', 'root', 'headCommit', 'locatorRoot', 'receiptHead', 'pending', ...(plain(x) && Object.hasOwn(x,'sourceEvidence') ? ['sourceEvidence'] : [])]);
  if (x.format !== PHYSICAL_MANIFEST_FORMAT || x.version !== 4 || x.syntheticOnly !== true || x.lifecycleStatus !== 'active') fail('unsupported-manifest', 'Only an active synthetic v4 manifest is supported.');
  if(Object.hasOwn(x,'sourceEvidence')) {fields(x.sourceEvidence,['version','sha256']);if(x.sourceEvidence.version!==1)fail('unsupported-source-evidence','Unsupported source evidence version.');hash(x.sourceEvidence.sha256);}
  id(x.databaseId); id(x.copyId); count(x.revision); hash(x.root); typedHead(x.headCommit); pointer(x.locatorRoot);
  if (!['primary', 'backup'].includes(x.role)) fail('invalid-role', 'Unsupported physical copy role.');
  fields(x.storageBinding, ['provider', 'folderId']); id(x.storageBinding.folderId);
  if (!['synthetic-adapter', 'google-drive'].includes(x.storageBinding.provider)) fail('unsupported-binding', 'Unsupported physical provider binding.');
  if (x.receiptHead !== null) pointer(x.receiptHead);
  if (x.pending !== null) {
    if (clean) fail('pending-base', 'The verified base must be clean.');
    fields(x.pending, ['state', 'intent', 'locatorRoot', 'receipt']);
    if (!['admitted', 'ready', 'published'].includes(x.pending.state)) fail('invalid-state', 'Unsupported pending state.');
    intent(x.pending.intent);
    if (x.pending.state === 'admitted') {
      if (x.pending.locatorRoot !== null || x.pending.receipt !== null) fail('invalid-state', 'Admitted state cannot contain ready evidence.');
    } else { pointer(x.pending.locatorRoot); pointer(x.pending.receipt); }
  }
  return x;
}
/** Read-only envelope admission, including interrupted transaction states. */
export function validatePhysicalRootManifest(value) { return copy(manifest(value)); }
export function createPhysicalRootManifest({databaseId, copyId, folderId, provider = 'synthetic-adapter', role = 'primary', revision, root, headCommit, locatorRoot, receiptHead = null, sourceEvidence = null}) {
  return copy(manifest({format:PHYSICAL_MANIFEST_FORMAT, version:4, databaseId, copyId, role, syntheticOnly:true,
    lifecycleStatus:'active', storageBinding:{provider, folderId}, revision, root, headCommit, locatorRoot, receiptHead, pending:null, ...(sourceEvidence===null?{}:{sourceEvidence})}, true));
}
function intent(x) {
  fields(x, ['format', 'version', 'transactionId', 'baseManifest', 'baseManifestHash', 'logicalCommit', 'logicalHead', 'planRoot', 'objectCount', 'verificationPlan']);
  if (x.format !== INTENT || x.version !== 4) fail('unsupported-intent', 'Unsupported copy intent.');
  id(x.transactionId); id(x.verificationPlan); manifest(x.baseManifest, true); hash(x.baseManifestHash); commit(x.logicalCommit); typedHead(x.logicalHead); pointer(x.planRoot);
  if (x.baseManifest.role !== 'primary') fail('read-only-copy', 'Backup copies cannot admit changes.');
  if (count(x.objectCount) < 2n || x.transactionId !== x.logicalCommit.transactionId || x.verificationPlan !== x.logicalCommit.semanticVersion ||
      x.logicalCommit.databaseId !== x.baseManifest.databaseId || x.logicalCommit.revision !== String(count(x.baseManifest.revision) + 1n) ||
      !same(x.logicalCommit.parent, x.baseManifest.headCommit) || x.logicalCommit.previousRoot !== x.baseManifest.root ||
      x.logicalHead.format !== PORTABLE_COMMIT_FORMAT || x.logicalHead.version !== 4) fail('intent-mismatch', 'Intent does not bind the exact logical change.');
  return x;
}
function descriptor(x) {
  const journal = x?.kind === 'journal-event';
  fields(x, ['kind', 'identity', 'sha256', 'byteLength', ...(journal ? ['transactionId', 'sequence'] : [])]);
  if (!kinds.includes(x.kind)) fail('invalid-kind', 'Unsupported typed object kind.');
  id(x.identity); hash(x.sha256);
  if (x.kind === 'data-object' && x.identity !== x.sha256) fail('invalid-identity', 'Data identity must be its content hash.');
  if (!Number.isSafeInteger(x.byteLength) || x.byteLength < 0 || x.byteLength > PHYSICAL_ROOT_LIMITS.objectBytes) fail('byte-limit', 'Invalid body byte length.');
  if (journal) { id(x.transactionId); if (!Number.isSafeInteger(x.sequence) || x.sequence < 0) fail('invalid-sequence', 'Invalid journal sequence.'); }
  return x;
}
const key = x => x.kind + ':' + x.sha256;
function planEntry(x) { const {fileId, ...d} = x; id(fileId); descriptor(d); return x; }
const locatorEntry = x => { const {byteLength, ...e} = x; return e; };
const query = x => ({kind:x.kind, sha256:x.sha256});
const physicalKind = kind => kind === 'data-object' ? 'snapshot-object' : kind;

/** One explicit synthetic copy. No provider CAS, scans, GC, abort or fallback IDs.
 * readManifest/writeManifest and direct physical methods have separate contracts.
 * See ROOT_TRANSACTION_PROTOCOL.md, protocol-4 companion, for lifecycle requirements. */
export class PhysicalRootBinding {
  #captureOperationGuard; #operationGuard=null;
  #adapter; #folderId; #assert; #assertStaging; #verifiers; #lineage; #baselines = new WeakMap(); #queue = Promise.resolve(); #limits; #verifySourceEvidence;
  constructor({adapter, assertWritable, assertStaging=assertWritable, verificationPlans, lineageVerifiers = new Map(), locatorOptions = {}, verifySourceEvidence, captureOperationGuard = () => () => {}}) {
    if (!adapter || ['readMetadata', 'readBytes', 'allocateFileId', 'createImmutable', 'readManifest', 'writeManifest'].some(k => typeof adapter[k] !== 'function') ||
        typeof assertWritable !== 'function' || typeof assertStaging !== 'function' || !(verificationPlans instanceof Map) || !verificationPlans.size || !(lineageVerifiers instanceof Map)) fail('invalid-adapter', 'Direct physical storage, exact manifest access, ownership and verifier registries are required.');
    if(typeof captureOperationGuard!=='function')fail('invalid-adapter','An operation guard factory must be callable.');
    this.#captureOperationGuard=captureOperationGuard;
    this.#folderId = id(adapter.folderId);
    this.#adapter=snapshotPhysicalAdapter(adapter);
    this.#assert = assertWritable; this.#assertStaging=assertStaging; this.#verifiers = new Map(verificationPlans); this.#lineage = new Map(lineageVerifiers);
    this.#verifySourceEvidence=verifySourceEvidence;
    this.#limits = copy(locatorOptions);
    if (Object.keys(this.#limits).some(k => !['maxNodeBytes', 'maxEntries', 'maxChildren'].includes(k))) fail('invalid-options', 'Only locator page budgets can be configured.');
    for (const [name, fn] of [...this.#verifiers, ...this.#lineage]) if (typeof name !== 'string' || typeof fn !== 'function') fail('invalid-verifier', 'Verifier registrations require stable names and executable code.');
  }
  #enqueue(fn) {
    // Capture before entering the queue. A later application session must not
    // authorize the continuation of an older admitted operation.
    const guard=this.#captureOperationGuard();
    if(typeof guard!=='function')fail('invalid-guard','An operation guard must be callable.');
    const result=this.#queue.then(async()=>{
      this.#operationGuard=guard;
      try {this.#scope();const result=await fn();this.#scope();return result;}
      finally {this.#operationGuard=null;}
    });
    this.#queue=result.catch(()=>{});return result;
  }
  #scope() { if(this.#operationGuard?.()!==undefined)fail('invalid-guard','Operation guards must throw on failure and return undefined.'); if (this.#adapter.folderId !== this.#folderId) fail('copy-mismatch', 'The original adapter changed its physical destination.'); }
  async #manifest(signal) {
    this.#scope(); abort(signal); const raw = owned(await this.#adapter.readManifest({maxBytes:PHYSICAL_ROOT_LIMITS.manifestBytes, signal}), PHYSICAL_ROOT_LIMITS.manifestBytes);
    this.#scope();abort(signal); const m = manifest(decode(raw, PHYSICAL_ROOT_LIMITS.manifestBytes));
    if (m.storageBinding.folderId !== this.#adapter.folderId) fail('copy-mismatch', 'Manifest belongs to another physical destination.');
    return m;
  }
  async #exact(expected, signal) { if (!same(await this.#manifest(signal), expected)) fail('base-conflict', 'The exact physical manifest changed.'); }
  async #owned(expected, signal, staging=false) {
    this.#scope(); abort(signal); const result = await (staging?this.#assertStaging:this.#assert)(copy(expected), {signal}); abort(signal); this.#scope();
    if (result !== undefined) fail('invalid-guard', 'Ownership must throw on failure and return undefined.');
  }
  async #guard(expected,signal) {await this.#owned(expected,signal);await this.#exact(expected,signal);this.#scope();abort(signal);}
  #tree(m, expected, signal) {
    return createPagedPhysicalLocators(this.#adapter, {...this.#limits, databaseId:m.databaseId, copyId:m.copyId, folderId:m.storageBinding.folderId,
      assertWritable:async () => this.#owned(expected, signal, true)});
  }
  async #read(ref, kind, transactionId, signal) {
    this.#scope(); pointer(ref); abort(signal);
    const validate = input => {
      const m = copy(input, PHYSICAL_ROOT_LIMITS.manifestBytes);
      if (m.id !== ref.fileId || m.trashed !== false || !Array.isArray(m.parents) || !m.parents.includes(this.#adapter.folderId) ||
          m.appProperties?.financeTrackerHash !== ref.sha256 || m.appProperties?.financeTrackerKind !== physicalKind(kind) ||
          (transactionId !== undefined && m.appProperties?.financeTrackerTransaction !== transactionId)) fail('metadata-mismatch', 'Direct physical metadata does not match its admitted reference.');
      count(m.version); if (count(m.size) > BigInt(PHYSICAL_ROOT_LIMITS.objectBytes)) fail('byte-limit', 'Metadata declares an oversized body.'); return m;
    };
    const before = validate(await this.#adapter.readMetadata(ref.fileId, {maxBytes:PHYSICAL_ROOT_LIMITS.manifestBytes, signal})); abort(signal);
    this.#scope(); const raw = owned(await this.#adapter.readBytes(ref.fileId, {kind:physicalKind(kind), maxBytes:PHYSICAL_ROOT_LIMITS.objectBytes, signal})); abort(signal);
    if (String(raw.length) !== before.size || await digest(raw) !== ref.sha256) fail('hash-mismatch', 'Direct physical bytes do not match their hash and size.'); abort(signal);
    this.#scope(); const after = validate(await this.#adapter.readMetadata(ref.fileId, {maxBytes:PHYSICAL_ROOT_LIMITS.manifestBytes, signal})); abort(signal);
    if (before.version !== after.version || before.size !== after.size) fail('version-mismatch', 'Direct physical content changed during verification.'); return raw;
  }
  async #mutation(expected, signal, perform, authoritative = false, operation = 'immutable-create') {
    this.#scope();abort(signal);
    let open = true, active = null, calls = 0, rejected = false, rejection, failed = false, failure;
    const beforeMutation = () => {
      if (!open || active) { rejected = true; rejection = new PhysicalRootError('guard-scope', 'Mutation guard is closed or overlapping.'); return Promise.reject(rejection); }
      const pending = (authoritative ? this.#guard(expected,signal) : this.#owned(expected,signal,true)).then(() => { calls++; }).catch(e => { rejected = true; rejection = e; throw e; }); active = pending;
      pending.then(() => { if (active === pending) active = null; }, () => { if (active === pending) active = null; }); return pending;
    };
    try { await perform(beforeMutation); } catch (e) { failed = true; failure = e; }
    open = false; const unfinished = active !== null; if (active) await active.catch(() => {});
    if (rejected && calls === 0) throw rejection;
    if (calls === 0) {
      if (failed) fail('adapter-precondition-failed', 'The physical adapter failed before completing its mutation guard.', {operation, failure});
      fail('adapter-contract', 'Every durable attempt must await a live mutation guard.', {operation});
    }
    return {failed, failure, unresolved:rejected || unfinished, guardFailure:rejection};
  }
  async #ensure(ref, raw, kind, transactionId, expected, signal, knownAbsent = false) {
    raw = owned(raw); if (await digest(raw) !== ref.sha256) fail('hash-mismatch', 'Prepared bytes differ from the fixed admitted hash.');
    if (!knownAbsent) {
      try { if (!equal(await this.#read(ref, kind, transactionId, signal), raw)) fail('readback-mismatch', 'Existing fixed-ID bytes differ.'); return; }
      catch (e) { if (e?.code !== 'object-not-found') throw e; }
    }
    const outcome = await this.#mutation(expected, signal, beforeMutation => this.#adapter.createImmutable({fileId:ref.fileId, name:'ft-physical-' + ref.sha256 + '.bin',
      kind:physicalKind(kind), transactionId, content:new Uint8Array(raw), expectedSha256:ref.sha256, maxBytes:PHYSICAL_ROOT_LIMITS.objectBytes, beforeMutation, signal}), false, 'immutable-create');
    let actual;
    if (outcome.unresolved) fail('write-unresolved', 'A later failed or unfinished guard leaves an earlier create unresolved.', {reference:copy(ref), guardFailure:outcome.guardFailure});
    if (signal?.aborted) fail('write-unresolved', 'Cancellation after a guarded create requires exact-ID recovery.', {reference:copy(ref), cancelled:true});
    try { actual = await this.#read(ref, kind, transactionId, signal); }
    catch (e) { fail('write-unresolved', 'Inspect this exact physical ID; no replacement ID is authorized.', {reference:copy(ref), failed:outcome.failed, failure:outcome.failure, readFailure:e}); }
    if (!equal(actual, raw)) fail('readback-mismatch', 'Immutable bytes failed exact readback.');
  }
  async #newObject(raw, kind, transactionId, expected, signal) {
    raw = owned(raw); const sha256 = await digest(raw); abort(signal);
    this.#scope();const fileId = id(await this.#adapter.allocateFileId({signal})); abort(signal);this.#scope();
    const ref = {fileId, sha256}; await this.#ensure(ref, raw, kind, transactionId, expected, signal); return ref;
  }
  async #writeManifest(expected, next, signal) {
    manifest(next); const raw = encode(next, PHYSICAL_ROOT_LIMITS.manifestBytes);
    const boundary = 'root-manifest-' + (next.pending?.state ?? 'clean');
    const outcome = await this.#mutation(expected, signal, beforeMutation => this.#adapter.writeManifest(new Uint8Array(raw), {beforeMutation, signal}), true, boundary);
    let current;
    if (outcome.unresolved) fail('write-unresolved', 'A later failed or unfinished guard leaves an earlier manifest attempt unresolved.', {intendedManifestHash:await digest(raw), guardFailure:outcome.guardFailure});
    if (signal?.aborted) fail('write-unresolved', 'Cancellation after a guarded manifest attempt requires exact-state recovery.', {cancelled:true});
    try { current = await this.#manifest(signal); }
    catch (e) { fail('write-unresolved', 'Manifest outcome requires exact-state recovery.', {failed:outcome.failed, failure:outcome.failure, readFailure:e}); }
    if (same(current, next)) return current;
    if (!same(current, expected)) fail('base-conflict', 'Manifest matches neither the exact prior state nor the intended next state.');
    fail('write-unresolved', 'The intended manifest state was not observed.', {failed:outcome.failed, failure:outcome.failure});
  }
  async #scoped(tree, root, baseRoot, signal, callback) {
    let open = true, active = null, rejected = false, rejection, failed = false, failure, result;
    const reject = e => { if (!rejected) { rejected = true; rejection = e; } };
    const reader = locator => input => {
      if (!open) return Promise.reject(new PhysicalRootError('verification-scope-closed', 'Verifier read access has expired.'));
      if (active) { const e = new PhysicalRootError('verification-read-limit', 'Read one bounded typed object at a time.'); reject(e); return Promise.reject(e); }
      let q;
      try { q = copy(input); fields(q, ['kind', 'sha256']); if (!kinds.includes(q.kind)) fail('invalid-kind', 'Typed lookup needs a supported kind.'); hash(q.sha256); }
      catch (e) { reject(e); return Promise.reject(e); }
      const pending = tree.readObject(locator, q, {signal}).catch(e => { reject(e); throw e; }); active = pending;
      pending.then(() => { if (active === pending) active = null; }, () => { if (active === pending) active = null; }); return pending;
    };
    try { result = await callback({readObject:reader(root), readBaseObject:reader(baseRoot ?? root)}); } catch (e) { failed = true; failure = e; }
    open = false; const unfinished = active !== null; if (active) await active.catch(() => {});
    if (failed) throw failure; if (rejected) throw rejection;
    if (unfinished) fail('unfinished-verification-read', 'Verifier returned with an unsettled read.'); abort(signal); return result;
  }
  async #domain(tree, root, baseRoot, m, c, base, phase, signal) {
    const fn = this.#verifiers.get(c.semanticVersion);
    if (!fn) fail('verification-plan-unavailable', 'A retained semantic verifier is unavailable.');
    const result = await this.#scoped(tree, root, baseRoot, signal, reads => fn({...reads, manifest:copy(m), commit:copy(c), baseManifest:base ? copy(base) : null, phase, signal}));
    if (result !== undefined) fail('invalid-verification-result', 'Domain verification must throw on failure and return undefined.');
  }
  async #history(tree, locator, m, signal) {
    let head = m.headCommit, revision = count(m.revision), root = m.root;
    while (head !== null) {
      abort(signal); const raw = await tree.readObject(locator, {kind:'commit-record', sha256:head.sha256}, {signal});
      let c;
      if (head.format === PORTABLE_COMMIT_FORMAT && head.version === 4) {
        c = commit(decode(raw));
        await this.#domain(tree, locator, null, {...m, revision:String(revision), root, headCommit:head, pending:null}, c, null, 'history', signal);
      } else {
        const fn = this.#lineage.get(head.format + ':' + head.version);
        if (!fn) fail('lineage-verifier-unavailable', 'Historical format requires its registered version-specific verifier.');
        c = await this.#scoped(tree, locator, null, signal, reads => fn({...reads, reference:copy(head), bytes:new Uint8Array(raw), signal}));
        c = copy(c); fields(c, ['databaseId', 'revision', 'root', 'parent', 'previousRoot']);
        id(c.databaseId); count(c.revision); hash(c.root); if (c.parent !== null) typedHead(c.parent); if (c.previousRoot !== null) hash(c.previousRoot);
      }
      if (c.databaseId !== m.databaseId || count(c.revision) !== revision || c.root !== root || (c.parent === null) !== (revision === 0n) ||
          (c.previousRoot === null) !== (revision === 0n)) fail('history-mismatch', 'Typed logical lineage does not match the selected root and revision.');
      await tree.readObject(locator, {kind:'data-object', sha256:c.root}, {signal});
      if (c.changeEvidenceRoot != null) await tree.readObject(locator, {kind:'data-object', sha256:c.changeEvidenceRoot}, {signal});
      head = c.parent; root = c.previousRoot; revision--;
    }
    if (revision !== -1n) fail('history-mismatch', 'Logical history did not reach genesis.');
    let commits = 0n;
    for await (const e of tree.entries(locator, {signal})) if (e.kind === 'commit-record') commits++;
    if (commits !== count(m.revision) + 1n) fail('disconnected-history', 'Catalog commit count does not match the complete selected ancestry.');
    if(m.sourceEvidence) {
      if(typeof this.#verifySourceEvidence!=='function')fail('source-evidence-verifier-required','This copy requires its authenticated source evidence verifier.');
      const evidence=await this.#scoped(tree,locator,null,signal,reads=>this.#verifySourceEvidence({...reads,evidenceRoot:m.sourceEvidence.sha256,manifest:copy(m),signal}));
      if(evidence!==undefined)fail('invalid-verification-result','Source evidence verification must throw on failure and return undefined.');
    }
  }
  verifyCopy({signal} = {}) {
    return this.#enqueue(async () => {
      const m=await this.#manifest(signal); manifest(m,true);
      await this.#guard(m,signal); const tree=this.#tree(m,m,signal);
      await tree.verify(m.locatorRoot,{signal}); await this.#history(tree,m.locatorRoot,m,signal);
      await this.#receiptChain(m,m,signal); await this.#guard(m,signal);
      return copy(m);
    });
  }
  verifyBaseline({signal,expectedManifest} = {}) {
    const expected = expectedManifest === undefined ? undefined : copy(expectedManifest);
    return this.#enqueue(async () => {
      const m = await this.#manifest(signal); manifest(m, true);
      if (expected !== undefined && canonicalizeJcs(expected) !== canonicalizeJcs(m)) fail('base-conflict', 'Reopen the current root before saving.');
      if (m.role !== 'primary') fail('read-only-copy', 'A backup copy cannot supply a writable baseline.');
      await this.#guard(m, signal); const tree = this.#tree(m, m, signal);
      await tree.verify(m.locatorRoot, {signal}); await this.#history(tree, m.locatorRoot, m, signal);
      await this.#receiptChain(m, m, signal); await this.#guard(m, signal);
      const handle = Object.freeze({}); this.#baselines.set(handle, copy(m)); return handle;
    });
  }
  prepare({verifiedBase, root, transactionId, operation, semanticVersion, changeEvidenceRoot = null, objects, preparationStore, signal}) {
    const base = this.#baselines.get(verifiedBase), args = copy({root, transactionId, operation, semanticVersion, changeEvidenceRoot});
    const read = bindPreparationRead(preparationStore);
    return this.#enqueue(async () => {
      if (!base) fail('verified-baseline-required', 'Use a privately verified baseline from this binding instance.');
      if (!this.#verifiers.has(args.semanticVersion)) fail('verification-plan-unavailable', 'The requested semantic verifier is unavailable.');
      if (!read || !objects || (!objects[Symbol.iterator] && !objects[Symbol.asyncIterator])) fail('invalid-preparation', 'A typed preparation reader and descriptor stream are required.');
      await this.#guard(base, signal);
      const logical = createPortableLogicalCommit({databaseId:base.databaseId, parent:base.headCommit, revision:String(count(base.revision) + 1n), previousRoot:base.root, ...args});
      const commitRaw = encode(logical), baseRaw = encode(base, PHYSICAL_ROOT_LIMITS.manifestBytes);
      const commitHash = await digest(commitRaw), baseHash = await digest(baseRaw), tree = this.#tree(base, base, signal);
      const generated = [
        {kind:'commit-record', identity:commitHash, sha256:commitHash, byteLength:commitRaw.length},
        {kind:'protocol-object', identity:baseHash, sha256:baseHash, byteLength:baseRaw.length}
      ].sort((a, b) => key(a) < key(b) ? -1 : 1);
      let previousInput = null, previous = null, entries = [], total = 0n, planRoot = null, generatedAt = 0;
      const flush = async () => {
        if (!entries.length) return;
        const raw = encode({format:PLAN, version:4, databaseId:base.databaseId, copyId:base.copyId, transactionId,
          previous:planRoot, beforeCount:String(total), entries});
        planRoot = await this.#newObject(raw, 'protocol-object', transactionId, base, signal);
        total += BigInt(entries.length); entries = [];
      };
      const add = async d => {
        abort(signal); if (previous !== null && key(d) <= previous) fail('invalid-plan', 'Plan kind/hash keys must be unique and ordered.');
        if (await tree.get(base.locatorRoot, query(d), {signal}) !== undefined) fail('existing-object', 'Plan additions must not rebind an existing immutable object.');
        const raw = d.sha256 === commitHash && d.kind === 'commit-record' ? commitRaw : d.sha256 === baseHash && d.kind === 'protocol-object' ? baseRaw : owned(await read(query(d), {maxBytes:PHYSICAL_ROOT_LIMITS.objectBytes, signal}));
        if (raw.length !== d.byteLength || await digest(raw) !== d.sha256) fail('preparation-mismatch', 'Preparation does not match its descriptor.');
        this.#scope();abort(signal); const fileId = id(await this.#adapter.allocateFileId({signal})); abort(signal);this.#scope();
        entries.push({...d, fileId}); previous = key(d); if (entries.length === PHYSICAL_ROOT_LIMITS.planEntries) await flush();
      };
      for await (const input of objects) {
        const d = descriptor(copy(input));
        if (previousInput !== null && key(d) <= previousInput) fail('invalid-plan', 'Input descriptors must have ascending unique kind/hash keys.');
        previousInput = key(d);
        while (generatedAt < generated.length && key(generated[generatedAt]) <= key(d)) await add(generated[generatedAt++]);
        await add(d);
      }
      while (generatedAt < generated.length) await add(generated[generatedAt++]);
      await flush(); await this.#guard(base, signal);
      const value = {format:INTENT, version:4, transactionId, baseManifest:copy(base), baseManifestHash:baseHash, logicalCommit:logical,
        logicalHead:{format:PORTABLE_COMMIT_FORMAT, version:4, sha256:commitHash}, planRoot, objectCount:String(total), verificationPlan:semanticVersion};
      intent(value); encode({...base, pending:{state:'admitted', intent:value, locatorRoot:null, receipt:null}}, PHYSICAL_ROOT_LIMITS.manifestBytes);
      return copy(value);
    });
  }
  async #binding(value) {
    intent(value);
    if (!this.#verifiers.has(value.verificationPlan)) fail('verification-plan-unavailable', 'The admitted verifier is unavailable.');
    if (await digest(encode(value.baseManifest, PHYSICAL_ROOT_LIMITS.manifestBytes)) !== value.baseManifestHash ||
        await digest(encode(value.logicalCommit)) !== value.logicalHead.sha256) fail('intent-mismatch', 'Intent hashes do not bind exact base and portable commit bytes.');
    return {...value.baseManifest, pending:{state:'admitted', intent:copy(value), locatorRoot:null, receipt:null}};
  }
  async *#plan(value, signal) {
    let ref = value.planRoot, remaining = count(value.objectCount), later = null;
    while (ref !== null) {
      const p = decode(await this.#read(ref, 'protocol-object', value.transactionId, signal));
      fields(p, ['format', 'version', 'databaseId', 'copyId', 'transactionId', 'previous', 'beforeCount', 'entries']);
      if (p.format !== PLAN || p.version !== 4 || p.databaseId !== value.baseManifest.databaseId || p.copyId !== value.baseManifest.copyId ||
          p.transactionId !== value.transactionId || !Array.isArray(p.entries) || !p.entries.length || p.entries.length > PHYSICAL_ROOT_LIMITS.planEntries ||
          count(p.beforeCount) + BigInt(p.entries.length) !== remaining || (p.previous === null) !== (count(p.beforeCount) === 0n)) fail('invalid-plan', 'Direct plan counts, identity or links disagree.');
      if (p.previous !== null) pointer(p.previous);
      let previous = null;
      for (const e of p.entries) {
        planEntry(e); if ((previous !== null && key(e) <= previous) || (later !== null && key(e) >= later)) fail('invalid-plan', 'Plan keys are duplicated or reordered.'); previous = key(e);
      }
      for (const e of p.entries) yield copy(e);
      remaining = count(p.beforeCount); later = key(p.entries[0]); ref = p.previous;
    }
    if (remaining !== 0n) fail('invalid-plan', 'Plan ended before its exact admitted count.');
  }
  async #preflight(value, tree, signal) {
    let generated = 0;
    const fileIds = new Set(), identities = new Set(), batch = [];
    const concurrency = getOwnedPhysicalBodyVerifier(this.#adapter) ? 8 : 1;
    const inspect = async e => {
      this.#scope(); abort(signal);
      let exists = false;
      try { await this.#adapter.readMetadata(e.fileId, {maxBytes:PHYSICAL_ROOT_LIMITS.manifestBytes, signal}); exists = true; }
      catch (error) { if (error?.code !== 'object-not-found') throw error; }
      if (exists) {
        let raw;
        try { raw = await this.#read({fileId:e.fileId,sha256:e.sha256},e.kind,e.transactionId ?? value.transactionId,signal); }
        catch { fail('physical-id-in-use','A planned ID is occupied by different evidence.'); }
        if (raw.length !== e.byteLength) fail('physical-id-in-use','Staged fixed ID has the wrong size.');
      }
    };
    const drain = async () => {
      // Reads only: publication/staging cannot begin until every check settles.
      // Custom providers retain serial calls; the owned physical adapter tracks
      // each read's verification lifetime and rejects obsolete results.
      const results = await Promise.allSettled(batch.splice(0).map(inspect));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    };
    for await (const e of this.#plan(value, signal)) {
      if (fileIds.has(e.fileId) || identities.has(e.kind + ':' + e.identity)) fail('invalid-plan','Duplicate planned file or typed identity.');
      fileIds.add(e.fileId); identities.add(e.kind + ':' + e.identity);
      let expected;
      if (e.kind === 'commit-record') {
        if (e.sha256 !== value.logicalHead.sha256) fail('invalid-plan', 'A transaction adds exactly its one portable logical commit.');
        expected = encode(value.logicalCommit); generated++;
      } else if (e.kind === 'protocol-object' && e.sha256 === value.baseManifestHash) {
        expected = encode(value.baseManifest, PHYSICAL_ROOT_LIMITS.manifestBytes); generated++;
      }
      if (expected && (e.identity !== e.sha256 || e.byteLength !== expected.length)) fail('invalid-plan', 'Generated evidence descriptors must preserve exact identities and lengths.');
      // Typed identity/file uniqueness is checked by the three locator indexes
      // before admission, without quadratic plan scans or whole-catalog scans.
      batch.push(e);
      if (batch.length === concurrency) await drain();
    }
    if (generated !== 2) fail('invalid-plan', 'Plan must include the exact logical commit and retained base manifest before admission.');
    await drain();
  }

  async #stageWithPrefetchedReads(value, expected, preparation, signal) {
    const readOwned=getOwnedPreparationReader(preparation);
    if(!readOwned)fail('invalid-preparation','Prefetched staging requires an owned byte reader.');
    let generated = 0;
    const batch = [];
    const stageBatch = async () => {
      let readFailure, readFailed = false;
      // Own at most four descriptors/complete bodies. A missing read is local
      // to this batch, not a reusable absence proof. No writes overlap probes.
      const results = await Promise.all(batch.splice(0).map(async item => {
        try {
          const raw = await this.#read({fileId:item.entry.fileId, sha256:item.entry.sha256}, item.entry.kind,
            item.entry.transactionId ?? value.transactionId, signal);
          return {...item, raw};
        } catch (error) {
          if (error?.code === 'object-not-found') return {...item, missing:true};
          if (!readFailed) { readFailed = true; readFailure = error; }
          return {...item, error};
        }
      }));
      if (readFailed) throw readFailure;
      this.#scope(); abort(signal);
      // Validate every occupied descriptor before starting this batch's writes.
      for (const {entry:e, deterministic, raw, missing} of results) {
        if (!missing && (raw.length !== e.byteLength || (deterministic && !equal(raw, deterministic))))
          fail('body-mismatch', 'Staged body differs from the admitted plan.');
      }
      let writeFailed = false, writeFailure;
      const pending = [];
      try {
        for (const {entry:e, deterministic, missing} of results) {
          if (writeFailed) throw writeFailure;
          if (!missing) continue;
          this.#scope(); abort(signal);
          if (!deterministic && !preparation) fail('pending-incomplete', 'Supply the original preparation bytes; the pending fixed IDs must be preserved.');
          // Owned byte reads retain descriptor order. No external preparation
          // callback runs here; each result is owned before the next read.
          const raw = deterministic ?? owned(await readOwned(e.sha256));
          if (raw.length !== e.byteLength) fail('body-mismatch', 'Prepared body differs from the admitted plan.');
          if (writeFailed) throw writeFailure;
          pending.push(this.#ensure({fileId:e.fileId, sha256:e.sha256}, raw, e.kind,
            e.transactionId ?? value.transactionId, expected, signal, true).catch(error => {
              if (!writeFailed) { writeFailed = true; writeFailure = error; }
            }));
        }
        await Promise.all(pending);
        if (writeFailed) throw writeFailure;
      } catch (error) {
        await Promise.all(pending);
        if (writeFailed && error?.code === 'verification-scope-closed') throw writeFailure;
        throw error;
      } finally { await Promise.all(pending); }
    };
    for await (const e of this.#plan(value, signal)) {
      let deterministic;
      if (e.kind === 'commit-record' && e.sha256 === value.logicalHead.sha256) { deterministic = encode(value.logicalCommit); generated++; }
      if (e.kind === 'protocol-object' && e.sha256 === value.baseManifestHash) { deterministic = encode(value.baseManifest, PHYSICAL_ROOT_LIMITS.manifestBytes); generated++; }
      batch.push({entry:e, deterministic});
      if (batch.length === 4) await stageBatch();
    }
    await stageBatch();
    if (generated !== 2) fail('invalid-plan', 'Plan must include exact portable commit and retained base-manifest evidence.');
  }
  async #stage(value, expected, preparation, signal, allowWrites = true) {
    if (allowWrites && getOwnedPhysicalBodyVerifier(this.#adapter) && getOwnedPreparationReader(preparation))
      return this.#stageWithPrefetchedReads(value, expected, preparation, signal);
    let generated = 0, stagingFailed = false, stagingFailure;
    const pending = [];
    const drain = async () => {
      await Promise.allSettled(pending.splice(0));
      if (stagingFailed) throw stagingFailure;
    };
    // Preparation and plan enumeration remain serial for custom providers.
    // Only independent fixed-ID immutable writes overlap; authority publication
    // cannot start until every issued operation has settled, including failures.
    try {
      for await (const e of this.#plan(value, signal)) {
        if (stagingFailed) throw stagingFailure;
        let deterministic;
        if (e.kind === 'commit-record' && e.sha256 === value.logicalHead.sha256) { deterministic = encode(value.logicalCommit); generated++; }
        if (e.kind === 'protocol-object' && e.sha256 === value.baseManifestHash) { deterministic = encode(value.baseManifest, PHYSICAL_ROOT_LIMITS.manifestBytes); generated++; }
        let raw,verifiedLength;
        try {
          const verifyBody=!deterministic&&!allowWrites?getOwnedPhysicalBodyVerifier(this.#adapter):null;
          if(verifyBody){
            this.#scope();abort(signal);
            const result=await verifyBody({folderId:this.#folderId,fileId:e.fileId,sha256:e.sha256,kind:physicalKind(e.kind),
              transactionId:e.transactionId??value.transactionId,maxBytes:PHYSICAL_ROOT_LIMITS.objectBytes,signal});
            this.#scope();abort(signal);verifiedLength=result.byteLength;
          }else raw = await this.#read({fileId:e.fileId, sha256:e.sha256}, e.kind, e.transactionId ?? value.transactionId, signal);
        }
        catch (error) {
          if (error?.code !== 'object-not-found') throw error;
          if (!allowWrites) fail('pending-incomplete', 'Pinned ready or completed evidence is missing; this protocol will not rewrite it.');
          if (!deterministic && !preparation) fail('pending-incomplete', 'Supply the original preparation bytes; the pending fixed IDs must be preserved.');
          raw = deterministic ?? owned(await preparation(query(e), {maxBytes:PHYSICAL_ROOT_LIMITS.objectBytes, signal}));
          if (raw.length !== e.byteLength) fail('body-mismatch', 'Prepared body differs from the admitted plan.');
          if (stagingFailed) throw stagingFailure;
          pending.push(this.#ensure({fileId:e.fileId, sha256:e.sha256}, raw, e.kind, e.transactionId ?? value.transactionId, expected, signal, true)
            .catch(error => { if (!stagingFailed) { stagingFailed = true; stagingFailure = error; } }));
          if (pending.length === 4) await drain();
        }
        if ((verifiedLength??raw?.length) !== e.byteLength || (deterministic && !equal(raw, deterministic))) fail('body-mismatch', 'Staged body differs from the admitted plan.');
      }
      await drain();
    } finally { await Promise.allSettled(pending); }
    if (generated !== 2) fail('invalid-plan', 'Plan must include exact portable commit and retained base-manifest evidence.');
  }
  #result(value, locatorRoot, receiptHead) {
    return {...value.baseManifest, revision:value.logicalCommit.revision, root:value.logicalCommit.root, headCommit:copy(value.logicalHead), locatorRoot:copy(locatorRoot), receiptHead:copy(receiptHead), pending:null};
  }
  async #candidate(value, locatorRoot, expected, phase, signal, verifyReceipts = true) {
    const tree = this.#tree(value.baseManifest, expected, signal);
    const base = await tree.verify(value.baseManifest.locatorRoot, {signal}), candidate = await tree.verify(locatorRoot, {signal});
    if (count(candidate.entryCount) !== count(base.entryCount) + count(value.objectCount)) fail('candidate-mismatch', 'Candidate contains omitted or unauthorized additions.');
    // Prove the exact disjoint union once in primary-key order. The full tree
    // audits above independently validate all three indexes and body hashes.
    const planned=new Map();
    for await(const e of this.#plan(value,signal)) {
      if(planned.has(key(e)))fail('candidate-mismatch','Plan contains a duplicate mapping.');
      planned.set(key(e),locatorEntry(e));
    }
    const retained=tree.entries(value.baseManifest.locatorRoot,{signal})[Symbol.asyncIterator]();
    let before=await retained.next();
    try {
      for await(const e of tree.entries(locatorRoot,{signal})) {
        const pk=key(e);
        if(!before.done && key(before.value)<pk)fail('candidate-mismatch','Candidate omitted a retained mapping.');
        if(!before.done && key(before.value)===pk) {
          if(planned.has(pk) || !same(e,before.value))fail('candidate-mismatch','Candidate changed or rebound a retained mapping.');
          before=await retained.next();
        } else {
          const expected=planned.get(pk);
          if(!expected || !same(e,expected))fail('candidate-mismatch','Candidate contains an unauthorized or changed planned mapping.');
          planned.delete(pk);
        }
      }
      if(!before.done || planned.size)fail('candidate-mismatch','Candidate omitted retained or planned mappings.');
    } finally {await retained.return?.();}
    if (verifyReceipts) {
      const logical = {...value.baseManifest, revision:value.logicalCommit.revision, root:value.logicalCommit.root, headCommit:value.logicalHead, locatorRoot, pending:null};
      await this.#history(tree, locatorRoot, logical, signal);
      await this.#domain(tree, locatorRoot, value.baseManifest.locatorRoot, logical, value.logicalCommit, value.baseManifest, phase, signal);
      await this.#receiptChain(value.baseManifest, expected, signal);
    }
    // Receipt-edge checks run after the caller's complete selected-history audit.
    // That audit checks every historical root and change. Repeating whole
    // semantic prefixes per receipt would multiply work without adding a check.
    await this.#guard(expected, signal);
  }
  async #receiptValue(value, locatorRoot) {
    return {format:RECEIPT, version:4, databaseId:value.baseManifest.databaseId, copyId:value.baseManifest.copyId, transactionId:value.transactionId,
      intent:copy(value), intentHash:await digest(encode(value)), baseManifestHash:value.baseManifestHash, baseLocatorRoot:copy(value.baseManifest.locatorRoot),
      previousReceiptHead:copy(value.baseManifest.receiptHead), planRoot:copy(value.planRoot), objectCount:value.objectCount,
      locatorRoot:copy(locatorRoot), root:value.logicalCommit.root, headCommit:copy(value.logicalHead), revision:value.logicalCommit.revision};
  }
  async #receiptChain(selected, expected, signal) {
    let m = selected;
    while (m.receiptHead !== null) {
      const raw = await this.#read(m.receiptHead, 'protocol-object', undefined, signal), receipt = decode(raw), value = copy(receipt.intent);
      await this.#binding(value);
      if (!same(m, this.#result(value, m.locatorRoot, m.receiptHead))) fail('receipt-mismatch', 'Clean manifest differs from its immutable receipt result.');
      await this.#checkReceipt(value, m.locatorRoot, m.receiptHead, signal);
      await this.#stage(value, expected, null, signal, false);
      await this.#candidate(value, m.locatorRoot, expected, 'verify-retained-receipt', signal, false);
      m = value.baseManifest;
    }
  }
  async #checkReceipt(value, locatorRoot, ref, signal) {
    if (!same(decode(await this.#read(ref, 'protocol-object', value.transactionId, signal)), await this.#receiptValue(value, locatorRoot))) fail('receipt-mismatch', 'Pinned receipt does not bind the exact intent, candidate and logical result.');
  }
  async #resume(current, value, preparation, signal, preparedCandidate = null) {
    const admitted = await this.#binding(value);
    if (current.pending?.state === 'admitted') {
      if (!same(current, admitted)) fail('pending-mismatch', 'Admitted manifest differs from its exact intent.');
      await this.#stage(value, current, preparation, signal);
      const tree = this.#tree(value.baseManifest, current, signal), self = this;
      const additions = (async function* () { for await (const e of self.#plan(value,signal)) yield locatorEntry(e); })();
      const candidate = preparedCandidate ?? await tree.setMany(value.baseManifest.locatorRoot, additions, {signal});
      await this.#candidate(value, candidate, current, 'before-ready', signal);
      const receipt = await this.#newObject(encode(await this.#receiptValue(value, candidate)), 'protocol-object', value.transactionId, current, signal);
      current = await this.#writeManifest(current, {...admitted, pending:{state:'ready', intent:copy(value), locatorRoot:candidate, receipt}}, signal);
    }
    const pending = current.pending;
    if (!pending || !['ready', 'published'].includes(pending.state)) fail('pending-mismatch', 'Recovery requires exact admitted, ready or published state.');
    const ready = {...admitted, pending:{state:'ready', intent:copy(value), locatorRoot:copy(pending.locatorRoot), receipt:copy(pending.receipt)}};
    const final = this.#result(value, pending.locatorRoot, pending.receipt), published = {...final, pending:{...ready.pending, state:'published'}};
    if (!same(current, ready) && !same(current, published)) fail('pending-mismatch', 'Pending manifest differs from the pinned ready or published state.');
    await this.#stage(value, current, null, signal, false);
    await this.#checkReceipt(value, pending.locatorRoot, pending.receipt, signal);
    await this.#candidate(value, pending.locatorRoot, current, pending.state === 'ready' ? 'before-publication' : 'before-finalization', signal);
    if (same(current, ready)) {
      current = await this.#writeManifest(current, published, signal);
      await this.#checkReceipt(value, pending.locatorRoot, pending.receipt, signal);
      await this.#candidate(value, pending.locatorRoot, current, 'before-finalization', signal);
    }
    current = await this.#writeManifest(current, final, signal);
    return {status:'committed', transactionId:value.transactionId, manifest:copy(current)};
  }
  transact({intent:input, preparationStore, signal}) {
    const value = copy(input), preparation = bindPreparationRead(preparationStore);
    return this.#enqueue(async () => {
      const admitted = await this.#binding(value); let current = await this.#manifest(signal), preparedCandidate = null;
      if (same(current, value.baseManifest)) {
        // A caller may resume after process restart, so reverify the clean base.
        await this.#guard(current, signal); const tree = this.#tree(current, current, signal);
        await tree.verify(current.locatorRoot, {signal}); await this.#history(tree, current.locatorRoot, current, signal);
        await this.#receiptChain(current, current, signal);
        await this.#preflight(value, tree, signal);
        // All admitted bytes are durable before the manifest can name this intent.
        // An interrupted pre-stage retains evidence and leaves the exact old root.
        await this.#stage(value, current, preparation, signal);
        const self = this;
        preparedCandidate = await tree.setMany(value.baseManifest.locatorRoot, (async function* () {
          for await (const e of self.#plan(value,signal)) yield locatorEntry(e);
        })(), {signal});
        await this.#candidate(value,preparedCandidate,current,'before-admission',signal);
        current = await this.#writeManifest(current, admitted, signal);
      } else if (current.pending === null) {
        const final = this.#result(value, current.locatorRoot, current.receiptHead);
        if (!same(current, final)) fail('base-conflict', 'Manifest is not this intent\'s exact base or logical result.');
        await this.#checkReceipt(value, current.locatorRoot, current.receiptHead, signal);
        await this.#stage(value, current, null, signal, false);
        await this.#candidate(value, current.locatorRoot, current, 'retry-completed', signal);
        return {status:'already-committed', transactionId:value.transactionId, manifest:copy(current)};
      }
      return this.#resume(current, value, preparation, signal, preparedCandidate);
    });
  }
  recover({preparationStore, signal} = {}) {
    const preparation = bindPreparationRead(preparationStore);
    return this.#enqueue(async () => {
      const current = await this.#manifest(signal);
      if (current.pending === null) return {status:'idle', manifest:copy(current)};
      return this.#resume(current, copy(current.pending.intent), preparation, signal);
    });
  }
}
