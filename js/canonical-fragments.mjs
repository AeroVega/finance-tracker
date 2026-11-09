// Physical-only format. Logical canonical records and transaction semantics stay unchanged.
import { canonicalizeJcs } from './transaction-protocol.mjs';
export const FRAGMENT_BYTES = 64 * 1024;
export const FRAGMENT_OBJECT_BYTES = 128 * 1024;
export const FRAGMENT_LOGICAL_BYTES = 16 * 1024 * 1024;
export const FRAGMENT_TOTAL_BYTES = 128 * 1024 * 1024;
const PREFIX = 'synthetic/canonical-v1/', INDEX = PREFIX + 'index.json';
const FORMAT = 'finance-tracker-canonical-fragment';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function fail() { throw Object.assign(new Error('Invalid or oversized canonical fragment inventory or payload.'), { code: 'invalid-canonical-fragments' }); }
function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fragmentPath(path, ordinal) { return PREFIX + 'fragments/' + path.slice(PREFIX.length, -5) + '/' + String(ordinal).padStart(6, '0') + '.json'; }
function logicalPath(path) { return path === INDEX || /^synthetic\/canonical-v1\/chunks\/(accounts|imports|observations|activities|events|reviewDecisions)\/\d{6,}\.json$/.test(path); }
export function fragmentInventory(root) {
  if (!root || Object.keys(root).sort().join(',') !== 'format,fragments,syntheticOnly,version' ||
      root.format !== 'finance-tracker-canonical-index' || root.version !== 3 || root.syntheticOnly !== true ||
      !root.fragments || Array.isArray(root.fragments) || typeof root.fragments !== 'object' ||
      !Object.hasOwn(root.fragments, INDEX) || encoder.encode(canonicalizeJcs(root)).length > FRAGMENT_OBJECT_BYTES) fail();
  const paths = [];
  let totalBytes = 0, totalParts = 0;
  for (const [path, item] of Object.entries(root.fragments)) {
    if (!logicalPath(path) || !item || Object.keys(item).sort().join(',') !== 'bytes,parts' ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > FRAGMENT_LOGICAL_BYTES ||
        !Number.isSafeInteger(item.parts) || item.parts < Math.ceil(item.bytes / FRAGMENT_BYTES) ||
        item.parts > FRAGMENT_LOGICAL_BYTES / FRAGMENT_BYTES) fail();
    totalBytes += item.bytes; totalParts += item.parts;
    if (totalBytes > FRAGMENT_TOTAL_BYTES || totalParts * FRAGMENT_BYTES > FRAGMENT_TOTAL_BYTES * 2) fail();
    for (let ordinal = 0; ordinal < item.parts; ordinal++) paths.push(fragmentPath(path, ordinal));
  }
  return paths;
}
export function fragmentCanonicalObjects(logical, previousRoot = null) {
  if (previousRoot) fragmentInventory(previousRoot);
  const root = { format: 'finance-tracker-canonical-index', version: 3, syntheticOnly: true, fragments: {} };
  const objects = new Map();
  for (const [path, text] of logical) {
    const bytes = encoder.encode(text);
    if (!logicalPath(path) || !bytes.length || bytes.length > FRAGMENT_LOGICAL_BYTES) fail();
    const parts = Math.max(Math.ceil(bytes.length / FRAGMENT_BYTES), previousRoot?.fragments[path]?.parts || 0);
    root.fragments[path] = { bytes: bytes.length, parts };
  }
  // Check the complete admission budget before allocating encoded fragments.
  fragmentInventory(root);
  for (const [path, text] of logical) {
    const bytes = encoder.encode(text), { parts } = root.fragments[path];
    for (let ordinal = 0; ordinal < parts; ordinal++) {
      const content = canonicalizeJcs({ format: FORMAT, version: 1, path, ordinal,
        data: base64(bytes.subarray(ordinal * FRAGMENT_BYTES, (ordinal + 1) * FRAGMENT_BYTES)) });
      if (encoder.encode(content).length > FRAGMENT_OBJECT_BYTES) fail();
      objects.set(fragmentPath(path, ordinal), content);
    }
  }
  objects.set(INDEX, canonicalizeJcs(root));
  return objects;
}
export function reassembleCanonicalObjects(root, physical) {
  const expected = new Set([INDEX, ...fragmentInventory(root)]);
  const rootText = physical.get(INDEX);
  if (typeof rootText !== 'string' || encoder.encode(rootText).length > FRAGMENT_OBJECT_BYTES) fail();
  try { if (canonicalizeJcs(JSON.parse(rootText)) !== canonicalizeJcs(root)) fail(); } catch { fail(); }
  if ([...physical.keys()].some(path => !expected.has(path)) || physical.size !== expected.size) fail();
  const logical = new Map();
  for (const [path, { bytes: length, parts }] of Object.entries(root.fragments)) {
    const bytes = new Uint8Array(length);
    for (let ordinal = 0; ordinal < parts; ordinal++) {
      const text = physical.get(fragmentPath(path, ordinal));
      if (typeof text !== 'string' || encoder.encode(text).length > FRAGMENT_OBJECT_BYTES) fail();
      let value, decoded;
      try {
        value = JSON.parse(text);
        if (!value || Object.keys(value).sort().join(',') !== 'data,format,ordinal,path,version' ||
            value.format !== FORMAT || value.version !== 1 || value.path !== path || value.ordinal !== ordinal || typeof value.data !== 'string') fail();
        decoded = Uint8Array.from(atob(value.data), char => char.charCodeAt(0));
      } catch { fail(); }
      const needed = Math.max(0, Math.min(FRAGMENT_BYTES, length - ordinal * FRAGMENT_BYTES));
      if (decoded.length !== needed || base64(decoded) !== value.data) fail();
      if (needed) bytes.set(decoded, ordinal * FRAGMENT_BYTES);
    }
    let text;
    try { text = decoder.decode(bytes); if (canonicalizeJcs(JSON.parse(text)) !== text) fail(); } catch { fail(); }
    logical.set(path, text);
  }
  return logical;
}
