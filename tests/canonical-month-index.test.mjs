import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalMonthIndex} from '../js/canonical-month-index.mjs';
import {createWorkspaceView,createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {applyFinancialEvent,applyFinancialEvents,prepareCanonicalImport,applyReviewDecision,reverseReviewDecision,summarizeLedger} from '../js/canonical-import.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {replayFixture,replayRow,replayInput} from './helpers/ledger-replay-fixtures.mjs';
const fixture = await createSyntheticFinancialYear();
const annual = {start:'2025-01-01',end:'2025-12-31',currency:'USD'};
function compare(ledger,scopes) {
  const index = createCanonicalMonthIndex(ledger);
  for (const scope of scopes) {
    const expected = summarizeLedger(ledger,scope);
    assert.deepEqual(index.report(scope).report,expected);
    assert.deepEqual(index.report(scope,{includeExcluded:false}).report,{...expected,excluded:[]});
  }
  return index;
}

test('monthly index equals canonical reports across account, currency, partial-boundary and empty scopes', () => {
  const scopes = [annual,{...annual,start:'2025-01-13',end:'2025-06-17'}, {...annual,accountIds:[]},
    {...annual,currency:'EUR'}, {...annual,start:'2024-01-01'}, {...annual,start:'2027-01-01',end:'2027-12-31'}];
  for (const account of fixture.ledger.accounts) for (const month of ['01','02','12']) scopes.push({start:`2025-${month}-01`,end:`2025-${month}-${month === '02' ? '28' : '31'}`,currency:'USD',accountIds:[account.accountId,account.accountId]});
  const index = compare(fixture.ledger,scopes);
  assert.equal(index.report(annual,{includeExcluded:false}).work.visitedDetails < fixture.ledger.activities.length,true);
  assert.equal(index.activities({month:'2025-02'}).every(a => (a.activityKind === 'refund' ? a.postedDate : a.effectiveDate)?.startsWith('2025-02')),true);
  const summaries = index.monthlySummaries();
  assert.ok(summaries.length >= 48);
  assert.ok(summaries.every(s => s.complete === false && s.reasons.includes('coverage-not-reconciled')));
  assert.equal(summaries.some(s => 'balance' in s || 'week' in s),false);
});

test('undated refunds, pending rows, unknown money, multi-currency and reversed review decisions preserve exact exclusions', () => {
  let {ledger,options} = replayFixture(6,[replayRow(0),replayRow(1,{amountText:'1.00'}),
    replayRow(2,{lifecycleStatus:'pending'}),replayRow(3,{lifecycleStatus:'unknown',currency:'EUR'}),
    replayRow(4,{amountText:null}),replayRow(5,{valid:false,errorCode:'bad-date',effectiveDate:null})]);
  ledger = applyFinancialEvents(ledger,[{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',commandId:'spending'},
    {type:'classification',activityId:ledger.activities[1].activityId,activityKind:'refund',categoryId:'invented',commandId:'refund'}],options);
  ledger = prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[replayRow(0)],'invented-index-overlap'),options).ledger;
  ledger = applyReviewDecision(ledger,{observationId:ledger.observations.at(-1).observationId,action:'keep-separate'},options);
  ledger = reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId,rationale:'Invented duplicate decision reversed'},options);
  const index = compare(ledger,[{start:'2026-01-01',end:'2026-01-31',currency:'USD'},
    {start:'2027-01-01',end:'2027-01-31',currency:'EUR'}]);
  assert.equal(index.activities({month:'2027-01'}).length,1);
});

test('cross-year refund link and correction rebuild every affected month without rewriting detail', () => {
  let {ledger,options} = replayFixture(0,[]);
  const input = replayInput(ledger.accounts[0],[replayRow(0,{effectiveDate:'2025-12-31',amountText:'-900719925474099.99'}),
    replayRow(1,{effectiveDate:'2026-01-01',postedDate:'2026-02-01',amountText:'0.01'})],'invented-cross-year');
  input.coverageByAccount[ledger.accounts[0].accountId] = {start:'2025-12-01',end:'2026-12-31',provenance:'source-confirmed'};
  ledger = prepareCanonicalImport(ledger,input,options).ledger;
  ledger = applyFinancialEvent(ledger,{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',categoryId:'invented-original',commandId:'spend'},options);
  const old = createCanonicalMonthIndex(ledger);
  ledger = applyFinancialEvent(ledger,{type:'refund-link',activityId:ledger.activities[1].activityId,originalActivityId:ledger.activities[0].activityId,commandId:'refund-link',evidence:{reason:'Invented cross-year refund'}},options);
  ledger = applyFinancialEvent(ledger,{type:'bank-correction',activityId:ledger.activities[0].activityId,amountText:'-900719925474099.98',commandId:'correct',evidence:{reason:'Invented correction'}},options);
  const index = compare(ledger,[{start:'2025-12-01',end:'2025-12-31',currency:'USD'},
    {start:'2026-01-01',end:'2026-01-31',currency:'USD'},{start:'2026-02-01',end:'2026-02-28',currency:'USD'}]);
  assert.equal(index.report({start:'2025-12-01',end:'2025-12-31',currency:'USD'}).report.spending,'900719925474099.98');
  assert.equal(index.report({start:'2026-02-01',end:'2026-02-28',currency:'USD'}).report.spending,'-0.01');
  assert.equal(old.matches(ledger),false);
  assert.equal(ledger.activities[0].amountDecimal,'-900719925474099.99');
});

test('owned index and workspace reject source mismatch and isolate caller/result mutation', () => {
  const ledger = structuredClone(fixture.ledger), index = createCanonicalMonthIndex(ledger);
  const baseline = index.report(annual).report;
  const returned = index.monthlySummaries(); returned[0].income = '999';
  index.effectiveActivities()[0].amountMinor = 1;
  ledger.accounts[0].displayName = 'Invented changed label';
  assert.equal(index.matches(ledger),false);
  assert.deepEqual(index.report(annual).report,baseline);
  const reader = createWorkspaceViewReader(ledger,{monthlyIndex:index});
  const corrupt = structuredClone(ledger); corrupt.activities[0].accountId = 'missing';
  assert.throws(() => createWorkspaceViewReader(corrupt,{monthlyIndex:{matches:() => true,effectiveActivities:() => []}}));
  assert.equal(reader.view().accounts[0].displayName,'Invented changed label');
  for (const month of ['2025-01','2025-02','2025-01']) assert.deepEqual(reader.view({month}),createWorkspaceView(ledger,{month}));
  assert.deepEqual(reader.monthlySummaries(),createCanonicalMonthIndex(ledger).monthlySummaries());
});

test('a dense valid month summarizes without replay or visiting activity detail after indexing', () => {
  let {ledger,options} = replayFixture(1000);
  ledger = applyFinancialEvents(ledger,ledger.activities.map((activity,i) => ({type:'classification',activityId:activity.activityId,activityKind:'spending',commandId:`invented-${i}`})),options);
  const index = createCanonicalMonthIndex(ledger);
  const result = index.report({start:'2026-01-01',end:'2026-12-31',currency:'USD'},{includeExcluded:false});
  assert.equal(result.report.spending,'12340.00');
  assert.equal(result.work.visitedDetails,0); assert.equal(result.work.visitedMonths,12);
  assert.equal(index.activities({month:'2026-02'}).length,0);
});
