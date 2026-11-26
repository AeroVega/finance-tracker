/* History migration page (#migration). One-time, owner-run transcription of
   the first-generation workbook into manual monthly summaries (batch v2).
   Typed cells and net-worth check values stay in this tab. Only a confirmed
   year is staged, through the same session staging path as the file review,
   and only the workspace's explicit Save writes it. */
import { fail } from './app-error.mjs';
import { previewHistoricalMonthlySummaries } from './historical-monthly-summary.mjs';
import {
  DEFAULT_SOURCE_ID, MIGRATION_START, acceptedMonths, buildYear, closingEstimates, displayCents,
  lastCompleteMonth, migrationMonths, migrationYears, monthName, monthShort, monthStates,
  netWorthCheck, parseAmount, previousMonth, savedCells, savedSetup, setupProblems, yearMonths
} from './history-migration.mjs';

const STATE_TEXT = {
  saved:'Saved', staged:'Staged, not saved yet', draft:'Typed, not staged', empty:'Not entered',
  other:'From another source', 'saved-edited':'Saved, with unstaged edits', 'staged-edited':'Staged, with unstaged edits',
  'other-edited':'From another source, with unstaged edits'
};
const ignoredFindings = new Set(['historical-record-already-accepted','historical-record-conflicts-with-saved-month']);

export function mountHistoryMigration({
  root, homeLink = null, getLedger, getSavedLedger = () => null, isActive = () => true,
  getUnavailableReason = () => null, stageSummaries, onStaged = () => {}, today = () => new Date()
}) {
  if (!root || typeof getLedger !== 'function' || typeof stageSummaries !== 'function') fail('invalid-options');
  const doc = root.ownerDocument;
  function el(tag, text = '', attrs = {}) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'id') node.id = value;
      else if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else if (key === 'type') { node.type = value; node.setAttribute('type', value); }
      else node.setAttribute(key, value);
    }
    return node;
  }
  const field = (id, label, help, attrs = {}) => {
    const wrap = el('label', '', {for:id, class:'migration-field'});
    const input = el('input', '', {id, type:'text', autocomplete:'off', spellcheck:'false', ...(help ? {'aria-describedby':id + '-help'} : {}), ...attrs});
    wrap.append(el('span', label, {class:'migration-field-label'}), input);
    if (help) wrap.append(el('span', help, {id:id + '-help', class:'field-help'}));
    return [wrap, input];
  };
  const button = (id, text, kind = 'secondary-button') => el('button', text, {id, type:'button', class:kind});

  let ledger = null, saved = null, setup = null, year = null, nextRowId = 0, staging = false, renderedFor = null;
  const cells = new Map();      // month → {income:{rowId:text}, expenses:{rowId:text}}
  const edited = new Set();     // months typed since they were last staged
  const checks = new Map();     // month → workbook net-worth text; never stored
  const sheets = {};            // year → worksheet name
  const confirmations = new Map();
  let rows = {income:[], expenses:[]};

  // ---------- Static skeleton ----------
  const progressSummary = el('p', '', {id:'migration-progress-summary', class:'migration-progress-summary', role:'status'});
  const map = el('div', '', {id:'migration-map', class:'migration-map'});
  const legend = el('ul', '', {class:'migration-legend', 'aria-label':'Map key'});
  for (const [state, text] of [['saved','Saved to your database'],['staged','Staged, not saved yet'],['draft','Typed, not staged'],['empty','Not entered']]) {
    const item = el('li'); item.append(el('span', '', {class:'migration-swatch', 'data-state':state, 'aria-hidden':'true'}), el('span', text)); legend.append(item);
  }
  const checkLegend = el('li'); checkLegend.append(el('span', '', {class:'migration-tick', 'data-check':'match', 'aria-hidden':'true'}), el('span', 'Net worth matches the workbook'));
  legend.append(checkLegend);
  const progress = el('section', '', {class:'migration-progress', 'aria-labelledby':'migration-progress-heading'});
  progress.append(el('h2', 'Progress', {id:'migration-progress-heading'}), progressSummary, map, legend);

  const setupBlock = el('details', '', {id:'migration-setup', class:'disclosure migration-setup'});
  const setupSummary = el('summary', 'About the old workbook');
  const setupBody = el('div', '', {class:'disclosure-body migration-setup-body'});
  const [workbookWrap, workbook] = field('migration-workbook', 'Workbook name', 'Recorded as the source of every month, for example its file name.', {maxlength:'300'});
  const [currencyWrap, currency] = field('migration-currency', 'Currency', null, {maxlength:'3', class:'migration-short'});
  const [lastWrap, last] = field('migration-last', 'Last month to migrate', 'Year and month, as 2026-10. Migration starts at January 2023.', {maxlength:'7', class:'migration-short', inputmode:'numeric', placeholder:'2026-10'});
  const [openingWrap, opening] = field('migration-opening', 'Net worth on January 1, 2023', 'The workbook’s first net-worth figure, at midnight on January 1. It is the only net-worth value stored; every later month is estimated from your income and expenses, the way the workbook does it.', {inputmode:'decimal', class:'migration-amount-input'});
  const accountsGroup = el('fieldset', '', {class:'migration-accounts', 'aria-describedby':'migration-accounts-help'});
  const accountsList = el('div', '', {class:'migration-checks'});
  accountsGroup.append(el('legend', 'Accounts the workbook tracked'), accountsList,
    el('p', 'Imported CSVs can replace a migrated month only for these accounts, after you reconcile that month. Investment accounts are left out.', {id:'migration-accounts-help', class:'field-help'}));
  const categoryGroups = {};
  const categoryBlock = el('div', '', {class:'migration-categories'});
  for (const [side, title, help] of [
    ['income', 'Income categories', 'One per income line in the workbook.'],
    ['expenses', 'Expense categories', 'Top-level categories only. Add subcategories into their category.']]) {
    const group = el('fieldset', '', {class:'migration-category-group', 'aria-describedby':`migration-${side}-help`});
    const list = el('ol', '', {class:'migration-category-list'});
    const add = button(`migration-add-${side}`, side === 'income' ? 'Add income category' : 'Add expense category', 'text-button migration-add');
    group.append(el('legend', title), el('p', help, {id:`migration-${side}-help`, class:'field-help'}), list, add);
    categoryGroups[side] = {list, add};
    categoryBlock.append(group);
  }
  const setupStatus = el('ul', '', {id:'migration-setup-problems', class:'migration-problems', 'aria-live':'polite'});
  setupBody.append(workbookWrap, el('div', '', {class:'migration-field-row'}), openingWrap, accountsGroup, categoryBlock, setupStatus);
  setupBody.children[1].append(currencyWrap, lastWrap);
  setupBlock.append(setupSummary, setupBody);

  const yearNav = el('div', '', {id:'migration-years', class:'migration-years', role:'group', 'aria-label':'Year'});
  const yearHeading = el('h2', '', {id:'migration-year-heading', tabindex:'-1'});
  const yearState = el('p', '', {id:'migration-year-state', class:'block-meta'});
  const [sheetWrap, sheet] = field('migration-sheet', 'Worksheet', null, {maxlength:'200', class:'migration-short'});
  const gridWrap = el('div', '', {id:'migration-grid-wrap', class:'migration-grid-wrap', tabindex:'0', role:'region', 'aria-labelledby':'migration-year-heading'});
  const gridHelp = el('p', 'Tab moves across a month. Enter moves to the next month. Amounts keep their exact cents; $ and commas are fine. Net-worth figures you type here are only compared, never saved.', {class:'field-help migration-grid-help'});
  const yearProblems = el('ul', '', {id:'migration-year-problems', class:'migration-problems', 'aria-live':'polite'});
  const reviewTotals = el('dl', '', {id:'migration-year-totals', class:'migration-totals'});
  const confirm = el('input', '', {id:'migration-confirm', type:'checkbox'});
  const confirmLabel = el('label', '', {for:'migration-confirm', class:'migration-confirm'});
  const confirmText = el('span', '');
  confirmLabel.append(confirm, confirmText);
  const [reasonWrap, reason] = field('migration-reason', 'Note for the history record', null, {maxlength:'300'});
  const stage = button('migration-stage', 'Stage year', 'primary-button');
  const stageHelp = el('p', '', {id:'migration-stage-help', class:'field-help'});
  stage.setAttribute('aria-describedby', 'migration-stage-help');
  const stageStatus = el('p', '', {id:'migration-stage-status', class:'status-message', role:'status', tabindex:'-1'});
  const review = el('section', '', {class:'migration-review', 'aria-labelledby':'migration-review-heading'});
  review.append(el('h3', 'Review and confirm', {id:'migration-review-heading'}), reviewTotals, yearProblems, confirmLabel, reasonWrap, stage, stageHelp, stageStatus);
  const yearBlock = el('section', '', {class:'migration-year', 'aria-labelledby':'migration-year-heading'});
  const yearHead = el('div', '', {class:'migration-year-head'});
  const yearTitle = el('div');
  yearTitle.append(yearHeading, yearState);
  yearHead.append(yearTitle, sheetWrap);
  yearBlock.append(yearNav, yearHead, gridHelp, gridWrap, review);

  const intro = el('p', 'Type each month’s income and expenses from the old workbook, one year at a time. When a year is complete, confirm it and save. Saved years stay in your database, so you can stop between years.', {class:'migration-intro'});
  root.replaceChildren(intro, progress, setupBlock, yearBlock);

  // ---------- Setup state ----------
  const newRow = label => ({id:'r' + (nextRowId++), label});
  function initialSetup() {
    const restored = savedSetup(ledger);
    const latestSaved = restored ? [...acceptedMonths(ledger).keys()].sort().at(-1) : null;
    const lastMonth = latestSaved && latestSaved > lastCompleteMonth(today()) ? latestSaved : lastCompleteMonth(today());
    setup = {
      workbook:restored?.workbook ?? '', sourceId:restored?.sourceId ?? DEFAULT_SOURCE_ID, currency:restored?.currency ?? 'USD',
      last:lastMonth, accountIds:restored?.accountIds ?? [], opening:restored?.opening ?? ''
    };
    rows = {income:(restored?.incomeLabels ?? ['']).map(newRow), expenses:(restored?.expenseLabels ?? ['']).map(newRow)};
    Object.assign(sheets, restored?.sheets ?? {});
    workbook.value = setup.workbook; currency.value = setup.currency; last.value = setup.last; opening.value = setup.opening;
    setupBlock.open = !restored;
  }
  const setupForModel = () => ({...setup, incomeLabels:rows.income.map(row => row.label), expenseLabels:rows.expenses.map(row => row.label)});
  const labelCells = month => {
    const value = cells.get(month) ?? {income:{}, expenses:{}};
    const out = {income:{}, expenses:{}};
    for (const side of ['income','expenses']) for (const row of rows[side]) out[side][row.label] = value[side][row.id] ?? '';
    return out;
  };
  function loadSavedCells() {
    // Unedited months always mirror the current workspace ledger.
    const accepted = acceptedMonths(ledger);
    for (const month of migrationMonths(setup.last)) {
      if (edited.has(month)) continue;
      const record = accepted.get(month)?.record;
      if (!record) { cells.delete(month); continue; }
      const values = savedCells(record), byId = {income:{}, expenses:{}};
      for (const side of ['income','expenses']) for (const row of rows[side]) byId[side][row.id] = values[side][row.label] ?? '';
      cells.set(month, byId);
    }
  }

  function renderAccounts() {
    const accounts = (ledger?.accounts ?? []).filter(account => !account.archivedAt && account.institutionId !== 'fidelity' && !['brokerage','retirement'].includes(account.accountType));
    accountsList.replaceChildren();
    if (!accounts.length) {
      const empty = el('p', '', {class:'field-help'});
      empty.append(el('span', 'No bank or card accounts yet. '), el('a', 'Add them on Accounts', {href:'#position'}), el('span', ', then come back.'));
      accountsList.append(empty);
      return;
    }
    for (const account of accounts) {
      const id = 'migration-account-' + account.accountId;
      const box = el('input', '', {id, type:'checkbox'});
      box.checked = setup.accountIds.includes(account.accountId);
      box.addEventListener('change', () => {
        setup.accountIds = box.checked ? [...new Set([...setup.accountIds, account.accountId])] : setup.accountIds.filter(item => item !== account.accountId);
        update();
      });
      const label = el('label', '', {for:id, class:'migration-check'});
      label.append(box, el('span', account.displayName ?? 'Unnamed account'));
      accountsList.append(label);
    }
  }
  function renderCategories() {
    for (const side of ['income','expenses']) {
      const {list} = categoryGroups[side];
      list.replaceChildren();
      rows[side].forEach((row, index) => {
        const item = el('li', '', {class:'migration-category'});
        const id = `migration-${side}-label-${row.id}`;
        const input = el('input', '', {id, type:'text', maxlength:'200', autocomplete:'off',
          'aria-label':`${side === 'income' ? 'Income' : 'Expense'} category ${index + 1}`, value:row.label});
        input.value = row.label;
        input.addEventListener('input', () => { row.label = input.value; renderGridHead(); update(); });
        const remove = el('button', 'Remove', {type:'button', class:'text-button', 'aria-label':`Remove ${row.label || 'category ' + (index + 1)}`});
        remove.disabled = rows[side].length === 1;
        remove.addEventListener('click', () => {
          const typed = [...cells.values()].some(value => (value[side][row.id] ?? '').trim());
          const view = doc.defaultView;
          if (typed && typeof view?.confirm === 'function' && !view.confirm(`Remove “${row.label}” and the amounts typed for it?`)) return;
          rows[side] = rows[side].filter(item => item !== row);
          renderCategories(); renderGrid(); update();
        });
        item.append(input, remove);
        list.append(item);
      });
    }
  }

  // ---------- Grid ----------
  let gridInputs = [], rowRefs = new Map(), head = null;
  function cellInput(month, side, row) {
    const input = el('input', '', {id:`migration-cell-${month}-${side}-${row.id}`, type:'text', inputmode:'decimal', autocomplete:'off', spellcheck:'false', class:'migration-cell',
      'aria-label':`${monthName(month)} ${month.slice(0, 4)}, ${row.label || 'unnamed category'}`});
    input.value = cells.get(month)?.[side]?.[row.id] ?? '';
    input.addEventListener('input', () => {
      const value = cells.get(month) ?? {income:{}, expenses:{}};
      value[side][row.id] = input.value;
      cells.set(month, value); edited.add(month);
      confirmations.delete(year); confirm.checked = false;
      updateRow(month); update();
    });
    input.addEventListener('blur', () => {
      const parsed = parseAmount(input.value);
      if (parsed.cents !== undefined) input.value = displayCents(parsed.cents).replace('−', '-');
      markCell(input);
    });
    input.addEventListener('keydown', event => onKey(event, input));
    return input;
  }
  function checkInput(month) {
    const input = el('input', '', {id:`migration-check-${month}`, type:'text', inputmode:'decimal', autocomplete:'off', class:'migration-cell migration-check-cell',
      'aria-label':`Workbook net worth at the start of ${monthName(month)} ${month.slice(0, 4)}`});
    input.value = checks.get(month) ?? '';
    input.addEventListener('input', () => { checks.set(month, input.value); updateChecks(); update(false); });
    input.addEventListener('keydown', event => onKey(event, input));
    return input;
  }
  function onKey(event, input) {
    if (event.key !== 'Enter') return;
    event.preventDefault?.();
    const position = gridInputs.findIndex(row => row.includes(input));
    const next = gridInputs[position + (event.shiftKey ? -1 : 1)];
    next?.[0]?.focus();
  }
  function markCell(input) {
    const parsed = parseAmount(input.value);
    if (parsed.error) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  function renderGridHead() {
    if (!head) return;
    for (const side of ['income','expenses']) rows[side].forEach((row, index) => {
      const th = head.labels[side][index];
      if (th) th.textContent = row.label.trim() || 'Unnamed';
    });
  }
  function renderGrid() {
    const months = year ? yearMonths(year, setup.last) : [];
    gridInputs = []; rowRefs = new Map();
    const table = el('table', '', {class:'migration-grid'});
    const caption = el('caption', `Monthly income and expenses for ${year}`, {class:'visually-hidden'});
    const thead = el('thead'), groups = el('tr'), labels = el('tr');
    const corner = el('th', '', {scope:'col', rowspan:'2', class:'migration-month-col'});
    corner.textContent = 'Month';
    groups.append(corner);
    head = {labels:{income:[], expenses:[]}};
    for (const [side, title, cls] of [['income','Income','migration-in'],['expenses','Expenses','migration-out']]) {
      groups.append(el('th', title, {scope:'colgroup', colspan:String(rows[side].length + 1), class:'migration-group ' + cls}));
      for (const row of rows[side]) {
        const th = el('th', row.label.trim() || 'Unnamed', {scope:'col'});
        head.labels[side].push(th); labels.append(th);
      }
      labels.append(el('th', 'Total', {scope:'col', class:'migration-total-col'}));
    }
    groups.append(el('th', 'Net worth check', {scope:'colgroup', colspan:'3', class:'migration-group'}));
    labels.append(el('th', 'Workbook, start of month', {scope:'col'}), el('th', 'App, start of month', {scope:'col'}), el('th', 'Result', {scope:'col'}));
    thead.append(groups, labels);
    const tbody = el('tbody');
    for (const month of months) {
      const tr = el('tr');
      tr.append(el('th', monthShort(month), {scope:'row', class:'migration-month-col', title:monthName(month)}));
      const inputs = [];
      const totals = {};
      for (const side of ['income','expenses']) {
        for (const row of rows[side]) {
          const td = el('td'), input = cellInput(month, side, row);
          td.append(input); tr.append(td); inputs.push(input); markCell(input);
        }
        totals[side] = el('td', '', {class:'migration-total'});
        tr.append(totals[side]);
      }
      const checkCell = el('td'), check = checkInput(month);
      checkCell.append(check); inputs.push(check);
      const expected = el('td', '', {class:'migration-expected'}), result = el('td', '', {class:'migration-result'});
      tr.append(checkCell, expected, result);
      tbody.append(tr);
      gridInputs.push(inputs);
      rowRefs.set(month, {totals, expected, result, row:tr});
    }
    table.append(caption, thead, tbody);
    gridWrap.replaceChildren(table);
    for (const month of months) updateRow(month);
    updateChecks();
  }
  function sum(month, side) {
    let total = 0n, complete = true;
    for (const row of rows[side]) {
      const parsed = parseAmount(cells.get(month)?.[side]?.[row.id]);
      if (parsed.cents === undefined) complete = false; else total += parsed.cents;
    }
    return {total, complete};
  }
  function updateRow(month) {
    const refs = rowRefs.get(month);
    if (!refs) return;
    for (const side of ['income','expenses']) {
      const {total, complete} = sum(month, side);
      refs.totals[side].textContent = complete ? displayCents(total) : '—';
      refs.totals[side].setAttribute('aria-label', complete ? displayCents(total) : 'Incomplete');
    }
  }
  let built = null;
  function updateChecks() {
    built = year ? buildYear({year, setup:setupForModel(), cells:Object.fromEntries(yearMonths(year, setup.last).map(month => [month, labelCells(month)])), worksheet:sheets[year] ?? String(year)}) : null;
    const closing = closingEstimates(ledger, built?.records ?? []);
    for (const [month, refs] of rowRefs) {
      const check = netWorthCheck({month, sheetText:checks.get(month), closing, opening:setup.opening});
      const before = closing.get(previousMonth(month));
      const expected = month === MIGRATION_START ? parseAmount(setup.opening).cents : before ? parseAmount(before.amount).cents : undefined;
      refs.expected.textContent = expected === undefined ? '—' : displayCents(expected);
      refs.result.dataset.check = check.state;
      refs.result.textContent = check.state === 'match' ? 'Matches' : check.state === 'mismatch'
        ? 'Off by ' + displayCents(check.difference < 0n ? -check.difference : check.difference)
        : check.state === 'invalid' ? 'Not an amount' : check.state === 'unavailable' ? 'Needs earlier months' : '';
    }
  }

  // ---------- Progress map and year navigation ----------
  function states() { return monthStates({savedLedger:saved, ledger, last:setup.last, drafts:edited}); }
  function checkStates() {
    const closing = closingEstimates(ledger, built?.records ?? []);
    return new Map(migrationMonths(setup.last).map(month => [month, netWorthCheck({month, sheetText:checks.get(month), closing, opening:setup.opening}).state]));
  }
  // Map and year controls are built once per month range and then updated in
  // place, so typing never replaces the control that has keyboard focus.
  let mapFor = null;
  const mapRefs = {years:new Map(), tabs:new Map()};
  function buildMap() {
    mapFor = setup.last; mapRefs.years.clear(); mapRefs.tabs.clear();
    map.replaceChildren(); yearNav.replaceChildren();
    for (const y of migrationYears(setup.last)) {
      const line = el('div', '', {class:'migration-map-year'});
      const pick = el('button', String(y), {type:'button', class:'migration-map-label'});
      pick.addEventListener('click', () => selectYear(y, true));
      const list = el('ol', '', {class:'migration-map-months', 'aria-label':`${y} months`});
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const month = `${y}-${String(m).padStart(2, '0')}`;
        const item = el('li', '', {class:'migration-map-month'}), text = el('span', '', {class:'visually-hidden'});
        item.append(el('span', monthShort(month).slice(0, 1), {'aria-hidden':'true'}), text);
        list.append(item); months.push({month, item, text});
      }
      const count = el('span', '', {class:'migration-map-count', 'aria-hidden':'true'});
      line.append(pick, list, count); map.append(line);
      mapRefs.years.set(y, {pick, months, count});
      const tab = el('button', String(y), {type:'button', class:'migration-year-tab'});
      tab.addEventListener('click', () => selectYear(y, false));
      yearNav.append(tab); mapRefs.tabs.set(y, tab);
    }
  }
  function renderMap() {
    if (mapFor !== setup.last) buildMap();
    const all = states(), byMonth = new Map(all.map(item => [item.month, item.state])), checked = checkStates();
    const savedCount = all.filter(item => item.state === 'saved').length;
    const stagedCount = all.filter(item => item.state.startsWith('staged')).length;
    const matched = [...checked.values()].filter(state => state === 'match').length;
    const mismatched = [...checked.values()].filter(state => state === 'mismatch').length;
    const extra = [stagedCount ? `${stagedCount} staged, not saved yet` : '',
      matched || mismatched ? `${matched} net-worth ${matched === 1 ? 'check matches' : 'checks match'}${mismatched ? `, ${mismatched} off` : ''}` : ''].filter(Boolean);
    progressSummary.textContent = '';
    progressSummary.replaceChildren(el('strong', `${savedCount} of ${all.length} months saved`), ...extra.map(text => el('span', ' · ' + text)));
    for (const [y, refs] of mapRefs.years) {
      const inRange = refs.months.filter(({month}) => byMonth.has(month));
      const done = inRange.filter(({month}) => byMonth.get(month) === 'saved').length;
      refs.pick.setAttribute('aria-pressed', String(y === year));
      refs.pick.setAttribute('aria-label', `${y}: ${done} of ${inRange.length} months saved. Open ${y}.`);
      refs.count.textContent = done === inRange.length ? 'Done' : `${done}/${inRange.length}`;
      for (const {month, item, text} of refs.months) {
        const state = byMonth.get(month) ?? 'out', check = checked.get(month);
        item.dataset.state = state;
        if (check === 'match' || check === 'mismatch') item.dataset.check = check; else delete item.dataset.check;
        text.textContent = state === 'out' ? `${monthName(month)}: not part of this migration`
          : `${monthName(month)}: ${STATE_TEXT[state]}${check === 'match' ? ', net worth matches' : check === 'mismatch' ? ', net worth is off' : ''}`;
      }
      mapRefs.tabs.get(y).setAttribute('aria-pressed', String(y === year));
    }
    if (homeLink) {
      homeLink.hidden = !ledger || (all.length > 0 && savedCount === all.length);
      const label = homeLink.children?.[0];
      if (label) label.textContent = savedCount ? `Finish history migration · ${savedCount} of ${all.length} months saved` : 'Migrate your old workbook';
    }
  }
  function firstOpenYear() {
    const all = states();
    return migrationYears(setup.last).find(y => yearMonths(y, setup.last).some(month => all.find(item => item.month === month)?.state !== 'saved')) ?? migrationYears(setup.last).at(-1) ?? null;
  }
  function selectYear(next, focusHeading) {
    if (!migrationYears(setup.last).includes(next)) return;
    year = next;
    sheet.value = sheets[year] ?? String(year);
    confirm.checked = confirmations.get(year)?.checked ?? false;
    reason.value = confirmations.get(year)?.reasonEdited ? confirmations.get(year).reason : '';
    stageStatus.textContent = '';
    renderGrid(); update();
    if (focusHeading) yearHeading.focus?.();
  }

  // ---------- Gating and review ----------
  function update(full = true) {
    if (!setup) return;
    if (full || !built) updateChecks();
    const problems = setupProblems(setupForModel(), ledger);
    setupStatus.replaceChildren(...problems.map(problem => el('li', problem.message)));
    setupSummary.textContent = problems.length ? 'About the old workbook · needs attention' : 'About the old workbook';
    renderMap();
    if (!year) return;
    const months = yearMonths(year, setup.last), all = new Map(states().map(item => [item.month, item.state]));
    const savedMonths = months.filter(month => all.get(month) === 'saved').length;
    yearHeading.textContent = String(year);
    yearState.textContent = savedMonths === months.length && !months.some(month => edited.has(month)) ? `All ${months.length} months saved` :
      `${savedMonths} of ${months.length} months saved` + (months.some(month => all.get(month)?.startsWith('staged')) ? ' · staged changes wait for Save' : '');
    confirmText.textContent = `I compared every month above with the ${sheets[year] ?? year} sheet.`;
    if (!confirmations.get(year)?.reasonEdited) reason.value = `Typed by hand from the ${sheets[year] ?? year} sheet of ${setup.workbook.trim() || 'the old workbook'}.`;
    const income = months.reduce((total, month) => total + sum(month, 'income').total, 0n);
    const expenses = months.reduce((total, month) => total + sum(month, 'expenses').total, 0n);
    const entered = months.filter(month => sum(month, 'income').complete && sum(month, 'expenses').complete).length;
    const closing = closingEstimates(ledger, built?.records ?? []);
    const yearChecks = months.map(month => netWorthCheck({month, sheetText:checks.get(month), closing, opening:setup.opening}).state);
    reviewTotals.replaceChildren(
      ...[['Months complete', `${entered} of ${months.length}`], ['Income', displayCents(income) + ' ' + setup.currency], ['Expenses', displayCents(expenses) + ' ' + setup.currency],
        ['Net-worth checks', `${yearChecks.filter(state => state === 'match').length} match · ${yearChecks.filter(state => state === 'mismatch').length} off · ${yearChecks.filter(state => state === 'unchecked').length} not checked`]]
        .flatMap(([term, value]) => [el('dt', term), el('dd', value)]));
    // Invalid amounts are named cell by cell. Empty cells are summarized per
    // month, so an unfinished year reads as progress rather than as errors.
    const yearIssues = (built?.problems ?? []).filter(problem => !problem.label || problem.label.trim());
    const grouped = [], untouched = [], cellCount = rows.income.length + rows.expenses.length;
    for (const month of months) {
      const blanks = yearIssues.filter(problem => problem.month === month && problem.label && parseAmount(cells.get(month)?.[problem.side]?.[rows[problem.side].find(row => row.label === problem.label)?.id]).blank);
      if (blanks.length === cellCount) untouched.push(month);
      else if (blanks.length) grouped.push(`${monthName(month)}: ${blanks.length} empty ${blanks.length === 1 ? 'cell' : 'cells'}. Enter 0 where the workbook shows nothing.`);
    }
    for (const problem of yearIssues) {
      if (problem.label && !parseAmount(cells.get(problem.month)?.[problem.side]?.[rows[problem.side].find(row => row.label === problem.label)?.id]).error) continue;
      const where = problem.month ? `${monthName(problem.month)}${problem.label ? ', ' + problem.label.trim() : ''}: ` : '';
      grouped.push(where + problem.message);
    }
    if (untouched.length) grouped.unshift(untouched.length === 1 ? `${monthName(untouched[0])} is not entered yet.`
      : `${untouched.length} months not entered yet (${monthShort(untouched[0])}–${monthShort(untouched.at(-1))}).`);
    let previewIssues = [];
    if (built?.ready) {
      try {
        const preview = previewHistoricalMonthlySummaries(ledger, built.input);
        previewIssues = preview.findings.filter(finding => !ignoredFindings.has(finding.code)).map(finding => `${finding.month ? monthName(finding.month) + ': ' : ''}${finding.code.replaceAll('-', ' ')}`);
      } catch { previewIssues = ['These figures could not be checked. Review the setup and cells.']; }
    }
    const mismatches = months.filter((month, index) => yearChecks[index] === 'mismatch');
    const shown = [...grouped.slice(0, 8), ...(grouped.length > 8 ? [`${grouped.length - 8} more cells need attention.`] : []), ...previewIssues,
      ...mismatches.map(month => `${monthName(month)}: net worth does not match the workbook. Check this and earlier months.`)];
    yearProblems.replaceChildren(...shown.map(text => el('li', text)));
    const unchanged = built?.ready && months.every(month => all.get(month) === 'saved' && !edited.has(month));
    const unavailable = getUnavailableReason();
    const blocked = staging ? 'Wait for staging to finish.' : unavailable ? unavailable : problems.length ? 'Finish “About the old workbook” first.'
      : !built?.ready ? `Fill every cell for ${year}. Enter 0 where the workbook shows nothing.` : previewIssues.length ? 'Resolve the problems listed above.'
      : unchanged ? `${year} is already saved. Edit a cell to change it.`
      : !confirm.checked ? 'Confirm that you compared this year with the workbook.' : !reason.value.trim() ? 'Add a short note.' : '';
    stage.textContent = `Stage ${year}`;
    stage.disabled = Boolean(blocked) || !isActive();
    stageHelp.textContent = blocked || (mismatches.length ? 'Some net-worth checks are off. You can still stage, but check those months first.' : `Adds ${year} to this tab’s changes. Save changes then stores it in your database.`);
    for (const inputs of gridInputs) for (const input of inputs) input.disabled = staging;
  }

  async function stageYear() {
    if (stage.disabled || !built?.ready || !isActive()) return;
    const expectedLedger = ledger, stagedYear = year, months = yearMonths(stagedYear, setup.last), note = reason.value.trim();
    staging = true; update();
    try {
      const decisions = built.input.records.map((_, recordIndex) => ({recordIndex, action:'accept', reason:note}));
      const result = await stageSummaries({input:built.input, expectedLedger, decisions});
      for (const month of months) edited.delete(month);
      confirmations.delete(stagedYear);
      const message = result === expectedLedger ? `${stagedYear} matches what is already saved. Nothing new was staged.`
        : `${stagedYear} is staged. Choose Save changes to store it in your database.`;
      staging = false;
      refresh(true);
      stageStatus.textContent = message; stageStatus.dataset.kind = 'success';
      stageStatus.focus?.();
      onStaged(message);
    } catch (error) {
      staging = false;
      stageStatus.dataset.kind = 'error';
      stageStatus.textContent = error?.code === 'operation-in-progress' ? 'Wait for the current storage action to finish.'
        : error?.code === 'reopen-before-editing' ? 'Reopen your saved data before staging.'
        : error?.code === 'stale-historical-summary-review' ? 'The workspace changed while staging. Review the year and stage it again.'
        : 'This year could not be staged. Nothing changed.';
      update();
    }
  }

  // ---------- Events ----------
  for (const [input, key] of [[workbook,'workbook'],[opening,'opening']]) input.addEventListener('input', () => { setup[key] = input.value; update(); });
  currency.addEventListener('input', () => { setup.currency = currency.value.trim().toUpperCase(); update(); });
  last.addEventListener('change', () => applyLast());
  last.addEventListener('blur', () => applyLast());
  function applyLast() {
    const value = last.value.trim();
    if (value === setup.last) return;
    setup.last = value;
    const years = migrationYears(setup.last);
    if (!years.length) { update(); return; }
    if (!years.includes(year)) year = years.at(-1);
    loadSavedCells(); renderGrid(); update();
  }
  for (const side of ['income','expenses']) categoryGroups[side].add.addEventListener('click', () => {
    rows[side].push(newRow('')); renderCategories(); renderGrid(); update();
  });
  sheet.addEventListener('input', () => { sheets[year] = sheet.value; update(); });
  confirm.addEventListener('change', () => { confirmations.set(year, {...confirmations.get(year), checked:confirm.checked, reason:reason.value}); update(); });
  reason.addEventListener('input', () => { confirmations.set(year, {...confirmations.get(year), checked:confirm.checked, reason:reason.value, reasonEdited:true}); update(false); });
  stage.addEventListener('click', stageYear);

  function clear() {
    ledger = null; saved = null; setup = null; year = null; renderedFor = null; staging = false;
    cells.clear(); edited.clear(); checks.clear(); confirmations.clear();
    for (const key of Object.keys(sheets)) delete sheets[key];
    gridWrap.replaceChildren(); yearProblems.replaceChildren(); stageStatus.textContent = '';
    progressSummary.textContent = 'Open your saved data to start or continue the migration.';
    map.replaceChildren(); yearNav.replaceChildren(); mapFor = null;
    if (homeLink) homeLink.hidden = true;
  }
  function refresh(force = false) {
    const nextLedger = getLedger();
    if (!nextLedger) { if (ledger || setup) clear(); else if (homeLink) homeLink.hidden = true; progressSummary.textContent = 'Open your saved data to start or continue the migration.'; return; }
    saved = getSavedLedger() ?? null;
    if (nextLedger === ledger && !force) { update(); return; }
    const first = !setup;
    ledger = nextLedger;
    if (first) initialSetup();
    loadSavedCells();
    if (first || renderedFor !== setup.last || year === null) { year = firstOpenYear(); renderedFor = setup.last; }
    renderAccounts(); renderCategories();
    if (year !== null) selectYear(year, false); else update();
  }
  clear();
  refresh();
  return {
    refresh: () => refresh(false),
    reset: clear,
    hasUnfinishedWork: () => edited.size > 0
  };
}
