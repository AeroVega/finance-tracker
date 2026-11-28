import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryCatalog} from '../js/category-catalog.mjs';
import {buildPeriodReport, evidenceBasis, resolveMonth, periodBounds, stepPeriod, periodKind, currentMonth, NOT_BROKEN_DOWN, NO_CATEGORY} from '../js/home-period-report.mjs';

const first = {accountId:'invented-checking',displayName:'Invented checking',currency:'USD'};
const second = {accountId:'invented-savings',displayName:'Invented savings',currency:'USD'};
const view = (months = ['2025-03'], accountId = '', accounts = [first, second]) => ({accounts, months, scope:{accountId, month:''}});
const aggregate = {kind:'aggregate'};
const money = (amount, currency = 'USD') => ({amount, currency});
const row = (month, {currency = 'USD', expenseCurrency = currency, scope = aggregate, sourceId = 'invented-source', report = null,
  income = '100.012300', expense = '0.00', categories = null} = {}) => ({
  month, source:report ? 'transactions' : 'workbook', report, record:{scope,
    summary:{incomeTotal:money(income, currency), expenseTotal:money(expense, expenseCurrency)},
    ...(categories ? {breakdowns:{expenseCategories:{complete:false, items:categories.map(([label, amount]) => ({label, amount:money(amount, currency)}))}}} : {}),
    provenance:{workbook:'Invented.xlsx',worksheet:'H',mapping:'v1',sourceId}}
});
// Invented transaction months: groceries and an uncategorized purchase.
const reader = (months = {}) => ({
  catalog:categoryCatalog({}),
  monthlyReport({month}) { return months[month] ?? {income:null, spending:null, cash:null}; },
  spendingByCategory({month}) { return months[month]?.categories ?? []; },
});
const mustNotReadTransactions = {monthlyReport() { assert.fail('Do not read transactions for a history month'); },
  spendingByCategory() { assert.fail('Do not read transactions for a history month'); }};

test('history months keep their own source; currencies and unrelated scopes never combine', () => {
  const scope = {kind:'accounts',accountIds:[first.accountId]};
  const history = [row('2024-10',{scope,sourceId:'other',currency:'EUR'}), row('2024-12',{scope:{kind:'accounts',accountIds:[second.accountId]}}),
    row('2025-01',{scope}), row('2025-03',{scope,report:{income:'90000000000000001.234',spending:'5.00',currency:'USD'}})];
  const basis = evidenceBasis({history, view:view()});
  assert.equal(basis.currency, 'USD');
  assert.match(basis.context, /Invented checking/);
  const january = resolveMonth({basis, reader:mustNotReadTransactions}, '2025-01');
  assert.deepEqual([january.source, january.income, january.spending], ['Workbook-reported summary', '100.012300', '0.00']);
  assert.equal(resolveMonth({basis, reader:mustNotReadTransactions}, '2024-10').income, null, 'another currency is not comparable');
  const reconciled = resolveMonth({basis, reader:reader({'2025-03':{categories:[{categoryId:'groceries', spending:'5.00', count:2}]}})}, '2025-03');
  assert.equal(reconciled.source, 'Reconciled transaction detail');
  assert.equal(reconciled.income, '90000000000000001.234', 'exact values are never rounded');
  assert.deepEqual(reconciled.categories.map(c => [c.label, c.spending, c.count]), [['Groceries', '5.00', 2]]);
  const unknown = history.map(item => ({...item, record:{...item.record, scope:{kind:'unknown'}}}));
  const unknownBasis = evidenceBasis({history:unknown, view:view()});
  assert.equal(resolveMonth({basis:unknownBasis, reader:mustNotReadTransactions}, '2025-01').source, 'Different currency or coverage');
  assert.match(evidenceBasis({history:[row('2025-03',{expenseCurrency:'EUR'})], view:view()}).context, /different currencies/);
  assert.match(evidenceBasis({history:[], view:view([], '', [first, {...second, currency:'EUR'}])}).context, /Different currencies are not combined/);
});

test('a month without a history summary uses imported activity, labelled partial; an empty month is a gap, not zero', () => {
  const basis = evidenceBasis({history:[row('2025-01')], view:view()});
  const transactions = reader({'2025-02':{income:'10.00', spending:'4.50', cash:'5.50', categories:[{categoryId:'', spending:'4.50', count:1}]}});
  const february = resolveMonth({basis, reader:transactions}, '2025-02');
  assert.deepEqual([february.source, february.income, february.spending, february.cash], ['Known transactions · possibly incomplete', '10.00', '4.50', '5.50']);
  assert.deepEqual(february.categories.map(c => [c.key, c.label]), [[NO_CATEGORY, 'No category']]);
  const march = resolveMonth({basis, reader:transactions}, '2025-03');
  assert.deepEqual([march.source, march.income, march.spending], ['No eligible transaction data', null, null]);
});

test('a year sums one source per month and merges categories by name across workbook and transactions', () => {
  const history = [row('2025-01', {income:'1000.00', expense:'600.00', categories:[['Groceries', '200.00'], ['Daily living', '300.00']]}),
    row('2025-02', {income:'1000.00', expense:'500.00', categories:[['groceries', '150.00'], ['Daily living', '350.00']]})];
  const transactions = reader({'2025-03':{income:'800.00', spending:'90.00', cash:'710.00',
    categories:[{categoryId:'groceries', spending:'60.00', count:3}, {categoryId:'dining', spending:'30.00', count:1}]}});
  const report = buildPeriodReport({history, view:view(['2025-03']), reader:transactions, period:'2025', today:'2025-03'});
  assert.deepEqual(report.rows.map(r => r.month), ['2025-01', '2025-02', '2025-03'], 'a year in progress ends at the current month');
  assert.deepEqual([report.summary.income, report.summary.spending, report.summary.cash], ['2800.00', '1190.00', '710.00']);
  assert.equal(report.summary.cashMonths, 1, 'workbook months have no cash detail');
  assert.deepEqual(report.summary.sources, [{tag:'Reported', count:2}, {tag:'Partial', count:1}]);
  const categories = Object.fromEntries(report.summary.categories.map(c => [c.key, c]));
  assert.equal(categories.groceries.spending, '410.00', 'workbook "Groceries", "groceries" and the app category merge');
  assert.equal(categories.groceries.categoryId, 'groceries', 'the merged row keeps the app category for Activity');
  assert.equal(categories.groceries.count, 3);
  assert.equal(categories.groceries.workbookMonths, 2);
  assert.equal(categories['daily living'].spending, '650.00');
  assert.equal(categories[NOT_BROKEN_DOWN].spending, '100.00', 'the unallocated workbook total stays visible, never dropped');
  assert.equal(report.summary.categories.reduce((n, c) => n + Number(c.spending), 0), 1190, 'categories account for all spending');
  assert.equal(report.slots.get('daily living'), 1, 'colour slots follow lifetime size');
});

test('comparisons need data in every matching month; a gap makes them unavailable rather than smaller', () => {
  const transactions = reader({'2025-02':{income:'50.00', spending:'20.00'}, '2025-03':{income:'80.00', spending:'25.00'},
    '2024-03':{income:'70.00', spending:'30.00'}});
  const march = buildPeriodReport({history:[], view:view(['2025-03', '2025-02', '2024-03']), reader:transactions, period:'2025-03', today:'2025-03'});
  assert.equal(march.comparison.available, true);
  assert.deepEqual([march.comparison.summary.income, march.comparison.summary.spending], ['50.00', '20.00']);
  const year = buildPeriodReport({history:[], view:view(['2025-03', '2025-02', '2024-03']), reader:transactions, period:'2025', today:'2025-03'});
  assert.deepEqual(year.comparison.months, ['2024-02', '2024-03'], 'the same data months one year earlier');
  assert.equal(year.comparison.available, false, 'February 2024 has no data');
  const lifetime = buildPeriodReport({history:[], view:view(['2025-03', '2025-02', '2024-03']), reader:transactions, period:'', today:'2025-03'});
  assert.equal(lifetime.comparison, null);
  assert.deepEqual(lifetime.trend.columns.map(c => [c.key, c.dataMonths, c.months]), [['2024', 1, 12], ['2025', 2, 3]]);
});

test('an empty current month offers the latest earlier month with data', () => {
  const report = buildPeriodReport({history:[], view:view(['2025-01']), reader:reader({'2025-01':{income:'1.00', spending:'1.00'}}), period:'2025-04', today:'2025-04'});
  assert.equal(report.summary.dataMonths, 0);
  assert.equal(report.latestWithData, '2025-01');
  assert.deepEqual(report.trend.columns.map(c => c.key), ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03', '2025-04']);
});

test('period bounds and steps stay between the first evidence and the later of today and the last evidence', () => {
  const basis = evidenceBasis({history:[row('2023-01')], view:view()});
  const bounds = periodBounds({basis, view:view(['2025-03']), today:'2026-11'});
  assert.deepEqual(bounds, {first:'2023-01', last:'2026-11'});
  assert.equal(stepPeriod('2023-01', -1, bounds), null);
  assert.equal(stepPeriod('2026-10', 1, bounds), '2026-11');
  assert.equal(stepPeriod('2026', 1, bounds), null);
  assert.equal(stepPeriod('2024', -1, bounds), '2023');
  assert.equal(stepPeriod('', 1, bounds), null);
  assert.deepEqual(['', '2025', '2025-03'].map(periodKind), ['lifetime', 'year', 'month']);
  assert.equal(currentMonth(new Date(2026, 10, 30, 23, 30)), '2026-11', 'the local month, not UTC');
});
