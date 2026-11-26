/* Home: the period bar, money in and out, spending by category and the trend.
   Each block reads one period report and never filters another block. Every
   selection inspects in place; only an explicit button navigates. */
import {getHistoricalMonthlySummaryView} from './historical-monthly-summary.mjs';
import {buildPeriodReport, periodKind, stepPeriod, sourceTag, shareOf, signOf, subtractExact, negateExact, addExact,
  NO_CATEGORY, NOT_BROKEN_DOWN, currentMonth} from './home-period-report.mjs';

const SMALL_SHARE = 3;
const SVG = 'http://www.w3.org/2000/svg';
const special = key => key.startsWith('\u0000');

// Financial strings are never rounded for display; this is only the scale of
// the decorative bars. Exact signed values stay in the readout.
function chartUnits(value) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return 0n;
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(18, '0'));
}
const percent = value => value >= 10 || value === 0 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;

export function mountHomeDashboard({document, $, node, money, monthLabel, shortMonth, today = () => currentMonth(),
  onChoosePeriod = () => {}, onOpenMonth = null, onOpenCategory = null}) {
  let current = null, history = null, load = null, selection = null, report = null;
  let chosenColumn = null, chosenCategory = null, smallerOpen = false;
  const svg = tag => document.createElementNS?.(SVG, tag) ?? null;

  const shortRange = (first, last) => first === last ? monthLabel(first)
    : first.slice(0, 4) === last.slice(0, 4) ? `${shortMonth(first)} to ${shortMonth(last)} ${first.slice(0, 4)}`
    : `${shortMonth(first)} ${first.slice(0, 4)} to ${shortMonth(last)} ${last.slice(0, 4)}`;
  function periodTitle(period) {
    const kind = periodKind(period);
    return kind === 'month' ? monthLabel(period) : kind === 'year' ? period : 'Lifetime';
  }
  function comparisonTitle(comparison) {
    if (!comparison) return '';
    const {months} = comparison;
    if (months.length === 1) return monthLabel(months[0]);
    return months.length === 12 && months[0].endsWith('-01') ? months[0].slice(0, 4) : shortRange(months[0], months.at(-1));
  }
  function delta(now, before, title) {
    if (now === null || before === null) return null;
    const change = subtractExact(now, before), sign = signOf(change);
    if (!sign) return `Same as ${title}`;
    return `${money(sign < 0 ? negateExact(change) : change, report.currency)} ${sign > 0 ? 'more' : 'less'} than ${title}`;
  }

  // The period bar is shared with Activity; it is drawn from the same report.
  function drawPeriodBar(period, bounds) {
    const kind = periodKind(period);
    for (const [id, value] of [['period-month', 'month'], ['period-year', 'year'], ['period-lifetime', 'lifetime']]) $(id).setAttribute('aria-pressed', String(kind === value));
    $('period-title').textContent = kind === 'lifetime' && bounds ? `Lifetime · ${shortRange(bounds.first, bounds.last)}` : periodTitle(period);
    for (const [id, direction, word] of [['period-prev', -1, 'Previous'], ['period-next', 1, 'Next']]) {
      const button = $(id);
      button.hidden = kind === 'lifetime';
      const edge = !bounds || stepPeriod(period, direction, bounds) === null;
      button.dataset.edge = String(edge);
      if (edge) button.disabled = true;
      button.setAttribute('aria-label', `${word} ${kind === 'year' ? 'year' : 'month'}`);
    }
  }

  function coverageLine(summary, kind) {
    if (!summary.dataMonths) return 'No data';
    const parts = summary.sources.map(({tag, count}) => kind === 'month' ? tag : `${count} ${tag.toLowerCase()}`);
    const missing = summary.months - summary.dataMonths;
    if (missing && kind !== 'month') parts.push(`${missing} no data`);
    return kind === 'month' ? parts.join(', ') : `${summary.months} months · ${parts.join(', ')}`;
  }

  function figure(label, value, note, state) {
    const card = node('article', undefined, 'metric-card');
    if (state) card.dataset.state = state;
    card.append(node('p', label, 'metric-label'), node('p', value, 'metric-value'), node('p', note, 'metric-note'));
    return card;
  }
  // Mixed currencies have no single report: show each currency's known totals.
  function drawCurrencyFallback(view) {
    const summaries = view.summary.length ? view.summary : [{currency:'USD', income:null, spending:null, cash:null}];
    for (const summary of summaries) {
      const available = view.summaryAvailability?.[summary.currency];
      for (const [key, heading] of [['income', 'Money in'], ['spending', 'Money out'], ['cash', 'Cash movement']]) {
        const value = available && available[key + 'Available'] === false ? null : summary[key];
        $('summary-cards').append(figure(`${heading} · ${summary.currency}`, money(value, summary.currency), 'Different currencies are not combined.'));
      }
    }
  }
  function drawSummary(view) {
    const cards = $('summary-cards'), empty = $('summary-empty');
    cards.replaceChildren(); empty.replaceChildren(); empty.hidden = true; cards.hidden = false;
    const accountName = view.scope.accountId ? view.accounts.find(a => a.accountId === view.scope.accountId)?.displayName : 'All accounts';
    if (!report.currency) {
      $('summary-scope').textContent = `${periodTitle(report.period)} · ${accountName}`;
      drawCurrencyFallback(view); return;
    }
    const {summary, comparison, kind} = report;
    const range = kind === 'lifetime' ? shortRange(report.bounds.first, report.bounds.last) : periodTitle(report.period);
    $('summary-scope').textContent = `${range} · ${accountName} · ${coverageLine(summary, kind)}`;
    if (kind === 'month' && !summary.dataMonths) {
      cards.hidden = true; empty.hidden = false;
      const message = node('p', undefined, 'period-empty-copy');
      message.append(node('strong', `Nothing recorded for ${monthLabel(report.period)} yet.`), node('span', ' That is missing data, not $0. Import a CSV to bring it in.'));
      empty.append(message);
      if (report.latestWithData) {
        const jump = node('button', `See ${monthLabel(report.latestWithData)}`, 'secondary-button');
        jump.type = 'button'; jump.addEventListener('click', () => onChoosePeriod(report.latestWithData));
        empty.append(jump);
      }
      return;
    }
    const title = comparisonTitle(comparison);
    const compared = key => {
      if (!comparison) return kind === 'lifetime' ? 'All recorded history' : '';
      if (!comparison.available) return kind === 'month' ? `No data in ${title} to compare` : `No comparison: ${title} has months without data`;
      return delta(summary[key], comparison.summary[key], title) ?? `No comparison with ${title}`;
    };
    cards.append(figure('Money in', money(summary.income, report.currency), compared('income')),
      figure('Money out', money(summary.spending, report.currency), compared('spending')),
      figure('Cash movement', money(summary.cash, report.currency), summary.cash === null ? 'No checking or savings detail in this period'
        : summary.cashMonths < summary.dataMonths ? `Imported months only, ${summary.cashMonths} of ${summary.dataMonths}` : 'Checking and savings only, not a balance'));
  }

  // Categories: the largest first; slices under 3% fold into one expandable row.
  function categoryRows() {
    const items = report.summary.categories;
    const positive = items.filter(item => signOf(item.spending) > 0);
    const whole = positive.reduce((sum, item) => addExact(sum, item.spending), '0');
    const rows = positive.map(item => ({...item, share:shareOf(item.spending, whole), slot:report.slots.get(item.key) ?? 0}));
    const small = rows.filter(row => row.share < SMALL_SHARE && !special(row.key));
    const main = small.length > 1 ? rows.filter(row => !small.includes(row)) : rows;
    if (small.length > 1) {
      const spending = small.reduce((sum, row) => addExact(sum, row.spending), '0');
      main.push({key:'\u0000smaller', label:`Smaller categories (${small.length})`, spending, share:shareOf(spending, whole), slot:0, children:small});
    }
    main.sort((a, b) => signOf(subtractExact(b.spending, a.spending)) || a.label.localeCompare(b.label, 'en'));
    const refunds = items.filter(item => signOf(item.spending) < 0);
    return {rows:main, refunds, whole};
  }
  const swatch = row => {
    const mark = node('span', undefined, 'swatch');
    mark.dataset.slot = special(row.key) && row.key !== '\u0000smaller' ? 'none' : String(row.slot);
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  };
  function legendButton(row, list) {
    const item = node('li', undefined, 'category-row');
    const button = node('button', undefined, 'category-choice'); button.type = 'button';
    button.dataset.key = row.key;
    button.setAttribute('aria-pressed', String(chosenCategory === row.key));
    if (row.children) button.setAttribute('aria-expanded', String(smallerOpen));
    const name = node('span', undefined, 'category-name'); name.append(swatch(row), node('span', row.label));
    button.append(name, node('span', money(row.spending, report.currency), 'category-amount amount'), node('span', percent(row.share), 'category-share'));
    button.setAttribute('aria-label', `${row.label}, ${money(row.spending, report.currency)}, ${percent(row.share)} of spending`);
    button.addEventListener('click', () => {
      if (row.children) smallerOpen = !smallerOpen;
      chosenCategory = row.key; drawCategories();
    });
    item.append(button);
    if (row.children && smallerOpen) {
      const nested = node('ol', undefined, 'category-nested');
      for (const child of row.children) legendButton(child, nested);
      item.append(nested);
    }
    list.append(item);
  }
  function drawDonut(rows, whole) {
    const plot = $('category-donut');
    plot.replaceChildren();
    if (!svg('g')) return;
    const defs = svg('defs'), pattern = svg('pattern');
    pattern.setAttribute('id', 'donut-hatch'); pattern.setAttribute('width', '4'); pattern.setAttribute('height', '4');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse'); pattern.setAttribute('patternTransform', 'rotate(45)');
    const line = svg('rect'); line.setAttribute('width', '1.4'); line.setAttribute('height', '4'); line.setAttribute('class', 'donut-hatch-line');
    pattern.append(line); defs.append(pattern); plot.append(defs);
    // Slices sit in colour-slot order, not rank, so neighbours keep validated contrast.
    const order = row => row.slot ? row.slot : row.key === '\u0000smaller' ? 8 : special(row.key) ? 9 : 7;
    const slices = [...rows].sort((a, b) => order(a) - order(b) || signOf(subtractExact(b.spending, a.spending)));
    const gap = slices.length > 1 ? 7 : 0;
    let start = 0;
    const units = chartUnits(whole);
    for (const row of slices) {
      const length = units ? Number(chartUnits(row.spending) * 1000n / units) : 0;
      const circle = svg('circle');
      for (const [key, value] of [['cx', 60], ['cy', 60], ['r', 46], ['pathLength', 1000], ['transform', 'rotate(-90 60 60)']]) circle.setAttribute(key, String(value));
      circle.setAttribute('class', 'donut-slice');
      circle.dataset.slot = special(row.key) && row.key !== '\u0000smaller' ? 'none' : String(row.slot);
      circle.setAttribute('stroke-dasharray', `${Math.max(length - gap, 1.5)} ${1000 - Math.max(length - gap, 1.5)}`);
      circle.setAttribute('stroke-dashoffset', String(-start - gap / 2));
      const selected = chosenCategory === row.key || row.children?.some(child => child.key === chosenCategory);
      if (chosenCategory) circle.dataset.dim = String(!selected);
      circle.addEventListener('click', () => { chosenCategory = row.key; if (row.children) smallerOpen = true; drawCategories(); });
      plot.append(circle);
      start += length;
    }
  }
  function drawCategoryReadout(rows) {
    const readout = $('category-readout');
    readout.replaceChildren();
    const all = rows.flatMap(row => row.children ? [row, ...row.children] : [row]);
    const row = all.find(item => item.key === chosenCategory);
    if (!row) return;
    const values = node('p', undefined, 'breakdown-readout-values');
    values.append(node('strong', row.label), node('span', money(row.spending, report.currency), 'amount'), node('span', `${percent(row.share)} of spending`));
    const facts = [];
    if (row.count) facts.push(`${row.count} ${row.count === 1 ? 'transaction' : 'transactions'}`);
    if (row.workbookMonths) facts.push(`${row.workbookMonths} workbook ${row.workbookMonths === 1 ? 'month' : 'months'}`);
    if (row.key === NOT_BROKEN_DOWN) facts.push('History totals without a category for this amount');
    if (row.key === NO_CATEGORY) facts.push('Imported spending with no category yet');
    const {comparison} = report;
    if (comparison?.available && !row.children) {
      const before = comparison.summary.categories.find(item => item.key === row.key)?.spending ?? '0';
      facts.push(delta(row.spending, before, comparisonTitle(comparison)));
    }
    const note = node('p', facts.filter(Boolean).join(' · '), 'breakdown-readout-source');
    // Only transaction months have records to open; a workbook-only category says so.
    if (onOpenCategory && !row.children && row.categoryId !== null && row.categoryId !== undefined && row.count) {
      const open = node('button', `Show ${row.label.toLowerCase() === 'no category' ? 'uncategorized spending' : row.label} in Activity`, 'link-button');
      open.type = 'button'; open.addEventListener('click', () => onOpenCategory(row.categoryId));
      note.append(open);
    }
    readout.append(values, note);
  }
  function drawCategories() {
    const legend = $('category-legend'), wrap = $('category-donut-wrap');
    legend.replaceChildren(); $('category-readout').replaceChildren();
    if (!report.currency) {
      wrap.hidden = true; $('categories-meta').textContent = '';
      legend.append(node('li', 'Choose one account to see categories. Different currencies are not combined.', 'quiet-placeholder'));
      return;
    }
    const {rows, refunds, whole} = categoryRows();
    const {summary} = report;
    const transactionMonths = summary.sources.filter(s => ['Reconciled', 'Partial'].includes(s.tag)).reduce((n, s) => n + s.count, 0);
    const historyMonths = summary.dataMonths - transactionMonths;
    $('categories-meta').textContent = !summary.dataMonths ? periodTitle(report.period)
      : [periodTitle(report.period), historyMonths ? `${historyMonths} history ${historyMonths === 1 ? 'month' : 'months'}` : '',
        transactionMonths ? `${transactionMonths} imported ${transactionMonths === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(' · ');
    if (!rows.length) {
      wrap.hidden = true;
      legend.append(node('li', summary.dataMonths ? `No spending to break down for ${periodTitle(report.period)}.`
        : `No data for ${periodTitle(report.period)}. Missing data is not zero.`, 'quiet-placeholder'));
      return;
    }
    wrap.hidden = false;
    if (chosenCategory && !rows.some(row => row.key === chosenCategory || row.children?.some(child => child.key === chosenCategory))) chosenCategory = null;
    $('category-total').replaceChildren(node('strong', money(whole, report.currency), 'amount'), node('span', 'spent'));
    drawDonut(rows, whole);
    for (const row of rows) legendButton(row, legend);
    for (const item of refunds) {
      const li = node('li', undefined, 'category-row category-refund');
      li.append(node('span', `${item.label}: refunds exceeded spending by ${money(negateExact(item.spending), report.currency)}`));
      legend.append(li);
    }
    drawCategoryReadout(rows);
  }

  // Trend: six months for a month, that year's months for a year, years for lifetime.
  function describeColumn(column, unit) {
    const parts = [unit === 'year' ? column.key : monthLabel(column.key)];
    const empty = column.income === null && column.spending === null;
    if (empty) parts.push('no data');
    else parts.push(`in ${money(column.income, report.currency)}`, `out ${money(column.spending, report.currency)}`);
    parts.push(unit === 'year' ? `${column.dataMonths} of ${column.months} months with data` : column.source);
    return parts.join(' · ');
  }
  function drawTrendReadout() {
    const readout = $('home-trend-readout');
    readout.replaceChildren();
    const {unit, columns} = report.trend;
    const column = columns.find(item => item.key === chosenColumn);
    if (!column) return;
    const values = node('p', undefined, 'trend-readout-values');
    values.append(node('strong', unit === 'year' ? column.key : monthLabel(column.key)));
    if (column.income === null && column.spending === null) values.append(node('span', 'No data for this period, which is not the same as zero.'));
    else for (const [key, title] of [['income', 'In'], ['spending', 'Out']]) {
      const item = node('span', undefined, 'trend-readout-item');
      item.append(node('span', title, `trend-key trend-key-${key}`), node('span', money(column[key], report.currency), 'amount'));
      values.append(item);
    }
    const source = unit === 'year'
      ? [`${column.dataMonths} of ${column.months} months with data`, ...column.sources.map(s => `${s.count} ${s.tag.toLowerCase()}`)].join(' · ')
      : column.source;
    const note = node('p', source, 'trend-readout-source');
    if (unit === 'year') {
      const open = node('button', `Show ${column.key}`, 'link-button'); open.type = 'button';
      open.addEventListener('click', () => onChoosePeriod(column.key)); note.append(open);
    } else if (onOpenMonth && column.income !== null) {
      const open = node('button', `Open ${monthLabel(column.key)} in Activity`, 'link-button'); open.type = 'button';
      open.addEventListener('click', () => onOpenMonth(column.key)); note.append(open);
    }
    readout.append(values, note);
  }
  function drawTrend() {
    const months = $('home-trend-months');
    const {unit, columns} = report.trend;
    $('home-trend-title').textContent = report.kind === 'lifetime' ? 'By year' : report.kind === 'year' ? `${report.period} by month` : 'Last six months';
    $('home-trend-context').textContent = report.context;
    months.dataset.count = String(columns.length);
    months.dataset.unit = unit;
    // Twelve narrow columns keep their evidence in the accessible name and readout.
    months.dataset.dense = String(columns.length > 6);
    if (!report.currency) { months.replaceChildren(); $('home-trend-readout').replaceChildren(); return; }
    let max = 0n;
    for (const column of columns) for (const amount of [column.income, column.spending]) { const u = chartUnits(amount); if (u > max) max = u; }
    const keys = columns.map(column => column.key);
    chosenColumn = keys.includes(report.period) ? (chosenColumn && keys.includes(chosenColumn) ? chosenColumn : report.period)
      : keys.includes(chosenColumn) ? chosenColumn
      : [...columns].reverse().find(column => column.income !== null || column.spending !== null)?.key ?? keys.at(-1) ?? null;
    months.replaceChildren(...columns.map(column => {
      const empty = column.income === null && column.spending === null;
      const tag = unit === 'year' ? (empty ? 'No data' : column.dataMonths === column.months ? 'Full' : `${column.dataMonths} mo`) : sourceTag(column.source);
      const li = node('li', undefined, 'trend-month');
      const button = node('button', undefined, 'trend-column'); button.type = 'button';
      button.dataset.month = column.key;
      button.dataset.source = empty ? 'no-data' : unit === 'year' ? (column.dataMonths < column.months ? 'partial' : 'full') : tag.toLowerCase().replaceAll(' ', '-');
      button.setAttribute('aria-pressed', String(column.key === chosenColumn));
      button.setAttribute('aria-label', describeColumn(column, unit));
      const bars = node('span', undefined, 'trend-bars'); bars.setAttribute('aria-hidden', 'true');
      if (empty) bars.append(node('span', 'No data', 'trend-gap'));
      else for (const key of ['income', 'spending']) {
        const amount = column[key];
        const bar = node('span', undefined, `trend-bar trend-bar-${key}${amount?.startsWith('-') ? ' trend-bar-negative' : ''}${amount === null ? ' trend-bar-missing' : ''}`);
        const pct = amount === null || !max ? 0 : Number(chartUnits(amount) * 1000n / max) / 10;
        bar.setAttribute('style', `--h:${amount === null ? 0 : Math.max(pct, 1.5)}%`);
        bars.append(bar);
      }
      const caption = node('span', undefined, 'trend-label'); caption.setAttribute('aria-hidden', 'true');
      caption.append(node('span', unit === 'year' ? `’${column.key.slice(2)}` : shortMonth(column.key), 'trend-month-name'), node('span', empty ? '' : tag, 'trend-source'));
      button.append(bars, caption);
      button.addEventListener('click', () => {
        chosenColumn = column.key;
        for (const item of months.children) item.children[0]?.setAttribute('aria-pressed', String(item.children[0].dataset.month === chosenColumn));
        drawTrendReadout();
      });
      li.append(button);
      return li;
    }));
    drawTrendReadout();
  }

  function draw() {
    const {reader, view, period} = selection;
    report = buildPeriodReport({history, view, reader, period, today:today()});
    drawPeriodBar(period, report.bounds);
    drawSummary(view);
    drawCategories();
    drawTrend();
  }
  return {
    /** Redraw for the current ledger, account and period. History loads once per ledger. */
    refresh(ledger, reader, view) {
      const period = view.scope.month, key = `${view.scope.accountId}|${period}`;
      // Search and filter renders reuse the drawn report; only scope or ledger changes redraw.
      if (ledger === current && selection?.key === key && report) { selection.view = view; return; }
      if (selection?.period !== period) { chosenCategory = null; smallerOpen = false; chosenColumn = null; }
      selection = {reader, view, period, key};
      if (ledger === current) { if (history) draw(); else drawPeriodBar(period, null); return; }
      const request = {};
      load = request; current = ledger; history = null; report = null;
      if (!ledger.historicalSummaryBatches?.length) { history = []; draw(); return; }
      drawPeriodBar(period, null);
      $('summary-scope').textContent = 'Checking historical evidence…';
      $('home-trend-context').textContent = 'Checking historical evidence…';
      for (const id of ['summary-cards', 'home-trend-months', 'home-trend-readout', 'category-legend', 'category-readout']) $(id).replaceChildren();
      void Promise.resolve().then(() => load === request ? getHistoricalMonthlySummaryView(ledger) : null).then(rows => {
        if (load !== request) return;
        history = rows;
        draw();
      }).catch(() => {
        if (load !== request) return;
        history = [];
        draw();
        $('home-trend-context').textContent = 'Historical evidence could not be shown, so only imported activity is used. Check your reviewed summaries in More.';
      });
    },
    /** The months and years the period bar can reach, once the report exists. */
    get bounds() { return report?.bounds ?? null; },
    clear() {
      load = null; current = null; history = null; selection = null; report = null;
      chosenColumn = null; chosenCategory = null; smallerOpen = false;
      for (const id of ['summary-cards', 'summary-empty', 'home-trend-months', 'home-trend-readout', 'category-donut', 'category-legend', 'category-readout', 'category-total']) $(id).replaceChildren();
      for (const id of ['home-trend-context', 'categories-meta', 'period-title']) $(id).textContent = '';
      $('summary-empty').hidden = true; $('summary-cards').hidden = false;
    },
  };
}


