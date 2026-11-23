// A duration, not calendar-month arithmetic. Bound all timestamps to the
// canonical four-digit UTC ISO form before using them as expiry evidence.
export const SOURCE_ORIGINAL_RETENTION_MS = 540 * 24 * 60 * 60 * 1000;
const canonicalUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function timestamp(value) {
  if (typeof value !== 'string' || !canonicalUtc.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

export function sourceOriginalExpiry(retainedAt) {
  const retained = timestamp(retainedAt);
  if (retained === null) return null;
  const expiry = new Date(retained + SOURCE_ORIGINAL_RETENTION_MS).toISOString();
  return canonicalUtc.test(expiry) ? expiry : null;
}

// This is a time/status gate, not provider evidence. A retained status does
// not authenticate an object or prove collection/deletion. Check it again at
// restore with the original timestamp, not the archive or restore timestamp.
export function sourceOriginalDisposition({retainedAt, expiresAt, status, now} = {}) {
  const current = timestamp(now);
  const retained = timestamp(retainedAt);
  const expiry = sourceOriginalExpiry(retainedAt);
  if (current === null || retained === null || expiry === null || expiresAt !== expiry ||
      !['retained', 'deletion-pending', 'deleted'].includes(status)) return 'invalid-evidence';
  if (current < retained) return 'invalid-evidence';
  if (status === 'deleted') return 'deleted';
  if (current >= timestamp(expiry)) return 'expired';
  return status === 'retained' ? 'unexpired' : 'deletion-pending';
}

// The existing synthetic route does not persist originals. Never interpret
// incomplete retention evidence as equivalent to an honest not-retained run.
export function isUnretainedSyntheticSource(run) {
  return run.sourceFileRetentionStatus === 'not-retained' &&
    run.privateSourceFileRef === null && run.sourceFileRetainedAt === null &&
    run.sourceFileRetentionExpiresAt === null && run.sourceFileDeletedAt === null;
}
