import { FULL_SNAPSHOT_BACKUP_LIMITS } from './full-snapshot-backup.mjs';
import { fail } from './app-error.mjs';
import {successfulActionSummary} from './success-metrics.mjs';
import { createWorkspacePages } from './workspace-pages.mjs';
import { createSyntheticFinancialPosition } from './synthetic-financial-position.mjs';
import { DashboardSyntheticStorage } from './dashboard-synthetic-storage.mjs';
import { CanonicalWorkspaceSession } from './canonical-workspace-session.mjs';
import { createWorkspaceViewReader, getWorkspaceActivity } from './canonical-workspace-model.mjs';
import { getEffectiveActivities } from './canonical-import.mjs';
import { exactSignedDecimal, isCalendarDate } from './import-reconciliation.mjs';
import { createSyntheticFinancialYear } from './synthetic-financial-year.mjs';
import { showDiagnostic, clearDiagnostic } from './app-diagnostics.mjs';
import { leaveBreadcrumb, registerContextProvider, recentReports } from './error-reporting.mjs';
import { installDiagnosticSelfTest } from './diagnostic-selftest.mjs';
import { mountProviderImportWorkflow } from './provider-csv-import-workflow.mjs';
import { mountHistoricalMonthlySummaryWorkflow } from './historical-monthly-summary-workflow.mjs';

const $ = id => document.getElementById(id);
let providerImportWorkflow = null, historicalSummaryWorkflow = null;
let sourceReviewPage = 0, sourceReviewScope = null;
const sourceReviewUpdates = [];
const pages = createWorkspacePages({document, window, onNavigate: page => { leaveBreadcrumb({e:'page.view', page}); if (page !== 'storage') providerImportWorkflow?.reset(); historicalSummaryWorkflow?.refresh(); }});
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const label = text => String(text || 'Unknown').replaceAll('-', ' ');
const reviewReason = reason => ({ 'classification-amount-conflict': 'Amount and classification disagree', 'unknown-amount': 'Amount unavailable', 'unmatched-refund': 'Refund needs a category or original purchase', 'unknown-lifecycle': 'Posting status unknown', 'unclassified-activity': 'Not classified', 'missing-refund-posted-date': 'Refund posting date unknown' }[reason] || label(reason));
// Never round ledger values through binary floating point for display.
function money(value, currency) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return 'Unavailable';
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return `${negative ? '-' : ''}${currency === 'USD' ? '$' : currency + ' '}${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}
const monthLabel = month => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
let freshYearLedger = null;
let busy = false, configured = false, page = 0, selectedActivity = null, view = null, operationStarted = null;
let viewLedger = null, viewReader = null, homeView = null, searchTimer = null, composingSearch = false;
const reviewButtons = new Map();
const homeButtons = new Map();
const detailEditorFields = ['classification', 'category', 'amount', 'posting-status', 'posting-date', 'correction-rationale', 'transfer-counterparty', 'transfer-link-rationale'];
let detailEditorBaseline = null;
const detailEditorValues = () => detailEditorFields.map(id => $(id).value);
const hasUnfinishedDetail = () => selectedActivity !== null && detailEditorBaseline !== null &&
  detailEditorValues().some((value, index) => value !== detailEditorBaseline[index]);
const confirmDiscardDetail = () => !hasUnfinishedDetail() || window.confirm('Discard the unfinished transaction edit? Staged changes and original source records will stay unchanged.');
const postingLabel = row => row.lifecycleStatus === 'posted' ? '' : row.lifecycleStatus === 'pending' ? 'Pending · excluded' : 'Unknown status · excluded';
const positionButtons = [];
let renderedPositionDate = null, positionRender = null, activeFormStatus = null;
const positionInputs = ['balance-account', 'balance-date', 'balance-amount', 'balance-basis', 'balance-source', 'reconcile-account', 'reconcile-opening', 'reconcile-closing', 'reconcile-source', 'closure-anchor', 'closure-source', 'holdings-account', 'holdings-date', 'holdings-scope', 'holdings-source', 'statement-full-month', 'new-account-name', 'new-account-institution', 'new-account-type', 'new-account-currency'];
const holdingRows = [], componentRows = [];
const editorAccounts = new Map();
let editorSequence = 0;
let reviewQueueButton = null;
function cancelSearch() { clearTimeout(searchTimer); searchTimer = null; }
function scheduleSearch() {
  cancelSearch();
  if (busy || composingSearch || !session.ledger) return;
  // Coalesce typing only; account/month changes and completed corrections stay immediate.
  searchTimer = setTimeout(() => { searchTimer = null; if (!busy) { page = 0; render(); } }, 120);
}
const storage = new DashboardSyntheticStorage({
  onStatus(status) {
    if (!status.code) clearDiagnostic($('connection-status'));
    // Candidate authorization/Picker work does not change the active session.
    // Only an actual lifecycle interruption invalidates its writable draft.
    if (status.state !== 'ready' && !(status.state === 'connecting' && session.ready())) {
      session.invalidate();
      providerImportWorkflow?.reset();
      // A local preview with no selected lifecycle survives candidate sign-in
      // or picker cancellation. Only an established interruption clears its review.
      if (session.mode !== 'preview' || storage.lifecycle || session.needsReopen || session.unverified) {
        historicalSummaryWorkflow?.reset();
      }
    }
    $('connection-status').textContent = status.state === 'ready'
      ? 'Connected to a synthetic copy. Opening and saves verify its canonical records.'
      : status.code ? showDiagnostic({code: status.code}, {surface: 'workspace', target: $('connection-status'), reportId: status.reportId, page: pages.current}) : `Storage: ${label(status.state)}. ${status.state === 'disconnected' ? 'No active session.' : 'Follow the available connection or recovery action.'}`;
    refresh();
  }
});
const session = new CanonicalWorkspaceSession({ storage });
registerContextProvider('workspace', () => ({
  lifecycle: storage.lifecycle?.state,
  ownership: storage.lifecycle?.coordinator?.canWrite === true ? 'owner' : 'unknown',
  busy, dirty: session.dirty, needsReopen: session.needsReopen,
  profile: undefined,
  ledger: session.ledger ? {
    syntheticOnly: session.ledger.syntheticOnly === true,
    accounts: session.ledger.accounts.length, activities: session.ledger.activities.length,
    events: session.ledger.events.length, stagedChanges: session.stagedHistory.length
  } : undefined
}));
registerContextProvider('requests', () => storage.lifecycle?.requestMetrics?.snapshot());
let actionRequestWindow = null;
$('clear-success-metrics')?.addEventListener('click',()=>{$('success-metrics').textContent='No successful action recorded in this tab.';});
registerContextProvider('actionRequests', () => actionRequestWindow?.snapshot());
let diagnosticHistoryKey = '';
function refreshDiagnosticHistory() {
  const history = recentReports();
  const key = history.map(item => item.id).join(',');
  if (key === diagnosticHistoryKey) return;
  diagnosticHistoryKey = key;
  const list = $('recent-problems');
  list.replaceChildren();
  const serious = history.filter(item => ['integrity', 'defect'].includes(item.kind)).length;
  $('recent-problems-count').textContent = serious ? ` (${serious})` : '';
  for (const item of history) {
    const button = node('button', `${item.code} · ${item.id}`, 'text-button'); button.type = 'button';
    button.addEventListener('click', () => {
      $('diagnostic-test-status').textContent = showDiagnostic(null, {reportId:item.id, surface:'workspace', target:$('diagnostic-test-status')});
    });
    const row = node('li'); row.append(button); list.append(row);
  }
}
installDiagnosticSelfTest({button:$('diagnostic-self-test'), target:$('diagnostic-test-status'), onReport:refreshDiagnosticHistory, document, navigator});


function announce(text, kind = 'info') {
  $('action-status').textContent = text; $('action-status').dataset.kind = kind;
  if (activeFormStatus) {
    const status = $(activeFormStatus); status.textContent = text; status.dataset.kind = kind;
    if (kind === 'error') status.focus();
  }
}
function refresh() {
  providerImportWorkflow?.refresh();
  historicalSummaryWorkflow?.refresh();
  refreshDiagnosticHistory();
  const lifecycle = storage.lifecycle;
  const needsRecovery = ['recovery-required', 'stale-session'].includes(lifecycle?.state);
  if (needsRecovery) $('recovery-tools').open = true;
  pages.setLoaded(Boolean(session.ledger));
  const ready = session.ready(), editable = !busy && session.canEdit();
  for (const update of sourceReviewUpdates) update();
  $('start-preview').disabled = busy || Boolean(lifecycle);
  $('welcome-panel').hidden = Boolean(session.ledger);
  $('overview-loaded').hidden = !session.ledger;
  $('create-ledger').disabled = busy || !configured || navigator.onLine === false || Boolean(lifecycle) || session.backupPreview || session.unverified || (session.mode !== 'preview' && !freshYearLedger);
  $('create-ledger').textContent = session.mode === 'preview' ? 'Save preview to a new folder' : 'Create new synthetic year';
  $('open-ledger').disabled = busy || !configured || navigator.onLine === false || Boolean(session.restoreExpected && session.restoreFolderId);
  $('open-ledger').textContent = lifecycle ? 'Reconnect saved copy' : 'Open saved synthetic year';
  $('preview-position').disabled = busy || Boolean(lifecycle);
  $('position-date').disabled = busy || !session.ledger;
  for (const id of positionInputs) $(id).disabled = !editable;
  for (const button of positionButtons) button.disabled = !editable;
  for (const row of [...holdingRows, ...componentRows]) for (const control of [...Object.values(row.fields), row.remove]) control.disabled = !editable;
  $('add-holding').disabled = !editable;
  $('add-component').disabled = !editable;
  $('stage-account').disabled = !editable || !$('new-account-name').value.trim() || !/^[A-Z]{3}$/.test($('new-account-currency').value.trim());
  $('stage-holdings').disabled = !editable || !$('holdings-account').value || !$('holdings-date').value || !$('holdings-source').value.trim();
  $('stage-closure').disabled = !editable || !$('closure-anchor').value || !$('closure-source').value.trim();
  $('stage-balance').disabled = !editable || !$('balance-account').value || !$('balance-date').value || !$('balance-amount').value.trim() || !$('balance-source').value.trim();
  $('stage-reconciliation').disabled = !editable || !$('month-filter').value || !$('reconcile-opening').value || !$('reconcile-closing').value || !$('reconcile-source').value.trim();
  $('preview-year').disabled = busy || Boolean(lifecycle);
  $('save-preview').disabled = busy || !configured || navigator.onLine === false || session.mode !== 'preview' || !session.ledger || Boolean(lifecycle) || session.backupPreview || session.unverified;
  $('save-preview').textContent = session.mode === 'preview' ? 'Save this preview to a new folder' : 'Save this preview to a new folder';
  $('save-ledger').disabled = busy || !session.canSave();
  $('undo-last-change').disabled = busy || !session.canUndo();
  $('revert-all-changes').disabled = busy || !session.canRevertAll();
  $('link-transfer').disabled = busy || !editable || !selectedActivity || !$('transfer-counterparty').value || !$('transfer-link-rationale').value.trim();
  $('reopen-ledger').disabled = busy || !ready;
  $('release-ledger').disabled = busy || navigator.onLine === false || Boolean(releaseUnavailableReason());
  const exportReady = ready && session.mode === 'saved' && Boolean(session.ledger) && !session.unverified && !session.needsReopen && !session.pendingSave;
  $('backup-draft-warning').hidden = !session.dirty;
  $('export-backup').disabled = busy || !exportReady || session.dirty;
  $('backup-save-first').disabled = busy || !session.dirty || !session.canSave();
  $('backup-saved-only').disabled = busy || !exportReady || !session.dirty;
  $('backup-encrypt').disabled = busy;
  $('backup-password').disabled = busy || !$('backup-encrypt').checked;
  $('backup-password-confirm').disabled = $('backup-password').disabled;
  $('backup-file').disabled = busy || Boolean(lifecycle);
  $('restore-password').disabled = busy || Boolean(lifecycle);
  $('stage-backup').disabled = busy || Boolean(lifecycle) || !$('backup-file').files?.length;
  $('restore-backup').disabled = busy || Boolean(lifecycle) || !session.backupPreview || session.dirty || session.mode !== 'preview' || session.unverified || !configured || navigator.onLine === false;
  $('verify-save-outcome').disabled = busy || navigator.onLine === false || !lifecycle || (!session.unverified && !['not-saved','different','unverifiable'].includes(session.recoveryOutcome)) || session.recoveryOutcome === 'checking';
  $('retry-save').disabled = busy || navigator.onLine === false || !lifecycle || session.recoveryOutcome !== 'not-saved';
  $('recover-ledger').disabled = busy || navigator.onLine === false || lifecycle?.state !== 'recovery-required' || !lifecycle?.coordinator?.canWrite;
  $('recover-stale').disabled = busy || navigator.onLine === false || lifecycle?.state !== 'stale-session';
  $('draft-storage-link').disabled = busy || session.mode !== 'preview' || session.unverified || Boolean(lifecycle);
  $('close-detail').disabled = busy;
  for (const button of reviewButtons.values()) button.disabled = busy;
  for (const button of homeButtons.values()) button.disabled = busy;
  if (reviewQueueButton) reviewQueueButton.disabled = busy;
  $('transactions').setAttribute('aria-busy', String(busy));
  for (const id of ['account-filter', 'month-filter', 'transaction-search', 'review-only']) $(id).disabled = busy || !session.ledger;
  for (const id of ['correction-type', 'classification', 'category', 'amount', 'posting-status', 'correction-rationale', 'transfer-counterparty', 'transfer-link-rationale']) $(id).disabled = !editable;
  const postingCorrection = $('correction-type').value === 'posting-status-correction';
  $('posting-date').disabled = !editable || !postingCorrection || $('posting-status').value !== 'posted';
  $('stage-correction').disabled = !editable || !selectedActivity || !$('correction-rationale').value.trim() ||
    (postingCorrection && $('posting-status').value === 'posted' && !isCalendarDate($('posting-date').value));
  $('previous-page').disabled = busy || !view || view.page === 0;
  $('next-page').disabled = busy || !view || view.page + 1 >= view.pages;
  const timing = $('operation-timing');
  if (timing) timing.textContent = operationStarted ? `${Math.floor((Date.now() - operationStarted) / 1000)}s elapsed` : '';
  let text;
  if (busy) text = 'Working and verifying. Keep this tab open.';
  else if (session.unverified || ['not-saved','different','unverifiable','checking'].includes(session.recoveryOutcome)) text = recoveryMessage();
  else if (session.backupPreview) text = session.dirty ? 'Validated backup preview has staged edits. Undo or revert them before restoring the exact backup.' : 'Validated backup preview only. Choose Restore backup to new empty folder; existing folders will not change.';
  else if (session.mode === 'preview') text = session.dirty ? 'Staged local preview changes. Save this preview to a new empty synthetic folder when ready.' : 'Local preview only. Save this preview to a new empty synthetic folder when ready.';
  else if (session.dirty) text = `${session.stagedHistory.length} staged change(s). ${session.canSave() ? 'Save when you are ready.' : 'Saving is blocked. Reconnect and reopen before continuing.'}`;
  else if (session.needsReopen) text = 'Read-only last loaded records. Reconnect or reopen before editing.';
  else text = session.ledger ? 'All changes saved and verified.' : 'No ledger loaded. Open your saved year or try a local preview.';
  if ($('save-state').textContent !== text) $('save-state').textContent = text;
  $('save-state').dataset.state = session.unverified ? 'unverified' : session.dirty ? 'dirty' : busy ? 'busy' : 'clean';
  $('draft-bar').hidden = false;
  $('draft-bar').dataset.state = session.unverified ? 'unverified' : busy ? 'busy' : 'dirty';
  $('draft-summary').textContent = busy ? 'Working. Keep this tab open.' : session.unverified ? 'Save unverified. Check Storage.' : needsRecovery ? 'Recovery needed. Open Storage.' : session.dirty ? `${session.stagedHistory.length} staged change${session.stagedHistory.length === 1 ? '' : 's'} · not saved` : session.ledger ? 'No staged changes' : 'No ledger loaded';
  $('data-mode').dataset.mode = session.mode;
  $('data-mode').textContent = session.mode === 'preview' ? 'Synthetic local preview' : session.ledger ? (session.needsReopen ? 'Synthetic · read-only' : 'Synthetic saved copy') : 'Synthetic workspace';
  explainActionAvailability();
  $('storage-format').textContent = session.mode === 'preview'
    ? 'Local preview, no saved format yet. Saving to a new folder will use full-snapshot v1. Old-format folders are unsupported.'
    : session.ledger && session.store?.base
      ? `Last verified saved format: ${session.store.valueCodec}.${session.needsReopen ? ' Reopen to verify the current copy.' : ''}`
      : 'No saved format currently verified. New synthetic copies use full-snapshot v1; old formats are unsupported.';
}
// Explain disabled actions where they remain discoverable, including touch and
// keyboard users. Eligibility remains enforced by the controls and handlers.
function releaseUnavailableReason() {
  const lifecycle = storage.lifecycle;
  if (!lifecycle) return 'Connect to a storage session before releasing it.';
  if (session.restoreExpected && session.restoreFolderId) return 'Finish restore verification before closing this session.';
  const attempt = session.pendingSave, evidence = attempt?.lifecycle?.engine?.saveAttempt;
  if (evidence?.authorityDispatched && evidence.sequence !== attempt?.priorSequence)
    return 'Verify the save outcome before closing this session; the draft may already be saved.';
  if (lifecycle.coordinator?.canWrite !== true || lifecycle.engine?.recoveryRequired)
    return 'Recover and verify session ownership before closing this session.';
  return '';
}
function explainActionAvailability() {
  const offline = navigator.onLine === false;
  const reasons = {
    'save-ledger': session.mode === 'preview' ? 'Save a local preview to a new folder instead.' : 'Open a verified saved copy and stage a change before saving.',
    'draft-storage-link': 'Load a local preview without an active storage session to choose its destination.',
    'save-preview': session.backupPreview ? 'Use Restore backup below for a validated backup preview.' : 'Load a local preview, connect Google services, and release any active session first.',
    'undo-last-change': 'Stage an editable change before undoing it.',
    'revert-all-changes': 'Stage editable changes before reverting them.',
    'reopen-ledger': 'Connect to a ready saved copy before reopening it.',
    'release-ledger': releaseUnavailableReason(),
    'export-backup': session.dirty ? 'Choose Save changes, then download, or Back up saved copy only for this draft.' : 'Open and verify a saved copy before downloading its backup.',
    'backup-save-first': 'Stage a change in an editable saved copy to save it before downloading.',
    'backup-saved-only': 'Available when a verified saved copy has staged changes to exclude.',
    'stage-backup': 'Release the active session and choose a local backup file first.',
    'restore-backup': session.dirty ? 'Undo changes to the validated backup preview before restoring it.' : 'Validate a backup preview and release any active session before restoring to a new empty folder.',
    'verify-save-outcome': 'Available when a selected session has an unresolved save outcome to check.',
    'retry-save': 'Verification must first prove this exact draft was not saved. Other outcomes cannot be retried.',
    'recover-ledger': 'Available only for an interrupted operation with retained write ownership.',
    'recover-stale': 'Open saved synthetic year handles expired heartbeats. Use this advanced fallback only if the selected session still needs recovery.'
  };
  const networkActions = new Set(['save-ledger','save-preview','reopen-ledger','release-ledger','export-backup','backup-save-first','backup-saved-only','restore-backup','verify-save-outcome','retry-save','recover-ledger','recover-stale']);
  for (const [id, reason] of Object.entries(reasons)) {
    const button = $(id); button.hidden = false;
    button.setAttribute('aria-describedby', id + '-help');
    $(id + '-help').textContent = button.disabled
      ? busy ? 'Wait for the current operation to finish.' : offline && networkActions.has(id) ? 'Reconnect to the internet before using this action.' : reason
      : 'Available. ' + ({'retry-save':'Requires your explicit confirmation.', 'recover-stale':'Confirm every prior session has stopped.', 'release-ledger':'Verified closure clears loaded records and unsaved edits.', 'draft-storage-link':'Open Storage to choose a new folder.'}[id] || '');
  }
}
async function run(message, operation, formStatus = null, actionId = 'workspace-action') {
  if (busy) return;
  // Apply a queued query before an action so cancellation leaves rows and input aligned.
  if (searchTimer !== null) { cancelSearch(); page = 0; render(); }
  activeFormStatus = formStatus;
  // Observation only: never let metrics block an action or replace its failure.
  try { actionRequestWindow = storage.lifecycle?.requestMetrics?.openWindow() ?? null; } catch { actionRequestWindow = null; }
  const measuredLifecycle=storage.lifecycle;
  leaveBreadcrumb({e:'action.start', actionId});
  clearDiagnostic($('action-status'));
  busy = true; operationStarted = Date.now(); refresh(); announce(message);
  const timer = setInterval(refresh, 1000);
  try { const completed=await operation(); leaveBreadcrumb({e:'action.ok', actionId});
    try {
      const publication=null; // Full-snapshot exposes request metrics, not legacy paged publication telemetry.
      const summary=successfulActionSummary({actionId,elapsedMs:Math.max(0,Date.now()-operationStarted),requests:storage.lifecycle===measuredLifecycle?actionRequestWindow?.close():null,manifestPatches:storage.lifecycle===measuredLifecycle?actionRequestWindow?.manifestPatches():null,publication,purposes:storage.lifecycle===measuredLifecycle?actionRequestWindow?.purposes():null});
      if(completed===true&&summary)$('success-metrics').textContent=JSON.stringify(summary,null,2);
    }catch{/* Success observations cannot change the action outcome. */}
  }
  catch (error) {
    leaveBreadcrumb({e:'action.fail', actionId});
    const message = showDiagnostic(error, {surface: 'workspace', target: $('action-status'), actionId, page: pages.current});
    const recoveryAction = ['save-ledger','retry-save','verify-save-outcome'].includes(actionId) || (actionId === 'backup-save-first' && session.recoveryOutcome !== 'saved');
    announce(recoveryAction && session.recoveryOutcome ? recoveryMessage() : message + (session.dirty ? ' Your staged changes remain in this tab.' : ''), recoveryAction && session.recoveryOutcome === 'saved' ? 'success' : 'error');
  } finally {
    try { actionRequestWindow?.close(); } catch { /* observational only */ }
    actionRequestWindow = null;
    clearInterval(timer); busy = false; operationStarted = null; refresh(); activeFormStatus = null; }
}
const formStatuses = { 'stage-account':'account-form-status', 'stage-balance':'position-form-status', 'stage-closure':'closure-form-status', 'stage-holdings':'holdings-form-status', 'stage-reconciliation':'reconciliation-form-status' };
const action = (id, message, callback) => $(id).addEventListener('click', () => {
  if (!$(id).disabled) return run(message, callback, formStatuses[id], id);
});
function hasUnfinishedEvidence() {
  return historicalSummaryWorkflow?.hasUnfinishedReview() || holdingRows.length > 0 || componentRows.length > 0 || $('statement-full-month').checked ||
    ['balance-date','balance-amount','balance-source','holdings-date','holdings-source','reconcile-source','closure-source','new-account-name'].some(id => $(id).value.trim());
}
function confirmReplace(message = 'Replace your local draft with verified saved records? Unsaved corrections will be discarded only after the saved records open successfully. An unverified save may already be on Drive.') {
  if ((!session.dirty && !hasUnfinishedDetail() && !hasUnfinishedEvidence()) || window.confirm(message)) return true;
  announce('Action cancelled. Your local draft is unchanged.');
  return false;
}
function addOptions(select, options, selected, first) {
  select.replaceChildren();
  for (const [value, text] of [['', first], ...options]) { const option = node('option', text); option.value = value; select.append(option); }
  select.value = options.some(([value]) => value === selected) ? selected : '';
}
// Drop application-owned financial references and rendered copies only after
// verified closure. This is not a claim of browser/OS memory zeroization.
function clearLoadedWorkspace() {
  historicalSummaryWorkflow?.reset();
  cancelSearch();
  view = null; viewLedger = null; viewReader = null; homeView = null; positionRender = null;
  renderedPositionDate = null; selectedActivity = null; detailEditorBaseline = null;
  page = 0; reviewQueueButton = null; composingSearch = false;
  reviewButtons.clear(); homeButtons.clear(); editorAccounts.clear();
  sourceReviewUpdates.length = 0; sourceReviewPage = 0; sourceReviewScope = null;
  positionButtons.length = 0; holdingRows.length = 0; componentRows.length = 0;
  for (const id of ['summary-cards','recent-activities','transaction-rows','review-queue','position-totals','position-accounts','holdings-accounts','position-coverage','detail-source','detail-history','component-rows','holdings-rows',
    'account-filter','month-filter','transfer-counterparty','balance-account','reconcile-account','reconcile-opening','reconcile-closing','closure-anchor','holdings-account']) $(id).replaceChildren();
  for (const id of ['summary-scope','qualification','attention-count','transaction-count','filter-count','page-status','overview-review-title','review-summary','scope-period-title','scope-position-title','position-scope','position-warning','position-coverage-help','detail-title','detail-description','detail-amount','transfer-link-status', ...Object.values(formStatuses)]) $(id).textContent = '';
  for (const id of [...detailEditorFields, ...positionInputs, 'transaction-search','account-filter','month-filter','backup-password','backup-password-confirm','restore-password','backup-file','position-date']) $(id).value = '';
  $('review-only').checked = false; $('statement-full-month').checked = false;
  $('activity-detail').hidden = true; $('transaction-table-wrap').hidden = true;
  $('empty-state').hidden = false; $('empty-state').textContent = 'No ledger loaded.';
  pages.clearDetail();
}
function render({ reset = false } = {}) {
  cancelSearch();
  if (!session.ledger) return;
  if ($('account-filter').value && !session.ledger.accounts.some(account => account.accountId === $('account-filter').value)) $('account-filter').value = '';
  if (reset) {
    positionRender = null;
    for (const id of Object.values(formStatuses)) $(id).textContent = '';
    $('statement-full-month').checked = false; componentRows.length = 0; holdingRows.length = 0;
    $('component-rows').replaceChildren(); $('holdings-rows').replaceChildren();
    for (const id of ['holdings-source','holdings-date','reconcile-source','balance-source','balance-date','balance-amount','closure-source','new-account-name']) $(id).value = '';
    page = 0; selectedActivity = null; detailEditorBaseline = null; $('transaction-search').value = ''; $('review-only').checked = false; $('account-filter').value = ''; $('month-filter').value = ''; $('activity-detail').hidden = true; pages.clearDetail(); }
  if (viewLedger !== session.ledger) {
    const reader = createWorkspaceViewReader(session.ledger, {monthlyIndex:session.store?.monthIndex});
    viewReader = reader; viewLedger = session.ledger; homeView = null;
  }
  view = viewReader.view({ accountId: $('account-filter').value, month: $('month-filter').value, query: $('transaction-search').value, reviewOnly: $('review-only').checked, page });
  page = view.page;
  addOptions($('account-filter'), view.accounts.map(a => [a.accountId, a.displayName]), view.scope.accountId, 'All accounts');
  const months = view.scope.month && !view.months.includes(view.scope.month) ? [view.scope.month, ...view.months] : view.months;
  addOptions($('month-filter'), months.map(month => [month, monthLabel(month)]), view.scope.month, 'Full saved period');
  $('summary-scope').textContent = `${view.scope.start || 'No start date'} to ${view.scope.end || 'No end date'} · ${view.scope.accountId ? view.accounts.find(a => a.accountId === view.scope.accountId)?.displayName : 'All accounts'}`;
  $('qualification').textContent = view.qualifications.join(' ');
  $('summary-cards').replaceChildren();
  const summaries = view.summary.length ? view.summary : [{ currency: 'USD', income: null, spending: null, cash: null }];
  for (const summary of summaries) {
    const available = view.summaryAvailability?.[summary.currency];
    for (const [key, heading, note] of [['income', 'Known income', 'Posted and classified records only'], ['spending', 'Known spending', 'Refunds count in their posting period'], ['cash', 'Known cash movement', 'Checking and savings only. Not a balance.']]) {
      const card = node('article', undefined, 'metric-card');
      const value = available && available[key + 'Available'] === false ? null : summary[key];
      card.append(node('p', `${heading} · ${summary.currency}`, 'metric-label'), node('p', money(value, summary.currency), 'metric-value'), node('p', note, 'metric-note'));
      $('summary-cards').append(card);
    }
  }
  $('coverage-summary').textContent = `${view.coverage.importCount} import runs. Latest source activity: ${view.coverage.latestActivityDate || 'unavailable'}. Imported dates alone do not prove complete history. Inspect account-month reconciliation on the Review page.`;
  // Home uses account/month scope, independently of the Activity search,
  // review filter and page. Retain only the current Home scope so its read does
  // not evict the Activity reader's latest filtered result on every render.
  if (!homeView || homeView.scope.accountId !== view.scope.accountId || homeView.scope.month !== view.scope.month) {
    homeView = viewReader.view({accountId:view.scope.accountId, month:view.scope.month, pageSize:4});
  }
  const recent = homeView;
  homeButtons.clear(); $('recent-activities').replaceChildren();
  for (const row of recent.rows) {
    const button = node('button', undefined, 'recent-activity'); button.type = 'button';
    button.setAttribute('aria-label', `Inspect ${row.sourceDescription} on ${row.reportingDate || 'unknown date'}`);
    const copy = node('span', undefined, 'recent-copy');
    copy.append(node('strong', row.sourceDescription), node('small', `${row.accountName} · ${row.reportingDate || 'Unknown date'}`));
    const amount = node('span', undefined, 'recent-value');
    amount.append(node('strong', money(row.amountText, row.currency)), node('small', [postingLabel(row) || label(row.activityKind), row.needsReview ? 'Needs review' : ''].filter(Boolean).join(' · ')));
    button.append(copy, amount); button.addEventListener('click', () => inspectActivity(row.activityId));
    homeButtons.set(row.activityId, button); $('recent-activities').append(button);
  }
  if (!recent.rows.length) $('recent-activities').append(node('p', 'No activity in this account and period.', 'quiet-placeholder'));
  const reviewCount = view.review.activityCount + view.review.sourceCount;
  $('attention-count').textContent = String(reviewCount);
  $('transaction-count').textContent = String(view.totalCount);
  $('filter-count').textContent = `${view.filteredCount} matching activities of ${view.totalCount} in this account and period. Search and review filters do not change totals.`;
  reviewButtons.clear();
  $('transaction-rows').replaceChildren();
  for (const row of view.rows) {
    const tr = node('tr', undefined, 'transaction-record'), description = node('td'); tr.setAttribute('role', 'row');
    tr.setAttribute('data-kind', row.activityKind);
    tr.setAttribute('data-review', String(row.needsReview));
    const metadata = node('small', row.accountName, 'transaction-detail');
    const inlineDate = node('span', ` · ${row.reportingDate || 'Unknown date'}`, 'list-date');
    inlineDate.setAttribute('aria-hidden', 'true'); metadata.append(inlineDate);
    description.append(node('strong', row.sourceDescription), metadata);
    const classification = node('td');
    classification.append(node('span', label(row.activityKind), 'classification-badge'), node('small', row.categoryId || 'No category', 'transaction-detail'));
    if (postingLabel(row)) classification.append(node('span', postingLabel(row), 'posting-state'));
    if (row.needsReview) classification.append(node('small', 'Needs review: ' + row.reviewReasons.map(reviewReason).join(', '), 'transaction-detail review-reasons'));
    const inspect = node('button', 'Inspect →', 'text-button transaction-open'); inspect.type = 'button'; inspect.setAttribute('aria-label', `Review ${row.sourceDescription} on ${row.reportingDate || 'unknown date'}`);
    reviewButtons.set(row.activityId, inspect);
    inspect.setAttribute('aria-controls', 'activity-detail');
    inspect.addEventListener('click', () => inspectActivity(row.activityId));
    tr.addEventListener('click', event => {
      // Keep descriptions selectable. The explicit button is also the keyboard
      // action; a bubbled button click must not open the detail twice.
      if (event.target === inspect || event.target?.closest?.('button')) return;
      if (!window.getSelection?.()?.toString()) inspectActivity(row.activityId);
    });
    const actionCell = node('td'); actionCell.append(inspect);
    tr.append(node('td', row.reportingDate || 'Unknown date'), description, classification, node('td', money(row.amountText, row.currency)), actionCell);
    for (const cell of tr.children) cell.setAttribute('role', 'cell');
    $('transaction-rows').append(tr);
  }
  $('empty-state').hidden = view.filteredCount > 0;
  if (!view.filteredCount) $('empty-state').textContent = 'No activities match this selection. Change the account, month or search to see other records.';
  $('transaction-table-wrap').hidden = !view.filteredCount;
  $('page-status').textContent = `Page ${view.page + 1} of ${view.pages}`;
  $('overview-review-title').textContent = reviewCount ? `${reviewCount} records need a second look` : 'No unresolved records in this account and period. Coverage still needs separate reconciliation.';
  $('review-summary').textContent = `${view.review.activityCount} activities need review in this account and period. ${view.review.sourceCount} source observations await a decision. Unknown investment activity remains excluded from known totals.`;
  reviewQueueButton = null;
  $('review-queue').replaceChildren();
  if (view.review.activityCount) {
    const reviewButton = node('button', `Show ${view.review.activityCount} activities needing review`);
    reviewButton.type = 'button'; reviewQueueButton = reviewButton;
    reviewButton.addEventListener('click', () => {
      if (busy) return;
      $('review-only').checked = true; $('transaction-search').value = ''; page = 0; render();
      pages.go('transactions'); $('transaction-search').focus();
    });
    $('review-queue').append(reviewButton);
  }
  renderSourceReviews();
  if (!reviewCount) {
    const empty = node('article', undefined, 'review-empty');
    const link = node('a', 'Check account-month coverage →', 'inline-action'); link.href = '#reconciliation';
    empty.append(node('h3', 'No decisions waiting'), node('p', 'No unresolved records in this account and period. Check reconciliation to assess missing history.'), link);
    $('review-queue').append(empty);
  }
  renderPosition();
  const accountTitle = view.scope.accountId ? view.accounts.find(account => account.accountId === view.scope.accountId)?.displayName : 'All accounts';
  $('scope-period-title').textContent = `${accountTitle} · ${view.scope.month ? monthLabel(view.scope.month) : 'Full saved period'}`;
  $('scope-position-title').textContent = `${accountTitle} · As of ${$('position-date').value}`;
  refresh();
}
function addEditorRow(kind) {
  const rows = kind === 'holding' ? holdingRows : componentRows;
  const container = $(kind === 'holding' ? 'holdings-rows' : 'component-rows');
  const index = ++editorSequence, fieldset = node('fieldset'), fields = {};
  fieldset.append(node('legend', kind === 'holding' ? 'Dated holding' : 'Statement movement component'));
  const specs = kind === 'holding'
    ? [['symbol', 'Symbol or holding identifier'], ['assetType', 'Asset type', ['stock','bond','mutual-fund','etf','cash','unsupported']], ['quantity', 'Exact quantity'], ['valueText', 'Exact statement value']]
    : [['kind', 'Movement kind', ['principal-change','market-value-change','cash-flow','fees','other']], ['amountText', 'Signed exact change'], ['reference', 'Component statement reference']];
  for (const [key, title, options] of specs) {
    const control = node(options ? 'select' : 'input'), wrapper = node('label', title);
    control.id = `${kind}-${index}-${key}`; wrapper.setAttribute('for', control.id);
    if (options) { for (const option of options) { const item = node('option', label(option)); item.value = option; control.append(item); } }
    else { control.type = 'text'; control.maxLength = 300; if (['quantity','valueText','amountText'].includes(key)) control.inputMode = 'decimal'; }
    fields[key] = control; wrapper.append(control); fieldset.append(wrapper);
  }
  const remove = node('button', kind === 'holding' ? 'Remove holding row' : 'Remove component'); remove.type = 'button';
  const row = {fieldset, fields, remove}; rows.push(row); fieldset.append(remove); container.append(fieldset);
  remove.addEventListener('click', () => {
    if (busy || !session.canEdit()) return;
    const removedIndex = rows.indexOf(row); rows.splice(removedIndex, 1);
    container.replaceChildren(...rows.map(item => item.fieldset)); refresh();
    const next = rows[Math.min(removedIndex, rows.length - 1)];
    (next ? Object.values(next.fields)[0] : $(kind === 'holding' ? 'add-holding' : 'add-component')).focus();
  });
  refresh(); Object.values(fields)[0].focus(); return row;
}
function statementMethod() {
  const account = session.ledger?.accounts.find(account => account.accountId === $('reconcile-account').value);
  return account && ['brokerage','retirement','mortgage','auto-loan'].includes(account.accountType);
}
function updateStatementEditor() {
  $('statement-components-panel').hidden = !statementMethod();
  const month = $('month-filter').value;
  $('statement-coverage-period').textContent = month ? `Complete statement declaration applies only to ${month}, for the selected account.` : 'Select an activity month above. No coverage can be declared without a month.';
}
function resolveHoldings(card, account) {
  if (!account.holdings?.reasons.includes('conflicting-holdings')) return;
  card.append(node('p', 'Conflicting holdings statements: inspect each candidate before selecting one.'));
  const reason = node('input'); reason.type = 'text'; reason.setAttribute('aria-label', `Holdings selection reason for ${account.displayName}`); card.append(reason);
  const events = (session.ledger.positionEvents || []).filter(event => event.eventType === 'holdings-snapshot' && event.accountId === account.accountId && event.effectiveDate === account.holdings.effectiveDate);
  for (const event of events) {
    card.append(evidenceDetails(`Inspect holdings candidate: ${event.source.reference}`, () => event));
    const button = node('button', `Select holdings: ${event.source.reference}`); button.type = 'button'; positionButtons.push(button); card.append(button);
    button.addEventListener('click', () => {
      if (busy || !session.canEdit()) return;
      if (!reason.value.trim()) { announce('Explain why this holdings statement is supported.', 'error'); reason.focus(); return; }
      return run('Recording holdings evidence selection locally.', async () => {
        session.recordPosition({type:'holdings-resolution', accountId:account.accountId, effectiveDate:event.effectiveDate, selectedEventId:event.eventId, candidateEventIds:events.map(item => item.eventId), reason:reason.value.trim()});
        render(); announce('Holdings selection staged. All candidate statements remain in the audit history.', 'success');
      }, null, 'select-holdings-evidence');
    });
  }
}
function balanceEvents(accountId) {
  return (session.ledger.positionEvents || []).filter(event => event.eventType === 'balance-snapshot' && event.accountId === accountId);
}
function populateAnchors() {
  const month = $('month-filter').value;
  const events = balanceEvents($('reconcile-account').value);
  let opening, closing;
  if (month && isCalendarDate(month + '-01')) {
    const date = new Date(month + '-01T00:00:00Z'); date.setUTCDate(0);
    opening = date.toISOString().slice(0,10);
    date.setUTCMonth(date.getUTCMonth()+2, 0); closing = date.toISOString().slice(0,10);
  }
  const options = date => events.filter(event => event.effectiveDate === date).map(event => [event.eventId, `${event.effectiveDate} · ${event.currency} ${event.amountText} · ${event.source?.reference || 'No reference'}`]);
  const openings = options(opening), closings = options(closing);
  addOptions($('reconcile-opening'), openings, $('reconcile-opening').value, 'Choose opening anchor');
  addOptions($('reconcile-closing'), closings, $('reconcile-closing').value, 'Choose closing anchor');
  $('reconcile-anchor-help').textContent = !month ? 'Select an activity month above to choose balance evidence.'
    : !$('reconcile-account').value ? 'Choose an account to see its month-end balance evidence.'
    : `Required balance dates: opening ${opening}; closing ${closing}. ${!openings.length || !closings.length ? `Add dated balance evidence for the missing ${!openings.length ? 'opening' : ''}${!openings.length && !closings.length ? ' and ' : ''}${!closings.length ? 'closing' : ''} anchor before reconciling.` : 'Inspect source references before choosing. Conflicting evidence still requires a separate resolution.'}`;
}
function renderPosition() {
  if (!$('position-date').value) $('position-date').value = new Date().toISOString().slice(0, 10);
  const scopeKey = [$('position-date').value, view.scope.accountId, view.scope.month].join('|');
  if (positionRender?.ledger === session.ledger && positionRender.scopeKey === scopeKey) return;
  positionRender = {ledger:session.ledger, scopeKey};
  renderedPositionDate = $('position-date').value;
  const position = viewReader.position({asOf:$('position-date').value, accountId:view.scope.accountId});
  $('position-scope').textContent = `As of ${position.asOf} · ${view.scope.accountId ? 'Selected account only' : 'All ledger accounts'}. Activity month does not change this date. Currencies are never combined.`;
  $('position-warning').textContent = `${position.complete ? 'All scoped position evidence meets completeness checks.' : 'Incomplete financial position. Known subtotals are not complete net worth.'} ${position.reasons.map(label).join('; ')} Freshness warning after 35 calendar days. Older balances are dated observations, not live balances.`;
  $('position-totals').replaceChildren();
  for (const subtotal of position.currencies) for (const [key, title] of [['knownAssets', 'Known assets'], ['knownLiabilities', 'Known liabilities'], ['knownNetWorth', 'Known net-worth subtotal']]) {
    const card = node('article', undefined, 'metric-card');
    const scoped = position.accounts.filter(account => account.currency === subtotal.currency);
    const relevant = key === 'knownNetWorth' ? scoped : scoped.filter(account => account.role === (key === 'knownAssets' ? 'asset' : 'liability'));
    const value = relevant.length && !relevant.some(account => account.balance !== null) ? null : subtotal[key];
    card.append(node('p', `${title} · ${subtotal.currency}`, 'metric-label'), node('p', money(value, subtotal.currency), 'metric-value'), node('p', subtotal.complete ? 'Complete for selected account scope and date.' : 'Partial evidence only. Missing values are not zero.', 'metric-note'));
    $('position-totals').append(card);
  }
  if (!position.currencies.length) $('position-totals').append(node('p', 'Position unavailable: no accounts in scope.'));
  $('position-accounts').replaceChildren(); $('holdings-accounts').replaceChildren(); positionButtons.length = 0;
  for (const account of position.accounts) {
    const card = node('article', undefined, 'review-item');
    card.append(node('h3', account.displayName), node('p', money(account.balance, account.currency), 'account-balance'), node('p', `${label(account.role)} · ${label(account.accountType)} · ${label(account.status)}`, 'account-meta'), node('p', `Balance date: ${account.balanceDate || 'unavailable'} · Basis: ${account.basis || 'unavailable'}`), node('p', `${account.stale ? 'Stale evidence. ' : ''}${account.reasons.map(label).join('; ')}`));
    card.append(evidenceDetails('Inspect balance evidence and selection history', () => (session.ledger.positionEvents || []).filter(event => event.accountId === account.accountId)));
    if (account.status === 'conflict') {
      card.append(node('p', 'Conflicting balances are excluded. Inspect all candidates and record why one is supported.'));
      const rationale = node('input'); rationale.type = 'text'; rationale.setAttribute('aria-label', `Selection reason for ${account.displayName}`); rationale.maxLength = 300;
      card.append(rationale);
      for (const event of balanceEvents(account.accountId).filter(event => account.candidateEventIds.includes(event.eventId))) {
        const button = node('button', `Select ${event.amountText} · ${event.source?.reference || event.eventId}`); button.type = 'button'; positionButtons.push(button);
        button.addEventListener('click', () => {
          if (busy || !session.canEdit()) return;
          if (!rationale.value.trim()) { announce('Explain why this balance evidence is supported.', 'error'); rationale.focus(); return; }
          return run('Recording an auditable balance selection.', async () => {
            session.recordPosition({type:'balance-resolution', accountId:account.accountId, effectiveDate:event.effectiveDate, selectedEventId:event.eventId, candidateEventIds:account.candidateEventIds, reason:rationale.value.trim()});
            render(); announce('Balance selection staged with its reason. Prior evidence is preserved. Save changes to persist it.', 'success');
          }, null, 'select-balance-evidence');
        });
        card.append(button);
      }
    }
    if (['brokerage', 'retirement'].includes(account.accountType)) {
      const link = node('a', 'View dated holdings →', 'account-holdings-link'); link.href = '#holdings'; card.append(link);
      const holdingCard = node('article', undefined, 'review-item');
      holdingCard.append(node('h3', account.displayName), node('p', account.holdings ? `As of ${account.holdings.effectiveDate} · ${account.holdings.scope} · ${account.currency}` : 'No supported dated holdings evidence. Transaction rows are not holdings.'));
      if (account.holdings) {
        holdingCard.append(node('p', `${account.holdings.stale ? 'Stale evidence. ' : ''}${account.holdings.reasons.map(label).join('; ')}`), evidenceDetails('Inspect dated holdings and valuation', () => account.holdings));
      }
      resolveHoldings(holdingCard, account); $('holdings-accounts').append(holdingCard);
    }
    $('position-accounts').append(card);
  }
  if (!$('holdings-accounts').children.length) $('holdings-accounts').append(node('p', 'No investment accounts in the selected scope.', 'quiet-placeholder'));
  const options = session.ledger.accounts.map(account => [account.accountId, account.displayName]);
  addOptions($('balance-account'), options, $('balance-account').value, 'Choose account');
  addOptions($('reconcile-account'), options, $('reconcile-account').value, 'Choose account');
  const zeros = (session.ledger.positionEvents || []).filter(event => event.eventType === 'balance-snapshot' && /^0(?:\.0+)?$/.test(event.amountText));
  addOptions($('closure-anchor'), zeros.map(event => [event.eventId, `${session.ledger.accounts.find(account => account.accountId === event.accountId)?.displayName} · ${event.effectiveDate} · ${event.amountText} · ${event.source.reference}`]), $('closure-anchor').value, 'Choose zero-balance evidence');
  addOptions($('holdings-account'), session.ledger.accounts.filter(account => ['brokerage','retirement'].includes(account.accountType)).map(account => [account.accountId, account.displayName]), $('holdings-account').value, 'Choose investment account');
  for (const id of ['balance-account', 'holdings-account', 'reconcile-account']) editorAccounts.set(id, $(id).value);
  populateAnchors(); updateStatementEditor();
  $('position-coverage').replaceChildren();
  if (view.scope.month) {
    const coverage = viewReader.coverage({month:view.scope.month, accountId:view.scope.accountId});
    $('position-coverage-help').textContent = `${view.scope.month}: ${coverage.complete ? 'Reconciled complete for selected scope.' : 'Not reconciled complete for selected scope.'} Declared imports alone are insufficient.`;
    for (const item of coverage.accounts) {
      const card = node('article', undefined, 'review-item');
      card.append(node('h4', session.ledger.accounts.find(account => account.accountId === item.accountId)?.displayName || item.accountId), node('p', `${label(item.state)} · Declared: ${item.declared ? 'yes' : 'no'} · Observed: ${item.observed ? 'yes' : 'no'}`), node('p', `Opening anchor: ${item.openingBalanceEventId || 'missing'} · Closing anchor: ${item.closingBalanceEventId || 'missing'} · Discrepancy: ${item.discrepancy ?? 'unavailable'}`), node('p', item.reasons.map(label).join('; ')), evidenceDetails('Inspect reconciliation evidence', () => item));
      $('position-coverage').append(card);
    }
  } else $('position-coverage-help').textContent = 'Select an activity month above to inspect account-month coverage. Declared imports alone do not prove completeness.';
}
// Source review is part of the same in-memory draft and explicit-save path.
// Pagination bounds DOM work without hiding the remaining source evidence.
function renderSourceReviews() {
  sourceReviewUpdates.length = 0;
  const scope = JSON.stringify([view.scope.accountId, view.scope.month]);
  if (sourceReviewScope !== scope) { sourceReviewPage = 0; sourceReviewScope = scope; }
  const unresolved = view.sourceReviews.map(row => session.ledger.observations.find(o => o.observationId === row.observationId));
  const latest = new Map();
  for (const decision of session.ledger.reviewDecisions) latest.set(decision.observationId, decision);
  const resolved = session.ledger.observations.filter(o => o.resolved && latest.has(o.observationId) &&
    (!view.scope.accountId || o.accountId === view.scope.accountId) &&
    (!view.scope.month || !o.candidate.effectiveDate || o.candidate.effectiveDate.startsWith(view.scope.month)));
  const entries = [...unresolved, ...resolved];
  if (!entries.length) return;
  const pagesCount = Math.ceil(entries.length / 10);
  sourceReviewPage = Math.min(sourceReviewPage, pagesCount - 1);
  const status = node('p', `Source decisions: page ${sourceReviewPage + 1} of ${pagesCount}. ${unresolved.length} unresolved and ${resolved.length} resolved. Search does not filter this queue.`);
  $('review-queue').append(status);
  const navigation = node('div', undefined, 'storage-actions');
  for (const [text, delta] of [['Previous source page', -1], ['Next source page', 1]]) {
    const button = node('button', text); button.type = 'button';
    const update = () => { button.disabled = busy || sourceReviewPage + delta < 0 || sourceReviewPage + delta >= pagesCount; };
    sourceReviewUpdates.push(update); update();
    button.addEventListener('click', () => { if (!button.disabled) { sourceReviewPage += delta; render(); } });
    navigation.append(button);
  }
  $('review-queue').append(navigation);
  const effective = getEffectiveActivities(session.ledger);
  for (const observation of entries.slice(sourceReviewPage * 10, sourceReviewPage * 10 + 10)) {
    const item = node('article', undefined, 'review-item');
    item.dataset.observationId = observation.observationId;
    const candidate = observation.candidate;
    item.append(node('h3', candidate.sourceDescription || 'Source observation', 'review-title'),
      node('p', `Row ${observation.rowOrdinal} · ${candidate.effectiveDate || 'Unknown date'} · ${label(observation.reasonCode)} · ${observation.resolved ? 'Resolved' : 'Needs review'}`, 'review-meta'),
      evidenceDetails('Inspect retained source evidence', () => ({sourceFields: observation.sourceFields, candidate})));
    const rationaleLabel = node('label', 'Reason for this decision');
    const rationale = node('textarea'); rationaleLabel.append(rationale); item.append(rationaleLabel);
    const help = node('p', '', 'field-help'); item.append(help);
    const actions = node('div', undefined, 'storage-actions');
    const controls = [];
    const act = (text, callback, available = () => true) => {
      const button = node('button', text); button.type = 'button';
      const update = () => { button.disabled = busy || !session.canEdit() || !rationale.value.trim() || !available(); };
      controls.push(update); sourceReviewUpdates.push(update); update();
      button.addEventListener('click', () => {
        if (button.disabled) return;
        return run('Staging the source review decision locally.', () => {
          callback(rationale.value.trim()); render(); refresh();
          announce('Source decision staged locally. Use Save changes to persist it.', 'success');
        });
      });
      actions.append(button);
    };
    if (observation.resolved) {
      const decision = latest.get(observation.observationId);
      item.append(evidenceDetails('Inspect latest review decision', () => decision));
      act('Reverse source decision', reason => session.reverseSourceReview({reviewDecisionId: decision.reviewDecisionId, rationale: reason}));
      help.textContent = 'Enter a reason to stage a reversal. Later dependent changes may prevent reversal; they are never discarded.';
    } else {
      const valid = candidate.valid !== false && isCalendarDate(candidate.effectiveDate);
      const missingCurrency = candidate.errorCode === 'missing-currency' && ['missing-currency','review-decision-reversed'].includes(observation.reasonCode);
      const currency = node('input'); currency.type = 'text'; currency.maxLength = 3;
      if (missingCurrency) {
        const currencyLabel = node('label', 'Confirmed currency from source evidence (three-letter code)');
        currencyLabel.append(currency); item.append(currencyLabel);
        currency.addEventListener('input', () => controls.forEach(update => update()));
        sourceReviewUpdates.push(() => {currency.disabled = busy || !session.canEdit();});
      }
      const targetLabel = node('label', 'Existing activity to match (same account and currency)');
      const target = node('select'); addOptions(target, effective.filter(a => a.active && a.accountId === observation.accountId && a.currency === candidate.currency)
        .map(a => [a.activityId, `${a.effectiveDate || 'Unknown date'} · ${a.sourceDescription} · ${exactSignedDecimal(a) ?? 'Unknown amount'}`]), '', 'Choose a matching activity');
      targetLabel.append(target); item.append(targetLabel);
      act('Keep as a separate activity', reason => session.reviewSource({observationId: observation.observationId, action:'keep-separate', rationale:reason, currency:missingCurrency ? currency.value.trim() : null}), () => valid || (missingCurrency && /^[A-Z]{3}$/.test(currency.value.trim()) && isCalendarDate(candidate.effectiveDate)));
      act('Match selected activity', reason => session.reviewSource({observationId:observation.observationId, action:'match', activityId:target.value, rationale:reason}), () => valid && Boolean(target.value));
      act('Reject source row', reason => session.reviewSource({observationId:observation.observationId, action:'reject', rationale:reason}));
      target.addEventListener('change', () => controls.forEach(update => update()));
      sourceReviewUpdates.push(() => {target.disabled = busy || !session.canEdit();});
      help.textContent = missingCurrency ? 'Inspect source evidence, enter its explicit currency and a reason before keeping this row. No currency is inferred.' : valid ? 'Enter a reason. Matching also requires a target; incompatible amounts are rejected without changing the draft.' : 'Malformed rows cannot be accepted or matched. Inspect the retained evidence, then explicitly reject the row with a reason or import a corrected export.';
    }
    const decisionHelp = help.textContent;
    sourceReviewUpdates.push(() => { help.textContent = busy ? 'Wait for the current operation to finish.' : !session.canEdit() ? 'Reopen or recover an editable session before staging a decision. ' + decisionHelp : decisionHelp; });
    rationale.addEventListener('input', () => controls.forEach(update => update()));
    sourceReviewUpdates.push(() => {rationale.disabled = busy || !session.canEdit();});
    item.append(actions); $('review-queue').append(item);
  }
}

function evidenceDetails(title, read) {
  const details = node('details'), summary = node('summary', title);
  details.append(summary);
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    details.append(node('pre', JSON.stringify(read(), null, 2))); loaded = true;
  });
  return details;
}
function inspectActivity(activityId) {
  if (busy) return;
  if (selectedActivity === activityId) {
    pages.openDetail(); refresh(); $('detail-title').focus(); return;
  }
  if (!confirmDiscardDetail()) return;
  showDetail(activityId);
}
function showDetail(activityId, {navigate = true} = {}) {
  const detail = getWorkspaceActivity(session.ledger, activityId);
  if (!detail) return;
  selectedActivity = activityId;
  const activity = detail.activity;
  pages.openDetail({navigate});
  $('detail-title').textContent = activity.sourceDescription;
  $('detail-description').textContent = `${detail.account.displayName} · ${activity.effectiveDate || 'Unknown date'} · ${label(activity.lifecycleStatus)} · ${label(activity.activityKind)} · ${activity.categoryId || 'No category'}${activity.reviewReasons?.length ? '. Needs review: ' + activity.reviewReasons.map(reviewReason).join(', ') : ''}`;
  $('detail-amount').textContent = money(activity.amountText, activity.currency);
  const transferPanel = $('transfer-link-panel');
  transferPanel.hidden = true;
  $('transfer-link-status').textContent = '';
  $('transfer-counterparty').replaceChildren();
  $('transfer-link-rationale').value = '';
  if (activity.transferGroupId && activity.transferCounterpartyActivityId) {
    const counterpart = getWorkspaceActivity(session.ledger, activity.transferCounterpartyActivityId);
    if (counterpart) {
      const from = activity.transferRole === 'outgoing' ? detail.account.displayName : counterpart.account.displayName;
      const to = activity.transferRole === 'incoming' ? detail.account.displayName : counterpart.account.displayName;
      $('transfer-link-status').textContent = `Verified relationship: ${from} → ${to}. Both original activities and source evidence remain unchanged.`;
      transferPanel.hidden = false;
    }
  } else if (activity.activityKind === 'transfer' && activity.amountText?.startsWith('-')) {
    const amount = activity.amountText.slice(1);
    const candidates = getEffectiveActivities(session.ledger).filter(candidate => candidate.active &&
      candidate.activityKind === 'transfer' &&
      candidate.currency === activity.currency && candidate.accountId !== activity.accountId &&
      !candidate.transferGroupId && exactSignedDecimal(candidate) === amount);
    const accountById = new Map(session.ledger.accounts.map(account => [account.accountId, account]));
    const placeholder = node('option', 'Choose the matching incoming activity');
    placeholder.value = '';
    $('transfer-counterparty').append(placeholder);
    for (const candidate of candidates) {
      const account = accountById.get(candidate.accountId);
      const option = node('option', `${account?.displayName || 'Other account'} · ${candidate.effectiveDate || 'Unknown date'} · ${candidate.sourceDescription}`);
      option.value = candidate.activityId;
      $('transfer-counterparty').append(option);
    }
    $('transfer-link-status').textContent = candidates.length
      ? `Found ${candidates.length} exact-amount incoming candidate(s) in another account. Review the date and description, then choose the matching activity. No pair is linked automatically.`
      : 'No exact-amount incoming candidate is currently available. Both activities must be classified as transfers, in different accounts, with the same currency and opposite equal amounts.';
    transferPanel.hidden = false;
  }
  $('detail-source').replaceChildren();
  for (const observation of detail.observations) {
    const source = node('article', undefined, 'review-item');
    source.append(node('strong', observation.candidate.sourceDescription || 'Source observation'),
      node('p', `Source row ${observation.rowOrdinal} · ${label(observation.disposition)} · ${observation.candidate.effectiveDate || 'Unknown date'}`, 'review-meta'));
    const run = detail.imports.find(item => item.importRunId === observation.importRunId);
    if (run) source.append(node('p', `Declared coverage: ${run.declaredCoverage.start} to ${run.declaredCoverage.end}. ${label(run.status)}.`, 'review-meta'));
    source.append(evidenceDetails('Inspect original source evidence', () => observation));
    $('detail-source').append(source);
  }
  if (!detail.observations.length) $('detail-source').append(node('p', 'No linked source observation is available.'));
  $('detail-history').replaceChildren();
  const historyEvents = [...detail.events];
  const transferEvent = session.ledger.events.find(event => event.eventType === 'transfer-link' &&
    (event.activityId === activity.activityId || event.counterpartyActivityId === activity.activityId));
  if (transferEvent && !historyEvents.some(event => event.eventId === transferEvent.eventId)) historyEvents.push(transferEvent);
  for (const event of historyEvents) {
    const entry = node('article', undefined, 'history-item');
    entry.append(node('strong', label(event.eventType)), node('p', event.recordedAt, 'review-meta'));
    if (event.eventType === 'classification') entry.append(node('p', `${label(event.priorActivityKind)} → ${label(event.activityKind)}`));
    if (event.eventType === 'category-correction') entry.append(node('p', `${event.priorCategoryId || 'No category'} → ${event.categoryId}`));
    if (event.eventType === 'posting-status-correction') entry.append(node('p',
      `${label(event.priorValues.lifecycleStatus)} (${event.priorValues.postedDate || 'no posting date'}) → ${label(event.proposedValues.lifecycleStatus)} (${event.proposedValues.postedDate || 'no posting date'})`));
    if (event.eventType === 'transfer-link') {
      const source = getWorkspaceActivity(session.ledger, event.activityId);
      const target = getWorkspaceActivity(session.ledger, event.counterpartyActivityId);
      entry.append(node('p', `${source?.account.displayName || 'Source account'} → ${target?.account.displayName || 'Destination account'} · ${money(source?.activity.amountText, source?.activity.currency)}`));
    }
    const rationale = event.evidence?.rationale || event.evidence?.reason;
    if (typeof rationale === 'string') entry.append(node('p', rationale));
    entry.append(evidenceDetails('Inspect audit record', () => event));
    $('detail-history').append(entry);
  }
  if (detail.reviewDecisions.length) $('detail-history').append(evidenceDetails('Inspect source review decisions', () => detail.reviewDecisions));
  if (!detail.events.length && !detail.reviewDecisions.length) $('detail-history').append(node('p', 'No corrections recorded.'));
  $('classification').value = ['income', 'spending', 'transfer', 'unclassified'].includes(activity.activityKind) ? activity.activityKind : 'unclassified';
  $('category').value = activity.categoryId || '';
  $('amount').value = activity.amountText || '';
  $('posting-status').value = ['posted', 'pending', 'unknown'].includes(activity.lifecycleStatus) ? activity.lifecycleStatus : 'unknown';
  $('posting-date').value = activity.postedDate || '';
  if (activity.lifecycleStatus === 'unknown') $('correction-type').value = 'posting-status-correction';
  $('correction-rationale').value = '';
  detailEditorBaseline = detailEditorValues();
  correctionFields();
refresh(); if (pages.current === 'activity-detail') $('detail-title').focus();
}
function correctionFields() {
  const type = $('correction-type').value;
  $('classification-field').hidden = type !== 'classification';
  $('category-field').hidden = type !== 'category-correction';
  $('amount-field').hidden = type !== 'bank-correction';
  $('posting-status-field').hidden = type !== 'posting-status-correction';
  const postingDate = type === 'posting-status-correction' && $('posting-status').value === 'posted';
  $('posting-date-field').hidden = !postingDate;
  $('posting-date').required = postingDate;
  refresh();
}
async function previewPosition(destination) {
  if (!confirmReplace()) return;
  const navigationRevision = pages.revision;
  const fixture = await createSyntheticFinancialPosition();
  session.preview(fixture.ledger); $('position-date').value = fixture.asOf; render({reset:true});
  $('month-filter').value = fixture.month; render();
  if (pages.revision === navigationRevision) pages.go(destination);
  announce(destination === 'overview' ? 'Synthetic preview ready. No Google connection or save.' : 'Invented financial-position preview ready. No Drive connection or write.', 'success');
}
action('preview-position', 'Preparing invented balances and reconciliation evidence locally.', () => previewPosition('position'));
action('start-preview', 'Preparing your invented workspace locally.', () => previewPosition('overview'));
action('stage-balance', 'Validating dated balance evidence locally.', async () => {
  const basis = $('balance-basis').value;
  session.recordPosition({type:'balance-snapshot', accountId:$('balance-account').value, effectiveDate:$('balance-date').value, amountText:$('balance-amount').value.trim(), basis, source:{kind:basis === 'statement' ? 'statement' : 'manual', reference:$('balance-source').value.trim()}});
  render(); announce('Dated balance staged. Source evidence is preserved; resolve any same-date conflict before using it. Save changes to persist.', 'success');
});
action('stage-closure', 'Checking closure evidence locally.', async () => {
  const anchor = session.ledger.positionEvents.find(event => event.eventId === $('closure-anchor').value);
  session.recordPosition({type:'account-closure', accountId:anchor.accountId, effectiveDate:anchor.effectiveDate, balanceEventId:anchor.eventId, source:{kind:'manual', reference:$('closure-source').value.trim()}});
  render(); announce('Account closure staged with its evidence. Account history remains intact. Save changes to persist.', 'success');
});
$('closure-form').addEventListener('submit', event => event.preventDefault());
action('stage-reconciliation', 'Checking reconciliation evidence locally.', async () => {
  const statement = statementMethod(), month = $('month-filter').value;
  const command = {type:'reconciliation', accountId:$('reconcile-account').value, month, openingBalanceEventId:$('reconcile-opening').value, closingBalanceEventId:$('reconcile-closing').value, source:{kind:statement ? 'statement' : 'manual', reference:$('reconcile-source').value.trim()}};
  if (statement) {
    command.method = 'statement-components'; command.scope = 'account-total';
    command.components = componentRows.map(row => ({kind:row.fields.kind.value, amountText:row.fields.amountText.value.trim(), source:{kind:'statement',reference:row.fields.reference.value.trim()}}));
    if ($('statement-full-month').checked) { const end = new Date(month + '-01T00:00:00Z'); end.setUTCMonth(end.getUTCMonth()+1); end.setUTCDate(0); command.statementCoverage = {start:month+'-01',end:end.toISOString().slice(0,10)}; }
  }
  session.recordPosition(command);
  $('statement-full-month').checked = false;
  render(); announce('Reconciliation evidence staged. Review the resulting coverage status and any discrepancy below.', 'success');
});
action('stage-account', 'Validating a synthetic account locally.', async () => {
  session.addAccount({displayName:$('new-account-name').value.trim(), institutionId:$('new-account-institution').value, accountType:$('new-account-type').value, currency:$('new-account-currency').value.trim()});
  $('new-account-name').value = '';
  render(); announce('Synthetic account staged. Add dated evidence before using it in financial position.', 'success');
});
$('account-form').addEventListener('submit', event => event.preventDefault());
action('stage-holdings', 'Checking dated holdings locally.', async () => {
  session.recordPosition({type:'holdings-snapshot', accountId:$('holdings-account').value, effectiveDate:$('holdings-date').value, scope:$('holdings-scope').value, source:{kind:'statement',reference:$('holdings-source').value.trim()}, holdings:holdingRows.map(row => ({symbol:row.fields.symbol.value.trim(), assetType:row.fields.assetType.value, quantity:row.fields.quantity.value.trim(), valueText:row.fields.valueText.value.trim()}))});
  render(); announce('Dated holdings staged. Review completeness, balance discrepancy and any conflicts before saving.', 'success');
});
$('holdings-form').addEventListener('submit', event => event.preventDefault());
$('add-holding').addEventListener('click', () => { if (!busy && session.canEdit()) addEditorRow('holding'); });
$('add-component').addEventListener('click', () => { if (!busy && session.canEdit()) addEditorRow('component'); });
$('position-form').addEventListener('submit', event => event.preventDefault());
$('reconciliation-form').addEventListener('submit', event => event.preventDefault());
$('position-date').addEventListener('change', () => { if (!busy && session.ledger) { if (!isCalendarDate($('position-date').value)) { $('position-date').value = renderedPositionDate; announce('Choose a valid position date.', 'error'); return; } render(); } });
for (const id of positionInputs) $(id).addEventListener('input', refresh);
// Evidence belongs to the account it was entered for, not whichever account is selected next.
for (const [id, fields, rows] of [
  ['balance-account', ['balance-date','balance-amount','balance-source'], null],
  ['holdings-account', ['holdings-date','holdings-source'], holdingRows]
]) $(id).addEventListener('change', () => {
  const prior = editorAccounts.get(id), next = $(id).value;
  if (prior && prior !== next && (fields.some(field => $(field).value.trim()) || rows?.length)) {
    if (!window.confirm('Change account and clear this unfinished evidence form? Staged changes will remain unchanged.')) {
      $(id).value = prior; refresh(); return;
    }
    for (const field of fields) $(field).value = '';
    if (rows) { rows.length = 0; $('holdings-rows').replaceChildren(); $('holdings-scope').value = 'partial'; }
  }
  editorAccounts.set(id, next); refresh();
});
function changeReconciliationScope(control, prior) {
  if ($(control).value === prior) return true;
  const hasEvidence = componentRows.length || $('statement-full-month').checked || $('reconcile-source').value.trim();
  if (hasEvidence && !window.confirm('Change reconciliation scope and clear this unfinished statement form? Staged evidence will remain unchanged.')) {
    $(control).value = prior; refresh(); return false;
  }
  $('statement-full-month').checked = false; $('reconcile-source').value = '';
  componentRows.length = 0; $('component-rows').replaceChildren();
  $('reconciliation-form-status').textContent = '';
  return true;
}
$('reconcile-account').addEventListener('change', () => {
  if (!changeReconciliationScope('reconcile-account', editorAccounts.get('reconcile-account'))) return;
  editorAccounts.set('reconcile-account', $('reconcile-account').value);
  populateAnchors(); updateStatementEditor(); refresh();
});
$('month-filter').addEventListener('change', () => {
  if (!changeReconciliationScope('month-filter', view?.scope.month || '')) return;
  updateStatementEditor();
});
action('create-ledger', 'Preparing and saving an invented year to a new empty synthetic folder. Keep this tab open.', async () => {
  const navigationRevision = pages.revision;
  // Reuse an existing preview, including edits, rather than replacing its data.
  if (session.mode !== 'preview') {
    if ((session.dirty || hasUnfinishedDetail() || hasUnfinishedEvidence()) && !window.confirm('Replace your local draft with a new invented year? This discards unsaved corrections in this tab before folder selection. Existing saved folders are unchanged.')) return;
    session.preview(freshYearLedger);
  } else if (!confirmDiscardDetail()) return;
  render({ reset: true });
  await session.savePreviewToNewCopy(); render({ reset: true }); if (pages.revision === navigationRevision) pages.go('overview');
  announce('Synthetic year created in the new folder and independently verified. Use Open saved synthetic year next time.', 'success'); return true;
});
action('open-ledger', 'Opening and verifying your saved synthetic copy. This can take time while retained history is checked.', async () => {
  if (!confirmReplace()) return;
  const navigationRevision = pages.revision;
  await session.open(); render({ reset: true }); if (pages.revision === navigationRevision) pages.go('overview'); announce('Saved canonical records opened and verified. Browse locally; nothing is saved until you choose Save changes.', 'success'); return true;
});
action('preview-year', 'Preparing the invented year locally. No Google connection or Drive write.', async () => {
  if (!confirmReplace()) return;
  const navigationRevision = pages.revision;
  session.preview((await createSyntheticFinancialYear()).ledger); render({ reset: true }); if (pages.revision === navigationRevision) pages.go('overview'); announce('Local synthetic preview ready. Choose Save preview to a new folder to save this preview and any corrections to Drive.', 'success');
});
action('save-preview', 'Saving this exact local preview into a newly selected, empty synthetic Drive folder and independently verifying it. Keep this tab open.', async () => {
  await session.savePreviewToNewCopy(); render({ reset: true }); announce('The exact preview, including all staged corrections, was saved to a new synthetic folder and independently verified.', 'success'); return true;
});
async function saveWorkspaceChanges() {
  const reviewedLedger = session.ledger, lifecycle = storage.lifecycle, folderId = lifecycle?.folderId;
  await session.save();
  if (lifecycle && lifecycle === storage.lifecycle && lifecycle.folderId === folderId) {
    historicalSummaryWorkflow?.adoptVerifiedSave(reviewedLedger,session.ledger);
  }
}
action('save-ledger', 'Saving changes and independently verifying the saved records. Keep this tab open.', async () => {
  await saveWorkspaceChanges(); render(); announce('Changes saved and independently verified. You can keep browsing or close the storage session.', 'success'); return true;
});
function recoveryMessage() {
  return ({checking:'Checking what reached Drive. Your draft remains in this tab; keep it open.',saved:'Your draft was found saved and verified. No retry is needed.', 'not-saved':'The save was conclusively not published. Your draft is preserved. Retry only with the explicit confirmation below.',different:'Drive contains different saved records. Your draft is preserved. Do not retry blindly; review the saved copy first.',unverifiable:'The save outcome could not be verified. Your draft is preserved. Recheck when connected; do not retry blindly.'})[session.recoveryOutcome] || 'Save unverified. Your draft remains in this tab. Verify the save outcome before retrying.';
}
async function downloadBackup({excludeStaged=false,saveFirst=false}={}) {
  try {
    const encrypted=$('backup-encrypt').checked, password=encrypted?$('backup-password').value:undefined;
    if (encrypted && !password) fail('backup-password-required');
    if (encrypted && password !== $('backup-password-confirm').value) fail('backup-password-mismatch');
    if (!encrypted && !window.confirm('Download an unencrypted backup? This file contains readable synthetic financial data. Keep it private.')) { announce('Backup cancelled. No file was downloaded.'); return; }
    if (saveFirst) await saveWorkspaceChanges();
    const bytes=await session.exportBackup({password,excludeStaged});
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));
    const link=node('a');link.href=url;link.download='finance-tracker-synthetic-backup.json';
    document.body.append(link);
    try {link.click();} finally {link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    announce('Backup download requested. Check your downloads and keep the file safe.'+(excludeStaged?' Staged changes were excluded; your draft is unchanged.':''),'success');return true;
  } finally {$('backup-password').value='';$('backup-password-confirm').value='';}
}
$('backup-encrypt').addEventListener('change',()=>{if (!$('backup-encrypt').checked) {$('backup-password').value='';$('backup-password-confirm').value='';}refresh();});
$('backup-file').addEventListener('change',()=>{refresh();});
action('export-backup','Verifying the saved copy and preparing a local backup.',()=>downloadBackup());
action('backup-saved-only','Verifying the saved copy. Staged changes will be excluded.',()=>downloadBackup({excludeStaged:true}));
action('backup-save-first','Saving changes before preparing a verified backup. Keep this tab open.',()=>downloadBackup({saveFirst:true}));
action('stage-backup','Checking the local backup. No folder is selected or written.',async()=>{
  try {
    if (!confirmReplace('Replace this tab’s local draft with the validated backup preview? Unsaved edits will be discarded only after validation succeeds. Saved folders will not change.')) return;
    const file=$('backup-file').files?.[0];if (!file) return;
    if (!Number.isSafeInteger(file.size)||file.size<1||file.size>FULL_SNAPSHOT_BACKUP_LIMITS.archiveBytes) fail('byte-limit');
    const bytes=new Uint8Array(await file.arrayBuffer());
    await session.importBackup(bytes,{password:$('restore-password').value || undefined});
    $('backup-file').value='';render({reset:true});
    announce('Backup validated and staged locally. Review the preview, then choose Restore backup to new empty folder. No Drive write has occurred.','success');return true;
  } finally {$('restore-password').value='';}
});
action('restore-backup','Restoring the validated preview to a new empty synthetic folder and verifying it. Keep this tab open.',async()=>{
  if (!confirmDiscardDetail()) return;
  await session.restoreBackupToNewCopy();render({reset:true});announce('Backup restored to a new synthetic copy and independently verified. The original folder was not changed.','success');return true;
});
action('verify-save-outcome','Checking what reached Drive. Your draft stays in this tab.',async()=>{
  await session.resolveUncertainSave();render();announce(recoveryMessage(),session.recoveryOutcome==='saved'?'success':'info');
});
action('retry-save','Preparing an explicitly confirmed retry of the verified unsaved draft.',async()=>{
  if (!window.confirm('Drive verification found that this draft was not saved. Retry saving this exact draft now?')) {announce('Retry cancelled. Your draft is unchanged.');return;}
  await session.retryUncertainSave({confirm:true});render();announce(recoveryMessage(),session.recoveryOutcome==='saved'?'success':'info');
});
action('reopen-ledger', 'Reopening and verifying saved records. No new financial commit is made.', async () => {
  if (!confirmReplace()) return;
  await session.reopen(); render({ reset: true }); announce('Saved records reopened and verified.', 'success'); return true;
});
$('draft-storage-link').addEventListener('click', () => { if (!$('draft-storage-link').disabled) pages.go('storage'); });
action('release-ledger', 'Closing and verifying the storage session.', async () => {
  if ((session.dirty || hasUnfinishedDetail() || hasUnfinishedEvidence()) && !window.confirm('Close the storage session without saving? After verified closure, loaded records and unsaved edits will be cleared from this tab. Saved Drive records are unchanged.')) { announce('Release cancelled. Your local draft and session are unchanged.'); return; }
  await session.release(); clearLoadedWorkspace(); announce('Storage session closed and verified. Loaded records, unsaved edits and this tab’s access token were cleared. This does not erase browser or device traces.', 'success');
});
action('recover-ledger', 'Recovering the interrupted transaction. Your local draft stays in this tab.', async () => {
  await session.recover(); announce('Recovery finished. Reopen saved records to verify what was saved before making another change.');
});
action('recover-stale', 'Checking stale-session recovery.', async () => {
  if (!window.confirm('Confirm every prior tab and device using this synthetic folder has stopped. Recover this stale session?')) { announce('Recovery cancelled. The stopped session has not been recovered.'); return; }
  await session.recover({ stale: true }); announce('Session recovered. Reopen saved records before editing.');
});
action('link-transfer', 'Recording and validating this transfer relationship locally.', async () => {
  session.linkTransfer({ outgoingActivityId: selectedActivity, counterpartyActivityId: $('transfer-counterparty').value, rationale: $('transfer-link-rationale').value });
  render(); showDetail(selectedActivity);
  announce('Transfer activities linked with an auditable relationship. Save changes to persist the link.', 'success');
});
action('undo-last-change', 'Reverting the most recent staged change locally. No Drive write.', async () => {
  session.undoLastStagedChange(); render();
  if (selectedActivity && getWorkspaceActivity(session.ledger, selectedActivity)) showDetail(selectedActivity, {navigate:false});
  announce('Most recent staged change reverted. No saved records were changed.', 'success');
});
action('revert-all-changes', 'Reverting all staged changes to the last verified baseline. No Drive write.', async () => {
  if (!window.confirm('Discard all staged changes and return to the last verified saved year or original preview? Saved records will not change.')) {
    announce('Revert cancelled. Your staged changes are unchanged.'); return;
  }
  session.revertAllStagedChanges(); render();
  if (selectedActivity && getWorkspaceActivity(session.ledger, selectedActivity)) showDetail(selectedActivity, {navigate:false});
  announce('All staged changes reverted to the last verified baseline. No saved records were changed.', 'success');
});
action('stage-correction', 'Checking your correction locally.', async () => {
  session.correct({ activityId: selectedActivity, type: $('correction-type').value, activityKind: $('classification').value, categoryId: $('category').value, amountText: $('amount').value,
    lifecycleStatus: $('posting-status').value, postedDate: $('posting-status').value === 'posted' ? $('posting-date').value : null, rationale: $('correction-rationale').value });
  render(); showDetail(selectedActivity);
  announce(session.mode === 'preview' ? 'Correction added to this local preview only. Source evidence is unchanged.' : 'Correction staged locally. Source evidence is unchanged. Choose Save changes to persist it.', 'success');
});
$('correction-form').addEventListener('submit', event => event.preventDefault());
$('close-detail').addEventListener('click', () => {
  if (busy || !confirmDiscardDetail()) return;
  pages.closeDetail();
  if (pages.current === 'transactions') (reviewButtons.get(selectedActivity) || $('transaction-search')).focus();
  else if (pages.current === 'overview') (homeButtons.get(selectedActivity) || $('page-title')).focus();
  else $('page-title').focus();
  selectedActivity = null; detailEditorBaseline = null; refresh();
});
$('correction-type').addEventListener('change', correctionFields);
$('posting-status').addEventListener('change', correctionFields);
$('posting-date').addEventListener('input', refresh);
$('correction-rationale').addEventListener('input', refresh);
$('transfer-counterparty').addEventListener('change', refresh);
$('transfer-link-rationale').addEventListener('input', refresh);
for (const id of ['account-filter', 'month-filter', 'review-only']) $(id).addEventListener('change', () => { if (!busy) { page = 0; render(); } });
$('transaction-search').addEventListener('input', scheduleSearch);
$('transaction-search').addEventListener('compositionstart', () => { composingSearch = true; cancelSearch(); });
$('transaction-search').addEventListener('compositionend', () => { composingSearch = false; scheduleSearch(); });
$('previous-page').addEventListener('click', () => { if (!busy && page > 0) { page--; render(); } });
$('next-page').addEventListener('click', () => { if (!busy && view && page + 1 < view.pages) { page++; render(); } });
window.addEventListener('beforeunload', event => { if (busy || session.dirty || hasUnfinishedDetail() || hasUnfinishedEvidence()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('offline', () => { providerImportWorkflow?.reset(); historicalSummaryWorkflow?.reset(); session.invalidate(); refresh(); announce('Offline. Loaded records remain visible; saved-copy edits and saves are blocked. Reconnect and reopen after returning online.'); });
window.addEventListener('online', refresh);
providerImportWorkflow = mountProviderImportWorkflow({
  root: $('provider-import-workflow'),
  getLedger: () => session.ledger,
  canStage: () => !busy && session.canEdit(),
  getUnavailableReason: () => {
    if (busy || session.busy) return 'Wait for the current workspace or storage action to finish.';
    if (!session.ledger) return 'Open or create a synthetic ledger before staging an import.';
    if (navigator.onLine === false) return 'Reconnect before staging changes to a saved ledger.';
    if (session.needsReopen) return 'Reopen the saved ledger before staging another import.';
    if (session.unverified) return 'Verify or recover the saved ledger before staging an import.';
    if (!session.canEdit()) return 'The current workspace session is read-only. Reopen or recover it before staging.';
    return null;
  },
  stageImport: proposal => session.stageCanonicalImport(proposal),
  onStaged: () => {
    render();
    refresh();
    announce('Supported CSV import staged locally. Review unresolved rows, then use the workspace explicit save action when ready.', 'success');
  }
});
historicalSummaryWorkflow = mountHistoricalMonthlySummaryWorkflow({
  root: $('historical-summary-workflow'),
  getLedger: () => session.ledger,
  isActive: () => pages.current === 'storage',
  getUnavailableReason: () => {
    if (busy || session.busy) return 'Wait for the current workspace or storage action to finish.';
    if (!session.ledger) return 'Open or create a synthetic ledger before staging history.';
    if (session.unverified) return 'Verify the save outcome before staging history.';
    if (session.needsReopen) return 'Reconnect and reopen the verified ledger before staging history.';
    if (!session.canEdit()) return 'This ledger is read-only. Reopen it before staging history.';
    return null;
  },
  stageSummaries: proposal => session.stageHistoricalSummaries(proposal),
  stageReconciliation: proposal => session.stageHistoricalReconciliation(proposal),
  onStaged: message => { render(); refresh(); announce(message,'success'); }
});
refresh();
// Prepare only invented data ahead of the click so OAuth starts within the
// user's create-button gesture, without awaiting fixture generation first.
createSyntheticFinancialYear().then(recipe => { freshYearLedger = recipe.ledger; refresh(); }).catch(error => {
  $('connection-status').textContent = showDiagnostic(error, {surface: 'workspace', target: $('connection-status'), page: pages.current});
});
storage.prepare().then(() => { configured = true; refresh(); }).catch(error => {
  configured = false;
  $('connection-status').textContent = showDiagnostic(error, {surface: 'workspace', target: $('connection-status'), page: pages.current});
  refresh();
});
correctionFields(); refresh();
