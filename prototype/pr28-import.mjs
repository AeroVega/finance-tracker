import { DashboardSyntheticStorage } from '../js/dashboard-synthetic-storage.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyReviewDecision, applyFinancialEvent, reverseReviewDecision, getEffectiveActivities, summarizeLedger } from '../js/canonical-import.mjs';

const $ = id => document.getElementById(id);
const fixtures = Object.freeze({
  'wells-foundation': ['../fixtures/pr28/wells-fargo-foundation.csv', 'wells-fargo-csv-v1'],
  'wells-review': ['../fixtures/pr28/wells-fargo-review.csv', 'wells-fargo-csv-v1'],
  'wells-fargo': ['../fixtures/wells-fargo.csv', 'wells-fargo-csv-v1'],
  sofi: ['../fixtures/sofi.csv', 'sofi-csv-v1'],
  fidelity: ['../fixtures/fidelity.csv', 'fidelity-accounts-history-csv-v1']
});
let busy = false, configured = false, ledger = null, store = null, parsed = null, dirty = false;
let mappingForms = [];
let previewGeneration = 0, parsedFixture = null;
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
function refresh() {
  const lifecycle = storage.lifecycle;
  const ready = lifecycle?.state === 'ready' && lifecycle.acceptingWrites && navigator.onLine !== false;
  for (const control of document.querySelectorAll('button,input,select')) control.disabled = busy;
  $('connect').disabled = busy || !configured;
  $('stale').disabled = busy || lifecycle?.state !== 'stale-session';
  $('recover').disabled = busy || lifecycle?.state !== 'recovery-required' || !lifecycle?.coordinator?.canWrite;
  $('release').disabled = busy || !lifecycle?.coordinator?.canWrite;
  for (const id of ['parse', 'reopen']) $(id).disabled = busy || !ready || !store;
  $('stage').disabled = busy || !ready || !store || !parsed || parsedFixture !== $('fixture').value || !ledger;
  $('save').disabled = busy || !ready || !store || !ledger || !dirty;
  $('event').disabled = busy || !ready || !store || !$('activity').value;
  $('summarize').disabled = busy || !ledger;
  $('dirty').textContent = !ledger ? 'No ledger loaded.' : dirty ? 'Unsaved local changes. Closing this tab loses them.' : 'No unsaved changes. This is a new empty ledger or verified saved records.';
}
const storage = new DashboardSyntheticStorage({ onStatus: status => { $('connection').textContent = status.message; refresh(); } });
async function run(operation) {
  if (busy) return;
  busy = true; refresh();
  try { await operation(); }
  catch (error) {
    const candidate = error.code || (error instanceof TypeError ? error.message : '');
    const code = typeof candidate === 'string' && /^[a-z][a-z0-9-]{0,95}$/.test(candidate) ? candidate : 'invalid-input-or-unavailable';
    message((inputMessages[code] || 'Action did not complete: ' + code + '. Check inputs or reconnect and reopen before retrying.') + ' Unsaved changes remain local.', true);
  }
  finally { busy = false; refresh(); }
}
function action(id, operation) { $(id).addEventListener('click', () => run(operation)); }
function changed(next) { ledger = next; dirty = true; renderLedger(); }
function option(select, value, label) { const node = element('option', label); node.value = value; select.append(node); }
function labelled(parent, text, node) { const label = element('label', text); label.append(node); parent.append(label); return node; }
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
async function loadLedger() { const nextStore = new CanonicalLedgerStore({ lifecycle: storage.lifecycle }); const nextLedger = await nextStore.load() || createLedger(); store = nextStore; ledger = nextLedger; dirty = false; clearPreview(); renderLedger(); }
action('connect', async () => { if (dirty && !confirm('Discard unsaved local changes and connect?')) return; store=null; await storage.connect(); if (storage.lifecycle?.state === 'ready') await loadLedger(); });
action('stale', async () => { if (confirm('Confirm all prior tabs and devices using this synthetic folder have stopped.')) { await storage.recoverStaleSession(); if (!dirty || confirm('Session recovered. Discard unsaved local changes and reopen?')) await loadLedger(); } });
action('recover', async () => { await storage.lifecycle.recover(); if (!dirty || confirm('Recovery completed. Discard unsaved local changes and reopen?')) await loadLedger(); });
action('release', async () => { if (dirty && !confirm('Release without saving local changes? They remain in this tab only.')) return; await storage.release(); store=null; });
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
  changed(result.ledger); clearPreview(); message('Import staged locally. Review before saving. '+JSON.stringify(result.summary));
});
action('save', async () => { ledger=await store.save(ledger); dirty=false; renderLedger(); message('Canonical ledger saved and verified. ' + recordCounts() + ' Reopen to independently reload saved records.'); });
action('reopen', async () => { if (dirty && !confirm('Discard unsaved local changes and reopen the saved ledger?')) return; await loadLedger(); message('Saved canonical records reopened and verified. ' + recordCounts()); });
action('event', async () => {
  if (!$('evidence').value.trim()) inputError('evidence-required');
  const event={type:$('event-type').value,activityId:$('activity').value,commandId:crypto.randomUUID(),evidence:{reason:$('evidence').value.trim()}};
  if (event.type==='refund-link') { event.originalActivityId=$('original').value; if ($('refund-posted-date').value) event.confirmedPostedDate=$('refund-posted-date').value; }
  else if (event.type==='bank-correction') event.amountText=$('amount').value.trim();
  else { event.categoryId=$('category').value.trim() || null; if (event.type==='classification') event.activityKind=$('classification').value; }
  changed(applyFinancialEvent(ledger,event)); message('Auditable change staged locally. Save to persist it.');
});
action('summarize', async () => { const result = summarizeLedger(ledger,{start:$('report-start').value,end:$('report-end').value,currency:'USD',accountIds:ledger.accounts.map(a=>a.accountId)}); $('summary').textContent=JSON.stringify(result,null,2)+'\nDeclared coverage is not independent proof of complete history.'; });
function renderLedger() {
  for (const id of ['activity','original']) { $(id).replaceChildren(); option($(id),'','Choose activity'); for (const activity of getEffectiveActivities(ledger).filter(activity=>activity.active)) option($(id),activity.activityId,activity.sourceDescription+' · '+activity.effectiveDate+' · '+activity.activityKind+' · '+(activity.categoryId || 'Uncategorized')+' · '+activity.activityId); }
  $('provenance').replaceChildren();
  const wrap=element('div'); wrap.className='table-wrap'; const table=element('table');
  table.append(element('caption','Observation provenance')); const head=element('tr');
  for (const title of ['Source account','Row','Description','Date','Disposition','Import run']) {const th=element('th',title);th.scope='col';head.append(th);} table.append(head);
  for (const row of ledger.observations) {const tr=element('tr'); for (const value of [row.accountId,row.rowOrdinal,row.candidate.sourceDescription,row.candidate.effectiveDate,row.disposition,row.importRunId]) tr.append(element('td',String(value ?? 'Unavailable'))); table.append(tr);}
  wrap.append(table); $('provenance').append(wrap);
  for (const [key,rows] of Object.entries(ledger)) {
    if (!Array.isArray(rows)) continue;
    const details=element('details'); details.append(element('summary',key+' · '+rows.length+' records')); const pre=element('pre',JSON.stringify(rows,null,2)); details.append(pre); $('provenance').append(details);
  }
  const effectiveTable=element('table'); effectiveTable.append(element('caption','Effective classifications and categories'));
  const effectiveHead=element('tr'); for (const title of ['Record status','Description','Classification','Category','Effective currency','Lifecycle']) {const th=element('th',title);th.scope='col';effectiveHead.append(th);} effectiveTable.append(effectiveHead);
  for (const activity of getEffectiveActivities(ledger)) {const tr=element('tr');for(const value of [activity.active ? 'Active' : 'Inactive retained history',activity.sourceDescription,activity.activityKind,activity.categoryId || 'Uncategorized',activity.currency,activity.lifecycleStatus]) tr.append(element('td',value));effectiveTable.append(tr);}
  const effectiveWrap=element('div');effectiveWrap.className='table-wrap';effectiveWrap.append(effectiveTable);$('provenance').prepend(effectiveWrap);
  const rules=ledger.events.filter(event=>event.prospectiveRule);
  const ruleDetails=element('details');ruleDetails.append(element('summary',rules.length+' prospective category rules'),element('p','A category correction applies to this activity and future exact matches on account, institution, currency, description, and source action. Other existing activities retain their categories.'),element('pre',JSON.stringify(rules.map(event=>({eventId:event.eventId,categoryId:event.categoryId,prospectiveRule:event.prospectiveRule})),null,2)));$('provenance').append(ruleDetails);
  renderReviews(); refresh(); $('summary').textContent='Subtotals need recalculation after changes. No complete-history claim is made.';
}
function renderReviews() {
  $('reviews').replaceChildren();
  const pending = ledger.observations.filter(review=>['review','rejected'].includes(review.disposition) && !review.resolved);
  $('reviews').append(element('p',pending.length+' pending review items. Inspect source evidence below.'));
  for (const review of pending) {
    const fieldset=element('fieldset'); fieldset.append(element('legend',review.observationId),element('pre',JSON.stringify(review,null,2)));
    const target=labelled(fieldset,'Match to activity',element('select')); option(target,'','Choose activity');
    for (const activity of getEffectiveActivities(ledger).filter(activity=>activity.active)) option(target,activity.activityId,activity.activityId);
    let currency = null;
    if (review.reasonCode==='missing-currency') {
      fieldset.append(element('p','The original source row has no currency. To keep it separately, explicitly enter its ISO currency and explain your evidence. The blank source field is preserved; unknown lifecycle status stays unknown.'));
      currency=labelled(fieldset,'Explicit currency for this source row',element('input'));currency.maxLength=3;currency.placeholder='For example USD';
    }
    const rationale=labelled(fieldset,'Decision rationale',element('input'));
    for (const decision of ['keep-separate','match','reject']) {
      const button=element('button',decision); button.addEventListener('click',()=>run(async()=>{ if (!storage.lifecycle?.acceptingWrites) inputError('reconnect-required'); if (!rationale.value.trim()) inputError('review-rationale-required'); if (decision==='match'&&!target.value) inputError('match-target-required'); if (decision==='keep-separate' && currency && !/^[A-Z]{3}$/.test(currency.value.trim().toUpperCase())) inputError('currency-required'); changed(applyReviewDecision(ledger,{observationId:review.observationId,action:decision,activityId:target.value||undefined,rationale:rationale.value.trim(),...(decision==='keep-separate' && currency ? {currency:currency.value.trim().toUpperCase()} : {})})); message('Review decision staged locally.'); })); fieldset.append(button);
    }
    $('reviews').append(fieldset);
  }
  $('reviews').append(element('h3','Previous review decisions'),element('p','Return the latest decision to review with an audit record. Later dependent changes can prevent reversal. Save to persist any reversal.'));
  for (const decision of ledger.reviewDecisions) {
    const details=element('details');details.append(element('summary',decision.action+' · '+decision.observationId),element('pre',JSON.stringify(decision,null,2)));
    const latest=ledger.reviewDecisions.filter(item=>item.observationId===decision.observationId).at(-1);
    if (decision.action!=='reverse' && latest===decision) {
      const rationale=labelled(details,'Reason for returning to review',element('input'));
      const button=element('button','Return to review');button.addEventListener('click',()=>run(async()=>{
        if (!store || !storage.lifecycle?.acceptingWrites) inputError('reconnect-required');
        if (!rationale.value.trim()) inputError('review-rationale-required');
        changed(reverseReviewDecision(ledger,{reviewDecisionId:decision.reviewDecisionId,rationale:rationale.value.trim()}));message('Return to review staged locally. Save to persist the audit record.');
      }));details.append(button);
    }
    $('reviews').append(details);
  }
}
$('fixture').addEventListener('change',clearPreview);
$('activity').addEventListener('change',refresh);
$('event-type').addEventListener('change',()=>{ $('refund-posting-fields').hidden=$('event-type').value!=='refund-link'; });
window.addEventListener('beforeunload',event=>{ if(dirty||busy){event.preventDefault();event.returnValue='';} });
window.addEventListener('online',refresh); window.addEventListener('offline',refresh);
storage.prepare().then(()=>{configured=true;refresh();}).catch(()=>{$('connection').textContent='Google configuration unavailable. No data saved. Use the configured synthetic deployment.';refresh();});
refresh();
