// Fixed codes and scalars only. Never serialize an Error, message, ID, hash,
// URL, token, record or provider response into a shareable failure diagnostic.
const CODES = new Set([
  'object-not-found', 'drive-request-failed', 'drive-network-error', 'authorization-required',
  'visibility-timeout', 'object-location-mismatch', 'immutable-metadata-mismatch',
  'immutable-readback-mismatch', 'content-hash-mismatch', 'metadata-mismatch',
  'hash-mismatch', 'version-mismatch', 'byte-limit', 'drive-response-too-large',
  'invalid-drive-response', 'invalid-json-object', 'invalid-json',
  'ownership-lost', 'ownership-unknown', 'not-owner', 'offline',
  'verification-scope-closed', 'mutation-in-flight', 'copy-mismatch',
  'adapter-scope-mismatch', 'guard-scope', 'invalid-guard', 'write-unresolved'
]);
const code = value => typeof value === 'string' && CODES.has(value) ? value : 'unknown';
const status = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const attempts = value => Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;

export function storageWriteDiagnostic(error) {
  let unresolved = false;
  try {
    if (error?.code !== 'write-unresolved') return null;
    unresolved = true;
    const detail = error.details || error.cause?.details || {};
    const create = detail.createError || detail.failure;
    const readback = detail.readbackError || detail.readFailure;
    const failed = detail.createFailed ?? detail.failed;
    return Object.freeze({
      code: 'write-unresolved',
      create: failed === false ? 'completed' : code(create?.code),
      createHttp: status(create?.details?.createRequest?.status ?? create?.details?.status),
      createVisibilityHttp: status(create?.details?.lastStatus),
      createVisibilityChecks: attempts(create?.details?.attempts),
      readback: readback?.name === 'AbortError' ? 'cancelled' : code(readback?.code),
      readbackHttp: status(readback?.details?.status)
    });
  } catch {
    return unresolved ? Object.freeze({code: 'write-unresolved', create: 'unknown', readback: 'unknown'}) : null;
  }
}
