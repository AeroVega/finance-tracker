import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
import {buildFinancialPosition,buildAccountMonthCoverage} from '../js/financial-position.mjs';
import {summarizeLedgerPeriods,validateLedger} from '../js/canonical-import.mjs';

const fixture = await createSyntheticFinancialPosition();
test('invented position recipe is deterministic and source-backed with exact independent totals', async () => {
  assert.deepEqual(await createSyntheticFinancialPosition(), fixture);
  assert.equal(validateLedger(fixture.ledger), true);
  const position = buildFinancialPosition(fixture.ledger,{asOf:fixture.asOf});
  assert.equal(position.complete,true);
  assert.deepEqual(position.currencies[0],{currency:'USD',knownAssets:'9700.00',knownLiabilities:'107300.00',
    knownNetWorth:'-97600.00',netWorth:'-97600.00',complete:true,reasons:[]});
  const brokerage = position.accounts.find(account => account.accountId===fixture.accounts.brokerage);
  assert.equal(brokerage.holdings.total,'5000.00');
  assert.equal(brokerage.holdings.scope,'complete');
  assert.deepEqual(brokerage.holdings.reasons,[]);
  assert.ok(fixture.ledger.positionEvents.every(event => event.source?.reference.startsWith('INVENTED')));
  assert.ok(fixture.ledger.activities.every(activity => activity.sourceDescription.startsWith('INVENTED')));
});

test('invented scenario reconciles cash and card only and never mistakes dated debts for activity coverage', () => {
  const coverage = buildAccountMonthCoverage(fixture.ledger,{month:fixture.month});
  assert.equal(coverage.complete,false);
  for (const key of ['checking','savings','card']) {
    const account = coverage.accounts.find(value=>value.accountId===fixture.accounts[key]);
    assert.equal(account.state,'reconciled-complete');assert.equal(account.discrepancy,'0.00');
  }
  for (const key of ['brokerage','mortgage','autoLoan']) {
    const account = coverage.accounts.find(value=>value.accountId===fixture.accounts[key]);
    assert.equal(account.complete,false);assert.ok(account.reasons.includes('reconciliation-required'));
  }
  const [report]=summarizeLedgerPeriods(fixture.ledger,[{start:'2025-01-01',end:'2025-01-31',currency:'USD'}]);
  assert.equal(report.income,'2000.00');assert.equal(report.spending,'300.00');
});

test('invented position uses latest known dates and withholds unknown and stale complete totals', () => {
  const missing=buildFinancialPosition(fixture.ledger,{asOf:'2024-01-01'});
  assert.equal(missing.complete,false);assert.equal(missing.currencies[0].netWorth,null);
  assert.ok(missing.accounts.every(account=>account.balance===null));
  const fresh=buildFinancialPosition(fixture.ledger,{asOf:'2025-03-07'});
  assert.equal(fresh.complete,true);
  const stale=buildFinancialPosition(fixture.ledger,{asOf:'2025-03-08'});
  assert.equal(stale.complete,false);assert.equal(stale.currencies[0].netWorth,null);
  assert.equal(stale.currencies[0].knownNetWorth,'-97600.00');
  assert.ok(stale.accounts.every(account=>account.balanceDate==='2025-01-31' && account.stale));
});
