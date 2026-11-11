// Synthetic model CPU measurement, excluding DOM, Drive and physical-device behavior.
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {applyPositionEvent, buildFinancialPosition, buildAccountMonthCoverage} from '../js/financial-position.mjs';
import {createLargeWorkspaceFixture} from './helpers/workspace-large-fixture.mjs';

let {ledger, options} = createLargeWorkspaceFixture();
for (const account of ledger.accounts) for (const effectiveDate of ['2024-01-31', '2024-02-29']) {
  ledger = applyPositionEvent(ledger, {type:'balance-snapshot', commandId:`invented-benchmark-${account.accountId}-${effectiveDate}`,
    accountId:account.accountId, effectiveDate, amountText:'1000.00', basis:'statement',
    source:{kind:'statement',reference:'Invented CPU benchmark statement'}}, options);
}
const selection = {asOf:'2024-02-29', month:'2024-02'};
const expected = {position:buildFinancialPosition(ledger, selection), coverage:buildAccountMonthCoverage(ledger, selection)};
const results = [];
for (let run = 0; run < 5; run++) {
  for (const mode of run % 2 ? ['snapshot-reader', 'uncached'] : ['uncached', 'snapshot-reader']) {
    const started = performance.now();
    const reader = mode === 'snapshot-reader' ? createWorkspaceViewReader(ledger) : null;
    const read = () => reader ? {position:reader.position(selection), coverage:reader.coverage(selection)}
      : {position:buildFinancialPosition(ledger, selection), coverage:buildAccountMonthCoverage(ledger, selection)};
    const first = read();
    const coldMs = performance.now() - started;
    assert.deepEqual(first, expected);
    const warmMs = [];
    for (let repeat = 0; repeat < 5; repeat++) {
      const begin = performance.now();
      const result = read();
      warmMs.push(performance.now() - begin);
      assert.deepEqual(result, expected);
    }
    results.push({mode, run, coldMs, warmMs});
  }
}
console.log(JSON.stringify({node:process.version, activities:ledger.activities.length, activityEvents:ledger.events.length,
  positionEvents:ledger.positionEvents.length, accounts:ledger.accounts.length,
  boundary:'Position and monthly coverage models only. Cached mode includes reader creation in coldMs. Warm calls represent unchanged financial scope during search/pagination. No pass threshold or browser/device speed claim.', results}, null, 2));
