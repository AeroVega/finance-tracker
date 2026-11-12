import { diagnosticMessages, messagesForSurface } from './app-diagnostic-messages.mjs';
import { googleStartupMessage } from './google-startup-diagnostics.mjs';
import { storageWriteDiagnostic } from './storage-write-diagnostic.mjs';
import { sessionClaimDiagnostic } from './session-claim-diagnostic.mjs';
import { isSafeDiagnosticCode, safeDiagnosticErrorName, safeDiagnosticOperation } from './app-diagnostic-codes.mjs';

const extra = Object.freeze({
  'conflicting-match-requires-correction': 'The selected match has a different account, currency or amount, or is missing an amount. Choose a compatible activity or resolve the evidence with an explicit correction before matching.',
  'inactive-match-target': 'The selected activity is no longer active. Choose an active match target before submitting this review decision.',

  'recovery-required': 'Storage needs recovery before more changes can be saved. Keep this tab and folder unchanged. Use the recovery controls offered for this copy, then reopen and verify before retrying.',
  'adapter-contract': 'The storage adapter returned without confirming its required mutation guard. Keep this tab and folder unchanged and inspect the diagnostic before retrying.',
  'adapter-precondition-failed': 'The storage adapter failed before completing its mutation guard. The write outcome may still need recovery; keep this tab and folder unchanged and inspect the diagnostic before retrying.',
  'stale-session': 'A previous storage session appears stale. Stop every other tab or device using this copy, then use the explicit stale-session recovery control if offered. Do not delete its marker.',
  'session-active': 'Another storage session is active. Release it on the owning tab or device before opening this copy here.',

  "unexpected-error": "The application encountered an unexpected error. Stop this operation and keep the tab and any selected folder unchanged. Copy diagnostics before retrying; a save may not have finished verification.",
  'interruption-recipe-unrecognized': 'This is not the exact interruption recipe prepared by this version. No classification was staged or saved. Older or modified test folders are unsupported, not necessarily corrupt. Preserve this folder and use a new empty synthetic folder for a new interruption rehearsal.',

  "csv-unfinished-quote": "The CSV has an unfinished quoted field. Check the export or choose a complete file; no rows from this file were imported.",
  "csv-unsupported-header": "A supported header row was not found. Choose a CSV with Date, Description and Amount columns, or a documented Wells Fargo, SoFi or Fidelity export.",
  'unknown': 'Action did not complete. Keep this tab and any selected folder unchanged. Copy diagnostics for inspection before retrying an operation that may have saved data.',
  'offline': 'The device is offline. Loaded records remain visible. Return online, then reopen and verify the saved copy before editing.',
  'authorization-required': 'Google authorization is unavailable. Keep your draft in this tab. Reconnect to the same copy and verify its state before retrying a save.',
  'ownership-lost': 'This tab’s storage session could not be verified. Writes are disabled. Preserve the folder and marker; copy diagnostics before reconnecting.',
  'not-owner': 'This tab does not own the storage session. Resolve the active session before reopening this copy.',
  'base-conflict': 'The saved copy changed. Reopen verified records before deciding what to retry.',
  'drive-network-error': 'A storage request failed to reach Google. Keep the folder unchanged and inspect its saved state before retrying any write.',
  'drive-request-failed': 'Google did not complete a storage request. Keep the folder unchanged and copy diagnostics before retrying any write.',
  'storage-not-ready': 'Storage is not ready for this action. Keep your draft and follow the connection or recovery controls before continuing.'
});
const startup = new Set(['google-config-network', 'google-config-http', 'google-config-json', 'google-config-invalid', 'google-libraries-unavailable', 'google-picker-unavailable']);
const surfaces = new Set(['workspace', 'synthetic-year', 'import', 'local-preview', 'developer-tool', 'copy-guide']);
const phases = new Set(['starting', 'configuration', 'connecting', 'reconnecting', 'preparing', 'checking', 'saving', 'recovering', 'reopening', 'releasing', 'verifying']);
function read(error, key) { try { return error?.[key]; } catch { return undefined; } }
function recognized(value) {
  return typeof value === 'string' && (isSafeDiagnosticCode(value) || Object.hasOwn(diagnosticMessages, value) || Object.hasOwn(extra, value) || startup.has(value));
}
function errorChain(error, visit) {
  const seen = new Set(), queue = [{value:error, depth:0}];
  while (queue.length && seen.size < 12) {
    const {value:current, depth} = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const result = visit(current);
    if (result !== undefined) return result;
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
function errorCode(error) {
  return errorChain(error, current => {
    const code = read(current, 'code');
    if (recognized(code)) return code;
    // Some local validators deliberately throw a fixed code as their TypeError message.
    const message = read(current, 'name') === 'TypeError' ? read(current, 'message') : null;
    return recognized(message) ? message : undefined;
  }) || 'unknown';
}
function causeCode(error, selected) {
  return errorChain(error, current => {
    const code = read(current, 'code');
    return recognized(code) && code !== selected ? code : undefined;
  });
}

/** Construct from allowlisted fields, never redact or serialize arbitrary errors. */
export function createDiagnostic(error, { surface, build, phase, verifiedDurableWrites } = {}) {
  const code = errorCode(error);
  const message = startup.has(code)
    // No raw status/components cross this boundary. The startup formatter accepts
    // those for its original callers, but a report uses only fixed safe copy.
    ? googleStartupMessage({code})
    : messagesForSurface(surface)[code] || extra[code] || diagnosticMessages[code] || extra.unknown;
  const report = {
    schema: 'finance-tracker-diagnostic-v1',
    code,
    surface: surfaces.has(surface) ? surface : 'unknown',
    build: typeof build === 'string' && /^[a-f0-9]{40}$/.test(build) ? build : 'development-or-unknown'
  };
  if (phases.has(phase)) report.phase = phase;
  if (Number.isSafeInteger(verifiedDurableWrites) && verifiedDurableWrites >= 0 && verifiedDurableWrites <= 100000)
    report.verifiedDurableWrites = verifiedDurableWrites;
  const existingDetail = storageWriteDiagnostic(error) || sessionClaimDiagnostic(error);
  const nestedCode = causeCode(error, code);
  const exception = code === 'unknown' ? errorChain(error, current => safeDiagnosticErrorName(current)) : null;
  const operation = errorChain(error, current => safeDiagnosticOperation(read(read(current, 'details'), 'operation')));
  const detail = existingDetail || nestedCode || exception || operation
    ? {...(nestedCode ? {causeCode: nestedCode} : {}), ...(exception ? {exception} : {}), ...(operation ? {operation} : {}), ...(existingDetail || {})}
    : null;
  if (detail) report.detail = detail;
  return Object.freeze({code, message, report: JSON.stringify(report, null, 2)});
}
export function diagnosticMessage(error) {
  const diagnostic = createDiagnostic(error);
  return `${diagnostic.message} Error code: ${diagnostic.code}.`;
}

// One bounded, in-memory panel per visible status. Nothing is sent or persisted.
const panels = new WeakMap();
export function clearDiagnostic(target) {
  const panel = target && panels.get(target);
  if (panel) { panel.generation++; panel.root.hidden = true; panel.root.remove(); panels.delete(target); }
}
export function showDiagnostic(error, {surface = 'developer-tool', target, phase, verifiedDurableWrites, document: doc = globalThis.document, navigator: nav = globalThis.navigator} = {}) {
  const diagnostic = createDiagnostic(error, {surface, phase, verifiedDurableWrites, build: doc?.getElementById('build-sha')?.textContent});
  const message = `${diagnostic.message} Error code: ${diagnostic.code}.`;
  if (!target || !doc) return message;
  clearDiagnostic(target);
  const make = (tag, text) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
  const root = make('section'); root.className = 'app-diagnostics'; root.setAttribute('aria-label', 'Safe error diagnostics');
  const description = make('p', 'Diagnostics contain only fixed error codes, check names and the application build. Nothing is sent automatically.');
  const label = make('label', 'Selectable diagnostics');
  const report = make('textarea'); report.readOnly = true; report.rows = 9; report.value = diagnostic.report;
  report.setAttribute('aria-label', 'Selectable diagnostics'); report.style && (report.style.width = '100%');
  label.append(report);
  const copy = make('button', 'Copy diagnostics'); copy.type = 'button';
  const select = make('button', 'Select diagnostics'); select.type = 'button';
  const status = make('p'); status.setAttribute('role', 'status');
  const panel = {root, generation: 0}; panels.set(target, panel);
  const selectReport = () => { report.focus(); report.select(); report.setSelectionRange?.(0, report.value.length); };
  select.addEventListener('click', () => { selectReport(); status.textContent = 'Diagnostics selected. Use your device Copy command.'; });
  copy.addEventListener('click', async () => {
    const generation = panel.generation;
    copy.disabled = true;
    try {
      if (!nav?.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await nav.clipboard.writeText(diagnostic.report);
      if (generation === panel.generation) status.textContent = 'Diagnostics copied.';
    } catch {
      if (generation === panel.generation) { selectReport(); status.textContent = 'Automatic copy is unavailable. Diagnostics are selected; use your device Copy command.'; }
    } finally { if (generation === panel.generation) copy.disabled = false; }
  });
  root.append(description, label, copy, select, status);
  if (target.insertAdjacentElement) target.insertAdjacentElement('afterend', root);
  else doc.body.append(root);
  return message;
}

/** Catch otherwise-unhandled runtime failures after this module has loaded.
 * Do not suppress browser events, retry work or change storage permissions.
 */
export function installUnexpectedDiagnostics({window: win = globalThis.window, document: doc = globalThis.document} = {}) {
  if (!win?.addEventListener || !doc || installed.has(win)) return;
  installed.add(win);
  let target;
  const report = () => {
    if (!doc.body) return;
    if (!target) { target = doc.createElement('p'); target.setAttribute('role', 'alert'); doc.body.append(target); }
    target.textContent = showDiagnostic({code: 'unexpected-error'}, {surface: 'unknown', target, document: doc});
  };
  win.addEventListener('error', report);
  win.addEventListener('unhandledrejection', report);
}
const installed = new WeakSet();
installUnexpectedDiagnostics();
