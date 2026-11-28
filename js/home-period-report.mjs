/* Home's period read model: one source per month, summed into a month, a calendar
   year or lifetime. Pure functions over the canonical reader and the reviewed
   historical summaries; nothing here reads storage or the DOM.

   Each month has exactly one source. A historical month uses reconciled
   transaction detail when its review holds, otherwise the workbook or manual
   summary. A month with no historical summary uses known transaction subtotals,
   labelled partial. Gaps stay null and are never drawn or summed as zero, and
   currencies are never combined. */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
export const isMonthPeriod = value => typeof value === 'string' && MONTH.test(value);
export const isYearPeriod = value => typeof value === 'string' && YEAR.test(value);
/** '' is lifetime, 'YYYY' a calendar year, 'YYYY-MM' a calendar month. */
export const periodKind = period => period === '' ? 'lifetime' : isYearPeriod(period) ? 'year' : 'month';

export const SOURCES = Object.freeze({
  reconciled:'Reconciled transaction detail',
  workbook:'Workbook-reported summary',
  manual:'Manually recorded summary',
  partial:'Known transactions · possibly incomplete',
  none:'No eligible transaction data',
  incomparable:'Different currency or coverage'
});
// Short, honest labels for each month's evidence. The full source stays in the
// accessible name and the readout.
const SOURCE_TAGS = {[SOURCES.reconciled]:'Reconciled', [SOURCES.workbook]:'Reported', [SOURCES.manual]:'Manual',
  [SOURCES.partial]:'Partial', [SOURCES.none]:'No data', [SOURCES.incomparable]:'Not comparable'};
export const sourceTag = source => SOURCE_TAGS[source] ?? 'Unknown';
/** Merge keys for the two kinds of spending that have no category. */
export const NO_CATEGORY = '\u0000none';
export const NOT_BROKEN_DOWN = '\u0000unsplit';

// Exact decimal arithmetic. Amounts never pass through binary floating point.
function scaled(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  return {n:BigInt(match[1] + match[2] + (match[3] ?? '')), s:(match[3] ?? '').length};
}
export function addExact(a, b) {
  const x = scaled(a), y = scaled(b), s = Math.max(x.s, y.s);
  const n = x.n * 10n ** BigInt(s - x.s) + y.n * 10n ** BigInt(s - y.s);
  const digits = (n < 0n ? -n : n).toString().padStart(s + 1, '0');
  return (n < 0n ? '-' : '') + (s ? digits.slice(0, -s) + '.' + digits.slice(-s) : digits);
}
export const negateExact = value => value.startsWith('-') ? value.slice(1) : value === '0' ? value : '-' + value;
export const subtractExact = (a, b) => addExact(a, negateExact(b));
export const signOf = value => { const {n} = scaled(value); return n < 0n ? -1 : n > 0n ? 1 : 0; };
const sumNullable = (total, value) => value === null || value === undefined ? total : total === null ? value : addExact(total, value);
/** Share of a positive whole in tenths of a percent, for display only. */
export function shareOf(part, whole) {
  const p = scaled(part), w = scaled(whole), s = Math.max(p.s, w.s);
  const pn = p.n * 10n ** BigInt(s - p.s), wn = w.n * 10n ** BigInt(s - w.s);
  return wn > 0n && pn > 0n ? Number(pn * 1000n / wn) / 10 : 0;
}

const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = index => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
export function monthRange(first, last) {
  if (!isMonthPeriod(first) || !isMonthPeriod(last) || first > last) return [];
  return Array.from({length:monthIndex(last) - monthIndex(first) + 1}, (_, i) => monthAt(monthIndex(first) + i));
}
export const shiftMonth = (month, by) => monthAt(monthIndex(month) + by);
/** The local calendar month, so a late-evening open is never the next UTC month. */
export function currentMonth(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function historyScope(row) {
  const {scope, provenance = {}} = row.record;
  // Unknown scope establishes no comparability across months. Aggregate rows
  // are comparable only within the same source and mapping.
  if (scope?.kind === 'accounts') return JSON.stringify(['accounts', [...scope.accountIds].sort()]);
  if (row.source === 'manual') return JSON.stringify(['manual', row.month]);
  if (scope?.kind === 'aggregate') return JSON.stringify(['aggregate', provenance.sourceId ?? null,
    provenance.workbook, provenance.worksheet, provenance.mapping]);
  return JSON.stringify(['unknown', row.month]);
}
function historyCurrency(row) {
  const {incomeTotal, expenseTotal} = row.record.summary;
  return incomeTotal.currency === expenseTotal.currency ? incomeTotal.currency : null;
}

/** Resolve which evidence applies to this account scope. Months are filled later. */
export function evidenceBasis({history, view}) {
  const {accountId} = view.scope;
  const selected = view.accounts.find(account => account.accountId === accountId);
  const belongs = row => !accountId || (row.record.scope?.kind === 'accounts' &&
    row.record.scope.accountIds.length === 1 && row.record.scope.accountIds[0] === accountId);
  const matching = history.filter(belongs);
  const anchor = matching.at(-1);
  const accountName = selected?.displayName ?? 'All accounts';
  if (anchor) {
    const currency = historyCurrency(anchor);
    if (!currency) return {currency:null, context:'The latest historical summary uses different currencies for income and expenses. A comparison is unavailable.'};
    const scope = anchor.record.scope;
    const names = scope?.kind === 'accounts'
      ? scope.accountIds.map(id => view.accounts.find(account => account.accountId === id)?.displayName ?? 'Unmatched account').join(', ')
      : scope?.kind === 'aggregate' ? 'Workbook history and imported activity' : 'Workbook scope unknown';
    return {currency, accountId, history:new Map(matching.map(row => [row.month, row])), anchorScope:historyScope(anchor),
      firstMonth:matching[0].month, context:`${currency} · ${names}. One source per month. Months after the history use imported activity, labelled partial.`};
  }
  const currencies = [...new Set((selected ? [selected] : view.accounts).map(account => account.currency))];
  if (currencies.length > 1) return {currency:null, context:'Choose one account to compare months. Different currencies are not combined.'};
  if (!currencies[0]) return {currency:null, context:'No dated monthly evidence for this account selection. Missing values are not zero.'};
  return {currency:currencies[0], accountId, history:new Map(), anchorScope:null, firstMonth:null,
    context:`${currencies[0]} · ${accountName}. Known transactions only, possibly partial. A gap means no data, not zero.`};
}

function transactionCategories(reader, month, basis, spending) {
  const items = reader.spendingByCategory({month, currency:basis.currency, accountId:basis.accountId})
    .map(item => item.categoryId ? {key:reader.catalog.label(item.categoryId).toLowerCase(), label:reader.catalog.label(item.categoryId), categoryId:item.categoryId, spending:item.spending, count:item.count}
      : {key:NO_CATEGORY, label:'No category', categoryId:'', spending:item.spending, count:item.count});
  // A reconciled history scope can differ from this account scope. Unless the
  // categories account for exactly the month's spending, show it unsplit.
  const total = items.reduce((sum, item) => addExact(sum, item.spending), '0');
  return signOf(subtractExact(total, spending)) === 0 ? items
    : signOf(spending) ? [{key:NOT_BROKEN_DOWN, label:'Not broken down', spending, count:null}] : [];
}
function workbookCategories(record, currency) {
  const spending = record.summary.expenseTotal.amount;
  const items = (record.breakdowns?.expenseCategories?.items ?? [])
    .filter(item => item?.amount?.currency === currency && typeof item.label === 'string' && item.label.trim() && signOf(item.amount.amount))
    .map(item => ({key:item.label.trim().toLowerCase(), label:item.label.trim(), spending:item.amount.amount, count:null}));
  const rest = subtractExact(spending, items.reduce((sum, item) => addExact(sum, item.spending), '0'));
  if (signOf(rest) < 0) return signOf(spending) ? [{key:NOT_BROKEN_DOWN, label:'Not broken down', spending, count:null}] : [];
  return signOf(rest) ? [...items, {key:NOT_BROKEN_DOWN, label:'Not broken down', spending:rest, count:null}] : items;
}

/** One row per month: its single source, totals and spending categories. */
export function resolveMonth({basis, reader}, month) {
  const gap = source => ({month, source, income:null, spending:null, cash:null, categories:[]});
  if (!basis.currency) return gap(SOURCES.none);
  const row = basis.history.get(month);
  if (row) {
    if (historyCurrency(row) !== basis.currency || historyScope(row) !== basis.anchorScope) return gap(SOURCES.incomparable);
    if (row.source === 'transactions' && row.report?.currency === basis.currency) {
      const {income, spending, cash} = row.report;
      return {month, source:SOURCES.reconciled, income, spending, cash:cash ?? null, categories:transactionCategories(reader, month, basis, spending)};
    }
    const {incomeTotal, expenseTotal} = row.record.summary;
    return {month, source:row.source === 'manual' ? SOURCES.manual : SOURCES.workbook,
      income:incomeTotal.amount, spending:expenseTotal.amount, cash:null, categories:workbookCategories(row.record, basis.currency)};
  }
  const values = reader.monthlyReport({month, currency:basis.currency, accountId:basis.accountId});
  if (values.income === null && values.spending === null) return gap(SOURCES.none);
  return {month, source:SOURCES.partial, income:values.income, spending:values.spending, cash:values.cash ?? null,
    categories:values.spending === null ? [] : transactionCategories(reader, month, basis, values.spending)};
}
export const hasData = row => row.income !== null || row.spending !== null;

/** Sum resolved months. Categories merge by name, so workbook and app labels that match combine. */
export function summarizeRows(rows) {
  const data = rows.filter(hasData);
  let income = null, spending = null, cash = null;
  const sources = new Map(), categories = new Map();
  for (const row of data) {
    income = sumNullable(income, row.income); spending = sumNullable(spending, row.spending); cash = sumNullable(cash, row.cash);
    sources.set(sourceTag(row.source), (sources.get(sourceTag(row.source)) ?? 0) + 1);
    const transactions = row.source === SOURCES.reconciled || row.source === SOURCES.partial;
    for (const item of row.categories) {
      const total = categories.get(item.key) ?? {key:item.key, label:item.label, categoryId:null, spending:'0', count:0, workbookMonths:0};
      total.spending = addExact(total.spending, item.spending);
      if (item.count !== null) total.count += item.count;
      if (!transactions) total.workbookMonths++;
      // Prefer the app's category so Activity can filter on it.
      if (item.categoryId !== undefined && total.categoryId === null) { total.categoryId = item.categoryId; total.label = item.label; }
      categories.set(item.key, total);
    }
  }
  return {months:rows.length, dataMonths:data.length, cashMonths:data.filter(row => row.cash !== null).length,
    income, spending, cash, sources:[...sources].map(([tag, count]) => ({tag, count})),
    categories:[...categories.values()].filter(item => signOf(item.spending))
      .sort((a, b) => signOf(subtractExact(b.spending, a.spending)) || a.label.localeCompare(b.label, 'en'))};
}

/** The months a period covers, clipped to the months that can hold evidence. */
export function periodMonths(period, bounds) {
  const kind = periodKind(period);
  if (kind === 'month') return [period];
  if (kind === 'year') {
    const last = `${period}-12` < bounds.last ? `${period}-12` : bounds.last;
    return monthRange(`${period}-01`, last);
  }
  return monthRange(bounds.first, bounds.last);
}

/** Month and year choices run from the first evidence to the later of today and the last evidence. */
export function periodBounds({basis, view, today}) {
  const known = [...view.months, basis.firstMonth, ...(basis.history?.keys() ?? [])].filter(isMonthPeriod).sort();
  const first = known[0] ?? today, lastKnown = known.at(-1) ?? today;
  return {first:first < today ? first : today, last:lastKnown > today ? lastKnown : today};
}
export function stepPeriod(period, direction, bounds) {
  const kind = periodKind(period);
  if (kind === 'lifetime') return null;
  const next = kind === 'month' ? shiftMonth(period, direction) : String(Number(period) + direction).padStart(4, '0');
  const lo = kind === 'month' ? bounds.first : bounds.first.slice(0, 4), hi = kind === 'month' ? bounds.last : bounds.last.slice(0, 4);
  return next < lo || next > hi ? null : next;
}

/** The comparison period: the previous month, or the same data months a year earlier. */
function comparisonMonths(period, rows) {
  const kind = periodKind(period);
  if (kind === 'month') return {months:[shiftMonth(period, -1)], kind};
  if (kind === 'year') return {months:rows.filter(hasData).map(row => shiftMonth(row.month, -12)), kind};
  return null;
}

/** Resolve a period for Home: figures, categories, a comparison and the trend. */
export function buildPeriodReport({history, view, reader, period, today}) {
  const basis = evidenceBasis({history, view});
  const bounds = periodBounds({basis, view, today});
  const memo = new Map();
  const month = value => { if (!memo.has(value)) memo.set(value, resolveMonth({basis, reader}, value)); return memo.get(value); };
  const rows = periodMonths(period, bounds).map(month);
  const summary = summarizeRows(rows);
  let comparison = null;
  const compare = comparisonMonths(period, rows);
  if (compare && summary.dataMonths) {
    const previous = compare.months.map(month);
    const label = compare.kind === 'month' ? compare.months[0] : `${compare.months[0]}..${compare.months.at(-1)}`;
    // A comparison needs data in every matching month; a gap makes it unavailable, not smaller.
    comparison = previous.every(hasData) ? {label, months:compare.months, available:true, summary:summarizeRows(previous)}
      : {label, months:compare.months, available:false, summary:null};
  }
  // Colours follow the category, never its rank in one period: the six largest
  // lifetime categories keep the same slot in every period.
  const lifetime = summarizeRows(monthRange(bounds.first, bounds.last).map(month));
  const slots = new Map(lifetime.categories.filter(item => !item.key.startsWith('\u0000') && signOf(item.spending) > 0)
    .slice(0, 6).map((item, i) => [item.key, i + 1]));
  const kind = periodKind(period);
  let trend;
  if (kind === 'lifetime') {
    const years = [...new Set(monthRange(bounds.first, bounds.last).map(value => value.slice(0, 4)))];
    trend = {unit:'year', columns:years.map(year => {
      const months = periodMonths(year, bounds);
      const totals = summarizeRows(months.map(month));
      return {key:year, income:totals.income, spending:totals.spending, dataMonths:totals.dataMonths, months:months.length, sources:totals.sources};
    })};
  } else {
    const months = kind === 'year' ? periodMonths(period, bounds) : monthRange(shiftMonth(period, -5), period);
    trend = {unit:'month', columns:months.map(value => {
      const row = month(value);
      return {key:value, income:row.income, spending:row.spending, source:row.source};
    })};
  }
  // The latest earlier month with data, offered when the chosen month is empty.
  let latestWithData = null;
  if (kind === 'month' && !summary.dataMonths) {
    for (let value = shiftMonth(period, -1); value >= bounds.first; value = shiftMonth(value, -1)) {
      if (hasData(month(value))) { latestWithData = value; break; }
    }
  }
  return {period, kind, currency:basis.currency, context:basis.context, bounds, rows, summary, comparison, slots, trend, latestWithData};
}
