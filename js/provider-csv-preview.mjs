import { parseRecognizedProviderCsv } from './provider-csv.mjs';
import { prepareCanonicalImport } from './canonical-import.mjs';

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
  let detection;
  try {
    detection = await parseRecognizedProviderCsv({ bytes });
  } catch (error) {
    const reason = error?.code ?? 'provider-csv-parse-failed';
    const unrecognized = ['invalid-source-bytes', 'invalid-source-encoding', 'missing-csv-header'].includes(reason);
    return {
      status: unrecognized ? 'unrecognized' : 'parse-error',
      reason: reason === 'missing-csv-header' ? 'empty-input' : reason,
      candidates: [], rows: null, accounts: [],
      requirements: { accountMappings: [], sourceAccountIdentityRows: [], declaredCoverage: [], note: 'Input did not produce a supported parsed file.' },
      canonicalValidation: { status: 'not-run', reason: unrecognized ? 'format-not-recognized' : 'parse-failed' },
    };
  }
  if (detection.status !== 'recognized') {
    return {
      ...detection, rows: null, accounts: [],
      requirements: { accountMappings: [], sourceAccountIdentityRows: [], declaredCoverage: [], note: 'No parser was selected; input was not guessed.' },
      canonicalValidation: { status: 'not-run', reason: 'format-not-recognized' },
    };
  }
  const parsed = detection.parsed;
  const sourceKeys = [...new Set([...parsed.sourceAccountKeys, ...parsed.records.map(record => record.sourceAccountKey).filter(key => key !== null), ...(parsed.records.length === 0 ? Object.keys(accountMappings ?? {}) : [])])];
  const accounts = summarize(parsed.records, sourceKeys);
  const sourceAccountIdentityRows = parsed.records.filter(record => record.sourceAccountKey === null).map(record => record.rowOrdinal);
  const missingAccountMappings = sourceKeys.filter(key => !accountMappings?.[key]);
  const missingCoverage = sourceKeys
    .map(key => accountMappings?.[key])
    .filter(Boolean)
    .filter(accountId => !coverageByAccount?.[accountId])
    .filter((accountId, index, all) => all.indexOf(accountId) === index);

  let canonicalValidation = { status: 'not-run', reason: 'provide-ledger-account-mappings-and-declared-coverage' };
  if (ledger && sourceAccountIdentityRows.length === 0 && missingAccountMappings.length === 0 && missingCoverage.length === 0 && sourceKeys.length > 0) {
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
      explicitAccountSelectionRequired: parsed.records.length === 0 && sourceKeys.length === 0,
      sourceAccountIdentityRows,
      declaredCoverage: missingCoverage,
      note: 'Observed valid dates describe rows present in this file only; they do not establish complete or declared coverage.',
    },
    canonicalValidation,
    readOnly: true,
  };
}
