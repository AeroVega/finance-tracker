// Share only fixed check names. Never copy provider bodies, messages, URLs,
// identifiers, timestamps, versions or submitted/read-back marker content.
const CHECKS = new Set([
  'marker-id-changed', 'prewrite-record-changed', 'readback-record-changed',
  'closing-trashed-unconfirmed', 'closing-parents-missing',
  'closing-properties-missing', 'closing-version-invalid',
  'closing-id-changed', 'closing-name-changed', 'closing-mime-changed',
  'closing-parents-changed', 'closing-session-property-changed',
  'closing-version-changed', 'coordinator-read-failed', 'coordinator-record-changed'
]);

export function sessionClaimDiagnostic(error) {
  let applicable = false;
  try {
    if (error?.code !== 'ownership-unknown') return null;
    applicable = true;
    const check = error.sessionCheck;
    return Object.freeze({ code: 'ownership-unknown',
      check: typeof check === 'string' && CHECKS.has(check) ? check : 'unknown' });
  } catch {
    return applicable ? Object.freeze({ code: 'ownership-unknown', check: 'unknown' }) : null;
  }
}
