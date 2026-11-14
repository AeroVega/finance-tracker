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
export class PagedLocatorError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PagedLocatorError'; this.code = code; this.details = details; }
}
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


export function createLocatorCodec(config) {
  options(config,['databaseId','copyId','maxNodeBytes','maxEntries','maxChildren']);
  const databaseId=identifier(config.databaseId),copyId=identifier(config.copyId);
  const {maxNodeBytes,maxEntries,maxChildren}=config;
  if(!Number.isSafeInteger(maxNodeBytes)||maxNodeBytes<4096||maxNodeBytes>65536||!Number.isSafeInteger(maxEntries)||maxEntries<2||maxEntries>128||!Number.isSafeInteger(maxChildren)||maxChildren<3||maxChildren>128)fail('invalid-options','Invalid locator codec limits.');
  function identity(value) {
    if (value.databaseId !== databaseId || value.copyId !== copyId) fail('copy-mismatch', 'Catalog content belongs to another database or physical copy.');
  }
  function key(k, index) {
    if (index === 'objects') return primaryKey(k);
    if (index === 'files') return identifier(k);
    if (typeof k !== 'string' || ![...KINDS].some(kind => k.startsWith(kind + ':'))) fail('invalid-key', 'Expected a kind and legacy identity key.');
    identifier(k.slice(k.indexOf(':') + 1)); return k;
  }
  function reference(ref, index) {
    fields(ref, ['fileId', 'sha256', 'height', 'count', 'min', 'max']); identifier(ref.fileId); hash(ref.sha256);
    const height = decimal(ref.height), count = decimal(ref.count);
    if (count === 0n || key(ref.min, index) > key(ref.max, index)) fail('invalid-range', 'Child references require a nonempty ordered range.');
    if (height > BigInt(count.toString(2).length - 1)) fail('invalid-height', 'A non-unary tree cannot be taller than its exact count permits.');
  }
  const summary = node => ({height:node.height, count:node.count, min:node.min, max:node.max});
  function nodeFor(index, nodeType, items) {
    const leaf = nodeType === 'leaf';
    return {format:PAGED_LOCATOR_NODE_FORMAT, version:1, databaseId, copyId, index, nodeType,
      height:leaf ? '0' : String(decimal(items[0].height) + 1n),
      count:leaf ? String(items.length) : String(items.reduce((n, c) => n + decimal(c.count), 0n)),
      min:leaf ? items[0][0] : items[0].min, max:leaf ? items.at(-1)[0] : items.at(-1).max,
      [leaf ? 'entries' : 'children']:items};
  }
  function validateNode(node, index) {
    const leaf = node?.nodeType === 'leaf';
    fields(node, ['format', 'version', 'databaseId', 'copyId', 'index', 'nodeType', 'height', 'count', 'min', 'max', leaf ? 'entries' : 'children']);
    identity(node);
    if (node.format !== PAGED_LOCATOR_NODE_FORMAT || node.version !== 1 || node.index !== index || !['leaf', 'branch'].includes(node.nodeType)) fail('invalid-node', 'Unsupported page format or index.');
    const items = leaf ? node.entries : node.children, height = decimal(node.height);
    decimal(node.count);
    if (!Array.isArray(items) || items.length < (leaf ? 1 : 2) || items.length > (leaf ? maxEntries : maxChildren)) fail('entry-limit', 'Leaves need entries and branches need at least two children.');
    if ((height === 0n) !== leaf) fail('invalid-height', 'Page height contradicts its kind.');
    let previous = null;
    const siblingIds = new Set(); // At most one page of children, never the catalog.
    for (const item of items) {
      if (leaf) {
        if (!Array.isArray(item) || item.length !== 2) fail('invalid-entry', 'Expected [key, value].');
        key(item[0], index);
        if (index === 'objects') { entry(item[1]); if (objectKey(item[1]) !== item[0]) fail('invalid-entry', 'Entry key does not match its kind and hash.'); }
        else primaryKey(item[1]);
      } else {
        reference(item, index);
        if (decimal(item.height) + 1n !== height) fail('invalid-height', 'Child height must decrease by one.');
        if (siblingIds.has(item.fileId)) fail('duplicate-child', 'One page repeats a physical child.');
        siblingIds.add(item.fileId);
      }
      const min = leaf ? item[0] : item.min, max = leaf ? item[0] : item.max;
      if (previous !== null && previous >= min) fail('invalid-order', 'Entries and child ranges must be strictly ordered and disjoint.');
      previous = max;
    }
    const expected = nodeFor(index, node.nodeType, items);
    if (['height', 'count', 'min', 'max'].some(k => expected[k] !== node[k])) fail('invalid-range', 'Page count, boundaries or height disagree with its entries.');
    return node;
  }
  function validateRoot(root) {
    fields(root, ['format', 'version', 'databaseId', 'copyId', 'generation', 'previous', 'entryCount', ...INDEXES]); identity(root);
    if (root.format !== PAGED_LOCATOR_FORMAT || root.version !== PAGED_LOCATOR_VERSION) fail('unsupported-catalog', 'Only isolated locator catalog v3 is accepted.');
    const count = decimal(root.entryCount), generation = decimal(root.generation);
    if ((generation === 0n) !== (root.previous === null)) fail('invalid-parent', 'Only the initial catalog has no parent.');
    if (root.previous !== null) pointer(root.previous);
    const ids = new Set();
    for (const index of INDEXES) {
      if ((root[index] === null) !== (count === 0n)) fail('invalid-count', 'Empty catalogs must have exactly three null indexes.');
      if (root[index] !== null) {
        reference(root[index], index);
        if (root[index].count !== root.entryCount) fail('invalid-count', 'Every index must contain the exact catalog count.');
        if (ids.has(root[index].fileId)) fail('duplicate-child', 'Index roots cannot share a physical file.'); ids.add(root[index].fileId);
      }
    }
    return root;
  }
  return Object.freeze({key,reference,summary,nodeFor,validateNode,validateRoot});
}
export function locatorDecodeProfile(input) {
  const p=clone(input);fields(p,['schema','version','databaseId','copyId','index','maxNodeBytes','maxEntries','maxChildren']);
  if(!['root','page'].includes(p.schema)||p.version!==(p.schema==='root'?3:1)||(p.schema==='root'?p.index!==null:!INDEXES.includes(p.index)))fail('invalid-options','Invalid locator decode schema.');
  createLocatorCodec({databaseId:p.databaseId,copyId:p.copyId,maxNodeBytes:p.maxNodeBytes,maxEntries:p.maxEntries,maxChildren:p.maxChildren});
  return p;
}
export function decodeLocatorBytes(bytes,profile) {
  const maximum=profile.schema==='root'?PAGED_LOCATOR_ROOT_BYTES:profile.maxNodeBytes;
  let value;try{value=JSON.parse(decoder.decode(bytes));}catch{fail('invalid-json','Expected valid UTF-8 JSON.');}
  if(!equal(bytes,encode(value,maximum)))fail('noncanonical-json','Stored JSON must be canonical without duplicate fields.');
  const codec=createLocatorCodec({databaseId:profile.databaseId,copyId:profile.copyId,maxNodeBytes:profile.maxNodeBytes,maxEntries:profile.maxEntries,maxChildren:profile.maxChildren});
  return profile.schema==='root'?codec.validateRoot(value):codec.validateNode(value,profile.index);
}
