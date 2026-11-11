import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {buildFinancialPosition, buildAccountMonthCoverage, applyPositionEvent} from '../js/financial-position.mjs';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';

const fixture = await createSyntheticFinancialPosition();

test('position reader keeps account/date and reconciliation scopes separate from search and pagination', () => {
  const reader = createWorkspaceViewReader(fixture.ledger);
  for (const accountId of ['', fixture.accounts.checking, fixture.accounts.brokerage, '']) {
    const accountIds = accountId ? [accountId] : undefined;
    for (const asOf of ['2025-01-31', '2025-03-10', '2024-11-30', '2025-01-31']) {
      const expected = buildFinancialPosition(fixture.ledger, {asOf, accountIds});
      assert.deepEqual(reader.position({asOf, accountId}), expected);
      reader.view({query:'nothing', reviewOnly:true, page:99});
      assert.deepEqual(reader.position({asOf, accountId}), expected);
    }
    for (const month of ['2025-01', '2025-02', '2025-01']) {
      const expected = buildAccountMonthCoverage(fixture.ledger, {month, accountIds});
      assert.deepEqual(reader.coverage({month, accountId}), expected);
      reader.position({asOf:'2025-03-10'});
      assert.deepEqual(reader.coverage({month, accountId}), expected);
    }
  }
});

test('position reader owns its ledger and detaches every cached report', () => {
  const ledger = structuredClone(fixture.ledger);
  const reader = createWorkspaceViewReader(ledger);
  const expectedPosition = reader.position({asOf:fixture.asOf});
  const expectedCoverage = reader.coverage({month:fixture.month});
  ledger.accounts[0].displayName = 'Caller mutation';
  ledger.positionEvents[0].amountText = '900.00';
  const position = reader.position({asOf:fixture.asOf});
  position.accounts[0].source.reference = 'Caller mutation';
  position.accounts[0].balance = '0';
  position.accounts.find(account => account.holdings).holdings.holdings[0].valueText = '0';
  position.currencies[0].knownNetWorth = '0';
  const coverage = reader.coverage({month:fixture.month});
  coverage.accounts[0].complete = false;
  coverage.accounts[0].reasons.push('Caller mutation');
  assert.deepEqual(reader.position({asOf:fixture.asOf}), expectedPosition);
  assert.deepEqual(reader.coverage({month:fixture.month}), expectedCoverage);
});

test('new snapshots observe conflicting evidence while existing readers remain stable', () => {
  const oldReader = createWorkspaceViewReader(fixture.ledger);
  const expected = oldReader.position({asOf:fixture.asOf});
  const ledger = applyPositionEvent(fixture.ledger, {type:'balance-snapshot', commandId:'invented-reader-conflict',
    accountId:fixture.accounts.checking, effectiveDate:fixture.asOf, amountText:'999.00', basis:'manual',
    source:{kind:'manual',reference:'Invented contradictory amount'}});
  const nextReader = createWorkspaceViewReader(ledger);
  assert.deepEqual(oldReader.position({asOf:fixture.asOf}), expected);
  assert.equal(nextReader.position({asOf:fixture.asOf}).accounts[0].status, 'conflict');
  assert.ok(nextReader.coverage({month:fixture.month}).accounts[0].reasons.includes('conflicting-balance-anchors'));
});

test('cached position readers reject invalid requests before reusing reports', () => {
  const reader = createWorkspaceViewReader(fixture.ledger);
  reader.position({asOf:fixture.asOf});
  reader.coverage({month:fixture.month});
  for (const options of [{}, {asOf:'2025-02-30'}, {asOf:fixture.asOf,accountId:null}, {asOf:fixture.asOf,accountId:'missing'}]) {
    assert.throws(() => reader.position(options));
  }
  for (const options of [{}, {month:'2025-13'}, {month:fixture.month,accountId:null}, {month:fixture.month,accountId:'missing'}]) {
    assert.throws(() => reader.coverage(options));
  }
  const invalid = structuredClone(fixture.ledger);
  invalid.positionEvents[0].accountId = 'missing';
  assert.throws(() => createWorkspaceViewReader(invalid));
});
