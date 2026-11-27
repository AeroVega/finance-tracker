import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger, registerAccount, validateLedger, validateKnownLedger} from '../js/canonical-import.mjs';
import {assertCanonicalLedgerTransition} from '../js/canonical-history.mjs';
import {applyPlanningEvent} from '../js/planning.mjs';
import {budgetTargetsFor, projectionExclusions, earliestTargetMonth} from '../js/planning-contract.mjs';
import {planningLedger} from './helpers/planning-fixture.mjs';

let n = 0;
const options = {now:'2026-11-20T12:00:00.000Z', idFactory:() => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`};
const target = (ledger, categoryId, amountText, effectiveMonth = '2026-11', commandId = `target-${categoryId}-${effectiveMonth}-${amountText}`) =>
  applyPlanningEvent(ledger, {type:'budget-target', commandId, categoryId, currency:'USD', effectiveMonth, amountText}, options);
const code = code => error => error.code === code;

function base() {
  let ledger = createLedger({now:'2026-11-01T00:00:00.000Z', idFactory:() => '10000000-0000-4000-8000-000000000001'});
  return registerAccount(ledger, {institutionId:'sofi', displayName:'Invented checking', currency:'USD', accountType:'checking'},
    {now:'2026-11-01T00:00:00.000Z', idFactory:() => '10000000-0000-4000-8000-000000000002'});
}

test('a budget target is an append-only planning record that applies from its month onward', () => {
  let ledger = target(base(), 'groceries', '400');
  assert.equal(ledger.planningEvents.length, 1);
  assert.deepEqual(Object.keys(ledger.planningEvents[0]).sort(), ['amountText', 'appendOnly', 'categoryId', 'commandId', 'currency', 'effectiveMonth', 'eventId', 'eventType', 'recordedAt']);
  assert.equal(ledger.planningEvents[0].amountText, '400.00');
  assert.equal(validateLedger(ledger), true);
  assert.deepEqual(budgetTargetsFor(ledger, '2026-10'), []);
  assert.equal(budgetTargetsFor(ledger, '2026-11')[0].amountText, '400.00');
  assert.equal(budgetTargetsFor(ledger, '2027-03')[0].amountText, '400.00');
  // A change from December keeps November's target for an honest comparison.
  const before = ledger;
  ledger = target(ledger, 'groceries', '450.50', '2026-12');
  assertCanonicalLedgerTransition(before, ledger);
  assert.equal(budgetTargetsFor(ledger, '2026-11')[0].amountText, '400.00');
  assert.equal(budgetTargetsFor(ledger, '2026-12')[0].amountText, '450.50');
  // Removing a budget is a new record, not a deletion.
  ledger = target(ledger, 'groceries', null, '2027-01');
  assert.deepEqual(budgetTargetsFor(ledger, '2027-01'), []);
  assert.equal(budgetTargetsFor(ledger, '2026-12').length, 1);
});

test('a later change made "from now on" replaces a target set in advance', () => {
  let ledger = target(base(), 'dining', '200', '2027-01');
  ledger = target(ledger, 'dining', '150', '2026-12');
  assert.equal(budgetTargetsFor(ledger, '2027-02')[0].amountText, '150.00');
});

test('budget targets refuse non-positive, malformed and backdated amounts', () => {
  const ledger = base();
  for (const amount of ['0', '-5', 'abc', '1.234']) assert.throws(() => target(ledger, 'groceries', amount), code('invalid-budget-target'), amount);
  assert.throws(() => target(ledger, 'Groceries', '5'), code('invalid-budget-target'));
  assert.throws(() => target(ledger, 'groceries', '5', '2026-09'), code('budget-target-before-current-month'));
  // The month before the recorded UTC month is accepted for a user west of UTC.
  assert.equal(earliestTargetMonth('2026-12-01T03:00:00.000Z'), '2026-11');
  assert.equal(earliestTargetMonth('2026-01-01T03:00:00.000Z'), '2025-12');
  assert.equal(target(ledger, 'groceries', '5', '2026-10').planningEvents.length, 1);
});

test('retrying a command is a no-op and reusing its ID with new content is refused', () => {
  const ledger = target(base(), 'travel', '90', '2026-11', 'same-command');
  assert.deepEqual(target(ledger, 'travel', '90.00', '2026-11', 'same-command'), ledger);
  assert.throws(() => target(ledger, 'travel', '95', '2026-11', 'same-command'), code('planning-command-conflict'));
});

test('stored planning records cannot be rewritten, reordered, removed or forged', () => {
  const ledger = target(target(base(), 'groceries', '400'), 'dining', '120');
  const rewritten = structuredClone(ledger); rewritten.planningEvents[0].amountText = '500.00';
  assert.throws(() => assertCanonicalLedgerTransition(ledger, rewritten), code('history-rewrite-refused'));
  const removed = structuredClone(ledger); removed.planningEvents.pop();
  assert.throws(() => assertCanonicalLedgerTransition(ledger, removed), code('history-removal-refused'));
  const reordered = structuredClone(ledger); reordered.planningEvents.reverse();
  assert.throws(() => assertCanonicalLedgerTransition(ledger, reordered), code('history-order-change-refused'));
  const extra = structuredClone(ledger); extra.planningEvents[0].note = 'x';
  assert.throws(() => validateLedger(extra), code('invalid-planning-event'));
  const duplicate = structuredClone(ledger); duplicate.planningEvents[1].eventId = duplicate.planningEvents[0].eventId;
  assert.throws(() => validateLedger(duplicate), code('invalid-planning-event'));
  const clash = structuredClone(ledger); clash.planningEvents[0].eventId = ledger.accounts[0].accountId;
  assert.throws(() => validateLedger(clash), code('invalid-planning-event'));
  const notArray = structuredClone(ledger); notArray.planningEvents = {};
  assert.throws(() => validateLedger(notArray), code('invalid-planning-events'));
});

test('a production ledger accepts planning records and keeps them through validation', () => {
  let ledger = createLedger({dataClass:'production', now:'2026-11-01T00:00:00.000Z', idFactory:() => '20000000-0000-4000-8000-000000000001'});
  ledger = target(ledger, 'groceries', '300');
  assert.equal(validateKnownLedger(ledger), true);
  assert.equal(ledger.planningEvents.length, 1);
});

test('projection exclusions name an activity, need a reason and are reversible', () => {
  const {ledger:fixture, activityFor} = planningLedger({accounts:[{key:'checking', type:'checking'}],
    coverage:{checking:{'2026-10':'2026-10-31'}}, rows:[{account:'checking', date:'2026-10-05', amount:'-900.00', kind:'spending', category:'travel'}]});
  const activityId = [...activityFor.values()][0];
  const exclude = (ledger, excluded, reason = 'Invented one-off trip') => applyPlanningEvent(ledger,
    {type:'projection-exclusion', commandId:`exclusion-${ledger.planningEvents?.length ?? 0}`, activityId, excluded, reason}, options);
  assert.throws(() => exclude(fixture, true, '  '), code('invalid-projection-exclusion'));
  assert.throws(() => exclude(fixture, false), code('invalid-projection-exclusion'));
  assert.throws(() => applyPlanningEvent(fixture, {type:'projection-exclusion', commandId:'x', activityId:'30000000-0000-4000-8000-000000000001', excluded:true, reason:'r'}, options), code('unknown-planning-activity'));
  let ledger = exclude(fixture, true);
  assert.equal(projectionExclusions(ledger).get(activityId).reason, 'Invented one-off trip');
  assert.throws(() => exclude(ledger, true), code('invalid-projection-exclusion'));
  ledger = exclude(ledger, false, 'Invented: it recurs after all');
  assert.equal(projectionExclusions(ledger).size, 0);
  assert.equal(ledger.planningEvents.length, 2);
  // A planning record never changes an activity.
  assert.deepEqual(ledger.activities, fixture.activities);
  assert.deepEqual(ledger.events, fixture.events);
});
