import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {createWorkspaceView, getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, applyFinancialEvents,
  applyReviewDecision, reverseReviewDecision, summarizeLedger} from '../js/canonical-import.mjs';
import {replayFixture, replayInput, replayRow, replayOptions} from './helpers/ledger-replay-fixtures.mjs';

const fixture = await createSyntheticFinancialYear();

test('saved invented year exposes exact known totals and incomplete evidence', () => {
  const view = createWorkspaceView(fixture.ledger);
  assert.equal(view.accounts.length, 4);
  assert.deepEqual(view.months, Array.from({length:12}, (_, i) => `2025-${String(12 - i).padStart(2, '0')}`));
  assert.equal(view.totalCount, 253);
  assert.equal(view.filteredCount, 253);
  assert.equal(view.rows.length, 25);
  assert.equal(view.page, 0);
  assert.equal(view.pages, 11);
  assert.equal(view.summary.length, 1);
  assert.equal(view.summary[0].income, '73739.50');
  assert.equal(view.summary[0].spending, '30381.00');
  assert.equal(view.summary[0].cash, '48724.50');
  assert.equal(view.summary[0].currency, 'USD');
  assert.equal(view.summary[0].complete, false);
  assert.deepEqual(view.summary[0].reasons, ['coverage-not-reconciled','unknown-lifecycle']);
  assert.equal(view.summary[0].excluded.length, 48);
  assert.equal(view.scope.start, '2025-01-01');
  assert.equal(view.scope.end, '2025-12-31');
  assert.equal(view.review.activityCount, 48);
  assert.equal(view.review.unknownClassificationCount, 48);
  assert.equal(view.review.unknownLifecycleCount, 48);
  assert.equal(view.review.sourceCount, 0);
  assert.deepEqual(view.sourceReviews, []);
  assert.equal(view.coverage.importCount, 4);
  assert.equal(view.coverage.coverageReconciled, false);
  assert.equal(view.coverage.sourceFilesRetained, false);
  assert.ok(view.qualifications.some(text => /known.*income.*spending/i.test(text)));
  assert.ok(view.qualifications.some(text => /not.*balance/i.test(text)));
  assert.ok(view.qualifications.some(text => /search.*review.*rows/i.test(text)));
});

test('unknown investment scope keeps official exclusions without displaying false known zero', () => {
  const view = createWorkspaceView(fixture.ledger, {accountId:fixture.accounts.investment, month:'2025-01'});
  assert.equal(view.totalCount, 4);
  assert.equal(view.summary[0].income, '0');
  assert.equal(view.summary[0].spending, '0');
  assert.equal(view.summary[0].excluded.length, 4);
  assert.deepEqual(view.summaryAvailability.USD, {available:false, eligibleActivityCount:0, incomeAvailable:false,
    spendingAvailable:false, cashAvailable:false});
  assert.equal(view.rows.find(row => row.sourceAction === 'YOU BOUGHT').amountText, '-400.00');
  const annual = createWorkspaceView(fixture.ledger);
  assert.equal(annual.summaryAvailability.USD.available, true);
  assert.equal(annual.summaryAvailability.USD.eligibleActivityCount, 205);
});

test('account and month scope use official reports while search and review only filter rows', () => {
  const january = createWorkspaceView(fixture.ledger, {month:'2025-01'});
  assert.equal(january.summary[0].income, '6010.25');
  assert.equal(january.summary[0].spending, '2471.25');
  assert.equal(january.totalCount, 21);
  const card = createWorkspaceView(fixture.ledger, {month:'2025-01', accountId:fixture.accounts.card});
  assert.equal(card.totalCount, 7);
  assert.equal(card.summary[0].income, '0');
  assert.equal(card.summary[0].spending, '366.25');
  assert.equal(card.summaryAvailability.USD.available, true);
  assert.equal(card.summaryAvailability.USD.cashAvailable, false);
  assert.deepEqual(card.summary[0], summarizeLedger(fixture.ledger, {start:'2025-01-01',end:'2025-01-31',currency:'USD',accountIds:[fixture.accounts.card]}));
  for (const options of [{query:'  INVENTED   UTILITY  '}, {reviewOnly:true}, {query:'no-such-merchant',reviewOnly:true}]) {
    const filtered = createWorkspaceView(fixture.ledger, {month:'2025-01', ...options});
    assert.deepEqual(filtered.summary, january.summary);
    assert.deepEqual(filtered.summaryAvailability, january.summaryAvailability);
    assert.deepEqual(filtered.review, january.review);
    assert.equal(filtered.totalCount, 21);
  }
  assert.equal(createWorkspaceView(fixture.ledger, {month:'2025-01', query:'  INVENTED   UTILITY  '}).filteredCount, 1);
  assert.equal(createWorkspaceView(fixture.ledger, {month:'2025-01', reviewOnly:true}).filteredCount, 4);
  assert.equal(createWorkspaceView(fixture.ledger, {query:'INVENTED SAVINGS interest'}).filteredCount, 12);
});

test('pagination is stable, bounded and clamped after filters change', () => {
  const first = createWorkspaceView(fixture.ledger, {pageSize:10});
  const second = createWorkspaceView(fixture.ledger, {pageSize:10, page:1});
  assert.equal(first.rows.length, 10);
  assert.equal(first.pages, 26);
  assert.equal(second.page, 1);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.activityId)).size, 20);
  assert.ok(first.rows.every((row, index, list) => index === 0 || list[index - 1].reportingDate >= row.reportingDate));
  assert.deepEqual(createWorkspaceView(fixture.ledger, {pageSize:10}), first);
  const last = createWorkspaceView(fixture.ledger, {pageSize:10, page:999});
  assert.equal(last.page, 25);
  assert.equal(last.rows.length, 3);
  const empty = createWorkspaceView(fixture.ledger, {query:'nothing-matches-here', page:999});
  assert.equal(empty.page, 0);
  assert.equal(empty.pages, 1);
  assert.equal(empty.filteredCount, 0);
  assert.deepEqual(empty.rows, []);
});

test('all monthly totals retain the independent recipe oracle and coverage qualifications', () => {
  const spend = ['2471.25','2475.75','2440.25','2444.75','2449.25','2946.75','2383.25','2487.75','2467.25','2471.75','2516.25','2826.75'];
  const income = ['6010.25','6010.50','6010.75','6011.00','6011.25','6011.50','6011.75','6012.00','6012.25','6012.50','6012.75','7613.00'];
  for (let index = 0; index < 12; index++) {
    const month = `2025-${String(index + 1).padStart(2, '0')}`;
    const view = createWorkspaceView(fixture.ledger, {month});
    assert.equal(view.summary[0].spending, spend[index]);
    assert.equal(view.summary[0].income, income[index]);
    assert.equal(view.coverage.importCount, 4);
    assert.equal(view.summary[0].complete, false);
    assert.deepEqual(view.summary[0].reasons, ['coverage-not-reconciled','unknown-lifecycle']);
  }
});

test('detail preserves correction evidence separately from effective values', () => {
  const event = fixture.ledger.events.find(value => value.eventType === 'bank-correction');
  const detail = getWorkspaceActivity(fixture.ledger, event.activityId);
  assert.equal(detail.activity.amountMinor, -16000);
  assert.equal(detail.activity.amountText, '-160.00');
  assert.equal(detail.originalActivity.amountMinor, -16500);
  assert.equal(detail.observations.length, 1);
  assert.equal(detail.observations[0].candidate.amountText, '-165');
  assert.equal(detail.observations[0].sourceFields.AMOUNT, '-165.00');
  assert.equal(detail.events.length, 2);
  assert.deepEqual(detail.events[1], event);
  assert.equal(detail.imports.length, 1);
  assert.equal(detail.account.displayName, 'Invented checking');
  const row = createWorkspaceView(fixture.ledger, {query:'utility', month:'2025-01'}).rows[0];
  assert.equal(row.amountText, '-160.00');
  assert.equal(row.observationCount, 1);
  assert.equal(row.eventCount, 2);
  assert.equal(Object.hasOwn(row, 'sourceFields'), false);
  assert.equal(Object.hasOwn(row, 'observations'), false);
});

test('currency reports retain exact decimals and never combine different currencies', () => {
  let {ledger, options} = replayFixture(3, [
    replayRow(0, {amountText:'-10.01', currency:'USD'}),
    replayRow(1, {amountText:'-2.25', currency:'EUR'}),
    replayRow(2, {amountText:'9007199254740993.12', currency:'USD'}),
  ]);
  ledger = applyFinancialEvents(ledger, ledger.activities.map((activity, index) => ({type:'classification', activityId:activity.activityId,
    activityKind:index === 2 ? 'income' : 'spending', commandId:`invented-classify-${index}`})), options);
  const view = createWorkspaceView(ledger);
  assert.deepEqual(view.summary.map(report => report.currency), ['EUR', 'USD']);
  assert.equal(view.summary[0].income, '0');
  assert.equal(view.summary[0].spending, '2.25');
  assert.equal(view.summary[1].income, '9007199254740993.12');
  assert.equal(view.summary[1].spending, '10.01');
  assert.equal(view.rows.find(row => row.activityKind === 'income').amountText, '9007199254740993.12');
  assert.equal(view.summaryAvailability.EUR.eligibleActivityCount, 1);
  assert.equal(view.summaryAvailability.USD.eligibleActivityCount, 2);
  assert.ok(view.summary.every(report => report.reasons.includes('different-currency')));
});

test('empty ledgers have unavailable totals; empty covered months remain qualified', () => {
  const options = replayOptions();
  const ledger = createLedger(options);
  const empty = createWorkspaceView(ledger);
  assert.deepEqual(empty.summary, []);
  assert.deepEqual(empty.months, []);
  assert.deepEqual(empty.summaryAvailability, {});
  assert.equal(empty.scope.start, null);
  assert.equal(empty.coverage.latestImportAt, null);
  assert.equal(empty.coverage.latestActivityDate, null);
  assert.equal(empty.totalCount, 0);
  assert.ok(empty.qualifications.some(text => /totals are unavailable/.test(text)));
  const {ledger:covered} = replayFixture(0, []);
  const february = createWorkspaceView(covered, {month:'2026-02'});
  assert.equal(february.summary[0].income, '0');
  assert.equal(february.summaryAvailability.USD.available, false);
  assert.equal(february.coverage.importCount, 1);
  assert.equal(february.summary[0].complete, false);
  assert.equal(february.months.length, 12);
  const outside = createWorkspaceView(covered, {month:'2027-01'});
  assert.equal(outside.coverage.importCount, 0);
  assert.ok(outside.summary[0].reasons.includes('missing-declared-coverage'));
});

test('refunds follow posting month and unknown posting dates remain visible in every month', () => {
  let {ledger, options} = replayFixture(3, [replayRow(0, {amountText:'-20.00'}),
    replayRow(1, {amountText:'5.00', effectiveDate:'2026-01-31', postedDate:'2026-02-01'}),
    replayRow(2, {amountText:'2.00', effectiveDate:'2026-04-01'})]);
  ledger = applyFinancialEvents(ledger, [
    {type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',commandId:'invented-spending'},
    {type:'classification',activityId:ledger.activities[1].activityId,activityKind:'refund',categoryId:'invented',commandId:'invented-dated-refund'},
    {type:'classification',activityId:ledger.activities[2].activityId,activityKind:'refund',categoryId:'invented',commandId:'invented-undated-refund'},
  ], options);
  const january = createWorkspaceView(ledger, {month:'2026-01'});
  assert.equal(january.totalCount, 2);
  assert.equal(january.summary[0].spending, '20.00');
  assert.equal(january.review.activityCount, 1);
  assert.equal(january.rows.find(row => row.reportingDate === null).effectiveDate, '2026-04-01');
  const february = createWorkspaceView(ledger, {month:'2026-02'});
  assert.equal(february.totalCount, 2);
  assert.equal(february.summary[0].spending, '-5.00');
  assert.equal(february.rows.find(row => row.reportingDate !== null).reportingDate, '2026-02-01');
  assert.equal(february.rows.find(row => row.reportingDate !== null).effectiveDate, '2026-01-31');
  const march = createWorkspaceView(ledger, {month:'2026-03'});
  assert.equal(march.totalCount, 1);
  assert.equal(march.summaryAvailability.USD.available, false);
  assert.ok(march.summary[0].reasons.includes('missing-refund-posted-date'));
  const refund = fixture.ledger.events.find(event => event.eventType === 'refund-link');
  assert.equal(getWorkspaceActivity(fixture.ledger, refund.activityId).events.at(-1).originalActivityId, refund.originalActivityId);
});

test('unresolved source observations have a separate account/month queue without inventing activities', () => {
  let {ledger, options} = replayFixture();
  const account = ledger.accounts[0];
  ledger = applyFinancialEvent(ledger, {type:'classification',activityId:ledger.activities[0].activityId,
    activityKind:'spending',commandId:'invented-queue-spending'}, options);
  ledger = prepareCanonicalImport(ledger, replayInput(account, [replayRow(0)], 'invented-overlap'), options).ledger;
  ledger = prepareCanonicalImport(ledger, replayInput(account, [replayRow(0, {valid:false, errorCode:'bad-date',effectiveDate:null})], 'invented-bad-date'), options).ledger;
  const january = createWorkspaceView(ledger, {month:'2026-01', reviewOnly:true, query:'not-an-activity'});
  assert.equal(january.totalCount, 1);
  assert.equal(january.filteredCount, 0);
  assert.equal(january.review.activityCount, 0);
  assert.equal(january.review.sourceCount, 2);
  assert.equal(january.sourceReviews.length, 2);
  assert.equal(january.sourceReviews[0].sourceDescription, 'INVENTED SHOP 0');
  assert.equal(january.sourceReviews[0].reasonCode, 'insufficient-composite-evidence');
  assert.equal(january.sourceReviews[1].effectiveDate, null);
  assert.equal(january.coverage.needsReviewImportCount, 2);
  assert.ok(january.summary[0].reasons.includes('unresolved-observations'));
  assert.equal(createWorkspaceView(ledger, {month:'2026-02'}).review.sourceCount, 1);
  ledger = applyReviewDecision(ledger, {observationId:january.sourceReviews[1].observationId,action:'reject',rationale:'Invented invalid date'}, options);
  assert.equal(createWorkspaceView(ledger).review.sourceCount, 1);
  ledger = applyReviewDecision(ledger, {observationId:january.sourceReviews[0].observationId,action:'match',activityId:ledger.activities[0].activityId}, options);
  const resolved = createWorkspaceView(ledger);
  assert.equal(resolved.review.sourceCount, 0);
  assert.equal(resolved.totalCount, 1);
  assert.equal(resolved.rows[0].observationCount, 2);
  assert.equal(resolved.coverage.needsReviewImportCount, 0);
});

test('inactive activity stays out of current rows but historical detail retains its reversed decision', () => {
  let {ledger, options} = replayFixture();
  ledger = prepareCanonicalImport(ledger, replayInput(ledger.accounts[0], [replayRow(0)], 'invented-reversal-overlap'), options).ledger;
  const observationId = ledger.observations.at(-1).observationId;
  ledger = applyReviewDecision(ledger, {observationId, action:'keep-separate'}, options);
  const inactiveId = ledger.activities.at(-1).activityId;
  assert.equal(createWorkspaceView(ledger).totalCount, 2);
  ledger = reverseReviewDecision(ledger, {reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId,rationale:'Invented correction'}, options);
  const view = createWorkspaceView(ledger);
  assert.equal(view.totalCount, 1);
  assert.equal(view.review.sourceCount, 1);
  assert.equal(view.rows.some(row => row.activityId === inactiveId), false);
  const detail = getWorkspaceActivity(ledger, inactiveId);
  assert.equal(detail.activity.active, false);
  assert.equal(detail.observations.length, 1);
  assert.equal(detail.observations[0].observationId, observationId);
  assert.equal(detail.observations[0].activityId, null);
  assert.deepEqual(detail.reviewDecisions.map(decision => decision.action), ['keep-separate', 'reverse']);
  assert.equal(detail.imports.length, 1);
});

test('known pending lifecycle stays excluded without becoming unknown lifecycle review', () => {
  let {ledger, options} = replayFixture(2, [replayRow(0, {lifecycleStatus:'pending'}), replayRow(1, {lifecycleStatus:'unknown'})]);
  ledger = applyFinancialEvents(ledger, ledger.activities.map((activity, index) => ({type:'classification',activityId:activity.activityId,
    activityKind:'spending',commandId:`invented-lifecycle-${index}`})), options);
  const view = createWorkspaceView(ledger, {reviewOnly:true});
  assert.equal(view.totalCount, 2);
  assert.equal(view.filteredCount, 1);
  assert.equal(view.rows[0].lifecycleStatus, 'unknown');
  assert.equal(view.review.unknownLifecycleCount, 1);
  assert.equal(view.review.unknownClassificationCount, 0);
  assert.deepEqual(view.summary[0].excluded.map(item => item.reason), ['pending', 'unknown-lifecycle']);
  assert.equal(view.summaryAvailability.USD.available, false);
});

test('leap month, missing account coverage and account-specific month choices remain explicit', () => {
  const options = replayOptions();
  let ledger = registerAccount(createLedger(options), {institutionId:'sofi',name:'Invented empty',currency:'EUR',accountType:'checking'}, options);
  const emptyId = ledger.accounts[0].accountId;
  ledger = registerAccount(ledger, {institutionId:'sofi',name:'Invented covered',currency:'USD',accountType:'checking'}, options);
  const covered = ledger.accounts[1];
  const input = replayInput(covered, [replayRow(0, {effectiveDate:'2024-02-29'})]);
  input.coverageByAccount[covered.accountId] = {start:'2024-02-01',end:'2024-03-31',provenance:'source-confirmed'};
  ledger = prepareCanonicalImport(ledger, input, options).ledger;
  const view = createWorkspaceView(ledger, {month:'2024-02'});
  assert.equal(view.scope.end, '2024-02-29');
  assert.deepEqual(view.months, ['2024-03','2024-02']);
  assert.ok(view.summary.every(report => report.reasons.includes('missing-declared-coverage')));
  assert.equal(createWorkspaceView(ledger, {accountId:covered.accountId,month:'2024-02'}).summary[0].reasons.includes('missing-declared-coverage'), false);
  const empty = createWorkspaceView(ledger, {accountId:emptyId});
  assert.deepEqual(empty.months, []);
  assert.deepEqual(empty.summary, []);
  assert.equal(empty.totalCount, 0);
});

test('model calls neither mutate the ledger nor return aliases into its graph', () => {
  const ledger = structuredClone(fixture.ledger);
  const before = JSON.stringify(ledger);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } };
  freeze(ledger);
  const view = createWorkspaceView(ledger);
  const activityId = ledger.events.find(event => event.eventType === 'bank-correction').activityId;
  const detail = getWorkspaceActivity(ledger, activityId);
  view.accounts[0].displayName = 'Changed only the result';
  view.coverage.imports[0].declaredCoverage.start = '2000-01-01';
  view.rows[0].sourceDescription = 'Changed only the result';
  view.summary[0].excluded[0].reason = 'Changed only the result';
  detail.originalActivity.amountMinor = -1;
  detail.observations[0].sourceFields.AMOUNT = 'changed';
  detail.events[0].evidence.reason = 'changed';
  detail.imports[0].counts.created = 0;
  assert.equal(JSON.stringify(ledger), before);
  assert.equal(getWorkspaceActivity(ledger, activityId).activity.amountText, '-160.00');
  assert.equal(createWorkspaceView(ledger).summary[0].spending, '30381.00');
});

test('all graph reads fail closed on corrupt history even when filters match no rows', () => {
  const corruptions = [
    ledger => { ledger.syntheticOnly = false; },
    ledger => { ledger.activities[0].accountId = 'missing'; },
    ledger => { ledger.observations[0].sourceFields = {...ledger.observations[0].sourceFields, AMOUNT:'changed evidence'}; },
    ledger => { ledger.events.find(event => event.eventType === 'bank-correction').priorValues.amountMinor = -1; },
    ledger => { ledger.imports[0].coverageReconciled = true; },
  ];
  for (const corrupt of corruptions) {
    const ledger = structuredClone(fixture.ledger);
    corrupt(ledger);
    assert.throws(() => createWorkspaceView(ledger, {query:'matches-nothing', month:'2040-01'}));
    assert.throws(() => getWorkspaceActivity(ledger, ledger.activities.at(-1).activityId));
  }
});

test('invalid selections fail rather than silently showing another scope', () => {
  for (const options of [{accountId:'missing'}, {accountId:null}, {month:null}, {month:'2025-13'}, {month:'2025-2'},
    {month:'2025-02-01'}, {query:null}, {reviewOnly:'true'}, {page:-1}, {page:1.2}, {page:Infinity},
    {pageSize:0}, {pageSize:-1}, {pageSize:501}, {pageSize:NaN}]) {
    assert.throws(() => createWorkspaceView(fixture.ledger, options));
  }
  assert.throws(() => getWorkspaceActivity(fixture.ledger, 'missing'), /unknown-activity/);
  assert.throws(() => createWorkspaceView(null));
});

test('a later append-only correction is visible without stale projected state', () => {
  let {ledger, options} = replayFixture();
  const activityId = ledger.activities[0].activityId;
  ledger = applyFinancialEvent(ledger, {type:'classification',activityId,activityKind:'spending',commandId:'invented-first'}, options);
  const before = createWorkspaceView(ledger);
  ledger = applyFinancialEvent(ledger, {type:'bank-correction',activityId,amountText:'-7.00',commandId:'invented-edit',evidence:{reason:'Invented corrected receipt'}}, options);
  const after = createWorkspaceView(ledger);
  assert.equal(before.summary[0].spending, '12.34');
  assert.equal(after.summary[0].spending, '7.00');
  assert.equal(after.rows[0].amountText, '-7.00');
  assert.equal(getWorkspaceActivity(ledger, activityId).originalActivity.amountMinor, -1234);
});

test('a correction conflicting with classification enters review through the official exclusion', () => {
  const utility = fixture.ledger.events.find(event => event.eventType === 'bank-correction').activityId;
  const ledger = applyFinancialEvent(fixture.ledger, {type:'bank-correction',activityId:utility,amountText:'160.00',
    commandId:'invented-positive-spending',evidence:{reason:'Invented positive corrected receipt'}});
  const view = createWorkspaceView(ledger, {month:'2025-01',reviewOnly:true,query:'utility'});
  assert.equal(view.filteredCount, 1);
  assert.equal(view.rows[0].needsReview, true);
  assert.deepEqual(view.rows[0].reviewReasons, ['classification-amount-conflict']);
  assert.ok(view.summary[0].excluded.some(item => item.activityId === utility && item.reason === 'classification-amount-conflict'));
  const detail = getWorkspaceActivity(ledger, utility);
  assert.equal(detail.activity.needsReview, true);
  assert.deepEqual(detail.activity.reviewReasons, ['classification-amount-conflict']);
});

test('missing amounts and unmatched refunds enter review, while another currency alone does not', () => {
  let {ledger, options} = replayFixture(3, [replayRow(0, {amountText:null}),
    replayRow(1, {amountText:'1.00',postedDate:'2026-01-15'}), replayRow(2, {amountText:'-2.00',currency:'EUR'})]);
  ledger = applyFinancialEvents(ledger, ledger.activities.slice(1).map((activity, index) => ({type:'classification',activityId:activity.activityId,
    activityKind:index === 0 ? 'refund' : 'spending',commandId:`invented-review-exclusion-${index}`})), options);
  const view = createWorkspaceView(ledger, {reviewOnly:true});
  assert.equal(view.filteredCount, 2);
  assert.deepEqual(view.rows.flatMap(row => row.reviewReasons).sort(), ['unclassified-activity','unknown-amount','unmatched-refund']);
  assert.deepEqual(getWorkspaceActivity(ledger, ledger.activities[0].activityId).activity.reviewReasons, ['unclassified-activity','unknown-amount']);
  assert.deepEqual(getWorkspaceActivity(ledger, ledger.activities[1].activityId).activity.reviewReasons, ['unmatched-refund']);
  assert.equal(getWorkspaceActivity(ledger, ledger.activities[2].activityId).activity.needsReview, false);
});
