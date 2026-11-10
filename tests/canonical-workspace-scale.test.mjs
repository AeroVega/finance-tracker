import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceViewReader, createWorkspaceView} from '../js/canonical-workspace-model.mjs';
import {applyFinancialEvent, applyReviewDecision, summarizeLedger} from '../js/canonical-import.mjs';
import {createLargeWorkspaceFixture} from './helpers/workspace-large-fixture.mjs';

const {ledger, options} = createLargeWorkspaceFixture();

test('large multi-currency correction history preserves independent exact totals and full unresolved queue', () => {
  const reader = createWorkspaceViewReader(ledger);
  const view = reader.view();
  assert.equal(ledger.activities.length, 3000);
  assert.equal(ledger.events.length, 3400);
  assert.equal(view.totalCount, 3000);
  assert.equal(view.review.sourceCount, 320);
  assert.equal(view.sourceReviews.length, 320);
  assert.deepEqual(view.summary.map(({currency,income,spending,cash}) => ({currency,income,spending,cash})), [
    {currency:'EUR',income:'7500.00',spending:'937.50',cash:'6562.50'},
    {currency:'USD',income:'9500.00',spending:'1187.50',cash:'8312.50'},
  ]);
  assert.ok(view.summary.every(report => !report.complete && report.reasons.includes('unresolved-observations')));
  const account = reader.view({accountId:ledger.accounts[0].accountId});
  assert.equal(account.totalCount, 750);
  assert.equal(account.review.sourceCount, 80);
  assert.equal(account.summary[0].income, '5750.00');
  assert.equal(account.summary[0].spending, '718.75');
  const january = reader.view({accountId:ledger.accounts[0].accountId,month:'2023-01'});
  assert.equal(january.totalCount, 28);
  assert.equal(january.summary[0].income, '280.00');
  assert.equal(january.summary[0].spending, '35.00');
  // Unknown-date observations remain visible; known dates follow the selected month.
  assert.equal(january.review.sourceCount, 80);
  assert.equal(january.sourceReviews.length, 80);
  const february = reader.view({accountId:ledger.accounts[0].accountId,month:'2023-02'});
  assert.equal(february.review.sourceCount,40);
  assert.ok(february.sourceReviews.every(row => row.effectiveDate === null));
});

test('repeated large-history pagination and filtering preserve scope summaries and cover each row once', () => {
  const reader = createWorkspaceViewReader(ledger);
  const initial = reader.view({pageSize:500});
  const seen = new Set();
  for (let page = 0; page < initial.pages; page++) {
    const view = reader.view({page,pageSize:500});
    assert.deepEqual(view.summary, initial.summary);
    for (const row of view.rows) { assert.ok(!seen.has(row.activityId)); seen.add(row.activityId); }
  }
  assert.equal(seen.size, 3000);
  for (let i = 0; i < 15; i++) {
    const query = i % 3 === 0 ? 'Invented scale shop 749' : i % 3 === 1 ? 'no matches here' : '';
    const view = reader.view({query,page:999,pageSize:25});
    assert.deepEqual(view.summary, initial.summary);
    assert.deepEqual(view.review, initial.review);
    assert.equal(view.filteredCount, i % 3 === 0 ? 4 : i % 3 === 1 ? 0 : 3000);
    assert.equal(view.page, i % 3 === 2 ? 119 : 0);
  }
  const review = reader.view({reviewOnly:true});
  assert.equal(review.filteredCount, 0);
  assert.equal(review.review.sourceCount, 320);
});

test('scope changes use canonical financial oracle and never reuse another account or month', () => {
  const reader = createWorkspaceViewReader(ledger);
  for (const accountId of [ledger.accounts[0].accountId,ledger.accounts[1].accountId,ledger.accounts[0].accountId]) {
    for (const month of ['2023-01','2024-02','2023-01']) {
      const view = reader.view({accountId,month,query:'shop',page:1});
      for (const report of view.summary) assert.deepEqual(report, summarizeLedger(ledger, {
        start:view.scope.start,end:view.scope.end,currency:report.currency,accountIds:[accountId],
      }));
    }
  }
});

test('reader snapshots isolate caller and result mutations; new ledger reader includes later corrections', () => {
  const mutable = structuredClone(ledger);
  const reader = createWorkspaceViewReader(mutable);
  const first = reader.view();
  const original = structuredClone(first);
  first.accounts[0].displayName = 'Poison';
  first.summary[1].income = '0';
  first.sourceReviews[0].sourceDescription = 'Poison';
  first.rows[0].amountText = '0';
  first.coverage.imports[0].declaredCoverage.start = '1900-01-01';
  mutable.accounts[0].displayName = 'Caller changed';
  assert.deepEqual(reader.view(),original);
  const revised = applyFinancialEvent(ledger, {type:'bank-correction',activityId:ledger.activities[0].activityId,
    amountText:'30.00',commandId:'invented-later-scale-correction',evidence:{reason:'Invented updated amount'}}, options);
  const next = createWorkspaceViewReader(revised).view();
  assert.equal(next.summary.find(report => report.currency === 'USD').income, '9510.00');
  assert.equal(reader.view().summary.find(report => report.currency === 'USD').income, '9500.00');
  assert.equal(revised.activities[0].amountMinor, 1000);
});

test('resolved observations disappear from a new snapshot without creating financial activities', () => {
  const reader = createWorkspaceViewReader(ledger);
  const unresolved = reader.view().sourceReviews[0];
  const revised = applyReviewDecision(ledger, {observationId:unresolved.observationId,action:'reject',rationale:'Invented invalid row rejected'}, options);
  const view = createWorkspaceViewReader(revised).view();
  assert.equal(view.review.sourceCount,319);
  assert.equal(view.sourceReviews.some(row => row.observationId === unresolved.observationId),false);
  assert.equal(view.totalCount,3000);
  assert.deepEqual(view.summary.map(({currency,income,spending}) => ({currency,income,spending})),
    reader.view().summary.map(({currency,income,spending}) => ({currency,income,spending})));
});

test('snapshot readers reject invalid graphs and selections even for empty results', () => {
  const corrupt = structuredClone(ledger);
  corrupt.events[0].activityId = 'missing';
  assert.throws(() => createWorkspaceViewReader(corrupt));
  const reader = createWorkspaceViewReader(ledger);
  for (const selection of [{accountId:'missing'}, {month:'2023-13'}, {query:null}, {page:-1}, {pageSize:501}]) {
    assert.throws(() => reader.view(selection));
  }
  assert.equal(reader.view().totalCount,3000);
  assert.deepEqual(reader.view({month:'2023-01',query:'shop'}),createWorkspaceView(ledger,{month:'2023-01',query:'shop'}));
});
