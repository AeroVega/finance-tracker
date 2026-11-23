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
    return {currency, context:`Latest six calendar months ending with available historical evidence · ${currency} · ${names}. Uses one source per month. Gaps are not filled with transactions or estimates. The period filter does not change this chart.`,
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
  return {currency, context:`Latest six calendar months ending with ledger evidence · ${currency} · ${selected?.displayName ?? 'All accounts'}. These transaction subtotals may be partial and are not estimates. Gaps are not zero. The period filter does not change this chart.`,
    rows:months.map(month => {
      const values = reader.monthlyReport({month,currency,accountId});
      return {...values, month, source:values.income === null && values.spending === null
        ? 'No eligible transaction data' : 'Known transactions · possibly incomplete'};
    })};
}

// Financial strings are never rounded for display; this is only the scale of
// the decorative bars. Exact signed values remain visible beside each bar.
function chartUnits(value) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return 0n;
  const [whole,fraction = ''] = value.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(18, '0'));
}

export function mountHomeMonthlyTrend({context,months,node,money,monthLabel}) {
  let current = null, selection = null, history = null, load = null;
  function draw() {
    const {view,reader} = selection;
    const trend = homeMonthlyTrend(history,view,reader);
    context.textContent = trend.context;
    let max = 0n;
    for (const row of trend.rows) for (const amount of [row.income,row.spending]) {
      const units = chartUnits(amount);
      if (units > max) max = units;
    }
    months.replaceChildren(...trend.rows.map(row => {
      const li = node('li', undefined, 'home-trend-row');
      const heading = node('div'), values = node('div', undefined, 'home-trend-values');
      heading.append(node('strong', monthLabel(row.month), 'home-trend-month'), node('small', row.source, 'home-trend-source'));
      for (const [key,label] of [['income','Income'],['spending','Spending']]) {
        const amount = row[key];
        const line = node('div'), bar = node('span', undefined, `home-trend-bar home-trend-bar-${key}${amount?.startsWith('-') ? ' home-trend-bar-negative' : ''}`);
        const fill = node('span');
        if (amount !== null) {
          const units = chartUnits(amount);
          const pct = max ? Number(units * 1000n / max) / 10 : 0;
          fill.setAttribute('style', `width:${pct}%`);
          bar.setAttribute('aria-hidden', 'true');
          bar.append(fill);
        }
        line.append(node('small',label), node('strong',money(amount,trend.currency),'home-trend-amount'));
        if (amount !== null) line.append(bar);
        values.append(line);
      }
      li.append(heading, values);
      return li;
    }));
  }
  return {
    refresh(ledger, reader, view) {
      if (ledger === current && selection?.view.scope.accountId === view.scope.accountId) return;
      selection = {view,reader};
      if (ledger === current) { if (history) draw(); return; }
      const request = {};
      load = request; current = ledger; history = null; months.replaceChildren();
      if (!ledger.historicalSummaryBatches?.length) { history = []; draw(); return; }
      context.textContent = 'Checking historical evidence…';
      void Promise.resolve().then(() => load === request ? getHistoricalMonthlySummaryView(ledger) : null).then(rows => {
        if (load !== request) return;
        history = rows;
        draw();
      }).catch(() => {
        if (load !== request) return;
        months.replaceChildren();
        context.textContent = 'Historical evidence could not be shown. Check your reviewed summaries in Storage.';
      });
    },
    clear() {
      load = null; current = null; history = null; selection = null;
      months.replaceChildren(); context.textContent = '';
    },
  };
}
