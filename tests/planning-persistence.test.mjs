import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createLedgerSessionOwner, validateLedger} from '../js/canonical-import.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {encodeFullSnapshotBackup, decodeFullSnapshotBackup} from '../js/full-snapshot-backup.mjs';
import {applyPlanningEvent} from '../js/planning.mjs';
import {budgetTargetsFor} from '../js/planning-contract.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';

const recipe = await createSyntheticFinancialYear();
const month = new Date().toISOString().slice(0, 7);
const targetCommand = (amountText = '320.00', categoryId = 'groceries') => ({type:'budget-target', categoryId, currency:'USD', effectiveMonth:month, amountText});

async function setup() {
  const http = new HttpFullSnapshotDrive();
  const lifecycle = new FullSnapshotApplication({folderId:http.folderId, accessToken:() => 'invented-test-token', fetchImpl:http.fetch, cryptoImpl:webcrypto,
    lifecycleTarget:null, isOnline:() => true, setIntervalImpl:() => 1, clearIntervalImpl:() => {}, visibilityDelayMs:0});
  await lifecycle.start({initialize:true});
  const store = lifecycle.createLedgerStore(); await store.load(); await store.save(recipe.ledger);
  const storage = {lifecycle:null, accessToken:'invented-token',
    async connect() { this.lifecycle = lifecycle; },
    createLedgerStore() { return this.lifecycle.createLedgerStore(); },
    async release() { const result = await this.lifecycle.release(); this.lifecycle = null; return result; }};
  return new CanonicalWorkspaceSession({storage, online:() => true});
}

test('budget targets stage locally, then save and reopen as the same full graph', async () => {
  const session = await setup(); await session.open();
  const original = structuredClone(session.ledger);
  session.recordPlanning(targetCommand());
  assert.equal(session.dirty, true);
  assert.equal(session.ledger.planningEvents.length, 1);
  assert.deepEqual(session.ledger.activities, original.activities);
  assert.deepEqual(session.ledger.events, original.events);
  const proposed = structuredClone(session.ledger);
  await session.save(); await session.reopen();
  assert.deepEqual(session.ledger, proposed);
  assert.equal(budgetTargetsFor(session.ledger, month)[0].amountText, '320.00');
});

test('undo removes a staged target and restores the absent collection exactly', async () => {
  const session = await setup(); session.preview(recipe.ledger);
  const original = structuredClone(session.ledger);
  assert.equal(Object.hasOwn(original, 'planningEvents'), false);
  session.recordPlanning(targetCommand());
  session.recordPlanning(targetCommand('300.00'));
  session.undoLastStagedChange();
  assert.equal(budgetTargetsFor(session.ledger, month)[0].amountText, '320.00');
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger, original);
  assert.equal(session.dirty, false);
});

test('an invalid target leaves the draft and undo history unchanged', async () => {
  const session = await setup(); session.preview(recipe.ledger);
  const original = structuredClone(session.ledger);
  assert.throws(() => session.recordPlanning(targetCommand('0')), {code:'invalid-budget-target'});
  assert.throws(() => session.recordPlanning({...targetCommand(), effectiveMonth:'2000-01'}), {code:'budget-target-before-current-month'});
  assert.deepEqual(session.ledger, original);
  assert.equal(session.stagedHistory.length, 0);
});

test('a CSV import proposal cannot add, change or drop planning records', async () => {
  const session = await setup(); session.preview(recipe.ledger);
  session.recordPlanning(targetCommand());
  const proposal = structuredClone(session.ledger); proposal.planningEvents[0].amountText = '1.00';
  assert.throws(() => session.stageCanonicalImport(proposal), /invalid-parsed-import|history-rewrite-refused/);
  const dropped = structuredClone(session.ledger); delete dropped.planningEvents;
  assert.throws(() => session.stageCanonicalImport(dropped));
});

test('an encrypted backup restores planning records exactly', async () => {
  const ledger = applyPlanningEvent(recipe.ledger, {...targetCommand(), commandId:'invented-backup-target'});
  const bytes = await encodeFullSnapshotBackup(ledger, {cryptoImpl:webcrypto, password:'invented password 1234'});
  const restored = await decodeFullSnapshotBackup(bytes, {cryptoImpl:webcrypto, password:'invented password 1234'});
  assert.deepEqual(restored, ledger);
  assert.deepEqual(budgetTargetsFor(restored, month), budgetTargetsFor(ledger, month));
});

for (const collision of ['eventId', 'commandId']) {
  test(`optimized activity session rejects a ${collision} already used by a planning record`, () => {
    const ledger = applyPlanningEvent(recipe.ledger, {...targetCommand(), commandId:'invented-planning-command'});
    const planning = ledger.planningEvents[0];
    const session = createLedgerSessionOwner().open(JSON.stringify(ledger), 'invented-storage-binding');
    const activityId = ledger.activities[0].activityId;
    const entry = {eventId:crypto.randomUUID(), recordedAt:new Date().toISOString(), command:{
      type:'category-correction', commandId:'invented-activity-command', activityId, categoryId:'invented-reviewed'}};
    if (collision === 'eventId') entry.eventId = planning.eventId; else entry.command.commandId = planning.commandId;
    assert.throws(() => session.applyBatchJson(JSON.stringify([entry]), 0),
      collision === 'eventId' ? /invalid-or-duplicate-record-id/ : /event-command-conflict/);
    assert.equal(session.revision(), 0);
    assert.equal(validateLedger(session.validatedSnapshot()), true);
  });
}

test('several targets staged together are one undoable step', async () => {
  const session = await setup(); session.preview(recipe.ledger);
  const original = structuredClone(session.ledger);
  session.recordPlanning([targetCommand('320.00'), targetCommand('80.00', 'dining'), targetCommand('60.00', 'transport')]);
  assert.equal(session.ledger.planningEvents.length, 3);
  assert.equal(session.stagedHistory.length, 1);
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger, original);
  // One invalid amount refuses the whole batch.
  assert.throws(() => session.recordPlanning([targetCommand('320.00'), targetCommand('-1', 'dining')]), {code:'invalid-budget-target'});
  assert.deepEqual(session.ledger, original);
});
