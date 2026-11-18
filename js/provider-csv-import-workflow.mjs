import { parseRecognizedProviderCsv } from './provider-csv.mjs';
import { prepareCanonicalImport } from './canonical-import.mjs';
import { isCalendarDate } from './import-reconciliation.mjs';

const $ = (root, selector) => root.querySelector(selector);
const element = (document, tag, attributes = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
};
const safeError = error => ({
  'unsupported-header': 'This file does not match one of the supported export formats.',
  'invalid-source-encoding': 'The file is not valid UTF-8 CSV.',
  'invalid-csv-quoting': 'The CSV quoting is malformed.',
  'account-mapping-conflict': 'Each source account must map to one distinct account at the same institution.',
  'activity-outside-declared-coverage': 'At least one usable transaction date falls outside the declared coverage.',
  'confirmed-coverage-required': 'Confirm a valid inclusive coverage range for every mapped account.',
  'invalid-canonical-ledger': 'The current ledger could not be validated. No changes were staged.'
}[error?.code] || 'The import could not be prepared. No changes were staged.');

export function mountProviderImportWorkflow({ root, getLedger, stageImport, onStaged = () => {} }) {
  if (!root || typeof getLedger !== 'function' || typeof stageImport !== 'function') throw new TypeError('invalid-import-workflow-host');
  const document = root.ownerDocument;
  const state = { bytes: null, parsed: null, fingerprint: null, context: 0, mappings: new Map(), preview: null };
  root.replaceChildren();
  const heading = element(document, 'h3', {}, 'Import a supported CSV');
  const intro = element(document, 'p', { className: 'panel-copy' }, 'Choose a Wells Fargo, SoFi or Fidelity export. The file is read locally. Nothing is uploaded or saved until you stage the reviewed import, then choose Save changes.');
  const fileLabel = element(document, 'label', { for: 'provider-import-file' }, 'CSV export');
  const file = element(document, 'input', { id: 'provider-import-file', type: 'file', accept: '.csv,text/csv' });
  const summary = element(document, 'p', { className: 'field-help', role: 'status', 'aria-live': 'polite' }, 'No file selected.');
  const mappings = element(document, 'div', { className: 'provider-import-mappings' });
  const emptyConfirmation = element(document, 'label', { className: 'checkbox-field' });
  const emptyCheck = element(document, 'input', { type: 'checkbox' });
  emptyConfirmation.append(emptyCheck, element(document, 'span', {}, 'I confirm this recognized export intentionally contains zero transaction rows.'));
  emptyConfirmation.hidden = true;
  const discrepancy = element(document, 'p', { className: 'status-message', role: 'status', 'aria-live': 'polite' });
  const stage = element(document, 'button', { type: 'button', className: 'primary-button', disabled: '' }, 'Stage reviewed import');
  const reset = element(document, 'button', { type: 'button', className: 'text-button', disabled: '' }, 'Discard selected file');
  const actions = element(document, 'div', { className: 'storage-actions' });
  actions.append(stage, reset);
  root.append(heading, intro, fileLabel, file, summary, mappings, emptyConfirmation, discrepancy, actions);

  function invalidate(message = 'Import confirmation cleared. Review the file and coverage again.') {
    state.context++;
    state.preview = null;
    stage.disabled = true;
    discrepancy.textContent = message;
  }
  function clear() {
    state.bytes = null; state.parsed = null; state.fingerprint = null; state.mappings.clear();
    file.value = ''; mappings.replaceChildren(); emptyConfirmation.hidden = true; emptyCheck.checked = false;
    invalidate('No import is staged. Choose a CSV file to begin.');
    summary.textContent = 'No file selected.'; reset.disabled = true;
  }
  function dateRange(records) {
    const dates = records.map(row => row.effectiveDate).filter(isCalendarDate).sort();
    return dates.length ? { start: dates[0], end: dates.at(-1) } : null;
  }
  function accountOptions(institutionId) {
    return getLedger().accounts.filter(account => account.institutionId === institutionId);
  }
  function buildMapping(sourceKey, institutionId, records, manual = false) {
    const ledger = getLedger();
    const wrap = element(document, 'fieldset', { className: 'provider-import-account' });
    const legend = element(document, 'legend', {}, manual ? 'Header-only source account' :
      institutionId === 'fidelity' ? 'Fidelity source account · ending ' + String(sourceKey).slice(-4) : 'Bank account in file');
    const accountLabel = element(document, 'label', {}, 'Map to an existing ledger account');
    const select = element(document, 'select');
    select.append(element(document, 'option', { value: '' }, 'Choose an account'));
    for (const account of accountOptions(institutionId)) {
      select.append(element(document, 'option', { value: account.accountId }, account.displayName + ' · ' + account.accountType));
    }
    accountLabel.append(select);
    const observed = dateRange(records);
    const rangeNote = element(document, 'p', { className: 'field-help' }, observed
      ? 'Observed transaction dates: ' + observed.start + ' through ' + observed.end + '. This is not declared coverage.'
      : 'No usable transaction dates were observed. Enter the coverage from the statement/export evidence.');
    const startLabel = element(document, 'label', {}, 'Declared coverage start');
    const start = element(document, 'input', { type: 'date' }); startLabel.append(start);
    const endLabel = element(document, 'label', {}, 'Declared coverage end');
    const end = element(document, 'input', { type: 'date' }); endLabel.append(end);
    const coverageSource = element(document, 'p', { className: 'field-help' }, 'Coverage is inclusive and must be confirmed from the source statement or export context. Dates are not inferred from observed rows.');
    wrap.append(legend, accountLabel, rangeNote, startLabel, endLabel, coverageSource);
    const context = { sourceKey, institutionId, select, start, end, observed, records, manual };
    state.mappings.set(sourceKey, context);
    for (const control of [select, start, end]) control.addEventListener('change', () => {
      invalidate('A mapping or coverage value changed. Review and stage again.');
    });
    return wrap;
  }
  function renderMappings() {
    mappings.replaceChildren(); state.mappings.clear();
    const parsed = state.parsed;
    if (!parsed) return;
    const keys = [...parsed.sourceAccountKeys];
    if (!parsed.records.length && keys.length === 0) {
      const manual = element(document, 'label', {}, 'Source account key for this empty export');
      const key = element(document, 'input', { type: 'text', autocomplete: 'off', maxlength: '100' });
      manual.append(key); mappings.append(manual);
      const add = element(document, 'button', { type: 'button', className: 'secondary-button' }, 'Use this source account');
      add.addEventListener('click', () => {
        const value = key.value.trim();
        if (!value || state.mappings.has(value)) { discrepancy.textContent = 'Enter a non-empty source account key.'; return; }
        mappings.removeChild(manual); mappings.removeChild(add);
        mappings.append(buildMapping(value, parsed.institutionId, [], true));
        invalidate('Header-only export account mapping added. Confirm coverage and the empty-file declaration.');
      });
      mappings.append(add);
      return;
    }
    if (parsed.records.some(row => row.sourceAccountKey === null)) {
      discrepancy.textContent = 'Some rows have no source account identity. They are retained for review, but this file cannot be staged until the identity problem is resolved.';
    }
    for (const key of keys) {
      const rows = parsed.records.filter(row => row.sourceAccountKey === key);
      mappings.append(buildMapping(key, parsed.institutionId, rows));
    }
  }
  async function readFile(selected) {
    clear();
    if (!selected) return;
    const token = state.context;
    try {
      const bytes = await selected.arrayBuffer();
      if (token !== state.context || file.files?.[0] !== selected) return;
      const detection = await parseRecognizedProviderCsv({ bytes });
      if (token !== state.context || file.files?.[0] !== selected) return;
      if (detection.status !== 'recognized') {
        summary.textContent = detection.status === 'ambiguous'
          ? 'The headers match more than one supported format. No parser was selected.'
          : 'The headers are not an exact supported export format. No parser was selected.';
        return;
      }
      state.bytes = bytes; state.parsed = detection.parsed; state.fingerprint = detection.parsed.fileFingerprint;
      const parsed = state.parsed;
      summary.textContent = parsed.sourceFormat + ' · ' + parsed.records.length + ' transaction rows · ' +
        parsed.records.filter(row => row.valid).length + ' parser-valid · ' +
        parsed.records.filter(row => !row.valid).length + ' requiring review. All source rows remain represented.';
      emptyConfirmation.hidden = parsed.records.length !== 0;
      renderMappings();
      reset.disabled = false;
      invalidate(parsed.records.length ? 'Map every source account and declare its coverage to enable staging.' :
        'This is a recognized header-only export. Explicitly confirm that it intentionally contains no transaction rows.');
    } catch (error) {
      summary.textContent = safeError(error);
      invalidate('The file was not accepted. No changes were staged.');
    }
  }
  function prepare() {
    if (!state.parsed || !getLedger()) throw new TypeError('no-ledger-open');
    const parsed = state.parsed;
    if (parsed.records.some(row => row.sourceAccountKey === null)) throw new TypeError('source-account-identity-required');
    if (!parsed.records.length && !emptyCheck.checked) throw new TypeError('empty-export-confirmation-required');
    const accountMappings = {}, coverageByAccount = {};
    for (const [key, mapping] of state.mappings) {
      const accountId = mapping.select.value;
      const start = mapping.start.value, end = mapping.end.value;
      if (!accountId || !isCalendarDate(start) || !isCalendarDate(end) || start > end) throw new TypeError('confirmed-coverage-required');
      const account = getLedger().accounts.find(item => item.accountId === accountId);
      if (!account || account.institutionId !== parsed.institutionId) throw new TypeError('account-mapping-conflict');
      const outOfRange = mapping.records.filter(row => isCalendarDate(row.effectiveDate) && (row.effectiveDate < start || row.effectiveDate > end));
      if (outOfRange.length) throw Object.assign(new TypeError('activity-outside-declared-coverage'), { code: 'activity-outside-declared-coverage', count: outOfRange.length });
      accountMappings[key] = accountId;
      coverageByAccount[accountId] = { start, end, provenance: 'user-confirmed' };
    }
    if (!Object.keys(accountMappings).length) throw new TypeError('explicit-account-mapping-required');
    const result = prepareCanonicalImport(getLedger(), { parsed, accountMappings, coverageByAccount, syntheticOnly: true });
    if (result.ledger === getLedger() || !result.runIds.length) throw new TypeError('import-proposal-has-no-new-run');
    return result;
  }
  stage.addEventListener('click', () => {
    if (stage.disabled) return;
    try {
      const result = prepare();
      stageImport(result.ledger);
      state.preview = null;
      summary.textContent = 'Import staged locally: ' + result.summary.created + ' created, ' + result.summary.matched +
        ' matched, ' + result.summary.review + ' for review, ' + result.summary.rejected + ' rejected, ' +
        result.summary.ignored + ' ignored. Choose Save changes to persist this draft.';
      discrepancy.textContent = 'No file upload or Drive write occurred. Existing review decisions remain in the Review page.';
      stage.disabled = true;
      onStaged();
    } catch (error) {
      discrepancy.textContent = safeError(error);
      stage.disabled = true;
    }
  });
  reset.addEventListener('click', clear);
  file.addEventListener('change', () => readFile(file.files?.[0]));
  emptyCheck.addEventListener('change', () => invalidate('Empty-file confirmation changed. Review and stage again.'));
  root.addEventListener('input', event => {
    if (event.target.matches('input,select')) invalidate('A file, mapping or coverage value changed. Review and stage again.');
  });
  clear();
  return { reset: clear, destroy: clear };
}
