import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFinancialEvent, getEffectiveActivities, summarizeLedgerPeriods } from '../js/canonical-import.mjs';
import { CanonicalWorkspaceSession } from '../js/canonical-workspace-session.mjs';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';

const recipe = await createSyntheticFinancialYear();
async function setup(layout = 'partitions-v5', fresh = false) {
  const fixture=await createPagedFixture(),lifecycle=fixture.lifecycle;
  lifecycle.coordinator={canWrite:true};
  if(!fresh){const store=new CanonicalLedgerStore({lifecycle});await store.load();await store.save(recipe.ledger);}
  const calls = { connects: [], writes: 0, reads: 0, fail: false, loseResponse: false };
  const save=lifecycle.savePartitionedRoot.bind(lifecycle),read=lifecycle.readPartitionedSnapshot.bind(lifecycle);
  lifecycle.readPartitionedSnapshot=async()=>{calls.reads++;return read();};
  lifecycle.savePartitionedRoot=async args=>{
    if(calls.fail)throw Object.assign(new Error('private failure'),{code:'base-conflict'});
    const result=await save(args);calls.writes++;
    if(calls.loseResponse)throw Object.assign(new Error('lost response'),{code:'transaction-unresolved'});
    return result;
  };
  const storage = {lifecycle:null,accessToken:'invented-token',
    async connect(options){calls.connects.push(options);this.lifecycle=lifecycle;},
    async release(){this.lifecycle=null;return {released:true};}};
  const session=new CanonicalWorkspaceSession({storage});
  return {session,storage,lifecycle,calls,get manifest(){return fixture.manifest;},reset:fixture.reset};
}

test('open selects an existing synthetic copy and independently loads canonical records', async () => {
  const h = await setup(); await h.session.open();
  assert.deepEqual(h.calls.connects, [{ requireExisting: true }]);
  assert.deepEqual(h.session.ledger, recipe.ledger);
  assert.equal(h.session.dirty, false); assert.equal(h.session.canEdit(), true); assert.equal(h.calls.writes, 0);
});

function correction(ledger, rationale = 'Invented corrected amount') {
  const activity = getEffectiveActivities(ledger).find(a => a.activityKind === 'spending' && !a.originalActivityId);
  return { activityId: activity.activityId, type: 'bank-correction', amountText: '-99.50', rationale };
}

test('corrections preserve source and base activities; explicit save then reopen preserves full graph', async () => {
  const h = await setup(); await h.session.open();
  const before = structuredClone(h.session.ledger);
  h.session.correct(correction(before));
  assert.equal(h.calls.writes, 0); assert.equal(h.session.dirty, true);
  assert.deepEqual(h.session.ledger.observations, before.observations);
  assert.deepEqual(h.session.ledger.activities, before.activities);
  assert.equal(h.session.ledger.events.length, before.events.length + 1);
  const proposed = structuredClone(h.session.ledger);
  await h.session.save(); assert.equal(h.calls.writes, 1); assert.equal(h.session.dirty, false);
  await h.session.reopen(); assert.deepEqual(h.session.ledger, proposed); assert.equal(h.calls.writes, 1);
  assert.equal(h.session.store.layout, 'partitions-v5');
});

test('preview remains local and cannot save or run alongside a selected Drive session', async () => {
  const h = await setup(); h.session.preview(recipe.ledger); h.session.correct(correction(h.session.ledger));
  assert.equal(h.session.mode, 'preview'); assert.equal(h.session.canSave(), false);
  await assert.rejects(h.session.save(), { code: 'verified-draft-required' });
  assert.equal(h.calls.writes, 0); assert.deepEqual(h.calls.connects, []);
  await h.session.open(); assert.throws(() => h.session.preview(recipe.ledger), { code: 'release-before-preview' });
});

test('offline/session uncertainty blocks edits until a verified reopen, retaining local draft', async () => {
  const h = await setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger);
  h.lifecycle.state = 'ownership-unknown'; h.session.invalidate();
  assert.equal(h.session.canEdit(), false); assert.equal(h.session.canSave(), false);
  h.lifecycle.state = 'ready'; assert.equal(h.session.canSave(), false);
  assert.deepEqual(h.session.ledger, proposal);
  await h.session.reopen(); assert.equal(h.session.dirty, false); assert.equal(h.session.canEdit(), true);
});

for (const [flag, writes] of [['fail', 0], ['loseResponse', 1]]) test(`${flag} retains proposal and forbids blind save retry`, async () => {
  const h = await setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger); h.calls[flag] = true;
  await assert.rejects(h.session.save());
  assert.equal(h.session.unverified, true); assert.equal(h.session.dirty, true);
  assert.equal(h.session.canSave(), false); assert.deepEqual(h.session.ledger, proposal);
  await assert.rejects(h.session.save(), { code: 'verified-draft-required' }); assert.equal(h.calls.writes, writes);
  h.calls[flag] = false; await h.session.reopen(); assert.equal(h.session.unverified, false);
  assert.equal(h.session.dirty, false); assert.equal(h.calls.writes, writes);
  assert.deepEqual(h.session.ledger, flag === 'loseResponse' ? proposal : recipe.ledger);
});

test('release keeps draft read-only and clears credentials only after verified completion', async () => {
  const h = await setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger);
  const release = h.storage.release;
  h.storage.release = async () => ({ released: false });
  await assert.rejects(h.session.release(), { code: 'release-unconfirmed' });
  assert.equal(h.storage.accessToken, 'invented-token'); assert.deepEqual(h.session.ledger, proposal);
  h.storage.release = release; await h.session.release();
  assert.equal(h.storage.accessToken, ''); assert.equal(h.session.dirty, true); assert.equal(h.session.canEdit(), false);
  assert.deepEqual(h.session.ledger, proposal);
});

test('failed open never adopts another copy as writable base for the retained draft', async () => {
  const h = await setup(); await h.session.open(); h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger); h.storage.connect = async () => { throw new Error('invented cancellation'); };
  await assert.rejects(h.session.open());
  assert.deepEqual(h.session.ledger, proposal); assert.equal(h.session.canEdit(), false); assert.equal(h.session.canSave(), false);
});

test('missing canonical index and non-synthetic copies fail closed without initializing a ledger', async () => {
  for (const invalid of ['empty', 'production']) {
    const h = await setup();
    if(invalid==='empty')await h.reset();
    else h.lifecycle.readPartitionedSnapshot=async()=>{throw Object.assign(new Error('synthetic data required'),{code:'synthetic-data-required'});};
    await assert.rejects(h.session.open(), { code: invalid === 'empty' ? 'canonical-ledger-required' : 'synthetic-data-required' });
    assert.equal(h.session.ledger, null); assert.equal(h.calls.writes, 0); assert.equal(h.session.canEdit(), false);
  }
});

test('rationale and engine validation are required; invalid changes remain atomic', async () => {
  const h = await setup(); await h.session.open(); const before = structuredClone(h.session.ledger);
  assert.throws(() => h.session.correct(correction(before, ' ')), { code: 'correction-rationale-required' });
  assert.throws(() => h.session.correct({ ...correction(before), type: 'classification', activityKind: 'income' }), /classification-amount-conflict/);
  assert.deepEqual(h.session.ledger, before); assert.equal(h.session.dirty, false);
});

test('concurrent starts are refused while verified loading remains pending', async () => {
  const h = await setup(); let finish; h.storage.connect = () => new Promise(resolve => { finish = () => { h.storage.lifecycle = h.lifecycle; resolve(); }; });
  const first = h.session.open(); await assert.rejects(h.session.open(), { code: 'operation-in-progress' });
  assert.equal(h.session.canEdit(), false); finish(); await first; assert.equal(h.session.canEdit(), true);
});

for (const layout of ['partitions-v5']) test(`${layout} workspace correction saves and reopens without conversion`, async () => {
  const h = await setup(layout); await h.session.open();
  assert.equal(h.session.store.layout, layout);
  h.session.correct(correction(h.session.ledger)); const proposal = structuredClone(h.session.ledger);
  await h.session.save(); await h.session.reopen();
  assert.equal(h.session.store.layout, layout); assert.deepEqual(h.session.ledger, proposal); assert.equal(h.calls.writes, 1);
});


for (const corrected of [false, true]) test(`local preview saves ${corrected ? 'the staged draft' : 'the untouched original year'} to a new empty folder and verifies an independent reopen`, async () => {
  const h = await setup('partitions-v5', true);
  h.session.preview(recipe.ledger);
  if (corrected) h.session.correct(correction(h.session.ledger));
  const proposal = structuredClone(h.session.ledger);
  await h.session.savePreviewToNewCopy();
  assert.deepEqual(h.calls.connects, [{ requireEmpty: true, canonicalLayout: 'partitions-v5' }]);
  assert.equal(h.calls.writes, 1);
  assert.equal(h.session.mode, 'saved');
  assert.equal(h.session.dirty, false);
  assert.equal(h.session.unverified, false);
  assert.equal(h.session.store.layout, 'partitions-v5');
  assert.deepEqual(h.session.ledger, proposal);
  await h.session.reopen();
  assert.deepEqual(h.session.ledger, proposal);
  assert.equal(h.calls.writes, 1);
});

test('transfer links are append-only, reciprocal in the effective view, and preserve original activities', async () => {
  const outgoing = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.checking && activity.sourceDescription === 'INVENTED SAVINGS TRANSFER OUT' &&
    activity.effectiveDate === '2025-01-16');
  const incoming = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.savings && activity.sourceDescription === 'INVENTED SAVINGS TRANSFER IN' &&
    activity.effectiveDate === '2025-01-16');
  const before = structuredClone(recipe.ledger);
  const linked = applyFinancialEvent(recipe.ledger, {
    type: 'transfer-link', activityId: outgoing.activityId, counterpartyActivityId: incoming.activityId,
    commandId: 'invented-transfer-link', evidence: { rationale: 'Matching invented transfer amount and date.' }
  });
  assert.equal(linked.events.length, before.events.length + 1);
  assert.deepEqual(linked.activities, before.activities);
  const effective = getEffectiveActivities(linked);
  const source = effective.find(activity => activity.activityId === outgoing.activityId);
  const destination = effective.find(activity => activity.activityId === incoming.activityId);
  assert.equal(source.transferRole, 'outgoing');
  assert.equal(destination.transferRole, 'incoming');
  assert.equal(source.transferGroupId, destination.transferGroupId);
  assert.equal(source.transferCounterpartyActivityId, destination.activityId);
  assert.equal(destination.transferCounterpartyActivityId, source.activityId);
  const period = [{ start: '2025-01-01', end: '2025-12-31', currency: 'USD' }];
  assert.deepEqual(summarizeLedgerPeriods(linked, period), summarizeLedgerPeriods(before, period));
  assert.throws(() => applyFinancialEvent(linked, {
    type: 'transfer-link', activityId: outgoing.activityId, counterpartyActivityId: incoming.activityId,
    commandId: 'invented-duplicate-transfer-link', evidence: { rationale: 'A second link must be refused.' }
  }), { message: 'invalid-transfer-link' });
  assert.throws(() => applyFinancialEvent(linked, {
    type: 'bank-correction', activityId: outgoing.activityId, amountText: '-610.00',
    commandId: 'invented-break-transfer-pair', evidence: { rationale: 'This one-sided correction must be rejected.' }
  }), { message: 'invalid-transfer-link' });
});

test('transfer linking rejects amount mismatches, same-account pairs and non-transfer activities', async () => {
  const outgoing = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.checking && activity.sourceDescription === 'INVENTED SAVINGS TRANSFER OUT' &&
    activity.effectiveDate === '2025-01-16');
  const incoming = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.savings && activity.sourceDescription === 'INVENTED SAVINGS TRANSFER IN' &&
    activity.effectiveDate === '2025-01-16');
  const rationale = { rationale: 'Invented manual confirmation.' };
  const changed = structuredClone(recipe.ledger);
  const changedIncoming = changed.activities.find(activity => activity.activityId === incoming.activityId);
  changedIncoming.amountMinor -= 1;
  assert.throws(() => applyFinancialEvent(changed, {
    type: 'transfer-link', activityId: outgoing.activityId, counterpartyActivityId: incoming.activityId,
    commandId: 'invented-mismatched-transfer', evidence: rationale
  }), { message: 'invalid-transfer-link' });
  const sameAccountTransfer = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.checking && activity.sourceDescription === 'INVENTED BROKERAGE CONTRIBUTION OUT' &&
    activity.effectiveDate === '2025-01-17');
  assert.throws(() => applyFinancialEvent(recipe.ledger, {
    type: 'transfer-link', activityId: outgoing.activityId, counterpartyActivityId: sameAccountTransfer.activityId,
    commandId: 'invented-same-account-transfer', evidence: rationale
  }), { message: 'invalid-transfer-link' });
  const nonTransfer = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.savings && activity.sourceDescription === 'INVENTED SAVINGS INTEREST' &&
    activity.effectiveDate === '2025-01-28');
  assert.throws(() => applyFinancialEvent(recipe.ledger, {
    type: 'transfer-link', activityId: outgoing.activityId, counterpartyActivityId: nonTransfer.activityId,
    commandId: 'invented-nontransfer', evidence: rationale
  }), { message: 'invalid-transfer-link' });
});


test('an uncertain fresh-copy write blocks retry and a verified reopen resolves the outcome', async () => {
  const h = await setup('partitions-v5', true);
  h.session.preview(recipe.ledger);
  const proposal = structuredClone(h.session.ledger);
  h.calls.loseResponse = true;
  await assert.rejects(h.session.savePreviewToNewCopy());
  assert.equal(h.session.mode, 'preview');
  assert.equal(h.session.unverified, true);
  assert.equal(h.session.canEdit(), false);
  await assert.rejects(h.session.savePreviewToNewCopy(), { message: 'verified-preview-required' });
  assert.equal(h.calls.writes, 1);
  h.calls.loseResponse = false;
  await h.session.reopen();
  assert.equal(h.session.mode, 'saved');
  assert.equal(h.session.unverified, false);
  assert.deepEqual(h.session.ledger, proposal);
  assert.equal(h.calls.writes, 1);
});

test('transfer-link events save and reopen through the existing canonical store', async () => {
  const h = await setup('partitions-v5');
  await h.session.open();
  const outgoing = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.checking && activity.sourceDescription === 'INVENTED SAVINGS TRANSFER OUT' &&
    activity.effectiveDate === '2025-01-16');
  const incoming = recipe.ledger.activities.find(activity =>
    activity.accountId === recipe.accounts.savings && activity.sourceDescription === 'INVENTED SAVINGS TRANSFER IN' &&
    activity.effectiveDate === '2025-01-16');
  h.session.linkTransfer({ outgoingActivityId: outgoing.activityId, counterpartyActivityId: incoming.activityId,
    rationale: 'Invented matching transfer confirmation.' });
  const proposal = structuredClone(h.session.ledger);
  await h.session.save();
  await h.session.reopen();
  assert.deepEqual(h.session.ledger, proposal);
  const effective = getEffectiveActivities(h.session.ledger);
  assert.equal(effective.find(activity => activity.activityId === outgoing.activityId).transferCounterpartyActivityId, incoming.activityId);
  assert.equal(effective.find(activity => activity.activityId === incoming.activityId).transferCounterpartyActivityId, outgoing.activityId);
});


test('preview persistence refuses an existing canonical copy without writing to it', async () => {
  const h = await setup('partitions-v5', false);
  h.session.preview(recipe.ledger);
  await assert.rejects(h.session.savePreviewToNewCopy(), { message: 'new-empty-folder-required' });
  assert.deepEqual(h.calls.connects, [{ requireEmpty: true, canonicalLayout: 'partitions-v5' }]);
  assert.equal(h.calls.writes, 0);
  assert.equal(h.session.mode, 'preview');
  assert.equal(h.session.unverified, false);
});

test('staged history can undo one change and revert all without changing the saved baseline', async () => {
  const h = await setup(); await h.session.open();
  const baseline = structuredClone(h.session.ledger);
  h.session.correct(correction(h.session.ledger, 'Invented first correction'));
  const first = structuredClone(h.session.ledger);
  h.session.correct({ ...correction(h.session.ledger, 'Invented second correction'), amountText: '-88.25' });
  const second = structuredClone(h.session.ledger);
  assert.equal(h.session.stagedHistory.length, 2);
  assert.equal(h.session.canUndo(), true);
  assert.equal(h.session.canRevertAll(), true);
  h.session.undoLastStagedChange();
  assert.deepEqual(h.session.ledger, first);
  assert.equal(h.session.dirty, true);
  assert.equal(h.session.stagedHistory.length, 1);
  h.session.revertAllStagedChanges();
  assert.deepEqual(h.session.ledger, baseline);
  assert.equal(h.session.dirty, false);
  assert.equal(h.session.stagedHistory.length, 0);
  assert.equal(h.session.canUndo(), false);
  assert.equal(h.session.canRevertAll(), false);
  assert.equal(h.calls.writes, 0);
  assert.equal(h.manifest.revision, '1');
  assert.notDeepEqual(second, baseline);
});

test('staged history is cleared only after verified save or verified reopen', async () => {
  const h = await setup(); await h.session.open();
  h.session.correct(correction(h.session.ledger));
  assert.equal(h.session.stagedHistory.length, 1);
  await h.session.save();
  assert.equal(h.session.stagedHistory.length, 0);
  assert.equal(h.session.canUndo(), false);
  h.session.correct(correction(h.session.ledger, 'Invented later correction'));
  const savedBaseline = structuredClone(h.session.baselineLedger);
  const staged = structuredClone(h.session.ledger);
  assert.notDeepEqual(staged, savedBaseline);
  await h.session.reopen();
  assert.deepEqual(h.session.ledger, savedBaseline);
  assert.equal(h.session.stagedHistory.length, 0);
  assert.equal(h.session.dirty, false);
  assert.equal(h.session.canUndo(), false);
});

function positionCommand(ledger, amountText = '1250.00') {
  return { type: 'balance-snapshot', accountId: ledger.accounts.find(account => account.accountType === 'checking').accountId,
    effectiveDate: '2025-12-31', amountText, basis: 'manual',
    source: { kind: 'manual', reference: 'INVENTED statement checked by fixture owner' } };
}

test('position updates stage locally, preserve observations and independently save/reopen', async () => {
  const h = await setup(); await h.session.open();
  const original = structuredClone(h.session.ledger);
  h.session.recordPosition(positionCommand(h.session.ledger));
  assert.equal(h.calls.writes, 0);
  assert.equal(h.session.dirty, true);
  assert.equal(h.session.ledger.positionEvents.length, 1);
  assert.deepEqual(h.session.ledger.observations, original.observations);
  assert.deepEqual(h.session.ledger.activities, original.activities);
  const proposed = structuredClone(h.session.ledger);
  await h.session.save(); await h.session.reopen();
  assert.deepEqual(h.session.ledger, proposed);
  assert.equal(h.session.canUndo(), false);
  assert.equal(h.calls.writes, 1);
});

test('mixed activity and position undo restores exact previous graphs including absent collection', async () => {
  const h = await setup(); h.session.preview(recipe.ledger);
  const original = structuredClone(h.session.ledger);
  assert.equal(Object.hasOwn(original, 'positionEvents'), false);
  h.session.recordPosition(positionCommand(h.session.ledger));
  const balanceOnly = structuredClone(h.session.ledger);
  h.session.correct(correction(h.session.ledger));
  const corrected = structuredClone(h.session.ledger);
  h.session.recordPosition({ ...positionCommand(h.session.ledger, '1275.00'), effectiveDate: '2026-01-01' });
  h.session.undoLastStagedChange(); assert.deepEqual(h.session.ledger, corrected);
  h.session.undoLastStagedChange(); assert.deepEqual(h.session.ledger, balanceOnly);
  h.session.undoLastStagedChange(); assert.deepEqual(h.session.ledger, original);
  assert.equal(h.session.dirty, false);
  h.session.recordPosition(positionCommand(h.session.ledger));
  h.session.revertAllStagedChanges(); assert.deepEqual(h.session.ledger, original);
});

test('invalid position evidence leaves the draft and undo history unchanged', async () => {
  const h = await setup(); h.session.preview(recipe.ledger);
  const original = structuredClone(h.session.ledger);
  assert.throws(() => h.session.recordPosition({ ...positionCommand(h.session.ledger), source: { kind: 'manual', reference: '' } }));
  assert.throws(() => h.session.recordPosition(positionCommand(h.session.ledger, 'not-a-number')));
  assert.deepEqual(h.session.ledger, original);
  assert.equal(h.session.stagedHistory.length, 0);
  assert.equal(h.session.dirty, false);
});

test('lost position save response retains proposal and blocks edits and retry until independent reopen', async () => {
  const h = await setup(); await h.session.open();
  h.session.recordPosition(positionCommand(h.session.ledger));
  const proposed = structuredClone(h.session.ledger);
  h.calls.loseResponse = true;
  await assert.rejects(h.session.save());
  assert.equal(h.session.unverified, true);
  assert.throws(() => h.session.recordPosition(positionCommand(h.session.ledger)), { code: 'reopen-before-editing' });
  await assert.rejects(h.session.save(), { code: 'verified-draft-required' });
  assert.equal(h.calls.writes, 1);
  assert.deepEqual(h.session.ledger, proposed);
  h.calls.loseResponse = false; await h.session.reopen();
  assert.deepEqual(h.session.ledger, proposed);
  assert.equal(h.session.ledger.positionEvents.length, 1);
});

test('a position-only local preview saves to a fresh synthetic copy and release blocks later edits', async () => {
  const h = await setup('partitions-v5', true); h.session.preview(recipe.ledger);
  h.session.recordPosition(positionCommand(h.session.ledger));
  const proposed = structuredClone(h.session.ledger);
  await h.session.savePreviewToNewCopy();
  await h.session.reopen(); assert.deepEqual(h.session.ledger, proposed);
  await h.session.release();
  assert.throws(() => h.session.recordPosition(positionCommand(h.session.ledger)), { code: 'reopen-before-editing' });
  assert.deepEqual(h.session.ledger, proposed);
});

test('manual synthetic liability creation and balances stage, undo and save through existing history rules', async () => {
  const h = await setup(); await h.session.open();
  const original = structuredClone(h.session.ledger);
  h.session.addAccount({ institutionId:'sofi', accountType:'mortgage', displayName:'Invented new mortgage', currency:'USD' });
  const accountOnly = structuredClone(h.session.ledger);
  const accountId = h.session.ledger.accounts.at(-1).accountId;
  h.session.recordPosition({ ...positionCommand(h.session.ledger,'75000.00'), accountId });
  assert.equal(h.session.ledger.positionEvents.at(-1).accountId,accountId);
  assert.equal(h.calls.writes,0);
  h.session.undoLastStagedChange(); assert.deepEqual(h.session.ledger,accountOnly);
  h.session.undoLastStagedChange(); assert.deepEqual(h.session.ledger,original);
  h.session.addAccount({ institutionId:'sofi', accountType:'auto-loan', displayName:'Invented new auto loan', currency:'USD' });
  h.session.recordPosition({ ...positionCommand(h.session.ledger,'8000.00'), accountId:h.session.ledger.accounts.at(-1).accountId });
  const proposed = structuredClone(h.session.ledger);
  await h.session.save(); await h.session.reopen();
  assert.deepEqual(h.session.ledger,proposed);
  assert.equal(h.session.canUndo(),false);
  assert.deepEqual(h.session.ledger.accounts.slice(0,original.accounts.length),original.accounts);
});

test('invalid or read-only account creation cannot change the canonical draft', async () => {
  const h = await setup(); await h.session.open();
  const original = structuredClone(h.session.ledger);
  assert.throws(()=>h.session.addAccount({ institutionId:'invented-unsupported',accountType:'mortgage',displayName:'Invented',currency:'USD' }));
  assert.deepEqual(h.session.ledger,original);assert.equal(h.session.stagedHistory.length,0);
  await h.session.release();
  assert.throws(()=>h.session.addAccount({ institutionId:'sofi',accountType:'mortgage',displayName:'Invented',currency:'USD' }),{code:'reopen-before-editing'});
  assert.deepEqual(h.session.ledger,original);
});

for (const layout of ['partitions-v5']) test(`${layout} explicit posting corrections save, reopen, undo and preserve original evidence`, async () => {
  const h = await setup(layout); await h.session.open();
  const activity = getEffectiveActivities(h.session.ledger).find(a => a.lifecycleStatus === 'unknown');
  const before = structuredClone(h.session.ledger);
  const command = {activityId:activity.activityId,type:'posting-status-correction',lifecycleStatus:'posted',
    postedDate:activity.effectiveDate,rationale:'Invented statement confirms posting'};
  h.session.correct(command);
  assert.equal(h.session.dirty,true); assert.equal(h.calls.writes,0);
  h.session.undoLastStagedChange();
  assert.deepEqual(h.session.ledger,before); assert.equal(h.session.dirty,false);
  h.session.correct(command);
  const proposal=structuredClone(h.session.ledger);
  await h.session.save(); await h.session.reopen();
  assert.deepEqual(h.session.ledger,proposal); assert.equal(h.calls.writes,1);
  assert.deepEqual(h.session.ledger.activities,before.activities);
  assert.deepEqual(h.session.ledger.observations,before.observations);
  const effective=getEffectiveActivities(h.session.ledger).find(a=>a.activityId===activity.activityId);
  assert.equal(effective.lifecycleStatus,'posted');assert.equal(effective.postedDate,activity.effectiveDate);
  h.session.correct({...command,lifecycleStatus:'unknown',postedDate:null,rationale:'Invented confirmation withdrawn'});
  h.session.revertAllStagedChanges();assert.deepEqual(h.session.ledger,proposal);
});
