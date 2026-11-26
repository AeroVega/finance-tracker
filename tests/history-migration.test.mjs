import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, registerAccount } from '../js/canonical-import.mjs';
import { prepareHistoricalSummaries, previewHistoricalMonthlySummaries, getHistoricalMonthlySummaryView } from '../js/historical-monthly-summary.mjs';
import {
  buildYear, closingEstimates, lastCompleteMonth, migrationMonths, monthStates, netWorthCheck,
  parseAmount, savedCells, savedSetup, setupProblems, centsToAmount
} from '../js/history-migration.mjs';

// Invented accounts, labels and amounts only.
const base = () => registerAccount(registerAccount(createLedger({syntheticOnly:true}),
  {accountId:'11111111-1111-4111-8111-111111111111', institutionId:'wells-fargo', displayName:'Invented checking', currency:'USD', accountType:'checking'}),
  {accountId:'22222222-2222-4222-8222-222222222222', institutionId:'sofi', displayName:'Invented card', currency:'USD', accountType:'credit-card'});
const setup = (extra = {}) => ({workbook:'Invented finances.xlsx', sourceId:'first-generation-workbook', currency:'USD', last:'2024-02',
  accountIds:['22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111'],
  incomeLabels:['Invented pay'], expenseLabels:['Invented housing','Invented food'], opening:'10,000.00', ...extra});
const month = (pay, housing, food) => ({income:{'Invented pay':pay}, expenses:{'Invented housing':housing, 'Invented food':food}});
const year2023 = () => Object.fromEntries(migrationMonths('2023-12').map((label, index) => [label, month('3000', '1200.50', String(400 + index))]));
const stageYear = (ledger, built, reason = 'Typed from the invented sheet') => prepareHistoricalSummaries(ledger,
  {input:built.input, decisions:built.input.records.map((_, recordIndex) => ({recordIndex, action:'accept', reason}))});

test('amounts typed or pasted from a spreadsheet keep exact cents and reject ambiguity', () => {
  for (const [text, cents] of [['1234.5', 123450n], ['1,234.50', 123450n], ['$1,234.50', 123450n], ['-12', -1200n], ['(12.00)', -1200n], ['0', 0n], [' 7.05 ', 705n]]) {
    assert.equal(parseAmount(text).cents, cents, text);
  }
  assert.deepEqual(parseAmount('  '), {blank:true});
  for (const text of ['1.234', '12,34', '1e3', '--1', '(-1)', 'abc', '1,2345.00', '$-1']) assert.deepEqual(parseAmount(text), {error:true}, text);
  assert.equal(centsToAmount(-5n), '-0.05');
  assert.equal(lastCompleteMonth(new Date(2026, 10, 25)), '2026-10');
  assert.equal(lastCompleteMonth(new Date(2027, 0, 3)), '2026-12');
});

test('a typed year becomes the existing v2 input with category totals, account scope and the January closing anchor', () => {
  const built = buildYear({year:2023, setup:setup(), cells:year2023(), worksheet:'2023'});
  assert.equal(built.ready, true);
  assert.deepEqual(built.input.expectedMonthRange, {start:'2023-01', end:'2023-12'});
  const [january, february] = built.input.records;
  assert.deepEqual(january.summary, {incomeTotal:{amount:'3000.00', currency:'USD'}, expenseTotal:{amount:'1600.50', currency:'USD'},
    netWorthSnapshot:{amount:'11399.50', currency:'USD'}});
  assert.equal(january.provenance.snapshotAsOf, '2023-01-31');
  assert.match(january.provenance.cells.netWorthSnapshot, /^Opening net worth 10000.00 USD on 2023-01-01 /);
  assert.equal(february.summary.netWorthSnapshot, undefined, 'later months never store net worth');
  assert.deepEqual(january.breakdowns.expenseCategories, {complete:true, items:[
    {label:'Invented housing', amount:{amount:'1200.50', currency:'USD'}}, {label:'Invented food', amount:{amount:'400.00', currency:'USD'}}]});
  assert.deepEqual(january.scope, {kind:'accounts', accountIds:['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']});
  const preview = previewHistoricalMonthlySummaries(base(), built.input);
  assert.deepEqual(preview.findings, []);
  assert.ok(preview.rows.every(row => row.eligible));
});

test('blank cells block a year, an explicit zero does not, and setup problems are named', () => {
  const cells = year2023();
  cells['2023-05'].expenses['Invented food'] = '';
  cells['2023-06'].expenses['Invented food'] = '0';
  const built = buildYear({year:2023, setup:setup(), cells, worksheet:'2023'});
  assert.equal(built.ready, false);
  assert.deepEqual(built.problems.map(item => [item.month, item.label]), [['2023-05', 'Invented food']]);
  assert.equal(buildYear({year:2023, setup:setup({opening:''}), cells:year2023(), worksheet:'2023'}).ready, false);
  assert.equal(buildYear({year:2023, setup:setup(), cells:year2023(), worksheet:' '}).ready, false);
  const problems = setupProblems(setup({workbook:'', accountIds:[], expenseLabels:['Food','food'], currency:'usd'}), base());
  assert.deepEqual(problems.map(item => item.field ?? item.side), ['workbook', 'currency', 'accounts', 'expenses']);
  assert.deepEqual(setupProblems(setup(), base()), []);
});

test('net-worth checks compare the workbook’s start-of-month figure with the app’s estimate across saved years', async () => {
  let ledger = base();
  const first = buildYear({year:2023, setup:setup(), cells:year2023(), worksheet:'2023'});
  // Before staging, draft records drive the estimate.
  let closing = closingEstimates(ledger, first.records);
  assert.equal(netWorthCheck({month:'2023-01', sheetText:'10000', closing, opening:'10,000.00'}).state, 'match');
  assert.equal(netWorthCheck({month:'2023-02', sheetText:'11,399.50', closing, opening:'10000'}).state, 'match');
  const off = netWorthCheck({month:'2023-03', sheetText:'12000', closing, opening:'10000'});
  assert.equal(off.state, 'mismatch');
  assert.equal(centsToAmount(off.difference), '-798.00'); // February closing: 11399.50 + 3000 − 1601.50 = 12798.00.
  assert.equal(netWorthCheck({month:'2023-04', sheetText:'', closing, opening:'10000'}).state, 'unchecked');
  ledger = stageYear(ledger, first);
  const second = buildYear({year:2024, setup:setup(), cells:{'2024-01':month('3100', '1250', '500'), '2024-02':month('3100', '1250', '510')}, worksheet:'2024'});
  closing = closingEstimates(ledger, second.records);
  const december = closing.get('2023-12').amount;
  assert.equal(netWorthCheck({month:'2024-01', sheetText:december, closing, opening:'10000'}).state, 'match');
  ledger = stageYear(ledger, second);
  const view = await getHistoricalMonthlySummaryView(ledger);
  assert.equal(view.length, 14);
  assert.equal(view.find(row => row.month === '2024-02').netWorthEstimate.amount, closing.get('2024-02').amount);
  assert.ok(view.every(row => row.source === 'manual'), 'CSV detail replaces months only after explicit reconciliation');
});

test('saved setup and cells resume a migration, and month states separate saved, staged and typed months', () => {
  const first = buildYear({year:2023, setup:setup({last:'2023-12'}), cells:year2023(), worksheet:'Sheet 2023'});
  const savedLedger = stageYear(base(), first);
  const restored = savedSetup(savedLedger);
  assert.deepEqual(restored, {workbook:'Invented finances.xlsx', sourceId:'first-generation-workbook', currency:'USD',
    accountIds:['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],
    incomeLabels:['Invented pay'], expenseLabels:['Invented housing','Invented food'], opening:'10000.00', sheets:{2023:'Sheet 2023'}});
  assert.deepEqual(savedCells(first.input.records[2]), {income:{'Invented pay':'3000.00'}, expenses:{'Invented housing':'1200.50', 'Invented food':'402.00'}});
  const changed = year2023(); changed['2023-03'].income['Invented pay'] = '3001';
  const staged = stageYear(savedLedger, buildYear({year:2023, setup:setup({last:'2023-12'}), cells:changed, worksheet:'Sheet 2023'}));
  const states = monthStates({savedLedger, ledger:staged, last:'2024-01', drafts:new Set(['2023-04', '2024-01'])});
  assert.deepEqual(states.slice(1, 4).map(item => item.state), ['saved', 'staged', 'saved-edited']);
  assert.equal(states.at(-1).state, 'draft');
  assert.equal(monthStates({savedLedger:null, ledger:base(), last:'2023-02', drafts:new Set()})[0].state, 'empty');
  assert.equal(savedSetup(base()), null);
});

test('a private-database session can stage the migration like any other edit, and class mixing still fails closed', async () => {
  const { CanonicalWorkspaceSession } = await import('../js/canonical-workspace-session.mjs');
  const privateLedger = registerAccount(createLedger({dataClass:'production'}),
    {accountId:'11111111-1111-4111-8111-111111111111', institutionId:'wells-fargo', displayName:'Invented checking', currency:'USD', accountType:'checking'});
  const session = new CanonicalWorkspaceSession({storage:{dataClass:'production', lifecycle:null}});
  session.preview(privateLedger);
  const built = buildYear({year:2023, setup:setup({last:'2023-02', accountIds:['11111111-1111-4111-8111-111111111111']}),
    cells:{'2023-01':month('1', '1', '1'), '2023-02':month('2', '1', '0')}, worksheet:'2023'});
  const staged = session.stageHistoricalSummaries({expectedLedger:session.ledger, input:built.input,
    decisions:built.input.records.map((_, recordIndex) => ({recordIndex, action:'accept', reason:'Invented private review'}))});
  assert.equal(staged.historicalSummaryBatches.length, 1);
  assert.deepEqual([staged.version, staged.dataClass, 'syntheticOnly' in staged], [3, 'production', false], 'the private header is preserved');
  const { validateProductionLedger } = await import('../js/canonical-import.mjs');
  assert.equal(validateProductionLedger(staged), true);
  const { assertCanonicalLedgerTransition } = await import('../js/canonical-history.mjs');
  assert.doesNotThrow(() => assertCanonicalLedgerTransition(privateLedger, staged), 'a verified save accepts this private transition');
  assert.equal(session.dirty, true);
  const synthetic = new CanonicalWorkspaceSession({storage:{dataClass:'synthetic', lifecycle:null}});
  assert.throws(() => synthetic.preview(privateLedger), {code:'data-class-mismatch'});
});
