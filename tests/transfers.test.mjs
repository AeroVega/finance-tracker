import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLedger, getEffectiveActivities, applyFinancialEvents, summarizeLedger} from '../js/canonical-import.mjs';
import {createWorkspaceViewReader, getWorkspaceActivity, transferCandidates} from '../js/canonical-workspace-model.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {applyRuleEvents, ruleTargets} from '../js/rule-records.mjs';
import {ruleCatalog} from '../js/rule-catalog.mjs';
import {planningLedger} from './helpers/planning-fixture.mjs';

// Invented rows: two checking-to-savings moves, still unclassified, and one paycheck.
const {ledger:base} = planningLedger({accounts:[{key:'checking', type:'checking'}, {key:'savings', type:'savings'}],
  coverage:{checking:{'2026-09':'2026-09-30'}, savings:{'2026-09':'2026-09-30'}},
  rows:[
    {account:'checking', date:'2026-09-03', amount:'-500.00', description:'INVENTED ONLINE TRANSFER TO SAV'},
    {account:'savings', date:'2026-09-04', amount:'500.00', description:'INVENTED ONLINE TRANSFER FROM CHK'},
    {account:'checking', date:'2026-09-20', amount:'-500.00', description:'INVENTED ONLINE TRANSFER TO SAV LATE'},
    {account:'savings', date:'2026-09-24', amount:'500.00', description:'INVENTED ONLINE TRANSFER FROM CHK LATE'},
    {account:'checking', date:'2026-09-15', amount:'2100.00', description:'INVENTED EMPLOYER PAYROLL', kind:'income'},
  ]});
const accountId = key => base.accounts.find(account => account.displayName === `Invented ${key}`).accountId;
const find = (ledger, text) => getEffectiveActivities(ledger).find(activity => activity.sourceDescription === text);
const code = expected => error => error.code === expected;
let n = 0;
const options = {now:'2026-11-20T12:00:00.000Z', idFactory:() => `00000000-0000-4000-b000-${String(++n).padStart(12, '0')}`};
const evidence = {rationale:'Invented transfer decision.'};
const apply = (ledger, ...commands) => applyFinancialEvents(ledger, commands.map(command => ({commandId:`transfer-${++n}`, evidence, ...command})), options);
const out = find(base, 'INVENTED ONLINE TRANSFER TO SAV'), into = find(base, 'INVENTED ONLINE TRANSFER FROM CHK');
const reasons = (ledger, activityId) => getWorkspaceActivity(ledger, activityId).activity.reviewReasons;
function session(ledger = base) {
  const value = new CanonicalWorkspaceSession({storage:{lifecycle:null}, online:() => true});
  value.preview(ledger);
  return value;
}

test('a transfer names its other account, stays in Needs review until linked, and is never income or spending', () => {
  let ledger = apply(base, {type:'classification', activityId:out.activityId, activityKind:'transfer'});
  assert.deepEqual(reasons(ledger, out.activityId), ['transfer-account-missing']);
  ledger = apply(ledger, {type:'transfer-account', activityId:out.activityId, counterpartyAccountId:accountId('savings')});
  assert.equal(validateLedger(ledger), true);
  assert.equal(find(ledger, out.sourceDescription).transferAccountId, accountId('savings'));
  assert.deepEqual(reasons(ledger, out.activityId), ['transfer-unmatched']);
  const row = createWorkspaceViewReader(ledger).view({reviewOnly:true, limit:50}).rows.find(item => item.activityId === out.activityId);
  assert.equal(row.transferAccountId, accountId('savings'));
  const september = {start:'2026-09-01', end:'2026-09-30', currency:'USD'};
  assert.equal(summarizeLedger(ledger, september).spending, '0', 'an unlinked transfer is still not spending');
  ledger = apply(ledger, {type:'classification', activityId:into.activityId, activityKind:'transfer'},
    {type:'transfer-link', activityId:out.activityId, counterpartyActivityId:into.activityId});
  assert.deepEqual(reasons(ledger, out.activityId), []);
  assert.deepEqual(reasons(ledger, into.activityId), []);
  assert.equal(getWorkspaceActivity(ledger, into.activityId).activity.transferAccountId, accountId('checking'), 'a link names each side for the other');
});

test('the other account must be another account, on a transfer, and is fixed once linked', () => {
  assert.throws(() => apply(base, {type:'transfer-account', activityId:out.activityId, counterpartyAccountId:accountId('savings')}), code('invalid-transfer-account'));
  const transfer = apply(base, {type:'classification', activityId:out.activityId, activityKind:'transfer'});
  assert.throws(() => apply(transfer, {type:'transfer-account', activityId:out.activityId, counterpartyAccountId:accountId('checking')}), code('invalid-transfer-account'));
  assert.throws(() => apply(transfer, {type:'transfer-account', activityId:out.activityId, counterpartyAccountId:'00000000-0000-4000-8000-999999999999'}), code('invalid-transfer-account'));
  // Reclassifying away from transfer drops the account.
  const named = apply(transfer, {type:'transfer-account', activityId:out.activityId, counterpartyAccountId:accountId('savings')});
  const spending = apply(named, {type:'classification', activityId:out.activityId, activityKind:'spending'});
  assert.equal(find(spending, out.sourceDescription).transferAccountId, undefined);
  // A linked transfer keeps the account of its other side.
  const linked = apply(named, {type:'classification', activityId:into.activityId, activityKind:'transfer'},
    {type:'transfer-link', activityId:out.activityId, counterpartyActivityId:into.activityId});
  assert.throws(() => apply(linked, {type:'transfer-account', activityId:into.activityId, counterpartyAccountId:accountId('savings')}), code('invalid-transfer-account'));
});

test('matching rows are the exact opposite amount in the chosen account within 7 days, nearest first', () => {
  const candidates = transferCandidates(base, out.activityId, accountId('savings'));
  assert.deepEqual(candidates.map(candidate => candidate.sourceDescription), ['INVENTED ONLINE TRANSFER FROM CHK']);
  const late = find(base, 'INVENTED ONLINE TRANSFER TO SAV LATE');
  assert.deepEqual(transferCandidates(base, late.activityId, accountId('savings')).map(candidate => candidate.sourceDescription),
    ['INVENTED ONLINE TRANSFER FROM CHK LATE'], 'the early row is 16 days away');
  assert.deepEqual(transferCandidates(base, out.activityId, accountId('checking')), []);
});

test('an inline decision names the account and links the matching row as one undoable step', () => {
  const s = session();
  s.quickClassify({activityId:out.activityId, activityKind:'transfer', transferAccountId:accountId('savings'), linkActivityId:into.activityId, rationale:'Invented review.'});
  const [left, right] = [find(s.ledger, out.sourceDescription), find(s.ledger, into.sourceDescription)];
  assert.deepEqual([left.activityKind, right.activityKind], ['transfer', 'transfer']);
  assert.equal(left.transferGroupId, right.transferGroupId);
  assert.equal(left.transferRole, 'outgoing');
  assert.equal(s.stagedHistory.length, 1);
  s.undoLastStagedChange();
  assert.deepEqual(s.ledger, base);
  // Deciding the incoming side links it the same way.
  const t = session();
  t.quickClassify({activityId:into.activityId, activityKind:'transfer', transferAccountId:accountId('checking'), linkActivityId:out.activityId, rationale:'Invented review.'});
  assert.equal(find(t.ledger, out.sourceDescription).transferRole, 'outgoing');
});

test('a transfer rule names the other account, and only transfer rules touch transfers', () => {
  let ledger = applyRuleEvents(base, [{type:'define', commandId:'rule-transfer', descriptionContains:'online transfer to sav', activityKind:'transfer', counterpartyAccountId:accountId('savings')}], options);
  const [rule] = ruleCatalog(ledger).rules;
  assert.equal(rule.counterpartyAccountId, accountId('savings'));
  assert.equal(ruleTargets(ledger).get(rule.ruleId).length, 2);
  const s = session(ledger);
  s.applyRules();
  const filed = find(s.ledger, out.sourceDescription);
  assert.deepEqual([filed.activityKind, filed.transferAccountId], ['transfer', accountId('savings')]);
  const spendingRule = applyRuleEvents(base, [{type:'define', commandId:'rule-bad', descriptionContains:'x', activityKind:'spending', counterpartyAccountId:accountId('savings')}], options);
  assert.equal(spendingRule.ruleEvents.at(-1).counterpartyAccountId, null, 'only a transfer rule keeps an account');
  // A spending rule never reclassifies a transfer that is waiting for its account.
  ledger = apply(base, {type:'classification', activityId:out.activityId, activityKind:'transfer'});
  ledger = applyRuleEvents(ledger, [{type:'define', commandId:'rule-spend', descriptionContains:'online transfer', activityKind:'spending'}], options);
  assert.equal(ruleTargets(ledger).get(ruleCatalog(ledger).rules[0].ruleId).some(activity => activity.activityId === out.activityId), false);
});
