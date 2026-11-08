import { canonicalizeJcs, sha256Hex } from './transaction-protocol.mjs';

/** Synthetic-tested CSV boundary, not a claim of live provider compatibility.
 * UTF-8 (optional BOM), comma delimiter, LF/CRLF/CR, exact ordered headers.
 * Optional CHECK # / Current balance columns may be absent. No other aliases.
 * WF accepts MM/DD/YYYY plus ISO used by the existing invented fixture; SoFi
 * accepts ISO only; Fidelity accepts MM/DD/YYYY only. Amount grammar is plain
 * signed decimal: no grouping, currency symbols, exponent, or parentheses.
 * CSV record ordinals include headers/blanks/footer; physicalLine counts lines.
 * Only the exact invented Fidelity footer below is known; unknown text rejects.
 * All source strings survive untrimmed. Empty optional source values map null.
 */
const HEADERS = {
  'wells-fargo-csv-v1': ['DATE', 'DESCRIPTION', 'AMOUNT', 'CHECK #', 'STATUS'],
  'sofi-csv-v1': ['Date', 'Description', 'Type', 'Amount', 'Current balance', 'Status'],
  'fidelity-accounts-history-csv-v1': ['Run Date', 'Account', 'Account Number', 'Action', 'Symbol', 'Description', 'Type', 'Exchange Quantity', 'Exchange Currency', 'Currency', 'Price', 'Quantity', 'Exchange Rate', 'Commission', 'Fees', 'Accrued Interest', 'Amount', 'Settlement Date'],
};
const HASH_BATCH_SIZE = 16;
const INSTITUTIONS = { 'wells-fargo-csv-v1': 'wells-fargo', 'sofi-csv-v1': 'sofi', 'fidelity-accounts-history-csv-v1': 'fidelity' };
function fail(code) { const error = new TypeError(code); error.code = code; throw error; }

function csvRecords(text) {
  const result = [];
  let cells = [], cell = '', state = 'start', line = 1, startLine = 1, touched = false;
  const finishCell = () => { cells.push(cell); cell = ''; state = 'start'; };
  const finishRecord = () => { finishCell(); result.push({ cells, physicalLine: startLine, rowOrdinal: result.length + 1 }); cells = []; touched = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const newline = c === '\r' || c === '\n';
    const newlineText = c === '\r' && text[i + 1] === '\n' ? '\r\n' : c;
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else state = 'closed';
      } else { cell += newline ? newlineText : c; if (newline) { line++; if (newlineText.length === 2) i++; } }
      continue;
    }
    if (newline) {
      finishRecord(); line++; startLine = line; if (newlineText.length === 2) i++; continue;
    }
    touched = true;
    if (c === ',') { finishCell(); continue; }
    if (state === 'closed') fail('invalid-csv-quoting');
    if (c === '"') { if (state !== 'start') fail('invalid-csv-quoting'); state = 'quoted'; continue; }
    cell += c; state = 'unquoted';
  }
  if (state === 'quoted') fail('invalid-csv-quoting');
  if (touched || cells.length || cell !== '' || state === 'closed') finishRecord();
  return result;
}
function decimal(text) {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  let [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  whole = whole.replace(/^0+(?=\d)/, ''); fraction = fraction.replace(/0+$/, '');
  return (negative && (whole !== '0' || fraction) ? '-' : '') + whole + (fraction ? `.${fraction}` : '');
}
function date(text, mode) {
  let iso = text;
  if (mode !== 'iso' && /^\d{2}\/\d{2}\/\d{4}$/.test(text)) iso = `${text.slice(6)}-${text.slice(0, 2)}-${text.slice(3, 5)}`;
  else if (mode === 'us') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ? iso : null;
}
const blank = row => row.cells.every(value => value === '');
const optional = value => value === undefined || value === '' ? null : value;

export async function parseProviderCsv({ bytes, sourceFormat } = {}) {
  if (!Object.hasOwn(HEADERS, sourceFormat)) fail('unsupported-source-format');
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) fail('invalid-source-bytes');
  const data = new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.slice());
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { fail('invalid-source-encoding'); }
  if (text.includes('\0')) fail('invalid-source-encoding');
  const parsed = csvRecords(text);
  const headerIndex = parsed.findIndex(row => !blank(row));
  // An empty file must still carry a recognized schema, rather than silently
  // accepting an empty download or a wrong export as successful history.
  if (headerIndex < 0) fail('missing-csv-header');
  const headers = parsed[headerIndex].cells;
  const expected = HEADERS[sourceFormat];
  const optionalHeader = sourceFormat === 'wells-fargo-csv-v1' ? 'CHECK #' : sourceFormat === 'sofi-csv-v1' ? 'Current balance' : null;
  const matches = candidate => candidate.length === headers.length && candidate.every((v, i) => v === headers[i]);
  if (!matches(expected) && !(optionalHeader && matches(expected.filter(v => v !== optionalHeader)))) fail('unsupported-csv-header');
  const fidelity = sourceFormat === 'fidelity-accounts-history-csv-v1';
  const wf = sourceFormat === 'wells-fargo-csv-v1';
  let ignoredCount = headerIndex + 1;
  const records = [];
  // Bound native crypto jobs and observe every rejection immediately. Settle a
  // batch before reporting its earliest source-row failure, regardless of the
  // completion order. CSV syntax was already validated for the entire file.
  let pending = [];
  const flush = async () => {
    const results = await Promise.all(pending.map(p => p.result));
    for (let i = 0; i < results.length; i++) {
      if (!results[i].ok) throw results[i].error;
      pending[i].record.sourceRowFingerprint = results[i].value;
    }
    pending = [];
  };
  for (let rowIndex = headerIndex + 1; rowIndex < parsed.length; rowIndex++) {
    const row = parsed[rowIndex];
    // Source fields retain their exact strings; the intermediate cell array no
    // longer needs to survive until the last digest completes.
    parsed[rowIndex] = null;
    if (blank(row) || (fidelity && row.cells.length === 2 && row.cells[0] === 'This is invented explanatory footer text' && row.cells[1] === ' not a transaction row.')) { ignoredCount++; continue; }
    const sourceFields = Object.fromEntries(headers.map((h, i) => [h, row.cells[i] ?? null]));
    // Retain surplus cells rather than losing evidence on malformed rows.
    if (row.cells.length > headers.length) sourceFields.__extraCells = row.cells.slice(headers.length);
    const get = key => optional(sourceFields[key]);
    const rawAmount = get(wf ? 'AMOUNT' : 'Amount');
    const rawDate = get(wf ? 'DATE' : fidelity ? 'Run Date' : 'Date');
    const sourceDescription = sourceFields[wf ? 'DESCRIPTION' : 'Description'] ?? '';
    const status = get(wf ? 'STATUS' : 'Status');
    const statuses = { Posted: 'posted', Pending: 'pending', Reversed: 'reversed', Corrected: 'corrected' };
    const effectiveDate = rawDate === null ? null : date(rawDate, wf ? 'both' : fidelity ? 'us' : 'iso');
    const settlement = get('Settlement Date');
    const currency = get('Currency');
    const record = {
      sourceRowFingerprint: null,
      sourceAccountKey: fidelity ? get('Account Number') : 'default', sourceFields,
      rowOrdinal: row.rowOrdinal, physicalLine: row.physicalLine, sourceDescription,
      normalizedDescription: sourceDescription.trim().replace(/\s+/g, ' ').toLowerCase(),
      sourceAction: get(fidelity ? 'Action' : 'Type'), sourceRecordId: null,
      amountText: rawAmount === null ? null : decimal(rawAmount), currency,
      effectiveDate, postedDate: null, settlementDate: settlement === null ? null : date(settlement, 'us'),
      lifecycleStatus: status === null ? 'unknown' : (Object.hasOwn(statuses, status) ? statuses[status] : 'unknown'),
      securitySymbol: get('Symbol'), quantityDecimal: get('Quantity'), unitPriceDecimal: get('Price'),
      exchangeQuantity: get('Exchange Quantity'), exchangeCurrency: get('Exchange Currency'), exchangeRate: get('Exchange Rate'),
      commission: get('Commission'), fees: get('Fees'), accruedInterest: get('Accrued Interest'),
      sourceBalance: get('Current balance'), checkNumber: get('CHECK #'), valid: true, errorCode: null,
    };
    const errors = [];
    if (row.cells.length !== headers.length) errors.push('invalid-row-width');
    if (record.sourceAccountKey === null) errors.push('missing-source-account');
    if (!effectiveDate) errors.push('invalid-effective-date');
    if (settlement !== null && record.settlementDate === null) errors.push('invalid-settlement-date');
    if ((!fidelity && rawAmount === null) || (rawAmount !== null && record.amountText === null)) errors.push('invalid-amount');
    if (currency !== null && !/^[A-Z]{3}$/.test(currency)) errors.push('invalid-currency');
    if (status !== null && !Object.hasOwn(statuses, status)) errors.push('invalid-status');
    for (const key of ['quantityDecimal', 'unitPriceDecimal', 'exchangeQuantity', 'exchangeRate', 'commission', 'fees', 'accruedInterest', 'sourceBalance']) {
      if (record[key] !== null && decimal(record[key]) === null) errors.push('invalid-optional-number');
    }
    record.errorCode = errors[0] ?? null; record.valid = errors.length === 0;
    records.push(record);
    pending.push({ record, result: sha256Hex(canonicalizeJcs(sourceFields)).then(
      value => ({ ok: true, value }), error => ({ ok: false, error }),
    ) });
    if (pending.length === HASH_BATCH_SIZE) await flush();
  }
  await flush();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  const fileFingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { sourceFormat, institutionId: INSTITUTIONS[sourceFormat], fileFingerprint, rowsSeen: parsed.length, ignoredCount,
    records, sourceAccountKeys: fidelity ? [...new Set(records.map(r => r.sourceAccountKey).filter(v => v !== null))] : ['default'], sourceCoverage: null };
}
