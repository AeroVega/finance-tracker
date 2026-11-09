import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
import { DashboardSyntheticStorage } from '../js/dashboard-synthetic-storage.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { exportCatalogArchive, verifyCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyReviewDecision, applyFinancialEvent, reverseReviewDecision, getEffectiveActivities, summarizeLedger, createLedgerSessionOwner } from '../js/canonical-import.mjs';

const $ = id => document.getElementById(id);
const fixtures = Object.freeze({
  'wells-foundation': ['../fixtures/pr28/wells-fargo-foundation.csv', 'wells-fargo-csv-v1'],
  'wells-review': ['../fixtures/pr28/wells-fargo-review.csv', 'wells-fargo-csv-v1'],
  'wells-future': ['../fixtures/pr28/wells-fargo-future-coffee.csv', 'wells-fargo-csv-v1'],
  'wells-fargo': ['../fixtures/wells-fargo.csv', 'wells-fargo-csv-v1'],
  sofi: ['../fixtures/sofi.csv', 'sofi-csv-v1'],
  fidelity: ['../fixtures/fidelity.csv', 'fidelity-accounts-history-csv-v1']
});
let pauseAfterFirstWrite = false;
let busy = false, configured = false, ledger = null, store = null, parsed = null, dirty = false;
let saveState = 'idle';
// Owned, frozen local proposals are separate from the storage write authority.
// A cache never establishes ownership or bypasses the store's verified save.
const sessionOwner = createLedgerSessionOwner();
let ledgerSession = null, sessionBoundary = null, cacheRequiresVerifiedOpen = false;
function invalidateLedgerSession(requireVerifiedOpen = false) {
  if (requireVerifiedOpen) cacheRequiresVerifiedOpen = true;
  sessionOwner.invalidate(); ledgerSession = null; sessionBoundary = null;
}
function currentLedgerSession() {
  const lifecycle = storage.lifecycle;
  if (ledgerSession && (sessionBoundary.store !== store || sessionBoundary.base !== store?.base ||
      sessionBoundary.lifecycle !== lifecycle || lifecycle?.state !== 'ready' ||
      !lifecycle.acceptingWrites || navigator.onLine === false)) invalidateLedgerSession(true);
  if (ledgerSession) {
    // A failed cache reconstruction can close the handle without publishing a
    // partial draft. The ordinary validated path remains available.
    try { ledgerSession.revision(); } catch { invalidateLedgerSession(); }
  }
  return ledgerSession;
}
function openLedgerSession() {
  invalidateLedgerSession();
  const lifecycle = storage.lifecycle, base = store?.base;
  if (cacheRequiresVerifiedOpen || !ledger || !base || lifecycle?.state !== 'ready' || !lifecycle.acceptingWrites || navigator.onLine === false) return;
  // The exact verified base is retained by reference for cheap invalidation.
  // This label is descriptive binding, not a reusable authorization token.
  const binding = JSON.stringify([base.databaseId, base.copyId, base.revision, lifecycle.folderId]);
  try {
    ledgerSession = sessionOwner.open(JSON.stringify(ledger), binding);
    sessionBoundary = { store, base, lifecycle };
    ledger = ledgerSession.snapshot();
  } catch {
    // An optional cache must not relabel an independently verified save as a
    // failure. Retain the ledger and let the ordinary path validate/read it.
    invalidateLedgerSession();
  }
}
let savedAuditEvents = 0, lastStagedAction = null;
let mappingForms = [];
let previewGeneration = 0, parsedFixture = null;
let acceptanceListener = null;
const REVIEW_PAGE_SIZE = 10, MATCH_PAGE_SIZE = 50;
let reviewPage = 0, decisionPage = 0;
const reviewDrafts = new Map(), reversalDrafts = new Map();
function resetReviewState() { reviewPage = 0; decisionPage = 0; reviewDrafts.clear(); reversalDrafts.clear(); }
const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const inputMessages = Object.freeze({
  'account-mapping-required': 'Choose a destination for every source account.',
  'coverage-dates-required': 'Choose both declared coverage dates for every account.',
  'coverage-order-invalid': 'Declared end must be on or after declared start.',
  'coverage-confirmation-required': 'Confirm the declared coverage for every account.',
  'currency-required': 'Enter an explicit three-letter ISO currency such as USD. No currency is assumed.',
  'review-reversal-dependency': 'This decision has later changes that depend on it. It cannot be returned to review automatically.',
  'account-name-required': 'Enter a name for each new invented account.',
  'distinct-account-required': 'Map each source account to a distinct destination account.',
  'evidence-required': 'Enter evidence and a rationale for this change.',
  'review-rationale-required': 'Enter a rationale for this review decision.',
  'match-target-required': 'Choose an activity to match.',
  'reconnect-required': 'Reconnect before changing review decisions.',
  'preview-required': 'Preview the currently selected fixture and map its accounts before staging.',
  'unknown-fixture': 'Choose one of the bundled invented fixtures.',
  'fixture-unavailable': 'The bundled fixture could not be loaded. Try again when connected.'
});
function inputError(code) { throw Object.assign(new Error(code), { code }); }
function recordCounts() { return `${ledger.accounts.length} accounts, ${ledger.imports.length} import runs, ${ledger.observations.length} source observations, ${ledger.activities.length} activities, ${ledger.events.length} audit events, and ${ledger.reviewDecisions.length} review decisions.`; }
const message = (text, error = false) => { $('result').textContent = text; $('result').dataset.error = String(error); };
function refreshSaveStatus(ready) {
  let state, text;
  if (saveState === 'paused') {
    state = 'paused'; text = 'Interruption test paused. This is not a verified save. For this rehearsal only, close the tab as instructed in Save and reopen.';
  } else if (saveState === 'saving') {
    state = 'saving'; text = 'Saving and verifying changes. One checkpoint can take several minutes. Keep this tab open until verification finishes.';
  } else if (saveState === 'unverified') {
    state = 'unverified'; text = 'Save did not finish and verify. ' + (dirty ? 'Your staged changes are still in this tab. ' : '') + 'Use recovery if offered, then reopen verified saved records before retrying.';
  } else if (dirty) {
    state = 'dirty'; text = 'Unsaved changes. ' + (busy ? 'An operation is in progress. Keep this tab open.' : ready && store ? 'Choose Save canonical ledger before leaving this page.' : 'Saving is unavailable. Check the connection controls and keep this tab open.');
  } else if (busy) {
    state = 'busy'; text = 'Operation in progress. Keep this tab open until it finishes.';
  } else {
    state = ledger ? 'clean' : 'empty'; text = ledger ? 'No unsaved changes. This is a new empty ledger or verified saved records.' : 'No ledger loaded. Connect a synthetic folder to begin.';
  }
  $('save-status').dataset.state = state;
  // Heartbeats and other refreshes must not repeat an unchanged announcement.
  for (const id of ['save-status-text', 'dirty']) if ($(id).textContent !== text) $(id).textContent = text;
  $('show-save').hidden = !dirty && saveState !== 'unverified';
  $('show-save').textContent = dirty ? 'Review and save changes' : 'Review save status';
}
function refresh() {
  currentLedgerSession();
  const lifecycle = storage.lifecycle;
  const ready = lifecycle?.state === 'ready' && lifecycle.acceptingWrites && navigator.onLine !== false;
  for (const control of (document.getElementById('workbench') || document).querySelectorAll('button,input,select')) control.disabled = busy || control.dataset.pageBoundary === 'true';
  $('connect').disabled = busy || !configured;
  $('stale').disabled = busy || lifecycle?.state !== 'stale-session';
  $('recover').disabled = busy || lifecycle?.state !== 'recovery-required' || !lifecycle?.coordinator?.canWrite;
  $('release').disabled = busy || !lifecycle?.coordinator?.canWrite;
  for (const id of ['parse', 'reopen']) $(id).disabled = busy || !ready || !store;
  $('stage').disabled = busy || !ready || !store || !parsed || parsedFixture !== $('fixture').value || !ledger;
  $('save').disabled = busy || !ready || !store || !ledger || !dirty;
  if ($('pause-canonical')) $('pause-canonical').disabled = $('save').disabled;
  const repeated = repeatsLastAction();
  $('event').disabled = busy || !ready || !store || !$('activity').value || repeated;
  $('event').textContent = repeated ? 'This action is already ' + lastActionState() : 'Stage auditable change';
  $('repeat-event').hidden = !repeated;
  $('repeat-event').disabled = busy || !ready || !store || !repeated;
  const eventCount = ledger ? `${ledger.events.length} audit events in this ledger. ${Math.max(0, ledger.events.length - savedAuditEvents)} audit events not yet saved.` + (dirty ? ' Unsaved local changes remain. Save before leaving.' : ' No unsaved changes.') : 'No ledger loaded.';
  if ($('event-count').textContent !== eventCount) $('event-count').textContent = eventCount;
  $('summarize').disabled = busy || !ledger;
  acceptanceListener?.({ ready: Boolean(ready && store && ledger && !dirty), connected: Boolean(ready && store && ledger), busy, dirty, saveState, lifecycleState: lifecycle?.state || 'disconnected', sessionActive: Boolean(lifecycle?.started || lifecycle?.coordinator?.canWrite || lifecycle?.releasePending) });
  refreshSaveStatus(ready);
}
const storage = new DashboardSyntheticStorage({
  onStatus: status => { $('connection').textContent = status.message === 'Synthetic storage connected. CSV imports remain local to this page.' ? 'Synthetic storage connected. Staged changes remain local until you choose Save canonical ledger.' : status.message; refresh(); },
  afterMutation: async () => {
    if (!pauseAfterFirstWrite) return;
    pauseAfterFirstWrite = false;
    saveState = 'paused'; refresh();
    message('PAUSED after the first durable write of this canonical save. Fully close this tab now. Reopen this testing page, reconnect to the same disposable folder, recover only when offered, then reopen verified saved records. This pause is not a successful save.');
    // Explicit synthetic rehearsal only. No subsequent transaction write proceeds.
    await new Promise(() => {});
  }
});
async function run(operation, feedbackId = null) {
  if (busy) return;
  busy = true; refresh();
  if (feedbackId) { $(feedbackId).dataset.error = 'false'; $(feedbackId).textContent = 'Checking and staging locally…'; }
  try { await operation(); }
  catch (error) {
    const candidate = error.code || (error instanceof TypeError ? error.message : '');
    const code = typeof candidate === 'string' && /^[a-z][a-z0-9-]{0,95}$/.test(candidate) ? candidate : 'invalid-input-or-unavailable';
    const failure = (inputMessages[code] || 'Action did not complete: ' + code + '. Check inputs or reconnect and reopen before retrying.') + (dirty ? ' Staged changes remain in this tab.' : '');
    message(failure, true);
    if (feedbackId) { $(feedbackId).textContent = failure; $(feedbackId).dataset.error = 'true'; }
  }
  finally { busy = false; refresh(); }
}
function action(id, operation, feedbackId = null) { $(id).addEventListener('click', () => run(operation, feedbackId)); }
function changed(next) { invalidateLedgerSession(); if (ledger?.ledgerId !== next.ledgerId) resetReviewState(); ledger = next; dirty = true; openLedgerSession(); return renderLedger(); }
function option(select, value, label) { const node = element('option', label); node.value = value; select.append(node); }
function labelled(parent, text, node) { const label = element('label', text); label.append(node); parent.append(label); return node; }
function lazyEvidence(title, records) {
  const details = element('details'); details.append(element('summary', title));
  let rendered = false;
  details.addEventListener('toggle', () => {
    if (!details.open || rendered) return;
    details.append(element('pre', JSON.stringify(records(), null, 2))); rendered = true;
  });
  return details;
}
function pageIndex(page, count, size) { return Math.max(0, Math.min(page, Math.ceil(count / size) - 1)); }
function pageControls(parent, title, page, count, size, navigate) {
  const last = Math.max(0, Math.ceil(count / size) - 1), nav = element('nav');
  nav.className = 'review-pagination'; nav.setAttribute('aria-label', title + ' pages');
  const status = element('p', `${title}: ${count ? page * size + 1 : 0}–${Math.min((page + 1) * size, count)} of ${count}. Page ${page + 1} of ${last + 1}.`);
  status.tabIndex = -1; status.setAttribute('role', 'status'); nav.append(status);
  for (const [label, destination, boundary] of [['First', 0, page === 0], ['Previous', page - 1, page === 0], ['Next', page + 1, page === last], ['Last', last, page === last]]) {
    const button = element('button', label); button.type = 'button';
    button.setAttribute('aria-label', title + ' ' + label.toLowerCase() + ' page');
    button.dataset.pageBoundary = String(boundary); button.disabled = busy || boundary;
    button.addEventListener('click', () => { if (!busy && !boundary) navigate(destination); }); nav.append(button);
  }
  parent.append(nav); return status;
}
function calendar(parent, title, initialMonth) {
  const root = element('div'); root.className = 'calendar'; parent.append(root);
  const input = labelled(root, title, element('input')); input.type = 'date'; input.required = true;
  let month = new Date(initialMonth + '-01T00:00:00Z');
  const display = element('div'); root.append(display);
  function draw() {
    display.replaceChildren();
    const header = element('header'), prev = element('button', '‹'), next = element('button', '›');
    prev.type = next.type = 'button'; prev.setAttribute('aria-label', title + ' previous month'); next.setAttribute('aria-label', title + ' next month');
    const heading = element('strong', month.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
    header.append(prev, heading, next); display.append(header);
    const days = element('div'); days.className = 'days';
    for (const day of ['S','M','T','W','T','F','S']) days.append(element('span',day));
    for (let i=0;i<month.getUTCDay();i++) days.append(element('span'));
    const last = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
    for (let day=1;day<=last;day++) {
      const value = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),day)).toISOString().slice(0,10);
      const button = element('button', String(day)); button.type = 'button'; button.setAttribute('aria-label', title + ' ' + value); button.setAttribute('aria-pressed', String(input.value === value));
      button.addEventListener('click', () => { input.value = value; draw(); display.querySelector(`[aria-label="${title} ${value}"]`)?.focus(); }); days.append(button);
    }
    prev.addEventListener('click', () => { month.setUTCMonth(month.getUTCMonth()-1); draw(); display.querySelector('button').focus(); });
    next.addEventListener('click', () => { month.setUTCMonth(month.getUTCMonth()+1); draw(); display.querySelectorAll('header button')[1].focus(); });
    display.append(days);
  }
  input.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(input.value)) month = new Date(input.value.slice(0,7)+'-01T00:00:00Z'); draw(); });
  draw(); return input;
}
function clearPreview() {
  previewGeneration += 1;
  parsed = null; parsedFixture = null; mappingForms = [];
  $('mappings').replaceChildren();
  $('preview').textContent = 'Choose Preview fixture to inspect the selected source. Existing staged ledger changes are unchanged.';
  refresh();
}
function renderMappings() {
  $('mappings').replaceChildren(); mappingForms = [];
  for (const key of parsed.sourceAccountKeys) {
    const fieldset = element('fieldset'); fieldset.append(element('legend', 'Source account: '+key));
    const select = labelled(fieldset, 'Explicit destination account', element('select'));
    option(select,'','Choose an account'); option(select,'new','Create invented account');
    for (const account of ledger.accounts.filter(a => a.institutionId === parsed.institutionId)) option(select, account.accountId, account.displayName);
    const name = labelled(fieldset, 'New invented account name', element('input')); name.placeholder = 'Invented checking';
    const currency = labelled(fieldset, 'New account ISO currency, explicitly confirmed by you', element('input')); currency.placeholder = 'For example USD'; currency.maxLength = 3;
    const type = labelled(fieldset, 'New account type', element('select'));
    for (const value of ['checking','savings','credit-card','brokerage','retirement']) option(type,value,value);
    const hint = element('p', 'Scroll sideways to see both calendars on a narrow screen. Each calendar has its own month controls.');
    hint.id = 'calendar-hint-' + mappingForms.length; fieldset.append(hint);
    const calendars = element('div'); calendars.className = 'calendars'; calendars.tabIndex = 0;
    calendars.setAttribute('role', 'region'); calendars.setAttribute('aria-label', 'Declared coverage calendars for source account ' + key);
    calendars.setAttribute('aria-describedby', hint.id); fieldset.append(calendars);
    const start = calendar(calendars,'Declared start', '2026-01'), end = calendar(calendars,'Declared end','2026-03');
    const confirm = labelled(fieldset,'I confirm these declared inclusive dates for this account. They do not prove complete history.',element('input')); confirm.type = 'checkbox';
    $('mappings').append(fieldset); mappingForms.push({key,select,name,currency,type,start,end,confirm});
  }
}
async function loadLedger() {
  invalidateLedgerSession(true);
  const nextStore = new CanonicalLedgerStore({ lifecycle: storage.lifecycle });
  const savedLedger = await nextStore.load(), nextLedger = savedLedger || createLedger();
  store = nextStore; ledger = nextLedger; cacheRequiresVerifiedOpen = false; openLedgerSession(); savedAuditEvents = ledger.events.length;
  lastStagedAction = null; resetReviewState(); dirty = false; saveState = 'idle';
  $('event-result').textContent = savedLedger ? 'Verified saved ledger loaded. Choose an activity to stage an auditable change.' : 'No saved canonical ledger yet. Stage an invented import to begin.';
  $('event-result').dataset.error = 'false';
  $('stage-result').textContent = 'No unsaved import from this session. Preview a fixture to continue.';
  $('stage-result').dataset.error = 'false';
  clearPreview(); renderLedger();
  message(savedLedger ? 'Saved canonical records independently reopened and verified. ' + recordCounts() : 'Connected to an empty synthetic ledger. No canonical records are saved yet.');
  return Boolean(savedLedger);
}
async function saveLedger(next = ledger) {
  // Invalidate before the first await, including no-op or failed saves. The
  // frozen draft remains readable, but a failed save cannot reuse its cache.
  invalidateLedgerSession(true);
  saveState = 'saving'; refresh();
  try {
    const saved = await store.save(next);
    ledger = saved; cacheRequiresVerifiedOpen = false; openLedgerSession(); savedAuditEvents = saved.events.length; dirty = false; saveState = 'idle'; renderLedger();
    $('event-result').textContent = `${saved.events.length} audit events saved and verified. No unsaved changes.`; $('event-result').dataset.error = 'false';
    $('stage-result').textContent = 'Imports saved and verified. Preview a fixture to stage another import.'; $('stage-result').dataset.error = 'false';
    return saved;
  } catch (error) {
    // A rejected or interrupted save is not evidence that nothing reached Drive.
    // Keep the staged ledger until a verified save or explicit reopen succeeds.
    saveState = 'unverified'; refresh(); throw error;
  }
}
action('connect', async () => { if (dirty && !confirm('Discard unsaved local changes and connect?')) return; invalidateLedgerSession(true); store=null; await storage.connect(); if (storage.lifecycle?.state === 'ready') await loadLedger(); });
action('stale', async () => { if (confirm('Confirm all prior tabs and devices using this synthetic folder have stopped.')) { invalidateLedgerSession(true); await storage.recoverStaleSession(); if (!dirty || confirm('Session recovered. Discard unsaved local changes and reopen?')) await loadLedger(); } });
action('recover', async () => { invalidateLedgerSession(true); await storage.lifecycle.recover(); if (!dirty || confirm('Recovery completed. Discard unsaved local changes and reopen?')) await loadLedger(); });
action('release', async () => { if (dirty && !confirm('Release without saving local changes? They remain in this tab only.')) return; invalidateLedgerSession(true); await storage.release(); store=null; });
action('parse', async () => {
  clearPreview();
  const generation = previewGeneration, fixtureKey = $('fixture').value;
  const fixture = fixtures[fixtureKey]; if (!fixture) inputError('unknown-fixture');
  const response = await fetch(new URL(fixture[0],import.meta.url),{cache:'no-store'}); if (!response.ok) inputError('fixture-unavailable');
  const nextParsed = await parseProviderCsv({bytes:new Uint8Array(await response.arrayBuffer()),sourceFormat:fixture[1]});
  if (generation !== previewGeneration || fixtureKey !== $('fixture').value) return;
  parsed = nextParsed; parsedFixture = fixtureKey;
  $('preview').textContent = `${parsed.records.length} recognized records; ${parsed.rowsSeen} rows seen; ${parsed.ignoredCount} ignored; ${parsed.sourceAccountKeys.length} source accounts. Nothing imported yet.`;
  renderMappings(); message('Preview ready. Map every source account and explicitly confirm coverage.');
});
action('stage', async () => {
  if (!parsed || parsedFixture !== $('fixture').value) inputError('preview-required');
  invalidateLedgerSession();
  let next = ledger; const accountMappings={}, coverageByAccount={};
  for (const form of mappingForms) {
    if (!form.select.value) inputError('account-mapping-required');
    if (!form.start.value || !form.end.value) inputError('coverage-dates-required');
    if (form.start.value > form.end.value) inputError('coverage-order-invalid');
    if (!form.confirm.checked) inputError('coverage-confirmation-required');
    let id=form.select.value;
    if (id === 'new') { if (!form.name.value.trim()) inputError('account-name-required'); if (!/^[A-Z]{3}$/.test(form.currency.value.trim().toUpperCase())) inputError('currency-required'); id=crypto.randomUUID(); next=registerAccount(next,{accountId:id,institutionId:parsed.institutionId,displayName:form.name.value.trim(),currency:form.currency.value.trim().toUpperCase(),accountType:form.type.value}); }
    if (coverageByAccount[id]) inputError('distinct-account-required');
    accountMappings[form.key]=id; coverageByAccount[id]={start:form.start.value,end:form.end.value,provenance:'user-confirmed'};
  }
  const result = await prepareCanonicalImport(next,{parsed,accountMappings,coverageByAccount,syntheticOnly:true});
  changed(result.ledger); clearPreview();
  const feedback = 'Import staged locally. ' + result.summary.created + ' activities created; ' + result.summary.review + ' need review; ' + result.summary.rejected + ' rejected. Save before leaving.';
  $('stage-result').textContent = feedback; message(feedback);
}, 'stage-result');
action('save', async () => { await saveLedger(); message('Canonical ledger saved and verified. ' + recordCounts() + ' Reopen to independently reload saved records.'); });
if ($('pause-canonical')) action('pause-canonical', async () => {
  if (!confirm('Pause a canonical save after its first durable write in this disposable synthetic folder? You must fully close this tab to continue, then reconnect and verify recovery.')) return;
  pauseAfterFirstWrite = true;
  try { await saveLedger(); message('No durable write was paused. The ledger was unchanged or the save completed. Do not record interruption as passed.'); }
  finally { pauseAfterFirstWrite = false; }
});
action('reopen', async () => { if (dirty && !confirm('Discard unsaved local changes and reopen the saved ledger?')) return; const saved = await loadLedger(); if (saved) message('Saved canonical records reopened and verified. ' + recordCounts()); });
function eventInput() {
  const event = { type: $('event-type').value, activityId: $('activity').value, evidence: { reason: $('evidence').value.trim() } };
  if (event.type==='refund-link') { event.originalActivityId=$('original').value; if ($('refund-posted-date').value) event.confirmedPostedDate=$('refund-posted-date').value; }
  else if (event.type==='bank-correction') event.amountText=$('amount').value.trim();
  else { event.categoryId=$('category').value.trim() || null; if (event.type==='classification') event.activityKind=$('classification').value; }
  return event;
}
function lastActionState() { return ledger.events.length <= savedAuditEvents ? 'saved' : 'staged'; }
function repeatsLastAction() {
  return Boolean(lastStagedAction && ledger?.ledgerId === lastStagedAction.ledgerId && ledger.events.at(-1)?.eventId === lastStagedAction.eventId && JSON.stringify(eventInput()) === lastStagedAction.input);
}
async function stageEvent(allowRepeat = false) {
  if (!store || !storage.lifecycle?.acceptingWrites) inputError('reconnect-required');
  if (repeatsLastAction() && !allowRepeat) {
    $('event-result').textContent = 'This exact action is already ' + lastActionState() + '. No second audit event was added. Change the inputs for a correction, or explicitly choose to stage the identical action again.'; return;
  }
  if (!$('evidence').value.trim()) inputError('evidence-required');
  const input = eventInput(), event = { ...input, commandId: crypto.randomUUID() };
  const activity = ledger.activities.find(item => item.activityId === event.activityId);
  const session = currentLedgerSession();
  if (session) {
    session.applyBatchJson(JSON.stringify([{ command: event, eventId: crypto.randomUUID(), recordedAt: new Date().toISOString() }]), session.revision());
    ledger = session.snapshot(); dirty = true; renderLedger();
  } else changed(applyFinancialEvent(ledger,event));
  lastStagedAction = { ledgerId: ledger.ledgerId, eventId: ledger.events.at(-1).eventId, input: JSON.stringify(input) };
  // Keep the selected target visible so the adjacent receipt identifies exactly
  // what was staged. Equal commands are protected only in this UI, not the engine.
  $('activity').value = event.activityId;
  $('original').value = input.originalActivityId || '';
  const feedback = `${event.type} staged for ${activity.sourceDescription} · ${activity.activityId}. ${ledger.events.length} audit events now. Save before leaving.`;
  $('event-result').textContent = feedback; $('event-result').dataset.error = 'false'; message(feedback);
}
action('event', () => stageEvent(), 'event-result');
action('repeat-event', async () => {
  if (!repeatsLastAction()) return;
  if (!confirm('This exact action was already ' + lastActionState() + '. Append another identical audit event intentionally?')) {
    $('event-result').textContent = 'Identical action cancelled. No second audit event was added.'; return;
  }
  await stageEvent(true);
}, 'event-result');
action('summarize', async () => { const scope = {start:$('report-start').value,end:$('report-end').value,currency:'USD',accountIds:ledger.accounts.map(a=>a.accountId)}; const session = currentLedgerSession(); const result = session ? session.summarizePeriodsJson(JSON.stringify([scope]))[0] : summarizeLedger(ledger,scope); $('summary').textContent=JSON.stringify(result,null,2)+'\nDeclared coverage is not independent proof of complete history.'; });
function renderLedger() {
  const session = currentLedgerSession();
  const effectiveActivities = session ? session.effectiveActivities() : getEffectiveActivities(ledger);
  const activeActivities = effectiveActivities.filter(activity=>activity.active);
  for (const id of ['activity','original']) { $(id).replaceChildren(); option($(id),'','Choose activity'); for (const activity of activeActivities) option($(id),activity.activityId,activity.sourceDescription+' · '+activity.effectiveDate+' · '+activity.activityKind+' · '+(activity.categoryId || 'Uncategorized')+' · '+activity.activityId); }
  $('provenance').replaceChildren();
  const wrap=element('div'); wrap.className='table-wrap'; const table=element('table');
  table.append(element('caption','Observation provenance')); const head=element('tr');
  for (const title of ['Source account','Row','Description','Date','Disposition','Import run']) {const th=element('th',title);th.scope='col';head.append(th);} table.append(head);
  for (const row of ledger.observations) {const tr=element('tr'); for (const value of [row.accountId,row.rowOrdinal,row.candidate.sourceDescription,row.candidate.effectiveDate,row.disposition,row.importRunId]) tr.append(element('td',String(value ?? 'Unavailable'))); table.append(tr);}
  wrap.append(table); $('provenance').append(wrap);
  for (const [key,rows] of Object.entries(ledger)) {
    if (!Array.isArray(rows)) continue;
    $('provenance').append(lazyEvidence(key+' · '+rows.length+' records', () => rows));
  }
  const effectiveTable=element('table'); effectiveTable.append(element('caption','Effective classifications and categories'));
  const effectiveHead=element('tr'); for (const title of ['Record status','Description','Classification','Category','Effective currency','Lifecycle']) {const th=element('th',title);th.scope='col';effectiveHead.append(th);} effectiveTable.append(effectiveHead);
  for (const activity of effectiveActivities) {const tr=element('tr');for(const value of [activity.active ? 'Active' : 'Inactive retained history',activity.sourceDescription,activity.activityKind,activity.categoryId || 'Uncategorized',activity.currency,activity.lifecycleStatus]) tr.append(element('td',value));effectiveTable.append(tr);}
  const effectiveWrap=element('div');effectiveWrap.className='table-wrap';effectiveWrap.append(effectiveTable);$('provenance').prepend(effectiveWrap);
  const rules=ledger.events.filter(event=>event.prospectiveRule);
  const ruleDetails=lazyEvidence(rules.length+' prospective category rules', () => rules.map(event=>({eventId:event.eventId,categoryId:event.categoryId,prospectiveRule:event.prospectiveRule})));ruleDetails.append(element('p','A category correction applies to this activity and future exact matches on account, institution, currency, description, and source action. Other existing activities retain their categories.'));$('provenance').append(ruleDetails);
  const reviews = renderReviews(activeActivities); refresh(); $('summary').textContent='Subtotals need recalculation after changes. No complete-history claim is made.';
  return reviews;
}
function matchLabel(activity) { return activity.sourceDescription+' · '+activity.effectiveDate+' · '+activity.activityId; }
function matchScope(activity) { return JSON.stringify([activity.accountId, activity.institutionId, activity.currency]); }
function renderMatchPicker(parent, candidates, draft) {
  const details = element('details'), heading = element('summary'), body = element('div');
  details.className = 'review-match'; details.append(heading, body); parent.append(details);
  const byId = new Map(candidates.map(activity => [activity.activityId, activity]));
  const updateHeading = () => { heading.textContent = draft.targetId ? 'Match target: ' + (byId.has(draft.targetId) ? matchLabel(byId.get(draft.targetId)) : 'Previously selected activity is unavailable') : 'Choose a match target (optional)'; };
  let drawn = false;
  function draw(focusStatus = false) {
    drawn = true; body.replaceChildren();
    body.append(element('p', 'Only active activities in the same account, institution and source currency are listed, 50 per page. Search or browse all pages; an off-page selection stays available. Choosing an activity does not apply a match; enter a rationale and choose match. Amount and source validation still apply.'));
    const search = labelled(body, 'Search match activities by description, date or activity ID', element('input'));
    search.type = 'search'; search.value = draft.searchText;
    search.addEventListener('input', () => { draft.searchText = search.value; });
    const applySearch = () => { if (busy) return; draft.searchText = search.value; draft.search = search.value.trim().toLowerCase(); draft.targetPage = 0; draw(true); };
    search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applySearch(); } });
    const searchButton = element('button', 'Search activities'); searchButton.type = 'button'; searchButton.addEventListener('click', applySearch); body.append(searchButton);
    const filtered = draft.search ? candidates.filter(activity => matchLabel(activity).toLowerCase().includes(draft.search)) : candidates;
    draft.targetPage = pageIndex(draft.targetPage, filtered.length, MATCH_PAGE_SIZE);
    const status = pageControls(body, 'Match activities', draft.targetPage, filtered.length, MATCH_PAGE_SIZE, page => { draft.targetPage = page; draw(true); });
    const target = labelled(body, 'Match to activity', element('select')); option(target, '', 'Choose activity');
    const visible = filtered.slice(draft.targetPage * MATCH_PAGE_SIZE, (draft.targetPage + 1) * MATCH_PAGE_SIZE);
    // Keep an explicit selection even when its option is off this page or search.
    // An unavailable selection remains visible, but the canonical guard rejects it.
    if (draft.targetId && !visible.some(activity => activity.activityId === draft.targetId)) option(target, draft.targetId, byId.has(draft.targetId) ? 'Selected: ' + matchLabel(byId.get(draft.targetId)) : 'Previously selected activity is unavailable');
    for (const activity of visible) option(target, activity.activityId, matchLabel(activity));
    target.value = draft.targetId;
    target.addEventListener('change', () => { draft.targetId = target.value; updateHeading(); });
    refresh(); if (focusStatus) status.focus();
  }
  details.addEventListener('toggle', () => { draft.matchOpen = details.open; if (details.open && !drawn) draw(); });
  updateHeading(); details.open = draft.matchOpen; if (details.open) draw();
}
function renderReviews(activeActivities) {
  $('reviews').replaceChildren();
  const pending = ledger.observations.filter(review=>['review','rejected'].includes(review.disposition) && !review.resolved);
  // Build the scoped candidate lists once, not once per pending observation.
  const scopes = new Map();
  for (const activity of activeActivities) {
    const key = matchScope(activity); if (!scopes.has(key)) scopes.set(key, []); scopes.get(key).push(activity);
  }
  $('reviews').append(element('p',pending.length+' pending review items. Inspect source evidence below. Draft fields stay only in this tab across pages. They are not saved decisions: apply a review action, then Save canonical ledger. Reopening or discarding the ledger clears draft fields.'));
  reviewPage = pageIndex(reviewPage, pending.length, REVIEW_PAGE_SIZE);
  const pendingStatus = pageControls($('reviews'), 'Pending reviews', reviewPage, pending.length, REVIEW_PAGE_SIZE, page => {
    reviewPage = page; const status = renderReviews(activeActivities).pendingStatus; refresh(); status.focus();
  });
  for (const review of pending.slice(reviewPage * REVIEW_PAGE_SIZE, (reviewPage + 1) * REVIEW_PAGE_SIZE)) {
    if (!reviewDrafts.has(review.observationId)) reviewDrafts.set(review.observationId, { rationale: '', currency: '', targetId: '', targetPage: 0, search: '', searchText: '', matchOpen: false });
    const draft = reviewDrafts.get(review.observationId);
    const fieldset=element('fieldset'); fieldset.dataset.observationId = review.observationId;
    fieldset.append(element('legend',review.observationId),element('pre',JSON.stringify(review,null,2)));
    renderMatchPicker(fieldset, scopes.get(matchScope(review.candidate)) || [], draft);
    let currency = null;
    if (review.reasonCode==='missing-currency') {
      fieldset.append(element('p','The original source row has no currency. To keep it separately, explicitly enter its ISO currency and explain your evidence. The blank source field is preserved; unknown lifecycle status stays unknown.'));
      currency=labelled(fieldset,'Explicit currency for this source row',element('input'));currency.maxLength=3;currency.placeholder='For example USD';currency.value=draft.currency;
      currency.addEventListener('input', () => { draft.currency = currency.value; });
    }
    const rationale=labelled(fieldset,'Decision rationale',element('input')); rationale.value=draft.rationale;
    rationale.addEventListener('input', () => { draft.rationale = rationale.value; });
    for (const decision of ['keep-separate','match','reject']) {
      const button=element('button',decision); button.type = 'button'; button.addEventListener('click',()=>run(async()=>{
        if (!storage.lifecycle?.acceptingWrites) inputError('reconnect-required');
        if (!rationale.value.trim()) inputError('review-rationale-required');
        if (decision==='match'&&!draft.targetId) inputError('match-target-required');
        if (decision==='keep-separate' && currency && !/^[A-Z]{3}$/.test(currency.value.trim().toUpperCase())) inputError('currency-required');
        // applyReviewDecision validates the current ledger, target activity,
        // active state, account, currency and amount before it stages anything.
        invalidateLedgerSession();
        const status = changed(applyReviewDecision(ledger,{observationId:review.observationId,action:decision,activityId:draft.targetId||undefined,rationale:rationale.value.trim(),...(decision==='keep-separate' && currency ? {currency:currency.value.trim().toUpperCase()} : {})}));
        status.pendingStatus.focus();
        reviewDrafts.delete(review.observationId); message('Review decision staged locally.');
      })); fieldset.append(button);
    }
    $('reviews').append(fieldset);
  }
  $('reviews').append(element('h3','Previous review decisions'),element('p','Return the latest decision to review with an audit record. Later dependent changes can prevent reversal. Save to persist any reversal.'));
  const latestByObservation = new Map();
  for (const decision of ledger.reviewDecisions) latestByObservation.set(decision.observationId, decision);
  decisionPage = pageIndex(decisionPage, ledger.reviewDecisions.length, REVIEW_PAGE_SIZE);
  const decisionStatus = pageControls($('reviews'), 'Previous decisions', decisionPage, ledger.reviewDecisions.length, REVIEW_PAGE_SIZE, page => {
    decisionPage = page; const status = renderReviews(activeActivities).decisionStatus; refresh(); status.focus();
  });
  for (const decision of ledger.reviewDecisions.slice(decisionPage * REVIEW_PAGE_SIZE, (decisionPage + 1) * REVIEW_PAGE_SIZE)) {
    const details=lazyEvidence(decision.action+' · '+decision.observationId, () => decision); details.dataset.reviewDecisionId = decision.reviewDecisionId;
    if (decision.action!=='reverse' && latestByObservation.get(decision.observationId)===decision) {
      const rationale=labelled(details,'Reason for returning to review',element('input')); rationale.value = reversalDrafts.get(decision.reviewDecisionId) || '';
      rationale.addEventListener('input', () => { reversalDrafts.set(decision.reviewDecisionId, rationale.value); });
      const button=element('button','Return to review');button.type = 'button';button.addEventListener('click',()=>run(async()=>{
        if (!store || !storage.lifecycle?.acceptingWrites) inputError('reconnect-required');
        if (!rationale.value.trim()) inputError('review-rationale-required');
        invalidateLedgerSession();
        const status = changed(reverseReviewDecision(ledger,{reviewDecisionId:decision.reviewDecisionId,rationale:rationale.value.trim()}));
        status.pendingStatus.focus();
        reversalDrafts.delete(decision.reviewDecisionId); message('Return to review staged locally. Save to persist the audit record.');
      }));details.append(button);
    }
    $('reviews').append(details);
  }
  return { pendingStatus, decisionStatus };
}
$('fixture').addEventListener('change',clearPreview);
for (const id of ['activity', 'original', 'event-type', 'classification', 'category', 'amount', 'evidence', 'refund-posted-date']) {
  $(id).addEventListener('input', refresh); $(id).addEventListener('change', refresh);
}
$('event-type').addEventListener('change',()=>{ $('refund-posting-fields').hidden=$('event-type').value!=='refund-link'; });
$('show-save').addEventListener('click', () => { if ($('workbench-details')) $('workbench-details').open = true; $('save-title').focus(); });
window.addEventListener('beforeunload',event=>{ if(dirty||busy){event.preventDefault();event.returnValue='';} });
window.addEventListener('online',refresh); window.addEventListener('offline',refresh);
storage.prepare().then(()=>{configured=true;refresh();}).catch(()=>{$('connection').textContent='Google configuration unavailable. No data saved. Use the configured synthetic deployment.';refresh();});
refresh();

// Narrow module-only integration. No token, folder, adapter or lifecycle handle is
// placed on window. The lease blocks all manual controls and repeated starts.
export async function withAcceptanceWorkbench(operation) {
  if (busy) inputError('operation-in-progress');
  const lifecycle = storage.lifecycle;
  if (!store || !ledger || dirty || lifecycle?.state !== 'ready' || !lifecycle.acceptingWrites || navigator.onLine === false) inputError('verified-clean-connection-required');
  busy = true; refresh();
  const ready = () => {
    if (storage.lifecycle !== lifecycle || lifecycle.state !== 'ready' || !lifecycle.acceptingWrites || navigator.onLine === false) inputError('reconnect-required');
  };
  const reopen = async () => { ready(); await loadLedger(); return structuredClone(ledger); };
  try {
    return await operation(Object.freeze({
      requestMetrics: lifecycle.requestMetrics,
      async requireFresh() {
        ready();
        const manifest = await lifecycle.readManifest();
        if (manifest.syntheticOnly !== true || manifest.revision !== 0 || Object.keys(manifest.snapshot || {}).length || manifest.catalogFinalizationPending !== null) inputError('fresh-empty-copy-required');
        invalidateLedgerSession();
        if (await store.load() !== null || store.base?.revision !== 0 || Object.keys(store.base?.snapshot || {}).length || store.base?.syntheticOnly !== true || store.base?.catalogFinalizationPending !== null) inputError('fresh-empty-copy-required');
        // The store uses this verified base and will refuse any competing change.
      },
      async identity() { ready(); const manifest = await lifecycle.readManifest(); return { databaseId: manifest.databaseId, copyId: manifest.copyId, folderId: lifecycle.folderId }; },
      stage(next) { ready(); changed(next); },
      async save(next) { ready(); return structuredClone(await saveLedger(next)); },
      reopen,
      async verifyPortable() {
        ready();
        const archive = await exportCatalogArchive({ adapter: lifecycle.transactionAdapter, manifestFileId: lifecycle.manifestFileId,
          withSourceLock: operation => lifecycle.coordinator.withWrite(operation), validateStructure: validateSyntheticApplicationSnapshot });
        await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
        // The archive is neither downloaded, shared nor stored in checklist state.
      },
      async revalidate() { ready(); invalidateLedgerSession(true); await lifecycle.handleOnline(); ready(); },
      async release() {
        ready(); if (dirty) inputError('unsaved-changes');
        invalidateLedgerSession(true);
        await storage.release();
        if (lifecycle.started || lifecycle.coordinator?.canWrite || lifecycle.releasePending) inputError('release-unverified');
        store = null;
      }
    }));
  } finally { busy = false; refresh(); }
}

export function subscribeAcceptanceStatus(listener) { acceptanceListener = listener; refresh(); return () => { if (acceptanceListener === listener) acceptanceListener = null; }; }

// Only the assisted page calls this with its in-memory preparation receipt. The
// advanced manual pause remains separate and never supplies a guided receipt.
export async function pausePreparedInterruption(prepared) {
  if (busy) inputError('operation-in-progress');
  const lifecycle = storage.lifecycle;
  if (!prepared || !store || !ledger || !dirty || saveState !== 'idle' || lifecycle?.state !== 'ready' || !lifecycle.acceptingWrites || navigator.onLine === false) inputError('prepared-interruption-required');
  busy = true; refresh();
  try {
    const manifest = await lifecycle.readManifest();
    const identity = { databaseId: manifest.databaseId, copyId: manifest.copyId, folderId: lifecycle.folderId };
    if (storage.lifecycle !== lifecycle || canonicalizeJcs(identity) !== canonicalizeJcs(prepared.identity) || canonicalizeJcs(ledger) !== canonicalizeJcs(prepared.ledger)) inputError('prepared-interruption-changed');
    pauseAfterFirstWrite = true;
    await saveLedger();
    inputError('interruption-not-paused');
  } finally { pauseAfterFirstWrite = false; busy = false; refresh(); }
}
