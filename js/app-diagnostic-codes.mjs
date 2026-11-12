// Stable internal codes that are safe to include in a shareable diagnostic.
// Keep this list limited to enum-like values owned by application modules.
const CODES = new Set([
  // Drive transport and immutable writes.
  'authorization-required', 'byte-limit', 'content-hash-mismatch', 'drive-network-error',
  'drive-request-failed', 'drive-response-interrupted', 'drive-response-too-large',
  'drive-stream-unavailable', 'hash-mismatch', 'immutable-metadata-mismatch',
  'immutable-readback-mismatch', 'invalid-drive-response', 'invalid-json-object',
  'invalid-response-limits', 'metadata-mismatch', 'object-location-mismatch',
  'object-not-found', 'readback-mismatch', 'version-mismatch', 'visibility-timeout',
  'write-readback-mismatch', 'write-unresolved',
  // Canonical v5 root transaction and recovery.
  'adapter-contract', 'base-conflict', 'body-mismatch', 'candidate-mismatch',
  'disconnected-history', 'existing-object', 'history-mismatch', 'intent-mismatch',
  'manifest-metadata-mismatch', 'manifest-version-mismatch', 'pending-base',
  'pending-incomplete', 'pending-mismatch', 'physical-id-in-use', 'preparation-mismatch',
  'receipt-mismatch', 'recovery-required', 'transaction-unresolved',
  'unfinished-verification-read', 'verified-baseline-required',
  // Paged locator tree integrity and ownership.
  'adapter-scope-mismatch', 'child-mismatch', 'count-mismatch', 'cycle',
  'duplicate-child', 'duplicate-entry', 'duplicate-physical-locator', 'guard-scope',
  'index-mismatch', 'invalid-byte-proof', 'invalid-guard', 'invalid-immutable-query',
  'invalid-input', 'invalid-journal', 'invalid-key', 'invalid-order', 'invalid-page-limit',
  'noncanonical-json', 'replacement-forbidden',
  // Application verification and supported-copy boundaries.
  'ambiguous-manifest', 'canonical-profile-mismatch', 'copy-mismatch',
  'invalid-initialization', 'invalid-manifest-metadata', 'nonempty-folder',
  'read-only', 'read-only-inspection', 'unsupported-canonical-profile',
  'unsupported-commit', 'unsupported-manifest', 'verification-metadata-changed',
  'verification-plan-changed', 'verification-plan-unavailable',
  'verification-read-limit', 'verification-scope-closed', 'verification-scope-open',
  // Session coordination.
  'drive-create-failed', 'drive-read-failed', 'drive-update-failed', 'network-error',
  'ownership-lost', 'ownership-unknown', 'session-marker-not-visible',
  'session-operation-cancelled', 'stale-session', 'not-owner', 'session-active',
  // Common strict-validation codes surfaced by these paths.
  'invalid-adapter', 'invalid-bytes', 'invalid-content', 'invalid-count', 'invalid-guard',
  'invalid-hash', 'invalid-identity', 'invalid-json', 'invalid-kind',
  'invalid-lineage', 'invalid-options', 'invalid-plan', 'invalid-preparation',
  'invalid-role', 'invalid-sequence', 'invalid-shape', 'invalid-state',
  'invalid-verification-result', 'invalid-version', 'lineage-verifier-unavailable', 'metadata-limit',
  'noncanonical-json', 'source-evidence-verifier-required', 'unsupported-binding',
  'unsupported-commit', 'unsupported-intent', 'unsupported-source-evidence',
  'verification-plan-unavailable', 'byte-limit', 'copy-mismatch', 'offline',
  'release-unconfirmed', 'storage-not-ready', 'crypto-unavailable',
  'drive-response-interrupted', 'invalid-generated-id', 'incomplete-folder-enumeration',
  'pagination-loop', 'invalid-metadata-batch', 'incomplete-metadata-batch',
  'manifest-readback-mismatch', 'invalid-transaction', 'transaction-already-exists',
  'invalid-logical-path', 'incomplete-snapshot', 'invalid-next-manifest',
  'invalid-recovery-identity', 'journal-identity-mismatch', 'missing-commit-file-id',
  'commit-record-metadata-mismatch', 'commit-verification-failed',
  'invalid-snapshot-reference', 'snapshot-object-metadata-mismatch',
  'snapshot-object-verification-failed', 'manifest-commit-pointer-mismatch',
  'recovery-needs-intervention', 'staged-object-metadata-mismatch',
  'staged-object-verification-failed', 'recovery-manifest-builder-required',
  'recovery-manifest-mismatch', 'recovery-base-changed', 'recovery-publication-unverified',
  'invalid-adapter-config', 'invalid-visibility-retry-config', 'mutation-in-flight',
  'invalid-engine-config', 'session-claim-failed', 'drive-stream-unavailable',
  'invalid-json-object', 'drive-request-failed', 'drive-network-error', 'unsupported-layout'
]);

const ERROR_NAMES = new Set([
  'AbortError', 'ApplicationStorageError', 'DataError', 'DOMException', 'DriveResponseError', 'Error',
  'DriveTransactionError', 'InvalidStateError', 'NetworkError', 'NotAllowedError',
  'NotFoundError', 'OperationError', 'PagedLocatorError', 'PhysicalRootError',
  'QuotaExceededError', 'RangeError', 'SecurityError', 'SessionCoordinationError',
  'SyntaxError', 'TimeoutError', 'TypeError'
]);

function read(value, key) {
  try { return value?.[key]; } catch { return undefined; }
}

export function isSafeDiagnosticCode(value) {
  return typeof value === 'string' && CODES.has(value);
}

export function safeDiagnosticCode(value) {
  return isSafeDiagnosticCode(value) ? value : 'unknown';
}

export function safeDiagnosticErrorName(value) {
  const name = read(value, 'name');
  return typeof name === 'string' && ERROR_NAMES.has(name) ? name : null;
}
