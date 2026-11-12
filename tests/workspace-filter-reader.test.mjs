import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {createWorkspaceView, createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';

const fixture = await createSyntheticFinancialYear();

test('cached search and review pages preserve normalized matching, page size and clamping', () => {
  const reader = createWorkspaceViewReader(fixture.ledger);
  const full = createWorkspaceView(fixture.ledger, {pageSize:500});
  const reviewRows = full.rows.filter(row => row.needsReview);
  assert.equal(reviewRows.length, 48);
  for (const query of ['INVENTED', '  invented \t ', 'invented']) {
    for (const [page, pageSize] of [[0,7], [1,7], [2,11], [999,11], [0,500]]) {
      const view = reader.view({query, reviewOnly:true, page, pageSize});
      const last = Math.ceil(reviewRows.length / pageSize) - 1;
      const expectedPage = Math.min(page, last);
      assert.deepEqual(view.rows, reviewRows.slice(expectedPage * pageSize, (expectedPage + 1) * pageSize));
      assert.equal(view.filteredCount, 48);
      assert.equal(view.pages, last + 1);
      assert.equal(view.page, expectedPage);
      assert.equal(view.pageSize, pageSize);
      assert.deepEqual(view.summary, full.summary);
      assert.deepEqual(view.summaryAvailability, full.summaryAvailability);
      assert.deepEqual(view.review, full.review);
      assert.deepEqual(view.coverage, full.coverage);
    }
  }
  assert.deepEqual(reader.view({query:'INVENTED', pageSize:500}).rows, full.rows);
  for (const [page, pageSize] of [[999,1], [0,500]]) {
    const empty = reader.view({query:'nothing invented matches', reviewOnly:true, page, pageSize});
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.filteredCount, 0);
    assert.equal(empty.pages, 1);
    assert.equal(empty.page, 0);
    assert.deepEqual(empty.summary, full.summary);
  }
  assert.equal(reader.view({query:'INVENTED', reviewOnly:true}).filteredCount, 48);
  assert.equal(reader.view({query:' \t '}).filteredCount, 253);
});

test('query, review and scope replacements cannot retain an earlier row selection', () => {
  const reader = createWorkspaceViewReader(fixture.ledger);
  const selections = [
    {query:'invented', reviewOnly:true},
    {query:'utility', reviewOnly:true},
    {query:'utility'},
    {query:'invented', reviewOnly:true},
    {query:'invented', reviewOnly:true, accountId:fixture.accounts.investment, month:'2025-01'},
    {query:'invented', reviewOnly:true, accountId:fixture.accounts.investment, month:'2025-02'},
    {query:'invented', reviewOnly:true, accountId:fixture.accounts.checking, month:'2025-02'},
    {query:'invented', reviewOnly:true, accountId:fixture.accounts.investment, month:'2025-01'},
    {query:'invented', reviewOnly:true},
  ];
  const counts = [];
  for (const selection of selections) {
    const options = {...selection, page:999, pageSize:3};
    const view = reader.view(options);
    assert.deepEqual(view, createWorkspaceView(fixture.ledger, options));
    counts.push(view.filteredCount);
  }
  assert.deepEqual(counts, [48, 0, 12, 48, 4, 4, 0, 4, 48]);
});

test('cached filter rows stay private after result, input and options mutations', () => {
  const input = structuredClone(fixture.ledger);
  const reader = createWorkspaceViewReader(input);
  const options = {query:'invented', reviewOnly:true, pageSize:3};
  const expected = createWorkspaceView(fixture.ledger, options);
  const first = reader.view(options);
  first.rows[0].sourceDescription = 'poison';
  first.rows[0].reviewReasons.push('poison');
  first.rows.splice(0, 3);
  first.summary[0].excluded[0].reason = 'poison';
  first.accounts[0].displayName = 'poison';
  input.activities[0].sourceDescription = 'poison';
  input.accounts[0].displayName = 'poison';
  assert.deepEqual(reader.view(options), expected);
  options.page = 1;
  options.pageSize = 5;
  assert.deepEqual(reader.view(options), createWorkspaceView(fixture.ledger, options));
  options.query = 'utility';
  options.reviewOnly = false;
  assert.deepEqual(reader.view(options), createWorkspaceView(fixture.ledger, options));
  options.query = 'invented';
  options.reviewOnly = true;
  assert.deepEqual(reader.view(options), createWorkspaceView(fixture.ledger, options));
});

test('warm and empty filter results never bypass selection validation or poison later reads', () => {
  const reader = createWorkspaceViewReader(fixture.ledger);
  for (const query of ['invented', 'no match']) {
    const options = {query, reviewOnly:true, pageSize:3};
    const expected = reader.view(options);
    for (const invalid of [null, {query:null}, {reviewOnly:1}, {page:-1}, {page:Infinity},
      {pageSize:0}, {pageSize:501}, {month:null}, {month:'2025-13'}, {accountId:'missing'}]) {
      assert.throws(() => reader.view(invalid === null ? null : {...options, ...invalid}));
      assert.deepEqual(reader.view(options), expected);
    }
  }
});
