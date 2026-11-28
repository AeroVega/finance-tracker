import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateLedger, getEffectiveActivities, prepareCanonicalImport, applyFinancialEvent} from '../js/canonical-import.mjs';
import {assertCanonicalLedgerTransition} from '../js/canonical-history.mjs';
import {ruleCatalog} from '../js/rule-catalog.mjs';
import {applyRuleEvents, ruleTargets} from '../js/rule-records.mjs';
import {applyCategoryEvents} from '../js/category-records.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {encodeFullSnapshotBackup, decodeFullSnapshotBackup} from '../js/full-snapshot-backup.mjs';
import {planningLedger} from './helpers/planning-fixture.mjs';

// Invented rows: unclassified grocery and payroll rows, and one row already filed by hand.
const {ledger:base} = planningLedger({accounts:[{key:'checking', type:'checking'}, {key:'card', type:'credit-card'}],
  coverage:{checking:{'2026-09':'2026-09-30'}, card:{'2026-09':'2026-09-30'}},
  rows:[
    {account:'checking', date:'2026-09-02', amount:'-41.20', description:'INVENTED FRESHMART #12 SPRINGFIELD'},
    {account:'checking', date:'2026-09-09', amount:'-18.75', description:'INVENTED FRESHMART #40 SHELBYVILLE'},
    {account:'checking', date:'2026-09-15', amount:'2100.00', description:'INVENTED EMPLOYER PAYROLL'},
    {account:'card', date:'2026-09-05', amount:'-9.99', description:'INVENTED FRESHMART ONLINE'},
    {account:'checking', date:'2026-09-20', amount:'-30.00', description:'INVENTED FRESHMART DELI', kind:'spending', category:'dining'},
  ]});
const accountId = key => base.accounts.find(account => account.displayName === `Invented ${key}`).accountId;
let n = 0;
const options = {now:'2026-11-20T12:00:00.000Z', idFactory:() => `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`};
const apply = (ledger, ...commands) => applyRuleEvents(ledger, commands.map((command, i) => ({commandId:`rule-${++n}-${i}`, ...command})), options);
const define = (descriptionContains, extra = {}) => ({type:'define', descriptionContains, activityKind:'spending', categoryId:'groceries', ...extra});
const code = expected => error => error.code === expected;
const byDescription = (ledger, text) => getEffectiveActivities(ledger).find(activity => activity.sourceDescription === text);
const targetDescriptions = (ledger, ruleId) => (ruleTargets(ledger).get(ruleId) ?? []).map(activity => activity.sourceDescription).sort();

function session(ledger = base) {
  const value = new CanonicalWorkspaceSession({storage:{lifecycle:null}, online:() => true});
  value.preview(ledger);
  return value;
}

test('a rule is an append-only record with a condition and an action', () => {
  const ledger = apply(base, define('  freshmart  ', {accountIds:[accountId('checking')]}));
  assert.equal(validateLedger(ledger), true);
  assertCanonicalLedgerTransition(base, ledger);
  const [rule] = ruleCatalog(ledger).rules;
  assert.deepEqual({text:rule.descriptionContains, accounts:rule.accountIds, kind:rule.activityKind, category:rule.categoryId, enabled:rule.enabled, position:rule.position},
    {text:'freshmart', accounts:[accountId('checking')], kind:'spending', category:'groceries', enabled:true, position:1});
  assert.throws(() => apply(base, define('   ')), code('rule-text-required'));
  assert.throws(() => apply(base, define('x', {accountIds:['00000000-0000-4000-8000-999999999999']})), code('invalid-rule-accounts'));
  assert.throws(() => apply(base, define('x', {activityKind:'unclassified'})), code('invalid-rule-action'));
  const rewritten = structuredClone(ledger); rewritten.ruleEvents[0].descriptionContains = 'other';
  assert.throws(() => assertCanonicalLedgerTransition(ledger, rewritten), code('history-rewrite-refused'));
});

test('a rule matches description text in any case, in its accounts, only where the type fits the amount', () => {
  const ledger = apply(base, define('FreshMart'), define('payroll', {activityKind:'income', categoryId:'paycheck'}));
  const [groceries, payroll] = ruleCatalog(ledger).rules;
  // The hand-filed deli row is not touched: it no longer needs review.
  assert.deepEqual(targetDescriptions(ledger, groceries.ruleId), ['INVENTED FRESHMART #12 SPRINGFIELD', 'INVENTED FRESHMART #40 SHELBYVILLE', 'INVENTED FRESHMART ONLINE']);
  assert.deepEqual(targetDescriptions(ledger, payroll.ruleId), ['INVENTED EMPLOYER PAYROLL']);
  const limited = apply(base, define('freshmart', {accountIds:[accountId('card')]}));
  assert.deepEqual(targetDescriptions(limited, ruleCatalog(limited).rules[0].ruleId), ['INVENTED FRESHMART ONLINE']);
  // Income never files money out.
  const wrong = apply(base, define('freshmart', {activityKind:'income'}));
  assert.deepEqual(targetDescriptions(wrong, ruleCatalog(wrong).rules[0].ruleId), []);
});

test('rules run in order, the first match wins, and a rule that is off or lost its category is skipped', () => {
  let ledger = apply(base, define('freshmart'), define('freshmart online', {categoryId:'shopping'}));
  const [broad, narrow] = ruleCatalog(ledger).rules;
  assert.equal(targetDescriptions(ledger, narrow.ruleId).length, 0, 'the broad rule is first');
  ledger = apply(ledger, {type:'order', ruleIds:[narrow.ruleId, broad.ruleId]});
  assert.deepEqual(targetDescriptions(ledger, narrow.ruleId), ['INVENTED FRESHMART ONLINE']);
  assert.equal(targetDescriptions(ledger, broad.ruleId).length, 2);
  assert.throws(() => apply(ledger, {type:'order', ruleIds:[broad.ruleId]}), code('invalid-rule-order'));
  const off = apply(ledger, {type:'define', ruleId:narrow.ruleId, descriptionContains:'freshmart online', activityKind:'spending', categoryId:'shopping', enabled:false});
  assert.equal(targetDescriptions(off, broad.ruleId).length, 3);
  const lost = applyCategoryEvents(ledger, [{type:'delete', categoryId:'shopping', commandId:'delete-shopping'}], options);
  assert.equal(targetDescriptions(lost, broad.ruleId).length, 3);
  assert.deepEqual(targetDescriptions(lost, narrow.ruleId), []);
});

test('applying rules files only the rows that need review, records the rule, and is one undoable step', () => {
  const ledger = apply(base, define('freshmart'), define('payroll', {activityKind:'income', categoryId:'paycheck'}));
  const s = session(ledger);
  assert.equal(s.applyRules(), 4);
  const filed = byDescription(s.ledger, 'INVENTED FRESHMART ONLINE');
  assert.deepEqual([filed.activityKind, filed.categoryId], ['spending', 'groceries']);
  assert.deepEqual([byDescription(s.ledger, 'INVENTED EMPLOYER PAYROLL').activityKind, byDescription(s.ledger, 'INVENTED EMPLOYER PAYROLL').categoryId], ['income', 'paycheck']);
  assert.equal(byDescription(s.ledger, 'INVENTED FRESHMART DELI').categoryId, 'dining', 'a hand-filed row keeps its category');
  const event = s.ledger.events.at(-1);
  assert.equal(event.evidence.ruleId, ruleCatalog(ledger).rules[1].ruleId);
  assert.match(event.evidence.rationale, /^Filed by rule: description contains "payroll"\.$/);
  assert.equal(s.stagedHistory.length, 1);
  assert.throws(() => s.applyRules(), code('no-rule-matches'), 'filed rows no longer need review');
  s.undoLastStagedChange();
  assert.deepEqual(s.ledger, ledger);
});

test('editing or deleting a rule leaves the rows it already filed alone', () => {
  const s = session(apply(base, define('freshmart')));
  const [rule] = ruleCatalog(s.ledger).rules;
  s.applyRules([rule.ruleId]);
  s.manageRules({type:'define', ruleId:rule.ruleId, descriptionContains:'freshmart', activityKind:'spending', categoryId:'household'});
  s.manageRules({type:'delete', ruleId:rule.ruleId});
  assert.equal(byDescription(s.ledger, 'INVENTED FRESHMART ONLINE').categoryId, 'groceries');
  assert.equal(ruleCatalog(s.ledger).rules.length, 0);
  assert.throws(() => s.manageRules({type:'define', ruleId:rule.ruleId, descriptionContains:'x', activityKind:'spending'}), code('unknown-rule'));
});

// One more invented month for an account, as a CSV import would prepare it.
function importMonth(ledger, key, month, rows) {
  const parsed = {sourceFormat:'sofi-csv-v1', institutionId:'sofi', fileFingerprint:`invented-${key}-${month}-${rows.length}`, rowsSeen:rows.length, ignoredCount:0, sourceAccountKeys:['default'],
    records:rows.map((row, i) => ({sourceAccountKey:'default', sourceFields:{Amount:row.amount, Row:`${key}-${month}-${i}`}, rowOrdinal:i + 1, physicalLine:i + 2,
      sourceDescription:row.description, normalizedDescription:row.description.toLowerCase(), sourceAction:'Payment', sourceRecordId:null,
      amountText:row.amount, currency:'USD', effectiveDate:row.date, postedDate:row.date, settlementDate:null, lifecycleStatus:'posted', valid:true, errorCode:null}))};
  return prepareCanonicalImport(ledger, {syntheticOnly:true, parsed, accountMappings:{default:accountId(key)},
    coverageByAccount:{[accountId(key)]:{start:`${month}-01`, end:`${month}-28`, provenance:'user-confirmed'}}}, options).ledger;
}

test('a staged import is filed by rules in the same step', () => {
  const s = session(apply(base, define('freshmart')));
  s.stageCanonicalImport(importMonth(s.ledger, 'checking', '2026-10', [{date:'2026-10-03', amount:'-22.10', description:'INVENTED FRESHMART #12 SPRINGFIELD OCT'}]));
  assert.equal(s.lastImportFiledCount, 1);
  const row = byDescription(s.ledger, 'INVENTED FRESHMART #12 SPRINGFIELD OCT');
  assert.deepEqual([row.activityKind, row.categoryId], ['spending', 'groceries']);
  assert.equal(byDescription(s.ledger, 'INVENTED FRESHMART ONLINE').activityKind, 'unclassified', 'an import files only its own new rows');
  assert.equal(s.stagedHistory.length, 1);
});

test('retiring a correction rule stops it for later imports and keeps what it already filed', () => {
  const target = byDescription(base, 'INVENTED FRESHMART #12 SPRINGFIELD');
  let ledger = applyFinancialEvent(base, {type:'category-correction', activityId:target.activityId, categoryId:'groceries', createRule:true,
    commandId:'invented-correction-rule', evidence:{rationale:'Invented correction.'}}, options);
  const description = 'INVENTED FRESHMART #12 SPRINGFIELD';
  ledger = importMonth(ledger, 'checking', '2026-10', [{date:'2026-10-03', amount:'-22.10', description}]);
  const inherited = () => getEffectiveActivities(ledger).filter(activity => activity.sourceDescription === description && activity.effectiveDate >= '2026-10-01');
  assert.equal(inherited()[0].categoryId, 'groceries', 'the old rule reaches a later import');
  const [legacy] = ruleCatalog(ledger).legacy;
  assert.equal(legacy.ruleEventId, ledger.events.find(event => event.commandId === 'invented-correction-rule').eventId);
  ledger = apply(ledger, {type:'retire-legacy', ruleEventId:legacy.ruleEventId});
  assert.equal(ruleCatalog(ledger).legacy.length, 0);
  assert.equal(inherited()[0].categoryId, 'groceries', 'retiring keeps what the rule already filed');
  ledger = importMonth(ledger, 'checking', '2026-11', [{date:'2026-11-03', amount:'-19.10', description}]);
  assert.deepEqual(inherited().map(activity => activity.categoryId), ['groceries', null]);
  assert.equal(validateLedger(ledger), true);
  assert.throws(() => apply(ledger, {type:'retire-legacy', ruleEventId:legacy.ruleEventId}), code('unknown-rule'));
});

test('rule records survive an encrypted backup and an import cannot change them', async () => {
  const ledger = apply(base, define('freshmart'));
  const bytes = await encodeFullSnapshotBackup(ledger, {cryptoImpl:webcrypto, password:'invented password 1234'});
  assert.deepEqual(await decodeFullSnapshotBackup(bytes, {cryptoImpl:webcrypto, password:'invented password 1234'}), ledger);
  assert.throws(() => session(base).stageCanonicalImport(apply(base, define('freshmart'))), code('invalid-parsed-import'));
});
