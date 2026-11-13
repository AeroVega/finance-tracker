import {getEntry} from './error-registry.mjs';

const ERROR_NAMES = new Set([
  'AggregateError', 'AppError', 'PageTreeError', 'PortableBackupError', 'TransactionProtocolError',
  'LocatorCatalogError', 'FramedBackupError', 'RetentionPolicyError', 'DriveFolderDiscoveryError', 'DriveFeasibilityError',
  'AbortError', 'ApplicationStorageError', 'DataError', 'DOMException', 'DriveResponseError', 'Error',
  'DriveTransactionError', 'InvalidStateError', 'NetworkError', 'NotAllowedError',
  'NotFoundError', 'OperationError', 'PagedLocatorError', 'PhysicalRootError',
  'QuotaExceededError', 'RangeError', 'SecurityError', 'SessionCoordinationError',
  'SyntaxError', 'TimeoutError', 'TypeError', 'ReferenceError', 'EvalError', 'URIError'
]);
const OPERATIONS = new Set([
  'immutable-create', 'root-manifest-admitted', 'root-manifest-ready',
  'root-manifest-published', 'root-manifest-clean'
]);

function read(value, key) {
  try { return value?.[key]; } catch { return undefined; }
}

export function isSafeDiagnosticCode(value) {
  return getEntry(value) !== null;
}

export function safeDiagnosticCode(value) {
  return isSafeDiagnosticCode(value) ? value : 'unknown';
}

export function safeDiagnosticErrorName(value) {
  const name = read(value, 'name');
  return typeof name === 'string' && ERROR_NAMES.has(name) ? name : null;
}

export function safeDiagnosticOperation(value) {
  return typeof value === 'string' && OPERATIONS.has(value) ? value : null;
}
