// Fixed codes and scalars only. Never serialize an Error, message, ID, hash,
// URL, token, record or provider response into a shareable failure diagnostic.
import { safeDiagnosticCode } from './app-diagnostic-codes.mjs';
const status = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const attempts = value => Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : null;

function read(value, key) { try { return value?.[key]; } catch { return undefined; } }
function findCode(error, target) {
  const seen = new Set(), queue = [{value:error, depth:0}];
  while (queue.length && seen.size < 12) {
    const {value:current, depth} = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (safeDiagnosticCode(read(current, 'code')) === target) return current;
    if (depth < 4) {
      const cause = read(current, 'cause');
      if (cause) queue.push({value:cause, depth:depth + 1});
      const details = read(current, 'details');
      for (const key of ['failure', 'guardFailure', 'createError', 'readbackError', 'readFailure']) {
        const nested = read(details, key);
        if (nested) queue.push({value:nested, depth:depth + 1});
      }
    }
  }
}

export function storageWriteDiagnostic(error) {
  let unresolved = false;
  try {
    const failure = findCode(error, 'write-unresolved');
    if (failure) {
      unresolved = true;
      const detail = read(failure, 'details') || {};
      const create = read(detail, 'createError') || read(detail, 'failure');
      const readback = read(detail, 'readbackError') || read(detail, 'readFailure');
      const failed = read(detail, 'createFailed') ?? read(detail, 'failed');
      return Object.freeze({
        code: 'write-unresolved',
        create: failed === false ? 'completed' : safeDiagnosticCode(read(create, 'code')),
        createHttp: status(read(read(create, 'details')?.createRequest, 'status') ?? read(read(create, 'details'), 'status')),
        createVisibilityHttp: status(read(read(create, 'details'), 'lastStatus')),
        createVisibilityChecks: attempts(read(read(create, 'details'), 'attempts')),
        readback: read(readback, 'name') === 'AbortError' ? 'cancelled' : safeDiagnosticCode(read(readback, 'code')),
        readbackHttp: status(read(read(readback, 'details'), 'status'))
      });
    }

    const candidates = ['drive-request-failed', 'visibility-timeout', 'manifest-readback-mismatch', 'manifest-version-mismatch', 'verification-metadata-changed', 'drive-create-failed', 'drive-update-failed'];
    for (const candidate of candidates) {
      const current = findCode(error, candidate);
      if (!current) continue;
      const detail = read(current, 'details') || {};
      const result = {code:candidate};
      if(candidate==='manifest-version-mismatch') {
        const reason=read(detail,'reason');
        if(['metadata-changed','content-size-mismatch','metadata-and-size-mismatch'].includes(reason))result.reason=reason;
      }
      if(candidate==='verification-metadata-changed') {
        const reason=read(detail,'reason');
        if(['object-missing','metadata-changed'].includes(reason))result.reason=reason;
        const fields=read(detail,'fields');
        const allowedFields=['id','name','mimeType','parents','appProperties','size','version','trashed'];
        if(Array.isArray(fields)) {
          const safeFields=[...new Set(fields.filter(field=>allowedFields.includes(field)))];
          if(safeFields.length)result.fields=safeFields;
        }
      }
      const httpStatus = status(read(detail, 'status') ?? read(detail, 'httpStatus'));
      const lastHttpStatus = status(read(detail, 'lastStatus'));
      const checkCount = attempts(read(detail, 'attempts'));
      if (httpStatus !== null) result.httpStatus = httpStatus;
      if (lastHttpStatus !== null) result.lastHttpStatus = lastHttpStatus;
      if (checkCount !== null) result.checks = checkCount;
      return Object.freeze(result);
    }
    return null;
  } catch {
    return unresolved ? Object.freeze({code: 'write-unresolved', create: 'unknown', readback: 'unknown'}) : null;
  }
}
