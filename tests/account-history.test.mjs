import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
import {applyPositionEvent, buildAccountMonthCoverage} from '../js/financial-position.mjs';
import {coverageMonths, monthEnd, coverageState, buildCoverageHistory, mostUrgentMonth, balanceObservations,
  institutionCoverage, stripPosition} from '../js/account-history.mjs';

const fixture = await createSyntheticFinancialPosition();
let sequence = 0;
const options = {now:() => '2025-02-02T00:00:00.000Z', idFactory:() => `f17e0003-2025-4000-8000-${String(++sequence).padStart(12, '0')}`};
const stage = (ledger, command) => applyPositionEvent(ledger, {...command, commandId:`invented-history-${++sequence}`}, options);

test('the window is twelve calendar months ending with the as-of month', () => {
  assert.deepEqual(coverageMonths('2025-01-31'), ['2024-02','2024-03','2024-04','2024-05','2024-06','2024-07','2024-08','2024-09','2024-10','2024-11','2024-12','2025-01']);
  assert.deepEqual(coverageMonths('2024-03-01', 3), ['2024-01', '2024-02', '2024-03']);
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(monthEnd('2025-12'), '2025-12-31');
  assert.throws(() => coverageMonths('2025-02-30'), {name:'AppError', code:'invalid-position-as-of'});
});

test('coverage cells come from the calculated account-month result, never a stored flag', () => {
  const history = buildCoverageHistory(fixture.ledger, {asOf:fixture.asOf});
  for (const account of fixture.ledger.accounts) {
    const cells = history.byAccount.get(account.accountId);
    assert.equal(cells.length, 12);
    for (const cell of cells) {
      const item = buildAccountMonthCoverage(fixture.ledger, {month:cell.month, accountIds:[account.accountId]}).accounts[0];
      assert.equal(cell.state, coverageState(item));
      assert.deepEqual(cell.reasons, item.reasons);
    }
  }
  const state = key => history.byAccount.get(fixture.accounts[key]).at(-1).state;
  assert.equal(state('checking'), 'reconciled');
  assert.equal(state('savings'), 'reconciled');
  // A dated balance alone is not coverage: investment and loan January history stays unknown.
  for (const key of ['brokerage', 'mortgage', 'autoLoan']) assert.equal(state(key), 'none');
  assert.ok(history.byAccount.get(fixture.accounts.checking).slice(0, 11).every(cell => cell.state === 'none'), 'months before any evidence are no data, not zero');
});

test('state mapping separates procedural gaps from problems that need a fix', () => {
  const base = {complete:false, declared:false, observed:false, reasons:[]};
  assert.equal(coverageState({...base, complete:true}), 'reconciled');
  assert.equal(coverageState({...base, reasons:['reconciliation-required', 'missing-declared-coverage']}), 'none');
  assert.equal(coverageState({...base, declared:true, reasons:['reconciliation-required']}), 'declared');
  assert.equal(coverageState({...base, declared:true, observed:true, reasons:['reconciliation-required']}), 'imported');
  assert.equal(coverageState({...base, observed:true, reasons:['reconciliation-required', 'pending-activity']}), 'needs-fix');
  assert.equal(coverageState({...base, reasons:['balance-discrepancy']}), 'needs-fix');
});

test('the partial as-of month is marked and a stale balance never fills later months', () => {
  const history = buildCoverageHistory(fixture.ledger, {asOf:'2025-03-15'});
  const cells = history.byAccount.get(fixture.accounts.checking);
  assert.equal(cells.at(-1).month, '2025-03');
  assert.equal(cells.at(-1).partial, true);
  assert.equal(cells.at(-2).partial, false);
  assert.deepEqual(cells.slice(-2).map(cell => cell.state), ['none', 'none'], 'February and March have no evidence');
});

test('the first month opened is the latest fix, then the latest gap since evidence began', () => {
  const cell = (month, state) => ({month, state});
  assert.equal(mostUrgentMonth([cell('a', 'none'), cell('b', 'needs-fix'), cell('c', 'imported'), cell('d', 'reconciled')]), 'b');
  assert.equal(mostUrgentMonth([cell('a', 'none'), cell('b', 'reconciled'), cell('c', 'none'), cell('d', 'reconciled')]), 'c');
  assert.equal(mostUrgentMonth([cell('a', 'none'), cell('b', 'none')]), 'b');
  assert.equal(mostUrgentMonth([cell('a', 'reconciled'), cell('b', 'reconciled')]), 'b');
  assert.equal(mostUrgentMonth([]), null);
});

test('observations are dated points; a same-date conflict has no value until resolved', () => {
  const checking = fixture.accounts.checking;
  assert.deepEqual(balanceObservations(fixture.ledger, checking, {from:'2024-02-01', to:'2025-01-31'}).map(item => [item.date, item.amountText, item.conflict]),
    [['2024-12-31', '1000.00', false], ['2025-01-31', '2200.00', false]]);
  assert.deepEqual(balanceObservations(fixture.ledger, checking, {from:'2025-01-01', to:'2025-01-30'}), [], 'the window bounds are inclusive dates');
  let ledger = stage(fixture.ledger, {type:'balance-snapshot', accountId:checking, effectiveDate:'2025-01-31', amountText:'2300.00', basis:'statement',
    source:{kind:'statement', reference:'INVENTED corrected statement'}});
  let [, latest] = balanceObservations(ledger, checking, {from:'2024-02-01', to:'2025-01-31'});
  assert.equal(latest.conflict, true); assert.equal(latest.amountText, null); assert.equal(latest.candidateCount, 2);
  ledger = stage(ledger, {type:'balance-resolution', accountId:checking, effectiveDate:'2025-01-31', selectedEventId:latest.eventIds[1],
    candidateEventIds:latest.eventIds, reason:'INVENTED corrected statement supersedes'});
  [, latest] = balanceObservations(ledger, checking, {from:'2024-02-01', to:'2025-01-31'});
  assert.equal(latest.conflict, false); assert.equal(latest.amountText, '2300.00');
  // A balance after the as-of date never appears.
  ledger = stage(ledger, {type:'balance-snapshot', accountId:checking, effectiveDate:'2025-02-28', amountText:'1.00', basis:'manual', source:{kind:'manual', reference:'INVENTED later'}});
  assert.equal(balanceObservations(ledger, checking, {from:'2024-02-01', to:'2025-01-31'}).length, 2);
});

test('institution coverage reports how far declared imports reach, not when files were read', () => {
  const coverage = institutionCoverage(fixture.ledger);
  assert.deepEqual(coverage.get('wells-fargo'), {through:'2025-01-31', runs:2});
  assert.deepEqual(coverage.get('sofi'), {through:'2025-01-31', runs:1});
  assert.equal(coverage.has('fidelity'), false, 'balances alone are not imports');
});

test('strip positions align each date with its month column', () => {
  const months = coverageMonths('2025-01-31');
  assert.equal(stripPosition(months, '2024-01-31'), null);
  assert.ok(Math.abs(stripPosition(months, '2024-02-01') - (0.5 / 29) / 12) < 1e-9);
  assert.ok(stripPosition(months, '2025-01-31') < 1 && stripPosition(months, '2025-01-31') > 11 / 12);
});
