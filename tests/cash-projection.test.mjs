import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlanningEvent} from '../js/planning.mjs';
import {buildCashProjection, qualifyingMonths} from '../js/cash-projection.mjs';
import {planningLedger} from './helpers/planning-fixture.mjs';

const TODAY = '2026-11-20';
const months = ['2026-08', '2026-09', '2026-10'];
function fixture({reconcileSavings = months, furniture = true} = {}) {
  const rows = [];
  for (const month of months) {
    rows.push({account:'checking', date:`${month}-15`, amount:'3000.00', kind:'income', description:'INVENTED PAYROLL'});
    rows.push({account:'checking', date:`${month}-01`, amount:'-1500.00', kind:'spending', category:'housing', description:'INVENTED RENT'});
    // A card payment is a debt payment out of cash; the card is not a cash account.
    rows.push({account:'checking', date:`${month}-20`, amount:'-400.00', kind:'transfer', description:`INVENTED CARD PAYMENT ${month}`});
    const deposit = {account:'savings', date:`${month}-21`, amount:'500.00', kind:'transfer', description:`INVENTED FROM CHECKING ${month}`};
    rows.push({account:'checking', date:`${month}-21`, amount:'-500.00', kind:'transfer', description:`INVENTED TO SAVINGS ${month}`, transferTo:deposit}, deposit);
  }
  if (furniture) rows.push({account:'checking', date:'2026-09-09', amount:'-2000.00', kind:'spending', category:'household', description:'INVENTED FURNITURE'});
  const full = month => `${month}-${month === '2026-09' ? '30' : '31'}`;
  return planningLedger({accounts:[{key:'checking', type:'checking', opening:'1000.00'}, {key:'savings', type:'savings', opening:'5000.00'}],
    coverage:{checking:Object.fromEntries(months.map(m => [m, full(m)])), savings:Object.fromEntries(months.map(m => [m, full(m)]))},
    rows, reconcile:{checking:months, savings:reconcileSavings}});
}
let n = 0;
const exclude = (ledger, activityId, excluded = true, reason = 'Invented one-off furniture') => applyPlanningEvent(ledger,
  {type:'projection-exclusion', commandId:`x-${++n}`, activityId, excluded, reason}, {now:'2026-11-20T12:00:00.000Z', idFactory:() => `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`});

test('the window is the three most recent completed months', () => {
  assert.deepEqual(qualifyingMonths(TODAY), months);
  assert.deepEqual(qualifyingMonths('2027-01-02'), ['2026-10', '2026-11', '2026-12']);
});

test('the baseline starts from reconciled closing balances and adds the average net flow', () => {
  const projection = buildCashProjection({ledger:fixture().ledger, today:TODAY});
  assert.equal(projection.status, 'ready');
  assert.equal(projection.startDate, '2026-10-31');
  assert.equal(projection.startBalance, '7300.00');
  // Transfers between checking and savings are not flows; the card payment is.
  assert.equal(projection.internalTransfers, 6);
  assert.deepEqual(projection.perMonth.map(m => [m.month, m.inflow, m.outflow]),
    [['2026-08', '3000.00', '1900.00'], ['2026-09', '3000.00', '3900.00'], ['2026-10', '3000.00', '1900.00']]);
  assert.deepEqual(projection.average, {inflow:'3000.00', outflow:'2566.67', net:'433.33'});
  assert.deepEqual(projection.projection.map(p => [p.date, p.balance]),
    [['2026-11-30', '7733.33'], ['2026-12-31', '8166.66'], ['2027-01-31', '8599.99']]);
});

test('large rows that do not recur are suggested as one-offs, and only an explicit exclusion changes the average', () => {
  const {ledger, activityFor} = fixture();
  const projection = buildCashProjection({ledger, today:TODAY});
  assert.deepEqual(projection.suggested.map(row => [row.description, row.amount]), [['INVENTED FURNITURE', '-2000.00']]);
  const furnitureId = [...activityFor.entries()].find(([row]) => row.description === 'INVENTED FURNITURE')[1];
  const excluded = buildCashProjection({ledger:exclude(ledger, furnitureId), today:TODAY});
  assert.deepEqual(excluded.average, {inflow:'3000.00', outflow:'1900.00', net:'1100.00'});
  assert.deepEqual(excluded.projection.map(p => p.balance), ['8400.00', '9500.00', '10600.00']);
  assert.deepEqual(excluded.excluded.map(row => [row.description, row.reason]), [['INVENTED FURNITURE', 'Invented one-off furniture']]);
  assert.deepEqual(excluded.suggested, []);
  // The starting balance is evidence, not an assumption: exclusions never move it.
  assert.equal(excluded.startBalance, '7300.00');
  const restored = buildCashProjection({ledger:exclude(exclude(ledger, furnitureId), furnitureId, false, 'Invented: keep it'), today:TODAY});
  assert.deepEqual(restored.average, projection.average);
});

test('an unreconciled month blocks the projection and says which account and month', () => {
  const projection = buildCashProjection({ledger:fixture({reconcileSavings:['2026-08', '2026-10']}).ledger, today:TODAY});
  assert.equal(projection.status, 'blocked');
  assert.equal(projection.blocker, 'coverage');
  assert.deepEqual(projection.missing.map(item => [item.name, item.month, item.state]), [['Invented savings', '2026-09', 'imported']]);
  assert.equal(projection.projection, undefined);
  // An exclusion cannot bypass the gate.
  const {ledger, activityFor} = fixture({reconcileSavings:['2026-08']});
  const furnitureId = [...activityFor.entries()].find(([row]) => row.description === 'INVENTED FURNITURE')[1];
  assert.equal(buildCashProjection({ledger:exclude(ledger, furnitureId), today:TODAY}).status, 'blocked');
  // A month later the window moves on and needs November too.
  assert.equal(buildCashProjection({ledger:fixture().ledger, today:'2026-12-02'}).status, 'blocked');
});

test('without checking or savings accounts there is nothing to project', () => {
  const {ledger} = planningLedger({accounts:[{key:'card', type:'credit-card'}], coverage:{}, rows:[]});
  assert.deepEqual([buildCashProjection({ledger, today:TODAY}).status, buildCashProjection({ledger, today:TODAY}).blocker], ['blocked', 'no-cash-accounts']);
});
