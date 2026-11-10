import { createSyntheticFinancialPosition } from './synthetic-financial-position.mjs';
import { DashboardSyntheticStorage } from './dashboard-synthetic-storage.mjs';
import { CanonicalWorkspaceSession } from './canonical-workspace-session.mjs';
import { createWorkspaceViewReader, getWorkspaceActivity } from './canonical-workspace-model.mjs';
import { getEffectiveActivities } from './canonical-import.mjs';
import { exactSignedDecimal, isCalendarDate } from './import-reconciliation.mjs';
import { createSyntheticFinancialYear } from './synthetic-financial-year.mjs';
import { googleStartupMessage } from './google-startup-diagnostics.mjs';

const $ = id => document.getElementById(id);
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
let busy = false, configured = false, page = 0, selectedActivity = null, view = null, operationStarted = null;
let viewLedger = null, viewReader = null, searchTimer = null, composingSearch = false;
const reviewButtons = new Map();
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
  maintainOriginals: false,
  onStatus(status) {
    if (status.state !== 'ready') session.invalidate();
    $('connection-status').textContent = status.state === 'ready'
      ? 'Connected to a synthetic copy. Opening and saves verify its canonical records.'
      : `Storage: ${label(status.state)}. ${status.state === 'disconnected' ? 'No active session.' : 'Follow the available connection or recovery action.'}`;
    refresh();
  }
});
const session = new CanonicalWorkspaceSession({ storage });
const messages = {
  'canonical-ledger-required': 'This copy has no saved canonical ledger. Release it, seed a synthetic year in a new empty folder, then open that saved copy here.',
  'deprecated-canonical-layout': 'This standalone grouped version-2 copy is no longer supported. It was not initialized or modified. Preserve it and create a new synthetic copy using fragmented version 3.',
  'existing-copy-required': 'Choose the folder where you already saved the synthetic year. This workspace does not initialize empty folders.',
  'correction-rationale-required': 'Explain the evidence or reason for this correction.',
  'classification-amount-conflict': 'That classification conflicts with the amount. Income must not be negative and spending must not be positive.',
  'category-required': 'Enter a category for this transaction.',
  'invalid-amount': 'Enter an exact decimal amount, for example -125.50.',
  'reopen-before-editing': 'Reopen verified saved records before editing. Your local changes have not been discarded.',
  'authorization-cancelled': 'Google authorization was cancelled. No saved records were replaced.',
  'picker-cancelled': 'Folder selection was cancelled. No saved records were replaced.',
  'synthetic-folder-required': 'Choose an existing invented-data folder with “synthetic” in its name. No saved records were replaced.',
  'base-conflict': 'The saved copy changed. Reopen verified records before deciding what to retry.',
  'transaction-unresolved': 'The save result is uncertain. Recover if offered, then reopen saved records before retrying.',
  'reconnect-required': 'The connection could not be verified. Reconnect and reopen saved records before editing.',
  'verified-draft-required': 'There is no verified draft eligible for saving. Reopen saved records before editing.',
  'verified-preview-required': 'Load a local synthetic preview with no active Drive session before saving it to a new folder.',
  'new-empty-folder-required': 'The selected folder did not pass fresh-copy admission. No existing copy was changed; choose a newly created empty synthetic folder.',
  'seed-readback-mismatch': 'The new copy could not be independently verified. Keep this tab open, recover if offered, then reopen before deciding what to do next.',
  'transfer-link-rationale-required': 'Explain why these two activities represent the same transfer.',
  'invalid-transfer-link': 'These activities cannot be linked. Confirm that both are active transfers in different accounts, with equal opposite amounts in the same currency, and that neither is already linked.',
  'invalid-holding': 'Each holding needs a unique identifier, type, nonnegative exact quantity and value.',
  'invalid-reconciliation-component': 'Each component needs a supported movement kind, signed exact amount and statement reference.',
  'invalid-position-statement-coverage': 'Complete statement coverage must match the selected full month and account scope.',
  'invalid-position-amount': 'Enter an exact decimal balance without a currency symbol or separators.',
  'invalid-position-money': 'Enter an exact decimal amount without currency symbols or separators.',
  'negative-holding-value': 'Enter a nonnegative statement value for each holding. Short positions are not supported.',
  'invalid-position-month': 'Choose a calendar month before recording reconciliation evidence.',
  'closure-requires-selected-zero-balance': 'Choose a zero balance for this account on its closure date.',
  'invalid-statement-coverage': 'The complete statement declaration must match the selected account and calendar month.',
  'reconciliation-requires-selected-anchors': 'Resolve conflicting balances first, then choose the selected opening and closing evidence.',
  'invalid-account': 'Enter an invented account name, a listed institution and account type, and a three-letter uppercase currency.',
  'invalid-position-date': 'Choose a valid effective date.',
  'invalid-reconciliation-anchors': 'Choose the previous month-end opening balance and selected month-end closing balance for this account.',
  'invalid-position-source': 'Add a source evidence reference.',
  'liability-balance-must-be-positive': 'Enter a nonnegative amount owed for this liability, without a minus sign.',
  'release-unconfirmed': 'Release was not verified. Keep this copy selected and resolve its session before switching devices.'
};
function announce(text, kind = 'info') {
  $('action-status').textContent = text; $('action-status').dataset.kind = kind;
  if (activeFormStatus) {
    const status = $(activeFormStatus); status.textContent = text; status.dataset.kind = kind;
    if (kind === 'error') status.focus();
  }
}
function refresh() {
  const lifecycle = storage.lifecycle;
  const ready = session.ready(), editable = !busy && session.canEdit();
  $('open-ledger').disabled = busy || !configured || navigator.onLine === false;
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
  $('save-preview').disabled = busy || !configured || navigator.onLine === false || session.mode !== 'preview' || !session.ledger || Boolean(lifecycle) || session.unverified;
  $('save-preview').textContent = session.mode === 'preview' ? 'Save this preview to a new folder' : 'Save this preview to a new folder';
  $('save-ledger').disabled = busy || !session.canSave();
  $('undo-last-change').disabled = busy || !session.canUndo();
  $('revert-all-changes').disabled = busy || !session.canRevertAll();
  $('link-transfer').disabled = busy || !editable || !selectedActivity || !$('transfer-counterparty').value || !$('transfer-link-rationale').value.trim();
  $('reopen-ledger').disabled = busy || !ready;
  $('release-ledger').disabled = busy || !lifecycle;
  $('recover-ledger').hidden = lifecycle?.state !== 'recovery-required';
  $('recover-ledger').disabled = busy || navigator.onLine === false || lifecycle?.state !== 'recovery-required' || !lifecycle?.coordinator?.canWrite;
  $('recover-stale').hidden = lifecycle?.state !== 'stale-session';
  $('recover-stale').disabled = busy || navigator.onLine === false || lifecycle?.state !== 'stale-session';
  $('close-detail').disabled = busy;
  for (const button of reviewButtons.values()) button.disabled = busy;
  if (reviewQueueButton) reviewQueueButton.disabled = busy;
  $('transactions').setAttribute('aria-busy', String(busy));
  for (const id of ['account-filter', 'month-filter', 'transaction-search', 'review-only']) $(id).disabled = busy || !session.ledger;
  for (const id of ['correction-type', 'classification', 'category', 'amount', 'correction-rationale', 'transfer-counterparty', 'transfer-link-rationale']) $(id).disabled = !editable;
  $('stage-correction').disabled = !editable || !selectedActivity || !$('correction-rationale').value.trim();
  $('previous-page').disabled = busy || !view || view.page === 0;
  $('next-page').disabled = busy || !view || view.page + 1 >= view.pages;
  const timing = $('operation-timing');
  if (timing) timing.textContent = operationStarted ? `${Math.floor((Date.now() - operationStarted) / 1000)}s elapsed` : '';
  let text;
  if (busy) text = 'Working and verifying. Keep this tab open.';
  else if (session.unverified) text = 'Save unverified. Keep your draft here. Recover if offered, then reopen to check what reached Drive before retrying.';
  else if (session.mode === 'preview') text = session.dirty ? 'Staged local preview changes. Save this preview to a new empty synthetic folder when ready.' : 'Local preview only. Save this preview to a new empty synthetic folder when ready.';
  else if (session.dirty) text = `${session.stagedHistory.length} staged change(s). ${session.canSave() ? 'Save when you are ready.' : 'Saving is blocked. Reconnect and reopen before continuing.'}`;
  else if (session.needsReopen) text = 'Read-only last loaded records. Reconnect or reopen before editing.';
  else text = session.ledger ? 'All changes saved and verified.' : 'No ledger loaded. Open your saved year or try a local preview.';
  if ($('save-state').textContent !== text) $('save-state').textContent = text;
  $('save-state').dataset.state = session.unverified ? 'unverified' : session.dirty ? 'dirty' : busy ? 'busy' : 'clean';
  $('data-mode').dataset.mode = session.mode;
  $('data-mode').textContent = session.mode === 'preview' ? 'Synthetic local preview' : session.ledger ? (session.needsReopen ? 'Synthetic · read-only' : 'Synthetic saved copy') : 'Synthetic workspace';
}
async function run(message, operation, formStatus = null) {
  if (busy) return;
  // Apply a queued query before an action so cancellation leaves rows and input aligned.
  if (searchTimer !== null) { cancelSearch(); page = 0; render(); }
  activeFormStatus = formStatus;
  busy = true; operationStarted = Date.now(); refresh(); announce(message);
  const timer = setInterval(refresh, 1000);
  try { await operation(); }
  catch (error) {
    const candidate = error?.code || (error instanceof TypeError ? error.message : '');
    // Provider details and arbitrary codes are not safe user-facing diagnostics.
    const message = Object.hasOwn(messages, candidate) ? messages[candidate] : 'Action did not complete. Check the connection and available recovery actions.';
    announce(message + (session.dirty ? ' Your staged changes remain in this tab.' : ''), 'error');
  } finally { clearInterval(timer); busy = false; operationStarted = null; refresh(); activeFormStatus = null; }
}
const formStatuses = { 'stage-account':'account-form-status', 'stage-balance':'position-form-status', 'stage-closure':'closure-form-status', 'stage-holdings':'holdings-form-status', 'stage-reconciliation':'reconciliation-form-status' };
const action = (id, message, callback) => $(id).addEventListener('click', () => {
  if (!$(id).disabled) return run(message, callback, formStatuses[id]);
});
function confirmReplace() {
  if (!session.dirty || window.confirm('Replace your local draft with verified saved records? Unsaved corrections will be discarded only after the saved records open successfully. An unverified save may already be on Drive.')) return true;
  announce('Action cancelled. Your local draft is unchanged.');
  return false;
}
function addOptions(select, options, selected, first) {
  select.replaceChildren();
  for (const [value, text] of [['', first], ...options]) { const option = node('option', text); option.value = value; select.append(option); }
  select.value = options.some(([value]) => value === selected) ? selected : '';
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
    page = 0; selectedActivity = null; $('transaction-search').value = ''; $('review-only').checked = false; $('account-filter').value = ''; $('month-filter').value = ''; $('activity-detail').hidden = true; }
  if (viewLedger !== session.ledger) {
    const reader = createWorkspaceViewReader(session.ledger);
    viewReader = reader; viewLedger = session.ledger;
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
  $('coverage-summary').textContent = `${view.coverage.importCount} import runs. Latest source activity: ${view.coverage.latestActivityDate || 'unavailable'}. Imported dates alone do not prove complete history. Inspect account-month reconciliation below.`;
  $('transaction-count').textContent = String(view.totalCount);
  $('filter-count').textContent = `${view.filteredCount} matching activities of ${view.totalCount} in this account and period. Search and review filters do not change totals.`;
  reviewButtons.clear();
  $('transaction-rows').replaceChildren();
  for (const row of view.rows) {
    const tr = node('tr'), description = node('td');
    description.append(node('strong', row.sourceDescription), node('small', row.accountName, 'transaction-detail'));
    const classification = node('td');
    classification.append(node('span', label(row.activityKind), 'classification-badge'), node('small', row.categoryId || 'No category', 'transaction-detail'));
    if (row.needsReview) classification.append(node('small', 'Needs review: ' + row.reviewReasons.map(reviewReason).join(', '), 'transaction-detail'));
    const inspect = node('button', 'Review', 'text-button'); inspect.type = 'button'; inspect.setAttribute('aria-label', `Review ${row.sourceDescription} on ${row.reportingDate || 'unknown date'}`);
    reviewButtons.set(row.activityId, inspect);
    inspect.setAttribute('aria-controls', 'activity-detail');
    inspect.addEventListener('click', () => { if (!busy) showDetail(row.activityId); });
    const actionCell = node('td'); actionCell.append(inspect);
    tr.append(node('td', row.reportingDate || 'Unknown date'), description, classification, node('td', money(row.amountText, row.currency)), actionCell);
    $('transaction-rows').append(tr);
  }
  $('empty-state').hidden = view.filteredCount > 0;
  if (!view.filteredCount) $('empty-state').textContent = 'No activities match this selection. Change the account, month or search to see other records.';
  $('transaction-table-wrap').hidden = !view.filteredCount;
  $('page-status').textContent = `Page ${view.page + 1} of ${view.pages}`;
  $('review-summary').textContent = `${view.review.activityCount} activities need review in this account and period. ${view.review.sourceCount} source observations await a decision. Unknown investment activity remains excluded from known totals.`;
  reviewQueueButton = null;
  $('review-queue').replaceChildren();
  if (view.review.activityCount) {
    const reviewButton = node('button', `Show ${view.review.activityCount} activities needing review`);
    reviewButton.type = 'button'; reviewQueueButton = reviewButton;
    reviewButton.addEventListener('click', () => {
      if (busy) return;
      $('review-only').checked = true; $('transaction-search').value = ''; page = 0; render();
      $('transaction-search').focus();
    });
    $('review-queue').append(reviewButton);
  }
  if (view.review.sourceCount) $('review-queue').append(node('p', `Showing ${Math.min(10, view.review.sourceCount)} of ${view.review.sourceCount} unresolved source observations in this account and period. Search does not filter this queue. Open the advanced import workbench for the full queue.`));
  for (const observation of view.sourceReviews.slice(0, 10)) {
    const item = node('article', undefined, 'review-item');
    item.append(node('h3', observation.sourceDescription || 'Unresolved source observation', 'review-title'), node('p', `${observation.accountName || ''} · ${label(observation.reasonCode)}`, 'review-meta'));
    $('review-queue').append(item);
  }
  if (view.review.sourceCount) $('review-queue').append(node('p', 'Source matching, rejection and reversal are available in the advanced import workbench. Save and release this session before opening that tool.'));
  renderPosition();
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
      });
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
  $('position-accounts').replaceChildren(); positionButtons.length = 0;
  for (const account of position.accounts) {
    const card = node('article', undefined, 'review-item');
    card.append(node('h3', account.displayName), node('p', `${label(account.role)} · ${money(account.balance, account.currency)} · ${label(account.status)}`), node('p', `Balance date: ${account.balanceDate || 'unavailable'} · Basis: ${account.basis || 'unavailable'} · Source: ${account.source?.reference || 'unavailable'}`), node('p', `${account.stale ? 'Stale evidence. ' : ''}${account.reasons.map(label).join('; ')}`));
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
          });
        });
        card.append(button);
      }
    }
    if (['brokerage', 'retirement'].includes(account.accountType)) card.append(node('p', account.holdings ? 'Dated holdings evidence available. No live prices or performance calculation.' : 'No supported dated holdings evidence. Transaction rows are not holdings.'));
    if (account.holdings) card.append(node('p', `Holdings date: ${account.holdings.effectiveDate} · ${account.holdings.scope} · ${account.holdings.stale ? 'Stale. ' : ''}${account.holdings.reasons.map(label).join('; ')}`), evidenceDetails('Inspect dated holdings and valuation', () => account.holdings));
    resolveHoldings(card, account);
    $('position-accounts').append(card);
  }
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
function showDetail(activityId) {
  const detail = getWorkspaceActivity(session.ledger, activityId);
  if (!detail) return;
  selectedActivity = activityId;
  const activity = detail.activity;
  $('activity-detail').hidden = false;
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
  $('correction-rationale').value = '';
  correctionFields(); refresh(); $('detail-title').focus();
}
function correctionFields() {
  const type = $('correction-type').value;
  $('classification-field').hidden = type !== 'classification';
  $('category-field').hidden = type !== 'category-correction';
  $('amount-field').hidden = type !== 'bank-correction';
}
action('preview-position', 'Preparing invented balances and reconciliation evidence locally.', async () => {
  if (!confirmReplace()) return;
  const fixture = await createSyntheticFinancialPosition();
  session.preview(fixture.ledger); $('position-date').value = fixture.asOf; render({reset:true});
  $('month-filter').value = fixture.month; render();
  announce('Invented financial-position preview ready. No Drive connection or write.', 'success');
});
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
action('open-ledger', 'Opening and verifying your saved synthetic copy. This can take time while retained history is checked.', async () => {
  if (!confirmReplace()) return;
  await session.open(); render({ reset: true }); announce('Saved canonical records opened and verified. Browse locally; nothing is saved until you choose Save changes.', 'success');
});
action('preview-year', 'Preparing the invented year locally. No Google connection or Drive write.', async () => {
  if (!confirmReplace()) return;
  session.preview((await createSyntheticFinancialYear()).ledger); render({ reset: true }); announce('Local synthetic preview ready. Open your saved copy to save corrections to Drive.', 'success');
});
action('save-preview', 'Saving this exact local preview into a newly selected, empty synthetic Drive folder and independently verifying it. Keep this tab open.', async () => {
  await session.savePreviewToNewCopy(); render({ reset: true }); announce('The exact preview, including all staged corrections, was saved to a new synthetic folder and independently verified.', 'success');
});
action('save-ledger', 'Saving changes and independently verifying the saved records. Keep this tab open.', async () => {
  await session.save(); render(); announce('Changes saved and independently verified. You can keep browsing or close the storage session.', 'success');
});
action('reopen-ledger', 'Reopening and verifying saved records. No new financial commit is made.', async () => {
  if (!confirmReplace()) return;
  await session.reopen(); render({ reset: true }); announce('Saved records reopened and verified.', 'success');
});
action('release-ledger', 'Closing and verifying the storage session.', async () => {
  if (session.dirty && !window.confirm('Close the storage session without saving? Your draft stays in this tab only. Reconnecting will require reopening saved records.')) { announce('Release cancelled. Your local draft and session are unchanged.'); return; }
  await session.release(); announce('Storage session closed and verified. The last loaded records remain read-only in this tab.', 'success');
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
  if (selectedActivity && getWorkspaceActivity(session.ledger, selectedActivity)) showDetail(selectedActivity);
  announce('Most recent staged change reverted. No saved records were changed.', 'success');
});
action('revert-all-changes', 'Reverting all staged changes to the last verified baseline. No Drive write.', async () => {
  if (!window.confirm('Discard all staged changes and return to the last verified saved year or original preview? Saved records will not change.')) {
    announce('Revert cancelled. Your staged changes are unchanged.'); return;
  }
  session.revertAllStagedChanges(); render();
  if (selectedActivity && getWorkspaceActivity(session.ledger, selectedActivity)) showDetail(selectedActivity);
  announce('All staged changes reverted to the last verified baseline. No saved records were changed.', 'success');
});
action('stage-correction', 'Checking your correction locally.', async () => {
  session.correct({ activityId: selectedActivity, type: $('correction-type').value, activityKind: $('classification').value, categoryId: $('category').value, amountText: $('amount').value, rationale: $('correction-rationale').value });
  render(); showDetail(selectedActivity);
  announce(session.mode === 'preview' ? 'Correction added to this local preview only. Source evidence is unchanged.' : 'Correction staged locally. Source evidence is unchanged. Choose Save changes to persist it.', 'success');
});
$('correction-form').addEventListener('submit', event => event.preventDefault());
$('close-detail').addEventListener('click', () => {
  if (busy) return;
  $('activity-detail').hidden = true;
  (reviewButtons.get(selectedActivity) || $('transaction-search')).focus();
  selectedActivity = null; refresh();
});
$('correction-type').addEventListener('change', correctionFields);
$('correction-rationale').addEventListener('input', refresh);
$('transfer-counterparty').addEventListener('change', refresh);
$('transfer-link-rationale').addEventListener('input', refresh);
for (const id of ['account-filter', 'month-filter', 'review-only']) $(id).addEventListener('change', () => { if (!busy) { page = 0; render(); } });
$('transaction-search').addEventListener('input', scheduleSearch);
$('transaction-search').addEventListener('compositionstart', () => { composingSearch = true; cancelSearch(); });
$('transaction-search').addEventListener('compositionend', () => { composingSearch = false; scheduleSearch(); });
$('previous-page').addEventListener('click', () => { if (!busy && page > 0) { page--; render(); } });
$('next-page').addEventListener('click', () => { if (!busy && view && page + 1 < view.pages) { page++; render(); } });
window.addEventListener('beforeunload', event => { if (busy || session.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('offline', () => { session.invalidate(); refresh(); announce('Offline. Loaded records remain visible; saved-copy edits and saves are blocked. Reconnect and reopen after returning online.'); });
window.addEventListener('online', refresh);
refresh();
storage.prepare().then(() => { configured = true; refresh(); }).catch(error => {
  configured = false;
  $('connection-status').textContent = googleStartupMessage(error);
  refresh();
});
correctionFields(); refresh();
