export {PagedLocatorError} from './locator-codec.mjs';
import {createLocatorCodec,PagedLocatorError} from './locator-codec.mjs';
import {getOwnedPhysicalBodyVerifier,getOwnedLocatorDecoder} from './physical-drive-adapter.mjs';
/** Copy-specific locator v3. Direct physical pointers, never a hash-to-file cache.
 * Synthetic app adapter contract; manifest publication and migration are separate. */
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {utf8ByteLength} from './utf8-length.mjs';

export const PAGED_LOCATOR_FORMAT = 'finance-tracker-locator-catalog';
export const PAGED_LOCATOR_VERSION = 3;
export const PAGED_LOCATOR_NODE_FORMAT = 'finance-tracker-physical-locator-page';
export const PAGED_LOCATOR_MAX_BYTES = 65536;
export const PAGED_LOCATOR_ROOT_BYTES = 16384;
const HASH = /^[0-9a-f]{64}$/, DECIMAL = /^(0|[1-9][0-9]*)$/;
const KINDS = new Set(['data-object', 'commit-record', 'journal-event', 'migration-record', 'protocol-object']);
const INDEXES = ['objects', 'identities', 'files'];
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const lengthOf = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const ordinaryLengthOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const plain = x => x !== null && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const wellFormed = s => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const fail = (code, message, details) => { throw new PagedLocatorError(code, message, details); };
const abort = signal => { if (signal?.aborted) throw new DOMException('Locator operation cancelled.', 'AbortError'); };
function fields(x, names) {
  if (!plain(x) || Object.keys(x).length !== names.length || Object.getOwnPropertySymbols(x).length || names.some(k =>
    !Object.hasOwn(x, k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), 'value'))) fail('invalid-shape', 'Unexpected fields or accessors.');
}
function options(x, names) {
  if (!plain(x) || Object.keys(x).some(k => !names.includes(k))) fail('invalid-options', 'Unknown locator option.');
  return x;
}
function hash(x) { if (typeof x !== 'string' || !HASH.test(x)) fail('invalid-hash', 'Expected lowercase SHA-256.'); return x; }
function decimal(x) { if (typeof x !== 'string' || !DECIMAL.test(x)) fail('invalid-count', 'Expected an exact unsigned decimal string.'); return BigInt(x); }
function identifier(x) {
  if (typeof x !== 'string' || !x.trim() || !wellFormed(x) || x.length > 256 || utf8ByteLength(JSON.stringify(x)) > 256 ||
    ['__proto__', 'prototype', 'constructor'].includes(x)) fail('invalid-identity', 'Expected a nonempty identity of at most 256 encoded bytes.');
  return x;
}
// Bound before copying, hashing or parsing. Intrinsics ignore decorated views.
function ownedBytes(value, maximum) {
  let length;
  try { length = lengthOf.call(value); ordinaryLengthOf.call(bufferOf.call(value)); }
  catch { fail('invalid-bytes', 'Expected unshared Uint8Array bytes.'); }
  if (!(value instanceof Uint8Array)) fail('invalid-bytes', 'Expected Uint8Array bytes.');
  if (length > maximum) fail('byte-limit', 'An object exceeds its per-object byte budget.');
  return new Uint8Array(value);
}
// Bounded strict JSON snapshot. Never invoke input accessors or subtype methods.
function encode(value, maximum) {
  const pieces = [], active = new Set(); let used = 0;
  function emit(piece) {
    used += utf8ByteLength(piece);
    if (used > maximum) fail('byte-limit', 'Encoded JSON exceeds its byte budget.');
    pieces.push(piece);
  }
  function string(x) {
    if (x.length > maximum) fail('byte-limit', 'A string exceeds its byte budget.');
    if (!wellFormed(x)) fail('invalid-json', 'Unpaired surrogates are not supported.');
    emit(JSON.stringify(x));
  }
  function visit(x, depth) {
    if (depth > 16) fail('byte-limit', 'JSON exceeds its nesting budget.');
    if (x === null) return emit('null');
    if (typeof x === 'string') return string(x);
    if (typeof x === 'boolean') return emit(String(x));
    if (typeof x === 'number' && Number.isFinite(x)) return emit(JSON.stringify(x));
    if (typeof x !== 'object' || (!plain(x) && !Array.isArray(x)) || Object.getOwnPropertySymbols(x).length) fail('invalid-json', 'Expected plain JSON data.');
    if (active.has(x)) fail('invalid-json', 'Cyclic JSON is not supported.');
    active.add(x);
    if (Array.isArray(x)) {
      if (x.length > 128 || Object.keys(x).length !== x.length) fail('invalid-json', 'Expected a bounded dense array.');
      emit('[');
      for (let i = 0; i < x.length; i++) {
        if (i) emit(',');
        const d = Object.getOwnPropertyDescriptor(x, String(i));
        if (!d || !Object.hasOwn(d, 'value')) fail('invalid-json', 'JSON accessors are not supported.');
        visit(d.value, depth + 1);
      }
      emit(']');
    } else {
      const keys = [];
      for (const k in x) if (Object.hasOwn(x, k)) {
        if (keys.length >= maximum) fail('byte-limit', 'An object exceeds its field budget.');
        keys.push(k);
      }
      keys.sort(); emit('{');
      for (let i = 0; i < keys.length; i++) {
        if (i) emit(',');
        const k = keys[i], d = Object.getOwnPropertyDescriptor(x, k);
        if (!d || !Object.hasOwn(d, 'value')) fail('invalid-json', 'JSON accessors are not supported.');
        string(k); emit(':'); visit(d.value, depth + 1);
      }
      emit('}');
    }
    active.delete(x);
  }
  visit(value, 0); return encoder.encode(pieces.join(''));
}
const clone = (x, maximum = PAGED_LOCATOR_ROOT_BYTES) => JSON.parse(decoder.decode(encode(x, maximum)));
async function digest(bytes) {
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
function pointer(x) { fields(x, ['fileId', 'sha256']); identifier(x.fileId); hash(x.sha256); return x; }
const physicalKind = kind => kind === 'data-object' ? 'snapshot-object' : kind;
const objectKey = entry => entry.kind + ':' + entry.sha256;
const identityKey = entry => entry.kind + ':' + entry.identity;
function primaryKey(k) {
  if (typeof k !== 'string' || ![...KINDS].some(kind => k.startsWith(kind + ':') && HASH.test(k.slice(kind.length + 1)))) fail('invalid-key', 'Expected a kind and SHA-256 key.');
  return k;
}
function entry(value) {
  fields(value, ['kind', 'identity', 'fileId', 'sha256', ...(value?.kind === 'journal-event' ? ['transactionId', 'sequence'] : [])]);
  if (!KINDS.has(value.kind)) fail('invalid-kind', 'Unsupported retained object kind.');
  identifier(value.identity); identifier(value.fileId); hash(value.sha256);
  if (value.kind === 'data-object' && value.identity !== value.sha256) fail('invalid-identity', 'Data identity must equal its content hash.');
  if (value.kind === 'journal-event') {
    identifier(value.transactionId);
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) fail('invalid-journal', 'Journal sequence must preserve the legacy nonnegative safe integer.');
  }
  return value;
}

/** adapter: folderId, readMetadata(id, {signal}), readBytes(id, {kind,maxBytes,signal}),
 * readMetadata reports an absent exact ID with code 'object-not-found'; all other
 * failures remain errors, never evidence that an allocated ID is available.
 * allocateFileId({signal}), createImmutable({...bytes/bindings,beforeMutation,signal}).
 * createImmutable must call beforeMutation immediately before EACH mutation attempt,
 * settle all attempts before returning, and never overwrite an existing file.
 */
// Complete verification results are private, bounded and valid only inside one
// factory-owned physical verification phase. No caller can mint a result.
const completeTreeMemos=new WeakMap();
const MEMO_ROOTS=64,MEMO_KEY_BYTES=65536;
export function createPagedPhysicalLocators(adapter, config) {
  options(config, ['databaseId', 'copyId', 'folderId', 'assertWritable', 'maxNodeBytes', 'maxEntries', 'maxChildren']);
  const databaseId = identifier(config.databaseId), copyId = identifier(config.copyId), folderId = identifier(config.folderId);
  if (!adapter || adapter.folderId !== folderId || typeof adapter.readMetadata !== 'function' || typeof adapter.readBytes !== 'function') fail('invalid-adapter', 'A direct physical reader for the expected folder is required.');
  const maxNodeBytes = config.maxNodeBytes ?? PAGED_LOCATOR_MAX_BYTES;
  const maxEntries = config.maxEntries ?? 128, maxChildren = config.maxChildren ?? 128;
  if (!Number.isSafeInteger(maxNodeBytes) || maxNodeBytes < 4096 || maxNodeBytes > PAGED_LOCATOR_MAX_BYTES ||
    !Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries > 128 ||
    !Number.isSafeInteger(maxChildren) || maxChildren < 3 || maxChildren > 128) fail('invalid-options', 'Limits are 4096..65536 bytes, 2..128 entries and 3..128 children.');
  const readMetadata = adapter.readMetadata.bind(adapter), readBytes = adapter.readBytes.bind(adapter);
  const allocate = adapter.allocateFileId?.bind(adapter), create = adapter.createImmutable?.bind(adapter), assertWritable = config.assertWritable;
  const catalogTransaction = 'paged-locators';
  const decodedPages=getOwnedLocatorDecoder(adapter);
  function adapterScope() {
    if (adapter.folderId !== folderId) fail('adapter-scope-mismatch', 'Adapter folder changed after construction.');
  }
  function identity(value) {
    if (value.databaseId !== databaseId || value.copyId !== copyId) fail('copy-mismatch', 'Catalog content belongs to another database or physical copy.');
  }
  function metadata(value, ref, kind, transactionId, maximum) {
    const m = clone(value);
    if (m.id !== ref.fileId || m.trashed !== false || !Array.isArray(m.parents) || !m.parents.includes(folderId) ||
      m.appProperties?.financeTrackerHash !== ref.sha256 || m.appProperties?.financeTrackerKind !== physicalKind(kind) ||
      (transactionId !== undefined && m.appProperties?.financeTrackerTransaction !== transactionId)) fail('metadata-mismatch', 'Physical file folder, kind, transaction or hash does not match.');
    decimal(m.version); const size = decimal(m.size);
    if (size > BigInt(maximum)) fail('byte-limit', 'Metadata declares an oversized object.');
    return {version:m.version, size:m.size};
  }
  async function readPhysical(ref, kind, maximum, signal, transactionId) {
    const owner=decodedPages?.captureRead();
    for(let attempt=0;attempt<3;attempt++) {
      if(attempt)await new Promise(resolve=>setTimeout(resolve,100*attempt));
      abort(signal); adapterScope();owner?.assertCurrent();
      const before = metadata(await readMetadata(ref.fileId, {maxBytes:PAGED_LOCATOR_ROOT_BYTES, signal}), ref, kind, transactionId, maximum);
      abort(signal);owner?.assertCurrent();
      const bytes = ownedBytes(await readBytes(ref.fileId, {kind:physicalKind(kind), maxBytes:maximum, signal}), maximum);
      abort(signal);owner?.assertCurrent();
      const contentMatches=BigInt(bytes.length)===BigInt(before.size)&&await digest(bytes)===ref.sha256;
      abort(signal);owner?.assertCurrent();
      const after = metadata(await readMetadata(ref.fileId, {maxBytes:PAGED_LOCATOR_ROOT_BYTES, signal}), ref, kind, transactionId, maximum);
      abort(signal);owner?.assertCurrent();
      if(before.version!==after.version||before.size!==after.size)continue;
      if(!contentMatches)fail('hash-mismatch','Physical object does not match its exact bytes and size.');
      return bytes;
    }
    fail('version-mismatch','Physical metadata did not settle across bounded byte revalidation.');
  }
  async function preparePhysical(value, kind, maximum, signal) {
    if (!allocate || !create || typeof assertWritable !== 'function') fail('read-only', 'Writes require immutable create, ID allocation and an ownership guard.');
    abort(signal);
    const bytes = encode(value, maximum), sha256 = await digest(bytes);
    abort(signal);
    adapterScope();
    const fileId = identifier(await allocate({signal})); abort(signal); adapterScope();
    return {fileId,sha256,bytes,kind,maximum};
  }
  async function publishPhysical({fileId,sha256,bytes,kind,maximum}, signal) {
    abort(signal);adapterScope();
    const writeOwner = decodedPages?.captureRead();
    writeOwner?.assertCurrent();
    let active = true, calls = 0, successfulGuards = 0, pending = null, guardFailure = false, guardError, failed = false, createError;
    const beforeMutation = () => {
      if (!active || pending) { guardFailure = true; return Promise.reject(new PagedLocatorError('guard-scope', 'Mutation guard is closed or already running.')); }
      calls++;
      pending = (async () => {
        abort(signal); adapterScope();
        const result = await assertWritable({databaseId, copyId, folderId, signal});
        abort(signal); adapterScope();
        if (result !== undefined) fail('invalid-guard', 'Ownership guard must throw on failure and return undefined on success.');
        successfulGuards++;
      })().catch(error => { guardFailure = true; guardError = error; throw error; });
      const result = pending;
      result.then(() => { if (pending === result) pending = null; }, () => { if (pending === result) pending = null; });
      return result;
    };
    try {
      await create({fileId, name:'ft-paged-locator-' + sha256 + '.json', kind, transactionId:catalogTransaction,
        content:new Uint8Array(bytes), expectedSha256:sha256, maxBytes:maximum, beforeMutation, signal});
    } catch (error) { failed = true; createError = error; }
    active = false;
    if (pending) { guardFailure = true; await pending.catch(() => {}); }
    // Without a successful guard, no conforming adapter could have attempted a
    // mutation. After one succeeds, cancellation preserves an uncertain ID.
    if (!successfulGuards) {
      abort(signal);
      if (!calls || guardFailure) fail('guard-scope', 'Adapter did not complete its required mutation guard.', {guardError});
    }
    if (guardFailure) fail('write-unresolved', 'A later or unsettled guard leaves the physical write outcome uncertain.',
      {fileId, sha256, guardError, cancelled:Boolean(signal?.aborted), createFailed:failed, createError});
    const ref = {fileId, sha256};
    if (signal?.aborted) fail('write-unresolved', 'Cancellation after create requires inspection of the exact physical ID.', {fileId, sha256, cancelled:true, createFailed:failed, createError});
    let saved;
    // A successful create was already verified by the Drive adapter. An
    // otherwise exact new page can still cross a metadata-version change in
    // this independent bracket. Reverify the same ID, never resend its write.
    // Historical reads and all binding/byte failures retain strict refusal.
    for (let attempt = 0; ; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 100 * attempt));
          abort(signal);adapterScope();writeOwner?.assertCurrent();
          if (await assertWritable({databaseId, copyId, folderId, signal}) !== undefined) {
            fail('invalid-guard', 'Ownership guard must return undefined.');
          }
        }
        abort(signal);adapterScope();writeOwner?.assertCurrent();
        saved = await readPhysical(ref, kind, maximum, signal, catalogTransaction);
        writeOwner?.assertCurrent();
        break;
      } catch (error) {
        if (!failed && error.code === 'version-mismatch' && attempt < 2) continue;
        fail('write-unresolved', 'Exact-ID readback did not establish the immutable write; preserve evidence.', {fileId, sha256, createFailed:failed, createError, readbackError:error});
      }
    }
    if (!equal(bytes, saved)) fail('write-readback-mismatch', 'Stored bytes differ from the proposed immutable bytes.');
    return ref;
  }
  async function writePhysical(value, kind, maximum, signal) {
    return publishPhysical(await preparePhysical(value,kind,maximum,signal),signal);
  }
  async function readJson(ref, kind, maximum, signal, index=null) {
    const owner=decodedPages?.captureRead();
    try {
    const bytes = await readPhysical(ref, kind, maximum, signal, catalogTransaction);owner?.assertCurrent();
    if(decodedPages){
      const value=await decodedPages.decode({bytes,sha256:ref.sha256,signal,profile:{schema:kind==='locator-catalog'?'root':'page',version:kind==='locator-catalog'?3:1,databaseId,copyId,index,maxNodeBytes,maxEntries,maxChildren}});
      abort(signal);adapterScope();owner?.assertCurrent();return {value,bytes};
    }
    let value;
    try { value = JSON.parse(decoder.decode(bytes)); } catch { fail('invalid-json', 'Expected valid UTF-8 JSON.'); }
    if (!equal(bytes, encode(value, maximum))) fail('noncanonical-json', 'Stored JSON must be canonical without duplicate fields.');
    return {value, bytes};
    }catch(error){owner?.invalidate();throw error;}
  }
  const {key,reference,summary,nodeFor,validateNode,validateRoot}=createLocatorCodec({databaseId,copyId,maxNodeBytes,maxEntries,maxChildren});
  async function readNode(ref, index, signal) {
    const owner=decodedPages?.captureRead();
    const {value:node, bytes} = await readJson(ref, 'locator-catalog-page', maxNodeBytes, signal, index);owner?.assertCurrent();
    if(!decodedPages)validateNode(node, index);
    if (['height', 'count', 'min', 'max'].some(k => ref[k] !== node[k])) {owner?.invalidate();fail('child-mismatch', 'Child bytes contradict the parent reference.');}
    return {node, bytes};
  }
  async function writeNode(index, type, items, signal) {
    const node = validateNode(nodeFor(index, type, items), index);
    return {...await writePhysical(node, 'locator-catalog-page', maxNodeBytes, signal), ...summary(node)};
  }
  function fits(index, type, items) {
    if (items.length > (type === 'leaf' ? maxEntries : maxChildren)) return false;
    try { encode(nodeFor(index, type, items), maxNodeBytes); return true; }
    catch (e) { if (e.code === 'byte-limit') return false; throw e; }
  }
  async function pack(index, type, items, signal) {
    // Insertion changes one bounded page. Split in halves rather than leaving a
    // full sibling and a unary sibling at every overflow along a random path.
    if (fits(index, type, items)) return [await writeNode(index, type, items, signal)];
    if (items.length < 2) fail('byte-limit', 'One locator or child cannot fit a page.');
    const middle = Math.floor(items.length / 2);
    return [...await pack(index, type, items.slice(0, middle), signal),
      ...await pack(index, type, items.slice(middle), signal)];
  }
  async function descend(ref, index, k, signal) {
    const path = [], active = new Set();
    while (ref !== null) {
      if (active.has(ref.fileId)) fail('cycle', 'A page refers to a physical ancestor.'); active.add(ref.fileId);
      const {node} = await readNode(ref, index, signal);
      if (node.nodeType === 'leaf') return {node, path};
      let at = node.children.findIndex(c => c.max >= k);
      if (at < 0) at = node.children.length - 1;
      path.push({node, at}); ref = node.children[at];
    }
    return {node:null, path};
  }
  async function find(ref, index, k, signal) {
    const {node} = await descend(ref, index, k, signal);
    return node?.entries.find(pair => pair[0] === k)?.[1];
  }
  async function insert(ref, index, k, value, signal) {
    const {node, path} = await descend(ref, index, k, signal);
    const items = node?.entries ?? [], at = items.findIndex(pair => pair[0] >= k);
    if (at >= 0 && items[at][0] === k) fail('duplicate-entry', 'Insert cannot replace an immutable binding.');
    items.splice(at < 0 ? items.length : at, 0, [k, value]);
    let refs = await pack(index, 'leaf', items, signal);
    while (path.length) {
      const {node:parent, at:position} = path.pop(); parent.children.splice(position, 1, ...refs);
      refs = await pack(index, 'branch', parent.children, signal);
    }
    while (refs.length > 1) {
      const next = await pack(index, 'branch', refs, signal);
      if (next.length >= refs.length) fail('byte-limit', 'A parent must fit at least two children.');
      refs = next;
    }
    return refs[0];
  }
  async function readRoot(ref, signal) {
    const {value, bytes} = await readJson(ref, 'locator-catalog', PAGED_LOCATOR_ROOT_BYTES, signal);
    return {root:decodedPages?value:validateRoot(value), bytes};
  }
  function emptyRoot() { return {format:PAGED_LOCATOR_FORMAT, version:PAGED_LOCATOR_VERSION, databaseId, copyId,
    generation:'0', previous:null, entryCount:'0', objects:null, identities:null, files:null}; }
  const pin = ref => pointer(clone(ref));
  const readEntry = (e, signal) => readPhysical(e, e.kind, PAGED_LOCATOR_MAX_BYTES, signal, e.kind === 'journal-event' ? e.transactionId : undefined);
  const verifyBody=getOwnedPhysicalBodyVerifier(adapter);
  const verifyEntry = async(e,signal)=>{
    if(!verifyBody)return (await readEntry(e,signal)).length;
    adapterScope();abort(signal);
    const result=await verifyBody({folderId,fileId:e.fileId,sha256:e.sha256,kind:physicalKind(e.kind),
      transactionId:e.kind==='journal-event'?e.transactionId:undefined,maxBytes:PAGED_LOCATOR_MAX_BYTES,signal});
    adapterScope();abort(signal);
    if(!Number.isSafeInteger(result?.byteLength)||result.byteLength<0||result.byteLength>PAGED_LOCATOR_MAX_BYTES)fail('invalid-byte-proof','Adapter did not verify a bounded immutable body.');
    return result.byteLength;
  };
  async function add(root, e, signal) {
    const pk = objectKey(e), existing = await find(root.objects, 'objects', pk, signal);
    const byIdentity = await find(root.identities, 'identities', identityKey(e), signal);
    const byFile = await find(root.files, 'files', e.fileId, signal);
    if (existing !== undefined) {
      if (canonicalizeJcs(existing) !== canonicalizeJcs(e)) fail('replacement-forbidden', 'A kind and content hash cannot be rebound.');
      if (byIdentity !== pk || byFile !== pk) fail('index-mismatch', 'Secondary bindings do not match the existing locator.');
      await verifyEntry(e, signal); return false;
    }
    if (byIdentity !== undefined) fail('replacement-forbidden', 'A legacy identity cannot be rebound.');
    if (byFile !== undefined) fail('duplicate-physical-locator', 'A physical file cannot identify multiple immutable objects.');
    await verifyEntry(e, signal);
    root.objects = await insert(root.objects, 'objects', pk, e, signal);
    root.identities = await insert(root.identities, 'identities', identityKey(e), pk, signal);
    root.files = await insert(root.files, 'files', e.fileId, pk, signal);
    root.entryCount = String(decimal(root.entryCount) + 1n); return true;
  }
  // All groups in a level belong to the final tree. In particular, never write
  // a temporary root for each proposed descriptor in a batch.
  async function packLevel(index, type, items, signal, plan = null) {
    const groups=[];let group=[];
    for(const item of items) {
      if(group.length && !fits(index,type,[...group,item])) {groups.push(group);group=[];}
      group.push(item);
      if(!fits(index,type,group)) fail('byte-limit','One locator or child cannot fit its bounded page.');
    }
    if(group.length)groups.push(group);
    if(type==='branch' && groups.at(-1).length===1) {
      const last=groups.pop(),previous=groups.at(-1);
      if(!previous) fail('byte-limit','A parent requires at least two children.');
      if(previous.length>=3)last.unshift(previous.pop());
      else {last.unshift(...groups.pop());if(!fits(index,type,last))fail('byte-limit','A balanced parent cannot fit its child references.');}
      groups.push(last);
    }
    const refs=[];for(const items of groups) {
      abort(signal);refs.push(plan ? await planNode(plan,index,type,items,signal) : await writeNode(index,type,items,signal));
    }return refs;
  }
  // Empty-tree construction is the same bottom-up case used by a batch that
  // grows beyond its old root. It does not rebuild nonempty untouched subtrees.
  async function bulkIndex(index, pairs, signal, plan = null) {
    if (!pairs.length) return null;
    let refs=await packLevel(index,'leaf',pairs,signal,plan);
    while(refs.length>1)refs=await packLevel(index,'branch',refs,signal,plan);
    return refs[0];
  }
  // Route sorted proposed keys together. This preflight visits each affected
  // page once per index, before any of the three indexes starts writing.
  async function findMany(ref, index, pairs, signal) {
    const found=new Map(),active=new Set();
    async function visit(ref, start, end) {
      abort(signal);
      if(ref===null || start===end)return;
      if(active.has(ref.fileId))fail('cycle','A page refers to a physical ancestor.');
      active.add(ref.fileId);
      const {node}=await readNode(ref,index,signal);
      if(node.nodeType==='leaf') {
        let at=0;
        for(let i=start;i<end;i++) {
          while(at<node.entries.length && node.entries[at][0]<pairs[i][0])at++;
          if(at<node.entries.length && node.entries[at][0]===pairs[i][0])found.set(pairs[i][0],node.entries[at][1]);
        }
      } else {
        let from=start;
        for(let at=0;at<node.children.length && from<end;at++) {
          const child=node.children[at];let to=from;
          while(to<end && (at===node.children.length-1 || pairs[to][0]<=child.max))to++;
          if(to>from)await visit(child,from,to);
          from=to;
        }
      }
      active.delete(ref.fileId);
    }
    await visit(ref,0,pairs.length);return found;
  }
  async function insertMany(ref, index, pairs, signal, plan) {
    if(ref===null)return bulkIndex(index,pairs,signal,plan);
    const active=new Set();
    async function visit(ref, start, end) {
      abort(signal);
      if(start===end)return [ref];
      if(active.has(ref.fileId))fail('cycle','A page refers to a physical ancestor.');
      active.add(ref.fileId);
      const {node}=await readNode(ref,index,signal);const items=[];plan.knownIds.add(ref.fileId);
      if(node.nodeType==='leaf') {
        for(const [k,value] of node.entries) {
          if(plan.entries[index].has(k))fail('duplicate-entry','A batch cannot repeat an old or proposed key.');
          plan.entries[index].set(k,value);
        }
        let at=0;
        for(let i=start;i<end;i++) {
          while(at<node.entries.length && node.entries[at][0]<pairs[i][0])items.push(node.entries[at++]);
          if(at<node.entries.length && node.entries[at][0]===pairs[i][0])fail('duplicate-entry','Insert cannot replace an immutable binding.');
          items.push(pairs[i]);
        }
        while(at<node.entries.length)items.push(node.entries[at++]);
      } else {
        let from=start;
        for(let at=0;at<node.children.length;at++) {
          const child=node.children[at];let to=from;
          while(to<end && (at===node.children.length-1 || pairs[to][0]<=child.max))to++;
          // Do not mutate decoded pages or copy unchanged descendants. Each
          // changed child emits only nodes used by this final parent level.
          if(to===from) {
            if(plan.reused[index].has(child.fileId))fail('duplicate-child','A batch cannot repeat an unchanged subtree.');
            plan.knownIds.add(child.fileId);plan.reused[index].set(child.fileId,child);items.push(child);
          } else for(const changed of await visit(child,from,to))items.push(changed);
          from=to;
        }
      }
      active.delete(ref.fileId);
      return packLevel(index,node.nodeType,items,signal,plan);
    }
    let refs=await visit(ref,0,pairs.length);
    while(refs.length>1)refs=await packLevel(index,'branch',refs,signal,plan);
    return refs[0];
  }
  async function planPhysical(plan, value, kind, maximum, signal) {
    const record=await preparePhysical(value,kind,maximum,signal);
    if(plan.records.has(record.fileId) || plan.knownIds.has(record.fileId))fail('invalid-plan','An allocated ID repeats a planned or retained file.');
    plan.records.set(record.fileId,record);return record;
  }
  async function planNode(plan, index, type, items, signal) {
    const node=validateNode(nodeFor(index,type,items),index);
    const record=await planPhysical(plan,node,'locator-catalog-page',maxNodeBytes,signal);
    return {fileId:record.fileId,sha256:record.sha256,...summary(node)};
  }
  // This is a separate traversal of the encoded candidate, not the insertion
  // recursion. Check the exact old frontier, touched-leaf/new-entry union and
  // new-page closure before creating anything. Planned bytes are not physical
  // evidence: every later create still needs its guard and exact-ID readback.
  async function verifyPlannedCatalog(plan, candidate, signal) {
    const seen=new Set(),usedEntries={},usedReused={},writes=[];
    for(const index of INDEXES) {usedEntries[index]=new Set();usedReused[index]=new Set();}
    async function visit(ref,index=null) {
      abort(signal);adapterScope();
      if(seen.has(ref.fileId))fail('invalid-plan','A candidate repeats a physical page.');
      const record=plan.records.get(ref.fileId);
      if(!record) {
        const old=index===null?undefined:plan.reused[index].get(ref.fileId);
        if(!old || canonicalizeJcs(old)!==canonicalizeJcs(ref) || usedReused[index].has(ref.fileId))fail('invalid-plan','A candidate changed or repeated its retained frontier.');
        usedReused[index].add(ref.fileId);return;
      }
      if(plan.knownIds.has(ref.fileId))fail('invalid-plan','A planned page reuses a retained physical ID.');
      seen.add(ref.fileId);
      const maximum=index===null?PAGED_LOCATOR_ROOT_BYTES:maxNodeBytes;
      if(record.fileId!==ref.fileId || record.sha256!==ref.sha256 || record.maximum!==maximum ||
        record.kind!==(index===null?'locator-catalog':'locator-catalog-page'))fail('invalid-plan','Planned page bindings do not match the candidate.');
      const bytes=ownedBytes(record.bytes,maximum);
      if(await digest(bytes)!==ref.sha256)fail('invalid-plan','Planned bytes do not match their exact hash.');
      abort(signal);adapterScope();
      let node;
      try {node=JSON.parse(decoder.decode(bytes));}catch {fail('invalid-plan','A planned page is not valid UTF-8 JSON.');}
      if(!equal(bytes,encode(node,maximum)))fail('invalid-plan','A planned page is not canonical bounded JSON.');
      if(index===null) {
        validateRoot(node);
        if(node.generation!==plan.generation || node.entryCount!==plan.entryCount ||
          canonicalizeJcs(node.previous)!==canonicalizeJcs(plan.previous))fail('invalid-plan','A candidate changed its generation, previous root or count.');
        for(const name of INDEXES)if(node[name]!==null)await visit(node[name],name);
      } else {
        validateNode(node,index);
        if(['height','count','min','max'].some(k=>ref[k]!==node[k]))fail('invalid-plan','A planned child contradicts its parent reference.');
        if(node.nodeType==='branch')for(const child of node.children)await visit(child,index);
        else for(const [k,value] of node.entries) {
          if(!plan.entries[index].has(k) || usedEntries[index].has(k) ||
            canonicalizeJcs(plan.entries[index].get(k))!==canonicalizeJcs(value))fail('invalid-plan','A candidate changed its exact touched-leaf and addition union.');
          usedEntries[index].add(k);
        }
      }
      writes.push(record);
    }
    await visit({fileId:candidate.fileId,sha256:candidate.sha256});
    if(seen.size!==plan.records.size)fail('invalid-plan','The batch contains an unreachable planned page.');
    for(const index of INDEXES)if(usedEntries[index].size!==plan.entries[index].size || usedReused[index].size!==plan.reused[index].size)
      fail('invalid-plan','The candidate omits a retained subtree or expected entry.');
    return writes;
  }
  async function verifyPlannedIdsAbsent(plan, signal) {
    const owner=decodedPages?.captureRead();
    // Probe only changed-output IDs, including the new catalog root. Exact-ID
    // metadata also covers bodies, descendants below reused frontiers, previous
    // catalogs and other existing files without retaining a database-wide set.
    for(const {fileId} of plan.records.values()) {
      abort(signal);adapterScope();owner?.assertCurrent();
      let absent=false;
      try {await readMetadata(fileId,{maxBytes:PAGED_LOCATOR_ROOT_BYTES,signal});}
      catch(error) {
        abort(signal);adapterScope();owner?.assertCurrent();
        if(error?.code!=='object-not-found')throw error;
        absent=true;
      }
      abort(signal);adapterScope();owner?.assertCurrent();
      if(!absent)fail('invalid-plan','An allocated physical ID already exists.');
    }
  }
  async function buildOwned(values, root, signal) {
    const indexes={objects:[],identities:[],files:[]};const identities=new Set(),files=new Set();
    for(const e of values) {
      const pk=objectKey(e),ik=identityKey(e);
      if(identities.has(ik))fail('replacement-forbidden','A legacy identity cannot be rebound.');
      if(files.has(e.fileId))fail('duplicate-physical-locator','A physical file cannot identify multiple immutable objects.');
      identities.add(ik);files.add(e.fileId);await verifyEntry(e,signal);
      indexes.objects.push([pk,e]);indexes.identities.push([ik,pk]);indexes.files.push([e.fileId,pk]);
    }
    for(const index of INDEXES) {
      indexes[index].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
      root[index]=await bulkIndex(index,indexes[index],signal);
    }
    root.entryCount=String(values.length);validateRoot(root);
    return writePhysical(root,'locator-catalog',PAGED_LOCATOR_ROOT_BYTES,signal);
  }
  async function build(iterable, opts = {}) {
    const {signal}=options(opts,['signal']);abort(signal);
    if(!iterable || (!iterable[Symbol.iterator] && !iterable[Symbol.asyncIterator])) fail('invalid-input','Build requires sorted locators.');
    const values=[];let previous=null;
    for await(const input of iterable) {
      const e=entry(clone(input)),pk=objectKey(e);abort(signal);
      if(previous!==null && previous>=pk)fail('invalid-order','Build input must have strictly ascending kind/hash keys.');
      previous=pk;values.push(e);
    }
    return buildOwned(values,emptyRoot(),signal);
  }
  async function set(inputRoot, input, opts = {}) {
    const ref = pin(inputRoot), e = entry(clone(input)), {signal} = options(opts, ['signal']);
    const {root} = await readRoot(ref, signal);
    if (!await add(root, e, signal)) return ref;
    root.previous = ref; root.generation = String(decimal(root.generation) + 1n); validateRoot(root);
    return writePhysical(root, 'locator-catalog', PAGED_LOCATOR_ROOT_BYTES, signal);
  }
  async function setMany(inputRoot, iterable, opts = {}) {
    const ref=pin(inputRoot),{signal}=options(opts,['signal']);abort(signal);
    if(!iterable || (!iterable[Symbol.iterator] && !iterable[Symbol.asyncIterator]))fail('invalid-input','SetMany requires iterable locators.');
    // Retain the proposed batch, never materialize the existing catalog. There
    // is no aggregate descriptor limit: callers still own batching/memory.
    const proposed=new Map(),identities=new Map(),files=new Map();
    for await(const input of iterable) {
      const e=entry(clone(input)),pk=objectKey(e),ik=identityKey(e),existing=proposed.get(pk);abort(signal);
      if(existing!==undefined) {
        if(canonicalizeJcs(existing)!==canonicalizeJcs(e))fail('replacement-forbidden','A kind and hash cannot be rebound.');
        continue;
      }
      if(identities.has(ik))fail('replacement-forbidden','A legacy identity cannot be rebound.');
      if(files.has(e.fileId))fail('duplicate-physical-locator','A physical file cannot identify multiple immutable objects.');
      proposed.set(pk,e);identities.set(ik,pk);files.set(e.fileId,pk);
    }
    // Verify after consuming input, including no-op batches. Generic providers
    // perform complete fresh work. An owned active phase may reuse a complete
    // prior observation, whose metadata witnesses still must pass the closing
    // inventory before publication; an iterator cannot authorize changed bytes.
    await verify(ref,{signal});const {root}=await readRoot(ref,signal);
    const ordered=values=>[...values].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    const existing={
      objects:await findMany(root.objects,'objects',ordered(proposed),signal),
      identities:await findMany(root.identities,'identities',ordered(identities),signal),
      files:await findMany(root.files,'files',ordered(files),signal)
    };
    const additions={objects:[],identities:[],files:[]};
    for(const [pk,e] of proposed) {
      const ik=identityKey(e),old=existing.objects.get(pk),byIdentity=existing.identities.get(ik),byFile=existing.files.get(e.fileId);
      if(old!==undefined) {
        if(canonicalizeJcs(old)!==canonicalizeJcs(e))fail('replacement-forbidden','A kind and hash cannot be rebound.');
        if(byIdentity!==pk || byFile!==pk)fail('index-mismatch','Secondary bindings do not match the existing locator.');
      } else {
        if(byIdentity!==undefined)fail('replacement-forbidden','A legacy identity cannot be rebound.');
        if(byFile!==undefined)fail('duplicate-physical-locator','A physical file cannot identify multiple immutable objects.');
        additions.objects.push([pk,e]);additions.identities.push([ik,pk]);additions.files.push([e.fileId,pk]);
      }
    }
    if(!additions.objects.length)return ref;
    for(const [,e] of additions.objects)await verifyEntry(e,signal);
    // Known IDs are an early collision check, not the complete physical inventory.
    const plan={records:new Map(),knownIds:new Set([ref.fileId,...files.keys()]),entries:{},reused:{},previous:ref,
      generation:String(decimal(root.generation)+1n),entryCount:String(decimal(root.entryCount)+BigInt(additions.objects.length))};
    for(const index of INDEXES) {plan.entries[index]=new Map(additions[index]);plan.reused[index]=new Map();}
    // Retain only the proposed batch, touched old leaves/frontier and new page
    // bytes. All fixed IDs are allocated before the first immutable create.
    for(const index of INDEXES)root[index]=await insertMany(root[index],index,ordered(additions[index]),signal,plan);
    root.entryCount=plan.entryCount;root.previous=ref;root.generation=plan.generation;validateRoot(root);
    const candidate=await planPhysical(plan,root,'locator-catalog',PAGED_LOCATOR_ROOT_BYTES,signal);
    const writes=await verifyPlannedCatalog(plan,candidate,signal);
    await verifyPlannedIdsAbsent(plan,signal);
    // Stage independent pages four at a time, retaining child-before-parent
    // durability. The verified plan is bounded and every record still uses its
    // own live guard and exact-ID readback. Never return an authority candidate
    // while any issued write is unsettled, even when a sibling fails.
    const levels=new Map();
    for(const record of writes) {
      const level=record.kind==='locator-catalog'?Infinity:JSON.parse(decoder.decode(record.bytes)).height;
      if(!levels.has(level))levels.set(level,[]);
      levels.get(level).push(record);
    }
    const concurrency=verifyBody?4:1; // Unknown/custom providers keep serial calls.
    for(const [,records] of [...levels].sort(([a],[b])=>a-b)) {
      for(let start=0;start<records.length;start+=concurrency) {
        abort(signal);adapterScope();
        const results=await Promise.allSettled(records.slice(start,start+concurrency).map(record=>publishPhysical(record,signal)));
        const failure=results.find(result=>result.status==='rejected');
        if(failure)throw failure.reason;
      }
    }
    return {fileId:candidate.fileId,sha256:candidate.sha256};
  }
  async function resolved(inputRoot, query, opts, needBytes = true) {
    const ref = pin(inputRoot), q = clone(query), {signal} = options(opts, ['signal']); fields(q, ['kind', 'sha256']);
    const pk = primaryKey(q.kind + ':' + hash(q.sha256));
    const {root} = await readRoot(ref, signal), e = await find(root.objects, 'objects', pk, signal);
    if (e === undefined) return undefined;
    if(needBytes)return {entry:e,bytes:await readEntry(e,signal)};
    await verifyEntry(e,signal);return {entry:e};
  }
  const get = async (root, query, opts = {}) => (await resolved(root, query, opts, false))?.entry;
  const readObject = async (root, query, opts = {}) => {
    const result = await resolved(root, query, opts);
    if (!result) fail('object-not-found', 'The selected catalog has no such kind and content hash.');
    return result.bytes;
  };
  // Depth-first traversal keeps bounded pages only along the active height.
  async function* traverse(rootRef, index, signal, after = null) {
    if (rootRef === null) return;
    const stack = [], active = new Set(); let next = rootRef, previous = null, count = 0n;
    while (next || stack.length) {
      abort(signal);
      if (next) {
        if (active.has(next.fileId)) fail('cycle', 'A page repeats a physical ancestor.');
        const ref = next, {node, bytes} = await readNode(ref, index, signal);
        active.add(ref.fileId); stack.push({ref, node, at:0}); next = null;
        yield {ref, node, bytes};
        if (node.nodeType === 'leaf') for (const pair of node.entries) {
          if (previous !== null && previous >= pair[0]) fail('invalid-order', 'Traversal found duplicate or reordered keys.');
          previous = pair[0]; count++;
          if (after === null || pair[0] > after) yield {pair};
        }
      }
      const frame = stack.at(-1);
      if (frame.node.nodeType === 'branch' && frame.at < frame.node.children.length) {
        const child = frame.node.children[frame.at++];
        if (after === null || child.max > after) next = child;
      } else { active.delete(frame.ref.fileId); stack.pop(); }
    }
    if (after === null && String(count) !== rootRef.count) fail('count-mismatch', 'Exhausted traversal count disagrees with the index root.');
  }
  function entries(inputRoot, opts = {}) {
    const ref = pin(inputRoot), {signal} = options(opts, ['signal']);
    return (async function* () {
      const {root} = await readRoot(ref, signal);
      for await (const item of traverse(root.objects, 'objects', signal)) if (item.pair) {
        const e = item.pair[1]; await verifyEntry(e, signal); yield clone(e);
      }
    })();
  }
  async function page(inputRoot, opts = {}) {
    const ref = pin(inputRoot), {signal, limit = 128} = options(opts, ['signal', 'limit', 'cursor']);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail('invalid-page-limit', 'Result limit must be 1..128.');
    let after = null;
    if (opts.cursor != null) {
      const cursor = clone(opts.cursor); fields(cursor, ['format', 'version', 'root', 'after']); pointer(cursor.root); primaryKey(cursor.after);
      if (cursor.format !== 'finance-tracker-locator-cursor' || cursor.version !== 3 || canonicalizeJcs(cursor.root) !== canonicalizeJcs(ref)) fail('cursor-mismatch', 'Cursor belongs to another root.');
      after = cursor.after;
    }
    const {root} = await readRoot(ref, signal), result = []; let more = false;
    for await (const item of traverse(root.objects, 'objects', signal, after)) if (item.pair) {
      if (result.length === limit) { more = true; break; }
      const e = item.pair[1]; await verifyEntry(e, signal); result.push(e);
    }
    return {entries:result, cursor:more ? {format:'finance-tracker-locator-cursor', version:3, root:ref, after:objectKey(result.at(-1))} : null};
  }
  async function inspect(inputRoot, opts = {}) {
    const ref = pin(inputRoot), {signal} = options(opts, ['signal']); return (await readRoot(ref, signal)).root;
  }
  async function* checkedWalk(ref, signal, opaqueBodies = false) {
    const {root, bytes} = await readRoot(ref, signal); yield {reference:ref, kind:'locator-catalog', bytes};
    for (const index of INDEXES) for await (const item of traverse(root[index], index, signal)) {
      if (item.ref) {
        yield {reference:{fileId:item.ref.fileId, sha256:item.ref.sha256}, kind:'locator-catalog-page', bytes:item.bytes};
      } else if (index === 'objects') {
        const [pk, e] = item.pair;
        if (await find(root.identities, 'identities', identityKey(e), signal) !== pk || await find(root.files, 'files', e.fileId, signal) !== pk) fail('index-mismatch', 'Locator indexes do not form a one-to-one mapping.');
        if(opaqueBodies)yield {reference:{fileId:e.fileId,sha256:e.sha256},kind:e.kind,byteLength:await verifyEntry(e,signal),entry:clone(e)};
        else {const body=await readEntry(e,signal);yield {reference:{fileId:e.fileId,sha256:e.sha256},kind:e.kind,bytes:body,entry:clone(e)};}
      }
    }
  }
  function walk(inputRoot, opts = {}) {
    const ref = pin(inputRoot), {signal} = options(opts, ['signal']);
    return (async function* () {
      for await (const item of checkedWalk(ref, signal)) yield {...item, reference:{...item.reference}, bytes:new Uint8Array(item.bytes)};
    })();
  }
  async function verifyComplete(inputRoot, opts = {}) {
    const ref = pin(inputRoot), {signal} = options(opts, ['signal']); let objects = 0n, pages = 0n, bytes = 0n;
    if(!verifyBody) {
      for await (const item of checkedWalk(ref, signal, true)) {
        if (item.entry) objects++; else pages++;
        bytes += BigInt(item.byteLength ?? item.bytes.length);
      }
    } else {
      const {root,bytes:rootBytes}=await readRoot(ref,signal);pages++;bytes+=BigInt(rootBytes.length);
      const pending=[];let bodyFailed=false,bodyFailure;
      const drain=async()=>{
        const results=await Promise.all(pending.splice(0));
        const failure=results.find(x=>!x.ok);if(failure)throw bodyFailure;
        for(const result of results){objects++;bytes+=BigInt(result.length);}
      };
      try {
        for(const index of INDEXES)for await(const item of traverse(root[index],index,signal)) {
          if(item.ref){pages++;bytes+=BigInt(item.bytes.length);}
          else if(index==='objects') {
            const [pk,e]=item.pair;
            // These two distinct immutable indexes are independent. Drain both
            // before accepting their mappings or starting this entry's body.
            let lookupFailed=false,lookupFailure;
            const lookup=promise=>promise.catch(error=>{
              if(!lookupFailed || (lookupFailure?.code==='verification-scope-closed'&&error?.code!=='verification-scope-closed')) {
                lookupFailed=true;lookupFailure=error;
              }
              throw error;
            });
            if(pending.length<7) {
              const matches=await Promise.allSettled([
                lookup(find(root.identities,'identities',identityKey(e),signal)),
                lookup(find(root.files,'files',e.fileId,signal))
              ]);
              if(lookupFailed)throw lookupFailure;
              if(matches.some(result=>result.value!==pk))fail('index-mismatch','Locator indexes do not form a one-to-one mapping.');
            } else {
              // Seven admitted body reads leave room for only one index read.
              if(await find(root.identities,'identities',identityKey(e),signal)!==pk || await find(root.files,'files',e.fileId,signal)!==pk)fail('index-mismatch','Locator indexes do not form a one-to-one mapping.');
            }
            const operation=verifyEntry(e,signal);
            pending.push(operation.then(length=>({ok:true,length}),error=>{if(!bodyFailed){bodyFailed=true;bodyFailure=error;}return {ok:false,error};}));
            if(pending.length===8)await drain();
          }
        }
        await drain();
      } catch(error) {
        await Promise.all(pending);
        // A failed body can expire the phase while the structural walk is
        // awaiting an index read. Preserve the cause, not that follow-on error.
        if(error?.code==='verification-scope-closed'&&bodyFailed)throw bodyFailure;
        throw error;
      } finally {await Promise.all(pending);}
    }
    return {entryCount:String(objects), catalogPages:String(pages), byteLength:String(bytes)};
  }
  async function verify(inputRoot,opts={}) {
    if(!verifyBody||!decodedPages?.captureVerification)return verifyComplete(inputRoot,opts);
    const ref=pin(inputRoot),{signal}=options(opts,['signal']);
    abort(signal);adapterScope();
    const owner=decodedPages.captureVerification();
    if(!owner)return verifyComplete(ref,{signal});
    const memoKey=canonicalizeJcs([ref.fileId,ref.sha256,databaseId,copyId,folderId,maxNodeBytes,maxEntries,maxChildren]);
    const cost=new TextEncoder().encode(memoKey).length;
    try {
      owner.assertCurrent();
      let memo=completeTreeMemos.get(owner.identity);
      const hit=memo?.entries.get(memoKey);
      if(hit){abort(signal);adapterScope();owner.assertCurrent();return {...hit};}
      const result=await verifyComplete(ref,{signal});
      abort(signal);adapterScope();owner.assertCurrent();
      if(cost<=MEMO_KEY_BYTES) {
        memo=completeTreeMemos.get(owner.identity);
        if(!memo){memo={entries:new Map(),bytes:0};completeTreeMemos.set(owner.identity,memo);}
        if(!memo.entries.has(memoKey)) {
          while(memo.entries.size>=MEMO_ROOTS||memo.bytes+cost>MEMO_KEY_BYTES){
            const first=memo.entries.keys().next().value;
            memo.entries.delete(first);memo.bytes-=new TextEncoder().encode(first).length;
          }
          memo.entries.set(memoKey,Object.freeze({...result}));memo.bytes+=cost;
        }
      }
      return {...result};
    }catch(error){
      completeTreeMemos.delete(owner.identity);
      // This token may invalidate only its own still-current phase, never a
      // successor opened while this verification was awaiting a body.
      owner.invalidate();throw error;
    }
  }
  return Object.freeze({build, set, setMany, get, readObject, entries, page, inspect, walk, verify,
    limits:Object.freeze({maxNodeBytes, maxEntries, maxChildren, maxObjectBytes:PAGED_LOCATOR_MAX_BYTES, maxRootBytes:PAGED_LOCATOR_ROOT_BYTES})});
}
