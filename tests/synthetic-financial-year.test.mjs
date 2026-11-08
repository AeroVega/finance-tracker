import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticFinancialYear, DEFAULT_SYNTHETIC_YEAR} from '../js/synthetic-financial-year.mjs';
import {parseProviderCsv} from '../js/provider-csv.mjs';
import {getEffectiveActivities, prepareCanonicalImport, validateLedger} from '../js/canonical-import.mjs';
import {serializeCanonicalLedger, validateCanonicalSnapshot, CANONICAL_INDEX, CANONICAL_PREFIX} from '../js/canonical-ledger-storage.mjs';

// One shared immutable fixture keeps this suite bounded. No Drive or private inputs.
const fixture = await createSyntheticFinancialYear();
const cents = value => Math.round(Number(value) * 100);
const sum = values => values.reduce((a, b) => a + b, 0);

test('year fixture is bounded, all invented, and has explicit annual coverage', () => {
  const {ledger, accounts} = fixture;
  assert.equal(DEFAULT_SYNTHETIC_YEAR, 2025);
  assert.equal(fixture.syntheticOnly, true);
  assert.equal(validateLedger(ledger), true);
  assert.equal(ledger.activities.length, 253);
  assert.equal(ledger.observations.length, 253);
  assert.equal(ledger.events.length, 207);
  assert.equal(ledger.accounts.length, 4);
  assert.equal(ledger.imports.length, 4);
  assert.deepEqual(Object.keys(accounts), ['checking','savings','card','investment']);
  assert.ok(ledger.activities.every(a => a.sourceDescription.startsWith('INVENTED ')));
  for (const account of ledger.accounts) {
    const activities = ledger.activities.filter(a => a.accountId === account.accountId);
    assert.equal(new Set(activities.map(a => a.effectiveDate.slice(0, 7))).size, 12);
    assert.ok(activities.every(a => a.effectiveDate >= '2025-01-01' && a.effectiveDate <= '2025-12-31'));
  }
  for (const run of ledger.imports) {
    assert.deepEqual(run.declaredCoverage, {start:'2025-01-01',end:'2025-12-31',provenance:'source-confirmed'});
    assert.equal(run.status, 'processed');
    assert.equal(run.coverageReconciled, false);
    assert.equal(run.sourceFileRetentionStatus, 'not-retained');
  }
});

test('exact monthly financial expectations and annual conservation', () => {
  const spending = ['2471.25','2475.75','2440.25','2444.75','2449.25','2946.75','2383.25','2487.75','2467.25','2471.75','2516.25','2826.75'];
  fixture.monthly.forEach((report, i) => {
    assert.equal(report.spending, spending[i]);
    for (const field of ['income','spending','cash']) assert.equal(report[field], fixture.expectedMonthly[i][field]);
    assert.equal(report.complete, false);
    assert.deepEqual(report.reasons, ['coverage-not-reconciled','unknown-lifecycle']);
    assert.equal(report.excluded.length, 4);
  });
  for (const field of ['income','spending','cash']) assert.equal(sum(fixture.monthly.map(r => cents(r[field]))), cents(fixture.summary[field]));
  assert.equal(fixture.summary.income, '73739.50');
  assert.equal(fixture.summary.spending, '30381.00');
  assert.equal(fixture.summary.cash, '48724.50');
});

test('transfers and settled card purchases conserve amounts without spending twice', () => {
  const effective = getEffectiveActivities(fixture.ledger);
  for (let month = 1; month <= 12; month++) {
    const rows = effective.filter(a => a.effectiveDate.startsWith(`2025-${String(month).padStart(2,'0')}`));
    const category = name => rows.filter(a => a.categoryId === name);
    assert.equal(sum(category('internal-transfer').map(a => a.amountMinor)), 0);
    assert.equal(sum(category('card-payment').map(a => a.amountMinor)), 0);
    const card = rows.filter(a => a.accountId === fixture.accounts.card);
    assert.equal(sum(card.map(a => a.amountMinor)), 0);
    assert.equal(category('investment-contribution')[0].amountMinor, -40000);
    const investmentIn = rows.find(a => a.sourceDescription === 'INVENTED BROKERAGE CONTRIBUTION IN');
    assert.equal(investmentIn.amountMinor, 40000);
  }
  assert.ok(effective.filter(a => ['internal-transfer','card-payment','investment-contribution'].includes(a.categoryId)).every(a => a.activityKind === 'transfer'));
});

test('correction and linked refund preserve original evidence and posting period', () => {
  const {ledger} = fixture;
  const correction = ledger.events.find(e => e.eventType === 'bank-correction');
  const original = ledger.activities.find(a => a.activityId === correction.activityId);
  const effective = getEffectiveActivities(ledger);
  assert.equal(original.amountMinor, -16500);
  assert.equal(effective.find(a => a.activityId === original.activityId).amountMinor, -16000);
  const refund = ledger.events.find(e => e.eventType === 'refund-link');
  assert.equal(refund.confirmedPostedDate, '2025-07-04');
  assert.equal(effective.find(a => a.activityId === refund.activityId).amountMinor, 10000);
  assert.equal(ledger.activities.find(a => a.activityId === refund.originalActivityId).effectiveDate, '2025-06-22');
  assert.ok(ledger.events.every(e => e.appendOnly && e.evidence.reason));
});

test('investment evidence is preserved without claiming balances, performance or ordinary income', () => {
  const investment = getEffectiveActivities(fixture.ledger).filter(a => a.accountId === fixture.accounts.investment);
  assert.equal(investment.length, 48);
  assert.ok(investment.every(a => a.activityKind === 'unclassified' && a.lifecycleStatus === 'unknown'));
  assert.equal(new Set(investment.map(a => a.sourceAction)).size, 4);
  assert.equal(fixture.summary.excluded.length, 48);
  assert.ok(fixture.summary.excluded.every(e => investment.some(a => a.activityId === e.activityId)));
  const buys = investment.filter(a => a.sourceAction === 'YOU BOUGHT');
  assert.ok(buys.every(a => a.securitySymbol === 'SYNTH' && a.quantityDecimal === '4' && a.unitPriceDecimal === '100'));
  assert.ok(fixture.ledger.observations.every(o => o.candidate.sourceBalance === null));
});

test('source bytes reproduce provider fingerprints and reimport does not repeat effects', async () => {
  for (const source of fixture.sources) {
    const parsed = await parseProviderCsv(source);
    assert.equal(parsed.fileFingerprint, source.fileFingerprint);
    assert.ok(parsed.records.every(r => r.valid));
    const run = fixture.ledger.imports.find(r => r.accountId === source.accountId);
    const observations = fixture.ledger.observations.filter(o => o.importRunId === run.importRunId);
    assert.deepEqual(observations.map(o => o.sourceFields), parsed.records.map(r => r.sourceFields));
    const imported = prepareCanonicalImport(fixture.ledger, {syntheticOnly:true,parsed,
      accountMappings: {[parsed.sourceAccountKeys[0]]:source.accountId},
      coverageByAccount: {[source.accountId]:run.declaredCoverage}});
    assert.deepEqual(imported.ledger, fixture.ledger);
    assert.equal(imported.summary.noOp, 1);
  }
});

test('same recipe produces exact retry identity and a valid canonical storage roundtrip', async () => {
  assert.deepEqual(await createSyntheticFinancialYear(), fixture);
  const objects = serializeCanonicalLedger(fixture.ledger);
  assert.equal(objects.size, 722);
  const bytes = Object.fromEntries([...objects].map(([path, text]) => [path, new TextEncoder().encode(text)]));
  assert.equal(validateCanonicalSnapshot({objects: bytes}), true);
  const index = JSON.parse(objects.get(CANONICAL_INDEX));
  const restored = {...index.metadata};
  for (const [collection, ids] of Object.entries(index.collections)) restored[collection] = ids.map(id => JSON.parse(objects.get(`${CANONICAL_PREFIX}${collection}/${id}.json`)));
  assert.deepEqual(restored, fixture.ledger);
});

test('bounded year option supports leap years without accepting extra data', async () => {
  for (const year of [null, '2025', 1999, 2100, 2025.5, NaN]) await assert.rejects(createSyntheticFinancialYear({year}), /invalid-synthetic-year-options/);
  await assert.rejects(createSyntheticFinancialYear({privateTransactions: []}), /invalid-synthetic-year-options/);
  const leap = await createSyntheticFinancialYear({year: 2024});
  assert.equal(leap.monthly[1].end, '2024-02-29');
  assert.notEqual(leap.ledger.ledgerId, fixture.ledger.ledgerId);
  assert.equal(leap.summary.spending, fixture.summary.spending);
});
