/* Baseline cash projection read model. Pure functions over the validated ledger;
   nothing here reads storage or the DOM. See docs/PLANNING.md.

   Cash is the combined balance of checking and savings accounts. The projection
   needs every included account reconciled for each of the three most recent
   completed months. Without that, it reports what is missing and projects
   nothing; no assumption can bypass the gate. It starts from the reconciled
   closing balances and adds the three months' average net flow per month.
   Transfers between included accounts are excluded. Rows the user excluded as
   one-offs leave the average, never the records. */
import {getEffectiveActivities} from './canonical-import.mjs';
import {buildAccountMonthCoverage, buildFinancialPosition} from './financial-position.mjs';
import {exactSignedDecimal} from './import-reconciliation.mjs';
import {coverageState, monthEnd} from './account-history.mjs';
import {projectionExclusions} from './planning-contract.mjs';
import {addExact, signOf, subtractExact, shiftMonth} from './home-period-report.mjs';
import {averageOf} from './budget-report.mjs';

export const CASH_ACCOUNT_TYPES = Object.freeze(['checking', 'savings']);
export const QUALIFYING_MONTHS = 3;
export const PROJECTION_MONTHS = 3;
// A row is flagged as a possible one-off when it is at least a quarter of the
// average monthly flow in its direction and its description is not in every month.
export const ONE_OFF_DIVISOR = 4;
const POSTED = new Set(['posted', 'corrected']);
const movementDate = activity => activity.activityKind === 'refund' ? activity.postedDate : activity.postedDate ?? activity.effectiveDate;
const absolute = value => value.startsWith('-') ? value.slice(1) : value;
const times = (value, count) => Array.from({length:count}).reduce(sum => addExact(sum, value), '0');
const descriptionKey = activity => String(activity.normalizedDescription ?? activity.sourceDescription ?? '').trim().toLowerCase();
const previousDay = month => { const d = new Date(`${month}-01T00:00:00.000Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

/** The three most recent completed calendar months before `today`'s month, oldest first. */
export const qualifyingMonths = today => Array.from({length:QUALIFYING_MONTHS}, (_, i) => shiftMonth(today.slice(0, 7), i - QUALIFYING_MONTHS));

export function buildCashProjection({ledger, today}) {
  const months = qualifyingMonths(today);
  const opening = previousDay(months[0]);
  const candidates = ledger.accounts.filter(account => CASH_ACCOUNT_TYPES.includes(account.accountType));
  // An account closed before the window has no balance to project.
  const closed = candidates.length ? new Set(buildFinancialPosition(ledger, {asOf:opening, accountIds:candidates.map(a => a.accountId)})
    .accounts.filter(account => account.status === 'closed').map(account => account.accountId)) : new Set();
  const accounts = candidates.filter(account => !closed.has(account.accountId));
  const base = {months, accounts:accounts.map(account => ({accountId:account.accountId, name:account.displayName}))};
  if (!accounts.length) return {...base, status:'blocked', blocker:'no-cash-accounts', missing:[]};
  const currencies = [...new Set(accounts.map(account => account.currency))];
  if (currencies.length > 1) return {...base, status:'blocked', blocker:'mixed-currency', missing:[]};
  const currency = currencies[0];
  const ids = accounts.map(account => account.accountId);

  const coverage = months.map(month => buildAccountMonthCoverage(ledger, {month, accountIds:ids}));
  const missing = [];
  coverage.forEach((report, index) => {
    for (const item of report.accounts) {
      const state = coverageState(item);
      if (state !== 'reconciled') missing.push({accountId:item.accountId, name:accounts.find(a => a.accountId === item.accountId).displayName,
        month:months[index], state, reasons:[...item.reasons]});
    }
  });
  if (missing.length) return {...base, currency, status:'blocked', blocker:'coverage', missing};

  const last = coverage.at(-1);
  const startBalance = last.accounts.reduce((sum, item) =>
    addExact(sum, ledger.positionEvents.find(event => event.eventId === item.closingBalanceEventId).amountText), '0');

  const included = new Set(ids);
  const effective = getEffectiveActivities(ledger);
  const byId = new Map(effective.map(activity => [activity.activityId, activity]));
  const exclusions = projectionExclusions(ledger);
  const rows = [];
  let internal = 0;
  for (const activity of effective) {
    if (!activity.active || !included.has(activity.accountId) || !POSTED.has(activity.lifecycleStatus)) continue;
    const date = movementDate(activity), month = date?.slice(0, 7);
    if (!months.includes(month)) continue;
    const counterpart = activity.transferCounterpartyActivityId ? byId.get(activity.transferCounterpartyActivityId) : null;
    if (counterpart && included.has(counterpart.accountId)) { internal++; continue; }
    const amount = exactSignedDecimal(activity);
    rows.push({activityId:activity.activityId, accountId:activity.accountId, date, month, amount,
      description:activity.sourceDescription, key:descriptionKey(activity), kind:activity.activityKind,
      excluded:exclusions.has(activity.activityId), reason:exclusions.get(activity.activityId)?.reason ?? null});
  }
  const flows = (filter) => months.map(month => {
    let inflow = '0', outflow = '0';
    for (const row of rows) if (row.month === month && filter(row)) {
      if (signOf(row.amount) > 0) inflow = addExact(inflow, row.amount); else outflow = addExact(outflow, absolute(row.amount));
    }
    return {month, inflow, outflow, net:subtractExact(inflow, outflow)};
  });
  const gross = flows(() => true), counted = flows(row => !row.excluded);
  const average = {inflow:averageOf(counted.map(m => m.inflow), QUALIFYING_MONTHS), outflow:averageOf(counted.map(m => m.outflow), QUALIFYING_MONTHS)};
  average.net = subtractExact(average.inflow, average.outflow);
  const grossAverage = {inflow:averageOf(gross.map(m => m.inflow), QUALIFYING_MONTHS), outflow:averageOf(gross.map(m => m.outflow), QUALIFYING_MONTHS)};

  const projection = [];
  let balance = startBalance;
  for (let i = 0; i < PROJECTION_MONTHS; i++) {
    balance = addExact(balance, average.net);
    const month = shiftMonth(today.slice(0, 7), i);
    projection.push({month, date:monthEnd(month), balance});
  }

  // Possible one-offs: large against the usual monthly flow and not repeated every month.
  const everyMonth = new Set([...new Set(rows.map(row => row.key))].filter(key => key && months.every(month => rows.some(row => row.key === key && row.month === month))));
  const large = row => {
    const usual = signOf(row.amount) > 0 ? grossAverage.inflow : grossAverage.outflow;
    return signOf(usual) > 0 && signOf(subtractExact(times(absolute(row.amount), ONE_OFF_DIVISOR), usual)) >= 0;
  };
  const view = row => ({activityId:row.activityId, accountId:row.accountId, date:row.date, amount:row.amount, description:row.description, reason:row.reason});
  const suggested = rows.filter(row => !row.excluded && large(row) && !everyMonth.has(row.key))
    .sort((a, b) => signOf(subtractExact(absolute(b.amount), absolute(a.amount))) || a.date.localeCompare(b.date)).slice(0, 10).map(view);
  const excluded = rows.filter(row => row.excluded).sort((a, b) => a.date.localeCompare(b.date)).map(view);
  const outside = [...exclusions.keys()].filter(id => !rows.some(row => row.activityId === id)).length;

  return {...base, currency, status:'ready', startDate:monthEnd(months.at(-1)), startBalance,
    perMonth:counted, average, projection, excluded, suggested, internalTransfers:internal, exclusionsOutsideWindow:outside,
    change:subtractExact(projection.at(-1).balance, startBalance), falling:signOf(average.net) < 0,
    lowest:projection.reduce((low, point) => signOf(subtractExact(point.balance, low.balance)) < 0 ? point : low, projection[0]),
    negative:projection.find(point => signOf(point.balance) < 0) ?? null};
}
