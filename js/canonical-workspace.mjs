import { FULL_SNAPSHOT_BACKUP_LIMITS } from './full-snapshot-backup.mjs';
import { fail } from './app-error.mjs';
import {successfulActionSummary} from './success-metrics.mjs';
import { createWorkspacePages } from './workspace-pages.mjs';
import { createSyntheticFinancialPosition } from './synthetic-financial-position.mjs';
import { DashboardSyntheticStorage } from './dashboard-synthetic-storage.mjs';
import { CanonicalWorkspaceSession } from './canonical-workspace-session.mjs';
import { createWorkspaceViewReader, getWorkspaceActivity, transferCandidates } from './canonical-workspace-model.mjs';
import { categoryCatalog } from './category-catalog.mjs';
import { ruleCatalog } from './rule-catalog.mjs';
import { ruleTargets } from './rule-records.mjs';
import { getEffectiveActivities, createLedger } from './canonical-import.mjs';
import { RELEASE_PROFILE } from './release-profile.mjs';
import { exactSignedDecimal, isCalendarDate } from './import-reconciliation.mjs';
import { createSyntheticFinancialYear } from './synthetic-financial-year.mjs';
import { showDiagnostic, clearDiagnostic } from './app-diagnostics.mjs';
import { leaveBreadcrumb, registerContextProvider, recentReports } from './error-reporting.mjs';
import { installDiagnosticSelfTest } from './diagnostic-selftest.mjs';
import { mountProviderImportWorkflow } from './provider-csv-import-workflow.mjs';
import { mountHistoricalMonthlySummaryWorkflow } from './historical-monthly-summary-workflow.mjs';
import { mountHomeDashboard } from './home-dashboard.mjs';
import { mountPlanning } from './planning-page.mjs';
import { currentMonth, isMonthPeriod, periodKind, stepPeriod } from './home-period-report.mjs';
import { buildCoverageHistory, balanceObservations, institutionCoverage, mostUrgentMonth, monthEnd } from './account-history.mjs';
import { INSTITUTIONS, ACCOUNT_TYPES, COVERAGE_STATES, COVERAGE_REASONS, POSITION_REASONS, freshness, coverageCounts, miniStrip, coverageStrip, markSelected, observationPlot, markColumn, stripLabels, dateLabel, dayLabel, monthLong } from './accounts-view.mjs';

const $ = id => document.getElementById(id);
let providerImportWorkflow = null, historicalSummaryWorkflow = null, planningPage = null;
let sourceReviewPage = 0, sourceReviewScope = null;
const sourceReviewUpdates = [];
// Accounts selection state. Declared before the router because a #holdings link can
// arrive during router construction, before anything is open.
let selectedAccountId = null, selectedCoverageMonth = null, coverageHistory = null, positionReport = null, positionGeneration = 0, paneKey = null;
// A navigation request for an account kind that applies once accounts are rendered.
let pendingAccountIntent = null;
const accountRows = new Map();
const narrowAccounts = () => window.matchMedia?.('(max-width: 999px)')?.matches === true;
const INVESTMENT = ['brokerage', 'retirement'];
const firstInvestment = report => report?.accounts.find(account => INVESTMENT.includes(account.accountType)) ?? null;
const pages = createWorkspacePages({document, window, onAlias: name => {
  // #holdings opens the first investment account in scope, where holdings now live.
  // With nothing rendered yet, the request waits for renderPosition; it never
  // reads controller state that does not exist.
  if (name === 'holdings') {
    if (!positionReport) { pendingAccountIntent = 'investment'; return; }
    const investment = firstInvestment(positionReport);
    if (investment) selectAccount(investment.accountId);
    return;
  }
  // #review is the Needs review view of Activity. Apply it once the controller is ready.
  $('review-only').checked = true;
  Promise.resolve().then(() => { if (session?.ledger && !busy) { listLimit = PAGE_ROWS; render(); } });
}, onNavigate: page => { leaveBreadcrumb({e:'page.view', page}); if ($('action-status').dataset.kind !== 'error') $('action-status').textContent = ''; if (page !== 'import') providerImportWorkflow?.reset(); historicalSummaryWorkflow?.refresh(); if (page === 'planning') planningPage?.activate(); }});
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const label = text => String(text || 'Unknown').replaceAll('-', ' ');
const reviewReason = reason => ({ 'classification-amount-conflict': 'Amount and classification disagree', 'unknown-amount': 'Amount unavailable', 'unmatched-refund': 'Refund needs a category or original purchase', 'unknown-lifecycle': 'Posting status unknown', 'unclassified-activity': 'Not classified', 'missing-refund-posted-date': 'Refund posting date unknown', 'deleted-category': 'Category was deleted', 'transfer-account-missing': 'Transfer needs its other account', 'transfer-unmatched': 'Transfer, other side not found' }[reason] || label(reason));
// Never round ledger values through binary floating point for display.
function money(value, currency) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return 'Unavailable';
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return `${negative ? '-' : ''}${currency === 'USD' ? '$' : currency + ' '}${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}
const monthLabel = month => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Audit instants are shown in UTC so a midnight record never appears on the prior day.
const recordedLabel = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || 'at an unknown time') : date.toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short', timeZone:'UTC'}) + ' UTC'; };
const shortMonth = month => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
// Drawn chevron for row actions; the button keeps its own accessible name.
function chevron() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS?.(ns, 'svg');
  if (!svg) return node('span', '');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', 'm9 6 6 6-6 6'); svg.append(path);
  return svg;
}
let freshYearLedger = null;
// The period is the #month-filter value: '' lifetime, 'YYYY' a year, 'YYYY-MM' a month.
// The period bar and Home's links change it only through choosePeriod.
const periodLabel = period => periodKind(period) === 'month' ? monthLabel(period) : period || 'Lifetime';
let lastMonth = null;
function ensurePeriodOption(period) {
  if (period && !Array.from($('month-filter').children).some(option => option.value === period)) {
    const option = node('option', periodLabel(period)); option.value = period; $('month-filter').append(option);
  }
}
function choosePeriod(period, destination = null) {
  if (busy || !session.ledger) return false;
  const prior = $('month-filter').value;
  if (period !== prior) {
    ensurePeriodOption(period); $('month-filter').value = period;
    if (!changeReconciliationScope('month-filter', prior)) return false;
    updateStatementEditor(); page = 0; listLimit = PAGE_ROWS; render();
  }
  if (destination) pages.go(destination);
  return true;
}
const homeDashboard = mountHomeDashboard({document, $, node, money, monthLabel, shortMonth,
  onChoosePeriod: period => choosePeriod(period),
  onOpenMonth: month => choosePeriod(month, 'transactions'),
  // The category filter in Activity, for the same account and period.
  onOpenCategory: categoryId => {
    if (busy || !session.ledger) return;
    resetActivityFilters(); activityFilters.categories.add(categoryId);
    page = 0; listLimit = PAGE_ROWS; render(); pages.go('transactions');
  }});
$('period-month').addEventListener('click', () => {
  const period = $('month-filter').value, today = currentMonth();
  if (periodKind(period) === 'month') return;
  const year = periodKind(period) === 'year' ? period : (lastMonth ?? today).slice(0, 4);
  choosePeriod(lastMonth?.startsWith(year + '-') ? lastMonth : year === today.slice(0, 4) ? today : `${year}-12`);
});
$('period-year').addEventListener('click', () => {
  const period = $('month-filter').value;
  if (periodKind(period) !== 'year') choosePeriod((periodKind(period) === 'month' ? period : lastMonth ?? currentMonth()).slice(0, 4));
});
$('period-lifetime').addEventListener('click', () => choosePeriod(''));
for (const [id, direction] of [['period-prev', -1], ['period-next', 1]]) $(id).addEventListener('click', () => {
  const next = homeDashboard.bounds && stepPeriod($('month-filter').value, direction, homeDashboard.bounds);
  if (next) choosePeriod(next);
});
// The connect panel lives on Home until something is open, then in More, so
// Open and Reconnect never disappear while a ledger is loaded.
let entrySlot = 'home-connect';
function placeLedgerEntry() {
  const slot = session.ledger ? 'more-connect' : 'home-connect';
  if (slot === entrySlot) return;
  entrySlot = slot; $(slot).append($('ledger-entry'));
}
let busy = false, configured = false, page = 0, selectedActivity = null, view = null, operationStarted = null;
let viewLedger = null, viewReader = null, homeView = null, searchTimer = null, composingSearch = false;
const reviewButtons = new Map();
// Activity list state. Filters change rows only, never account/period totals.
const PAGE_ROWS = 50;
const activityFilters = {types:new Set(), categories:new Set()};
let listLimit = PAGE_ROWS, quickOpen = null, quickFocus = null, facetsInSheet = false, openFacet = null;
const quickDrafts = new Map(), decideButtons = new Map();
// Categories page state: the open inline editor and the controls refresh() enables.
let categoryEditing = null;
const categoryControls = [];
let categoryCounts = {ledger:null, counts:new Map()};
// Rules page state: the open editor's draft, the preview that comes before Apply, and its controls.
let ruleDraft = null, rulePreview = null, ruleTargetCache = {ledger:null, targets:new Map()};
const ruleControls = [];
const INLINE_REASONS = new Set(['unclassified-activity', 'classification-amount-conflict', 'unmatched-refund', 'deleted-category', 'transfer-account-missing', 'transfer-unmatched']);
// A transfer names the account on its other side: money out goes to it, money in comes from it.
const accountName = id => session.ledger.accounts.find(account => account.accountId === id)?.displayName ?? 'Unknown account';
const otherAccounts = activity => session.ledger.accounts.filter(account => account.accountId !== activity.accountId).map(account => [account.accountId, account.displayName]);
const moneyOut = row => String(row.amountText).startsWith('-');
function transferPath(row) {
  if (!row.transferAccountId) return 'Other account not named';
  return moneyOut(row) ? `${row.accountName} → ${accountName(row.transferAccountId)}` : `${accountName(row.transferAccountId)} → ${row.accountName}`;
}
// The open ledger's categories. Reads are cached per ledger object.
const catalog = () => categoryCatalog(session.ledger);
const categoryLabel = id => catalog().path(id);
const NEW_CATEGORY = '__new';
// Income gets the income list; spending, refunds and transfers get the spending list.
const directionFor = kind => kind === 'income' ? 'income' : 'spending';
/** A category select: keep or clear the current one, every category of one list, then "Create new category…". */
function fillCategorySelect(select, direction, current) {
  const list = catalog(), known = current && !list.retired(current) ? current : null;
  select.replaceChildren();
  const none = node('option', known ? `Keep ${list.path(known)}` : 'No category'); none.value = known ?? ''; select.append(none);
  for (const item of list.choices(direction)) {
    if (item.id === known) continue;
    const option = node('option', item.path); option.value = item.id; select.append(option);
  }
  const fresh = node('option', 'Create new category…'); fresh.value = NEW_CATEGORY; select.append(fresh);
}
/** Where a new category goes: top level, or inside a top-level category of the same list. */
function fillParentSelect(select, direction, selected = '') {
  addOptions(select, catalog().choices(direction).filter(item => !item.parentId).map(item => [item.id, item.label]), selected, 'Top level');
}
/** The chosen category: an existing ID, or a new category to create in the same step. */
function chosenCategory(select, name, parent, direction) {
  if (select.value !== NEW_CATEGORY) return {categoryId:select.value || null, newCategory:null, text:select.value ? categoryLabel(select.value) : ''};
  const label = name.value.trim().replaceAll(/\s+/g, ' ');
  return {categoryId:null, newCategory:label ? {label, direction, parentId:parent.value || null} : null, text:label};
}
const TYPE_LABELS = {spending:'Spending', income:'Income', transfer:'Transfer', refund:'Refund', investment:'Investment', other:'Other', unclassified:'Unclassified'};
const SORT_LABELS = {newest:'Newest first', oldest:'Oldest first', 'largest-out':'Largest money out', 'largest-in':'Largest money in'};
const filtersActive = () => Boolean($('transaction-search').value.trim() || $('review-only').checked || $('pending-only').checked ||
  activityFilters.types.size || activityFilters.categories.size);
const activeFilterCount = () => activityFilters.types.size + activityFilters.categories.size + Number($('review-only').checked) + Number($('pending-only').checked);
function resetActivityFilters() {
  activityFilters.types.clear(); activityFilters.categories.clear();
  $('review-only').checked = false; $('pending-only').checked = false; $('activity-sort').value = 'newest';
  listLimit = PAGE_ROWS; quickOpen = null; quickDrafts.clear();
}
const homeButtons = new Map();
const detailEditorFields = ['classification', 'transfer-account', 'category', 'category-new-name', 'category-new-parent', 'amount', 'posting-status', 'posting-date', 'correction-rationale', 'transfer-counterparty', 'transfer-link-rationale'];
let detailEditorBaseline = null, detailActivity = null, detailNoteEdited = false;
// Template audit notes: plain keyword substitution from the change itself, never generated text.
const typeName = kind => (TYPE_LABELS[kind] ?? label(kind)).toLowerCase();
const categoryName = id => id ? categoryLabel(id) : 'no category';
const detailCategory = () => chosenCategory($('category'), $('category-new-name'), $('category-new-parent'), directionFor(detailActivity?.activityKind));
function detailNote() {
  const a = detailActivity;
  if (!a) return '';
  const type = $('correction-type').value;
  if (type === 'classification') {
    const next = $('classification').value;
    const named = next === 'transfer' && !a.transferGroupId && $('transfer-account').value && $('transfer-account').value !== (a.transferAccountId ?? '')
      ? ` Other account: ${accountName($('transfer-account').value)}.` : '';
    return next === a.activityKind ? named.trim() : `Changed classification from ${typeName(a.activityKind)} to ${typeName(next)}.` + named;
  }
  if (type === 'category-correction') {
    const next = detailCategory();
    return !next.text || (next.categoryId && next.categoryId === a.categoryId) ? '' : `Changed category from ${categoryName(a.categoryId)} to ${next.newCategory ? 'new category ' + next.text : next.text}.`;
  }
  if (type === 'bank-correction') {
    const next = $('amount').value.trim();
    return !/^-?\d+(\.\d+)?$/.test(next) || next === a.amountText ? '' : `Corrected amount from ${money(a.amountText, a.currency)} to ${money(next, a.currency)}.`;
  }
  const status = $('posting-status').value, date = $('posting-date').value;
  if (status === a.lifecycleStatus && (status !== 'posted' || date === (a.postedDate || ''))) return '';
  return status === 'posted' ? `Confirmed as posted${isCalendarDate(date) ? ' on ' + date : ''}.` : `Confirmed posting status as ${status}.`;
}
function suggestDetailNote() {
  if (!detailNoteEdited) $('correction-rationale').value = detailNote();
  refresh();
}
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
function cancelSearch() { clearTimeout(searchTimer); searchTimer = null; }
function scheduleSearch() {
  cancelSearch();
  if (busy || composingSearch || !session.ledger) return;
  // Coalesce typing only; account/month changes and completed corrections stay immediate.
  searchTimer = setTimeout(() => { searchTimer = null; if (!busy) { page = 0; listLimit = PAGE_ROWS; render(); } }, 120);
}
// The reviewed release profile decides which classes this build can construct.
const productionReleased = RELEASE_PROFILE.dataClasses.includes('production');
const isPrivate = () => storage.dataClass === 'production';
const storage = new DashboardSyntheticStorage({
  release: RELEASE_PROFILE,
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
      ? (isPrivate() ? 'Connected to your private database. Opening and saves verify its canonical records.' : 'Connected to a synthetic copy. Opening and saves verify its canonical records.')
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
  const ready = session.ready(), editable = !busy && session.canEdit(), privateClass = isPrivate();
  $('data-class-choice').hidden = !productionReleased;
  $('data-class').disabled = busy || !productionReleased || Boolean(lifecycle) || Boolean(session.ledger);
  if ($('data-class').value !== storage.dataClass) $('data-class').value = storage.dataClass;
  for (const update of sourceReviewUpdates) update();
  $('start-preview').disabled = busy || Boolean(lifecycle) || privateClass;
  placeLedgerEntry();
  // An action error already reported at the top is not repeated in the connect panel.
  $('connection-status-wrap').hidden = $('action-status').dataset.kind === 'error' && $('action-status').textContent === $('connection-status').textContent;
  $('welcome-panel').hidden = Boolean(session.ledger);
  $('overview-loaded').hidden = !session.ledger;
  $('create-ledger').disabled = busy || !configured || navigator.onLine === false || Boolean(lifecycle) || session.backupPreview || session.unverified || (session.mode !== 'preview' && !privateClass && !freshYearLedger);
  $('create-ledger').textContent = privateClass ? 'Create new private database' : session.mode === 'preview' ? 'Save preview to a new folder' : 'Create new synthetic year';
  // In a loaded synthetic preview this would duplicate Save this preview to a new folder.
  $('create-ledger').hidden = session.mode === 'preview' && !privateClass && Boolean(session.ledger);
  $('open-ledger').disabled = busy || !configured || navigator.onLine === false || Boolean(session.restoreExpected && session.restoreFolderId);
  $('open-ledger').textContent = lifecycle ? 'Reconnect saved copy' : privateClass ? 'Open private database' : 'Open saved synthetic year';
  $('preview-position').disabled = busy || Boolean(lifecycle) || privateClass;
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
  $('stage-reconciliation').disabled = !editable || !isMonthPeriod($('month-filter').value) || !$('reconcile-opening').value || !$('reconcile-closing').value || !$('reconcile-source').value.trim();
  $('preview-year').disabled = busy || Boolean(lifecycle) || privateClass;
  $('save-preview').disabled = busy || !configured || navigator.onLine === false || session.mode !== 'preview' || !session.ledger || Boolean(lifecycle) || session.backupPreview || session.unverified;
  $('save-preview').textContent = session.mode === 'preview' ? 'Save this preview to a new folder' : 'Save this preview to a new folder';
  $('save-ledger').disabled = busy || !session.canSave();
  $('undo-last-change').disabled = busy || !session.canUndo();
  $('revert-all-changes').disabled = busy || !session.canRevertAll();
  for (const id of ['category-add-name', 'category-add-direction', 'category-add-parent']) $(id).disabled = !editable;
  $('category-add').disabled = !editable || !$('category-add-name').value.trim();
  for (const update of categoryControls) update(editable);
  for (const id of ['rule-new', 'rule-contains', 'rule-kind', 'rule-transfer-account', 'rule-category', 'rule-cancel', 'rule-preview-cancel']) $(id).disabled = !editable;
  $('rule-save').disabled = !editable || !ruleDraft || !$('rule-contains').value.trim();
  $('rule-apply').disabled = !editable || !rulePreview?.count;
  for (const update of ruleControls) update(editable);
  $('link-transfer').disabled = busy || !editable || !selectedActivity || !$('transfer-counterparty').value || !$('transfer-link-rationale').value.trim();
  $('reopen-ledger').disabled = busy || !ready;
  $('release-ledger').disabled = busy || navigator.onLine === false || Boolean(releaseUnavailableReason());
  const exportReady = ready && session.mode === 'saved' && Boolean(session.ledger) && !session.unverified && !session.needsReopen && !session.pendingSave;
  $('backup-draft-warning').hidden = !session.dirty;
  $('export-backup').disabled = busy || !exportReady || session.dirty;
  $('backup-save-first').disabled = busy || !session.dirty || !session.canSave();
  $('backup-saved-only').disabled = busy || !exportReady || !session.dirty;
  // Private-database backups are always encrypted in this release.
  if (privateClass && !$('backup-encrypt').checked) $('backup-encrypt').checked = true;
  $('backup-encrypt').disabled = busy || privateClass;
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
  for (const button of decideButtons.values()) button.disabled = busy || !session.canEdit();
  refreshQuickReview();
  $('transactions').setAttribute('aria-busy', String(busy));
  for (const id of ['account-filter', 'month-filter', 'transaction-search', 'review-only', 'pending-only', 'activity-sort', 'open-filters', 'type-facet-toggle', 'category-facet-toggle', 'show-more', 'clear-activity-filters', 'clear-sheet-filters']) $(id).disabled = busy || !session.ledger;
  for (const input of facetInputs()) input.disabled = busy || !session.ledger;
  for (const id of ['period-month', 'period-year', 'period-lifetime']) $(id).disabled = busy || !session.ledger;
  // The dashboard marks an arrow at the first or last reachable period as an edge.
  for (const id of ['period-prev', 'period-next']) $(id).disabled = busy || !session.ledger || $(id).dataset.edge !== 'false';
  for (const id of ['correction-type', 'classification', 'transfer-account', 'category', 'category-new-name', 'category-new-parent', 'category-rule', 'amount', 'posting-status', 'correction-rationale', 'transfer-counterparty', 'transfer-link-rationale']) $(id).disabled = !editable;
  const postingCorrection = $('correction-type').value === 'posting-status-correction';
  $('posting-date').disabled = !editable || !postingCorrection || $('posting-status').value !== 'posted';
  $('stage-correction').disabled = !editable || !selectedActivity || !$('correction-rationale').value.trim() ||
    ($('correction-type').value === 'classification' && $('classification').value === 'transfer' && !detailActivity?.transferGroupId && !$('transfer-account').value) ||
    (postingCorrection && $('posting-status').value === 'posted' && !isCalendarDate($('posting-date').value));
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
  // One save bar, shown only when there is something to save, wait for or recover.
  const recovering = session.unverified || ['not-saved','different','unverifiable','checking'].includes(session.recoveryOutcome);
  $('draft-bar').hidden = !(busy || recovering || needsRecovery || session.dirty || (session.ledger && session.needsReopen));
  $('draft-bar').dataset.state = busy ? 'busy' : session.unverified ? 'unverified' : recovering || needsRecovery ? 'recovery' : session.dirty ? 'dirty' : 'readonly';
  $('draft-summary').textContent = busy ? 'Working. Keep this tab open.' : session.unverified ? 'Save unverified. Check Recovery in More.' : needsRecovery || recovering ? 'Recovery needed. Open More.' : session.dirty ? `${session.stagedHistory.length} staged change${session.stagedHistory.length === 1 ? '' : 's'} · not saved` : session.ledger && session.needsReopen ? 'Read-only. Reconnect in More to edit.' : session.ledger ? 'No staged changes' : 'No ledger loaded';
  // While an operation runs the bar reports progress only; there is nothing to press.
  $('save-ledger-option').hidden = busy || recovering || needsRecovery || session.mode === 'preview' || !session.dirty;
  // Hide only actions that cannot apply in this mode; blocked ones keep their reason.
  $('save-preview-option').hidden = session.mode !== 'preview';
  for (const id of ['undo-last-change', 'revert-all-changes']) $(id + '-option').hidden = !session.ledger;
  for (const id of ['reopen-ledger', 'release-ledger']) $(id + '-option').hidden = !lifecycle;
  $('draft-storage-option').hidden = busy || session.mode !== 'preview';
  $('data-mode').dataset.mode = session.mode;
  $('data-mode').dataset.dataClass = storage.dataClass;
  $('data-mode').textContent = privateClass
    ? (session.mode === 'preview' ? 'Private · local preview' : session.ledger ? (session.needsReopen ? 'Private · read-only' : 'Private database') : 'Private database (not open)')
    : session.mode === 'preview' ? 'Synthetic local preview' : session.ledger ? (session.needsReopen ? 'Synthetic · read-only' : 'Synthetic saved copy') : 'Synthetic workspace';
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
const formStatuses = { 'rule-save':'rule-form-status', 'rule-apply':'rule-form-status', 'category-add':'category-form-status', 'stage-account':'account-form-status', 'stage-balance':'position-form-status', 'stage-closure':'closure-form-status', 'stage-holdings':'holdings-form-status', 'stage-reconciliation':'reconciliation-form-status' };
const action = (id, message, callback) => $(id).addEventListener('click', () => {
  if (!$(id).disabled) return run(message, callback, formStatuses[id], id);
});
function hasUnfinishedEvidence() {
  return historicalSummaryWorkflow?.hasUnfinishedReview() || planningPage?.hasUnfinishedWork() || holdingRows.length > 0 || componentRows.length > 0 || $('statement-full-month').checked ||
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
  planningPage?.clear();
  homeDashboard.clear(); lastMonth = null;
  cancelSearch();
  view = null; viewLedger = null; viewReader = null; homeView = null; positionRender = null;
  renderedPositionDate = null; selectedActivity = null; detailEditorBaseline = null; detailActivity = null;
  page = 0; composingSearch = false;
  reviewButtons.clear(); homeButtons.clear(); editorAccounts.clear();
  sourceReviewUpdates.length = 0; sourceReviewPage = 0; sourceReviewScope = null;
  positionButtons.length = 0; holdingRows.length = 0; componentRows.length = 0;
  for (const id of ['summary-cards','recent-activities','transaction-rows','review-queue','position-totals','position-accounts','holdings-accounts','position-coverage','detail-source','detail-history','component-rows','holdings-rows',
    'account-filter','month-filter','transfer-counterparty','balance-account','reconcile-account','reconcile-opening','reconcile-closing','closure-anchor','holdings-account']) $(id).replaceChildren();
  for (const id of ['summary-scope','qualification','attention-count','transaction-count','filter-count','page-status','overview-review-title','review-summary','scope-period-title','scope-position-title','position-scope','position-warning','position-coverage-help','detail-title','detail-description','detail-amount','transfer-link-status', ...Object.values(formStatuses)]) $(id).textContent = '';
  for (const id of [...detailEditorFields, ...positionInputs, 'transaction-search','account-filter','month-filter','backup-password','backup-password-confirm','restore-password','backup-file','position-date']) $(id).value = '';
  resetActivityFilters(); closeFacetPanels(); closeFilterSheet();
  for (const id of ['type-options', 'category-options', 'active-filter-chips', 'category-list-spending', 'category-list-income', 'category-add-parent']) $(id).replaceChildren();
  // An open inline decision belongs to the released ledger; its refresh must not outlive it.
  quickControls.length = 0;
  categoryEditing = null; categoryControls.length = 0; $('category-add-name').value = ''; $('category-form-status').textContent = '';
  ruleDraft = null; rulePreview = null; ruleControls.length = 0; ruleTargetCache = {ledger:null, targets:new Map()};
  for (const id of ['rule-list', 'legacy-rule-list', 'rule-preview-list', 'rule-accounts', 'rule-category', 'rule-transfer-account']) $(id).replaceChildren();
  for (const id of ['rule-editor-matches', 'rule-preview-title']) $(id).textContent = '';
  $('rule-contains').value = ''; $('rule-editor').hidden = true; $('rule-preview').hidden = true; $('legacy-rules').hidden = true;
  // Facet labels can name a category or count records; they go with the ledger.
  for (const id of ['type-facet-summary', 'category-facet-summary', 'review-facet-count', 'pending-facet-count', 'filter-badge']) $(id).textContent = '';
  $('apply-filter-sheet').textContent = 'Show results';
  $('active-filters').hidden = true; $('review-section').hidden = true; $('show-more').hidden = true; $('filter-badge').hidden = true;
  $('statement-full-month').checked = false;
  $('activity-detail').hidden = true; $('transaction-table-wrap').hidden = true;
  $('empty-state').hidden = false; $('empty-state').textContent = 'No ledger loaded.';
  pages.clearDetail();
  selectedAccountId = null; selectedCoverageMonth = null; coverageHistory = null; positionReport = null; paneKey = null; pendingAccountIntent = null; accountRows.clear();
  for (const id of ['account-observations','observation-months','account-coverage','coverage-months','account-gap','account-conflict','account-evidence']) $(id).replaceChildren();
  for (const id of ['account-meta','account-balance','account-freshness','observations-range','coverage-summary-line','holdings-meta']) $(id).textContent = '';
  $('account-title').textContent = 'No account selected';
  pages.setAccountAvailable(false);
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
    page = 0; selectedActivity = null; detailEditorBaseline = null; detailActivity = null; $('transaction-search').value = ''; resetActivityFilters(); $('account-filter').value = '';
    // Home opens on the current calendar month, even before it has data.
    lastMonth = currentMonth(); ensurePeriodOption(lastMonth); $('month-filter').value = lastMonth;
    $('activity-detail').hidden = true; pages.clearDetail(); }
  if (viewLedger !== session.ledger) {
    const reader = createWorkspaceViewReader(session.ledger, {monthlyIndex:session.store?.monthIndex});
    viewReader = reader; viewLedger = session.ledger; homeView = null;
  }
  view = viewReader.view({ accountId: $('account-filter').value, month: $('month-filter').value, query: $('transaction-search').value,
    reviewOnly: $('review-only').checked, pendingOnly: $('pending-only').checked, types: [...activityFilters.types],
    categories: [...activityFilters.categories], sort: $('activity-sort').value || 'newest', limit: listLimit });
  page = view.page;
  addOptions($('account-filter'), view.accounts.map(a => [a.accountId, a.displayName]), view.scope.accountId, 'All accounts');
  if (isMonthPeriod(view.scope.month)) lastMonth = view.scope.month;
  // The select only stores the period; the period bar is its visible control.
  const periods = view.scope.month && !view.months.includes(view.scope.month) ? [view.scope.month, ...view.months] : view.months;
  addOptions($('month-filter'), periods.map(period => [period, periodLabel(period)]), view.scope.month, 'Lifetime');
  $('qualification').textContent = view.qualifications.join(' ');
  $('coverage-summary').textContent = `${view.coverage.importCount} import runs cover this period. Latest imported activity, any period: ${view.coverage.latestActivityDate || 'unavailable'}. Imported dates alone do not prove complete history.`;
  // Home uses account/month scope, independently of the Activity search,
  // review filter and page. Retain only the current Home scope so its read does
  // not evict the Activity reader's latest filtered result on every render.
  if (!homeView || homeView.scope.accountId !== view.scope.accountId || homeView.scope.month !== view.scope.month) {
    homeView = viewReader.view({accountId:view.scope.accountId, month:view.scope.month, pageSize:4});
  }
  homeDashboard.refresh(session.ledger, viewReader, view);
  planningPage?.refresh(session.ledger, viewReader, view);
  renderCategories();
  renderRules();
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
  $('attention-count').dataset.state = reviewCount ? 'due' : 'clear';
  $('transaction-count').textContent = String(view.totalCount);
  renderActivityList();
  $('overview-review-title').textContent = reviewCount ? `${reviewCount === 1 ? 'record needs' : 'records need'} a decision in this account and period.` : 'Nothing to review here. Coverage still needs separate reconciliation.';
  $('review-summary').textContent = `${view.review.activityCount} activities need review in this account and period. ${view.review.sourceCount} source observations await a decision. Unknown investment activity remains excluded from known totals.`;
  $('review-queue').replaceChildren();
  renderSourceReviews();
  // Source rows waiting for match/keep/reject belong with the Needs review list.
  $('review-section').hidden = !$('review-only').checked || (view.review.sourceCount === 0 && reviewCount > 0);
  if (!reviewCount) {
    const empty = node('article', undefined, 'review-empty');
    const link = node('a', 'Check account-month coverage →', 'inline-action'); link.href = '#reconciliation';
    empty.append(node('h3', 'No decisions waiting'), node('p', 'Nothing is unresolved in this account and period. Reconciliation shows whether history is missing.'), link);
    $('review-queue').append(empty);
  }
  renderPosition();
  const accountTitle = view.scope.accountId ? view.accounts.find(account => account.accountId === view.scope.accountId)?.displayName : 'All accounts';
  $('scope-period-title').textContent = accountTitle;
  $('scope-position-title').textContent = `${accountTitle} · As of ${$('position-date').value}`;
  refresh();
  applyQuickFocus();
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
  const month = isMonthPeriod($('month-filter').value) ? $('month-filter').value : '';
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
  const month = isMonthPeriod($('month-filter').value) ? $('month-filter').value : '';
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
// Accounts: institution-grouped list on the left, one account's detail on the
// right (a pushed page on narrow screens). The list and the detail render only
// when their inputs change, so unfinished decisions survive search and filters.
function accountHistory(asOf) {
  if (coverageHistory?.ledger !== session.ledger || coverageHistory.asOf !== asOf) {
    coverageHistory = {ledger:session.ledger, asOf, ...buildCoverageHistory(session.ledger, {asOf})};
  }
  return coverageHistory;
}
function renderPosition() {
  if (!$('position-date').value) $('position-date').value = new Date().toISOString().slice(0, 10);
  const scopeKey = [$('position-date').value, view.scope.accountId, view.scope.month].join('|');
  if (positionRender?.ledger === session.ledger && positionRender.scopeKey === scopeKey) return;
  positionRender = {ledger:session.ledger, scopeKey};
  renderedPositionDate = $('position-date').value;
  const asOf = $('position-date').value;
  const position = viewReader.position({asOf, accountId:view.scope.accountId});
  const history = accountHistory(asOf);
  positionReport = position; positionGeneration++;
  // One line: known net worth per currency, then whether it is complete and why not.
  // The scope bar above already states the as-of date and account scope.
  $('position-scope').replaceChildren();
  position.currencies.forEach((subtotal, index) => {
    const scoped = position.accounts.filter(account => account.currency === subtotal.currency);
    const value = scoped.length && !scoped.some(account => account.balance !== null) ? null : subtotal.knownNetWorth;
    if (index) $('position-scope').append(node('span', ' · '));
    $('position-scope').append(node('span', `${subtotal.complete ? 'Net worth' : 'Known net worth'}${position.currencies.length > 1 ? ' ' + subtotal.currency : ''} `), node('strong', money(value, subtotal.currency)));
  });
  if (!position.currencies.length) $('position-scope').append(node('span', 'No accounts in scope'));
  else $('position-scope').append(node('span', position.complete ? ' · every balance current' : ` · partial: ${position.reasons.map(reason => POSITION_REASONS[reason] || label(reason)).join('; ')}`, position.complete ? 'position-summary-state' : 'position-summary-state warn-text'));
  $('position-warning').dataset.state = position.complete ? 'complete' : 'incomplete';
  $('position-warning').textContent = position.complete
    ? 'Every balance in scope is current within 35 days. Balances are dated observations, not live values.'
    : `Incomplete position: ${position.reasons.map(reason => POSITION_REASONS[reason] || label(reason)).join('; ')}. Known subtotals are not complete net worth.`;
  $('position-totals').replaceChildren();
  for (const subtotal of position.currencies) for (const [key, title] of [['knownAssets', 'Known assets'], ['knownLiabilities', 'Known liabilities'], ['knownNetWorth', 'Known net worth']]) {
    const card = node('article', undefined, 'metric-card');
    const scoped = position.accounts.filter(account => account.currency === subtotal.currency);
    const relevant = key === 'knownNetWorth' ? scoped : scoped.filter(account => account.role === (key === 'knownAssets' ? 'asset' : 'liability'));
    const value = relevant.length && !relevant.some(account => account.balance !== null) ? null : subtotal[key];
    card.append(node('p', `${title} · ${subtotal.currency}`, 'metric-label'), node('p', money(value, subtotal.currency), 'metric-value'), node('p', subtotal.complete ? '' : 'Partial subtotal', 'metric-note'));
    $('position-totals').append(card);
  }
  if (!position.currencies.length) $('position-totals').append(node('p', 'Position unavailable: no accounts in scope.'));
  // Institutions in a stable order; each header says how far its imports reach.
  const imports = institutionCoverage(session.ledger);
  $('position-accounts').replaceChildren(); accountRows.clear();
  for (const institutionId of [...new Set([...Object.keys(INSTITUTIONS), ...position.accounts.map(account => account.institutionId)])]) {
    const accounts = position.accounts.filter(account => session.ledger.accounts.find(item => item.accountId === account.accountId)?.institutionId === institutionId);
    if (!accounts.length) continue;
    const group = node('section', undefined, 'account-group'), head = node('div', undefined, 'account-group-head');
    const headingId = `institution-${institutionId}`, heading = node('h3', INSTITUTIONS[institutionId] || label(institutionId)); heading.id = headingId;
    group.setAttribute('aria-labelledby', headingId);
    const coverage = imports.get(institutionId), attention = accounts.filter(account => account.reasons.length).length;
    const meta = node('p', coverage ? `Imports through ${dateLabel(coverage.through)}` : 'No imports yet', 'account-group-meta');
    if (attention) { const flag = node('span', ` · ${attention} need${attention === 1 ? 's' : ''} attention`, 'warn-text'); meta.append(flag); }
    head.append(heading, meta); group.append(head);
    const list = node('ul', undefined, 'account-rows');
    for (const account of accounts) {
      const cells = history.byAccount.get(account.accountId) || [], fresh = freshness(account), counts = coverageCounts(cells);
      const item = node('li'), row = node('button', undefined, 'account-row'); row.type = 'button';
      const copy = node('span', undefined, 'account-row-copy');
      const qualifier = node('small', `${ACCOUNT_TYPES[account.accountType] || label(account.accountType)} · ${fresh.short ?? fresh.text}`, fresh.warn ? 'warn-text' : '');
      copy.append(node('strong', account.displayName), qualifier);
      const balance = node('span', money(account.balance, account.currency) + (account.role === 'liability' && account.balance !== null ? ' owed' : ''), 'account-row-balance');
      if (account.balance === null) balance.dataset.state = 'unavailable';
      row.append(copy, miniStrip(cells, node), balance, node('span', `Coverage: ${counts.reconciled} of ${counts.total} months reconciled${counts.fix ? `, ${counts.fix} need a fix` : ''}.`, 'visually-hidden'));
      row.addEventListener('click', () => selectAccount(account.accountId, {navigate:true}));
      accountRows.set(account.accountId, row); item.append(row); list.append(item);
    }
    group.append(list); $('position-accounts').append(group);
  }
  if (pendingAccountIntent === 'investment') {
    const investment = firstInvestment(position);
    if (investment) { selectedAccountId = investment.accountId; selectedCoverageMonth = null; }
    pendingAccountIntent = null;
  }
  // Keep the selection while it stays in scope; otherwise open the account that most needs attention.
  if (!position.accounts.some(account => account.accountId === selectedAccountId)) {
    selectedAccountId = (position.accounts.find(account => account.reasons.length) || position.accounts[0])?.accountId ?? null;
    selectedCoverageMonth = null;
  }
  pages.setAccountAvailable(selectedAccountId !== null);
  const options = session.ledger.accounts.map(account => [account.accountId, account.displayName]);
  addOptions($('balance-account'), options, $('balance-account').value || selectedAccountId || '', 'Choose account');
  addOptions($('reconcile-account'), options, $('reconcile-account').value, 'Choose account');
  addOptions($('holdings-account'), session.ledger.accounts.filter(account => INVESTMENT.includes(account.accountType)).map(account => [account.accountId, account.displayName]), $('holdings-account').value, 'Choose investment account');
  for (const id of ['balance-account', 'holdings-account', 'reconcile-account']) editorAccounts.set(id, $(id).value);
  populateAnchors(); updateStatementEditor();
  $('position-coverage').replaceChildren();
  if (isMonthPeriod(view.scope.month)) {
    const coverage = viewReader.coverage({month:view.scope.month, accountId:view.scope.accountId});
    $('position-coverage-help').textContent = `${view.scope.month}: ${coverage.complete ? 'Reconciled complete for selected scope.' : 'Not reconciled complete for selected scope.'} Declared imports alone are insufficient.`;
    for (const item of coverage.accounts) {
      const card = node('article', undefined, 'review-item');
      card.append(node('h4', session.ledger.accounts.find(account => account.accountId === item.accountId)?.displayName || item.accountId), node('p', `${label(item.state)} · Declared: ${item.declared ? 'yes' : 'no'} · Observed: ${item.observed ? 'yes' : 'no'}`), node('p', `Opening balance: ${item.openingBalanceEventId ? 'selected' : 'missing'} · Closing balance: ${item.closingBalanceEventId ? 'selected' : 'missing'} · Difference: ${item.discrepancy ?? 'unavailable'}`), node('p', item.reasons.map(label).join('; ')), evidenceDetails('Inspect reconciliation evidence', () => item));
      $('position-coverage').append(card);
    }
  } else $('position-coverage-help').textContent = 'Choose a single month in the period bar to inspect account-month coverage. Declared imports alone do not prove completeness.';
  renderAccountPane();
}
// Unfinished evidence belongs to the account it was typed for.
function unfinishedAccountEvidence() {
  return ['balance-date','balance-amount','balance-source','holdings-date','holdings-source','closure-source'].some(id => $(id).value.trim()) || holdingRows.length > 0;
}
function clearAccountEvidence() {
  for (const id of ['balance-date','balance-amount','balance-source','holdings-date','holdings-source','closure-source']) $(id).value = '';
  holdingRows.length = 0; $('holdings-rows').replaceChildren(); $('holdings-scope').value = 'partial';
}
// Evidence staged for another account moves the detail to that account, so the
// result (including any conflict to resolve) is visible where it was entered.
function selectStagedAccount(accountId) {
  if (!accountId || accountId === selectedAccountId) return;
  selectedAccountId = accountId; selectedCoverageMonth = null; paneKey = null;
}
function selectAccount(accountId, {navigate = false} = {}) {
  if (accountId !== selectedAccountId) {
    if (unfinishedAccountEvidence() && !window.confirm('Switch account and clear the unfinished evidence form? Staged changes stay unchanged.')) return;
    clearAccountEvidence();
    selectedAccountId = accountId; selectedCoverageMonth = null;
    renderAccountPane();
  }
  if (navigate && narrowAccounts()) pages.openAccount();
}
function renderAccountPane() {
  const account = positionReport?.accounts.find(item => item.accountId === selectedAccountId);
  for (const [id, row] of accountRows) { if (id === selectedAccountId) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current'); }
  const key = `${positionGeneration}|${selectedAccountId}`;
  if (paneKey === key) return;
  paneKey = key;
  $('account-pane').hidden = !account;
  for (const id of ['account-observations','observation-months','account-coverage','coverage-months','account-gap','account-conflict','holdings-accounts','account-evidence']) $(id).replaceChildren();
  if (!account) return;
  const ledgerAccount = session.ledger.accounts.find(item => item.accountId === account.accountId);
  const history = accountHistory(positionReport.asOf), cells = history.byAccount.get(account.accountId) || [];
  const fresh = freshness(account), counts = coverageCounts(cells);
  $('account-meta').textContent = `${INSTITUTIONS[ledgerAccount.institutionId] || label(ledgerAccount.institutionId)} · ${ACCOUNT_TYPES[account.accountType] || label(account.accountType)} · ${account.role === 'liability' ? 'Liability' : account.role === 'asset' ? 'Asset' : 'Unknown scope'}`;
  $('account-title').textContent = account.displayName;
  $('account-balance').textContent = money(account.balance, account.currency);
  $('account-balance').dataset.state = account.balance === null ? 'unavailable' : 'known';
  // Always say how old the balance is on the as-of date; stale means more than 35 days.
  const age = account.balance === null || account.ageDays === null ? '' : account.ageDays === 0 ? ' · dated on the as-of day' : ` · ${plural(account.ageDays, 'day')} before the as-of date${account.stale ? ', stale after 35' : ''}`;
  $('account-freshness').textContent = `${account.role === 'liability' && account.balance !== null ? 'Amount owed · ' : ''}${fresh.text}${age}`;
  $('account-freshness').dataset.state = fresh.warn ? 'warn' : 'ok';
  // Observations and coverage share the same twelve month columns.
  const observations = balanceObservations(session.ledger, account.accountId, {from:history.months[0] + '-01', to:positionReport.asOf});
  selectedCoverageMonth = cells.some(cell => cell.month === selectedCoverageMonth) ? selectedCoverageMonth : mostUrgentMonth(cells);
  const known = observations.filter(item => item.amountText !== null);
  $('observations-range').textContent = !observations.length ? 'None in 12 months'
    : `${plural(observations.length, 'date')}${known.length > 1 ? ` · ${money(known.reduce((a, b) => Number(a.amountText) <= Number(b.amountText) ? a : b).amountText, account.currency)} to ${money(known.reduce((a, b) => Number(a.amountText) >= Number(b.amountText) ? a : b).amountText, account.currency)}` : ''}`;
  observationPlot($('account-observations'), observations, {node, months:history.months, money, currency:account.currency, selected:selectedCoverageMonth});
  stripLabels($('observation-months'), history.months, node);
  coverageStrip($('account-coverage'), cells, {node, selected:selectedCoverageMonth, onSelect:month => selectCoverageMonth(month)});
  stripLabels($('coverage-months'), history.months, node);
  $('coverage-summary-line').textContent = `${counts.reconciled} of ${counts.total} reconciled${counts.fix ? ` · ${counts.fix} need${counts.fix === 1 ? 's' : ''} a fix` : ''}`;
  renderCoverageGap(account, cells, observations);
  if (account.status === 'conflict') renderBalanceConflict(account);
  const investment = INVESTMENT.includes(account.accountType);
  $('account-holdings').hidden = !investment; $('holdings-editor').hidden = !investment;
  if (investment) renderAccountHoldings(account);
  // Editors act on the selected account.
  $('balance-account').value = account.accountId; editorAccounts.set('balance-account', account.accountId);
  if (investment) { $('holdings-account').value = account.accountId; editorAccounts.set('holdings-account', account.accountId); }
  const zeros = balanceEvents(account.accountId).filter(event => /^0(?:\.0+)?$/.test(event.amountText));
  addOptions($('closure-anchor'), zeros.map(event => [event.eventId, `${event.effectiveDate} · ${event.amountText} · ${event.source.reference}`]), $('closure-anchor').value, zeros.length ? 'Choose zero-balance evidence' : 'No zero balance recorded');
  const records = (session.ledger.positionEvents || []).filter(event => event.accountId === account.accountId);
  $('account-evidence').append(evidenceDetails(`Evidence records (${records.length})`, () => (session.ledger.positionEvents || []).filter(event => event.accountId === account.accountId)));
  refresh();
}
function selectCoverageMonth(month) {
  selectedCoverageMonth = month;
  const account = positionReport?.accounts.find(item => item.accountId === selectedAccountId);
  if (!account) return;
  const history = accountHistory(positionReport.asOf), cells = history.byAccount.get(account.accountId) || [];
  markSelected($('account-coverage'), month); markColumn($('account-observations'), history.months, month);
  renderCoverageGap(account, cells, balanceObservations(session.ledger, account.accountId, {from:history.months[0] + '-01', to:positionReport.asOf}));
}
// The selected month: what is true, why, and the next step that would close the gap.
function renderCoverageGap(account, cells, observations) {
  const cell = cells.find(item => item.month === selectedCoverageMonth), box = $('account-gap');
  box.replaceChildren();
  if (!cell) return;
  box.dataset.state = cell.state;
  const end = monthEnd(cell.month), before = new Date(cell.month + '-01T00:00:00Z'); before.setUTCDate(0);
  const opening = before.toISOString().slice(0, 10);
  box.append(node('h4', `${monthLong(cell.month)} · ${COVERAGE_STATES[cell.state]}${cell.partial ? ' so far' : ''}`));
  const notes = cell.state === 'reconciled' ? ['Activity reconciles to the opening and closing balances.']
    : cell.state === 'none' ? [observations.some(item => item.date.startsWith(cell.month))
      ? 'No import covers this month’s activity. The dated balance below is its only evidence; missing activity stays unknown, not zero.'
      : 'No import or balance covers this month. Missing months stay unknown, not zero.']
    : cell.reasons.map(reason => COVERAGE_REASONS[reason] || label(reason));
  if (cell.partial) notes.push(`The month is not over as of ${dateLabel(positionReport.asOf)}.`);
  const list = node('ul', undefined, 'gap-reasons');
  for (const note of [...new Set(notes)]) list.append(node('li', note));
  box.append(list);
  const inMonth = observations.filter(item => item.date.startsWith(cell.month));
  for (const item of inMonth) box.append(node('p', `Balance on ${dayLabel(item.date)}: ${item.conflict ? 'conflicting evidence, no value' : `${money(item.amountText, account.currency)} · ${item.basis === 'statement' ? 'statement' : 'manual entry'}`}`, 'gap-observation'));
  if (cell.state === 'reconciled') return;
  // Next steps, most fundamental first: settle conflicting evidence, bring in the
  // month's activity (cash accounts import it), add the balance anchors, then
  // review or reconcile in Activity. Investments and loans reconcile from statements.
  const steps = [], dated = balanceEvents(account.accountId);
  const has = date => dated.some(event => event.effectiveDate === date);
  const cash = ['checking', 'savings', 'credit-card'].includes(account.accountType);
  const needsImport = cash && cell.reasons.includes('missing-declared-coverage') && !cell.observed;
  if (account.status === 'conflict' && observations.some(item => item.conflict && item.date.startsWith(cell.month)))
    steps.push(['Choose the supported balance', () => $('account-conflict').querySelector?.('input')?.focus()]);
  if (needsImport) steps.push(['Import a CSV', () => pages.go('import')]);
  if (!cell.partial && !has(end)) steps.push([`Add ${dayLabel(end)} closing balance`, () => openBalanceEditor(end)]);
  if (!has(opening)) steps.push([`Add ${dayLabel(opening)} opening balance`, () => openBalanceEditor(opening)]);
  if (cell.reasons.some(reason => ['unresolved-source-observation','pending-activity','unresolved-activity-lifecycle','unknown-activity-amount','missing-refund-posted-date','unknown-source-date'].includes(reason)))
    steps.push([`Review ${monthShortName(cell.month)} in Activity`, () => openMonthInActivity(account.accountId, cell.month, 'transactions')]);
  if (!cell.partial && !needsImport && has(end) && has(opening) && (cell.reasons.includes('reconciliation-required') || cell.reasons.some(reason => ['balance-discrepancy','superseded-balance-anchors','conflicting-balance-anchors'].includes(reason))))
    steps.push([`Reconcile ${monthShortName(cell.month)}`, () => openMonthInActivity(account.accountId, cell.month, 'reconciliation')]);
  steps.splice(3);
  if (!steps.length) return;
  const actions = node('div', undefined, 'gap-actions');
  steps.forEach(([text, act], index) => {
    const button = node('button', text, index === 0 ? 'primary-button' : 'secondary-button'); button.type = 'button';
    button.addEventListener('click', () => { if (!busy) act(); });
    actions.append(button);
  });
  box.append(actions);
}
const monthShortName = month => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-US', {month:'long', timeZone:'UTC'});
function openBalanceEditor(date) {
  const editor = $('balance-editor'); editor.open = true;
  $('balance-account').value = selectedAccountId; editorAccounts.set('balance-account', selectedAccountId);
  // Prefill the date unless the owner has already started typing this record.
  if (!$('balance-amount').value.trim() && !$('balance-source').value.trim()) $('balance-date').value = date;
  $('balance-basis').value = 'statement';
  refresh(); $('balance-amount').focus();
}
// Reconciliation and review stay in Activity; this sets that page's month and account.
function openMonthInActivity(accountId, month, destination) {
  if (!Array.from($('month-filter').children).some(option => option.value === month)) {
    const option = node('option', monthLabel(month)); option.value = month; $('month-filter').append(option);
  }
  $('month-filter').value = month;
  if (destination === 'reconciliation') { $('reconcile-account').value = accountId; editorAccounts.set('reconcile-account', accountId); }
  // Review keeps the owner's account scope: it sets the period and the Needs review
  // filter only, so returning to Accounts shows the same accounts as before.
  else { $('review-only').checked = true; listLimit = PAGE_ROWS; }
  page = 0; render(); pages.go(destination);
  announce(destination === 'reconciliation' ? `Reconciling ${monthLabel(month)}. The activity period is now ${monthLabel(month)}.`
    : `Showing ${monthLabel(month)} activity that needs review. The account scope is unchanged.`, 'info');
}
function renderBalanceConflict(account) {
  const card = node('article', undefined, 'account-conflict-card');
  card.append(node('h4', 'Conflicting balances'), node('p', `Evidence for ${dateLabel(account.balanceDate)} disagrees, so this balance is excluded until you choose the supported record and say why.`));
  const rationale = node('input'); rationale.type = 'text'; rationale.setAttribute('aria-label', `Selection reason for ${account.displayName}`); rationale.maxLength = 300; rationale.placeholder = 'Why is this record supported?';
  card.append(rationale);
  // One row per candidate record: what it says, where it came from, and the choice.
  const list = node('ul', undefined, 'conflict-candidates'); card.append(list);
  for (const event of balanceEvents(account.accountId).filter(event => account.candidateEventIds.includes(event.eventId))) {
    const reference = event.source?.reference || 'No reference', amount = money(event.amountText, account.currency);
    const row = node('li', undefined, 'conflict-candidate'), copy = node('span', undefined, 'conflict-candidate-copy');
    copy.append(node('strong', amount), node('small', `${event.basis === 'statement' ? 'Statement' : 'Manual entry'} · ${reference}`));
    const button = node('button', 'Use this balance', 'secondary-button'); button.type = 'button'; positionButtons.push(button);
    button.setAttribute('aria-label', `Use ${amount} from ${reference}`);
    row.append(copy, button, evidenceDetails('Inspect source', () => event));
    list.append(row);
    button.addEventListener('click', () => {
      if (busy || !session.canEdit()) return;
      if (!rationale.value.trim()) { announce('Explain why this balance evidence is supported.', 'error'); rationale.focus(); return; }
      return run('Recording an auditable balance selection.', async () => {
        session.recordPosition({type:'balance-resolution', accountId:account.accountId, effectiveDate:event.effectiveDate, selectedEventId:event.eventId, candidateEventIds:account.candidateEventIds, reason:rationale.value.trim()});
        render(); announce('Balance selection staged with its reason. Prior evidence is preserved. Save changes to persist it.', 'success');
      }, null, 'select-balance-evidence');
    });
  }
  $('account-conflict').append(card);
}
function renderAccountHoldings(account) {
  const card = node('article', undefined, 'holdings-card');
  card.append(node('h4', `${account.displayName} holdings`, 'visually-hidden'));
  const holdings = account.holdings;
  $('holdings-meta').textContent = holdings ? `${holdings.scope === 'complete' ? 'Complete' : 'Partial'} statement, ${dateLabel(holdings.effectiveDate)}${holdings.stale ? ' · stale' : ''}` : '';
  if (!holdings) card.append(node('p', 'No dated holdings evidence. Transaction rows are not holdings.', 'quiet-placeholder'));
  else {
    const list = node('ul', undefined, 'holding-rows');
    for (const holding of holdings.holdings) {
      const item = node('li'), copy = node('span');
      copy.append(node('strong', holding.symbol), node('small', `${label(holding.assetType)} · ${holding.quantity} units`));
      item.append(copy, node('span', money(holding.valueText, account.currency), 'holding-value'));
      list.append(item);
    }
    card.append(list);
    const reasons = holdings.reasons.filter(reason => reason !== 'partial-holdings');
    card.append(node('p', reasons.length ? reasons.map(reason => COVERAGE_REASONS[reason] || label(reason)).join(' ') : 'Supports the account balance. Never added to it again.', reasons.length ? 'holdings-note warn-text' : 'holdings-note'));
    card.append(evidenceDetails('Inspect dated holdings and valuation', () => account.holdings));
  }
  resolveHoldings(card, account);
  $('holdings-accounts').append(card);
}
// Source review is part of the same in-memory draft and explicit-save path.
// Pagination bounds DOM work without hiding the remaining source evidence.
const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;
function renderActivityList() {
  quickControls.length = 0;
  renderFacets();
  renderActiveFilters();
  const filtered = filtersActive();
  const sort = $('activity-sort').value || 'newest';
  // Phones keep Sort inside the sheet, so a non-default order is also stated here.
  $('filter-count').textContent = `${view.filteredCount} matching activities of ${view.totalCount} in this account and period.` +
    (sort === 'newest' ? '' : ` Sorted by ${SORT_LABELS[sort].toLowerCase()}.`);
  $('clear-activity-filters').hidden = !filtered;
  reviewButtons.clear(); decideButtons.clear();
  $('transaction-rows').replaceChildren();
  const groups = new Map(view.groups.map(group => [group.month, group]));
  const grouped = view.groups.length > 0;
  $('transaction-table-wrap').dataset.grouped = String(grouped);
  let month;
  for (const row of view.rows) {
    const rowMonth = (row.reportingDate ?? row.effectiveDate)?.slice(0, 7) ?? null;
    if (grouped && rowMonth !== month) {
      month = rowMonth;
      $('transaction-rows').append(monthHeader(groups.get(rowMonth), filtered));
    }
    $('transaction-rows').append(transactionRow(row));
    if (quickOpen === row.activityId && session.canEdit()) $('transaction-rows').append(quickReviewRow(row));
  }
  if (quickOpen && !view.rows.some(row => row.activityId === quickOpen)) quickOpen = null;
  $('empty-state').hidden = view.filteredCount > 0;
  if (!view.filteredCount) $('empty-state').textContent = filtered
    ? 'No activities match these filters. Remove a filter or clear the search to see more.'
    : 'No activities match this selection. Change the account, month or search to see other records.';
  $('transaction-table-wrap').hidden = !view.filteredCount;
  const remaining = view.filteredCount - view.rows.length;
  $('page-status').textContent = view.filteredCount ? `Showing ${view.rows.length} of ${view.filteredCount}` : 'No transactions to display';
  $('show-more').hidden = !view.hasMore;
  $('show-more').textContent = `Show ${Math.min(PAGE_ROWS, remaining)} more`;
  const count = activeFilterCount();
  $('filter-badge').hidden = count === 0; $('filter-badge').textContent = String(count);
  $('open-filters').setAttribute('aria-label', count ? `Filters, ${count} active` : 'Filters');
  $('apply-filter-sheet').textContent = view.filteredCount === 1 ? 'Show 1 activity' : `Show ${view.filteredCount} activities`;
}
function monthHeader(group, filtered) {
  const tr = node('tr', undefined, 'month-group'); tr.setAttribute('role', 'row');
  const th = node('th', undefined, 'month-group-cell'); th.setAttribute('role', 'rowheader'); th.setAttribute('scope', 'colgroup'); th.setAttribute('colspan', '5');
  const head = node('div', undefined, 'month-head');
  const title = node('p', undefined, 'month-title');
  title.append(node('strong', group?.month ? monthLabel(group.month) : 'Date unknown'), node('span', plural(group?.count ?? 0, 'activity', 'activities'), 'month-count'));
  const totals = node('p', undefined, 'month-totals');
  const zero = value => /^0+(\.0+)?$/.test(value);
  if (!group || !group.totals.length) totals.append(node('span', 'No posted totals', 'month-note'));
  // Posted transfers count as neither money in nor out; say so rather than show $0.00 pairs.
  else if (group.totals.every(total => zero(total.income) && zero(total.spending))) totals.append(node('span', 'No income or spending', 'month-note'));
  else {
    if (filtered) {
      const basis = node('span', 'Shown', 'month-basis');
      basis.setAttribute('title', 'Totals of the matching posted rows only, not the whole month.');
      totals.append(basis, node('span', ' (matching posted rows only)', 'visually-hidden'));
    }
    for (const total of group.totals) {
      const income = node('span', undefined, 'month-figure figure-in'); income.append(node('span', 'In ', 'month-figure-label'), node('strong', money(total.income, total.currency)));
      const spending = node('span', undefined, 'month-figure figure-out'); spending.append(node('span', 'Out ', 'month-figure-label'), node('strong', money(total.spending, total.currency)));
      totals.append(income, spending);
    }
  }
  if (group?.notCounted) {
    const note = node('span', `${group.notCounted} not counted`, 'month-note');
    note.setAttribute('title', 'Pending, unclassified or unconfirmed activity stays out of totals.');
    totals.append(note);
  }
  head.append(title, totals); th.append(head); tr.append(th);
  return tr;
}
function transactionRow(row) {
  const tr = node('tr', undefined, 'transaction-record'), description = node('td'); tr.setAttribute('role', 'row');
  tr.setAttribute('data-kind', row.activityKind);
  tr.setAttribute('data-review', String(row.needsReview));
  const metadata = node('small', row.accountName, 'transaction-detail');
  const inlineDate = node('span', ` · ${row.reportingDate || 'Unknown date'}`, 'list-date');
  inlineDate.setAttribute('aria-hidden', 'true'); metadata.append(inlineDate);
  description.append(node('strong', row.sourceDescription), metadata);
  const classification = node('td');
  const detailText = row.activityKind === 'transfer' ? transferPath(row) : categoryLabel(row.categoryId);
  classification.append(node('span', label(row.activityKind), 'classification-badge'), node('small', detailText, 'transaction-detail'));
  if (postingLabel(row)) classification.append(node('span', postingLabel(row), 'posting-state'));
  if (row.needsReview) classification.append(node('small', 'Needs review: ' + row.reviewReasons.map(reviewReason).join(', '), 'transaction-detail review-reasons'));
  if (row.reviewReasons.some(reason => INLINE_REASONS.has(reason)) && session.canEdit()) {
    const decide = node('button', quickOpen === row.activityId ? 'Close' : 'Decide', 'decide-button');
    decide.type = 'button'; decide.disabled = busy;
    decide.setAttribute('aria-expanded', String(quickOpen === row.activityId));
    decide.setAttribute('aria-controls', 'quick-review');
    decide.setAttribute('aria-label', `${quickOpen === row.activityId ? 'Close decision for' : 'Decide'} ${row.sourceDescription} on ${row.reportingDate || 'unknown date'}`);
    decide.addEventListener('click', () => toggleQuickReview(row.activityId));
    decideButtons.set(row.activityId, decide);
    classification.append(decide);
  }
  const inspect = node('button', undefined, 'text-button transaction-open'); inspect.type = 'button'; inspect.setAttribute('aria-label', `Open ${row.sourceDescription} on ${row.reportingDate || 'unknown date'}`); inspect.append(chevron());
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
  return tr;
}

// Inline review: type and category for a flagged row without leaving the list.
// Amount, posting status and transfer links stay in the full transaction view.
const quickControls = [];
function quickTypes(row) {
  const sign = typeof row.amountText === 'string' ? (row.amountText.startsWith('-') ? -1 : /^0+(\.0+)?$/.test(row.amountText) ? 0 : 1) : 0;
  if (sign < 0) return ['spending', 'transfer'];
  if (sign > 0) return ['income', 'refund', 'transfer'];
  return [];
}
function toggleQuickReview(activityId) {
  if (busy) return;
  quickOpen = quickOpen === activityId ? null : activityId;
  quickFocus = quickOpen ? 'quick-type' : activityId;
  render();
}
function quickReviewRow(row) {
  quickControls.length = 0;
  const types = quickTypes(row);
  const draft = quickDrafts.get(row.activityId) ?? {
    type: types.includes(row.activityKind) ? row.activityKind : types[0],
    category: row.categoryId ?? '', newCategory: '', newParent: '', transferAccount: row.transferAccountId ?? '', link: false, note: '', noteEdited: false, rule: false};
  quickDrafts.set(row.activityId, draft);
  const tr = node('tr', undefined, 'quick-review'); tr.setAttribute('role', 'row');
  const td = node('td'); td.setAttribute('colspan', '5'); td.setAttribute('role', 'cell');
  const body = node('div', undefined, 'quick-review-body'); body.id = 'quick-review';
  body.setAttribute('role', 'group'); body.setAttribute('aria-label', `Decision for ${row.sourceDescription}`);
  const elsewhere = row.reviewReasons.filter(reason => !INLINE_REASONS.has(reason));
  const fields = node('div', undefined, 'quick-fields');
  const typeLabel = node('label', 'Type'); const type = node('select'); type.id = 'quick-type';
  for (const value of types) { const option = node('option', TYPE_LABELS[value]); option.value = value; type.append(option); }
  type.value = draft.type; typeLabel.append(type);
  const categoryField = node('label', 'Category'); const category = node('select'); category.id = 'quick-category';
  categoryField.append(category);
  const newField = node('label', 'New category name'); const newCategory = node('input'); newCategory.type = 'text'; newCategory.maxLength = 60;
  newCategory.setAttribute('autocomplete', 'off'); newCategory.value = draft.newCategory; newField.append(newCategory);
  const parentField = node('label', 'Inside'); const parent = node('select'); parentField.append(parent);
  // The category list follows the chosen type: income categories for income.
  let filledFor = null;
  const fillCategories = () => {
    if (filledFor === directionFor(type.value)) return;
    filledFor = directionFor(type.value);
    const keep = filledFor === directionFor(draft.type) ? draft.category : '';
    fillCategorySelect(category, filledFor, row.categoryId);
    category.value = keep; if (category.value !== keep) category.value = row.categoryId ?? '';
    fillParentSelect(parent, filledFor, draft.newParent);
  };
  fillCategories();
  const noteField = node('label', 'Note for the history', 'quick-note'); const note = node('textarea'); note.rows = 3; note.maxLength = 300;
  note.setAttribute('autocomplete', 'off'); note.value = draft.note; noteField.append(note);
  const ruleField = node('label', undefined, 'checkbox-field quick-rule'); const rule = node('input'); rule.type = 'checkbox'; rule.checked = draft.rule;
  ruleField.append(rule, node('span', 'Make a rule from this decision'));
  const accountField = node('label', moneyOut(row) ? 'To account' : 'From account'); const account = node('select'); account.id = 'quick-transfer-account';
  addOptions(account, otherAccounts(row), draft.transferAccount, 'Choose an account'); accountField.append(account);
  const linkField = node('label', undefined, 'checkbox-field quick-link'); const link = node('input'); link.type = 'checkbox'; link.id = 'quick-transfer-link'; link.checked = draft.link;
  const linkText = node('span'); linkField.append(link, linkText);
  let candidate = null, candidateFor = null;
  const findCandidate = () => {
    const key = type.value === 'transfer' ? account.value : '';
    if (candidateFor === key) return;
    candidateFor = key;
    candidate = key ? transferCandidates(session.ledger, row.activityId, key)[0] ?? null : null;
    if (candidate) linkText.textContent = `Link with ${candidate.sourceDescription} on ${candidate.effectiveDate} (${money(candidate.amountText, candidate.currency)})`;
  };
  fields.append(typeLabel, accountField, linkField, categoryField, newField, parentField, noteField, ruleField);
  const help = node('p', '', 'field-help quick-help'); help.id = 'quick-help';
  const actions = node('div', undefined, 'quick-actions');
  const stage = node('button', 'Stage decision', 'primary-button'); stage.type = 'button'; stage.setAttribute('aria-describedby', 'quick-help');
  const cancel = node('button', 'Cancel', 'text-button'); cancel.type = 'button';
  const full = node('button', 'Open full view', 'link-button'); full.type = 'button';
  actions.append(stage, cancel, full);
  // A transfer is never income or spending, so it takes no category.
  const choice = () => type.value === 'transfer' ? {categoryId:null, newCategory:null, text:''} : chosenCategory(category, newCategory, parent, directionFor(type.value));
  const linking = () => type.value === 'transfer' && Boolean(candidate) && link.checked;
  const changesCategory = next => Boolean(next.newCategory) || Boolean(next.categoryId && next.categoryId !== row.categoryId);
  const suggested = () => {
    const parts = [], next = choice();
    if (type.value !== row.activityKind) parts.push(`classified as ${typeName(type.value)} (was ${typeName(row.activityKind)})`);
    if (changesCategory(next)) parts.push(`category set to ${next.newCategory ? 'new category ' + next.text : next.text} (was ${categoryName(row.categoryId)})`);
    if (type.value === 'transfer' && account.value && account.value !== (row.transferAccountId ?? '')) parts.push(`${moneyOut(row) ? 'to' : 'from'} ${accountName(account.value)}`);
    if (linking()) parts.push(`linked with ${candidate.sourceDescription} on ${candidate.effectiveDate}`);
    if (!parts.length) return '';
    return `Reviewed in Activity: ${parts.join('; ')}.`;
  };
  const update = () => {
    fillCategories(); findCandidate();
    accountField.hidden = type.value !== 'transfer';
    linkField.hidden = !candidate;
    const next = choice(), categoryChanges = changesCategory(next);
    const namesAccount = type.value === 'transfer' && Boolean(account.value) && account.value !== (row.transferAccountId ?? '');
    ruleField.hidden = !categoryChanges && !namesAccount && type.value === row.activityKind;
    if (ruleField.hidden) rule.checked = false;
    categoryField.hidden = type.value === 'transfer';
    if (!draft.noteEdited) note.value = suggested();
    Object.assign(draft, {type:type.value, category:category.value, newCategory:newCategory.value, newParent:parent.value, transferAccount:account.value, link:link.checked, note:note.value, rule:rule.checked});
    newField.hidden = parentField.hidden = categoryField.hidden || category.value !== NEW_CATEGORY;
    const needsCategory = type.value === 'refund' && !row.originalActivityId && !next.categoryId && !next.newCategory && !row.categoryId;
    const blocked = busy ? 'Wait for the current action to finish.' : !session.canEdit() ? 'Reopen an editable session before staging a decision.'
      : needsCategory ? 'A refund without a linked purchase needs a category.' : category.value === NEW_CATEGORY && !next.newCategory ? 'Enter a category name.'
      : type.value === 'transfer' && !account.value ? 'Choose the account on the other side of this transfer.'
      : !suggested() ? 'Choose a different type or category to stage a decision.'
      : !note.value.trim() ? 'Add a short note for the history.' : '';
    stage.disabled = Boolean(blocked);
    for (const control of [type, account, link, category, newCategory, parent, note, rule, cancel, full]) control.disabled = busy;
    const after = elsewhere.length ? ` Still needs the full view: ${elsewhere.map(reviewReason).join(', ').toLowerCase()}.` : '';
    help.textContent = blocked || ('Staging does not save. The note is filled in from your change; edit it to add your own reason.' + after);
  };
  quickControls.push(update);
  note.addEventListener('input', () => { draft.noteEdited = true; });
  for (const control of [type, account, link, category, newCategory, parent, note, rule]) { control.addEventListener('input', update); control.addEventListener('change', update); }
  cancel.addEventListener('click', () => { quickDrafts.delete(row.activityId); toggleQuickReview(row.activityId); });
  full.addEventListener('click', () => { quickOpen = null; inspectActivity(row.activityId); });
  stage.addEventListener('click', () => {
    if (stage.disabled) return;
    const next = choice();
    const ids = view.rows.filter(item => item.reviewReasons.some(reason => INLINE_REASONS.has(reason))).map(item => item.activityId);
    const following = ids[ids.indexOf(row.activityId) + 1] ?? null;
    return run('Staging the decision locally.', () => {
      session.quickClassify({activityId:row.activityId, activityKind:type.value, categoryId:next.categoryId === (row.categoryId ?? null) ? null : next.categoryId,
        newCategory:next.newCategory, transferAccountId:type.value === 'transfer' ? account.value || null : null,
        linkActivityId:linking() ? candidate.activityId : null, rationale:note.value});
      quickDrafts.delete(row.activityId); quickOpen = null;
      quickFocus = following ?? 'filter-count';
      if (rule.checked) { startRuleFrom(row.activityId); return; }
      render();
      announce('Decision staged locally. Use Save changes to keep it.', 'success');
    }, null, 'stage-correction');
  });
  body.append(fields, help, actions);
  td.append(body); tr.append(td);
  update();
  return tr;
}
function refreshQuickReview() { for (const update of quickControls) update(); }

// Categories page: one list each for spending and income, parents first with
// their subcategories under them. Every change is staged; nothing saves here.
function categoryUseCounts() {
  if (categoryCounts.ledger !== session.ledger) {
    const counts = new Map();
    for (const activity of getEffectiveActivities(session.ledger)) {
      if (activity.active && activity.categoryId) counts.set(activity.categoryId, (counts.get(activity.categoryId) ?? 0) + 1);
    }
    categoryCounts = {ledger:session.ledger, counts};
  }
  return categoryCounts.counts;
}
function renderCategories() {
  categoryControls.length = 0;
  fillParentSelect($('category-add-parent'), $('category-add-direction').value, $('category-add-parent').value);
  for (const direction of ['spending', 'income']) {
    const list = $(`category-list-${direction}`); list.replaceChildren();
    for (const item of catalog().choices(direction)) list.append(categoryItem(item));
  }
}
function categoryButton(text, accessibleName, className = 'text-button') {
  const button = node('button', text, className); button.type = 'button'; button.setAttribute('aria-label', accessibleName);
  return button;
}
function categoryItem(item) {
  const li = node('li', undefined, item.parentId ? 'category-item subcategory' : 'category-item');
  if (categoryEditing === item.id) return categoryEditor(li, item);
  const used = categoryUseCounts().get(item.id) ?? 0, children = catalog().childrenOf(item.id).length;
  const text = node('div', undefined, 'category-text');
  text.append(node('span', item.label, 'category-name'),
    node('small', [plural(used, 'transaction'), children ? plural(children, 'subcategory', 'subcategories') : ''].filter(Boolean).join(' · ')));
  const edit = categoryButton('Edit', `Edit ${item.path}`), remove = categoryButton('Delete', `Delete ${item.path}`, 'text-button danger-text');
  edit.addEventListener('click', () => { if (edit.disabled) return; categoryEditing = item.id; render(); document.getElementById('category-edit-name')?.focus(); });
  remove.addEventListener('click', () => {
    if (remove.disabled) return;
    const question = `Delete ${item.path}?` + (used ? ` Its ${plural(used, 'transaction')} go back to Needs review.` : '') +
      ' Its budget ends from this month. Earlier months keep theirs.';
    if (!window.confirm(question)) { announce('Delete cancelled. The category is unchanged.'); return; }
    return run('Staging the deletion locally.', () => {
      session.manageCategories({type:'delete', categoryId:item.id}, currentMonth());
      render();
      announce(`${item.path} deleted.` + (used ? ` ${plural(used, 'transaction')} moved to Needs review.` : '') + ' Save changes to keep it.', 'success');
    }, 'category-form-status', 'category-delete');
  });
  categoryControls.push(editable => { edit.disabled = remove.disabled = !editable; });
  const actions = node('div', undefined, 'category-actions'); actions.append(edit, remove);
  li.append(text, actions);
  return li;
}
function categoryEditor(li, item) {
  li.className += ' editing';
  const hasChildren = catalog().childrenOf(item.id).length > 0;
  const field = (text, control) => { const wrap = node('label', text); wrap.append(control); return wrap; };
  const name = node('input'); name.id = 'category-edit-name'; name.type = 'text'; name.maxLength = 60; name.value = item.label; name.setAttribute('autocomplete', 'off');
  const direction = node('select');
  for (const [value, text] of [['spending', 'Spending'], ['income', 'Income']]) { const option = node('option', text); option.value = value; direction.append(option); }
  direction.value = item.direction;
  const parent = node('select');
  // A category with subcategories stays a top-level category in its list.
  const fillParents = () => addOptions(parent, hasChildren ? [] : catalog().choices(direction.value).filter(other => !other.parentId && other.id !== item.id).map(other => [other.id, other.label]),
    direction.value === item.direction ? item.parentId ?? '' : '', 'Top level');
  fillParents();
  direction.disabled = hasChildren;
  const save = categoryButton('Save', `Save ${item.label}`, 'primary-button'), cancel = categoryButton('Cancel', 'Cancel editing');
  const changed = () => name.value.trim() && (name.value.trim() !== item.label || direction.value !== item.direction || (parent.value || null) !== item.parentId);
  const update = editable => { save.disabled = !editable || !changed(); for (const control of [name, direction, parent, cancel]) control.disabled = !editable; };
  categoryControls.push(update);
  name.addEventListener('input', refresh); parent.addEventListener('change', refresh);
  direction.addEventListener('change', () => { fillParents(); refresh(); });
  cancel.addEventListener('click', () => { categoryEditing = null; render(); });
  save.addEventListener('click', () => {
    if (save.disabled) return;
    return run('Staging the category change locally.', () => {
      session.manageCategories({type:'define', categoryId:item.id, label:name.value, direction:direction.value, parentId:parent.value || null}, currentMonth());
      categoryEditing = null; render();
      announce(`${catalog().path(item.id)} updated. Save changes to keep it.`, 'success');
    }, 'category-form-status', 'category-edit');
  });
  const actions = node('div', undefined, 'category-actions'); actions.append(save, cancel);
  const fields = node('div', undefined, 'category-editor');
  fields.append(field('Name', name), field('List', direction), field('Inside', parent), actions);
  li.append(fields);
  return li;
}
// Rules page: the ordered rules, an editor with a live match count, and a
// preview that must come before Apply. A rule never changes what you filed.
function currentRuleTargets() {
  if (ruleTargetCache.ledger !== session.ledger) ruleTargetCache = {ledger:session.ledger, targets:ruleTargets(session.ledger)};
  return ruleTargetCache.targets;
}
const accountNames = ids => ids.length ? ids.map(id => session.ledger.accounts.find(account => account.accountId === id)?.displayName ?? 'Unknown account').join(', ') : 'All accounts';
const ruleAction = rule => TYPE_LABELS[rule.activityKind] + (rule.counterpartyAccountId ? ` with ${accountName(rule.counterpartyAccountId)}` : '') + (rule.categoryId ? ` › ${categoryLabel(rule.categoryId)}` : '');
function ruleStatus(rule) {
  if (!rule.enabled) return 'Off';
  if (rule.categoryId && catalog().retired(rule.categoryId)) return 'Off: its category was deleted';
  const count = currentRuleTargets().get(rule.ruleId)?.length ?? 0;
  return count ? `Matches ${plural(count, 'transaction')} that need review` : 'No transaction that needs review matches';
}
function stageRules(commands, message) {
  return run('Staging the rule change locally.', () => {
    session.manageRules(commands); render();
    announce(`${message} Save changes to keep it.`, 'success');
  }, 'rule-form-status', 'rule-change');
}
function renderRules() {
  ruleControls.length = 0;
  const {rules, legacy} = ruleCatalog(session.ledger);
  $('rule-list').replaceChildren(...rules.map(rule => ruleItem(rule, rules)));
  $('rule-empty').hidden = rules.length > 0;
  $('legacy-rules').hidden = !legacy.length;
  $('legacy-rule-list').replaceChildren(...legacy.map(legacyRuleItem));
  const total = [...currentRuleTargets().values()].reduce((sum, items) => sum + items.length, 0);
  $('rules-apply-all').textContent = total ? `Apply all rules (${total})` : 'Apply all rules';
  ruleControls.push(editable => { $('rules-apply-all').disabled = !editable || !total; });
  renderRuleEditor(); renderRulePreview();
}
function ruleItem(rule, rules) {
  const li = node('li', undefined, 'rule-item'), index = rules.indexOf(rule), name = `rule ${rule.position}`;
  const text = node('div', undefined, 'category-text');
  text.append(node('span', `${rule.position}. Description contains "${rule.descriptionContains}"`, 'category-name'),
    node('small', `${accountNames(rule.accountIds)} · files as ${ruleAction(rule)}`), node('small', ruleStatus(rule), 'rule-status'));
  const count = currentRuleTargets().get(rule.ruleId)?.length ?? 0;
  const up = categoryButton('Move up', `Move ${name} up`), down = categoryButton('Move down', `Move ${name} down`);
  const toggle = categoryButton(rule.enabled ? 'Turn off' : 'Turn on', `${rule.enabled ? 'Turn off' : 'Turn on'} ${name}`);
  const edit = categoryButton('Edit', `Edit ${name}`), remove = categoryButton('Delete', `Delete ${name}`, 'text-button danger-text');
  const review = count ? categoryButton(`Review ${count}`, `Review the ${plural(count, 'transaction')} ${name} matches`, 'secondary-button') : null;
  const move = offset => {
    const ids = rules.map(item => item.ruleId);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    return stageRules({type:'order', ruleIds:ids}, `Rule moved to position ${index + offset + 1}.`);
  };
  up.addEventListener('click', () => up.disabled ? null : move(-1));
  down.addEventListener('click', () => down.disabled ? null : move(1));
  toggle.addEventListener('click', () => toggle.disabled ? null : stageRules({type:'define', ruleId:rule.ruleId, descriptionContains:rule.descriptionContains,
    accountIds:rule.accountIds, activityKind:rule.activityKind, categoryId:rule.categoryId, counterpartyAccountId:rule.counterpartyAccountId, enabled:!rule.enabled}, `Rule ${rule.position} turned ${rule.enabled ? 'off' : 'on'}.`));
  edit.addEventListener('click', () => { if (!edit.disabled) openRuleEditor(rule); });
  remove.addEventListener('click', () => {
    if (remove.disabled) return;
    if (!window.confirm(`Delete rule ${rule.position}? Transactions it already filed keep their category.`)) { announce('Delete cancelled. The rule is unchanged.'); return; }
    return stageRules({type:'delete', ruleId:rule.ruleId}, `Rule ${rule.position} deleted.`);
  });
  review?.addEventListener('click', () => { if (!review.disabled) openRulePreview([rule.ruleId]); });
  ruleControls.push(editable => {
    for (const control of [toggle, edit, remove, review].filter(Boolean)) control.disabled = !editable;
    up.disabled = !editable || index === 0; down.disabled = !editable || index === rules.length - 1;
  });
  const actions = node('div', undefined, 'category-actions'); actions.append(...[review, up, down, toggle, edit, remove].filter(Boolean));
  li.append(text, actions);
  return li;
}
function legacyRuleItem(rule) {
  const li = node('li', undefined, 'rule-item'), text = node('div', undefined, 'category-text');
  text.append(node('span', `Description is exactly "${rule.description}"`, 'category-name'),
    node('small', `${accountNames([rule.accountId])} · sets ${categoryLabel(rule.categoryId)}`));
  const edit = categoryButton('Edit', `Edit the rule for "${rule.description}"`), remove = categoryButton('Delete', `Delete the rule for "${rule.description}"`, 'text-button danger-text');
  edit.addEventListener('click', () => {
    if (edit.disabled) return;
    const category = catalog().get(rule.categoryId);
    openRuleEditor({descriptionContains:rule.description.slice(0, 100), accountIds:[rule.accountId], activityKind:category?.direction === 'income' ? 'income' : 'spending',
      categoryId:category ? rule.categoryId : null}, rule.ruleEventId);
  });
  remove.addEventListener('click', () => {
    if (remove.disabled) return;
    if (!window.confirm('Stop this rule for later imports? Transactions it already filed keep their category.')) { announce('Delete cancelled. The rule is unchanged.'); return; }
    return stageRules({type:'retire-legacy', ruleEventId:rule.ruleEventId}, 'Rule stopped for later imports.');
  });
  ruleControls.push(editable => { edit.disabled = remove.disabled = !editable; });
  const actions = node('div', undefined, 'category-actions'); actions.append(edit, remove);
  li.append(text, actions);
  return li;
}
/** Open the editor on a saved rule, a correction rule to widen (`legacyEventId`), a prefilled draft, or nothing. */
function openRuleEditor(rule = null, legacyEventId = null) {
  ruleDraft = {ruleId:rule?.ruleId ?? null, legacyEventId, accountIds:new Set(rule?.accountIds ?? []), categoryId:rule?.categoryId ?? '', counterpartyAccountId:rule?.counterpartyAccountId ?? ''};
  rulePreview = null;
  $('rule-contains').value = rule?.descriptionContains ?? '';
  $('rule-kind').value = rule?.activityKind ?? 'spending';
  render();
  $('rule-editor-title').focus();
}
function renderRuleEditor() {
  $('rule-editor').hidden = !ruleDraft;
  if (!ruleDraft) return;
  $('rule-editor-title').textContent = ruleDraft.ruleId ? 'Edit rule' : ruleDraft.legacyEventId ? 'Widen a correction rule' : 'New rule';
  const boxes = $('rule-accounts'); boxes.replaceChildren();
  for (const account of session.ledger.accounts) {
    const field = node('label', undefined, 'checkbox-field'), input = node('input'); input.type = 'checkbox';
    input.checked = ruleDraft.accountIds.has(account.accountId);
    input.addEventListener('change', () => { if (input.checked) ruleDraft.accountIds.add(account.accountId); else ruleDraft.accountIds.delete(account.accountId); updateRuleMatches(); });
    field.append(input, node('span', account.displayName)); boxes.append(field);
    ruleControls.push(editable => { input.disabled = !editable; });
  }
  addOptions($('rule-category'), catalog().choices(directionFor($('rule-kind').value)).map(item => [item.id, item.path]), ruleDraft.categoryId, 'No category');
  $('rule-transfer-account-field').hidden = $('rule-kind').value !== 'transfer';
  $('rule-category-field').hidden = $('rule-kind').value === 'transfer';
  addOptions($('rule-transfer-account'), session.ledger.accounts.map(account => [account.accountId, account.displayName]), ruleDraft.counterpartyAccountId, 'Not named');
  ruleDraft.categoryId = $('rule-category').value;
  updateRuleMatches();
}
const draftRule = () => ({ruleId:ruleDraft.ruleId ?? 'draft', descriptionContains:$('rule-contains').value.trim(), accountIds:[...ruleDraft.accountIds],
  activityKind:$('rule-kind').value, categoryId:$('rule-kind').value === 'transfer' ? null : $('rule-category').value || null,
  counterpartyAccountId:$('rule-kind').value === 'transfer' ? $('rule-transfer-account').value || null : null, enabled:true});
function updateRuleMatches() {
  const draft = draftRule();
  const count = draft.descriptionContains ? ruleTargets(session.ledger, {draft}).get(draft.ruleId).length : 0;
  $('rule-editor-matches').textContent = !draft.descriptionContains ? 'Enter the text to match.'
    : `Matches ${plural(count, 'transaction')} that need review now.` + (ruleDraft.ruleId ? '' : ' A new rule runs after the others.');
  refresh();
}
function openRulePreview(ruleIds) {
  ruleDraft = null; rulePreview = {ruleIds, count:0};
  render();
  if (rulePreview) $('rule-preview-title').focus();
}
function renderRulePreview() {
  if (rulePreview) {
    const targets = currentRuleTargets(), {rules} = ruleCatalog(session.ledger);
    const rows = rules.filter(rule => !rulePreview.ruleIds || rulePreview.ruleIds.includes(rule.ruleId))
      .flatMap(rule => (targets.get(rule.ruleId) ?? []).map(activity => ({activity, rule})));
    rulePreview.count = rows.length;
    if (!rows.length) rulePreview = null;
    else {
      const single = rulePreview.ruleIds?.length === 1 ? rules.find(rule => rule.ruleId === rulePreview.ruleIds[0]) : null;
      $('rule-preview-title').textContent = `${single ? `Rule ${single.position}` : 'Your rules'} would file ${plural(rows.length, 'transaction')} that need review`;
      const shown = rows.slice(0, 25).map(({activity, rule}) => node('li',
        `${activity.effectiveDate || 'Unknown date'} · ${activity.sourceDescription} · ${money(activity.amountText, activity.currency)} → ${ruleAction(rule)}`));
      if (rows.length > 25) shown.push(node('li', `and ${rows.length - 25} more`, 'field-help'));
      $('rule-preview-list').replaceChildren(...shown);
      $('rule-apply').textContent = `Apply to ${plural(rows.length, 'transaction')}`;
    }
  }
  $('rule-preview').hidden = !rulePreview;
}
/** After a review decision with Make a rule ticked: the editor, filled from that transaction. */
function startRuleFrom(activityId) {
  const activity = getEffectiveActivities(session.ledger).find(item => item.activityId === activityId);
  const kind = ['spending', 'income', 'transfer', 'refund'].includes(activity.activityKind) ? activity.activityKind
    : String(exactSignedDecimal(activity)).startsWith('-') ? 'spending' : 'income';
  pages.go('rules');
  openRuleEditor({descriptionContains:activity.sourceDescription.trim().slice(0, 100), accountIds:[activity.accountId], activityKind:kind,
    categoryId:kind !== 'transfer' && activity.categoryId && !catalog().retired(activity.categoryId) ? activity.categoryId : null,
    counterpartyAccountId:kind === 'transfer' ? activity.transferAccountId ?? null : null});
  announce('Decision staged. Widen the description to the part every matching transaction shares, then save the rule.', 'success');
}
function applyQuickFocus() {
  if (!quickFocus) return;
  const target = quickFocus === 'quick-type' ? document.getElementById('quick-type')
    : quickFocus === 'filter-count' ? $('filter-count') : decideButtons.get(quickFocus) ?? reviewButtons.get(quickFocus);
  quickFocus = null;
  if (target === $('filter-count')) target.setAttribute('tabindex', '-1');
  target?.focus?.();
}

function facetInputs() { return [...$('type-options').children, ...$('category-options').children].map(item => item.children?.[0]).filter(Boolean); }
function facetOption(container, set, {id, count}, text) {
  const option = node('label', undefined, 'facet-option');
  const input = node('input'); input.type = 'checkbox'; input.value = id; input.checked = set.has(id); input.disabled = busy;
  input.addEventListener('change', () => {
    if (busy) return;
    if (input.checked) set.add(id); else set.delete(id);
    listLimit = PAGE_ROWS; render();
  });
  option.append(input, node('span', text, 'facet-option-label'), node('span', String(count), 'facet-option-count'));
  container.append(option);
}
function renderFacets() {
  const facets = view.facets;
  $('type-options').replaceChildren(); $('category-options').replaceChildren();
  const typeIds = new Set(facets.types.map(item => item.id));
  for (const id of activityFilters.types) if (!typeIds.has(id)) facets.types.push({id, count:0});
  for (const item of facets.types) facetOption($('type-options'), activityFilters.types, item, TYPE_LABELS[item.id] ?? label(item.id));
  const categoryIds = new Set(facets.categories.map(item => item.id));
  for (const id of activityFilters.categories) if (!categoryIds.has(id)) facets.categories.push({id, count:0});
  const categories = [...facets.categories].sort((a, b) => Number(a.id === '') - Number(b.id === '') || categoryLabel(a.id).localeCompare(categoryLabel(b.id), 'en'));
  for (const item of categories) facetOption($('category-options'), activityFilters.categories, item, categoryLabel(item.id));
  if (!categories.length) $('category-options').append(node('p', 'No categories in this account and period.', 'facet-empty'));
  const summary = (set, names) => set.size === 0 ? '' : set.size === 1 ? names([...set][0]) : String(set.size);
  $('type-facet-summary').textContent = summary(activityFilters.types, id => TYPE_LABELS[id] ?? label(id));
  $('category-facet-summary').textContent = summary(activityFilters.categories, categoryLabel);
  $('review-facet-count').textContent = String(facets.review);
  $('pending-facet-count').textContent = String(facets.pending);
  $('pending-chip').hidden = facets.pending === 0 && !$('pending-only').checked;
}
function renderActiveFilters() {
  const chips = [];
  const query = $('transaction-search').value.trim();
  if (query) chips.push([`“${query}”`, 'search', () => { $('transaction-search').value = ''; }]);
  for (const id of activityFilters.types) chips.push([TYPE_LABELS[id] ?? label(id), 'type', () => activityFilters.types.delete(id)]);
  for (const id of activityFilters.categories) chips.push([categoryLabel(id), 'category', () => activityFilters.categories.delete(id)]);
  if ($('review-only').checked) chips.push(['Needs review', 'status', () => { $('review-only').checked = false; }]);
  if ($('pending-only').checked) chips.push(['Pending', 'status', () => { $('pending-only').checked = false; }]);
  $('active-filter-chips').replaceChildren();
  chips.forEach(([text, kind, remove], index) => {
    const item = node('li'); item.dataset.kind = kind;
    const button = node('button', undefined, 'active-chip'); button.type = 'button'; button.disabled = busy;
    button.setAttribute('aria-label', `Remove filter: ${kind === 'search' ? 'search ' : ''}${text}`);
    button.append(node('span', text));
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS?.(ns, 'svg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
      const path = document.createElementNS(ns, 'path'); path.setAttribute('d', 'm7 7 10 10M17 7 7 17'); svg.append(path); button.append(svg);
    }
    button.addEventListener('click', () => {
      if (busy) return;
      remove(); listLimit = PAGE_ROWS; render();
      const next = $('active-filter-chips').children[Math.min(index, $('active-filter-chips').children.length - 1)]?.children?.[0];
      (next ?? $('transaction-search')).focus();
    });
    item.append(button); $('active-filter-chips').append(item);
  });
  $('active-filters').hidden = chips.length === 0;
  // Wide screens already show status chips inline; avoid an orphaned Clear all row.
  $('active-filters').dataset.statusOnly = String(chips.length > 0 && chips.every(([, kind]) => kind === 'status'));
}
function closeFacetPanels() {
  for (const id of ['type-facet-toggle', 'category-facet-toggle']) $(id).setAttribute('aria-expanded', 'false');
  openFacet = null;
}
// Phones use one sheet for every filter; wider screens keep the controls inline.
function openFilterSheet() {
  const sheet = $('filter-sheet');
  if (busy || !session.ledger || typeof sheet.showModal !== 'function' || sheet.open) return;
  closeFacetPanels();
  $('filter-sheet-body').append($('activity-facets')); facetsInSheet = true;
  sheet.showModal();
  $('close-filter-sheet').focus();
}
function closeFilterSheet() {
  const sheet = $('filter-sheet');
  if (sheet.open && typeof sheet.close === 'function') sheet.close();
  if (facetsInSheet) { $('facet-home').append($('activity-facets')); facetsInSheet = false; }
}

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
  $('detail-description').textContent = `${detail.account.displayName} · ${activity.effectiveDate || 'Unknown date'} · ${label(activity.lifecycleStatus)} · ${label(activity.activityKind)}${activity.activityKind === 'transfer' ? ' (' + transferPath({...activity, accountName:detail.account.displayName}) + ')' : ''} · ${activity.categoryId ? categoryLabel(activity.categoryId) : 'No category'}${activity.reviewReasons?.length ? '. Needs review: ' + activity.reviewReasons.map(reviewReason).join(', ') : ''}`;
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
      (!activity.transferAccountId || candidate.accountId === activity.transferAccountId) &&
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
    if (run) source.append(node('p', `Declared coverage: ${run.declaredCoverage.start} to ${run.declaredCoverage.end} · import ${label(run.status)}`, 'review-meta'));
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
    entry.append(node('strong', label(event.eventType)), node('p', `Recorded ${recordedLabel(event.recordedAt)}`, 'review-meta'));
    if (event.eventType === 'classification') entry.append(node('p', `${label(event.priorActivityKind)} → ${label(event.activityKind)}`));
    if (event.eventType === 'category-correction') {
      entry.append(node('p', `${event.priorCategoryId || 'No category'} → ${event.categoryId}`));
      const rule = event.prospectiveRule;
      entry.append(node('p', rule?.enabled ? 'Applies to later imports with the same description.' : rule?.version === 2 && rule.requested ? 'Rule requested, but this description is empty, so it applies to this transaction only.' : rule?.version === 2 ? 'This transaction only. No rule for later imports.' : 'This transaction only.', 'field-help'));
    }
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
  addOptions($('transfer-account'), otherAccounts(activity), activity.transferAccountId ?? '', 'Choose an account');
  fillCategorySelect($('category'), directionFor(activity.activityKind), activity.categoryId);
  $('category').value = activity.categoryId && !catalog().retired(activity.categoryId) ? activity.categoryId : '';
  fillParentSelect($('category-new-parent'), directionFor(activity.activityKind)); $('category-new-name').value = '';
  $('amount').value = activity.amountText || '';
  $('posting-status').value = ['posted', 'pending', 'unknown'].includes(activity.lifecycleStatus) ? activity.lifecycleStatus : 'unknown';
  $('posting-date').value = activity.postedDate || '';
  if (activity.lifecycleStatus === 'unknown') $('correction-type').value = 'posting-status-correction';
  // A transfer takes no category, so its category correction is not offered.
  $('correction-type-category').disabled = activity.activityKind === 'transfer';
  if (activity.activityKind === 'transfer' && $('correction-type').value === 'category-correction') $('correction-type').value = 'classification';
  $('correction-rationale').value = ''; $('category-rule').checked = false;
  detailActivity = activity; detailNoteEdited = false;
  detailEditorBaseline = detailEditorValues();
  correctionFields();
refresh(); if (pages.current === 'activity-detail') $('detail-title').focus();
}
function correctionFields() {
  const type = $('correction-type').value;
  $('classification-field').hidden = type !== 'classification';
  $('transfer-account-field').hidden = type !== 'classification' || $('classification').value !== 'transfer' || Boolean(detailActivity?.transferGroupId);
  $('category-field').hidden = type !== 'category-correction';
  $('category-rule-field').hidden = type !== 'category-correction';
  $('category-new-fields').hidden = type !== 'category-correction' || $('category').value !== NEW_CATEGORY;
  $('amount-field').hidden = type !== 'bank-correction';
  $('posting-status-field').hidden = type !== 'posting-status-correction';
  const postingDate = type === 'posting-status-correction' && $('posting-status').value === 'posted';
  $('posting-date-field').hidden = !postingDate;
  $('posting-date').required = postingDate;
  suggestDetailNote();
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
  selectStagedAccount($('balance-account').value);
  session.recordPosition({type:'balance-snapshot', accountId:$('balance-account').value, effectiveDate:$('balance-date').value, amountText:$('balance-amount').value.trim(), basis, source:{kind:basis === 'statement' ? 'statement' : 'manual', reference:$('balance-source').value.trim()}});
  // The staged record is now evidence; the form is ready for the next one.
  for (const id of ['balance-date','balance-amount','balance-source']) $(id).value = '';
  $('balance-editor').open = false;
  render(); announce('Dated balance staged. Source evidence is preserved; resolve any same-date conflict before using it. Save changes to persist.', 'success');
});
action('stage-closure', 'Checking closure evidence locally.', async () => {
  const anchor = session.ledger.positionEvents.find(event => event.eventId === $('closure-anchor').value);
  session.recordPosition({type:'account-closure', accountId:anchor.accountId, effectiveDate:anchor.effectiveDate, balanceEventId:anchor.eventId, source:{kind:'manual', reference:$('closure-source').value.trim()}});
  $('closure-source').value = '';
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
  selectStagedAccount($('holdings-account').value);
  session.recordPosition({type:'holdings-snapshot', accountId:$('holdings-account').value, effectiveDate:$('holdings-date').value, scope:$('holdings-scope').value, source:{kind:'statement',reference:$('holdings-source').value.trim()}, holdings:holdingRows.map(row => ({symbol:row.fields.symbol.value.trim(), assetType:row.fields.assetType.value, quantity:row.fields.quantity.value.trim(), valueText:row.fields.valueText.value.trim()}))});
  for (const id of ['holdings-date','holdings-source']) $(id).value = '';
  holdingRows.length = 0; $('holdings-rows').replaceChildren(); $('holdings-scope').value = 'partial';
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
action('create-ledger', 'Preparing a new copy in a new empty folder. Keep this tab open.', async () => {
  const navigationRevision = pages.revision;
  if (isPrivate()) {
    // A new private database starts empty. It is never seeded with invented data.
    if (session.mode !== 'preview') {
      if ((session.dirty || hasUnfinishedDetail() || hasUnfinishedEvidence()) && !window.confirm('Replace your local draft with a new empty private database? This discards unsaved changes in this tab before folder selection.')) return;
      session.preview(createLedger({dataClass: 'production'}));
    } else if (!confirmDiscardDetail()) return;
    render({ reset: true });
    await session.savePreviewToNewCopy(); render({ reset: true }); if (pages.revision === navigationRevision) pages.go('overview');
    if (session.designationFailed) { announce(designationWarning('Private database created and independently verified')); return true; }
    announce('Private database created in the new folder and independently verified. Add accounts and import supported CSV files, then save.', 'success'); return true;
  }
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
function designationWarning(done) {
  return done + ', but this browser could not record it as the designated private database folder. Any previous designation still applies, so Open will refuse this folder. Allow site storage; to designate this folder, clear this site’s data in the browser, then Open it again.';
}
function recoveryMessage() {
  return ({checking:'Checking what reached Drive. Your draft remains in this tab; keep it open.',saved:'Your draft was found saved and verified. No retry is needed.', 'not-saved':'The save was conclusively not published. Your draft is preserved. Retry only with the explicit confirmation below.',different:'Drive contains different saved records. Your draft is preserved. Do not retry blindly; review the saved copy first.',unverifiable:'The save outcome could not be verified. Your draft is preserved. Recheck when connected; do not retry blindly.'})[session.recoveryOutcome] || 'Save unverified. Your draft remains in this tab. Verify the save outcome before retrying.';
}
async function downloadBackup({excludeStaged=false,saveFirst=false}={}) {
  try {
    const encrypted=$('backup-encrypt').checked, password=encrypted?$('backup-password').value:undefined;
    if (encrypted && !password) fail('backup-password-required');
    if (encrypted && password !== $('backup-password-confirm').value) fail('backup-password-mismatch');
    if (isPrivate() && !encrypted) fail('backup-password-required');
    if (!encrypted && !window.confirm('Download an unencrypted backup? This file contains readable synthetic financial data. Keep it private.')) { announce('Backup cancelled. No file was downloaded.'); return; }
    if (saveFirst) await saveWorkspaceChanges();
    const bytes=await session.exportBackup({password,excludeStaged});
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));
    const link=node('a');link.href=url;link.download=isPrivate()?'finance-tracker-private-backup.json':'finance-tracker-synthetic-backup.json';
    document.body.append(link);
    try {link.click();} finally {link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    announce('Backup download requested. Check your downloads and keep the file safe.'+(excludeStaged?' Staged changes were excluded; your draft is unchanged.':''),'success');return true;
  } finally {$('backup-password').value='';$('backup-password-confirm').value='';}
}
$('backup-encrypt').addEventListener('change',()=>{if (!$('backup-encrypt').checked) {$('backup-password').value='';$('backup-password-confirm').value='';}refresh();});
$('backup-file').addEventListener('change',()=>{refresh();});
$('data-class').addEventListener('change',()=>{
  // A UI choice of class, not authorization: Google OAuth, the private-folder
  // proof and the manifest class still decide what can be opened.
  try { if (session.ledger) fail('release-before-preview'); storage.setDataClass($('data-class').value); announce(isPrivate() ? 'Private database selected. Google account, folder privacy and the saved copy are verified when you connect.' : 'Synthetic test copies selected. Use invented data only.'); }
  catch (error) { $('data-class').value = storage.dataClass; announce(showDiagnostic(error, {surface: 'workspace', target: $('action-status'), page: pages.current}), 'error'); }
  refresh();
});
if (productionReleased) $('release-classes').textContent = 'This release can open a private database · Only the approved build, account and folder may hold real data';
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
  await session.restoreBackupToNewCopy();render({reset:true});
  if (session.designationFailed) { announce(designationWarning('Backup restored to a new copy and independently verified')); return true; }
  announce('Backup restored to a new synthetic copy and independently verified. The original folder was not changed.','success');return true;
});
action('verify-save-outcome','Checking what reached Drive. Your draft stays in this tab.',async()=>{
  await session.resolveUncertainSave();render();
  // Surface why a recheck could not verify (report-safe code, kept in Recent problems).
  if(session.recoveryOutcome==='unverifiable'&&session.recoveryCause)fail(session.recoveryCause);
  announce(recoveryMessage(),session.recoveryOutcome==='saved'?'success':'info');
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
// In a recovery state the save bar leads straight to the recovery actions.
$('draft-status-link').addEventListener('click', event => {
  if (!['unverified', 'recovery'].includes($('draft-bar').dataset.state)) return;
  event.preventDefault?.(); pages.go('storage'); $('recovery-tools').open = true;
  $('recovery-tools').scrollIntoView?.({block:'start'});
  if (!$('verify-save-outcome').disabled) $('verify-save-outcome').focus();
});
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
  const category = detailCategory();
  if ($('correction-type').value === 'category-correction' && $('category').value === NEW_CATEGORY && !category.newCategory) fail('category-name-required');
  session.correct({ activityId: selectedActivity, type: $('correction-type').value, activityKind: $('classification').value, transferAccountId: $('classification').value === 'transfer' ? $('transfer-account').value || null : null, categoryId: category.categoryId, newCategory: category.newCategory, amountText: $('amount').value,
    lifecycleStatus: $('posting-status').value, postedDate: $('posting-status').value === 'posted' ? $('posting-date').value : null, rationale: $('correction-rationale').value,
  });
  if ($('correction-type').value === 'category-correction' && $('category-rule').checked) { startRuleFrom(selectedActivity); return; }
  render(); showDetail(selectedActivity);
  announce(session.mode === 'preview' ? 'Correction added to this local preview only. Source evidence is unchanged.' : 'Correction staged locally. Source evidence is unchanged. Choose Save changes to persist it.', 'success');
});
$('correction-form').addEventListener('submit', event => event.preventDefault());
$('category-add-form').addEventListener('submit', event => event.preventDefault());
action('category-add', 'Staging the new category locally.', async () => {
  session.manageCategories({type:'define', label:$('category-add-name').value, direction:$('category-add-direction').value, parentId:$('category-add-parent').value || null}, currentMonth());
  const created = catalog().get(session.ledger.categoryEvents.at(-1).categoryId);
  $('category-add-name').value = '';
  render();
  announce(`${created.path} added. Save changes to keep it.`, 'success');
});
$('category-add-name').addEventListener('input', refresh);
$('rule-editor').addEventListener('submit', event => event.preventDefault());
$('rule-new').addEventListener('click', () => { if (!$('rule-new').disabled) openRuleEditor(); });
$('rule-cancel').addEventListener('click', () => { ruleDraft = null; render(); $('rule-new').focus(); });
$('rule-contains').addEventListener('input', () => { if (ruleDraft) updateRuleMatches(); });
$('rule-kind').addEventListener('change', () => { if (ruleDraft) renderRuleEditor(); });
$('rule-category').addEventListener('change', () => { if (ruleDraft) { ruleDraft.categoryId = $('rule-category').value; updateRuleMatches(); } });
$('rule-transfer-account').addEventListener('change', () => { if (ruleDraft) { ruleDraft.counterpartyAccountId = $('rule-transfer-account').value; updateRuleMatches(); } });
$('rules-apply-all').addEventListener('click', () => { if (!$('rules-apply-all').disabled) openRulePreview(null); });
$('rule-preview-cancel').addEventListener('click', () => { rulePreview = null; render(); });
action('rule-save', 'Staging the rule locally.', async () => {
  const draft = draftRule(), saved = ruleDraft.ruleId ? ruleCatalog(session.ledger).get(ruleDraft.ruleId) : null;
  const command = {type:'define', descriptionContains:draft.descriptionContains, accountIds:draft.accountIds, activityKind:draft.activityKind, categoryId:draft.categoryId,
    counterpartyAccountId:draft.counterpartyAccountId,
    ...(saved ? {ruleId:saved.ruleId, enabled:saved.enabled} : {})};
  session.manageRules([command, ...(ruleDraft.legacyEventId ? [{type:'retire-legacy', ruleEventId:ruleDraft.legacyEventId}] : [])]);
  const ruleId = saved?.ruleId ?? ruleCatalog(session.ledger).rules.at(-1).ruleId;
  ruleDraft = null;
  const count = currentRuleTargets().get(ruleId)?.length ?? 0;
  rulePreview = count ? {ruleIds:[ruleId], count} : null;
  render();
  announce('Rule saved.' + (count ? ` Check the ${plural(count, 'transaction')} it would file, then choose Apply.` : ' No transaction that needs review matches it now.') + ' Save changes to keep it.', 'success');
});
action('rule-apply', 'Filing transactions by rule locally.', async () => {
  const filed = session.applyRules(rulePreview.ruleIds);
  rulePreview = null; render();
  announce(`${plural(filed, 'transaction')} filed by rule. Save changes to keep them.`, 'success');
});
$('category-add-direction').addEventListener('change', () => { fillParentSelect($('category-add-parent'), $('category-add-direction').value); refresh(); });
$('close-detail').addEventListener('click', () => {
  if (busy || !confirmDiscardDetail()) return;
  pages.closeDetail();
  if (pages.current === 'transactions') (reviewButtons.get(selectedActivity) || $('transaction-search')).focus();
  else if (pages.current === 'overview') (homeButtons.get(selectedActivity) || $('page-title')).focus();
  else $('page-title').focus();
  selectedActivity = null; detailEditorBaseline = null; detailActivity = null; refresh();
});
$('correction-type').addEventListener('change', correctionFields);
$('posting-status').addEventListener('change', correctionFields);
$('posting-date').addEventListener('input', refresh);
$('correction-rationale').addEventListener('input', () => { detailNoteEdited = true; refresh(); });
$('category').addEventListener('change', correctionFields);
$('classification').addEventListener('change', correctionFields);
$('transfer-account').addEventListener('change', suggestDetailNote);
for (const id of ['classification', 'category', 'category-new-name', 'category-new-parent', 'amount', 'posting-date', 'category-rule']) {
  $(id).addEventListener('input', suggestDetailNote); $(id).addEventListener('change', suggestDetailNote);
}
$('transfer-counterparty').addEventListener('change', refresh);
$('transfer-link-rationale').addEventListener('input', refresh);
for (const id of ['account-filter', 'month-filter', 'review-only', 'pending-only', 'activity-sort']) $(id).addEventListener('change', () => { if (!busy) { page = 0; listLimit = PAGE_ROWS; render(); } });
for (const id of ['type-facet-toggle', 'category-facet-toggle']) $(id).addEventListener('click', () => {
  if (busy) return;
  const open = openFacet !== id;
  closeFacetPanels();
  if (!open) return;
  $(id).setAttribute('aria-expanded', 'true'); openFacet = id;
  $(id === 'type-facet-toggle' ? 'type-options' : 'category-options').children[0]?.children?.[0]?.focus?.();
});
// A facet panel closes on Escape or a press outside it, returning focus to its toggle.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!openFacet) return;
  const toggle = $(openFacet);
  event.preventDefault?.(); closeFacetPanels(); toggle.focus();
});
document.addEventListener('pointerdown', event => {
  if (!openFacet || !event.target?.closest || event.target.closest('.facet')) return;
  closeFacetPanels();
});
$('open-filters').addEventListener('click', openFilterSheet);
$('close-filter-sheet').addEventListener('click', () => { closeFilterSheet(); $('open-filters').focus(); });
$('apply-filter-sheet').addEventListener('click', () => { closeFilterSheet(); $('filter-count').setAttribute('tabindex', '-1'); $('filter-count').focus(); });
$('filter-sheet').addEventListener('close', () => closeFilterSheet());
$('filter-sheet').addEventListener('click', event => { if (event.target === $('filter-sheet')) { closeFilterSheet(); $('open-filters').focus(); } });
$('clear-sheet-filters').addEventListener('click', () => { if (busy || !session.ledger) return; cancelSearch(); $('transaction-search').value = ''; resetActivityFilters(); render(); });
window.matchMedia?.('(min-width: 761px)')?.addEventListener?.('change', event => { if (event.matches) closeFilterSheet(); });
$('show-more').addEventListener('click', () => {
  if (busy || !view?.hasMore) return;
  const first = view.rows.length;
  listLimit += PAGE_ROWS; render();
  // Continue from the first newly shown row instead of jumping back to the top.
  const nextRow = view.rows[first];
  if (nextRow) reviewButtons.get(nextRow.activityId)?.focus();
});
$('transaction-search').addEventListener('input', scheduleSearch);
$('clear-activity-filters').addEventListener('click', () => {
  if (busy || !session.ledger) return;
  cancelSearch(); $('transaction-search').value = ''; resetActivityFilters(); page = 0; render(); $('transaction-search').focus();
});
// Escape is the keyboard path back from a transaction, like the Back button.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || pages.current !== 'activity-detail' || $('close-detail').disabled) return;
  if (event.target?.closest?.('select')) return;
  event.preventDefault(); $('close-detail').click();
});
$('transaction-search').addEventListener('compositionstart', () => { composingSearch = true; cancelSearch(); });
$('transaction-search').addEventListener('compositionend', () => { composingSearch = false; scheduleSearch(); });
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
    const filed = session.lastImportFiledCount ? ` Rules filed ${plural(session.lastImportFiledCount, 'transaction')}.` : '';
    announce(`Supported CSV import staged locally.${filed} Review unresolved rows, then use the workspace explicit save action when ready.`, 'success');
  }
});
historicalSummaryWorkflow = mountHistoricalMonthlySummaryWorkflow({
  root: $('historical-summary-workflow'),
  getLedger: () => session.ledger,
  isActive: () => pages.current === 'storage',
  getUnavailableReason: () => {
    if (busy || session.busy) return 'Wait for the current workspace or storage action to finish.';
    if (!session.ledger) return 'Open your saved data before staging history.';
    if (session.unverified) return 'Verify the save outcome before staging history.';
    if (session.needsReopen) return 'Reconnect and reopen the verified ledger before staging history.';
    if (!session.canEdit()) return 'This ledger is read-only. Reopen it before staging history.';
    return null;
  },
  getFileReviewUnavailableReason: () => isPrivate() ? 'File review is for invented test data only. Use History migration to add history to your private database.' : null,
  stageSummaries: proposal => session.stageHistoricalSummaries(proposal),
  stageReconciliation: proposal => session.stageHistoricalReconciliation(proposal),
  onStaged: message => { render(); refresh(); announce(message,'success'); },
  migration: {
    root: $('history-migration'), homeLink: $('home-migration-link'),
    getSavedLedger: () => session.baselineLedger,
    isActive: () => pages.current === 'migration'
  }
});
planningPage = mountPlanning({document, root: $('planning-root'), homeRoot: $('home-budget'), money, monthLabel,
  isActive: () => pages.current === 'planning',
  getUnavailableReason: () => {
    if (busy || session.busy) return 'Wait for the current workspace or storage action to finish.';
    if (!session.ledger) return 'Open your saved data before changing budgets.';
    if (navigator.onLine === false) return 'Reconnect before staging changes to a saved ledger.';
    if (session.unverified) return 'Verify the save outcome before staging budgets.';
    if (session.needsReopen) return 'Reconnect and reopen the verified ledger before staging budgets.';
    if (!session.canEdit()) return 'This ledger is read-only. Reopen it before staging changes.';
    return null;
  },
  stage: (commands, message) => { session.recordPlanning(commands); render(); refresh(); announce(message, 'success'); },
  // A projection gap opens that account's month in Accounts, where its next steps are.
  onOpenAccount: (accountId, month) => {
    pages.go('position');
    if (!positionReport?.accounts.some(account => account.accountId === accountId)) return;
    selectAccount(accountId, {navigate:true});
    selectedCoverageMonth = month; paneKey = null; renderAccountPane();
  }});
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
