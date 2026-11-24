import {decodeDraft, encodeDraft, DRAFT_MAX_BYTES} from './draft.mjs';
import {buildManualHistory, estimateClosingNetWorth} from './model.mjs';

if (location.protocol === 'http:' && ['localhost','127.0.0.1'].includes(location.hostname)) initialize();

function initialize() {
  document.querySelector('#local-warning').hidden = true;
  for (const fieldset of document.querySelectorAll('fieldset')) fieldset.disabled = false;
  const form = document.querySelector('#entry'), months = new Map();
  const status = document.querySelector('#status'), findings = document.querySelector('#findings');
  const download = document.querySelector('#export');
  const fields = form.elements;
  const saveDraft = document.querySelector('#save-draft');
  const loadDraft = document.querySelector('#load-draft');
  const copyLabels = document.querySelector('#copy-labels');
  let editing = null, dirty = false, changed = false, output;

  function row(kind, {label = '', amount = ''} = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'category';
    for (const [name, value] of [['Category',label], ['Amount',amount]]) {
      const field = document.createElement('label'), input = document.createElement('input');
      field.textContent = name;
      input.value = value;
      if (name === 'Amount') input.inputMode = 'decimal';
      field.append(input);
      wrapper.append(field);
    }
    const remove = button('Remove row', () => { wrapper.remove(); markDirty(); });
    wrapper.append(remove);
    document.querySelector('#'+kind).append(wrapper);
  }
  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }
  function fill(record = {}) {
    for (const name of ['month','workbook','worksheet','netWorth','currency']) {
      fields[name].value = record[name] ?? (name === 'currency' ? fields.currency.value : '');
    }
    for (const name of ['zeroIncome','zeroExpenses','completeIncome','completeExpenses']) fields[name].checked = !!record[name];
    for (const kind of ['income','expenses']) {
      document.querySelector('#'+kind).replaceChildren();
      (record[kind]?.length ? record[kind] : [{}]).forEach(value => row(kind,value));
    }
    editing = record.month ?? null;
    document.querySelector('#save').textContent = editing ? 'Update month in review' : 'Add month to review';
    dirty = false;
  }
  function markDirty() { dirty = true; download.disabled = true; saveDraft.disabled = true; }
  function read() {
    const record = Object.fromEntries(['month','workbook','worksheet','currency','netWorth'].map(name => [name,fields[name].value]));
    for (const name of ['zeroIncome','zeroExpenses','completeIncome','completeExpenses']) record[name] = fields[name].checked;
    for (const kind of ['income','expenses']) record[kind] = [...document.querySelectorAll('#'+kind+' .category')].map(item => {
      const [label,amount] = [...item.querySelectorAll('input')].map(input => input.value);
      return {label,amount};
    });
    return record;
  }
  function build(values = months.values()) {
    return buildManualHistory({start:fields.start.value,end:fields.end.value,sourceId:fields.sourceId.value,months:[...values]});
  }
  function showReview() {
    const list = document.querySelector('#months');
    document.querySelector('#review-count').textContent = `${months.size} of ${fields.end.value ? monthCount(fields.end.value) : '—'} months entered`;
    list.replaceChildren();
    findings.replaceChildren();
    output = undefined;
    if (months.size) {
      try {
        output = build();
        if (output.trackerFile === null) {
          const finding = document.createElement('li');
          finding.textContent = 'The import file exceeds the tracker’s 1 MiB limit. Save a private draft before narrowing the export.';
          findings.append(finding);
        }
        for (const item of output.preview.findings) {
          const finding = document.createElement('li');
          finding.textContent = [item.month ?? output.input.records[item.recordIndex]?.month, item.code, item.field].filter(Boolean).join(': ');
          findings.append(finding);
        }
      } catch {
        const finding = document.createElement('li');
        finding.textContent = 'Check expected coverage. All reviewed months must fit inside it.';
        findings.append(finding);
      }
    }
    const estimates = estimateClosingNetWorth(output?.preview.rows.filter(row => row.eligible).map(row => row.record) ?? []);
    for (const [month, record] of [...months].sort(([a],[b]) => a.localeCompare(b))) {
      const item = document.createElement('li');
      const summary = output?.input.records.find(value => month === value.month)?.summary;
      item.textContent = `${month}: income ${summary?.incomeTotal?.amount ?? 'unknown'}, expenses ${summary?.expenseTotal?.amount ?? 'unknown'}, net worth ${summary?.netWorthSnapshot?.amount ?? 'unknown'} ${record.currency}`;
      const estimate = estimates.get(month);
      if (estimate) item.append(' · Cash-flow-based closing estimate: '+estimate.amount+' '+estimate.currency);
      else if (month !== '2023-01') item.append(' · No estimate: check the January anchor and uninterrupted monthly totals in the same currency.');
      item.append(button('Edit '+month, () => {
        if (dirty && !confirm('Discard unreviewed edits?')) return;
        fill(record); status.textContent = ''; download.disabled = true; saveDraft.disabled = true; fields.month.focus();
      }), button('Remove '+month, () => {
        if (!confirm('Remove '+month+' from review?')) return;
        months.delete(month); changed = true; if(editing===month) fill(); showReview();
      }));
      list.append(item);
    }
    copyLabels.disabled = !months.size;
    saveDraft.disabled = !output || dirty || editing !== null;
    download.disabled = saveDraft.disabled || output.trackerFile === null;
  }
  function monthCount(end) { return (Number(end.slice(0,4))-2023)*12 + Number(end.slice(5,7)); }
  form.addEventListener('input', event => {
    if (event.target === fields.start || event.target === fields.end || event.target === fields.sourceId) { if (months.size) changed = true; showReview(); }
    else markDirty();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const candidate = read();
    if (candidate.month !== '2023-01' && candidate.netWorth.trim()) {
      status.textContent = 'Enter a closing net-worth snapshot only for January 2023.'; return;
    }
    try {
      if (candidate.month!==editing && months.has(candidate.month)) {
        status.textContent = 'That month is already in review. Use Edit to change it.'; return;
      }
      const staged = new Map(months);
      if (editing) staged.delete(editing);
      staged.set(candidate.month,candidate);
      build(staged.values());
      if (editing) months.delete(editing);
      months.set(candidate.month,candidate);
      changed = true;
      fill({workbook:candidate.workbook,worksheet:candidate.worksheet,currency:candidate.currency});
      status.textContent = candidate.month+' added to review.';
      showReview();
    } catch {
      status.textContent = 'Check that the month is within coverage, source references are filled, and every category has a unique label and a valid amount. Confirm each nonempty list is the complete monthly total. Explicit zero cannot be combined with category rows.';
    }
  });
  document.querySelector('#clear').addEventListener('click', () => {
    if (dirty && !confirm('Discard unreviewed edits?')) return;
    fill(); showReview();
  });
  for (const add of document.querySelectorAll('[data-add]')) add.addEventListener('click', () => { row(add.dataset.add); markDirty(); });
  copyLabels.addEventListener('click', () => {
    const current = read();
    const [previous] = [...months.values()]
      .filter(item => !current.month || item.month < current.month)
      .sort((a,b) => b.month.localeCompare(a.month));
    if (!previous) { status.textContent = 'No earlier month in review to copy.'; return; }
    if ([...current.income,...current.expenses].some(item => item.label || item.amount) &&
      !confirm('Replace the current category rows with previous labels only?')) return;
    for (const kind of ['income','expenses']) {
      document.querySelector('#'+kind).replaceChildren();
      if (!previous[kind].some(item => item.label.trim())) row(kind);
      else previous[kind].filter(item => item.label.trim()).forEach(item => row(kind,{label:item.label}));
    }
    for (const name of ['zeroIncome','zeroExpenses','completeIncome','completeExpenses']) fields[name].checked = false;
    markDirty();
    status.textContent = 'Copied category labels only. Review the labels and enter amounts for this month.';
  });
  download.addEventListener('click', () => {
    if (!output?.trackerFile || dirty || editing !== null) return;
    if (output.preview.findings.length && !confirm('The tracker reported gaps or incomplete months. Download this review draft anyway?')) return;
    downloadFile(output.trackerFile,'manual-monthly-history.json');
  });

  function downloadFile(raw, filename) {
    const url = URL.createObjectURL(new Blob([raw], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  saveDraft.addEventListener('click', () => {
    if (!output || dirty || editing !== null) return;
    try {
      downloadFile(encodeDraft({
        end:fields.end.value, sourceId:fields.sourceId.value, months:[...months.values()]
      }),'private-manual-history-draft.json');
      changed = false;
      status.textContent = 'Private draft download started. Keep it locally and verify it saved.';
    } catch {
      status.textContent = 'Draft could not be saved. Check its size and source references.';
    }
  });

  loadDraft.addEventListener('change', async () => {
    const [file] = loadDraft.files;
    loadDraft.value = '';
    if (!file) return;
    loadDraft.disabled = true;
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > DRAFT_MAX_BYTES) {
        status.textContent = 'Invalid wizard draft size. Nothing was replaced.';
        return;
      }
      const restored = decodeDraft(await file.text());
      if ((months.size || dirty || editing !== null || fields.end.value || fields.sourceId.value) &&
          !confirm('Replace all current wizard entries and any unfinished edits with this draft?')) return;
      months.clear();
      for (const record of restored.months) months.set(record.month,record);
      fields.end.value = restored.end;
      fields.sourceId.value = restored.sourceId;
      fill();
      changed = false;
      showReview();
      status.textContent = 'Private draft loaded. Review its entries before continuing.';
    } catch {
      status.textContent = 'This file is not a valid wizard draft. Nothing was replaced.';
    } finally { loadDraft.disabled = false; }
  });
  addEventListener('beforeunload', event => {
    if (!dirty && !changed) return;
    event.preventDefault();
    event.returnValue = true;
  });
  fill();
}
