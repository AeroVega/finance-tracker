import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {applyPlanningEvent} from '../js/planning.mjs';
import {buildBudgetReport, monthCoverage, averageOf, roundTarget} from '../js/budget-report.mjs';
import {planningLedger} from './helpers/planning-fixture.mjs';

const TODAY = '2026-11-20';
const months = ['2026-08', '2026-09', '2026-10'];
function rowsFor(month, {groceries = true} = {}) {
  const rows = [{account:'checking', date:`${month}-01`, amount:'-1000.00', kind:'spending', category:'housing'}];
  if (groceries) rows.push({account:'card', date:`${month}-05`, amount:'-100.00', kind:'spending', category:'groceries'});
  if (groceries && month !== '2026-11') rows.push({account:'card', date:`${month}-25`, amount:'-100.00', kind:'spending', category:'groceries'});
  rows.push({account:'card', date:`${month}-10`, amount:'-30.00', kind:'spending', category:'dining'});
  rows.push({account:'checking', date:`${month}-15`, amount:'2500.00', kind:'income'});
  return rows;
}
function fixture({history = months, cardNovember = '2026-11-20'} = {}) {
  const coverage = {checking:{}, card:{}};
  for (const month of history) { coverage.checking[month] = `${month}-${month === '2026-09' ? '30' : '31'}`; coverage.card[month] = coverage.checking[month]; }
  coverage.checking['2026-11'] = '2026-11-20';
  if (cardNovember) coverage.card['2026-11'] = cardNovember;
  const rows = [...history.flatMap(month => rowsFor(month)), ...rowsFor('2026-11')];
  return planningLedger({accounts:[{key:'checking', type:'checking', institution:'wells-fargo'}, {key:'card', type:'credit-card', institution:'wells-fargo'}], coverage, rows});
}
let n = 0;
const target = (ledger, categoryId, amountText, effectiveMonth = '2026-11') => applyPlanningEvent(ledger,
  {type:'budget-target', commandId:`t-${++n}`, categoryId, currency:'USD', effectiveMonth, amountText},
  {now:'2026-11-20T12:00:00.000Z', idFactory:() => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`});
function report(ledger, month = '2026-11', today = TODAY) {
  const reader = createWorkspaceViewReader(ledger);
  const view = reader.view({accountId:'', month});
  return buildBudgetReport({ledger, history:[], view, reader, month, today});
}

test('targets compare with Home’s category spending; overspend stays in its own month', () => {
  let {ledger} = fixture();
  ledger = target(target(ledger, 'groceries', '250'), 'housing', '900');
  const budget = report(ledger);
  assert.equal(budget.available, true);
  assert.equal(budget.timing, 'current');
  const groceries = budget.rows.find(row => row.categoryId === 'groceries');
  assert.deepEqual([groceries.target, groceries.actual, groceries.remaining, groceries.over], ['250.00', '100.00', '150.00', false]);
  const housing = budget.rows.find(row => row.categoryId === 'housing');
  assert.deepEqual([housing.actual, housing.remaining, housing.over], ['1000.00', '-100.00', true]);
  assert.equal(budget.overCount, 1);
  // A target starts in November, so October has no budget, and December starts fresh.
  assert.deepEqual(report(ledger, '2026-10').rows, []);
  const december = report(ledger, '2026-12');
  assert.equal(december.timing, 'future');
  assert.equal(december.rows.find(row => row.categoryId === 'housing').remaining, null);
});

test('spending without a target is one Not budgeted row, and the total line covers all spending', () => {
  let {ledger} = fixture();
  ledger = target(ledger, 'groceries', '250');
  const budget = report(ledger);
  assert.deepEqual(budget.notBudgeted.categories.map(item => [item.label, item.spending]), [['Housing', '1000.00'], ['Dining', '30.00']]);
  assert.equal(budget.notBudgeted.spending, '1030.00');
  assert.deepEqual(budget.total, {target:'250.00', budgetedSpending:'100.00', spending:'1130.00', remaining:'150.00'});
});

test('the month-end estimate follows the usual spending shape when three months have detail', () => {
  let {ledger} = fixture();
  ledger = target(target(ledger, 'groceries', '250'), 'housing', '900');
  const budget = report(ledger);
  assert.equal(budget.coverage.complete, true);
  assert.equal(budget.coverage.through, '2026-11-20');
  const groceries = budget.rows.find(row => row.categoryId === 'groceries');
  // 100 so far plus the 100 usually spent after day 20.
  assert.deepEqual([groceries.estimate.method, groceries.estimate.amount], ['history', '200.00']);
  // Rent is paid on the 1st, so nothing usually follows: the estimate is what is already spent.
  assert.equal(budget.rows.find(row => row.categoryId === 'housing').estimate.amount, '1000.00');
});

test('without three months of detail the estimate uses this month’s pace, from day 8 only', () => {
  let {ledger} = fixture({history:[]});
  ledger = target(ledger, 'groceries', '250');
  const groceries = report(ledger).rows[0];
  assert.deepEqual([groceries.estimate.method, groceries.estimate.amount], ['pace', '150.00']);
  assert.match(groceries.estimate.note, /pace/);
  const early = report(ledger, '2026-11', '2026-11-05').rows[0];
  assert.equal(early.estimate.amount, null);
  assert.match(early.estimate.note, /day 8/);
});

test('a coverage gap this month withholds the estimate and names the account', () => {
  let {ledger} = fixture({cardNovember:'2026-11-12'});
  ledger = target(ledger, 'groceries', '250');
  const budget = report(ledger);
  assert.equal(budget.coverage.complete, false);
  assert.deepEqual(budget.coverage.issues.map(issue => [issue.name, issue.kind, issue.through]), [['Invented card', 'partial', '2026-11-12']]);
  assert.equal(budget.rows[0].estimate.amount, null);
  assert.match(budget.rows[0].estimate.note, /coverage gap/);
  // Recorded spending still shows, with the warning.
  assert.equal(budget.rows[0].actual, '100.00');
  const missing = fixture({cardNovember:null}).ledger;
  assert.equal(monthCoverage(missing, '2026-11', {today:TODAY}).issues[0].kind, 'no-coverage');
});

test('suggested targets average the latest three completed months with data', () => {
  const budget = report(fixture().ledger);
  assert.deepEqual(budget.suggestions.months, ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(budget.suggestions.suggestions.map(item => [item.categoryId, item.average, item.amount, item.months]),
    [['housing', '1000.00', '1000', 3], ['groceries', '200.00', '200', 3], ['dining', '30.00', '30', 3]]);
  // With fewer months of data, the suggestion says how many it used.
  assert.equal(report(fixture({history:['2026-10']}).ledger).suggestions.suggestions[0].months, 1);
  assert.equal(report(fixture().ledger, '2026-10').suggestions, null);
});

test('exact arithmetic for averages and whole-unit suggestions', () => {
  assert.equal(averageOf(['10.00', '10.00', '10.01'], 3), '10.00');
  assert.equal(averageOf(['0.05'], 2), '0.03');
  assert.equal(roundTarget('411.50'), '412');
  assert.equal(roundTarget('0.20'), '1');
});
