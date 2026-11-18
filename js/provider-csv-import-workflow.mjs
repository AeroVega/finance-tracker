import { previewProviderCsv } from './provider-csv-preview.mjs';
import { parseRecognizedProviderCsv } from './provider-csv.mjs';
import { prepareCanonicalImport } from './canonical-import.mjs';
import { isCalendarDate } from './import-reconciliation.mjs';
import { fail } from './app-error.mjs';

const element = (document, tag, attributes = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
};
const safeError = error => ({
  'canonical-ledger-required': 'Open a synthetic ledger before mapping accounts. The selected file remains local.',
  'unsupported-header': 'This file does not match one of the supported export formats.',
  'unsupported-csv-header': 'This file does not match one of the supported export formats.',
  'invalid-source-encoding': 'The file is not valid UTF-8 CSV.',
  'invalid-source-bytes': 'The selected file could not be decoded as UTF-8 CSV.',
  'missing-csv-header': 'The file does not contain a recognized CSV header.',
  'empty-input': 'The selected file is empty and has no supported header row.',
  'invalid-csv-quoting': 'The CSV quoting is malformed.',
  'account-mapping-conflict': 'Each source account must map to a distinct existing account at the same institution.',
  'import-coverage-conflict': 'This file was already imported with different declared coverage. Prior coverage provenance is not silently rewritten; a dedicated correction flow is required.',
  'distinct-account-required': 'Map every source account to a different existing account.',
  'activity-outside-declared-coverage': 'At least one usable transaction date falls outside the declared inclusive coverage. The row was retained.',
  'confirmed-coverage-required': 'Enter and explicitly confirm valid inclusive coverage for every mapped account.',
  'coverage-confirmation-required': 'Confirm the declared inclusive coverage for every mapped account.',
  'coverage-dates-required': 'Enter both declared coverage dates for every mapped account.',
  'coverage-order-invalid': 'The coverage end date must be on or after its start date.',
  'account-mapping-required': 'Map every source account to an existing account at the same institution.',
  'explicit-account-mapping-required': 'Explicitly map every source account before staging.',
  'empty-export-confirmation-required': 'Confirm that this recognized header-only export intentionally contains zero transaction rows.',
  'reconnect-required': 'The active ledger changed. Discard this file and select it again to review against the current ledger.',
  'reopen-before-editing': 'The workspace session is no longer writable. Reopen or recover the saved ledger before staging.',
  'operation-in-progress': 'Wait for the current storage operation to finish before staging an import.',
  'invalid-parsed-import': 'The canonical import proposal could not be validated. No changes were staged.'
}[error?.code ?? error?.message] || 'The import could not be prepared. No changes were staged.');

export function mountProviderImportWorkflow({ root, getLedger, stageImport, canStage = () => true, getUnavailableReason = () => null, onStaged = () => {} }) {
  if (!root || typeof getLedger !== 'function' || typeof stageImport !== 'function' || typeof canStage !== 'function' || typeof getUnavailableReason !== 'function') fail('invalid-options');
  const document = root.ownerDocument;
  const state = { parsed: null, context: 0, mappings: new Map(), baseLedger: null, contextInvalidated: true, staged: false, validated: false, finishedMessage: '', noOp: false };
  root.replaceChildren();
  const heading = element(document, 'h4', {}, 'Import a supported CSV');
  const intro = element(document, "p", { className: "panel-copy" }, "Choose a Wells Fargo, SoFi or Fidelity export. The file is read locally. Nothing is uploaded or saved until you stage the reviewed import, then use the workspace explicit save action.");
  const fileLabel = element(document, 'label', { for: 'provider-import-file' }, 'CSV export');
  const file = element(document, 'input', { id: 'provider-import-file', type: 'file', accept: '.csv,text/csv' });
  const summary = element(document, 'p', { className: 'field-help', role: 'status', 'aria-live': 'polite' }, 'No file selected.');
  const previewSummary = element(document, 'p', { className: 'provider-import-preview', role: 'status', 'aria-live': 'polite' });
  const mappings = element(document, 'div', { className: 'provider-import-mappings' });
  const emptyConfirmation = element(document, 'label', { className: 'checkbox-field' });
  const emptyCheck = element(document, 'input', { type: 'checkbox' });
  emptyConfirmation.append(emptyCheck, element(document, 'span', {}, 'I confirm this recognized export intentionally contains zero transaction rows.'));
  emptyConfirmation.hidden = true;
  const discrepancy = element(document, 'p', { className: 'status-message', role: 'status', 'aria-live': 'polite' });
  const stage = element(document, 'button', { type: 'button', className: 'primary-button', disabled: '' }, 'Stage import for review');
  const reset = element(document, 'button', { type: 'button', className: 'text-button', disabled: '' }, 'Discard selected file');
  const actions = element(document, 'div', { className: 'storage-actions' });
  actions.append(stage, reset);
  root.append(heading, intro, fileLabel, file, summary, previewSummary, mappings, emptyConfirmation, discrepancy, actions);

  function invalidate(message = 'Import confirmation cleared. Review the file and coverage again.') {
    state.context++;
    state.contextInvalidated = true;
    state.validated = false;
    state.staged = false;
    state.finishedMessage = '';
    state.noOp = false;
    emptyCheck.checked = false;
    for (const mapping of state.mappings.values()) mapping.confirmed.checked = false;
    stage.disabled = true;
    previewSummary.textContent = '';
    discrepancy.textContent = message;
  }
  function resetState({ clearFile = false } = {}) {
    state.parsed = null;
    state.mappings.clear();
    state.baseLedger = null;
    state.staged = false;
    state.validated = false;
    state.finishedMessage = '';
    state.noOp = false;
    if (clearFile) file.value = '';
    mappings.replaceChildren();
    emptyConfirmation.hidden = true;
    emptyCheck.checked = false;
    invalidate('No import is staged. Choose a CSV file to begin.');
    summary.textContent = 'No file selected.';
    previewSummary.textContent = '';
    reset.disabled = !file.files?.length;
  }
  function clear() { resetState({ clearFile: true }); }
  function dateRange(records) {
    const dates = records.map(row => row.effectiveDate).filter(isCalendarDate).sort();
    return dates.length ? { start: dates[0], end: dates.at(-1) } : null;
  }
  function accountOptions(institutionId) {
    const ledger = getLedger();
    return ledger?.accounts?.filter(account => account.institutionId === institutionId) ?? [];
  }
  function buildMapping(sourceKey, institutionId, records, manual = false) {
    const ledger = getLedger();
    const options = accountOptions(institutionId);
    const wrap = element(document, 'fieldset', { className: 'provider-import-account' });
    const legend = element(document, 'legend', {}, manual ? 'Header-only source account' :
      sourceKey === null ? 'Rows missing account identity · assign explicitly' :
      institutionId === 'fidelity' ? 'Fidelity source account · ending ' + String(sourceKey).slice(-4) : 'Bank account in file');
    const accountLabel = element(document, 'label', {}, 'Map to an existing ledger account');
    const select = element(document, 'select');
    select.append(element(document, 'option', { value: '' }, 'Choose an account'));
    for (const account of options) {
      select.append(element(document, 'option', { value: account.accountId }, account.displayName + ' · ' + account.accountType));
    }
    if (!ledger || !options.length) select.disabled = true;
    accountLabel.append(select);
    const observed = dateRange(records);
    const rangeNote = element(document, 'p', { className: 'field-help' }, observed
      ? 'Observed transaction dates: ' + observed.start + ' through ' + observed.end + '. This is not declared coverage.'
      : 'No usable transaction dates were observed. Enter the coverage from the statement/export evidence.');
    const startLabel = element(document, 'label', {}, 'Declared coverage start (inclusive)');
    const start = element(document, 'input', { type: 'date' });
    startLabel.append(start);
    const endLabel = element(document, 'label', {}, 'Declared coverage end (inclusive)');
    const end = element(document, 'input', { type: 'date' });
    endLabel.append(end);
    const confirmLabel = element(document, 'label', { className: 'checkbox-field' });
    const confirmed = element(document, 'input', { type: 'checkbox' });
    confirmLabel.append(confirmed, element(document, 'span', {}, 'I confirm these inclusive dates match the source export or statement evidence.'));
    const coverageSource = element(document, 'p', { className: 'field-help' }, 'Coverage is not inferred from observed rows. Changing the account or either date clears this confirmation.');
    if (!ledger) {
      const unavailable = element(document, 'p', { className: 'field-help' }, 'Open or create a synthetic ledger before mapping. No accounts can be created by this import workflow.');
      wrap.append(legend, accountLabel, unavailable, rangeNote, startLabel, endLabel, confirmLabel, coverageSource);
      for (const control of [start, end, confirmed]) control.disabled = true;
    } else {
      if (!options.length) wrap.append(legend, accountLabel, element(document, 'p', { className: 'field-help' }, 'No existing account at this institution is available. Add an account through the normal account workflow; this importer never creates one.'));
      else wrap.append(legend, accountLabel, rangeNote, startLabel, endLabel, confirmLabel, coverageSource);
    }
    const context = { sourceKey, institutionId, select, start, end, confirmed, observed, records, manual };
    state.mappings.set(sourceKey, context);
    const changed = control => {
      if (control !== confirmed) confirmed.checked = false;
      state.validated = false;
      state.noOp = false;
      previewSummary.textContent = '';
      emptyCheck.checked = false;
      refreshEligibility();
    };
    for (const control of [select, start, end]) control.addEventListener('change', () => changed(control));
    confirmed.addEventListener('change', onConfirmationChange);
    return wrap;
  }
  function renderMappings() {
    mappings.replaceChildren();
    state.mappings.clear();
    const parsed = state.parsed;
    if (!parsed) return;
    const keys = [...parsed.sourceAccountKeys];
    if (!parsed.records.length && keys.length === 0) {
      const manual = element(document, 'label', {}, 'Source account key for this empty Fidelity export');
      const key = element(document, 'input', { type: 'text', autocomplete: 'off', maxlength: '100' });
      manual.append(key);
      mappings.append(manual);
      const add = element(document, 'button', { type: 'button', className: 'secondary-button' }, 'Use this source account');
      add.addEventListener('click', () => {
        const value = key.value.trim();
        if (!value || state.mappings.has(value)) {
          discrepancy.textContent = 'Enter a non-empty source account key.';
          return;
        }
        emptyCheck.checked = false;
        mappings.removeChild(manual);
        mappings.removeChild(add);
        mappings.append(buildMapping(value, parsed.institutionId, [], true));
        refreshEligibility();
      });
      mappings.append(add);
      return;
    }
    for (const key of keys) {
      const rows = parsed.records.filter(row => row.sourceAccountKey === key);
      mappings.append(buildMapping(key, parsed.institutionId, rows));
    }
    const unidentified = parsed.records.filter(row => row.sourceAccountKey === null);
    if (unidentified.length) mappings.append(buildMapping(null, parsed.institutionId, unidentified));
  }
  async function readFile(selected) {
    resetState();
    if (!selected) return;
    const token = state.context;
    const baseLedger = getLedger();
    try {
      const isCurrent = () => token === state.context && file.files?.[0] === selected;
      const ledgerIsCurrent = () => getLedger() === baseLedger;
      const bytes = await selected.arrayBuffer();
      if (!isCurrent()) return;
      if (!ledgerIsCurrent()) { invalidate(safeError({ code: 'reconnect-required' })); return; }
      // The read-only preview is the recognition boundary. It deliberately
      // returns only summaries, so the strict parser is then used to obtain the
      // row model needed for explicit account mapping. Both operations remain
      // local and neither accepts nor persists a proposed ledger.
      const preview = await previewProviderCsv({ bytes });
      if (!isCurrent()) return;
      if (!ledgerIsCurrent()) { invalidate(safeError({ code: 'reconnect-required' })); return; }
      if (preview.status !== 'preview') {
        summary.textContent = preview.status === 'ambiguous'
          ? 'The headers match more than one supported format. No parser was selected.'
          : ['invalid-source-encoding', 'invalid-source-bytes', 'missing-csv-header', 'empty-input'].includes(preview.reason) || preview.status === 'parse-error'
            ? safeError({ code: preview.reason })
            : 'The headers are not an exact supported export format. No parser was selected.';
        return;
      }
      const detection = await parseRecognizedProviderCsv({ bytes });
      if (!isCurrent()) return;
      if (!ledgerIsCurrent()) { invalidate(safeError({ code: 'reconnect-required' })); return; }
      if (detection.status !== 'recognized' || detection.parsed.sourceFormat !== preview.sourceFormat ||
        detection.parsed.fileFingerprint !== preview.fileFingerprint) fail('invalid-parsed-import');
      state.parsed = detection.parsed;
      state.baseLedger = baseLedger;
      state.contextInvalidated = false;
      const parsed = state.parsed;
      summary.textContent = parsed.sourceFormat + ' · ' + parsed.records.length + ' transaction rows · ' +
        parsed.records.filter(row => row.valid).length + ' parser-valid · ' +
        parsed.records.filter(row => !row.valid).length + ' requiring review. All source rows remain represented.';
      emptyConfirmation.hidden = parsed.records.length !== 0;
      renderMappings();
      reset.disabled = false;
      if (!baseLedger) {
         invalidate('No synthetic ledger was open when the file was read. Open or create one, discard this file, then select it again; nothing was uploaded or saved.');
        return;
      }
      refreshEligibility();
    } catch (error) {
      summary.textContent = safeError(error);
      invalidate('The file was not accepted. No changes were staged.');
    }
  }
  function checkContext() {
    if (state.parsed && getLedger() !== state.baseLedger && !state.contextInvalidated) {
      invalidate(safeError({ code: 'reconnect-required' }));
      return false;
    }
    return !state.contextInvalidated;
  }
  function prepare() {
    if (state.staged) fail('invalid-parsed-import');
    if (!checkContext()) fail('reconnect-required');
    const ledger = getLedger();
    if (!state.parsed || !ledger) fail('canonical-ledger-required');
    if (ledger !== state.baseLedger) fail('reconnect-required');
    if (!state.parsed.records.length && !emptyCheck.checked) fail('empty-export-confirmation-required');
    const parsed = state.parsed;
    const accountMappings = {}, coverageByAccount = {}, mappedAccounts = new Set();
    for (const [key, mapping] of state.mappings) {
      const accountId = mapping.select.value;
      const start = mapping.start.value, end = mapping.end.value;
      if (!accountId) fail('account-mapping-required');
      if (!isCalendarDate(start) || !isCalendarDate(end)) fail('coverage-dates-required');
      if (start > end) fail('coverage-order-invalid');
      if (!mapping.confirmed.checked) fail('coverage-confirmation-required');
      const account = ledger.accounts.find(item => item.accountId === accountId);
      if (!account || account.institutionId !== parsed.institutionId) fail('account-mapping-conflict');
      if (mappedAccounts.has(accountId)) fail('distinct-account-required');
      mappedAccounts.add(accountId);
      const outOfRange = mapping.records.filter(row => isCalendarDate(row.effectiveDate) && (row.effectiveDate < start || row.effectiveDate > end));
      if (outOfRange.length) fail('activity-outside-declared-coverage');
      accountMappings[String(key)] = accountId;
      coverageByAccount[accountId] = { start, end, provenance: 'user-confirmed' };
    }
    if (!Object.keys(accountMappings).length) fail('explicit-account-mapping-required');
    const result = prepareCanonicalImport(ledger, { parsed, accountMappings, coverageByAccount, syntheticOnly: true });
    if (result.ledger === ledger || !result.runIds.length) fail('invalid-parsed-import');
    return result;
  }
  function refreshEligibility() {
    state.validated = false;
    if (state.staged) {
      stage.disabled = true;
      discrepancy.textContent = state.finishedMessage || 'This file is already staged. Select another export to prepare another import.';
      return;
    }
    if (!state.parsed) {
      stage.disabled = true;
      return;
    }
    if (!checkContext()) { stage.disabled = true; return; }
    const unavailable = getUnavailableReason();
    if (unavailable || !canStage()) {
      stage.disabled = true;
      discrepancy.textContent = unavailable || 'The current workspace session cannot stage changes.';
      return;
    }
    try {
      const result = prepare();
      state.validated = true;
      const counts = result.summary;
      state.noOp = result.summary.noOp === state.mappings.size;
      state.finishedMessage = state.noOp ? 'This exact file has already been imported for the selected account. No duplicate rows or new import run will be staged.' : '';
      previewSummary.textContent = state.noOp
        ? state.finishedMessage
        : state.parsed.records.length === 0
          ? 'Ready to stage a confirmed header-only export. It will record an empty import run with no transaction rows.'
          : 'Read-only reconciliation preview: ' + counts.created + ' new, ' + counts.matched + ' matched, ' + counts.review + ' for review, ' + counts.rejected + ' rejected, ' + counts.ignored + ' ignored. Nothing has been staged yet.';
      stage.disabled = state.noOp;
      discrepancy.textContent = state.noOp ? 'Discard this file to select another export.' : 'Mapping and inclusive coverage are valid. Stage this import to add it to the unsaved ledger draft.';
    } catch (error) {
      state.validated = false;
      state.noOp = false;
      previewSummary.textContent = '';
      if (error?.code === 'reconnect-required') invalidate(safeError(error));
      else { stage.disabled = true; discrepancy.textContent = safeError(error); }
    }
  }
  function refreshAvailability() {
    if (state.staged || !state.parsed) return;
    if (!checkContext()) { stage.disabled = true; return; }
    const unavailable = getUnavailableReason();
    if (unavailable || !canStage()) {
      stage.disabled = true;
      discrepancy.textContent = unavailable || 'The current workspace session cannot stage changes.';
      return;
    }
    if (state.validated) {
      stage.disabled = state.noOp;
      if (state.noOp) discrepancy.textContent = state.finishedMessage;
    } else refreshEligibility();
  }
  function onStage() {
    if (stage.disabled) return;
    const unavailable = getUnavailableReason();
    if (unavailable || !canStage()) {
      stage.disabled = true;
      discrepancy.textContent = unavailable || 'The current workspace session cannot stage changes.';
      return;
    }
    try {
      const result = prepare();
      if (result.summary.noOp === state.mappings.size) {
        state.staged = true;
        state.validated = false;
        state.noOp = true;
        state.finishedMessage = 'This exact file has already been imported for the selected account. No duplicate rows or new import run were staged.';
        stage.disabled = true;
        discrepancy.textContent = state.finishedMessage;
        return;
      }
      stageImport(result.ledger);
      state.baseLedger = getLedger();
      state.staged = true;
      state.validated = false;
      state.noOp = false;
      state.finishedMessage = 'This file is already staged. Select another export to prepare another import.';
      summary.textContent = 'Import staged locally: ' + result.summary.created + ' created, ' + result.summary.matched + ' matched, ' +
        result.summary.review + ' for review, ' + result.summary.rejected + ' rejected, ' + result.summary.ignored + ' ignored. Use the workspace's explicit save action to persist this draft.';
      previewSummary.textContent = 'Import staged locally: ' + result.summary.created + ' new, ' + result.summary.matched + ' matched, ' + result.summary.review + ' for review, ' + result.summary.rejected + ' rejected, ' + result.summary.ignored + ' ignored.';
      discrepancy.textContent = 'No file upload or Drive write occurred. Existing review decisions remain in the Review page.';
      stage.disabled = true;
      try { onStaged(); } catch {
        discrepancy.textContent = 'The import was staged locally, but the workspace view could not refresh. Reload before taking another action.';
      }
    } catch (error) {
      previewSummary.textContent = '';
      if (error?.code === 'reconnect-required') invalidate(safeError(error));
      else { discrepancy.textContent = safeError(error); stage.disabled = true; }
    }
  }
  const onFileChange = () => readFile(file.files?.[0]);
  const onReset = clear;
  const onConfirmationChange = () => {
    state.noOp = false;
    state.finishedMessage = '';
    previewSummary.textContent = '';
    refreshEligibility();
  };
  const onEmptyConfirmation = onConfirmationChange;
  stage.addEventListener('click', onStage);
  reset.addEventListener('click', onReset);
  file.addEventListener('change', onFileChange);
  emptyCheck.addEventListener('change', onEmptyConfirmation);
  clear();
  return {
    reset: clear,
    checkContext,
    refresh: refreshAvailability,
    destroy() {
      clear();
      stage.removeEventListener('click', onStage);
      reset.removeEventListener('click', onReset);
      file.removeEventListener('change', onFileChange);
      emptyCheck.removeEventListener('change', onEmptyConfirmation);
      root.replaceChildren();
    }
  };
}
