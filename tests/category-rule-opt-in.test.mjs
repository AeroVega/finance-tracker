import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, getEffectiveActivities, validateLedger} from '../js/canonical-import.mjs';
import {webcrypto} from 'node:crypto';
import {createFullSnapshotStorage} from '../js/full-snapshot-storage.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';

// Owner decision 2026-11-25: a category correction becomes a rule for later
// imports only when the owner opts in. Invented data only.
const now = '2026-11-25T00:00:00.000Z';
const options = () => { let n = 0; return {now:() => now, idFactory:() => `f00d0002-0000-4000-8000-${String(++n).padStart(12, '0')}`}; };
const row = (i, overrides = {}) => ({sourceAccountKey:'default', sourceFields:{Description:'INVENTED CAFE', Amount:'-4.50', Row:String(i)},
  rowOrdinal:i + 1, physicalLine:i + 2, sourceDescription:'INVENTED CAFE', normalizedDescription:'invented cafe',
  sourceAction:'Card purchase', sourceRecordId:null, amountText:'-4.50', currency:'USD', effectiveDate:'2025-01-15',
  postedDate:null, settlementDate:null, lifecycleStatus:'posted', valid:true, errorCode:null, ...overrides});
const input = (account, records, fileFingerprint) => ({syntheticOnly:true,
  parsed:{sourceFormat:'sofi-csv-v1', institutionId:account.institutionId, fileFingerprint, rowsSeen:records.length, ignoredCount:0, records,
    sourceAccountKeys:['default'], sourceCoverage:null},
  accountMappings:{default:account.accountId}, coverageByAccount:{[account.accountId]:{start:'2025-01-01', end:'2025-12-31', provenance:'source-confirmed'}}});

function corrected(createRule) {
  const opt = options();
  let ledger = registerAccount(createLedger(opt), {institutionId:'sofi', name:'Invented rule account', currency:'USD', accountType:'checking'}, opt);
  ledger = prepareCanonicalImport(ledger, input(ledger.accounts[0], [row(0)], 'invented-first'), opt).ledger;
  const command = {type:'category-correction', activityId:ledger.activities[0].activityId, categoryId:'dining', commandId:'invented-category'};
  if (createRule !== undefined) command.createRule = createRule;
  ledger = applyFinancialEvent(ledger, command, opt);
  // A later export repeats the description on a different day.
  ledger = prepareCanonicalImport(ledger, input(ledger.accounts[0], [row(1, {effectiveDate:'2025-02-15'})], 'invented-later'), opt).ledger;
  return ledger;
}
const categories = ledger => getEffectiveActivities(ledger).map(activity => activity.categoryId);

test('a declined rule corrects only the chosen transaction and is recorded as declined', () => {
  const ledger = corrected(false);
  assert.deepEqual(categories(ledger), ['dining', null]);
  const rule = ledger.events.find(event => event.eventType === 'category-correction').prospectiveRule;
  assert.equal(rule.version, 2);
  assert.equal(rule.requested, false);
  assert.equal(rule.enabled, false);
  assert.deepEqual(rule.existingActivityIds, [ledger.activities[0].activityId]);
  assert.doesNotThrow(() => validateLedger(ledger));
});

test('an opted-in rule categorizes later imports, as the original always-on rule did', () => {
  const optedIn = corrected(true), legacy = corrected(undefined);
  assert.deepEqual(categories(optedIn), ['dining', 'dining']);
  assert.deepEqual(categories(legacy), ['dining', 'dining']);
  const rule = optedIn.events.find(event => event.eventType === 'category-correction').prospectiveRule;
  assert.deepEqual([rule.version, rule.requested, rule.enabled], [2, true, true]);
  assert.equal(legacy.events.find(event => event.eventType === 'category-correction').prospectiveRule.version, 1, 'saved version 1 rules keep their meaning');
});

test('rule choices are validated and cannot be flipped after the fact', () => {
  assert.throws(() => corrected('yes'), /invalid-prospective-category-rule/);
  const declined = corrected(false);
  const tampered = structuredClone(declined);
  tampered.events.find(event => event.eventType === 'category-correction').prospectiveRule.enabled = true;
  assert.throws(() => validateLedger(tampered), /invalid-prospective-category-rule/);
  const unflagged = structuredClone(declined);
  delete unflagged.events.find(event => event.eventType === 'category-correction').prospectiveRule.requested;
  assert.throws(() => validateLedger(unflagged), /invalid-prospective-category-rule/);
});

test('declined and opted-in rules survive a full-snapshot save and independent reopen', async () => {
  for (const ledger of [corrected(false), corrected(true)]) {
    const http = new HttpFullSnapshotDrive();
    const store = createFullSnapshotStorage({folderId:http.folderId, accessToken:() => 'invented-test-token', fetchImpl:http.fetch, cryptoImpl:webcrypto,
      visibilityDelayMs:0, setIntervalImpl:() => 1, clearIntervalImpl:() => {}});
    try {
      await store.start({initialize:true}); await store.save(ledger); await store.release();
      await store.start(); const reopened = await store.open();
      assert.deepEqual(reopened, ledger);
      assert.deepEqual(categories(reopened), categories(ledger));
    } finally { await store.release().catch(() => {}); }
  }
});
