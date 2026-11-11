import {utf8ByteLength} from './utf8-length.mjs';
import {validateLedger} from './canonical-import.mjs';
import {CANONICAL_COLLECTIONS} from './canonical-history.mjs';
import {createCanonicalMonthIndex} from './canonical-month-index.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {createImmutablePageTree, PAGE_TREE_MAX_BYTES} from './immutable-page-tree.mjs';

export const PARTITIONED_CANONICAL_FORMAT = 'finance-tracker-partitioned-canonical';
export const PARTITIONED_CANONICAL_VERSION = 4;
export const PARTITION_VALUE_CHARS = 1024;
export const COMPACT_PARTITION_CODEC = 'compact-json-v1';
export const PARTITION_INLINE_BYTES = 4096;
export const PARTITION_INLINE_DEPTH = 24;
export const PARTITION_COLLECTIONS = CANONICAL_COLLECTIONS;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArray,'byteLength').get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray,'buffer').get;
const ordinaryBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const HASH = /^[0-9a-f]{64}$/, DECIMAL = /^(0|[1-9][0-9]*)$/;
export const partitionFail = message => { throw new TypeError(message); };
export function partitionAbort(signal) {
  if (signal?.aborted) throw new DOMException('Canonical partition operation cancelled.', 'AbortError');
}
export function partitionFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value,key))) partitionFail('invalid-partition-shape');
}
export function partitionOptions(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) partitionFail('invalid-partition-options');
  return value;
}
export function partitionHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) partitionFail('invalid-partition-hash');
  return value;
}
export function partitionCount(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) partitionFail('invalid-partition-count');
  return BigInt(value);
}
// Length first, then digits: lexical order agrees with unsigned integer order.
// Unlike a fixed decimal padding width this does not wrap at a chosen frontier.
export function partitionOrdinal(value) {
  const text = String(value); partitionCount(text);
  return 'a'.repeat(text.length) + ':' + text;
}
export function partitionLimit(value = 128) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 128) partitionFail('invalid-partition-page-limit');
  return value;
}
export const partitionSort = entries => entries.sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
// The converter receives whole JSON in memory. Own it before the first await;
// getters, cycles, sparse arrays and non-JSON objects are never interpreted.
export function snapshotPartitionJson(value,maxBytes = Infinity,maxDepth = 128) {
  return partitionJson(value,maxBytes,maxDepth,true);
}
// The same traversal checks owned values without constructing a discarded copy.
// This mode stays private; callers always enter through an owned snapshot.
function partitionJson(value,maxBytes,maxDepth,copy) {
  const active = new Set();
  let bytes = 0;
  function spend(text) {
    bytes += utf8ByteLength(text);
    if (bytes > maxBytes) partitionFail('partition-object-too-large');
  }
  function string(text) {
    if (text.length > maxBytes - bytes) partitionFail('partition-object-too-large');
    spend(canonicalizeJcs(text));
  }
  function visit(item,depth) {
    if (depth > maxDepth) partitionFail('partition-input-depth-limit');
    if (item === null || ['string','number','boolean'].includes(typeof item)) {
      if (typeof item === 'string') string(item); else spend(canonicalizeJcs(item));
      return Object.is(item,-0) ? 0 : item;
    }
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) partitionFail('non-json-partition-input');
    if (active.has(item)) partitionFail('cyclic-partition-input');
    if (Object.getOwnPropertySymbols(item).length) partitionFail('non-json-partition-input');
    active.add(item);
    const array = Array.isArray(item), result = copy ? (array ? [] : {}) : null;
    if (array && item.length > maxBytes - bytes) partitionFail('partition-object-too-large');
    // Avoid first allocating an enumerable-key list proportional to an
    // oversized candidate. Reflection still inspects caller-owned property
    // metadata to reject hidden properties; this is not a streaming input API.
    const keys = [];
    for (const key in item) if (Object.hasOwn(item,key)) {
      if (keys.length >= maxBytes - bytes || key.length > maxBytes - bytes) partitionFail('partition-object-too-large');
      keys.push(key);
    }
    const names = Object.getOwnPropertyNames(item);
    if (names.length !== keys.length + (array ? 1 : 0) || (array && keys.length !== item.length)) partitionFail('non-json-partition-properties');
    spend(array ? '[]' : '{}');
    for (let index = 0; index < keys.length; index++) {
      const key = array ? String(index) : keys[index], descriptor = Object.getOwnPropertyDescriptor(item,key);
      if (!descriptor || !Object.hasOwn(descriptor,'value')) partitionFail('non-json-partition-accessor');
      if (index) spend(',');
      if (!array) { string(key); spend(':'); }
      const child = visit(descriptor.value,depth+1);
      if (copy) Object.defineProperty(result,key,{value:child,enumerable:true,writable:true,configurable:true});
    }
    active.delete(item); return result;
  }
  return visit(value,0);
}
const snapshotJson = snapshotPartitionJson;
export async function partitionDigest(bytes) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
}

/** Fixed-size root objects share the exact-byte addressing contract with pages.
 * The adapter must bound incoming transport bytes before allocating a response.
 */
export function createPartitionObjectIO(store) {
  if (!store || typeof store.read !== 'function') partitionFail('invalid-partition-store');
  const readStore = store.read.bind(store), writeStore = store.write?.bind(store);
  const bytesFor = value => {
    if (!(value instanceof Uint8Array)) partitionFail('invalid-partition-bytes');
    try { ordinaryBufferLength.call(bufferOf.call(value)); }
    catch { partitionFail('invalid-partition-bytes'); }
    if (byteLengthOf.call(value) > PAGE_TREE_MAX_BYTES) partitionFail('invalid-partition-bytes');
    return new Uint8Array(value);
  };
  async function read(hash,{signal} = {}) {
    partitionHash(hash); partitionAbort(signal);
    const bytes = bytesFor(await readStore(hash,{signal,maxBytes:PAGE_TREE_MAX_BYTES})); partitionAbort(signal);
    if (await partitionDigest(bytes) !== hash) partitionFail('partition-hash-mismatch');
    partitionAbort(signal);
    const text = decoder.decode(bytes), value = JSON.parse(text);
    if (canonicalizeJcs(value) !== text) partitionFail('noncanonical-partition-json');
    return value;
  }
  async function write(value,{signal} = {}) {
    partitionAbort(signal);
    if (!writeStore) partitionFail('partition-store-read-only');
    const bytes = encoder.encode(canonicalizeJcs(snapshotJson(value,PAGE_TREE_MAX_BYTES)));
    if (bytes.length > PAGE_TREE_MAX_BYTES) partitionFail('partition-object-too-large');
    const hash = await partitionDigest(bytes); partitionAbort(signal);
    if (await writeStore(bytes.slice(),{signal}) !== hash) partitionFail('partition-write-hash-mismatch');
    partitionAbort(signal);
    const stored = bytesFor(await readStore(hash,{signal,maxBytes:PAGE_TREE_MAX_BYTES})); partitionAbort(signal);
    if (stored.length !== bytes.length || !stored.every((b,i) => b === bytes[i])) partitionFail('partition-write-readback-mismatch');
    return hash;
  }
  return {read,write};
}

function valueVersion(version) {
  if (![1,2].includes(version)) partitionFail('unsupported-partition-value-version');
  return version;
}
export function validatePartitionValue(ref,version = 1) {
  valueVersion(version);
  // Own the entire descriptor before inspecting kind/value. Validating only
  // ref.value would let an accessor return different bytes during cloning.
  return validateOwnedPartitionValue(snapshotPartitionJson(ref,PAGE_TREE_MAX_BYTES),version);
}
// Only receives a strict owned snapshot or fresh JSON from the private tree
// reader. Tree pages already enforce stricter descriptor byte/depth bounds.
function validateOwnedPartitionValue(ref,version) {
  if (ref?.kind === 'json' && version === 2) {
    partitionFields(ref,['kind','value']);
    partitionJson(ref.value,PARTITION_INLINE_BYTES,PARTITION_INLINE_DEPTH,false);
  } else if (ref?.kind === 'scalar') {
    partitionFields(ref,['kind','value']);
    if (ref.value !== null && !['string','number','boolean'].includes(typeof ref.value)) partitionFail('invalid-partition-scalar');
    if (typeof ref.value === 'string' && ref.value.length > PARTITION_VALUE_CHARS) partitionFail('oversized-partition-scalar');
    canonicalizeJcs(ref.value);
  } else {
    if (!['array','object','string'].includes(ref?.kind)) partitionFail('invalid-partition-value');
    partitionFields(ref,ref.kind === 'string' ? ['kind','root','count','codeUnits'] : ['kind','root','count']);
    partitionHash(ref.root); partitionCount(ref.count);
    if (ref.kind === 'string' && (partitionCount(ref.codeUnits) <= BigInt(PARTITION_VALUE_CHARS) || partitionCount(ref.count) < 2n)) partitionFail('invalid-partition-string');
  }
  return ref;
}

/** Codec v1 pages every array/object; v2 inlines bounded JSON and otherwise
 * uses the same paged fallback. Long names and strings remain chunkable. This
 * encodes values, not a promise that JS can materialize arbitrary size.
 */
export function createPartitionValueCodec(store,options = {}) {
  const {version = 1} = partitionOptions(options,['version']); valueVersion(version);
  const validate = ref => validatePartitionValue(ref,version);
  // Only called on a privately owned JSON snapshot. Abort the candidate at its
  // byte/depth bound without serializing an oversized record or string.
  function inlineFits(value) {
    let bytes = 0;
    function add(text) { bytes += utf8ByteLength(text); return bytes <= PARTITION_INLINE_BYTES; }
    function string(text) { return text.length <= PARTITION_INLINE_BYTES - bytes && add(canonicalizeJcs(text)); }
    function visit(item,depth) {
      if (depth > PARTITION_INLINE_DEPTH) return false;
      if (typeof item === 'string') return string(item);
      if (item === null || typeof item !== 'object') return add(canonicalizeJcs(item));
      if (!add('[]')) return false;
      let index = 0;
      for (const key in item) if (Object.hasOwn(item,key)) {
        if (index++ && !add(',')) return false;
        if (!Array.isArray(item) && (!string(key) || !add(':'))) return false;
        if (!visit(item[key],depth+1)) return false;
      }
      return true;
    }
    return visit(value,0);
  }
  const tree = createImmutablePageTree({read:store.read.bind(store),write:store.write?.bind(store) ?? (() => partitionFail('partition-store-read-only'))});
  async function encodeNode(value,{signal} = {}) {
    partitionAbort(signal);
    if (value === null || typeof value !== 'object') {
      if (typeof value !== 'string' || value.length <= PARTITION_VALUE_CHARS) return validate({kind:'scalar',value});
      // Validate Unicode before splitting, and never split a surrogate pair.
      canonicalizeJcs(value);
      let count = 0n;
      function* chunks() {
        for (let start = 0; start < value.length;) {
          let end = Math.min(start + PARTITION_VALUE_CHARS,value.length);
          if (end < value.length && /[\uD800-\uDBFF]/.test(value[end-1])) end--;
          yield [partitionOrdinal(count++),value.slice(start,end)]; start = end;
        }
      }
      const root = await tree.build(chunks(),{signal});
      return {kind:'string',root,count:String(count),codeUnits:String(value.length)};
    }
    if (version === 2 && inlineFits(value)) return {kind:'json',value};
    const array = Array.isArray(value), keys = array ? null : Object.keys(value).sort();
    const count = String(array ? value.length : keys.length);
    async function* entries() {
      let ordinal = 0n;
      if (array) {
        for (const item of value) yield [partitionOrdinal(ordinal++),await encodeNode(item,{signal})];
      } else {
        for (const key of keys) yield [partitionOrdinal(ordinal++),{key:await encodeNode(key,{signal}),value:await encodeNode(value[key],{signal})}];
      }
    }
    return {kind:array ? 'array' : 'object',root:await tree.build(entries(),{signal}),count};
  }
  async function encode(value,options = {}) {
    const {signal} = partitionOptions(options,['signal']); partitionAbort(signal);
    return encodeNode(snapshotJson(value),{signal});
  }
  function entryShape(ref,value) {
    if (ref.kind === 'string') {
      if (typeof value !== 'string' || !value.length || value.length > PARTITION_VALUE_CHARS) partitionFail('invalid-partition-string-chunk');
    } else if (ref.kind === 'array') validateOwnedPartitionValue(value,version);
    else {
      partitionFields(value,['key','value']); validateOwnedPartitionValue(value.key,version); validateOwnedPartitionValue(value.value,version);
      const inlineKey = version === 2 && value.key.kind === 'json';
      if (!(value.key.kind === 'string' || ((value.key.kind === 'scalar' || inlineKey) && typeof value.key.value === 'string'))) partitionFail('invalid-partition-property');
    }
  }
  async function page(ref, options = {}) {
    const {limit = 128,cursor = null,signal} = partitionOptions(options,['limit','cursor','signal']);
    ref = validate(ref); partitionLimit(limit); partitionAbort(signal);
    if (ref.kind === 'scalar') partitionFail('partition-scalar-is-not-paged');
    if (ref.kind === 'json') {
      if (!ref.value || typeof ref.value !== 'object') partitionFail('partition-scalar-is-not-paged');
      const ownedCursor = cursor === null ? null : snapshotPartitionJson(cursor,PARTITION_INLINE_BYTES);
      const hash = await partitionDigest(encoder.encode(canonicalizeJcs(ref))); partitionAbort(signal);
      let start = 0;
      if (ownedCursor !== null) {
        partitionFields(ownedCursor,['format','version','hash','next']);
        if (ownedCursor.format !== 'finance-tracker-inline-value-cursor' || ownedCursor.version !== 1 || ownedCursor.hash !== hash ||
            !Number.isSafeInteger(ownedCursor.next) || ownedCursor.next < 1) partitionFail('partition-cursor-mismatch');
        start = ownedCursor.next;
      }
      const array = Array.isArray(ref.value), keys = Object.keys(ref.value).sort();
      const count = array ? ref.value.length : keys.length;
      if (start >= count && cursor !== null) partitionFail('partition-cursor-mismatch');
      const end = Math.min(start + limit,count), entries = [];
      for (let i = start; i < end; i++) {
        const key = array ? i : keys[i], child = {kind:'json',value:ref.value[key]};
        entries.push([partitionOrdinal(i),array ? child : {key:{kind:'json',value:key},value:child}]);
      }
      return {entries,cursor:end < count ? {format:'finance-tracker-inline-value-cursor',version:1,hash,next:end} : null};
    }
    const info = await tree.inspect(ref.root,{signal});
    if (info.count !== ref.count) partitionFail('partition-value-count-mismatch');
    const result = await tree.page(ref.root,{limit,cursor,signal});
    for (const [,value] of result.entries) entryShape(ref,value);
    return result;
  }
  /** Explicit bounded convenience. These budgets limit one requested expansion,
   * not stored database size. Use page() for data that should not be assembled.
   */
  async function materialize(ref, options = {}) {
    const {signal,maxValues = 1000000,maxStringCodeUnits = 4000000} = partitionOptions(options,['signal','maxValues','maxStringCodeUnits']);
    for (const limit of [maxValues,maxStringCodeUnits]) if (!Number.isSafeInteger(limit) || limit < 1) partitionFail('invalid-materialization-budget');
    ref = validate(ref);
    let values = 0, chars = 0;
    function spendString(value) { chars += value.length; if (chars > maxStringCodeUnits) partitionFail('partition-materialization-budget'); return value; }
    function inline(value,depth,alreadyCounted = false) {
      partitionAbort(signal);
      if ((!alreadyCounted && ++values > maxValues) || depth > 128) partitionFail('partition-materialization-budget');
      if (typeof value === 'string') return spendString(value);
      if (value === null || typeof value !== 'object') return value;
      const array = Array.isArray(value), result = array ? [] : {};
      for (const key of Object.keys(value)) {
        if (!array) inline(key,depth+1);
        Object.defineProperty(result,key,{value:inline(value[key],depth+1),enumerable:true,writable:true,configurable:true});
      }
      return result;
    }
    async function visit(value,depth = 0) {
      // The root was snapshotted and validated above; entryShape validates each
      // freshly decoded child before recursion. Neither can alias caller data.
      partitionAbort(signal);
      if (++values > maxValues || depth > 128) partitionFail('partition-materialization-budget');
      if (value.kind === 'json') return inline(value.value,depth,true);
      if (value.kind === 'scalar') return typeof value.value === 'string' ? spendString(value.value) : value.value;
      const info = await tree.verify(value.root,{signal});
      if (info.count !== value.count) partitionFail('partition-value-count-mismatch');
      if (partitionCount(value.count) > BigInt(maxValues - values)) partitionFail('partition-materialization-budget');
      let ordinal = 0n, previous = null;
      const result = value.kind === 'object' ? {} : [];
      for await (const [key,item] of tree.entries(value.root,{signal})) {
        if (key !== partitionOrdinal(ordinal++)) partitionFail('partition-value-order-mismatch');
        entryShape(value,item);
        if (value.kind === 'array') result.push(await visit(item,depth+1));
        else if (value.kind === 'object') {
          const name = await visit(item.key,depth+1);
          if (previous !== null && previous >= name) partitionFail('partition-property-order-mismatch');
          previous = name;
          Object.defineProperty(result,name,{value:await visit(item.value,depth+1),enumerable:true,writable:true,configurable:true});
        } else { if (++values > maxValues) partitionFail('partition-materialization-budget'); result.push(spendString(item)); }
      }
      if (String(ordinal) !== value.count) partitionFail('partition-value-count-mismatch');
      if (value.kind !== 'string') return result;
      const text = result.join('');
      if (String(text.length) !== value.codeUnits) partitionFail('partition-string-length-mismatch');
      return text;
    }
    return visit(ref);
  }
  return Object.freeze({encode,page,materialize,tree,validate});
}

export function validatePartitionRoot(root) {
  const compact = Object.hasOwn(root ?? {},'valueCodec');
  partitionFields(root,['format','version','syntheticOnly','source','derived',...(compact?['valueCodec']:[])]);
  if (root.format !== PARTITIONED_CANONICAL_FORMAT || root.version !== 4 || root.syntheticOnly !== true ||
      (compact && root.valueCodec !== COMPACT_PARTITION_CODEC)) partitionFail('unsupported-partitioned-canonical');
  partitionHash(root.source); partitionHash(root.derived); return root;
}
export function validatePartitionSource(source,version = source?.version) {
  partitionFields(source,['format','version','metadata','collections','eventFrontier','positionEventFrontier']);
  if (source.format !== PARTITIONED_CANONICAL_FORMAT + '-source' || ![1,2].includes(version) || source.version !== version) partitionFail('unsupported-partition-source');
  validatePartitionValue(source.metadata,version);
  if (source.metadata.kind !== 'object' && !(version === 2 && source.metadata.kind === 'json' && source.metadata.value && typeof source.metadata.value === 'object' && !Array.isArray(source.metadata.value))) partitionFail('invalid-partition-metadata');
  partitionHash(source.collections); partitionCount(source.eventFrontier); partitionCount(source.positionEventFrontier); return source;
}
export function validatePartitionCollection(name,value) {
  if (!Object.hasOwn(PARTITION_COLLECTIONS,name)) partitionFail('unsupported-partition-collection');
  partitionFields(value,['idField','byId','order','count']);
  if (value.idField !== PARTITION_COLLECTIONS[name]) partitionFail('invalid-partition-collection');
  partitionHash(value.byId); partitionHash(value.order); partitionCount(value.count); return value;
}
export function validatePartitionDerived(value,sourceHash,version = 1) {
  partitionFields(value,['format','version','source','effectiveActivities','monthActivities','summaries']);
  if (value.format !== PARTITIONED_CANONICAL_FORMAT + '-derived' || ![1,2].includes(version) || value.version !== version || value.source !== sourceHash) partitionFail('invalid-partition-derived-source');
  for (const key of ['effectiveActivities','monthActivities','summaries']) partitionHash(value[key]);
  return value;
}

/** Reference builder only: full valid legacy/current ledger in memory. */
export async function buildPartitionDerived(ledger,sourceHash,store,options = {}) {
  const {signal,version = 1} = partitionOptions(options,['signal','version']); valueVersion(version);
  const codec = createPartitionValueCodec(store,{version}), {tree} = codec, io = createPartitionObjectIO(store);
  const index = createCanonicalMonthIndex(ledger), effective = [], membership = [], summaries = [];
  let ordinal = 0n;
  for (const activity of index.effectiveActivities()) {
    if (version === 2 && Object.values(activity).some(value => value === undefined)) {
      throw Object.assign(new Error('A linked refund has an undefined derived field. Preserve this copy and add an explicit category correction to its original activity before copying to v4.'),{code:'unsupported-derived-projection'});
    }
    const ref = await codec.encode(activity,{signal});
    effective.push([activity.activityId,ref]);
    if (activity.active) {
      const date = activity.activityKind === 'refund' ? activity.postedDate : activity.effectiveDate;
      const month = date === null ? '@undated' : date.slice(0,7);
      membership.push([`${activity.accountId}/${month}/${partitionOrdinal(ordinal)}`,activity.activityId]);
    }
    ordinal++;
  }
  for (const summary of index.monthlySummaries()) {
    // V4 index counters are decimal strings, independent of JS safe-integer math.
    summary.availability.eligibleActivityCount = String(summary.availability.eligibleActivityCount);
    summaries.push([`${summary.accountId}/${summary.month}/${summary.currency}`,await codec.encode(summary,{signal})]);
  }
  return io.write({format:PARTITIONED_CANONICAL_FORMAT + '-derived',version,source:sourceHash,
    effectiveActivities:await tree.build(partitionSort(effective),{signal}),
    monthActivities:await tree.build(partitionSort(membership),{signal}),
    summaries:await tree.build(partitionSort(summaries),{signal})},{signal});
}

/** Isolated v4 encoder. It does not publish, migrate, or change the app default. */
async function buildPartitionParts(ledger,store,{signal},version) {
  partitionAbort(signal);
  // Snapshot synchronously before any store awaits. The existing validator is
  // the independent semantic oracle; never feed it a partial ledger.
  const snapshot = snapshotJson(ledger); validateLedger(snapshot);
  const codec = createPartitionValueCodec(store,{version}), {tree} = codec, io = createPartitionObjectIO(store);
  const metadata = {...snapshot}, collections = [];
  for (const [name,idField] of Object.entries(PARTITION_COLLECTIONS)) {
    if (!Object.hasOwn(snapshot,name)) continue;
    const records = [], order = []; let ordinal = 0n;
    for (const record of snapshot[name]) {
      records.push([record[idField],await codec.encode(record,{signal})]);
      order.push([partitionOrdinal(ordinal++),record[idField]]);
    }
    collections.push([name,{idField,byId:await tree.build(partitionSort(records),{signal}),
      order:await tree.build(order,{signal}),count:String(ordinal)}]);
    delete metadata[name];
  }
  const source = await io.write({format:PARTITIONED_CANONICAL_FORMAT + '-source',version,
    metadata:await codec.encode(metadata,{signal}),collections:await tree.build(partitionSort(collections),{signal}),
    eventFrontier:String(snapshot.events.length),positionEventFrontier:String(snapshot.positionEvents?.length ?? 0)},{signal});
  const derived = await buildPartitionDerived(snapshot,source,store,{signal,version});
  return {sourceHash:source,derivedHash:derived};
}

/** Legacy v4 remains byte-compatible and never gains compact descriptors. */
export async function buildPartitionedCanonicalLedger(ledger,store,options = {}) {
  const {signal} = partitionOptions(options,['signal']);
  const {sourceHash:source,derivedHash:derived} = await buildPartitionParts(ledger,store,{signal},1);
  const io = createPartitionObjectIO(store);
  const rootHash = await io.write({format:PARTITIONED_CANONICAL_FORMAT,version:4,syntheticOnly:true,source,derived},{signal});
  return {rootHash,sourceHash:source,derivedHash:derived};
}

/** Explicit v4 codec extension. The tag makes old v4 readers reject before
 * interpreting source/derived-v2; the original v4 encoder remains unchanged. */
export async function buildCompactPartitionedCanonicalLedger(ledger,store,options = {}) {
  const {signal} = partitionOptions(options,['signal']);
  const {sourceHash:source,derivedHash:derived} = await buildPartitionParts(ledger,store,{signal},2);
  const rootHash = await createPartitionObjectIO(store).write({format:PARTITIONED_CANONICAL_FORMAT,version:4,
    syntheticOnly:true,source,derived,valueCodec:COMPACT_PARTITION_CODEC},{signal});
  return {rootHash,sourceHash:source,derivedHash:derived};
}
