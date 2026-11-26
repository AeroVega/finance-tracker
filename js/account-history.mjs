/* Per-account history for the Accounts page: dated balance observations and
   twelve months of coverage ending at the balances' as-of date.

   This module only reads the validated ledger through the existing financial
   position rules. It never carries a balance forward, interpolates between
   observations or turns missing coverage into a value. */
import {buildAccountMonthCoverage} from './financial-position.mjs';
import {selectBalance} from './financial-position-contract.mjs';
import {isCalendarDate} from './import-reconciliation.mjs';
import {fail} from './app-error.mjs';

export const COVERAGE_MONTH_COUNT = 12;
const PROCEDURAL = new Set(['reconciliation-required', 'missing-declared-coverage']);

const pad = value => String(value).padStart(2, '0');
export function monthEnd(month) {
  const [year, index] = month.split('-').map(Number);
  return `${month}-${pad(new Date(Date.UTC(year, index, 0)).getUTCDate())}`;
}
/** The calendar months, oldest first, ending with the month that contains asOf. */
export function coverageMonths(asOf, count = COVERAGE_MONTH_COUNT) {
  if (!isCalendarDate(asOf)) fail('invalid-position-as-of');
  const [year, month] = asOf.split('-').map(Number);
  return Array.from({length:count}, (_, i) => {
    const date = new Date(Date.UTC(year, month - count + i, 1));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  });
}
/**
 * One display state per account-month, derived only from the calculated coverage
 * result. Reconciled means the coverage checks passed; a blocking reason (anything
 * other than "not yet reconciled" or "not declared") needs a fix; otherwise imported
 * rows, a declared window, or nothing at all.
 */
export function coverageState(item) {
  if (item.complete) return 'reconciled';
  if (item.reasons.some(reason => !PROCEDURAL.has(reason))) return 'needs-fix';
  if (item.observed) return 'imported';
  if (item.declared) return 'declared';
  return 'none';
}
/** Coverage cells for every account, keyed by account ID, oldest month first. */
export function buildCoverageHistory(ledger, {asOf, count = COVERAGE_MONTH_COUNT} = {}) {
  const months = coverageMonths(asOf, count);
  const byAccount = new Map(ledger.accounts.map(account => [account.accountId, []]));
  for (const month of months) {
    const report = buildAccountMonthCoverage(ledger, {month});
    const partial = asOf < monthEnd(month);
    for (const item of report.accounts) {
      byAccount.get(item.accountId).push({month, state:coverageState(item), partial, reasons:[...item.reasons],
        declared:item.declared, observed:item.observed, discrepancy:item.discrepancy,
        openingBalanceEventId:item.openingBalanceEventId, closingBalanceEventId:item.closingBalanceEventId});
    }
  }
  return {asOf, months, byAccount};
}
/**
 * The month to open first: the latest month that needs a fix, otherwise the latest
 * unreconciled month since the account's first coverage evidence, otherwise the
 * as-of month.
 */
export function mostUrgentMonth(cells) {
  const fix = cells.findLast(cell => cell.state === 'needs-fix');
  if (fix) return fix.month;
  const first = cells.findIndex(cell => cell.state !== 'none');
  const gap = first < 0 ? undefined : cells.slice(first).findLast(cell => cell.state !== 'reconciled');
  return (gap ?? cells.at(-1))?.month ?? null;
}
/**
 * Dated balance observations in [from, to], one per effective date. A date with
 * differing unresolved amounts is a conflict with no value. The selected record
 * follows the same rule as the position report for that date.
 */
export function balanceObservations(ledger, accountId, {from, to}) {
  const events = ledger.positionEvents ?? [];
  const dates = [...new Set(events.filter(event => event.eventType === 'balance-snapshot' && event.accountId === accountId
    && event.effectiveDate >= from && event.effectiveDate <= to).map(event => event.effectiveDate))].sort();
  return dates.map(date => {
    const {selected, candidates, conflict} = selectBalance(events, accountId, date);
    return {date, amountText:conflict ? null : selected.amountText, conflict, basis:conflict ? null : selected.basis,
      reference:conflict ? null : selected.source?.reference ?? null, candidateCount:candidates.length,
      eventIds:candidates.map(event => event.eventId)};
  });
}
/** Latest declared import coverage and run count per institution. */
export function institutionCoverage(ledger) {
  const result = new Map();
  for (const run of ledger.imports) {
    const entry = result.get(run.institutionId) ?? {through:null, runs:0};
    entry.runs++;
    if (!entry.through || run.declaredCoverage.end > entry.through) entry.through = run.declaredCoverage.end;
    result.set(run.institutionId, entry);
  }
  return result;
}
/** Horizontal position (0–1) of a date on the strip, aligned to its month's column. */
export function stripPosition(months, date) {
  const index = months.indexOf(date.slice(0, 7));
  if (index < 0) return null;
  const days = Number(monthEnd(months[index]).slice(8));
  return (index + (Number(date.slice(8)) - 0.5) / days) / months.length;
}
