// Read-only decoder for fragment bytes retained inside existing v5 migration evidence.
// No live-folder access or legacy writer is exposed.
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
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}
function decodeBase64(text) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function fragmentPath(path, ordinal) { return PREFIX + 'fragments/' + path.slice(PREFIX.length, -5) + '/' + String(ordinal).padStart(6, '0') + '.json'; }
function logicalPath(path) { return path === INDEX || /^synthetic\/canonical-v1\/chunks\/(accounts|imports|observations|activities|events|reviewDecisions|positionEvents)\/\d{6,}\.json$/.test(path); }
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
        decoded = decodeBase64(value.data);
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
