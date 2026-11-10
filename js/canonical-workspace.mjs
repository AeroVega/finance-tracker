import { DashboardSyntheticStorage } from './dashboard-synthetic-storage.mjs';
import { CanonicalWorkspaceSession } from './canonical-workspace-session.mjs';
import { createWorkspaceViewReader, getWorkspaceActivity } from './canonical-workspace-model.mjs';
import { getEffectiveActivities } from './canonical-import.mjs';
import { exactSignedDecimal } from './import-reconciliation.mjs';
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
  'release-unconfirmed': 'Release was not verified. Keep this copy selected and resolve its session before switching devices.'
};
function announce(text, kind = 'info') {
  $('action-status').textContent = text; $('action-status').dataset.kind = kind;
}
function refresh() {
  const lifecycle = storage.lifecycle;
  const ready = session.ready(), editable = !busy && session.canEdit();
  $('open-ledger').disabled = busy || !configured || navigator.onLine === false;
  $('open-ledger').textContent = lifecycle ? 'Reconnect saved copy' : 'Open saved synthetic year';
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
  else if (session.mode === 'preview') text = session.dirty ? 'Local preview changes only. They cannot be saved to Drive.' : 'Local preview only. Open your saved copy to make changes that you can save.';
  else if (session.dirty) text = `${session.stagedHistory.length} staged change(s). ${session.canSave() ? 'Save when you are ready.' : 'Saving is blocked. Reconnect and reopen before continuing.'}`;
  else if (session.needsReopen) text = 'Read-only last loaded records. Reconnect or reopen before editing.';
  else text = session.ledger ? 'All changes saved and verified.' : 'No ledger loaded. Open your saved year or try a local preview.';
  if ($('save-state').textContent !== text) $('save-state').textContent = text;
  $('save-state').dataset.state = session.unverified ? 'unverified' : session.dirty ? 'dirty' : busy ? 'busy' : 'clean';
  $('data-mode').dataset.mode = session.mode;
  $('data-mode').textContent = session.mode === 'preview' ? 'Synthetic local preview' : session.ledger ? (session.needsReopen ? 'Synthetic · read-only' : 'Synthetic saved copy') : 'Synthetic workspace';
}
async function run(message, operation) {
  if (busy) return;
  // Apply a queued query before an action so cancellation leaves rows and input aligned.
  if (searchTimer !== null) { cancelSearch(); page = 0; render(); }
  busy = true; operationStarted = Date.now(); refresh(); announce(message);
  const timer = setInterval(refresh, 1000);
  try { await operation(); }
  catch (error) {
    const candidate = error?.code || (error instanceof TypeError ? error.message : '');
    // Provider details and arbitrary codes are not safe user-facing diagnostics.
    const message = Object.hasOwn(messages, candidate) ? messages[candidate] : 'Action did not complete. Check the connection and available recovery actions.';
    announce(message + (session.dirty ? ' Your staged changes remain in this tab.' : ''), 'error');
  } finally { clearInterval(timer); busy = false; operationStarted = null; refresh(); }
}
const action = (id, message, callback) => $(id).addEventListener('click', () => {
  if (!$(id).disabled) return run(message, callback);
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
  if (reset) { page = 0; selectedActivity = null; $('transaction-search').value = ''; $('review-only').checked = false; $('account-filter').value = ''; $('month-filter').value = ''; $('activity-detail').hidden = true; }
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
  $('coverage-summary').textContent = `${view.coverage.importCount} import runs. Latest source activity: ${view.coverage.latestActivityDate || 'unavailable'}. Coverage has not been reconciled. Imported dates do not prove complete history.`;
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
  refresh();
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
