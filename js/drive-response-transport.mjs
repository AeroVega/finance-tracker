// Per-response admission limits, not database capacity or supported-device claims.
// An explicit larger finite profile can reopen older files without bypassing hash,
// identity, ancestry or recovery checks. Never silently retry with an unlimited read.
export const DEFAULT_DRIVE_RESPONSE_LIMITS = Object.freeze({
  metadata: 256 * 1024,
  'generated-ids': 32 * 1024,
  'list-page': 4 * 1024 * 1024,
  'session-marker': 64 * 1024,
  manifest: 16 * 1024 * 1024,
  'journal-event': 1024 * 1024,
  'commit-record': 16 * 1024 * 1024,
  'locator-catalog': 32 * 1024 * 1024,
  'locator-catalog-segment': 64 * 1024,
  'data-object': 32 * 1024 * 1024,
  'snapshot-object': 32 * 1024 * 1024,
  'stored-object': 32 * 1024 * 1024
});

export class DriveResponseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DriveResponseError';
    this.code = code;
    this.details = details;
  }
}

export function createDriveResponseLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new DriveResponseError('invalid-response-limits', 'Drive response limits must be a per-kind byte budget.');
  }
  const result = { ...DEFAULT_DRIVE_RESPONSE_LIMITS };
  for (const [kind, maxBytes] of Object.entries(overrides)) {
    if (!Object.hasOwn(result, kind) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new DriveResponseError('invalid-response-limits', 'Each Drive response limit must name a supported kind and a positive finite byte count.');
    }
    result[kind] = maxBytes;
  }
  // These names identify the same stored bytes: the physical Drive tag is
  // snapshot-object, while logical catalog verification calls it data-object.
  // One effective limit must govern pre-upload admission and later recovery.
  const dataLimit = Object.hasOwn(overrides, 'data-object') ? overrides['data-object'] : null;
  const snapshotLimit = Object.hasOwn(overrides, 'snapshot-object') ? overrides['snapshot-object'] : null;
  const objectLimit = dataLimit === null ? snapshotLimit ?? result['data-object']
    : snapshotLimit === null ? dataLimit : Math.min(dataLimit, snapshotLimit);
  result['data-object'] = objectLimit;
  result['snapshot-object'] = objectLimit;
  return Object.freeze(result);
}

function responseKind(kind, limits) {
  if (kind === 'dashboard-synthetic-manifest') return 'manifest';
  return Object.hasOwn(limits, kind) ? kind : 'stored-object';
}

export function responseByteLimit(kind = 'stored-object', limits = DEFAULT_DRIVE_RESPONSE_LIMITS) {
  return limits[responseKind(kind, limits)];
}

export function assertResponseSize(size, { kind = 'stored-object', limits = DEFAULT_DRIVE_RESPONSE_LIMITS } = {}) {
  const maxBytes = responseByteLimit(kind, limits);
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    throw new DriveResponseError('drive-response-too-large',
      'A Drive object exceeds its per-response byte limit. Preserve the copy and reopen with a reviewed larger finite limit if needed for recovery.',
      { kind: responseKind(kind, limits), maxBytes });
  }
}

export async function discardDriveResponse(response) {
  // Error and unused mutation bodies have no authority. Do not parse, retain,
  // clone, or include them in diagnostics. Cancel before they can grow in memory.
  try { await response?.body?.cancel(); } catch { /* Keep the original outcome. */ }
}

export async function readBoundedDriveBytes(response, { kind = 'stored-object', limits = DEFAULT_DRIVE_RESPONSE_LIMITS, maxBytes: requestedMax } = {}) {
  const maxBytes = requestedMax === undefined ? responseByteLimit(kind, limits) : Math.min(responseByteLimit(kind, limits), requestedMax);
  limits = { ...limits, [responseKind(kind, limits)]: maxBytes };
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    await discardDriveResponse(response);
    throw new DriveResponseError('invalid-response-limits', 'A finite Drive response byte limit is required.');
  }
  const declared = response?.headers?.get?.('Content-Length');
  // Content-Length is only an early rejection hint. Count delivered bytes even
  // when it is missing, invalid, understated, or describes compressed content.
  if (typeof declared === 'string' && /^\d+$/.test(declared.trim()) && BigInt(declared.trim()) > BigInt(maxBytes)) {
    await discardDriveResponse(response);
    assertResponseSize(maxBytes + 1, { kind, limits });
  }
  if (!response?.body) {
    if (response?.status === 204 || response?.status === 205) return new Uint8Array();
    throw new DriveResponseError('drive-stream-unavailable', 'A bounded Drive response stream is required.');
  }
  if (typeof response.body.getReader !== 'function') {
    await discardDriveResponse(response);
    throw new DriveResponseError('drive-stream-unavailable', 'A bounded Drive response stream is required.');
  }
  let reader;
  try { reader = response.body.getReader(); }
  catch { throw new DriveResponseError('drive-stream-unavailable', 'A bounded Drive response stream is required.'); }
  const chunks = [];
  let total = 0;
  let tail = null;
  let used = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new DriveResponseError('invalid-drive-response', 'Drive returned an invalid byte stream.');
      if (value.byteLength > maxBytes - total) assertResponseSize(maxBytes + 1, { kind, limits });
      // Coalesce tiny network chunks. One retained allocation per incoming byte
      // would make the byte budget meaningless for bookkeeping memory. Blocks
      // also own the bytes if a custom stream producer reuses its buffers.
      let sourceOffset = 0;
      while (sourceOffset < value.byteLength) {
        if (!tail || used === tail.byteLength) {
          tail = new Uint8Array(Math.min(64 * 1024, Math.max(4096, (tail?.byteLength || 0) * 2, value.byteLength - sourceOffset), maxBytes - total));
          chunks.push(tail);
          used = 0;
        }
        const amount = Math.min(tail.byteLength - used, value.byteLength - sourceOffset);
        tail.set(value.subarray(sourceOffset, sourceOffset + amount), used);
        used += amount;
        sourceOffset += amount;
        total += amount;
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      const amount = Math.min(chunk.byteLength, total - offset);
      bytes.set(chunk.subarray(0, amount), offset);
      offset += amount;
    }
    return bytes;
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve the fixed diagnostic. */ }
    if (error instanceof DriveResponseError) throw error;
    throw new DriveResponseError('drive-response-interrupted', 'A Drive response ended before its bytes could be verified.');
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedDriveJson(response, options) {
  const bytes = await readBoundedDriveBytes(response, options);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // JSON.parse messages can quote private response content. Never forward them.
    throw new DriveResponseError('invalid-json-object', 'A Drive response is not valid UTF-8 JSON.');
  }
}
