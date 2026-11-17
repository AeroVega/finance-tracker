import { parseProviderCsv } from './provider-csv.mjs';
import { prepareCanonicalImport } from './canonical-import.mjs';

const FORMATS = [
  { id: 'wells-fargo-csv-v1', headers: ['DATE', 'DESCRIPTION', 'AMOUNT', 'CHECK #', 'STATUS'], optional: ['CHECK #'] },
  { id: 'sofi-csv-v1', headers: ['Date', 'Description', 'Type', 'Amount', 'Current balance', 'Status'], optional: ['Current balance'] },
  { id: 'fidelity-accounts-history-csv-v1', headers: ['Run Date', 'Account', 'Account Number', 'Action', 'Symbol', 'Description', 'Type', 'Exchange Quantity', 'Exchange Currency', 'Currency', 'Price', 'Quantity', 'Exchange Rate', 'Commission', 'Fees', 'Accrued Interest', 'Amount', 'Settlement Date'] },
];

function detectFormat(bytes) {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    return { status: 'unrecognized', reason: 'invalid-source-bytes', candidates: [] };
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes instanceof ArrayBuffer ? bytes : bytes.slice());
  } catch {
    return { status: 'unrecognized', reason: 'invalid-source-encoding', candidates: [] };
  }
  if (text.includes('\0')) return { status: 'unrecognized', reason: 'invalid-source-encoding', candidates: [] };
  const first = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).find(line => line.trim() !== '');
  if (first === undefined) return { status: 'unrecognized', reason: 'empty-input', candidates: [] };
  const matches = FORMATS.filter(format => {
    const headers = first.split(',');
    const exact = values => values.length === headers.length && values.every((value, index) => value === headers[index]);
    return exact(format.headers) || (format.optional?.length === 1 && exact(format.headers.filter(value => value !== format.optional[0])));
  }).map(format => format.id);
  if (matches.length === 1) return { status: 'recognized', sourceFormat: matches[0], candidates: matches };
  return { status: matches.length > 1 ? 'ambiguous' : 'unrecognized', reason: matches.length > 1 ? 'multiple-supported-header-matches' : 'unsupported-header', candidates: matches };
}

function summarize(records, sourceAccountKeys) {
  const groups = new Map(sourceAccountKeys.map(key => [key, { sourceAccountKey: key, rows: 0, validRows: 0, rowsRequiringReview: 0, validDateRows: 0, observedValidDateStart: null, observedValidDateEnd: null }]));
  for (const record of records) {
    const key = record.sourceAccountKey;
    if (!groups.has(key)) groups.set(key, { sourceAccountKey: key, rows: 0, validRows: 0, rowsRequiringReview: 0, validDateRows: 0, observedValidDateStart: null, observedValidDateEnd: null });
    const group = groups.get(key);
    group.rows++;
    if (record.valid) group.validRows++;
    else group.rowsRequiringReview++;
    if (record.effectiveDate) {
      group.validDateRows++;
      if (group.observedValidDateStart === null || record.effectiveDate < group.observedValidDateStart) group.observedValidDateStart = record.effectiveDate;
      if (group.observedValidDateEnd === null || record.effectiveDate > group.observedValidDateEnd) group.observedValidDateEnd = record.effectiveDate;
    }
  }
  return [...groups.values()].sort((a, b) => String(a.sourceAccountKey).localeCompare(String(b.sourceAccountKey)));
}

/**
 * Read-only preview of one supported provider CSV.
 *
 * @param {object} options
 * @param {Uint8Array|ArrayBuffer} options.bytes Source bytes.
 * @param {object} [options.ledger] Existing in-memory canonical ledger. Never mutated.
 * @param {Record<string,string>} [options.accountMappings] Source account key -> canonical account ID.
 * @param {Record<string,{start:string,end:string,provenance:string}>} [options.coverageByAccount]
 * @returns {Promise<object>} Preview summary and optional canonical validation result.
 */
export async function previewProviderCsv({ bytes, ledger, accountMappings, coverageByAccount } = {}) {
  const detection = detectFormat(bytes);
  if (detection.status !== 'recognized') {
    return {
      status: detection.status,
      reason: detection.reason,
      candidates: detection.candidates,
      rows: null,
      accounts: [],
      requirements: { accountMappings: [], declaredCoverage: [], note: 'No parser was selected; input was not guessed.' },
      canonicalValidation: { status: 'not-run', reason: 'format-not-recognized' },
    };
  }

  let parsed;
  try {
    parsed = await parseProviderCsv({ bytes, sourceFormat: detection.sourceFormat });
  } catch (error) {
    return {
      status: 'parse-error',
      sourceFormat: detection.sourceFormat,
      reason: error?.code ?? 'provider-csv-parse-failed',
      candidates: [detection.sourceFormat],
      rows: null,
      accounts: [],
      requirements: { accountMappings: [], declaredCoverage: [], note: 'The recognized format failed the existing provider parser.' },
      canonicalValidation: { status: 'not-run', reason: 'parse-failed' },
    };
  }

  const sourceKeys = [...new Set([...parsed.sourceAccountKeys, ...parsed.records.map(record => record.sourceAccountKey).filter(key => key !== null)])];
  const accounts = summarize(parsed.records, sourceKeys);
  const missingAccountMappings = sourceKeys.filter(key => !accountMappings?.[key]);
  const missingCoverage = sourceKeys
    .map(key => accountMappings?.[key])
    .filter(Boolean)
    .filter(accountId => !coverageByAccount?.[accountId])
    .filter((accountId, index, all) => all.indexOf(accountId) === index);

  let canonicalValidation = { status: 'not-run', reason: 'provide-ledger-account-mappings-and-declared-coverage' };
  if (ledger && missingAccountMappings.length === 0 && missingCoverage.length === 0 && sourceKeys.length > 0) {
    try {
      // This creates and validates an in-memory proposal only. The returned ledger is
      // deliberately discarded: preview never persists, mutates, or accepts anything.
      const result = prepareCanonicalImport(ledger, {
        parsed,
        accountMappings,
        coverageByAccount,
        syntheticOnly: true,
      });
      canonicalValidation = { status: 'passed', summary: result.summary, runCount: result.runIds.length };
    } catch (error) {
      canonicalValidation = { status: 'failed', reason: error?.message ?? 'canonical-import-validation-failed' };
    }
  }

  return {
    status: 'preview',
    sourceFormat: parsed.sourceFormat,
    institutionId: parsed.institutionId,
    fileFingerprint: parsed.fileFingerprint,
    rows: { sourceRowsSeen: parsed.rowsSeen, parsedRows: parsed.records.length, ignoredRows: parsed.ignoredCount, validRows: parsed.records.filter(row => row.valid).length, rowsRequiringReview: parsed.records.filter(row => !row.valid).length },
    accounts,
    requirements: {
      accountMappings: missingAccountMappings,
      declaredCoverage: missingCoverage,
      note: 'Observed valid dates describe rows present in this file only; they do not establish complete or declared coverage.',
    },
    canonicalValidation,
    readOnly: true,
  };
}
