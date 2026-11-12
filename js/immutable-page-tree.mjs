import {utf8ByteLength} from './utf8-length.mjs';
/** Immutable, content-addressed ordered pages. This verifies structure, not the
 * completeness of a derived index against its source. No caller can confer trust.
 */
export const PAGE_TREE_FORMAT = 'finance-tracker-immutable-page-tree';
export const PAGE_TREE_VERSION = 1;
export const PAGE_TREE_MAX_BYTES = 64 * 1024;
export const PAGE_TREE_MAX_CHILDREN = 128;
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const ordinaryBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const plain = x => x !== null && typeof x === 'object' &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const unicode = s => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
export class PageTreeError extends Error {
  constructor(code, message) { super(message); this.name = 'PageTreeError'; this.code = code; }
}
const fail = (code, message) => { throw new PageTreeError(code, message); };
function fields(value, names, code = 'invalid-shape') {
  if (!plain(value) || Object.keys(value).length !== names.length || names.some(k => !Object.hasOwn(value, k))) {
    fail(code, 'Unexpected object shape.');
  }
}
function settings(value, allowed) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('invalid-options', 'Unknown option.');
  return value;
}
function abort(signal) {
  if (signal?.aborted) throw new DOMException('Page tree operation cancelled.', 'AbortError');
}
function rootHash(hash) {
  if (typeof hash !== 'string' || !HASH.test(hash)) fail('invalid-hash', 'Expected a lowercase SHA-256 hash.');
  return hash;
}
function decimal(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) fail('invalid-count', 'Counts and heights must be exact unsigned decimal strings.');
  return BigInt(value);
}

/** Strict deterministic JSON, with a finite byte budget and nesting bound. It
 * snapshots caller values before the first await. Accessors are never invoked.
 */
function json(value, byteLimit, initialDepth = 0) {
  const pieces = [], active = new Set();
  let bytes = 0;
  function emit(piece) {
    bytes += utf8ByteLength(piece);
    if (bytes > byteLimit) fail('node-byte-limit', 'JSON exceeds the per-page byte budget.');
    pieces.push(piece);
  }
  function string(s) {
    if (s.length > byteLimit) fail('node-byte-limit', 'String exceeds the per-page byte budget.');
    if (!unicode(s)) fail('invalid-unicode', 'Unpaired UTF-16 surrogates are not supported.');
    emit(JSON.stringify(s));
  }
  function visit(x, depth) {
    if (depth > 64) fail('value-depth-limit', 'JSON nesting exceeds 64 levels.');
    if (x === null) return emit('null');
    if (typeof x === 'string') return string(x);
    if (typeof x === 'boolean') return emit(String(x));
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) fail('invalid-number', 'Nonfinite JSON numbers are not supported.');
      return emit(JSON.stringify(x));
    }
    if (typeof x !== 'object' || (!Array.isArray(x) && !plain(x))) fail('invalid-value', 'Expected plain JSON data.');
    if (active.has(x)) fail('cyclic-value', 'JSON values cannot contain cycles.');
    active.add(x);
    if (Object.getOwnPropertySymbols(x).length) fail('invalid-value', 'Symbol properties are not JSON.');
    if (Array.isArray(x)) {
      if (x.length > byteLimit || Object.keys(x).length !== x.length) fail('invalid-value', 'Expected a bounded dense JSON array.');
      emit('[');
      for (let i = 0; i < x.length; i++) {
        if (i) emit(',');
        const d = Object.getOwnPropertyDescriptor(x, String(i));
        if (!d || !Object.hasOwn(d, 'value')) fail('invalid-value', 'JSON accessors are not supported.');
        visit(d.value, depth + 1);
      }
      emit(']');
    } else {
      const keys = [];
      for (const key in x) if (Object.hasOwn(x, key)) {
        if (keys.length >= byteLimit) fail('node-byte-limit', 'Object exceeds the per-page budget.');
        keys.push(key);
      }
      keys.sort(); emit('{');
      for (let i = 0; i < keys.length; i++) {
        if (i) emit(',');
        const key = keys[i], d = Object.getOwnPropertyDescriptor(x, key);
        if (!d || !Object.hasOwn(d, 'value')) fail('invalid-value', 'JSON accessors are not supported.');
        string(key); emit(':'); visit(d.value, depth + 1);
      }
      emit('}');
    }
    active.delete(x);
  }
  visit(value, initialDepth);
  return pieces.join('');
}
async function hashBytes(bytes) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
const metadata = node => ({count: node.count, min: node.min, max: node.max, height: node.height});
const refFor = (hash, node) => ({hash, ...metadata(node)});
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** store.read(hash, {signal, maxBytes}) -> Uint8Array; store.write(bytes, {signal}) -> hash.
 * write must preserve the supplied bytes. We verify its hash and exact read-back.
 * The adapter must bound transport reads before returning bytes. This module
 * bounds parsing and copying but cannot undo an adapter's oversized allocation.
 */
export function createImmutablePageTree(store, options = {}) {
  if (!store || typeof store.read !== 'function' || (store.write !== undefined && typeof store.write !== 'function')) fail('invalid-store', 'A readable content store is required.');
  settings(options, ['maxNodeBytes', 'maxEntries', 'maxChildren']);
  const maxNodeBytes = options.maxNodeBytes ?? PAGE_TREE_MAX_BYTES;
  const maxEntries = options.maxEntries ?? PAGE_TREE_MAX_CHILDREN;
  const maxChildren = options.maxChildren ?? PAGE_TREE_MAX_CHILDREN;
  if (!Number.isSafeInteger(maxNodeBytes) || maxNodeBytes < 1024 || maxNodeBytes > PAGE_TREE_MAX_BYTES ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries > 128 ||
      !Number.isSafeInteger(maxChildren) || maxChildren < 2 || maxChildren > 128) {
    fail('invalid-options', 'Page limits must be 1024..65536 bytes and 2..128 entries/children.');
  }
  // Two references must fit in a parent even when both boundary keys are long.
  const maxKeyBytes = Math.min(1024, Math.floor((maxNodeBytes - 512) / 8));
  const readStore = store.read.bind(store), writeStore = store.write?.bind(store);
  const encode = value => encoder.encode(json(value, maxNodeBytes));
  const copy = value => JSON.parse(json(value, maxNodeBytes));
  function key(value) {
    if (typeof value !== 'string' || !unicode(value)) fail('invalid-key', 'Keys must be well-formed Unicode strings.');
    if (value.length > maxKeyBytes || utf8ByteLength(JSON.stringify(value)) > maxKeyBytes) fail('key-byte-limit', 'Key exceeds the per-key byte budget.');
    return value;
  }
  function reference(ref) {
    fields(ref, ['hash', 'count', 'min', 'max', 'height']);
    rootHash(ref.hash); decimal(ref.height);
    if (decimal(ref.count) === 0n || key(ref.min) > key(ref.max)) fail('invalid-range', 'Child references need nonempty ordered ranges.');
  }
  function nodeFor(kind, items) {
    const leaf = kind === 'leaf';
    return {format: PAGE_TREE_FORMAT, version: PAGE_TREE_VERSION, kind,
      height: leaf ? '0' : String(BigInt(items[0].height) + 1n),
      count: leaf ? String(items.length) : String(items.reduce((n, child) => n + BigInt(child.count), 0n)),
      min: items.length ? (leaf ? items[0][0] : items[0].min) : null,
      max: items.length ? (leaf ? items.at(-1)[0] : items.at(-1).max) : null,
      [leaf ? 'entries' : 'children']: items};
  }
  function validate(node) {
    const leaf = node?.kind === 'leaf';
    fields(node, ['format', 'version', 'kind', 'height', 'count', 'min', 'max', leaf ? 'entries' : 'children']);
    if (node.format !== PAGE_TREE_FORMAT || node.version !== PAGE_TREE_VERSION || !['leaf', 'branch'].includes(node.kind)) fail('invalid-node', 'Unsupported page format.');
    const height = decimal(node.height), count = decimal(node.count);
    const items = leaf ? node.entries : node.children;
    if (!Array.isArray(items) || items.length > (leaf ? maxEntries : maxChildren) || (!leaf && !items.length)) fail('node-entry-limit', 'Invalid page entry/child count.');
    if ((leaf && height !== 0n) || (!leaf && height === 0n)) fail('invalid-height', 'Page height contradicts its kind.');
    let total = 0n, previous = null;
    for (const item of items) {
      if (leaf) {
        if (!Array.isArray(item) || item.length !== 2) fail('invalid-entry', 'An entry must be a [key, value] pair.');
        key(item[0]);
      } else {
        reference(item);
        if (BigInt(item.height) + 1n !== height) fail('invalid-height', 'Child heights must be exactly one below their parent.');
      }
      const min = leaf ? item[0] : item.min, max = leaf ? item[0] : item.max;
      if (previous !== null && previous >= min) fail('invalid-order', 'Keys and child ranges must be strictly ordered and disjoint.');
      previous = max; total += leaf ? 1n : BigInt(item.count);
    }
    const expected = nodeFor(node.kind, items);
    if (total !== count || node.min !== expected.min || node.max !== expected.max) fail('invalid-range', 'Page count or range does not match its entries.');
    return node;
  }
  function incomingBytes(value) {
    if (!(value instanceof Uint8Array)) fail('invalid-bytes', 'Store must return unshared Uint8Array bytes.');
    let byteLength, buffer;
    try {
      byteLength = nativeByteLength.call(value); buffer = nativeBuffer.call(value);
      ordinaryBufferLength.call(buffer);
    }
    catch { fail('invalid-bytes', 'Store must return an actual Uint8Array view.'); }
    if (byteLength > maxNodeBytes) fail('node-byte-limit', 'Stored page exceeds its byte budget.');
    // Intrinsic getters ignore shadowed properties. The typed-array constructor
    // copies internal elements, including Buffer and resizable-buffer views,
    // without invoking an adapter's slice method or iterable override.
    try { return new Uint8Array(value); }
    catch { fail('invalid-bytes', 'Store returned a detached or invalid byte view.'); }
  }
  async function readPage(hash, expected, signal) {
    abort(signal); rootHash(hash);
    const bytes = incomingBytes(await readStore(hash, {signal, maxBytes: maxNodeBytes}));
    abort(signal);
    if (await hashBytes(bytes) !== hash) fail('hash-mismatch', 'Stored bytes do not match their content address.');
    abort(signal);
    let node;
    try { node = JSON.parse(decoder.decode(bytes)); }
    catch { fail('invalid-json', 'Stored page must contain valid UTF-8 JSON.'); }
    // Also rejects duplicate object fields, alternate encodings and nonfinite numbers.
    if (!sameBytes(encode(node), bytes)) fail('noncanonical-json', 'Stored page bytes must use canonical JSON.');
    validate(node);
    if (expected && ['count', 'min', 'max', 'height'].some(k => expected[k] !== node[k])) fail('child-mismatch', 'Child content contradicts its parent reference.');
    return {node, bytes};
  }
  const read = async (hash, expected, signal) => (await readPage(hash, expected, signal)).node;
  async function write(node, signal) {
    if (!writeStore) fail('read-only-store', 'This content store has no write operation.');
    abort(signal); validate(node);
    const bytes = encode(node), hash = await hashBytes(bytes);
    abort(signal);
    const returned = await writeStore(bytes.slice(), {signal});
    abort(signal);
    if (returned !== hash) fail('write-hash-mismatch', 'The store did not return the exact supplied content hash.');
    const saved = incomingBytes(await readStore(hash, {signal, maxBytes: maxNodeBytes}));
    abort(signal);
    if (!sameBytes(bytes, saved)) fail('write-readback-mismatch', 'Written content failed exact read-back.');
    return refFor(hash, node);
  }
  // These keys are private owned entry/reference objects, never caller values
  // or read authority. Only exact serialized lengths are retained weakly.
  const itemLengths=new WeakMap();
  function fits(kind, items) {
    if (items.length > (kind === 'leaf' ? maxEntries : maxChildren)) return false;
    try {
      const node=nodeFor(kind,items);node[kind==='leaf'?'entries':'children']=[];
      let size=utf8ByteLength(json(node,maxNodeBytes))+Math.max(0,items.length-1);
      for(const item of items) {
        let length=itemLengths.get(item);
        if(length===undefined) {
          // In a page an item starts two levels below the root. Preserve the
          // original depth limit as well as its exact JSON/UTF-8 byte length.
          length=utf8ByteLength(json(item,maxNodeBytes,2));itemLengths.set(item,length);
        }
        size+=length;
        if(size>maxNodeBytes)return false;
      }
      return size<=maxNodeBytes;
    }
    catch (error) { if (error.code === 'node-byte-limit') return false; throw error; }
  }
  async function pack(kind, items, signal, emit = write) {
    const result = [];
    let buffer = [];
    for (const item of items) {
      if (buffer.length && !fits(kind, [...buffer, item])) {
        result.push(await emit(nodeFor(kind, buffer), signal)); buffer = [];
      }
      buffer.push(item);
      if (!fits(kind, buffer)) fail('node-byte-limit', 'A single entry cannot fit in a page.');
    }
    if (buffer.length) result.push(await emit(nodeFor(kind, buffer), signal));
    return result;
  }
  async function finishRoot(refs, signal) {
    while (refs.length > 1) {
      const next = await pack('branch', refs, signal);
      if (next.length >= refs.length) fail('node-byte-limit', 'A branch cannot fit two references.');
      refs = next;
    }
    if (!refs.length) return (await write(nodeFor('leaf', []), signal)).hash;
    // Delete/build can leave a unary root. Drop it without changing any old node.
    let ref = refs[0];
    while (BigInt(ref.height) > 0n) {
      const node = await read(ref.hash, ref, signal);
      if (node.children.length !== 1) break;
      ref = node.children[0];
    }
    return ref.hash;
  }
  async function build(iterable, opts = {}) {
    const {signal} = settings(opts, ['signal']); abort(signal);
    if (!iterable || (!iterable[Symbol.asyncIterator] && !iterable[Symbol.iterator])) fail('invalid-input', 'Build needs sorted iterable [key, value] pairs.');
    let leaf = [], previous = null;
    const levels = [];
    async function carry(start, first) {
      let level = start, ref = first;
      while (true) {
        const buffer = levels[level] ?? [];
        if (buffer.length && !fits('branch', [...buffer, ref])) {
          const emitted = await write(nodeFor('branch', buffer), signal);
          levels[level] = [ref]; ref = emitted; level++;
        } else { levels[level] = [...buffer, ref]; return; }
      }
    }
    for await (const input of iterable) {
      abort(signal);
      const pair = copy(input);
      if (!Array.isArray(pair) || pair.length !== 2) fail('invalid-entry', 'An entry must be a [key, value] pair.');
      const k = key(pair[0]);
      if (previous !== null && previous >= k) fail('invalid-order', 'Build input must be strictly ordered without duplicate keys.');
      previous = k;
      if (leaf.length && !fits('leaf', [...leaf, pair])) { await carry(0, await write(nodeFor('leaf', leaf), signal)); leaf = []; }
      leaf.push(pair);
      if (!fits('leaf', leaf)) fail('node-byte-limit', 'A single entry cannot fit in a page.');
    }
    abort(signal);
    if (leaf.length) await carry(0, await write(nodeFor('leaf', leaf), signal));
    if (!levels.length) return (await write(nodeFor('leaf', []), signal)).hash;
    for (let level = 0; level < levels.length; level++) {
      const buffer = levels[level]; levels[level] = [];
      if (level === levels.length - 1) return finishRoot(buffer, signal);
      if (buffer.length) await carry(level + 1, await write(nodeFor('branch', buffer), signal));
    }
    throw new Error('Unreachable builder state.');
  }
  async function descend(root, k, signal) {
    const ancestors = new Set();
    let hash = root, expected = null;
    while (true) {
      if (ancestors.has(hash)) fail('cycle', 'A page refers to an ancestor.');
      ancestors.add(hash);
      const node = await read(hash, expected, signal);
      if (node.kind === 'leaf') return node;
      let index = node.children.findIndex(child => child.max >= k);
      if (index < 0) index = node.children.length - 1;
      expected = node.children[index]; hash = expected.hash;
    }
  }
  async function get(root, inputKey, opts = {}) {
    const k = key(inputKey), {signal} = settings(opts, ['signal']); rootHash(root);
    const node = await descend(root, k, signal);
    return node.entries.find(entry => entry[0] === k)?.[1];
  }
  /** Apply an array of {type:'set', key, value}/{type:'delete', key} commands.
   * Every command is validated and snapshotted before the first await. Commands
   * must have strictly ordered, unique keys; callers coalesce repeated edits
   * into a final diff before calling. Duplicate/unordered commands are rejected.
   * Unchanged final values and missing deletes do not write pages.
   *
   * Edits share one visit per affected subtree. Root collapse may also read a
   * surviving unary chain. Untouched references are reused, not verified here:
   * callers still need verify() for a full structural audit.
   * Private drafts cost O(batch input + changed pages), not O(all old records).
   * They are not a verification cache. Only final-root reachable drafts reach
   * store.write, once each, after root collapse. Failed/cancelled calls can leave
   * an incomplete immutable closure; they never change or publish the old root.
   */
  async function updateMany(root, commands, opts = {}) {
    const {signal} = settings(opts, ['signal']); rootHash(root); abort(signal);
    if (!Array.isArray(commands) || Object.getOwnPropertySymbols(commands).length ||
        Object.keys(commands).length !== commands.length) fail('invalid-input', 'Updates need a dense array of commands.');
    const changes = [];
    let previous = null;
    for (let i = 0; i < commands.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(commands, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid-input', 'Update commands cannot be accessors.');
      const command = copy(descriptor.value);
      const remove = command?.type === 'delete';
      fields(command, remove ? ['type', 'key'] : ['type', 'key', 'value'], 'invalid-command');
      if (!remove && command.type !== 'set') fail('invalid-command', 'Expected a set or delete command.');
      key(command.key);
      if (previous !== null && previous >= command.key) fail('invalid-order', 'Update keys must be strictly ordered without duplicates.');
      previous = command.key;
      if (!remove && !fits('leaf', [[command.key, command.value]])) fail('node-byte-limit', 'A single entry cannot fit in a page.');
      changes.push(command);
    }
    // Hashes have fixed serialized length. Draft references use a placeholder
    // only for packing; identity in this private WeakMap distinguishes them from
    // stored references. A placeholder is never passed to the content store.
    const drafts = new WeakMap(), active = new Set();
    function draft(node) {
      const ref = refFor('0'.repeat(64), node);
      drafts.set(ref, node);
      return ref;
    }
    async function visit(hash, expected, start, end) {
      if (active.has(hash)) fail('cycle', 'A page refers to an ancestor.');
      active.add(hash);
      const node = await read(hash, expected, signal), original = expected ?? refFor(hash, node);
      let items = [], changed = false;
      if (node.kind === 'leaf') {
        let at = 0;
        for (let i = start; i < end; i++) {
          const command = changes[i];
          while (at < node.entries.length && node.entries[at][0] < command.key) items.push(node.entries[at++]);
          const existing = node.entries[at]?.[0] === command.key ? node.entries[at++] : null;
          if (command.type === 'delete') { if (existing) changed = true; }
          else if (existing && json(existing[1], maxNodeBytes) === json(command.value, maxNodeBytes)) items.push(existing);
          else { items.push([command.key, command.value]); changed = true; }
        }
        while (at < node.entries.length) items.push(node.entries[at++]);
      } else {
        let at = start;
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i], first = at;
          while (at < end && (i === node.children.length - 1 || changes[at].key <= child.max)) at++;
          if (first === at) items.push(child);
          else {
            const replacement = await visit(child.hash, child, first, at);
            if (replacement.length !== 1 || replacement[0] !== child) changed = true;
            for (const ref of replacement) items.push(ref);
          }
        }
      }
      active.delete(hash);
      return changed ? pack(node.kind, items, signal, draft) : [original];
    }
    let refs = await visit(root, null, 0, changes.length);
    if (refs.length === 1 && refs[0].hash === root && !drafts.has(refs[0])) return root;
    while (refs.length > 1) {
      const next = await pack('branch', refs, signal, draft);
      if (next.length >= refs.length) fail('node-byte-limit', 'A branch cannot fit two references.');
      refs = next;
    }
    let final = refs[0] ?? draft(nodeFor('leaf', []));
    while (BigInt(final.height) > 0n) {
      const node = drafts.get(final) ?? await read(final.hash, final, signal);
      if (node.children.length !== 1) break;
      final = node.children[0];
    }
    async function flush(ref) {
      if (!drafts.has(ref)) { abort(signal); return ref; }
      const stack = [{ref, node:drafts.get(ref), index:0}];
      let saved;
      while (stack.length) {
        abort(signal);
        const frame = stack.at(-1);
        if (frame.node.kind === 'branch' && frame.index < frame.node.children.length) {
          const child = frame.node.children[frame.index++], node = drafts.get(child);
          if (node) stack.push({ref:child, node, index:0});
        } else {
          saved = await write(frame.node, signal);
          drafts.delete(frame.ref); stack.pop();
          if (stack.length) {
            const parent = stack.at(-1);
            parent.node.children[parent.index - 1] = saved;
          }
        }
      }
      return saved;
    }
    return (await flush(final)).hash;
  }
  const set = (root, k, value, opts = {}) => updateMany(root, [{type:'set', key:k, value}], opts);
  const del = (root, k, opts = {}) => updateMany(root, [{type:'delete', key:k}], opts);
  function query(opts, allowed = ['gte', 'lt', 'signal']) {
    const {gte = null, lt = null, signal} = settings(opts, allowed);
    if (gte !== null) key(gte);
    if (lt !== null) key(lt);
    if (gte !== null && lt !== null && gte > lt) fail('invalid-query', 'Range start must not exceed its exclusive end.');
    return {gte, lt, signal};
  }
  async function* scan(root, {gte, lt, signal}, after = null) {
    rootHash(root); abort(signal);
    const stack = [], active = new Set();
    let next = {hash: root}, previous = null;
    while (next || stack.length) {
      abort(signal);
      if (next) {
        if (active.has(next.hash)) fail('cycle', 'A page refers to an ancestor.');
        const node = await read(next.hash, next.count ? next : null, signal);
        active.add(next.hash); stack.push({hash: next.hash, node, index: 0}); next = null;
      }
      const frame = stack.at(-1), items = frame.node.kind === 'leaf' ? frame.node.entries : frame.node.children;
      if (frame.index === items.length) { active.delete(frame.hash); stack.pop(); continue; }
      const item = items[frame.index++];
      if (frame.node.kind === 'branch') {
        if ((gte !== null && item.max < gte) || (after !== null && item.max <= after) || (lt !== null && item.min >= lt)) continue;
        next = item;
      } else {
        if (previous !== null && previous >= item[0]) fail('invalid-order', 'Traversal found duplicate or reordered keys.');
        previous = item[0];
        if ((gte === null || item[0] >= gte) && (lt === null || item[0] < lt) && (after === null || item[0] > after)) {
          yield item; // No cache and no subsequent use of this returned value.
        }
      }
    }
  }
  function entries(root, opts = {}) {
    // Capture the query at call time, not when the generator is first resumed.
    return scan(rootHash(root), query(opts));
  }
  async function page(root, opts = {}) {
    rootHash(root);
    const scope = query(opts, ['gte', 'lt', 'limit', 'cursor', 'signal']);
    const limit = opts.limit ?? 128;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail('invalid-page-limit', 'Page results are limited to 1..128 entries.');
    let after = null;
    if (opts.cursor !== undefined && opts.cursor !== null) {
      const cursor = copy(opts.cursor);
      fields(cursor, ['format', 'version', 'root', 'gte', 'lt', 'after'], 'invalid-cursor');
      if (cursor.format !== 'finance-tracker-page-cursor' || cursor.version !== 1 || cursor.root !== root || cursor.gte !== scope.gte || cursor.lt !== scope.lt) fail('cursor-mismatch', 'Cursor belongs to a different root or query.');
      after = key(cursor.after);
      if ((scope.gte !== null && after < scope.gte) || (scope.lt !== null && after >= scope.lt)) fail('invalid-cursor', 'Cursor key is outside the query.');
    }
    const result = [];
    let more = false;
    // One extra record establishes exact end-of-range without materializing it.
    for await (const pair of scan(root, scope, after)) {
      if (result.length === limit) { more = true; break; }
      result.push(pair);
    }
    return {entries: result, cursor: more ? {format: 'finance-tracker-page-cursor', version: 1, root,
      gte: scope.gte, lt: scope.lt, after: result.at(-1)[0]} : null};
  }
  async function inspect(root, opts = {}) {
    const {signal} = settings(opts, ['signal']);
    return metadata(await read(rootHash(root), null, signal));
  }
  async function* checkedWalk(root, signal) {
    rootHash(root); abort(signal);
    const stack = [], active = new Set();
    let next = {hash: root}, count = 0n, previous = null, rootInfo;
    while (next || stack.length) {
      abort(signal);
      if (next) {
        if (active.has(next.hash)) fail('cycle', 'A page refers to an ancestor.');
        const hash = next.hash;
        const {node, bytes} = await readPage(hash, next.count ? next : null, signal);
        rootInfo ??= metadata(node);
        active.add(hash); stack.push({hash, node, index: 0}); next = null;
        if (node.kind === 'leaf') for (const [k] of node.entries) {
          if (previous !== null && previous >= k) fail('invalid-order', 'Traversal found duplicate or reordered keys.');
          previous = k; count++;
        }
        yield {hash, node, bytes};
      }
      const frame = stack.at(-1);
      if (frame.node.kind === 'branch' && frame.index < frame.node.children.length) next = frame.node.children[frame.index++];
      else { active.delete(frame.hash); stack.pop(); }
    }
    if (String(count) !== rootInfo.count) fail('count-mismatch', 'Traversal count does not match the root.');
  }
  function checkedEntries(root, opts = {}) {
    const {signal,expectedCount} = settings(opts, ['signal','expectedCount']); rootHash(root);
    if (expectedCount !== undefined) decimal(expectedCount);
    return (async function* () {
      let first = true, mismatch = false;
      // Complete structural verification requires exhaustion, including when a
      // caller stops using values after finding a semantic mismatch. A wrong
      // expected count suppresses values but still checks every descendant.
      for await (const {node} of checkedWalk(root, signal)) {
        if (first) { mismatch = expectedCount !== undefined && node.count !== expectedCount; first = false; }
        if (!mismatch && node.kind === 'leaf') for (const entry of node.entries) { abort(signal); yield entry; }
      }
      abort(signal);
      if (mismatch) fail('expected-count-mismatch', 'The fully checked tree differs from the expected entry count.');
    })();
  }
  function walk(root, opts = {}) {
    const {signal} = settings(opts, ['signal']); rootHash(root);
    return (async function* () {
      // Only exhausting the iterator verifies every descendant. Early consumers
      // have evidence about visited pages, not a complete tree or source index.
      for await (const {hash, bytes} of checkedWalk(root, signal)) yield {hash, bytes: bytes.slice()};
    })();
  }
  async function verify(root, opts = {}) {
    const {signal} = settings(opts, ['signal']);
    let info, nodes = 0n;
    for await (const {node} of checkedWalk(rootHash(root), signal)) { info ??= metadata(node); nodes++; }
    return {...info, nodes: String(nodes)};
  }
  return Object.freeze({build, get, set, delete: del, updateMany, entries, checkedEntries, page, inspect, verify, walk,
    limits: Object.freeze({maxNodeBytes, maxEntries, maxChildren, maxKeyBytes})});
}
