/* Budget read model for one calendar month. Pure functions over the validated
   ledger, the workspace reader and the reviewed historical summaries; nothing
   here reads storage or the DOM. See docs/PLANNING.md.

   Actual spending per category is Home's figure for the same month (one source
   per month, categories merged by name), so Planning and Home never disagree.
   A target compares against that figure. Spending without a target is shown in
   one "Not budgeted" row; nothing is hidden. Overspend never carries over. */
import {getEffectiveActivities, reportActivityContribution} from './canonical-import.mjs';
import {categoryCatalog} from './category-catalog.mjs';
import {budgetTargetsFor} from './planning-contract.mjs';
import {SOURCES, NO_CATEGORY, NOT_BROKEN_DOWN, addExact, subtractExact, signOf, evidenceBasis, resolveMonth, hasData, shiftMonth, sourceTag} from './home-period-report.mjs';

export const SPENDING_ACCOUNT_TYPES = Object.freeze(['checking', 'savings', 'credit-card']);
export const SUGGESTION_MONTHS = 3;
export const PACE_FIRST_DAY = 8;
// Reasons that mean recorded spending may be miscounted, not just unreconciled.
const GAP_REASONS = new Set(['unresolved-source-observation', 'unknown-source-date', 'unknown-activity-amount', 'unresolved-activity-lifecycle']);
const pad = value => String(value).padStart(2, '0');
export const daysIn = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const monthEnd = month => `${month}-${pad(daysIn(month))}`;
const dayAfter = date => { const d = new Date(date + 'T00:00:00.000Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export const categoryKey = (categoryId, catalog) => categoryId ? catalog.label(categoryId).toLowerCase() : NO_CATEGORY;

// value * numerator / denominator, rounded half away from zero to `places`.
function scale(value, numerator, denominator, places = 2) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  const s = (m[3] ?? '').length, n = BigInt(m[1] + m[2] + (m[3] ?? ''));
  const top = n * BigInt(numerator) * 10n ** BigInt(places), bottom = BigInt(denominator) * 10n ** BigInt(s);
  const negative = (top < 0n) !== (bottom < 0n), a = top < 0n ? -top : top, b = bottom < 0n ? -bottom : bottom;
  const q = (a * 2n + b) / (b * 2n), digits = q.toString().padStart(places + 1, '0');
  const text = places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits;
  return negative && q ? '-' + text : text;
}
export const averageOf = (values, count) => scale(values.reduce((sum, value) => addExact(sum, value), '0'), 1, count);
/** A suggested target: the average rounded to a whole unit, never below 1. */
export const roundTarget = value => { const whole = scale(value, 1, 1, 0); return signOf(subtractExact(whole, '1')) < 0 ? '1' : whole; };

/**
 * The last day of `month` that every spending account's declared imports reach
 * without a hole, capped at today. Null when an account has no coverage from the
 * first of the month. An account with no imports at all is a gap: its spending
 * may be missing, and missing is not zero.
 */
export function monthCoverage(ledger, month, {today, coverageReport}) {
  const start = `${month}-01`, cap = today.slice(0, 7) === month ? today : monthEnd(month);
  const accounts = ledger.accounts.filter(account => SPENDING_ACCOUNT_TYPES.includes(account.accountType));
  const issues = [];
  let through = cap;
  for (const account of accounts) {
    let next = start, reached = null;
    const runs = ledger.imports.filter(run => run.accountId === account.accountId).map(run => run.declaredCoverage)
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const run of runs) {
      if (run.end < next) continue;
      if (run.start > next) break;
      reached = run.end >= cap ? cap : run.end;
      if (run.end >= cap) break;
      next = dayAfter(run.end);
    }
    const item = coverageReport?.accounts.find(entry => entry.accountId === account.accountId);
    const miscounted = item?.reasons.some(reason => GAP_REASONS.has(reason)) ?? false;
    if (!reached) issues.push({accountId:account.accountId, name:account.displayName, kind:'no-coverage'});
    else if (reached < cap) issues.push({accountId:account.accountId, name:account.displayName, kind:'partial', through:reached});
    if (miscounted) issues.push({accountId:account.accountId, name:account.displayName, kind:'needs-review'});
    if (!reached) through = null;
    else if (through && reached < through) through = reached;
  }
  if (!accounts.length) return {through:null, complete:false, issues:[{kind:'no-accounts'}]};
  return {through, complete:issues.length === 0 && through === cap, issues};
}

/** Per-day spending by category key for imported activity, by the same rule as the period report. */
export function dailySpending(ledger, currency) {
  const accounts = new Map(ledger.accounts.map(account => [account.accountId, account]));
  const effective = getEffectiveActivities(ledger).filter(activity => activity.active);
  const catalog = categoryCatalog(ledger);
  const categories = new Map(effective.map(activity => [activity.activityId, activity.categoryId ?? null]));
  const byMonth = new Map();
  for (const activity of effective) {
    if (!['spending', 'refund'].includes(activity.activityKind)) continue;
    const date = activity.activityKind === 'refund' ? activity.postedDate : activity.effectiveDate;
    if (!date) continue;
    const contribution = reportActivityContribution(activity, accounts.get(activity.accountId), currency);
    if (contribution.reason) continue;
    const categoryId = catalog.reported(activity.categoryId ?? (activity.originalActivityId ? categories.get(activity.originalActivityId) : null));
    const month = date.slice(0, 7), key = categoryKey(categoryId, catalog), day = Number(date.slice(8));
    const days = byMonth.get(month) ?? new Map(); byMonth.set(month, days);
    const list = days.get(key) ?? []; days.set(key, list);
    list.push({day, spending:contribution.spending});
  }
  return byMonth;
}
const spentAfter = (entries, day) => entries.filter(entry => entry.day > day).reduce((sum, entry) => addExact(sum, entry.spending), '0');

/**
 * Month-end estimate for one category in the current month. History-shaped when
 * the three previous months have imported transaction detail with no coverage gap:
 * spending so far plus the average spending after the same day in those months.
 * Otherwise this month's pace, from day 8 only. Withheld when this month has a gap.
 */
function estimateFor({key, spent, day, month, coverage, history}) {
  if (!coverage.complete) return {amount:null, method:null, note:'No estimate: this month has a coverage gap.'};
  if (history.ok) {
    const after = history.months.map(({month:past, days}) => spentAfter(days.get(key) ?? [], Math.min(day, daysIn(past))));
    return {amount:addExact(spent, averageOf(after, after.length)), method:'history',
      note:`Spending so far plus your usual spending after day ${day}, from the last ${history.months.length} months.`};
  }
  if (day < PACE_FIRST_DAY) return {amount:null, method:null, note:`No estimate before day ${PACE_FIRST_DAY} without three months of detail.`};
  return {amount:scale(spent, daysIn(month), day), method:'pace', note:'Based on this month’s pace.'};
}

/** The three previous months, usable for the history-shaped estimate only if all qualify. */
function estimateHistory({ledger, basis, reader, month, today, daily}) {
  const months = [1, 2, 3].map(back => shiftMonth(month, -back));
  const ok = months.every(past => {
    const row = resolveMonth({basis, reader}, past);
    if (![SOURCES.partial, SOURCES.reconciled].includes(row.source)) return false;
    return monthCoverage(ledger, past, {today, coverageReport:reader.coverage({month:past})}).complete;
  });
  return {ok, months:ok ? months.map(past => ({month:past, days:daily.get(past) ?? new Map()})) : []};
}

/** Suggested targets: average monthly spending over the latest completed months with data. */
export function suggestTargets({basis, reader, month, limit = 12}) {
  const used = [];
  for (let back = 1; back <= limit && used.length < SUGGESTION_MONTHS; back++) {
    const row = resolveMonth({basis, reader}, shiftMonth(month, -back));
    if (hasData(row) && row.spending !== null) used.push(row);
  }
  const totals = new Map();
  for (const row of used) for (const item of row.categories) {
    if (item.key === NO_CATEGORY || item.key === NOT_BROKEN_DOWN) continue;
    const total = totals.get(item.key) ?? {key:item.key, label:item.label, categoryId:item.categoryId ?? null, spending:'0'};
    total.spending = addExact(total.spending, item.spending);
    if (item.categoryId && !total.categoryId) { total.categoryId = item.categoryId; total.label = item.label; }
    totals.set(item.key, total);
  }
  const suggestions = [...totals.values()].filter(item => signOf(item.spending) > 0).map(item => {
    const average = averageOf([item.spending], used.length);
    return {key:item.key, label:item.label, categoryId:item.categoryId, average, amount:roundTarget(average), months:used.length};
  }).sort((a, b) => signOf(subtractExact(b.average, a.average)) || a.label.localeCompare(b.label, 'en'));
  return {months:used.map(row => row.month), suggestions};
}

/**
 * Budgets for one month across all accounts. `today` is the local calendar date.
 * Home's card passes `detail:false` to skip coverage, estimates and suggestions.
 */
export function buildBudgetReport({ledger, history, view, reader, month, today, detail = true}) {
  const basis = evidenceBasis({history, view:{scope:{accountId:''}, accounts:view.accounts}});
  const currentMonth = today.slice(0, 7);
  const timing = month === currentMonth ? 'current' : month < currentMonth ? 'past' : 'future';
  if (!basis.currency) return {month, timing, currency:null, available:false, context:basis.context, rows:[], targets:[]};
  const currency = basis.currency;
  const targets = budgetTargetsFor(ledger, month).filter(target => target.currency === currency);
  const row = timing === 'future' ? null : resolveMonth({basis, reader}, month);
  const data = row !== null && hasData(row) && row.spending !== null;
  const spentBy = new Map();
  if (data) for (const item of row.categories) spentBy.set(item.key, addExact(spentBy.get(item.key) ?? '0', item.spending));
  // Workbook and manual months report their own totals; import coverage does not apply to them.
  const summary = row !== null && [SOURCES.workbook, SOURCES.manual].includes(row.source);
  const coverage = !detail || timing === 'future' || summary ? null : monthCoverage(ledger, month, {today, coverageReport:reader.coverage({month})});
  const day = coverage?.through ? Number(coverage.through.slice(8)) : null;
  let shape = null;
  if (timing === 'current' && targets.length && coverage?.complete) {
    shape = estimateHistory({ledger, basis, reader, month, today, daily:dailySpending(ledger, currency)});
  }
  const keys = new Set(), catalog = categoryCatalog(ledger);
  const rows = targets.map(target => {
    const key = categoryKey(target.categoryId, catalog); keys.add(key);
    const actual = data ? spentBy.get(key) ?? '0' : null;
    const remaining = actual === null ? null : subtractExact(target.amountText, actual);
    const estimate = timing === 'current' && actual !== null && coverage
      ? estimateFor({key, spent:actual, day, month, coverage, history:shape ?? {ok:false}}) : null;
    return {categoryId:target.categoryId, key, label:catalog.label(target.categoryId), target:target.amountText,
      effectiveMonth:target.effectiveMonth, actual, remaining, over:remaining !== null && signOf(remaining) < 0, estimate};
  }).sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const unbudgeted = data ? row.categories.filter(item => !keys.has(item.key) && signOf(item.spending)) : [];
  const notBudgeted = data ? unbudgeted.reduce((sum, item) => addExact(sum, item.spending), '0') : null;
  const targetTotal = rows.reduce((sum, item) => addExact(sum, item.target), '0');
  const budgetedSpending = data ? rows.reduce((sum, item) => addExact(sum, item.actual), '0') : null;
  return {month, timing, currency, available:true, context:basis.context, source:row?.source ?? null, sourceTag:row ? sourceTag(row.source) : null,
    hasData:data, coverage, rows, targets,
    notBudgeted:{spending:notBudgeted, categories:unbudgeted.map(item => ({key:item.key, label:item.label, categoryId:item.categoryId ?? null, spending:item.spending}))
      .sort((a, b) => signOf(subtractExact(b.spending, a.spending)) || a.label.localeCompare(b.label, 'en'))},
    total:{target:rows.length ? targetTotal : null, budgetedSpending, spending:data ? row.spending : null,
      remaining:rows.length && budgetedSpending !== null ? subtractExact(targetTotal, budgetedSpending) : null},
    overCount:rows.filter(item => item.over).length,
    suggestions:!detail || timing === 'past' ? null : suggestTargets({basis, reader, month})};
}
