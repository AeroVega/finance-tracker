import {fail} from './app-error.mjs';
import {getHistoricalMonthlySummaryView,previewHistoricalMonthlySummaries} from './historical-monthly-summary.mjs';

const MAX_INPUT_BYTES = 1024 * 1024;
const PAGE_SIZE = 12;
const readable = value => typeof value === 'string' ? value : 'Unavailable';
const money = value => value && typeof value.amount === 'string' && typeof value.currency === 'string'
  ? value.amount + ' ' + value.currency : 'Unavailable';
const words = value => readable(value).replaceAll('-', ' ');
const rawText = value => JSON.stringify(value, null, 2);
const reasonText = reason => ({
  'no-explicit-completeness-review': 'No complete reconciliation has been recorded for this month.',
  'workbook-scope-currency-not-comparable': 'The workbook scope and currency cannot be matched to the transaction accounts.',
  'reconciliation-evidence-stale': 'The source or transaction evidence changed after reconciliation.',
  'missing-reviewed-full-month-coverage': 'The ledger needs a reviewed full-month import for each account in scope.',
  'pending-activity': 'Pending activity remains in scope.'
}[reason] ?? words(reason));

export function mountHistoricalMonthlySummaryWorkflow({
  root, getLedger, isActive = () => true, getUnavailableReason = () => null,
  stageSummaries, stageReconciliation, onStaged = () => {}
}) {
  if (!root || typeof getLedger !== 'function' || typeof stageSummaries !== 'function' ||
      typeof stageReconciliation !== 'function') fail('invalid-options');
  const doc = root.ownerDocument;
  function el(tag, text = '', attrs = {}) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    for (const [key,value] of Object.entries(attrs)) {
      if (key === 'id') node.id = value;
      else if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else node.setAttribute(key,value);
    }
    return node;
  }
  const button = (id,text,description) => el('button',text,{id,type:'button',class:'secondary-button', 'aria-describedby':description});
  const detail = (title,value) => {
    const wrap = el('details');
    wrap.append(el('summary',title),el('pre',rawText(value),{class:'historical-source-text'}));
    return wrap;
  };
  function breakdownDetails(record) {
    const wrap = el('details');
    wrap.append(el('summary','Income sources and expense categories'));
    for (const [key,label] of [['incomeSources','Income sources'],['expenseCategories','Expense categories']]) {
      const part = record?.breakdowns?.[key];
      const coverage = part?.complete === true ? 'Complete' : part?.complete === false ? 'Partial' : 'Not supplied or invalid';
      wrap.append(el('p',label + ' · ' + coverage));
      if (!Array.isArray(part?.items) || !part.items.length) continue;
      const list = el('ul');
      for (const item of part.items) list.append(el('li',readable(item?.label) + ': ' + money(item?.amount)));
      wrap.append(list);
    }
    return wrap;
  }
  const control = (id,label,tag = 'input') => {
    const wrap = el('label',label,{for:id});
    const input = el(tag,'',{id,...(tag === 'input' ? {type:'text',maxlength:'300',autocomplete:'off'} : {})});
    wrap.append(input);
    return [wrap,input];
  };
  let ledger = null, revision = 0, readRevision = 0, active = false, reading = false, staging = false;
  let selected = null, input = null, preview = null, reviewPage = 0, viewRows = [], stagingRequest = null;
  const decisions = new Map();
  const decisionControls = [];
  const fileLabel = el('label','Normalized history JSON file',{for:'historical-summary-file'});
  const file = el('input','',{id:'historical-summary-file',type:'file',accept:'.json,application/json','aria-describedby':'historical-summary-input-help'});
  const previewButton = button('historical-summary-preview','Preview file','historical-preview-help');
  const previewHelp = el('p','Choose an invented JSON file first.',{id:'historical-preview-help',class:'field-help'});
  const discard = button('historical-summary-discard','Discard file review','historical-preview-help');
  const previewStatus = el('p','',{id:'historical-preview-status',role:'status','aria-live':'polite',class:'field-help'});
  const findings = el('div');
  const rows = el('div','',{id:'historical-preview-rows',class:'historical-preview-rows'});
  const pageStatus = el('p','',{id:'historical-review-range',role:'status',class:'field-help'});
  const prev = button('historical-prev','Previous records','historical-review-range');
  const next = button('historical-next','Next records','historical-review-range');
  const stage = button('historical-summary-stage','Stage reviewed summaries','historical-stage-help');
  const stageHelp = el('p','',{id:'historical-stage-help',class:'field-help'});
  const reviewStatus = el('p','',{id:'historical-stage-status',role:'status',tabindex:'-1',class:'field-help'});
  const historyStatus = el('p','',{id:'historical-saved-status',role:'status',class:'field-help'});
  const historyMonth = el('select','',{id:'historical-saved-month','aria-describedby':'historical-saved-status'});
  const history = el('div','',{id:'historical-month-view'});
  const historyBatch = el('select','',{id:'historical-saved-batch'});
  const batchView = el('div','',{id:'historical-batch-view'});
  const reconcileHelp = el('p','',{id:'historical-reconcile-help',class:'field-help'});
  const reconcileStatus = el('p','',{id:'historical-reconcile-status',role:'status',tabindex:'-1',class:'field-help'});
  const [reasonLabel,reason] = control('historical-reconcile-reason','Why is this month complete?');
  const [evidenceLabel,evidence] = control('historical-reconcile-evidence','Evidence reference');
  const confirm = el('input','',{id:'historical-reconcile-confirm',type:'checkbox'});
  const confirmWrap = el('label','',{class:'historical-confirm'});
  confirmWrap.append(confirm,el('span','I reviewed the entire month for the listed accounts and currency. The records match the source scope and all relevant reviews are settled.'));
  const reconcile = button('historical-reconcile-stage','Stage complete reconciliation','historical-reconcile-help');
  const actions = (...items) => {
    const wrap = el('div','',{class:'storage-actions'});
    wrap.append(...items);
    return wrap;
  };
  root.replaceChildren(
    el('p','Choose an invented, normalized monthly-summary JSON file. This does not open Excel workbooks or upload the source file. Preview and review stay in this tab. Leaving Storage clears unstaged file reviews. Use the workspace save action after staging.',{id:'historical-summary-input-help',class:'field-help'}),
    fileLabel,file,actions(previewButton,discard),previewHelp,previewStatus,findings,rows,
    actions(prev,next),pageStatus,actions(stage),stageHelp,reviewStatus,
    el('h4','Historical months in this workspace'),historyStatus,
    el('label','View month',{for:'historical-saved-month'}),historyMonth,history,
    el('h4','Reconcile an overlapping month'),reasonLabel,evidenceLabel,confirmWrap,
    actions(reconcile),reconcileHelp,reconcileStatus,
    el('h4','Previous batch decisions'),el('label','Review batch',{for:'historical-saved-batch'}),historyBatch,batchView
  );
  function clearConfirmation() {
    reason.value = ''; evidence.value = ''; confirm.checked = false;
  }
  function setStageHelp() {
    const unavailable = getUnavailableReason();
    const locked = Boolean(unavailable || staging);
    previewButton.disabled = !selected || reading || staging || !ledger;
    file.disabled = staging;
    discard.disabled = staging || (!selected && !preview && !reading);
    previewHelp.textContent = !ledger ? 'Open a synthetic ledger to preview this input.' : !selected
      ? 'Choose an invented JSON file first.' : reading ? 'Reading the file locally.' : 'Preview does not change the ledger.';
    for (const control of decisionControls) control.disabled = locked;
    const required = preview?.rows.filter(row => row.eligible) ?? [];
    const unresolved = required.filter(row => {
      const decision = decisions.get(row.recordIndex);
      return !decision?.action || !decision.reason.trim();
    }).length;
    const selectedMonths = required.filter(row => decisions.get(row.recordIndex)?.action === 'accept').map(row => row.record.month);
    const duplicateMonth = new Set(selectedMonths).size !== selectedMonths.length;
    const disabledText = unavailable || (staging ? 'Wait for staging to finish.' : !preview ? 'Preview a file and review its records first.'
      : !required.length ? 'The file has no eligible records.'
      : unresolved ? 'Choose an action and enter a reason for every eligible record.'
      : duplicateMonth ? 'Accept at most one source record per month. Exclude the other candidates.'
      : !selectedMonths.length ? 'Accept at least one workbook summary to stage this batch.' : '');
    stage.disabled = Boolean(disabledText);
    stageHelp.textContent = disabledText || 'Stages your decisions in this tab. It does not save or upload the file.';
    const month = viewRows.find(row => row.month === historyMonth.value);
    const blockers = month?.reasons.filter(item => !['no-explicit-completeness-review','reconciliation-evidence-stale'].includes(item)) ?? [];
    const canReconcile = month?.record?.scope?.kind === 'accounts' && month.source !== 'transactions' && !blockers.length;
    const blocked = unavailable || (staging ? 'Wait for staging to finish.' : !month ? 'Select a month with a reviewed historical summary.'
      : month.source === 'transactions' ? 'Transaction detail already has a current complete reconciliation.'
      : blockers.length ? reasonText(blockers[0]) + ' The workbook summary remains the source.'
      : !canReconcile ? 'This workbook summary has no comparable account scope. Keep the workbook summary.'
      : !reason.value.trim() || !evidence.value.trim() || !confirm.checked
        ? 'Enter a reason and evidence reference, then confirm complete reconciliation.' : '');
    reason.disabled = evidence.disabled = confirm.disabled = locked || !canReconcile;
    reconcile.disabled = Boolean(blocked);
    reconcileHelp.textContent = blocked || 'Stages this reconciliation if the ledger evidence supports it. Save explicitly afterward.';
    prev.disabled = staging || reviewPage === 0;
    next.disabled = staging || !preview || (reviewPage + 1) * PAGE_SIZE >= preview.rows.length;
    historyMonth.disabled = !viewRows.length || staging;
    historyBatch.disabled = !active || !ledger?.historicalSummaryBatches?.length;
  }
  function clearPreview(message = '', clearSelection = true) {
    readRevision++; reading = false; input = null; preview = null; reviewPage = 0;
    if (clearSelection) { selected = null; file.value = ''; }
    decisions.clear(); decisionControls.length = 0;
    findings.replaceChildren(); rows.replaceChildren();
    pageStatus.textContent = 'No preview records.';
    previewStatus.textContent = message; reviewStatus.textContent = '';
    setStageHelp();
  }
  function renderRecord(row) {
    const {recordIndex,record,eligible,current} = row;
    const month = readable(record?.month);
    const card = el('fieldset','',{class:'historical-record'});
    card.append(el('legend','Record ' + (recordIndex + 1) + ' · ' + (month === 'Unavailable' ? 'No valid month supplied' : month)));
    const m = record?.summary;
    card.append(el('p','Income: ' + money(m?.incomeTotal) + ' · Expenses: ' + money(m?.expenseTotal) + ' · Net-worth snapshot: ' + money(m?.netWorthSnapshot)));
    const p = record?.provenance;
    if (p) card.append(el('p','Workbook: ' + readable(p.workbook) + ' · Worksheet: ' + readable(p.worksheet) + ' · Mapping: ' + readable(p.mapping)));
    if (current) card.append(el('p','This month already has an accepted workbook summary. Accepting this record replaces the effective workbook summary and keeps the prior record.'),detail('Inspect existing workbook summary',current.record));
    card.append(breakdownDetails(record),detail('Inspect exact source record and provenance',record));
    if (!eligible) {
      card.append(el('p','Not eligible for staging. The input record remains visible for review.',{class:'field-help'}));
      return card;
    }
    const id = 'historical-record-' + recordIndex;
    const [actionLabel,action] = control(id+'-action','Review decision','select');
    for (const [value,text] of [['','Choose a decision'],['accept',current ? 'Accept as replacement' : 'Accept workbook summary'],['exclude','Exclude from effective history']]) {
      action.append(el('option',text,{value}));
    }
    const [whyLabel,why] = control(id+'-reason','Reason for decision');
    const decision = decisions.get(recordIndex) ?? {recordIndex,action:'',reason:''};
    decisions.set(recordIndex,decision);
    action.value = decision.action; why.value = decision.reason;
    action.addEventListener('change',() => { decision.action = action.value; setStageHelp(); });
    why.addEventListener('input',() => { decision.reason = why.value; setStageHelp(); });
    decisionControls.push(action,why); card.append(actionLabel,whyLabel);
    return card;
  }
  function renderReviewPage() {
    decisionControls.length = 0;
    const start = reviewPage * PAGE_SIZE;
    const visible = preview?.rows.slice(start,start + PAGE_SIZE) ?? [];
    rows.replaceChildren(...visible.map(renderRecord));
    pageStatus.textContent = visible.length ? 'Showing records ' + (start+1) + '–' + (start+visible.length) + ' of ' + preview.rows.length + '.' : 'No preview records.';
    setStageHelp();
  }
  async function readPreview() {
    if (previewButton.disabled || !isActive()) return;
    clearPreview('',false);
    const version = ++readRevision, base = getLedger(), picked = selected;
    const isCurrent = () => version === readRevision && base === getLedger() && picked === selected && isActive();
    reading = true; setStageHelp();
    try {
      if (!Number.isSafeInteger(picked.size) || picked.size <= 0 || picked.size > MAX_INPUT_BYTES) {
        previewStatus.textContent = 'Choose a nonempty JSON file no larger than 1 MiB.';
        return;
      }
      const bytes = await picked.arrayBuffer();
      if (!isCurrent()) return;
      if (bytes.byteLength !== picked.size) {
        previewStatus.textContent = 'The file changed while it was being read. Select it again.';
        return;
      }
      let candidate;
      try { candidate = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
      catch { previewStatus.textContent = 'The selected file is not valid UTF-8 JSON.'; return; }
      const review = previewHistoricalMonthlySummaries(base,candidate);
      if (!isCurrent()) return;
      input = candidate; preview = review;
      previewStatus.textContent = review.rows.length + ' input records. Expected months: ' +
        (review.expectedMonthRange ? readable(review.expectedMonthRange.start) + ' to ' + readable(review.expectedMonthRange.end) : 'unavailable') + '. ' +
        review.coverage.missingMonths.length + ' expected month(s) absent from the file.';
      const issues = el('details');
      issues.append(el('summary','Validation findings (' + review.findings.length + ')'));
      const list = el('ul');
      for (const finding of review.findings) {
        const indexes = finding.recordIndices ?? (Number.isInteger(finding.recordIndex) ? [finding.recordIndex] : []);
        const parts = [words(finding.code)];
        if (typeof finding.month === 'string') parts.push(finding.month);
        if (typeof finding.field === 'string') parts.push(finding.field);
        if (indexes.length) parts.push('record(s) ' + indexes.map(index => index + 1).join(', '));
        list.append(el('li',parts.join(' · ')));
      }
      if (review.findings.length) { issues.append(list); issues.open = true; findings.replaceChildren(issues); }
      renderReviewPage();
    } catch {
      if (isCurrent()) previewStatus.textContent = 'The selected file could not be reviewed. Check the normalized monthly-summary format.';
    } finally {
      if (isCurrent()) { reading = false; setStageHelp(); }
    }
  }
  function renderMonth() {
    const row = viewRows.find(item => item.month === historyMonth.value);
    history.replaceChildren();
    if (!row) { setStageHelp(); return; }
    const source = row.source === 'transactions' ? 'Reconciled transaction detail' : 'Historical workbook summary';
    history.append(el('p','Income and expense source: ' + source));
    if (row.report) {
      const {income,spending,currency} = row.report;
      history.append(el('p','Income: ' + money({amount:income,currency}) + ' · Expenses: ' + money({amount:spending,currency})));
    } else {
      history.append(el('p','Income: ' + money(row.record.summary.incomeTotal) + ' · Expenses: ' + money(row.record.summary.expenseTotal)));
    }
    const scope = row.record.scope;
    const accountNames = scope?.kind === 'accounts' ? scope.accountIds.map(id => ledger.accounts.find(account => account.accountId === id)?.displayName ?? 'Unknown account') : [];
    history.append(el('p','Net-worth snapshot (workbook): ' + money(row.netWorthSnapshot)),
      el('p','Workbook coverage: ' + (accountNames.length ? accountNames.join(', ') : scope?.kind === 'aggregate' ? 'Aggregate source' : 'Unknown scope')),
      el('p','Workbook cash-flow currency: ' + readable(row.record.summary.incomeTotal.currency)));
    if (row.reasons?.length) {
      const list = el('ul');
      for (const value of row.reasons) list.append(el('li',reasonText(value)));
      history.append(list);
    }
    history.append(breakdownDetails(row.record),detail('Inspect workbook source and provenance',row.record));
    const audit = (ledger.historicalSummaryBatches ?? []).flatMap(batch => batch.entries
      .filter(entry => entry.record.month === row.month)
      .map(entry => ({recordedAt:batch.recordedAt,batchId:batch.batchId,expectedMonthRange:batch.expectedMonthRange,...entry})));
    const overrides = (ledger.historicalReconciliations ?? []).filter(entry => entry.month === row.month);
    history.append(detail('Inspect review and reconciliation history',{workbookDecisions:audit,reconciliations:overrides}));
    setStageHelp();
  }
  function renderBatch() {
    batchView.replaceChildren();
    const batch = ledger?.historicalSummaryBatches?.find(item => item.batchId === historyBatch.value);
    if (!batch) return;
    const accepted = batch.entries.filter(entry => entry.action === 'accept').length;
    batchView.append(el('p','Expected months: ' + batch.expectedMonthRange.start + ' to ' + batch.expectedMonthRange.end +
      '. Accepted: ' + accepted + '. Excluded: ' + (batch.entries.length - accepted) + '.'),
      detail('Inspect this batch’s decisions and workbook evidence',batch));
  }
  function clearHistory() {
    viewRows = []; historyMonth.replaceChildren(el('option','Choose a month',{value:''}));
    historyBatch.replaceChildren(el('option','Choose a batch',{value:''}));
    history.replaceChildren(); batchView.replaceChildren();
    historyStatus.textContent = 'Open a synthetic ledger to see its historical months.';
    clearConfirmation(); reconcileStatus.textContent = ''; setStageHelp();
  }
  function refresh() {
    const nextLedger = getLedger(), nextActive = isActive();
    if (active === nextActive && ledger === nextLedger) { setStageHelp(); return; }
    const priorMonth = historyMonth.value;
    stagingRequest?.abort();
    revision++; active = nextActive; ledger = nextLedger;
    clearPreview(); clearHistory();
    const base = ledger, version = revision;
    if (!base || !active) return;
    historyStatus.textContent = 'Checking historical months…';
    historyBatch.replaceChildren(el('option','Choose a batch',{value:''}), ...(base.historicalSummaryBatches ?? [])
      .map((batch,index) => el('option','Batch ' + (index+1) + ' · ' + batch.recordedAt,{value:batch.batchId})));
    setStageHelp();
    return Promise.resolve().then(() => getHistoricalMonthlySummaryView(base)).then(result => {
      if (version !== revision || base !== getLedger() || !isActive()) return;
      viewRows = result;
      historyMonth.replaceChildren(el('option','Choose a month',{value:''}),
        ...viewRows.map(row => el('option',row.month,{value:row.month})));
      historyMonth.value = viewRows.some(row => row.month === priorMonth) ? priorMonth : viewRows[0]?.month ?? '';
      historyStatus.textContent = viewRows.length ? viewRows.length + ' reviewed months in this ledger. The workspace can include staged changes.' : 'No accepted historical summaries in this ledger.';
      renderMonth();
    }).catch(() => {
      if (version === revision && base === getLedger() && isActive()) historyStatus.textContent = 'Historical months could not be shown.';
    });
  }
  async function stageChange(which) {
    if (which.disabled || !isActive()) return;
    const selectedMonth = historyMonth.value, expectedLedger = ledger, version = revision;
    const source = which === stage, status = source ? reviewStatus : reconcileStatus;
    const request = new AbortController();
    stagingRequest = request;
    staging = true; setStageHelp();
    try {
      const result = source ? await stageSummaries({input,expectedLedger,
        decisions:[...decisions.values()].map(decision => ({...decision,reason:decision.reason.trim()}))})
        : await stageReconciliation({month:selectedMonth,reason:reason.value.trim(),evidence:evidence.value.trim(),expectedLedger,signal:request.signal});
      if (version !== revision || !isActive()) return;
      const message = result === expectedLedger
        ? 'Already reviewed. Nothing new was staged.'
        : source ? 'Historical summaries staged in this tab. Use Save to persist the changes.'
          : 'Complete reconciliation staged in this tab. Use Save to persist the change.';
      refresh();
      clearConfirmation();
      if (source) clearPreview();
      status.textContent = message;
      status.focus();
      onStaged(message);
    } catch (error) {
      if (version === revision && expectedLedger === getLedger() && isActive()) {
        const code = error?.code;
        status.textContent = code === 'operation-in-progress' ? 'Wait for the current storage operation to finish.'
          : code === 'reopen-before-editing' ? 'Reopen the verified ledger before staging.'
          : source ? 'Review the file and decisions again. No change was staged.'
            : 'Complete reconciliation could not be established for this month. The workbook summary remains the source.';
      }
    } finally { stagingRequest = null; staging = false; setStageHelp(); }
  }
  file.addEventListener('change',() => {
    if (staging) return;
    selected = file.files?.[0] ?? null;
    clearPreview(selected ? 'New file selected. Choose Preview file to inspect it.' : '',false);
  });
  previewButton.addEventListener('click',readPreview);
  discard.addEventListener('click',() => { clearPreview(); file.focus(); });
  prev.addEventListener('click',() => { if (!prev.disabled) { reviewPage--; renderReviewPage(); if (prev.disabled) next.focus(); } });
  next.addEventListener('click',() => { if (!next.disabled) { reviewPage++; renderReviewPage(); if (next.disabled) prev.focus(); } });
  stage.addEventListener('click',() => stageChange(stage));
  reconcile.addEventListener('click',() => stageChange(reconcile));
  historyMonth.addEventListener('change',() => { clearConfirmation(); reconcileStatus.textContent = ''; renderMonth(); });
  historyBatch.addEventListener('change',renderBatch);
  for (const field of [reason,evidence]) field.addEventListener('input',setStageHelp);
  confirm.addEventListener('change',setStageHelp);
  refresh();
  return {
    refresh,
    hasUnfinishedReview() { return Boolean(selected || reason.value.trim() || evidence.value.trim() || confirm.checked); },
    reset() { stagingRequest?.abort(); revision++; active = false; ledger = null; clearPreview(); clearHistory(); }
  };
}
