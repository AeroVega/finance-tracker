import {getHistoricalMonthlySummaryView} from './historical-monthly-summary.mjs';

const windowSize = 6;
const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const gap = (month, source) => ({month, source, income:null, spending:null});

function recentMonths(latest) {
  if (!validMonth(latest)) return [];
  const [year, month] = latest.split('-').map(Number);
  const end = year * 12 + month - 1;
  return Array.from({length:windowSize}, (_, i) => end - windowSize + i + 1)
    .filter(index => index >= 12)
    .map(index => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`);
}

function historyScope(row) {
  const {scope,provenance = {}} = row.record;
  // Unknown scope establishes no comparability across months. Aggregate rows
  // are comparable here only within the same source and mapping.
  if (scope?.kind === 'accounts') return JSON.stringify(['accounts', [...scope.accountIds].sort()]);
  if (row.source === 'manual') return JSON.stringify(['manual', row.month]);
  if (scope?.kind === 'aggregate') return JSON.stringify(['aggregate', provenance.sourceId ?? null,
    provenance.workbook, provenance.worksheet, provenance.mapping]);
  return JSON.stringify(['unknown', row.month]);
}

function monthlyCurrency(row) {
  const {incomeTotal,expenseTotal} = row.record.summary;
  return incomeTotal.currency === expenseTotal.currency ? incomeTotal.currency : null;
}

export function homeMonthlyTrend(history, view, reader) {
  const {accountId} = view.scope;
  const selected = view.accounts.find(a => a.accountId === accountId);
  const belongs = row => !accountId || (row.record.scope?.kind === 'accounts' &&
    row.record.scope.accountIds.length === 1 && row.record.scope.accountIds[0] === accountId);
  const matchingHistory = history.filter(belongs);
  const anchor = matchingHistory.at(-1);
  if (anchor) {
    const currency = monthlyCurrency(anchor);
    if (!currency) return {currency:null, context:'The latest historical summary uses different currencies for income and expenses. A comparison is unavailable.', rows:[]};
    const scope = anchor.record.scope;
    const names = scope?.kind === 'accounts'
      ? scope.accountIds.map(id => view.accounts.find(account => account.accountId === id)?.displayName ?? 'Unmatched account').join(', ')
      : scope?.kind === 'aggregate' ? 'Same aggregate workbook source' : 'Workbook scope unknown; only the latest month is shown';
    const rows = new Map(matchingHistory.map(row => [row.month, row]));
    const matchScope = historyScope(anchor);
    return {currency, context:`${currency} · ${names}. One source per month; gaps are not filled with transactions or estimates.`,
      rows:recentMonths(anchor.month).map(month => {
        const row = rows.get(month);
        if (!row) return gap(month, 'No comparable historical summary');
        if (monthlyCurrency(row) !== currency || historyScope(row) !== matchScope) return gap(month, 'Different currency or coverage');
        if (row.source === 'transactions' && row.report?.currency === currency) {
          return {month, source:'Reconciled transaction detail', income:row.report.income, spending:row.report.spending};
        }
        return {month, source:row.source === 'manual' ? 'Manually recorded summary' : 'Workbook-reported summary',
          income:row.record.summary.incomeTotal.amount, spending:row.record.summary.expenseTotal.amount};
      })};
  }
  const currencies = [...new Set((selected ? [selected] : view.accounts).map(a => a.currency))];
  if (currencies.length > 1) return {currency:null, context:'Choose one account in Filters to compare monthly values. Different currencies are not combined.', rows:[]};
  const [currency] = currencies;
  const months = recentMonths(view.months[0]);
  if (!currency || !months.length) return {currency:null, context:'No dated monthly evidence for this account selection. Missing values are not zero.', rows:[]};
  return {currency, context:`${currency} · ${selected?.displayName ?? "All accounts"}. Known transactions only, possibly partial; an empty month means no data, not zero.`,
    rows:months.map(month => {
      const values = reader.monthlyReport({month,currency,accountId});
      return {...values, month, source:values.income === null && values.spending === null
        ? 'No eligible transaction data' : 'Known transactions · possibly incomplete'};
    })};
}

// Short, honest labels for each month's evidence. The full source stays in the
// accessible name and the readout.
const SOURCE_TAGS = {
  'Reconciled transaction detail':'Reconciled',
  'Workbook-reported summary':'Reported',
  'Manually recorded summary':'Manual',
  'Known transactions · possibly incomplete':'Partial',
  'No eligible transaction data':'No data',
  'No comparable historical summary':'No data',
  'Different currency or coverage':'Not comparable'
};
export const trendSourceTag = source => SOURCE_TAGS[source] ?? 'Unknown';

// Financial strings are never rounded for display; this is only the scale of
// the decorative bars. Exact signed values stay in the readout.
function chartUnits(value) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return 0n;
  const [whole,fraction = ''] = value.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(18, '0'));
}

// One column per month. A column inspects its month in place; only the
// readout's explicit link opens that month in Activity.
export function mountHomeMonthlyTrend({context, months, readout, node, money, monthLabel, shortMonth, onOpenMonth = null}) {
  let current = null, selection = null, history = null, load = null, chosen = null, trend = null;
  const empty = row => row.income === null && row.spending === null;
  function describe(row) {
    const parts = [monthLabel(row.month)];
    if (empty(row)) parts.push('no data');
    else parts.push(`in ${money(row.income, trend.currency)}`, `out ${money(row.spending, trend.currency)}`);
    parts.push(row.source);
    return parts.join(' · ');
  }
  function showReadout() {
    if (!readout) return;
    readout.replaceChildren();
    const row = trend?.rows.find(item => item.month === chosen);
    if (!row) return;
    const values = node('p', undefined, 'trend-readout-values');
    values.append(node('strong', monthLabel(row.month)));
    if (empty(row)) values.append(node('span', 'No data for this month, which is not the same as zero.'));
    else for (const [key, title] of [['income','In'],['spending','Out']]) {
      const item = node('span', undefined, 'trend-readout-item');
      item.append(node('span', title, `trend-key trend-key-${key}`), node('span', money(row[key], trend.currency), 'amount'));
      values.append(item);
    }
    const note = node('p', row.source, 'trend-readout-source');
    if (onOpenMonth && selection?.view.months.includes(row.month)) {
      const link = node('button', `Open ${monthLabel(row.month)} in Activity`, 'link-button');
      link.type = 'button';
      link.addEventListener('click', () => onOpenMonth(row.month));
      note.append(link);
    }
    readout.append(values, note);
  }
  function select(month) {
    chosen = month;
    for (const item of months.children) {
      const button = item.children[0];
      button?.setAttribute('aria-pressed', String(button.dataset.month === chosen));
    }
    showReadout();
  }
  function draw() {
    const {view,reader} = selection;
    trend = homeMonthlyTrend(history,view,reader);
    context.textContent = trend.context;
    let max = 0n;
    for (const row of trend.rows) for (const amount of [row.income,row.spending]) {
      const units = chartUnits(amount);
      if (units > max) max = units;
    }
    const has = month => trend.rows.some(row => row.month === month);
    chosen = has(view.scope.month) ? view.scope.month : has(chosen) ? chosen : trend.rows.at(-1)?.month ?? null;
    months.replaceChildren(...trend.rows.map(row => {
      const li = node('li', undefined, 'trend-month');
      const button = node('button', undefined, 'trend-column');
      button.type = 'button';
      button.dataset.month = row.month;
      button.dataset.source = trendSourceTag(row.source).toLowerCase().replaceAll(' ', '-');
      button.setAttribute('aria-pressed', String(row.month === chosen));
      button.setAttribute('aria-label', describe(row));
      const bars = node('span', undefined, 'trend-bars');
      bars.setAttribute('aria-hidden', 'true');
      if (empty(row)) bars.append(node('span', trendSourceTag(row.source), 'trend-gap'));
      else for (const key of ['income', 'spending']) {
        const amount = row[key];
        const negative = amount?.startsWith('-') ? ' trend-bar-negative' : '';
        const missing = amount === null ? ' trend-bar-missing' : '';
        const bar = node('span', undefined, `trend-bar trend-bar-${key}${negative}${missing}`);
        const pct = amount === null || !max ? 0 : Number(chartUnits(amount) * 1000n / max) / 10;
        bar.setAttribute('style', `--h:${amount === null ? 0 : Math.max(pct, 1.5)}%`);
        bars.append(bar);
      }
      const caption = node('span', undefined, 'trend-label');
      caption.setAttribute('aria-hidden', 'true');
      // A gap says so once, inside the plot; data months name their evidence.
      caption.append(node('span', shortMonth(row.month), 'trend-month-name'), node('span', empty(row) ? '' : trendSourceTag(row.source), 'trend-source'));
      button.append(bars, caption);
      button.addEventListener('click', () => select(row.month));
      li.append(button);
      return li;
    }));
    showReadout();
  }
  return {
    refresh(ledger, reader, view) {
      const key = `${view.scope.accountId}|${view.scope.month}`;
      if (ledger === current && selection?.key === key) return;
      selection = {view, reader, key};
      if (ledger === current) { if (history) draw(); return; }
      const request = {};
      load = request; current = ledger; history = null; months.replaceChildren(); readout?.replaceChildren();
      if (!ledger.historicalSummaryBatches?.length) { history = []; draw(); return; }
      context.textContent = 'Checking historical evidence…';
      void Promise.resolve().then(() => load === request ? getHistoricalMonthlySummaryView(ledger) : null).then(rows => {
        if (load !== request) return;
        history = rows;
        draw();
      }).catch(() => {
        if (load !== request) return;
        months.replaceChildren(); readout?.replaceChildren();
        context.textContent = 'Historical evidence could not be shown. Check your reviewed summaries in More.';
      });
    },
    clear() {
      load = null; current = null; history = null; selection = null; trend = null; chosen = null;
      months.replaceChildren(); readout?.replaceChildren(); context.textContent = '';
    },
  };
}
