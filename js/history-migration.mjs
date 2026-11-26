/* One-time manual migration of the first-generation workbook's monthly history.
   Pure model: it reads a ledger and a year of typed cells and returns the
   existing normalized v2 input. It never writes storage and never creates a
   new record type; staging goes through prepareHistoricalSummaries.
   See docs/HISTORICAL_MONTHLY_SUMMARY.md#in-app-history-migration. */
import { MANUAL_HISTORY_MAPPING, manualNetWorthEstimates } from './historical-monthly-summary-validation.mjs';

export const MIGRATION_START = '2023-01';
export const DEFAULT_SOURCE_ID = 'first-generation-workbook';
const FORMAT = 'finance-tracker-historical-monthly-summaries';
const MONTH = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const OPENING_NOTE = /^Opening net worth (-?\d+\.\d{2}) [A-Z]{3} on 2023-01-01 /;

const monthIndex = label => Number(label.slice(0, 4)) * 12 + Number(label.slice(5, 7)) - 1;
const monthLabel = index => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
export const isMonth = value => typeof value === 'string' && MONTH.test(value);
export const monthName = label => MONTH_NAMES[Number(label.slice(5, 7)) - 1];
export const monthShort = label => monthName(label).slice(0, 3);
export const previousMonth = label => monthLabel(monthIndex(label) - 1);

/** Months from January 2023 through `last`, inclusive. */
export function migrationMonths(last) {
  if (!isMonth(last) || last < MIGRATION_START) return [];
  const months = [];
  for (let index = monthIndex(MIGRATION_START); index <= monthIndex(last); index++) months.push(monthLabel(index));
  return months;
}
export function migrationYears(last) {
  return [...new Set(migrationMonths(last).map(month => Number(month.slice(0, 4))))];
}
export function yearMonths(year, last) {
  return migrationMonths(last).filter(month => month.startsWith(String(year) + '-'));
}
/** The last calendar month that has fully ended on `today`. */
/** The owner's chosen last month to migrate (2026-11-25). Still editable in setup. */
export const DEFAULT_LAST_MONTH = '2026-09';

/**
 * Parses an amount as typed or pasted from a spreadsheet: 1234.5, 1,234.50,
 * $1,234.50, -12 or (12.00). At most two decimal places; never rounded.
 * Returns {cents} for a value, {blank:true} for an empty cell, or {error:true}.
 */
export function parseAmount(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return {blank:true};
  let value = raw.replace(/\s+/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1); }
  if (value.startsWith('-')) { if (negative) return {error:true}; negative = true; value = value.slice(1); }
  value = value.replace(/^\$/, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(value)) return {error:true};
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.');
  if (whole.length > 18) return {error:true};
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return {cents: negative ? -cents : cents};
}
/**
 * An income or expense cell. The column says which way the money moved, so
 * every cell is a positive amount or 0 (owner decision, 2026-11-25). A minus
 * sign is refused rather than flipped, so a sign is never silently guessed.
 */
export function parseCellAmount(text) {
  const parsed = parseAmount(text);
  return parsed.cents !== undefined && parsed.cents < 0n ? {error:true, negative:true} : parsed;
}
export function centsToAmount(cents) {
  const negative = cents < 0n, size = negative ? -cents : cents;
  return `${negative ? '-' : ''}${size / 100n}.${String(size % 100n).padStart(2, '0')}`;
}
/** Grouped display text such as -1,234.50; the stored value stays exact. */
export function displayCents(cents) {
  const [whole, fraction] = centsToAmount(cents < 0n ? -cents : cents).split('.');
  return `${cents < 0n ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
function amountToCents(amount) {
  const parsed = typeof amount?.amount === 'string' ? parseAmount(amount.amount) : {error:true};
  return parsed.cents ?? null;
}

/** Effective accepted record per month, following the batch order rule of historical-monthly-summary.mjs. */
export function acceptedMonths(ledger) {
  const current = new Map();
  for (const batch of ledger?.historicalSummaryBatches ?? []) {
    for (const entry of batch.entries ?? []) {
      if (entry.action === 'accept') current.set(entry.record.month, {record:entry.record, batchVersion:batch.version, batchId:batch.batchId});
    }
  }
  return current;
}
const isManual = source => source?.batchVersion === 2 && source.record?.provenance?.mapping === MANUAL_HISTORY_MAPPING;

/** Setup recovered from saved manual records, so a new session resumes without retyping it. */
export function savedSetup(ledger) {
  const manual = [...acceptedMonths(ledger).values()].filter(isManual).sort((a, b) => a.record.month.localeCompare(b.record.month));
  if (!manual.length) return null;
  const first = manual[0].record, incomeLabels = [], expenseLabels = [];
  for (const {record} of manual) {
    for (const [key, labels] of [['incomeSources', incomeLabels], ['expenseCategories', expenseLabels]]) {
      for (const item of record.breakdowns?.[key]?.items ?? []) if (!labels.includes(item.label)) labels.push(item.label);
    }
  }
  const january = manual.find(item => item.record.month === MIGRATION_START)?.record;
  const opening = OPENING_NOTE.exec(january?.provenance?.cells?.netWorthSnapshot ?? '')?.[1] ?? '';
  return {
    workbook:first.provenance.workbook, sourceId:first.provenance.sourceId,
    currency:first.summary.incomeTotal?.currency ?? 'USD',
    accountIds:first.scope?.kind === 'accounts' ? [...first.scope.accountIds] : [],
    incomeLabels, expenseLabels, opening,
    sheets:Object.fromEntries(manual.map(({record}) => [record.month.slice(0, 4), record.provenance.worksheet]))
  };
}

/** Cell values for one saved month, as editable text. */
export function savedCells(record) {
  const cells = {income:{}, expenses:{}};
  for (const [key, side] of [['incomeSources', 'income'], ['expenseCategories', 'expenses']]) {
    for (const item of record?.breakdowns?.[key]?.items ?? []) {
      const cents = amountToCents(item.amount);
      cells[side][item.label] = cents === null ? '' : centsToAmount(cents);
    }
  }
  return cells;
}

function checkLabels(labels, side, problems) {
  const seen = new Set();
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    if (!key) problems.push({side, message:'Every category needs a name.'});
    else if (label.trim().length > 200) problems.push({side, message:'Category names must be 200 characters or fewer.'});
    else if (seen.has(key)) problems.push({side, message:`“${label.trim()}” is listed twice.`});
    seen.add(key);
  }
  if (!labels.length) problems.push({side, message:side === 'income' ? 'Add at least one income category.' : 'Add at least one expense category.'});
}

/** Problems with the once-per-migration setup, in plain language. */
export function setupProblems(setup, ledger) {
  const problems = [];
  if (!setup.workbook.trim()) problems.push({field:'workbook', message:'Name the old workbook, for example its file name.'});
  if (setup.workbook.trim().length > 300) problems.push({field:'workbook', message:'Keep the workbook name under 300 characters.'});
  if (!/^[A-Z]{3}$/.test(setup.currency)) problems.push({field:'currency', message:'Use a three-letter currency code such as USD.'});
  if (!isMonth(setup.last) || setup.last < MIGRATION_START) problems.push({field:'last', message:'Choose the last month to migrate, January 2023 or later.'});
  const known = new Set((ledger?.accounts ?? []).map(account => account.accountId));
  if (!setup.accountIds.length) problems.push({field:'accounts', message:'Choose the accounts the old workbook tracked, so imported CSVs can replace these months later.'});
  else if (setup.accountIds.some(id => !known.has(id))) problems.push({field:'accounts', message:'A selected account is no longer in this ledger. Choose the accounts again.'});
  checkLabels(setup.incomeLabels, 'income', problems);
  checkLabels(setup.expenseLabels, 'expenses', problems);
  return problems;
}

/**
 * Builds the v2 normalized input for one calendar year from typed cells.
 * `cells` maps month → {income:{label:text}, expenses:{label:text}}.
 * January 2023 stores its closing net worth: the workbook's opening figure
 * (midnight, January 1) plus January income minus January expenses, which is
 * the workbook's own formula. No later net-worth value is stored.
 */
export function buildYear({year, setup, cells, worksheet}) {
  const months = yearMonths(year, setup.last), problems = [], records = [];
  const currency = setup.currency, sheet = String(worksheet ?? '').trim();
  if (!sheet) problems.push({field:'worksheet', message:'Name the worksheet these figures come from.'});
  else if (sheet.length > 200) problems.push({field:'worksheet', message:'Keep the worksheet name under 200 characters.'});
  let openingCents = null;
  if (months.includes(MIGRATION_START)) {
    const opening = parseAmount(setup.opening);
    if (opening.cents === undefined) problems.push({field:'opening', month:MIGRATION_START, message:opening.blank
      ? 'Enter the workbook’s opening net worth for January 1, 2023.' : 'The opening net worth is not a valid amount.'});
    else openingCents = opening.cents;
  }
  for (const month of months) {
    const totals = {}, breakdowns = {};
    let complete = true;
    for (const [side, labels, totalKey, partKey] of [
      ['income', setup.incomeLabels, 'incomeTotal', 'incomeSources'],
      ['expenses', setup.expenseLabels, 'expenseTotal', 'expenseCategories']]) {
      let total = 0n;
      const items = [];
      for (const label of labels) {
        const parsed = parseCellAmount(cells?.[month]?.[side]?.[label]);
        if (parsed.cents === undefined) {
          complete = false;
          problems.push({month, side, label, message:parsed.blank ? 'Empty. Enter 0 if nothing was recorded.'
            : parsed.negative ? `Remove the minus sign. ${side === 'income' ? 'Income columns are money in' : 'Expense columns are money out'}, so every amount is positive.`
            : 'Not a valid amount.'});
          continue;
        }
        total += parsed.cents;
        items.push({label:label.trim(), amount:{amount:centsToAmount(parsed.cents), currency}});
      }
      totals[totalKey] = total;
      breakdowns[partKey] = {complete:true, items};
    }
    if (!complete || !sheet) continue;
    const summary = {
      incomeTotal:{amount:centsToAmount(totals.incomeTotal), currency},
      expenseTotal:{amount:centsToAmount(totals.expenseTotal), currency}
    };
    const provenance = {workbook:setup.workbook.trim(), worksheet:sheet, mapping:MANUAL_HISTORY_MAPPING, sourceId:setup.sourceId};
    if (month === MIGRATION_START) {
      if (openingCents === null) continue;
      summary.netWorthSnapshot = {amount:centsToAmount(openingCents + totals.incomeTotal - totals.expenseTotal), currency};
      provenance.snapshotAsOf = '2023-01-31';
      provenance.cells = {netWorthSnapshot:`Opening net worth ${centsToAmount(openingCents)} ${currency} on 2023-01-01 plus January 2023 income minus expenses, as the workbook computes it`};
    }
    records.push({month, summary, breakdowns, provenance,
      scope:setup.accountIds.length ? {kind:'accounts', accountIds:[...setup.accountIds].sort()} : {kind:'unknown'}});
  }
  const input = months.length ? {format:FORMAT, version:2,
    expectedMonthRange:{start:months[0], end:months.at(-1)}, records} : null;
  return {months, records, problems, input, ready:Boolean(input) && !problems.length && records.length === months.length};
}

/**
 * Closing net-worth estimates for every month, from saved manual months with
 * this year's draft records laid over them. January 2023 is the anchor.
 */
export function closingEstimates(ledger, draftRecords = []) {
  const sources = new Map([...acceptedMonths(ledger)].filter(([, source]) => isManual(source)));
  for (const record of draftRecords) sources.set(record.month, {record, batchVersion:2});
  const estimates = manualNetWorthEstimates(sources);
  const anchor = sources.get(MIGRATION_START)?.record.summary.netWorthSnapshot;
  const closing = new Map();
  if (anchor) closing.set(MIGRATION_START, anchor);
  for (const [month, value] of estimates) closing.set(month, value);
  return closing;
}

/**
 * Compares the workbook's net-worth figure for the start of `month` with the
 * app's closing estimate for the month before. A match confirms that every
 * income and expense total up to that point was typed as the workbook has it.
 */
export function netWorthCheck({month, sheetText, closing, opening}) {
  const sheet = parseAmount(sheetText);
  if (sheet.blank) return {state:'unchecked'};
  if (sheet.cents === undefined) return {state:'invalid'};
  const expectedValue = month === MIGRATION_START ? parseAmount(opening).cents : amountToCents(closing.get(previousMonth(month)));
  if (expectedValue === undefined || expectedValue === null) return {state:'unavailable', sheet:sheet.cents};
  const difference = sheet.cents - expectedValue;
  return {state:difference === 0n ? 'match' : 'mismatch', sheet:sheet.cents, expected:expectedValue, difference};
}

/** Per-month progress for the completeness map. */
export function monthStates({savedLedger, ledger, last, drafts}) {
  const saved = acceptedMonths(savedLedger), current = acceptedMonths(ledger);
  return migrationMonths(last).map(month => {
    const now = current.get(month), before = saved.get(month);
    const same = now && before && JSON.stringify(now.record) === JSON.stringify(before.record);
    let state = 'empty';
    if (now && !isManual(now)) state = 'other';
    else if (now && same) state = 'saved';
    else if (now) state = 'staged';
    if (drafts.has(month)) state = state === 'empty' ? 'draft' : state + '-edited';
    return {month, state};
  });
}
