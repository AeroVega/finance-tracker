/* Planning page (#planning) and Home's budget card. Presentation only: the read
   models are budget-report.mjs and cash-projection.mjs, and every change is staged
   through the workspace session as planning records. Only the workspace's
   explicit Save writes them. See docs/DESIGN.md#planning. */
import {fail} from './app-error.mjs';
import {getHistoricalMonthlySummaryView} from './historical-monthly-summary.mjs';
import {categoryCatalog} from './category-catalog.mjs';
import {buildBudgetReport, categoryKey} from './budget-report.mjs';
import {buildCashProjection} from './cash-projection.mjs';
import {budgetAmount} from './planning-contract.mjs';
import {currentMonth, shiftMonth, signOf, negateExact, subtractExact, shareOf} from './home-period-report.mjs';

const pad = value => String(value).padStart(2, '0');
export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const STATE_TEXT = {reconciled:'Reconciled', imported:'Imported, not reconciled', declared:'Declared, no activity', 'needs-fix':'Needs a fix', none:'No data'};
const EXCLUDE_REASON = 'One-off, not expected to repeat.';
const INCLUDE_REASON = 'Expected to repeat after all.';
const MONTHS_BACK = 24;

export function mountPlanning({document, root, homeRoot = null, money, monthLabel, today = () => localToday(),
  isActive = () => true, getUnavailableReason = () => null, stage, onOpenAccount = () => {}}) {
  if (!root || typeof stage !== 'function' || typeof money !== 'function') fail('invalid-options');
  const el = (tag, text, className, attrs = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const button = (text, className = 'secondary-button', attrs = {}) => { const node = el('button', text, className, attrs); node.type = 'button'; return node; };
  // Focus after the redraw that is still running has attached the element.
  const focusLater = node => { void Promise.resolve().then(() => node?.focus?.()); };
  const dateLabel = date => new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});

  let ledger = null, reader = null, view = null, history = null, load = null;
  let month = null, editing = false, drafts = new Map(), added = [], openExclusion = null, exclusionText = '';
  let drawnFor = null, homeFor = null;

  // ---------- Skeleton ----------
  const step = el('div', undefined, 'planning-step');
  const prev = button('', 'icon-button', {'aria-label':'Previous month'});
  const next = button('', 'icon-button', {'aria-label':'Next month'});
  for (const [node, d] of [[prev, 'm15 6-6 6 6 6'], [next, 'm9 6 6 6-6 6']]) node.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${d}"/></svg>`;
  const monthTitle = el('h2', '', 'planning-month', {id:'planning-month-title', 'aria-live':'polite'});
  step.append(prev, monthTitle, next);
  const budgets = el('section', undefined, 'planning-block', {'aria-labelledby':'budgets-heading'});
  const budgetHead = el('div', undefined, 'block-head');
  const budgetsMeta = el('p', '', 'block-meta', {id:'budgets-meta'});
  budgetHead.append(el('h3', 'Budgets', undefined, {id:'budgets-heading'}), budgetsMeta);
  const budgetBody = el('div', undefined, 'budget-body', {id:'budget-body'});
  budgets.append(budgetHead, budgetBody);
  const projection = el('section', undefined, 'planning-block', {'aria-labelledby':'projection-heading'});
  const projectionHead = el('div', undefined, 'block-head');
  projectionHead.append(el('h3', 'Cash projection', undefined, {id:'projection-heading'}), el('p', 'Checking and savings, next three month-ends', 'block-meta'));
  const projectionBody = el('div', undefined, 'projection-body', {id:'projection-body'});
  projection.append(projectionHead, projectionBody);
  const status = el('p', '', 'planning-status', {role:'status', id:'planning-status'});
  root.replaceChildren(step, status, budgets, projection);
  root.hidden = true;
  prev.addEventListener('click', () => { month = shiftMonth(month, -1); editing = false; draw(); });
  next.addEventListener('click', () => { month = shiftMonth(month, 1); editing = false; draw(); });

  // ---------- Budgets ----------
  const signed = (value, currency) => value === null ? 'Unavailable' : money(value, currency);
  const remainingText = (row, currency) => row.remaining === null ? 'No spending recorded yet'
    : row.over ? `${money(negateExact(row.remaining), currency)} over` : `${money(row.remaining, currency)} left`;
  function meter(actual, target) {
    const bar = el('span', undefined, 'budget-meter', {'aria-hidden':'true'});
    const share = actual === null ? 0 : Math.min(shareOf(actual, target), 100);
    const fill = el('span', undefined, 'budget-meter-fill');
    // CSSOM, not a style attribute, so a strict style-src policy still applies.
    if (fill.style) fill.style.width = `${share}%`;
    if (actual !== null && signOf(subtractExact(actual, target)) > 0) bar.dataset.state = 'over';
    bar.append(fill);
    return bar;
  }
  function budgetRow(row, currency, coverageGap) {
    const item = el('li', undefined, 'budget-row');
    if (row.over) item.dataset.state = 'over';
    const head = el('div', undefined, 'budget-row-head');
    head.append(el('span', row.label, 'budget-name'), el('span', remainingText(row, currency), 'budget-remaining'));
    const detail = el('p', row.actual === null ? `Target ${money(row.target, currency)}` : `${money(row.actual, currency)} of ${money(row.target, currency)}`, 'budget-detail');
    item.append(head, meter(row.actual, row.target), detail);
    // A coverage gap is explained once, in the notice above the list.
    if (row.estimate && !(row.estimate.amount === null && coverageGap)) {
      const note = row.estimate.amount === null ? row.estimate.note
        : `Estimated month-end ${money(row.estimate.amount, currency)}. ${row.estimate.note}`;
      item.append(el('p', note, 'budget-estimate'));
    }
    return item;
  }
  function coverageNotice(report) {
    const {coverage} = report;
    if (!coverage || coverage.complete) return null;
    const parts = coverage.issues.map(issue => issue.kind === 'no-accounts' ? 'No checking, savings or card account is set up.'
      : issue.kind === 'no-coverage' ? `${issue.name} has no import for this month.`
      : issue.kind === 'partial' ? `${issue.name} is imported through ${dateLabel(issue.through)}.`
      : `${issue.name} has rows waiting for review.`);
    return el('p', `Recorded spending may be incomplete. ${[...new Set(parts)].join(' ')} Month-end estimates are withheld.`, 'notice');
  }
  function drawBudgets(report) {
    budgetBody.replaceChildren();
    budgetsMeta.textContent = budgetMeta(report);
    if (!report.available) { budgetBody.append(el('p', report.context, 'quiet-placeholder')); return; }
    const {currency} = report;
    if (editing) { budgetBody.append(editor(report)); return; }
    const notice = coverageNotice(report);
    if (notice) budgetBody.append(notice);
    if (!report.rows.length) {
      budgetBody.append(el('p', report.timing === 'past' ? `No budgets were set for ${monthLabel(report.month)}.`
        : `No budgets for ${monthLabel(report.month)}. Budgets are optional; Home and Activity work without them.`, 'quiet-placeholder'));
    } else {
      const figures = el('div', undefined, 'figures');
      const figure = (label, value, note) => { const card = el('article', undefined, 'metric-card'); card.append(el('p', label, 'metric-label'), el('p', value, 'metric-value'), el('p', note, 'metric-note')); return card; };
      const {total} = report;
      figures.append(
        figure('Budgeted', money(total.target, currency), `${report.rows.length} ${report.rows.length === 1 ? 'category' : 'categories'}`),
        figure('Spent in budgeted categories', signed(total.budgetedSpending, currency),
          total.remaining === null ? 'No spending recorded yet' : signOf(total.remaining) < 0 ? `${money(negateExact(total.remaining), currency)} over in total` : `${money(total.remaining, currency)} left in total`),
        figure('All spending', signed(total.spending, currency), report.notBudgeted.spending === null ? 'No spending recorded yet' : `${money(report.notBudgeted.spending, currency)} not budgeted`));
      if (report.overCount) figures.children[1].dataset.state = 'over';
      const list = el('ul', undefined, 'budget-list', {'aria-label':`Budgets for ${monthLabel(report.month)}`});
      for (const row of report.rows) list.append(budgetRow(row, currency, report.coverage ? !report.coverage.complete : false));
      budgetBody.append(figures, list);
    }
    if (report.notBudgeted.categories.length) {
      const details = el('details', undefined, 'disclosure');
      details.append(el('summary', `Not budgeted · ${money(report.notBudgeted.spending, currency)}`));
      const list = el('ul', undefined, 'plain-rows');
      for (const item of report.notBudgeted.categories) {
        const row = el('li'); row.append(el('span', item.label), el('span', money(item.spending, currency), 'amount'));
        list.append(row);
      }
      details.append(list);
      budgetBody.append(details);
    }
    const actions = el('div', undefined, 'planning-actions');
    if (report.timing === 'past') actions.append(el('p', 'Past months keep the targets they had. Changes apply from the current month on.', 'field-help'));
    else {
      const reason = getUnavailableReason();
      const edit = button(report.rows.length ? 'Edit budgets' : 'Set up budgets', report.rows.length ? 'secondary-button' : 'primary-button', {id:'budget-edit'});
      edit.disabled = Boolean(reason);
      edit.addEventListener('click', () => { editing = true; drafts = new Map(); added = []; draw(); focusLater(document.getElementById('budget-input-0')); });
      actions.append(edit);
      if (reason) actions.append(el('p', reason, 'field-help'));
    }
    budgetBody.append(actions);
  }
  function budgetMeta(report) {
    if (!report.available) return '';
    const parts = [report.timing === 'current' ? 'This month' : report.timing === 'future' ? 'Upcoming' : 'Past month'];
    if (report.sourceTag && report.hasData) parts.push(report.sourceTag);
    if (report.coverage?.through && report.timing === 'current') parts.push(`through ${dateLabel(report.coverage.through)}`);
    return parts.join(' · ');
  }

  // ---------- Budget editor ----------
  function editorRows(report) {
    const rows = new Map();
    for (const row of report.rows) rows.set(row.key, {key:row.key, categoryId:row.categoryId, label:row.label, current:row.target, suggestion:null});
    for (const item of report.suggestions?.suggestions ?? []) {
      const categoryId = item.categoryId || null;
      if (!categoryId) continue;
      const row = rows.get(item.key) ?? {key:item.key, categoryId, label:item.label, current:null, suggestion:null};
      row.suggestion = item; rows.set(item.key, row);
    }
    const catalog = categoryCatalog(ledger);
    for (const categoryId of added) if (!rows.has(categoryKey(categoryId, catalog))) rows.set(categoryKey(categoryId, catalog), {key:categoryKey(categoryId, catalog), categoryId, label:catalog.label(categoryId), current:null, suggestion:null});
    return [...rows.values()];
  }
  function editor(report) {
    const {currency} = report, catalog = categoryCatalog(ledger);
    const form = el('form', undefined, 'budget-editor', {novalidate:''});
    const used = report.suggestions?.months ?? [];
    form.append(el('p', used.length
      ? `Each field starts from the category's current target or its average monthly spending over ${used.length === 1 ? 'the latest month' : `the latest ${used.length} months`} with data. Edit or clear any field. Nothing is stored until you stage and save.`
      : 'No recent months have spending data, so there are no suggestions. Type a target for each category you want to budget.', 'field-help'));
    const rows = editorRows(report);
    const list = el('ul', undefined, 'budget-edit-list');
    const inputs = [];
    rows.forEach((row, index) => {
      const item = el('li', undefined, 'budget-edit-row');
      const id = `budget-input-${index}`;
      const label = el('label', row.label, 'budget-edit-label', {for:id});
      const input = el('input', undefined, undefined, {id, type:'text', inputmode:'decimal', autocomplete:'off', 'aria-describedby':`${id}-note`});
      input.value = drafts.has(row.key) ? drafts.get(row.key) : row.current ?? row.suggestion?.amount ?? '';
      input.addEventListener('input', () => { drafts.set(row.key, input.value); input.removeAttribute('aria-invalid'); });
      const note = row.current ? `Current target ${money(row.current, currency)}.` : '';
      const hint = row.suggestion ? `Suggested: average ${money(row.suggestion.average, currency)} over ${row.suggestion.months} ${row.suggestion.months === 1 ? 'month' : 'months'}.` : '';
      item.append(label, input, el('span', [note, hint].filter(Boolean).join(' ') || 'No recent spending.', 'field-help', {id:`${id}-note`}));
      list.append(item); inputs.push({row, input});
    });
    form.append(list);
    // Budgets are set on top-level spending categories. A subcategory counts toward its parent.
    const choices = catalog.choices('spending').filter(choice => !choice.parentId && !rows.some(row => row.key === categoryKey(choice.id, catalog)));
    if (choices.length) {
      const addWrap = el('div', undefined, 'budget-add');
      const select = el('select', undefined, undefined, {id:'budget-add-category', 'aria-label':'Add a category'});
      select.append(el('option', 'Add a category…', undefined, {value:''}));
      for (const choice of choices) select.append(el('option', choice.label, undefined, {value:choice.id}));
      select.addEventListener('change', () => {
        if (!select.value) return;
        for (const {row, input} of inputs) drafts.set(row.key, input.value);
        added.push(select.value); draw();
        focusLater(document.getElementById(`budget-input-${inputs.length}`));
      });
      addWrap.append(select);
      form.append(addWrap);
    }
    const error = el('p', '', 'field-error', {role:'alert'});
    const actions = el('div', undefined, 'planning-actions');
    const submit = button(`Stage budgets from ${monthLabel(report.month)}`, 'primary-button');
    submit.type = 'submit';
    const cancel = button('Cancel', 'text-button');
    cancel.addEventListener('click', () => { editing = false; drafts = new Map(); added = []; draw(); focusLater(document.getElementById('budget-edit')); });
    actions.append(submit, cancel);
    form.append(error, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const commands = [], invalid = [];
      for (const {row, input} of inputs) {
        const text = input.value.trim().replace(/^\$/, '').replaceAll(',', '');
        if (!text) {
          if (row.current) commands.push({type:'budget-target', categoryId:row.categoryId, currency, effectiveMonth:report.month, amountText:null});
          continue;
        }
        let amount;
        try { amount = budgetAmount(text, currency); } catch { invalid.push(row.label); input.setAttribute('aria-invalid', 'true'); continue; }
        if (amount !== row.current) commands.push({type:'budget-target', categoryId:row.categoryId, currency, effectiveMonth:report.month, amountText:amount});
      }
      if (invalid.length) { error.textContent = `Enter an amount above zero, such as 250 or 250.50, for: ${invalid.join(', ')}.`; inputs.find(({input}) => input.getAttribute('aria-invalid') === 'true')?.input.focus(); return; }
      if (!commands.length) { error.textContent = 'Nothing changed. Edit a field, or cancel.'; return; }
      const reason = getUnavailableReason();
      if (reason) { error.textContent = reason; return; }
      // Close the editor first: staging re-renders the page.
      editing = false;
      try {
        stage(commands, `${commands.length} budget ${commands.length === 1 ? 'change' : 'changes'} staged from ${monthLabel(report.month)}. Save to keep ${commands.length === 1 ? 'it' : 'them'}.`);
        drafts = new Map(); added = [];
      } catch (problem) { editing = true; error.textContent = problem?.code === 'budget-target-before-current-month' ? 'Budget changes apply from the current month on.' : 'The budget could not be staged. Check the amounts and try again.'; }
    });
    return form;
  }

  // ---------- Projection ----------
  function drawProjection() {
    projectionBody.replaceChildren();
    const result = buildCashProjection({ledger, today:today()});
    const range = `${monthLabel(result.months[0])} to ${monthLabel(result.months.at(-1))}`;
    if (result.status === 'blocked') {
      if (result.blocker === 'no-cash-accounts') { projectionBody.append(el('p', 'Add a checking or savings account to project a cash balance.', 'quiet-placeholder')); return; }
      if (result.blocker === 'mixed-currency') { projectionBody.append(el('p', 'Checking and savings accounts use different currencies, which are never combined. No projection is shown.', 'quiet-placeholder')); return; }
      projectionBody.append(el('p', `A baseline needs every checking and savings account reconciled for ${range}. These months are missing, so nothing is projected:`, 'projection-intro'));
      const list = el('ul', undefined, 'gap-list', {'aria-label':'Months that need reconciling'});
      for (const item of result.missing) {
        const row = el('li');
        const open = button(`${item.name} · ${monthLabel(item.month)}`, 'row-link', {'aria-label':`Open ${item.name}, ${monthLabel(item.month)}, in Accounts`});
        open.append(el('span', STATE_TEXT[item.state] ?? item.state, 'gap-state'));
        open.addEventListener('click', () => onOpenAccount(item.accountId, item.month));
        row.append(open); list.append(row);
      }
      projectionBody.append(list, el('p', 'Select a month to open it in Accounts. Reconcile it in Activity, on the Reconcile view, with its opening and closing balances.', 'field-help'));
      return;
    }
    const {currency} = result;
    projectionBody.append(el('p', `Baseline estimate, not a forecast of certain outcomes. It starts from the reconciled balances on ${dateLabel(result.startDate)} and assumes each coming month looks like the average of ${range}. This month's activity so far is not used.`, 'projection-intro'));
    const table = el('table', undefined, 'projection-table');
    const head = el('thead'), headRow = el('tr');
    for (const text of ['Month-end', 'Balance', 'Change']) headRow.append(el('th', text, undefined, {scope:'col'}));
    head.append(headRow);
    const body = el('tbody');
    const startRow = el('tr', undefined, 'projection-start');
    startRow.append(el('th', `${dateLabel(result.startDate)} · reconciled`, undefined, {scope:'row'}), el('td', money(result.startBalance, currency), 'amount'), el('td', '', 'amount'));
    body.append(startRow);
    let previous = result.startBalance;
    for (const point of result.projection) {
      const row = el('tr');
      const change = subtractExact(point.balance, previous); previous = point.balance;
      row.append(el('th', `${dateLabel(point.date)} · estimate`, undefined, {scope:'row'}), el('td', money(point.balance, currency), 'amount'),
        el('td', `${signOf(change) > 0 ? '+' : ''}${money(change, currency)}`, 'amount'));
      if (signOf(point.balance) < 0) row.dataset.state = 'negative';
      body.append(row);
    }
    table.append(head, body);
    projectionBody.append(table);
    if (result.negative) projectionBody.append(el('p', `The baseline falls below zero by ${dateLabel(result.negative.date)}.`, 'notice'));
    const averages = el('p', `Average a month: ${money(result.average.inflow, currency)} in, ${money(result.average.outflow, currency)} out, ${signOf(result.average.net) > 0 ? '+' : ''}${money(result.average.net, currency)} net. ${result.internalTransfers} transfers between these accounts are left out.`, 'block-meta');
    projectionBody.append(averages);

    const oneOffs = el('div', undefined, 'one-offs');
    oneOffs.append(el('h4', 'One-off rows'));
    if (!result.suggested.length && !result.excluded.length) oneOffs.append(el('p', 'No unusually large rows in these months.', 'field-help'));
    if (result.suggested.length) oneOffs.append(el('p', 'These rows are large and do not repeat every month. Exclude one only if you do not expect it again.', 'field-help'));
    const list = el('ul', undefined, 'one-off-list');
    for (const row of result.suggested) list.append(oneOffRow(row, currency, true));
    for (const row of result.excluded) list.append(oneOffRow(row, currency, false));
    oneOffs.append(list);
    if (result.exclusionsOutsideWindow) oneOffs.append(el('p', `${result.exclusionsOutsideWindow} earlier exclusions are outside these months and no longer apply.`, 'field-help'));
    projectionBody.append(oneOffs);
  }
  function oneOffRow(row, currency, suggested) {
    const item = el('li', undefined, 'one-off-row');
    if (!suggested) item.dataset.state = 'excluded';
    const line = el('div', undefined, 'one-off-line');
    const copy = el('span', undefined, 'one-off-copy');
    copy.append(el('strong', row.description), el('small', suggested ? dateLabel(row.date) : `${dateLabel(row.date)} · Excluded: ${row.reason}`));
    line.append(copy, el('span', money(row.amount, currency), 'amount'));
    item.append(line);
    const reason = getUnavailableReason();
    if (openExclusion === row.activityId) {
      const form = el('form', undefined, 'one-off-form', {novalidate:''});
      const id = `exclusion-reason-${row.activityId}`;
      const input = el('input', undefined, undefined, {id, type:'text', autocomplete:'off'});
      input.value = exclusionText;
      input.addEventListener('input', () => { exclusionText = input.value; });
      const error = el('p', '', 'field-error', {role:'alert'});
      const submit = button(suggested ? 'Stage exclusion' : 'Stage including it again', 'primary-button'); submit.type = 'submit';
      const cancel = button('Cancel', 'text-button');
      cancel.addEventListener('click', () => { openExclusion = null; draw(); });
      const actions = el('div', undefined, 'planning-actions'); actions.append(submit, cancel);
      form.append(el('label', 'Reason', 'budget-edit-label', {for:id}), input, error, actions);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!input.value.trim()) { error.textContent = 'Give a reason.'; input.focus(); return; }
        const blocked = getUnavailableReason();
        if (blocked) { error.textContent = blocked; return; }
        openExclusion = null;
        try {
          stage([{type:'projection-exclusion', activityId:row.activityId, excluded:suggested, reason:input.value.trim()}],
            suggested ? 'Exclusion staged. The projection now leaves this row out of the average. Save to keep it.' : 'Row included again in the average. Save to keep the change.');
        } catch { openExclusion = row.activityId; error.textContent = 'The change could not be staged. Reload the page data and try again.'; }
      });
      item.append(form);
      focusLater(input);
    } else {
      const toggle = button(suggested ? 'Exclude from average' : 'Include again', 'text-button', {'aria-label':`${suggested ? 'Exclude' : 'Include'} ${row.description} on ${dateLabel(row.date)}`});
      toggle.disabled = Boolean(reason);
      toggle.addEventListener('click', () => { openExclusion = row.activityId; exclusionText = suggested ? EXCLUDE_REASON : INCLUDE_REASON; draw(); });
      item.append(toggle);
    }
    return item;
  }

  // ---------- Home card ----------
  function drawHome() {
    if (!homeRoot || !ledger || history === null) return;
    const key = today();
    if (homeFor === ledger && homeRoot.dataset.key === key) return;
    homeFor = ledger; homeRoot.dataset.key = key;
    const body = document.getElementById('home-budget-body');
    body.replaceChildren();
    const thisMonth = today().slice(0, 7);
    const report = buildBudgetReport({ledger, history, view, reader, month:thisMonth, today:today(), detail:false});
    if (!report.available || !report.rows.length) {
      body.append(el('p', report.available ? 'No budgets this month. Budgets are optional.' : report.context, 'block-meta'));
    } else {
      const {currency, total} = report;
      const line = el('p', undefined, 'attention-line');
      line.append(el('span', String(report.overCount), 'attention-count', {'data-state':report.overCount ? 'due' : 'clear'}),
        el('span', `of ${report.rows.length} ${report.rows.length === 1 ? 'budget is' : 'budgets are'} over target in ${monthLabel(thisMonth)}.`));
      body.append(line, el('p', total.remaining === null ? `${money(total.target, currency)} budgeted. No spending recorded yet.`
        : signOf(total.remaining) < 0 ? `${money(negateExact(total.remaining), currency)} over ${money(total.target, currency)} in total.`
        : `${money(total.remaining, currency)} left of ${money(total.target, currency)}.`, 'block-meta'));
    }
  }

  // ---------- Drawing ----------
  function draw() {
    if (!ledger) return;
    root.hidden = false;
    if (history === null) { status.textContent = 'Checking historical evidence…'; return; }
    status.textContent = '';
    drawHome();
    if (!isActive()) { drawnFor = null; return; }
    const current = today().slice(0, 7);
    month ??= current;
    monthTitle.textContent = monthLabel(month);
    prev.disabled = month <= shiftMonth(current, -MONTHS_BACK);
    next.disabled = month >= shiftMonth(current, 1);
    drawnFor = `${month}|${editing}|${openExclusion}`;
    drawBudgets(buildBudgetReport({ledger, history, view, reader, month, today:today()}));
    drawProjection();
  }

  return {
    refresh(nextLedger, nextReader, nextView) {
      if (!nextLedger) return;
      const changed = nextLedger !== ledger;
      reader = nextReader; view = nextView;
      if (!changed) { if (isActive() && drawnFor === null) draw(); else if (!isActive()) drawnFor = null; drawHome(); return; }
      ledger = nextLedger; homeFor = null; drawnFor = null;
      month ??= currentMonth();
      const request = {}; load = request;
      if (!ledger.historicalSummaryBatches?.length) { history = []; draw(); return; }
      history = null; draw();
      void Promise.resolve().then(() => load === request ? getHistoricalMonthlySummaryView(ledger) : null).then(rows => {
        if (load !== request) return;
        history = rows; draw();
      }).catch(() => { if (load !== request) return; history = []; draw(); });
    },
    /** Redraw after navigation; the page computes only while it is visible. */
    activate() { if (ledger && history !== null) draw(); },
    hasUnfinishedWork: () => editing || openExclusion !== null,
    clear() {
      load = null; ledger = null; reader = null; view = null; history = null; month = null;
      editing = false; drafts = new Map(); added = []; openExclusion = null; drawnFor = null; homeFor = null;
      root.hidden = true;
      budgetBody.replaceChildren(); projectionBody.replaceChildren(); monthTitle.textContent = ''; status.textContent = '';
      if (homeRoot) { homeRoot.dataset.key = ''; document.getElementById('home-budget-body')?.replaceChildren(); }
    }
  };
}
