import { fail } from './app-error.mjs';
import { validateHistoricalMonthlySummaries } from './historical-monthly-summary-validation.mjs';
import { canonicalizeJcs, sha256Hex } from './transaction-protocol.mjs';
import { summarizeLedgerPeriods } from './canonical-import.mjs';
import { isCalendarDate } from './import-reconciliation.mjs';

import { HISTORICAL_LEDGER_VERSION } from './persistence-data-class.mjs';
export { HISTORICAL_LEDGER_VERSION };
export const HISTORICAL_COLLECTIONS = Object.freeze({
  historicalSummaryBatches: 'batchId',
  historicalReconciliations: 'reconciliationId'
});
const MONTH = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INPUT_FORMAT = 'finance-tracker-historical-monthly-summaries';
const MAX_RECORDS = 600;
const object = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const list = value => Array.isArray(value) && value.length <= MAX_RECORDS;
const text = (value, limit = 500) => typeof value === 'string' && !!value.trim() && value.length <= limit;
const optionalText = value => value === undefined || text(value);
const keys = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));
const exact = (value, names) => keys(value, names) && names.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && UUID.test(value);
const month = value => typeof value === 'string' && MONTH.test(value);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const same = (a, b) => canonicalizeJcs(a) === canonicalizeJcs(b);
const scopeKeys = ['kind','accountIds'];
const currencies = value => typeof value === 'string' && CURRENCY.test(value);
const knownBreakdowns = ['incomeSources','expenseCategories'];
const summaryKeys = ['incomeTotal','expenseTotal','netWorthSnapshot','netCashFlow'];
const provenanceKeys = ['workbook','worksheet','mapping','sourceId','converterVersion','cell','range','cells','ranges','snapshotAsOf'];

function validRange(value) {
  if (!exact(value, ['start','end']) || !month(value.start) || !month(value.end) || value.start > value.end) return false;
  const measure = label => Number(label.slice(0, 4)) * 12 + Number(label.slice(5));
  return measure(value.end) - measure(value.start) < MAX_RECORDS;
}
function validScope(value) {
  if (value === undefined) return true;
  if (!keys(value, scopeKeys)) return false;
  if (['aggregate','unknown'].includes(value.kind)) return Object.keys(value).length === 1;
  return value.kind === 'accounts' && list(value.accountIds) && value.accountIds.length > 0 &&
    value.accountIds.every(uuid) && new Set(value.accountIds).size === value.accountIds.length;
}
function validProvenance(value) {
  if (!keys(value, provenanceKeys) || !['workbook','worksheet','mapping'].every(key => text(value[key]))) return false;
  return ['sourceId','converterVersion','cell','range'].every(key => optionalText(value[key])) &&
    (value.snapshotAsOf === undefined || isCalendarDate(value.snapshotAsOf)) &&
    ['cells','ranges'].every(key => value[key] === undefined ||
      (keys(value[key], summaryKeys.concat(knownBreakdowns)) && Object.values(value[key]).every(item => text(item))));
}
function moneyShape(value) {
  return exact(value, ['amount','currency']) && typeof value.amount === 'string' && currencies(value.currency);
}
function validRecordShape(record) {
  if (!keys(record, ['month','summary','breakdowns','provenance','scope']) || !month(record.month) ||
    !keys(record.summary, summaryKeys) || !Object.values(record.summary).every(value => value == null || moneyShape(value)) ||
    !validProvenance(record.provenance) || !validScope(record.scope)) return false;
  if (record.breakdowns === undefined) return true;
  return keys(record.breakdowns, knownBreakdowns) && Object.values(record.breakdowns).every(part =>
    exact(part, ['complete','items']) && typeof part.complete === 'boolean' && list(part.items) &&
    part.items.every(item => exact(item, ['label','amount']) && text(item.label) && moneyShape(item.amount)));
}

function acceptedByMonth(ledger) {
  const current = new Map();
  for (const batch of ledger?.historicalSummaryBatches ?? []) {
    for (const entry of batch.entries) {
      const prior = current.get(entry.record.month);
      if (entry.action === 'accept' && (!prior || !same(prior.record, entry.record))) {
        current.set(entry.record.month, {batchId: batch.batchId, recordIndex: entry.recordIndex, record: entry.record});
      }
    }
  }
  return current;
}

function preview(ledger, input) {
  if (!keys(input, ['format','version','expectedMonthRange','records']) ||
    (input.format !== undefined && input.format !== INPUT_FORMAT) ||
    (input.version !== undefined && input.version !== 1) || !list(input.records) ||
    !validRange(input.expectedMonthRange)) fail('invalid-historical-summary-input');
  const result = validateHistoricalMonthlySummaries(input);
  const current = acceptedByMonth(ledger);
  const rowsByMonth = new Map(), invalid = new Set();
  for (const [recordIndex, record] of result.records.entries()) {
    if (!validRecordShape(record)) {
      invalid.add(recordIndex);
      result.findings.push({code:'invalid-historical-record-shape',recordIndex});
    }
    if (month(record?.month)) {
      if (!rowsByMonth.has(record.month)) rowsByMonth.set(record.month, []);
      rowsByMonth.get(record.month).push(recordIndex);
    }
  }
  for (const finding of result.findings) {
    if (['duplicate-month-summary','overlapping-month-summaries','missing-month-summary'].includes(finding.code)) continue;
    if (finding.recordIndex !== undefined) invalid.add(finding.recordIndex);
    // Legacy breakdown findings were month-only; the current validator emits
    // the record index, including when multiple rows share the same month.
    else for (const index of rowsByMonth.get(finding.month) ?? []) invalid.add(index);
  }
  result.rows = result.records.map((record, recordIndex) => {
    const prior = current.get(record?.month) ?? null;
    if (prior && !invalid.has(recordIndex)) result.findings.push({code: same(record, prior.record) ?
      'historical-record-already-accepted' : 'historical-record-conflicts-with-saved-month',month:record.month,recordIndex});
    return { recordIndex, record, eligible: !invalid.has(recordIndex), current: prior };
  });
  result.status = result.findings.length ? 'review' : 'valid';
  return result;
}

/** Read-only preview. The caller must not write or use it as a stage capability. */
export function previewHistoricalMonthlySummaries(ledger, input) {
  return preview(ledger, input);
}

export function prepareHistoricalSummaries(ledger, {input, decisions}, options = {}) {
  const result = preview(ledger, input);
  if (!list(decisions)) fail('invalid-historical-summary-review');
  const choice = new Map();
  for (const decision of decisions) {
    if (!exact(decision, ['recordIndex','action','reason']) || !Number.isSafeInteger(decision.recordIndex) ||
      !['accept','exclude'].includes(decision.action) || !text(decision.reason) ||
      !result.rows[decision.recordIndex]?.eligible || choice.has(decision.recordIndex)) fail('invalid-historical-summary-review');
    choice.set(decision.recordIndex, decision);
  }
  const entries = [], selectedMonths = new Set();
  for (const row of result.rows) {
    if (!row.eligible) continue; // The review displays identified rejected rows; they cannot enter authoritative storage.
    const decision = choice.get(row.recordIndex);
    if (!decision) fail('invalid-historical-summary-review');
    if (decision.action === 'accept') {
      if (selectedMonths.has(row.record.month)) fail('invalid-historical-summary-review');
      selectedMonths.add(row.record.month);
    }
    entries.push({...decision,reason:decision.reason.trim(),record:row.record});
  }
  if (!entries.some(entry => entry.action === 'accept')) fail('invalid-historical-summary-review');
  // Replaying an identical batch cannot append history or supersede other months.
  if (entries.every(entry => entry.action === 'exclude' ||
    (result.rows[entry.recordIndex].current && same(result.rows[entry.recordIndex].current.record, entry.record))) &&
    (ledger.historicalSummaryBatches ?? []).some(batch =>
      same(batch.expectedMonthRange, result.expectedMonthRange) && same(batch.entries, entries))) return ledger;
  const batch = {
    batchId: options.id ?? globalThis.crypto.randomUUID(),
    version: 1,
    recordedAt: options.now ?? new Date().toISOString(),
    expectedMonthRange: result.expectedMonthRange,
    entries
  };
  return {...ledger, version:HISTORICAL_LEDGER_VERSION,
    historicalSummaryBatches:[...(ledger.historicalSummaryBatches ?? []),batch],
    historicalReconciliations:ledger.historicalReconciliations ?? []};
}

function dateRange(label) {
  const [year, m] = label.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][m-1];
  return {start:label+'-01',end:label+'-'+String(days)};
}
function accountIds(record) {
  return record.scope?.kind === 'accounts' ? [...record.scope.accountIds].sort() : [];
}
function reportScope(ledger, record) {
  const ids = accountIds(record);
  const currency = record.summary.incomeTotal.currency;
  if (!ids.length || record.summary.expenseTotal.currency !== currency ||
    (record.summary.netCashFlow && record.summary.netCashFlow.currency !== currency) ||
    ids.some(id => !ledger.accounts.some(a => a.accountId === id && a.currency === currency))) return null;
  return {...dateRange(record.month),currency,accountIds:ids};
}
function coveredRuns(ledger, scope) {
  // For Alpha require one independently declared, entirely reviewed run per
  // account that covers the complete month. Partial ranges are not joined.
  const runIds = scope.accountIds.map(accountId => ledger.imports.find(run =>
    run.accountId === accountId && run.status === 'processed' &&
    run.declaredCoverage.start <= scope.start && run.declaredCoverage.end >= scope.end)?.importRunId);
  return runIds.every(Boolean) ? runIds : null;
}
function eligibility(ledger, scope, report) {
  if (!scope) return ['workbook-scope-currency-not-comparable'];
  const reasons = report.reasons.filter(reason => reason !== 'coverage-not-reconciled');
  if (!coveredRuns(ledger, scope)) reasons.push('missing-reviewed-full-month-coverage');
  if (report.excluded.some(entry => entry.reason === 'pending')) reasons.push('pending-activity');
  return [...new Set(reasons)];
}
function transactionContext(ledger) {
  // Deliberately conservative: any change to the canonical transaction evidence
  // invalidates the prior reconciliation. Position or summary changes do not.
  return sha256Hex(canonicalizeJcs({
    accounts:ledger.accounts, imports:ledger.imports, observations:ledger.observations,
    activities:ledger.activities, events:ledger.events, reviewDecisions:ledger.reviewDecisions
  }));
}

export async function prepareHistoricalReconciliation(ledger, {month: label, reason, evidence}, options = {}) {
  const source = acceptedByMonth(ledger).get(label);
  if (!source || !text(reason) || !text(evidence, 2000)) fail('invalid-historical-summary-review');
  const scope = reportScope(ledger, source.record);
  const report = scope ? summarizeLedgerPeriods(ledger, [scope])[0] : null;
  if (eligibility(ledger, scope, report).length) fail('historical-detail-not-reconciled');
  const contextSha256 = await transactionContext(ledger);
  const latest = ledger.historicalReconciliations.filter(entry => entry.month === label).at(-1);
  if (latest?.contextSha256 === contextSha256 && latest.batchId === source.batchId &&
    latest.recordIndex === source.recordIndex && latest.reason === reason.trim() && latest.evidence === evidence.trim()) return ledger;
  const reconciliation = {reconciliationId:options.id ?? globalThis.crypto.randomUUID(),version:1,
    month:label,batchId:source.batchId,recordIndex:source.recordIndex,scope,
    reviewedRunIds:coveredRuns(ledger, scope),contextSha256,
    reason:reason.trim(),evidence:evidence.trim(),recordedAt:options.now ?? new Date().toISOString()};
  return {...ledger,historicalReconciliations:[...ledger.historicalReconciliations,reconciliation]};
}

/** Review rows expose one effective cash-flow source and an independent snapshot. */
export async function getHistoricalMonthlySummaryView(ledger) {
  const sources = [...acceptedByMonth(ledger)].sort(([a], [b]) => a.localeCompare(b));
  if (!sources.length) return [];
  const latest = new Map((ledger.historicalReconciliations ?? []).map(entry => [entry.month, entry]));
  const reviewRows = sources.map(([label, source]) => ({label,source,scope:reportScope(ledger, source.record)}));
  const scopes = reviewRows.flatMap(item => item.scope ? [item.scope] : []);
  const reports = scopes.length ? summarizeLedgerPeriods(ledger, scopes) : [];
  let nextReport = 0;
  const contextSha256 = latest.size ? await transactionContext(ledger) : null;
  return reviewRows.map(({label,source,scope}) => {
    const report = scope ? reports[nextReport++] : null, review = latest.get(label);
    const reasons = eligibility(ledger, scope, report);
    if (!review) reasons.push('no-explicit-completeness-review');
    else if (review.batchId !== source.batchId || review.recordIndex !== source.recordIndex ||
      review.contextSha256 !== contextSha256 || !scope || !same(review.scope, scope) ||
      !same(review.reviewedRunIds, coveredRuns(ledger, scope))) reasons.push('reconciliation-evidence-stale');
    const effective = reasons.length === 0;
    return {month:label,...source,source:effective?'transactions':'workbook',reasons,
      report:effective?{income:report.income,spending:report.spending,cash:report.cash,currency:scope.currency}:null,
      netWorthSnapshot:source.record.summary.netWorthSnapshot};
  });
}

function reserve(id, ids) {
  if (!uuid(id) || ids.has(id)) fail('invalid-historical-summary-ledger');
  ids.add(id);
}
export function validateHistoricalLedger(ledger, ids, {allowMissingHistory=false}={}) {
  if (allowMissingHistory && Object.keys(HISTORICAL_COLLECTIONS).every(key => !Object.hasOwn(ledger,key))) return;
  if (ledger.version === 1) {
    if (Object.keys(HISTORICAL_COLLECTIONS).some(key => Object.hasOwn(ledger, key))) fail('invalid-historical-summary-ledger');
    return;
  }
  const {historicalSummaryBatches:batches,historicalReconciliations:reviews} = ledger;
  if (!Array.isArray(batches) || !batches.length || !Array.isArray(reviews)) fail('invalid-historical-summary-ledger');
  const byBatch = new Map();
  for (const batch of batches) {
    if (!exact(batch, ['batchId','version','recordedAt','expectedMonthRange','entries']) ||
      batch.version !== 1 || !stamp(batch.recordedAt) || !validRange(batch.expectedMonthRange) ||
      !list(batch.entries) || !batch.entries.length) fail('invalid-historical-summary-ledger');
    reserve(batch.batchId, ids);
    const byIndex = new Map(), acceptedMonths = new Set();
    let priorIndex = -1;
    for (const entry of batch.entries) {
      if (!exact(entry, ['recordIndex','record','action','reason']) || !Number.isSafeInteger(entry.recordIndex) ||
        entry.recordIndex <= priorIndex || entry.recordIndex >= MAX_RECORDS ||
        !['accept','exclude'].includes(entry.action) || !text(entry.reason) || !validRecordShape(entry.record)) fail('invalid-historical-summary-ledger');
      if (entry.action === 'accept') {
        if (acceptedMonths.has(entry.record.month)) fail('invalid-historical-summary-ledger');
        acceptedMonths.add(entry.record.month);
        byIndex.set(entry.recordIndex, entry.record);
      }
      priorIndex = entry.recordIndex;
    }
    const findings = validateHistoricalMonthlySummaries({expectedMonthRange:batch.expectedMonthRange,
      records:batch.entries.map(entry => entry.record)}).findings;
    if (!acceptedMonths.size || findings.some(f => !['duplicate-month-summary','overlapping-month-summaries','missing-month-summary'].includes(f.code))) fail('invalid-historical-summary-ledger');
    byBatch.set(batch.batchId, byIndex);
  }
  for (const review of reviews) {
    if (!exact(review, ['reconciliationId','version','month','batchId','recordIndex','scope','reviewedRunIds','contextSha256','reason','evidence','recordedAt']) ||
      review.version !== 1 || !text(review.reason) || !text(review.evidence, 2000) || !stamp(review.recordedAt) ||
      typeof review.contextSha256 !== 'string' || !HASH.test(review.contextSha256)) fail('invalid-historical-summary-ledger');
    reserve(review.reconciliationId, ids);
    const record = byBatch.get(review.batchId)?.get(review.recordIndex);
    const scope = record ? reportScope(ledger, record) : null;
    if (!scope || review.month !== record.month || !same(scope, review.scope) ||
      !list(review.reviewedRunIds) || review.reviewedRunIds.length !== scope.accountIds.length ||
      !review.reviewedRunIds.every((id, index) => uuid(id) && ledger.imports.some(run => run.importRunId === id &&
        run.accountId === scope.accountIds[index] && run.declaredCoverage.start <= scope.start &&
        run.declaredCoverage.end >= scope.end))) fail('invalid-historical-summary-ledger');
  }
}
