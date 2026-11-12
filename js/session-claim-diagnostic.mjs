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
  let code = null;
  try {
    const candidate = error?.code;
    if (candidate !== 'ownership-unknown' && candidate !== 'ownership-lost') return null;
    code = candidate;
    const check = error.sessionCheck;
    return Object.freeze({ code,
      check: typeof check === 'string' && CHECKS.has(check) ? check : 'unknown' });
  } catch {
    return code ? Object.freeze({ code, check: 'unknown' }) : null;
  }
}
