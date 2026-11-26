import {createDriveRequestMetrics} from '../js/drive-request-metrics.mjs';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {createWorkspacePages} from '../js/workspace-pages.mjs';
import {buildFinancialPosition, buildAccountMonthCoverage} from '../js/financial-position.mjs';
import {createSyntheticFinancialPosition} from '../js/synthetic-financial-position.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createWorkspaceViewReader, getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {googleStartupMessage} from '../js/google-startup-diagnostics.mjs';
import {registerAccount, prepareCanonicalImport, applyReviewDecision, getEffectiveActivities} from '../js/canonical-import.mjs';
import {exactSignedDecimal, isCalendarDate} from '../js/import-reconciliation.mjs';
import {replayFixture, replayInput, replayRow} from './helpers/ledger-replay-fixtures.mjs';
import {pageController, deferred} from './helpers/page-controller.mjs';
const records = page => page.get('transaction-rows').children.filter(row => row.className === 'transaction-record');

const recipe = await createSyntheticFinancialYear();
const text = element => [element.textContent, ...element.children.map(text)].join(' ');

async function workspacePage({ledger = recipe.ledger} = {}) {
  const state = {connects:[],writes:0,snapshotReads:0,releases:0,recovers:0,connectionError:null,saveGate:null,readbackGate:null,
    loseResponse:false,failSave:false,releaseVerified:true,snapshotError:false,recoveryGate:null};
  let storage, session, browserNavigator, lifecycle, http;
  const timeouts = new Map();
  const timers = { setTimeout(callback, delay) { timeouts.set(callback, delay); return callback; }, clearTimeout(callback) { timeouts.delete(callback); } };
  const flushSearch = async () => { const callbacks = [...timeouts.keys()]; timeouts.clear(); for (const callback of callbacks) await callback(); };
  const createCopy=async(seed)=>{
    http=new HttpFullSnapshotDrive();
    lifecycle=new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,
      lifecycleTarget:null,isOnline:()=>browserNavigator?.onLine!==false,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},visibilityDelayMs:0,
      onStatus:status=>storage?.options.onStatus(status)});
    await lifecycle.start({initialize:true});
    if(seed){const initial=lifecycle.createLedgerStore();await initial.load();await initial.save(seed);}
    // Action gates/failures wrap real persisted full-snapshot operations; these
    // test controller behavior, not provider interruption timing.
    const read=lifecycle.load.bind(lifecycle),save=lifecycle.save.bind(lifecycle),recover=lifecycle.recover.bind(lifecycle);
    lifecycle.load=async()=>{
      state.snapshotReads++;
      if(state.openGate)await state.openGate.promise;
      if(state.snapshotError)throw Object.assign(new Error('Private provider body'),{code:'snapshot-unavailable'});
      return read();
    };
    lifecycle.save=async next=>{
      if(state.saveGate)await state.saveGate.promise;
      if(state.measureSave)await state.measureSave();
      if(state.failSave)throw Object.assign(new Error('Private provider detail'),{code:'base-conflict'});
      const result=await save(next);state.writes++;
      if(state.readbackGate)await state.readbackGate.promise;
      if(state.loseResponse){lifecycle.state='recovery-required';lifecycle.acceptingWrites=false;storage.options.onStatus({state:lifecycle.state});throw Object.assign(new Error('Private lost commit response'),{code:'write-unresolved'});}
      return result;
    };
    lifecycle.recover=async()=>{state.recovers++;if(state.recoveryGate)await state.recoveryGate.promise;return recover();};
  };
  await createCopy(ledger);
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; this.accessToken = 'invented-token'; storage = this; }
    async prepare() {}
    async connect(options) {
      state.connects.push(options);
      if (state.connectionError) {
        if (state.publishCandidateFailure) {
          this.options.onStatus({state:'connecting'});
          this.options.onStatus({state:'error',code:state.connectionError});
        }
        throw Object.assign(new Error('Private provider detail'), {code:state.connectionError});
      }
      if (options.requireEmpty === true) {
        assert.equal(options.requireExisting, undefined);
        await createCopy(null);
      } else {
        assert.equal(options.requireExisting, true);
        assert.equal(options.requireEmpty, undefined);
      }
      this.lifecycle = lifecycle; lifecycle.state = 'ready'; lifecycle.acceptingWrites = true;
      this.options.onStatus({state:'ready'});
    }
    createLedgerStore(){return this.lifecycle.createLedgerStore();}
    async release() {
      state.releases++;
      if (state.releaseVerified) { await lifecycle.release(); this.lifecycle = null; this.options.onStatus({state:'disconnected'}); }
      return {released:state.releaseVerified};
    }
    async recoverStaleSession() { await lifecycle.recover(); }
  }
  class BrowserSession extends CanonicalWorkspaceSession {
    constructor(options) { super({...options, online:() => browserNavigator?.onLine !== false}); session = this; }
    async stageHistoricalReconciliation(options) {
      if (state.historyReconciliationGate) await state.historyReconciliationGate.promise;
      return super.stageHistoricalReconciliation(options);
    }
  }
  const page = await pageController('canonical-workspace', {DashboardSyntheticStorage:Storage,
    CanonicalWorkspaceSession:BrowserSession, createWorkspacePages, createWorkspaceViewReader: (...args) => {
      const reader = createWorkspaceViewReader(...args);
      return {...reader, view(options) {
        if (options.pageSize === 4) state.homeReads = (state.homeReads || 0) + 1;
        return reader.view(options);
      }};
    },getWorkspaceActivity,getEffectiveActivities,exactSignedDecimal,isCalendarDate,buildFinancialPosition,buildAccountMonthCoverage,createSyntheticFinancialPosition,createSyntheticFinancialYear,googleStartupMessage,TypeError},
  {htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs',timers});
  browserNavigator = page.navigator;
  return {...page,state,get manifest(){return lifecycle.engine.verifiedManifest;},storage,get lifecycle(){return lifecycle;},modelSession:session,timeouts,flushSearch,
    summary:() => text(page.get('summary-cards')),
    async search(value) { page.get('transaction-search').value = value; await page.get('transaction-search').emit('input'); await flushSearch(); },
    async detail(description = 'INVENTED UTILITY') {
      await page.navigate('#transactions');
      await page.choose('month-filter', '2025-01');
      page.get('transaction-search').value = description; await page.get('transaction-search').emit('input'); await flushSearch();
      const row = records(page)[0]; assert.ok(row, 'Expected an activity row');
      await row.children.at(-1).children[0].click();
    },
    async stageAmount(value = '-150.00') {
      await this.detail(); await page.choose('correction-type', 'bank-correction');
      page.get('amount').value = value;
      page.get('correction-rationale').value = 'Invented corrected utility receipt';
      await page.get('correction-rationale').emit('input');
      await page.click('stage-correction');
    },
    async replaceSavedLedger(next) { await createCopy(next); storage.lifecycle=lifecycle; },
    async storedLedger() { return lifecycle.createLedgerStore().load(); },
  };
}

test('main workspace load and local preview cannot connect, persist or silently initialize a copy', async () => {
  const h = await workspacePage();
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('release-ledger').disabled, true);
  assert.deepEqual(h.state.connects, []);
  await h.click('preview-year');
  assert.match(h.summary(), /\$73,739\.50/);
  assert.match(h.summary(), /\$30,381\.00/);
  assert.equal(h.get('transaction-count').textContent, '253');
  assert.equal(records(h).length, 50);
  assert.equal(h.get('page-status').textContent, 'Showing 50 of 253');
  assert.match(h.get('save-state').textContent, /Local preview only/);
  assert.deepEqual(h.state.connects, []);
  assert.equal(h.state.snapshotReads, 0);
  assert.equal(h.state.writes, 0);
  assert.equal(h.session.size, 0);
  await h.stageAmount();
  assert.match(h.get('save-state').textContent, /Staged local preview changes/);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.state.writes, 0);
  assert.equal(h.intervals.size, 0);
});

test('account and month change totals while search, review and pagination change only visible rows', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const annual = h.summary();
  await h.search('utility');
  assert.equal(records(h).length, 12);
  assert.equal(h.summary(), annual);
  await h.search(''); await h.choose('review-only', true);
  assert.match(h.get('filter-count').textContent, /48 matching activities of 253/);
  assert.equal(h.summary(), annual);
  assert.equal(records(h).length, 48);
  assert.equal(h.get('show-more').hidden, true);
  assert.equal(h.get('page-status').textContent, 'Showing 48 of 48');
  assert.equal(h.summary(), annual);
  await h.choose('review-only', false); await h.choose('month-filter', '2025-01');
  assert.match(h.summary(), /\$2,471\.25/);
  assert.equal(h.get('transaction-count').textContent, '21');
  await h.choose('account-filter', recipe.accounts.card);
  assert.match(h.summary(), /\$366\.25/);
  assert.equal(h.get('transaction-count').textContent, '7');
  assert.match(h.summary(), /Known cash movement.*Unavailable/);
  await h.choose('account-filter', recipe.accounts.investment);
  assert.equal(h.get('transaction-count').textContent, '4');
  assert.doesNotMatch(h.summary(), /\$0\.00/);
  assert.equal((h.summary().match(/Unavailable/g) || []).length, 3);
  await h.search('no-results');
  assert.equal(h.get('empty-state').hidden, false);
  assert.equal(h.get('transaction-table-wrap').hidden, true);
  assert.equal(h.get('page-status').textContent, 'No transactions to display');
  assert.equal(h.state.writes, 0);
});

test('switching to an account without selected-month coverage keeps the selected scope visible', async () => {
  let {ledger, options} = replayFixture();
  ledger = registerAccount(ledger, {institutionId:'sofi',displayName:'Invented no coverage',currency:'EUR',accountType:'savings'}, options);
  const emptyAccount = ledger.accounts.at(-1).accountId;
  const h = await workspacePage({ledger}); await h.click('open-ledger');
  await h.choose('month-filter', '2026-01'); await h.choose('account-filter', emptyAccount);
  assert.equal(h.get('month-filter').value, '2026-01');
  assert.match(h.get('summary-scope').textContent, /2026-01-01 to 2026-01-31/);
  assert.match(h.get('summary-scope').textContent, /Invented no coverage/);
  assert.match(h.get('coverage-summary').textContent, /^0 import runs/);
  assert.equal((h.summary().match(/Unavailable/g) || []).length, 3);
  assert.equal(h.get('transaction-count').textContent, '0');
  await h.choose('month-filter', '');
  assert.match(h.get('summary-scope').textContent, /No start date to No end date/);
});

test('detail lazily exposes original evidence and staging requires an explicit later save', async () => {
  const h = await workspacePage(); await h.click('open-ledger');
  assert.deepEqual(h.state.connects, [{requireExisting:true}]);
  assert.equal(h.lifecycle.fullSnapshot, true);
  assert.equal(h.modelSession.store.valueCodec, 'full-snapshot-v1');
  assert.equal(h.state.writes, 0);
  await h.detail();
  assert.equal(h.get('activity-detail').hidden, false);
  assert.equal(h.get('detail-amount').textContent, '-$160.00');
  const evidence = h.get('detail-source').children[0].children.at(-1);
  assert.equal(evidence.tagName, 'DETAILS');
  assert.equal(evidence.children.length, 1);
  evidence.open = true; await evidence.emit('toggle');
  assert.match(text(evidence), /-165\.00/);
  assert.match(text(h.get('detail-history')), /bank correction/);
  assert.equal(h.get('stage-correction').disabled, true);
  await h.stageAmount();
  assert.equal(h.get('detail-amount').textContent, '-$150.00');
  assert.equal(h.get('save-ledger').disabled, false);
  assert.equal(h.get('save-state').dataset.state, 'dirty');
  assert.match(h.get('save-state').textContent, /1 staged change/);
  assert.equal(h.state.writes, 0);
  assert.deepEqual(h.modelSession.ledger.activities, recipe.ledger.activities);
  assert.deepEqual(h.modelSession.ledger.observations, recipe.ledger.observations);
  const proposed = structuredClone(h.modelSession.ledger);
  await h.click('save-ledger');
  assert.equal(h.state.writes, 1);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('save-state').textContent, 'All changes saved and verified.');
  assert.deepEqual(await h.storedLedger(), proposed);
  await h.click('reopen-ledger');
  assert.deepEqual(h.modelSession.ledger, proposed);
  assert.equal(h.state.writes, 1);
  assert.equal(h.get('activity-detail').hidden, true);
  assert.equal(h.get('action-status').dataset.kind, 'success');
});

for (const code of ['authorization-cancelled', 'picker-cancelled']) test(`${code} leaves local records unchanged and makes no financial write`, async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const before = structuredClone(h.modelSession.ledger);
  h.state.connectionError = code; await h.click('open-ledger');
  assert.equal(h.storage.lifecycle, null);
  assert.equal(h.state.snapshotReads, 0);
  assert.equal(h.state.writes, 0);
  assert.deepEqual(h.modelSession.ledger, before);
  assert.equal(h.get('action-status').dataset.kind, 'error');
  assert.doesNotMatch(h.get('action-status').textContent, /Private provider/);
  assert.equal(h.get('preview-year').disabled, false);
  h.state.connectionError = null; await h.click('open-ledger');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.deepEqual(h.modelSession.ledger, recipe.ledger);
});

test('cancelled draft replacement and release preserve unsaved corrections without storage actions', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposal = structuredClone(h.modelSession.ledger);
  const reads = h.state.snapshotReads, connects = h.state.connects.length;
  h.observed.confirm = false;
  await h.click('reopen-ledger'); await h.click('open-ledger'); await h.click('release-ledger');
  assert.equal(h.state.snapshotReads, reads);
  assert.equal(h.state.connects.length, connects);
  assert.equal(h.state.releases, 0);
  assert.equal(h.state.writes, 0);
  assert.deepEqual(h.modelSession.ledger, proposal);
  assert.equal(h.observed.confirmations.length, 3);
  assert.equal(h.get('save-state').dataset.state, 'dirty');
});

test('pending save gates repeat actions and page-exit warnings until commit and verified readback finish', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  h.state.saveGate = deferred(); h.state.readbackGate = deferred();
  const pending = h.click('save-ledger');
  await h.until(() => h.modelSession.busy);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('open-ledger').disabled, true);
  assert.equal(h.get('account-filter').disabled, true);
  await h.click('save-ledger'); await h.click('open-ledger'); await h.click('release-ledger');
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.connects.length, 1);
  assert.equal(h.state.releases, 0);
  assert.notEqual(h.get('action-status').dataset.kind, 'success');
  const warning = {preventDefault() { this.prevented = true; }};
  await h.event('beforeunload', warning); assert.equal(warning.prevented, true);
  h.state.saveGate.resolve();
  await h.until(() => h.state.writes === 1);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.notEqual(h.get('action-status').dataset.kind, 'success');
  assert.equal(h.modelSession.dirty, true);
  h.state.readbackGate.resolve(); await pending;
  assert.equal(h.state.writes, 1);
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.equal(h.modelSession.dirty, false);
  assert.equal(h.intervals.size, 0);
});

for (const committed of [false, true]) test(`${committed ? 'lost commit response is automatically verified' : 'rejected save retains draft until verified reopen'}`, async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposed = structuredClone(h.modelSession.ledger);
  h.state.loseResponse = committed; h.state.failSave = !committed;
  await h.click('save-ledger');
  assert.equal(h.state.writes, committed ? 1 : 0);
  if(committed){assert.equal(h.modelSession.recoveryOutcome,'saved');assert.equal(h.modelSession.unverified,false);assert.deepEqual(h.modelSession.ledger,proposed);assert.equal(h.get('save-ledger').disabled,true);assert.equal(h.state.recovers,1);return;}
  // The save failed before any attempt or write and Drive still holds the base:
  // proven not saved. Blind save and edits stay blocked; only confirmed retry is offered.
  assert.equal(h.modelSession.recoveryOutcome, 'not-saved');
  assert.equal(h.get('save-state').dataset.state, 'dirty');
  assert.equal(h.get('action-status').dataset.kind, 'error');
  assert.match(h.get('save-state').textContent, /conclusively not published/);
  assert.equal(h.get('retry-save').disabled, false);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('stage-correction').disabled, true);
  assert.deepEqual(h.modelSession.ledger, proposed);
  await h.click('save-ledger');
  assert.equal(h.state.writes, committed ? 1 : 0);
  h.state.loseResponse = false; h.state.failSave = false;
  await h.click('reopen-ledger');
  assert.equal(h.get('save-state').dataset.state, 'clean');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.deepEqual(h.modelSession.ledger, committed ? proposed : recipe.ledger);
  assert.equal(h.state.writes, committed ? 1 : 0);
});

test('failed release remains selected and read-only until verified closure', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposed = structuredClone(h.modelSession.ledger);
  h.state.releaseVerified = false; await h.click('release-ledger');
  assert.equal(h.state.releases, 1);
  assert.equal(h.storage.lifecycle, h.lifecycle);
  assert.equal(h.get('action-status').dataset.kind, 'error');
  assert.match(h.get('action-status').textContent, /Release was not verified/);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.storage.accessToken, 'invented-token');
  assert.deepEqual(h.modelSession.ledger, proposed);
  h.state.releaseVerified = true; await h.click('release-ledger');
  assert.equal(h.storage.lifecycle, null);
  assert.equal(h.storage.accessToken, '');
  assert.equal(h.get('preview-year').disabled, false);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('stage-correction').disabled, true);
  assert.equal(h.get('data-mode').textContent, 'Synthetic workspace');
  assert.equal(h.modelSession.ledger, null);
  for (const id of ['transaction-rows','summary-cards','recent-activities','detail-source','detail-history','position-accounts','position-totals','review-queue']) assert.equal(h.get(id).children.length, 0, id);
  for (const id of ['detail-title','detail-description','detail-amount','amount','correction-rationale','backup-password','restore-password']) assert.equal(h.get(id).value || h.get(id).textContent, '', id);
  assert.equal(h.state.writes, 0);
});

test('offline keeps visible records but blocks saved-copy edits until online reopen', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposed = structuredClone(h.modelSession.ledger), summary = h.summary();
  h.navigator.onLine = false; await h.event('offline');
  assert.equal(h.summary(), summary);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('open-ledger').disabled, true);
  assert.equal(h.get('reopen-ledger').disabled, true);
  assert.equal(h.get('stage-correction').disabled, true);
  await h.click('save-ledger'); assert.equal(h.state.writes, 0);
  h.navigator.onLine = true; await h.event('online');
  assert.equal(h.get('open-ledger').disabled, false);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.deepEqual(h.modelSession.ledger, proposed);
  await h.click('reopen-ledger');
  assert.deepEqual(h.modelSession.ledger, recipe.ledger);
  assert.equal(h.modelSession.canEdit(), true);
});

test('invalid classification preserves the current graph and reports no staged change', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.detail();
  const before = structuredClone(h.modelSession.ledger);
  await h.choose('correction-type', 'classification'); await h.choose('classification', 'income');
  h.get('correction-rationale').value = 'Invented invalid classification'; await h.get('correction-rationale').emit('input');
  await h.click('stage-correction');
  assert.equal(h.get('action-status').dataset.kind, 'error');
  assert.match(h.get('action-status').textContent, /classification conflicts with the amount/);
  assert.deepEqual(h.modelSession.ledger, before);
  assert.equal(h.modelSession.dirty, false);
  assert.equal(h.state.writes, 0);
  await h.click('close-detail');
  assert.equal(h.get('activity-detail').hidden, true);
  assert.equal(h.observed.focused, records(h)[0].children.at(-1).children[0]);
});

test('a positive spending correction stays visible in review with its financial exclusion explained', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount('160.00');
  assert.equal(h.get('detail-amount').textContent, '$160.00');
  assert.match(h.get('detail-description').textContent, /Needs review:/);
  await h.choose('review-only', true);
  assert.equal(records(h).length, 1);
  assert.match(text(h.get('transaction-rows')), /Needs review:/);
  assert.match(h.summary(), /\$2,311\.25/);
  assert.equal(h.modelSession.dirty, true);
  assert.equal(h.state.writes, 0);
});

test('cancelled reopening explicitly announces cancellation without suggesting ongoing work', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const previousSuccess=h.get('success-metrics').textContent;
  h.observed.confirm = false;
  h.get('transaction-search').value = 'nothing matches'; await h.get('transaction-search').emit('input');
  await h.click('reopen-ledger');
  assert.equal(h.timeouts.size, 0);
  assert.equal(records(h).length, 0);
  assert.match(h.get('action-status').textContent, /cancelled/i);
  assert.doesNotMatch(h.get('action-status').textContent, /Reopening and verifying/);
  assert.equal(h.modelSession.dirty, true);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.get('success-metrics').textContent,previousSuccess);
});

test('recovery controls are disabled offline and reject manually dispatched clicks', async () => {
  const h = await workspacePage(); await h.click('open-ledger');
  h.lifecycle.state = 'recovery-required'; h.lifecycle.acceptingWrites = false;
  h.navigator.onLine = false; await h.event('offline');
  assert.equal(h.get('recover-ledger').disabled, true);
  await h.get('recover-ledger').emit('click');
  assert.equal(h.state.recovers, 0);
  h.lifecycle.state = 'stale-session'; await h.event('offline');
  assert.equal(h.get('recover-stale').disabled, true);
  await h.get('recover-stale').emit('click');
  assert.equal(h.state.recovers, 0);
});

test('unknown provider error codes cannot echo identifiers into the workspace status', async () => {
  const h = await workspacePage();
  h.state.connectionError = 'private-provider-account-identifier';
  await h.click('open-ledger');
  assert.equal(h.get('action-status').dataset.kind, 'error');
  assert.doesNotMatch(h.get('action-status').textContent, /private-provider-account-identifier/);
  assert.match(h.get('action-status').textContent, /Action did not complete/);
});

test('typing coalesces into one search and respects composition without changing financial totals', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const summary = h.summary(), rows = h.get('transaction-rows').children;
  for (const value of ['u', 'ut', 'util', 'utility']) {
    h.get('transaction-search').value = value; await h.get('transaction-search').emit('input');
  }
  assert.equal(h.timeouts.size, 1);
  assert.equal([...h.timeouts.values()][0], 120);
  assert.equal(h.get('transaction-rows').children, rows);
  await h.flushSearch();
  assert.equal(records(h).length, 12);
  assert.equal(h.summary(), summary);
  await h.get('transaction-search').emit('compositionstart');
  h.get('transaction-search').value = 'unmatched invented'; await h.get('transaction-search').emit('input');
  assert.equal(h.timeouts.size, 0);
  assert.equal(records(h).length, 12);
  await h.get('transaction-search').emit('compositionend');
  assert.equal(h.timeouts.size, 1); await h.flushSearch();
  assert.equal(records(h).length, 0);
  assert.equal(h.summary(), summary);
});

test('account and period selections consume the latest pending search without a delayed stale render', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  h.get('transaction-search').value = 'utility'; await h.get('transaction-search').emit('input');
  await h.choose('month-filter', '2025-01');
  assert.equal(h.timeouts.size, 0);
  assert.equal(records(h).length, 1);
  assert.match(h.summary(), /\$2,471\.25/);
  await h.flushSearch();
  assert.equal(records(h).length, 1);
  await h.choose('account-filter', recipe.accounts.investment);
  assert.equal(records(h).length, 0);
  assert.equal((h.summary().match(/Unavailable/g) || []).length, 3);
});

test('filter changes preserve staged draft and a failed reopen preserves the last visible financial view', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposal = structuredClone(h.modelSession.ledger);
  await h.search(''); await h.choose('month-filter', ''); await h.click('show-more');
  await h.choose('account-filter', recipe.accounts.card); await h.search('purchase');
  assert.deepEqual(h.modelSession.ledger, proposal);
  assert.equal(h.modelSession.dirty, true);
  const summary = h.summary(), count = h.get('filter-count').textContent;
  h.state.snapshotError = true; await h.click('reopen-ledger');
  assert.deepEqual(h.modelSession.ledger, proposal);
  assert.equal(h.summary(), summary);
  assert.equal(h.get('filter-count').textContent, count);
  assert.match(h.get('action-status').textContent, /Your staged changes remain/);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('stage-correction').disabled, true);
  h.state.snapshotError = false; await h.click('reopen-ledger');
  assert.deepEqual(h.modelSession.ledger, recipe.ledger);
  assert.equal(h.modelSession.canEdit(), true);
});

test('pending operations disable review controls and ignore queued repeated actions', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const inspect = records(h)[0].children.at(-1).children[0];
  const selected = h.get('detail-title').textContent;
  h.state.saveGate = deferred(); const pending = h.click('save-ledger');
  await h.until(() => h.modelSession.busy);
  assert.equal(inspect.disabled, true);
  assert.equal(h.get('close-detail').disabled, true);
  assert.equal(h.get('transactions').attributes['aria-busy'], 'true');
  await inspect.emit('click'); await h.get('close-detail').emit('click');
  await h.get('stage-correction').emit('click'); await h.get('release-ledger').emit('click');
  assert.equal(h.get('activity-detail').hidden, false);
  assert.equal(h.get('detail-title').textContent, selected);
  assert.equal(h.state.releases, 0);
  h.state.saveGate.resolve(); await pending;
  assert.equal(h.state.writes, 1);
  assert.equal(h.get('transactions').attributes['aria-busy'], 'false');
});

test('recovery keeps the draft and duplicate clicks cannot repeat recovery before verified reopen', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposal = structuredClone(h.modelSession.ledger);
  h.state.loseResponse = true; await h.click('save-ledger'); h.state.loseResponse = false;
  h.state.recoveryGate = deferred(); const pending = h.click('recover-ledger');
  await h.until(() => h.state.recovers === 1);
  await h.get('recover-ledger').emit('click'); await h.get('reopen-ledger').emit('click');
  assert.equal(h.state.recovers, 1);
  assert.deepEqual(h.modelSession.ledger, proposal);
  h.state.recoveryGate.resolve(); await pending;
  assert.equal(h.get('stage-correction').disabled, true);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.deepEqual(h.modelSession.ledger, proposal);
  await h.click('reopen-ledger');
  assert.equal(h.modelSession.canEdit(), true);
  assert.deepEqual(h.modelSession.ledger, proposal);
  assert.equal(h.state.writes, 1);
});

test('closing detail returns keyboard focus to its review button, or search if that row was filtered out', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.detail();
  assert.equal(h.observed.focused, h.get('detail-title'));
  const review = records(h)[0].children.at(-1).children[0];
  assert.equal(review.attributes['aria-controls'], 'activity-detail');
  await h.click('close-detail'); assert.equal(h.observed.focused, review);
  await h.detail(); await h.search('no results'); await h.click('close-detail');
  assert.equal(h.observed.focused, h.get('transaction-search'));
});

test('workspace status and paging markup expose atomic announcements and labelled correction context', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['action-status', 'filter-count', 'page-status']) {
    const tag = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))[0];
    assert.match(tag, /role="status"/); assert.match(tag, /aria-live="polite"/); assert.match(tag, /aria-atomic="true"/);
  }
  assert.match(html, /id="correction-form"[^>]+aria-describedby="correction-help"/);
  assert.match(html, /id="transaction-table-wrap"[^>]+tabindex="0"[^>]+aria-label=/);
});

test('unresolved source preview reports full scoped count and refreshes after resolved records reopen', async () => {
  let {ledger, options} = replayFixture();
  const account = ledger.accounts[0];
  const invalid = Array.from({length:13}, (_, index) => replayRow(index, {
    valid:false, errorCode:'invented-missing-evidence', effectiveDate:index < 12 ? '2026-01-15' : '2026-02-15'
  }));
  ledger = prepareCanonicalImport(ledger, replayInput(account, invalid, 'invented-review-preview'), options).ledger;
  ledger = registerAccount(ledger, {institutionId:'sofi',displayName:'Invented second account',currency:'USD',accountType:'checking'}, options);
  const emptyAccount = ledger.accounts.at(-1).accountId;
  const h = await workspacePage({ledger}); await h.click('open-ledger'); await h.choose('month-filter', '2026-01');
  assert.match(h.get('review-summary').textContent, /12 source observations await a decision/);
  assert.match(text(h.get('review-queue')), /Source decisions: page 1 of 2. 12 unresolved/);
  assert.equal(h.get('review-queue').children.filter(item => item.tagName === 'ARTICLE').length, 10);
  assert.equal(h.get('transaction-count').textContent, '1');
  await h.search('nothing matches');
  assert.match(text(h.get('review-queue')), /Source decisions: page 1 of 2. 12 unresolved/);
  assert.match(text(h.get('review-queue')), /Search does not filter this queue/);
  await h.choose('month-filter', '2026-02');
  assert.match(h.get('review-summary').textContent, /1 source observations await a decision/);
  assert.equal(h.get('review-queue').children.filter(item => item.tagName === 'ARTICLE').length, 1);
  await h.choose('account-filter', emptyAccount);
  assert.match(h.get('review-summary').textContent, /0 source observations await a decision/);
  assert.match(text(h.get('review-queue')), /No decisions waiting/);
  assert.match(text(h.get('review-queue')), /Check account-month coverage/);
  const rejected = ledger.observations.find(item => item.disposition === 'rejected');
  ledger = applyReviewDecision(ledger, {observationId:rejected.observationId, action:'reject', rationale:'Invented decision from advanced workbench'}, options);
  await h.replaceSavedLedger(ledger); await h.click('reopen-ledger'); await h.choose('month-filter', '2026-01');
  assert.match(h.get('review-summary').textContent, /11 source observations await a decision/);
  assert.match(text(h.get('review-queue')), /Source decisions: page 1 of 2. 11 unresolved and 1 resolved/);
  assert.equal(h.modelSession.ledger.activities.length, 1);
  assert.equal(h.state.writes, 0);
});


test('main workspace can explicitly save the exact local preview into a fresh synthetic copy', async () => {
  const h = await workspacePage();
  await h.click('preview-year');
  assert.equal(h.modelSession.mode, 'preview');
  assert.equal(h.get('save-preview').disabled, false);
  await h.click('save-preview');
  assert.deepEqual(h.state.connects, [{requireEmpty:true,canonicalLayout:'full-snapshot-v1'}]);
  assert.equal(h.state.writes, 1);
  assert.equal(h.modelSession.mode, 'saved');
  assert.equal(h.modelSession.dirty, false);
  assert.equal(h.get('save-preview').disabled, true);
  assert.match(h.get('action-status').textContent, /exact preview.*independently verified/i);
  const stored = await h.storedLedger();
  assert.deepEqual(stored, recipe.ledger);
});

test('workspace undo-last and revert-all controls only change the local staged proposal', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount('-150.00');
  assert.equal(h.get('undo-last-change').disabled, false);
  assert.equal(h.get('revert-all-changes').disabled, false);
  await h.choose('correction-type', 'bank-correction');
  h.get('amount').value = '-140.00';
  h.get('correction-rationale').value = 'Invented second correction to undo';
  await h.get('correction-rationale').emit('input');
  await h.click('stage-correction');
  assert.equal(h.get('detail-amount').textContent, '-$140.00');
  await h.click('undo-last-change');
  assert.equal(h.get('detail-amount').textContent, '-$150.00');
  assert.equal(h.modelSession.dirty, true);
  assert.equal(h.get('save-ledger').disabled, false);
  await h.click('revert-all-changes');
  assert.equal(h.get('detail-amount').textContent, '-$160.00');
  assert.equal(h.modelSession.dirty, false);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('undo-last-change').disabled, true);
  assert.equal(h.get('revert-all-changes').disabled, true);
  assert.equal(h.state.writes, 0);
  assert.equal(h.manifest.revision, '1');
  assert.equal(h.get('action-status').dataset.kind, 'success');
});

test('preview revert-all restores the original generated year without storage access', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.stageAmount('-150.00');
  await h.click('revert-all-changes');
  assert.equal(h.modelSession.mode, 'preview');
  assert.equal(h.modelSession.dirty, false);
  assert.equal(h.get('detail-amount').textContent, '-$160.00');
  assert.equal(h.state.connects.length, 0);
  assert.equal(h.state.writes, 0);
});


test('financial position is dated separately from activity month and old ledgers show missing balances', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  assert.match(text(h.get('position-accounts')), /Unavailable/);
  assert.equal((text(h.get('position-totals')).match(/Unavailable/g) || []).length, 3);
  assert.match(h.get('position-warning').textContent, /Incomplete/);
  h.get('position-date').value = '2025-01-31'; await h.get('position-date').emit('change');
  await h.choose('month-filter', '2025-02');
  assert.match(h.get('position-scope').textContent, /2025-01-31/);
  assert.match(h.get('position-coverage-help').textContent, /2025-02/);
});

test('synthetic position preview stages balances, resolves contradictory evidence and undoes without storage', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.match(text(h.get('position-totals')), /9,700.00/);
  const accountId = h.modelSession.ledger.accounts.find(account => account.accountType === 'checking').accountId;
  await h.choose('balance-account', accountId);
  h.get('balance-date').value = '2025-01-31'; h.get('balance-amount').value = '2300.00';
  h.get('balance-source').value = 'INVENTED corrected January statement'; await h.get('balance-source').emit('input');
  await h.click('stage-balance');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.match(text(h.get('position-accounts')), /Conflicting balances/);
  const card = h.get('position-accounts').children.find(card => text(card).includes('Invented checking'));
  const input = card.children.find(child => child.tagName === 'INPUT'); input.value = 'INVENTED statement supersedes the prior balance';
  const button = card.children.find(child => child.tagName === 'BUTTON' && child.textContent.includes('2300.00'));
  await button.emit('click');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.match(text(h.get('position-totals')), /9,800.00/);
  await h.click('undo-last-change');
  assert.match(text(h.get('position-accounts')), /Conflicting balances/);
  await h.click('undo-last-change');
  assert.match(text(h.get('position-totals')), /9,700.00/);
  assert.equal(h.state.writes, 0);
});


test('balance evidence survives explicit save and independent reopen; reconciliation requires valid anchors', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  h.get('position-date').value = fixture.asOf; await h.get('position-date').emit('change');
  await h.choose('month-filter', fixture.month);
  await h.choose('balance-account', fixture.accounts.mortgage);
  h.get('balance-date').value = '2025-02-28'; h.get('balance-amount').value = '98000.00';
  h.get('balance-source').value = 'INVENTED February mortgage statement'; await h.get('balance-source').emit('input');
  await h.click('stage-balance');
  assert.equal(h.modelSession.dirty, true);
  const proposal = structuredClone(h.modelSession.ledger);
  await h.click('save-ledger'); await h.click('reopen-ledger');
  assert.deepEqual(h.modelSession.ledger, proposal);
  await h.choose('month-filter', fixture.month);
  await h.choose('reconcile-account', fixture.accounts.checking);
  const anchors = h.modelSession.ledger.positionEvents.filter(event => event.eventType === 'balance-snapshot' && event.accountId === fixture.accounts.checking);
  await h.choose('reconcile-opening', anchors.find(event => event.effectiveDate === '2024-12-31').eventId);
  await h.choose('reconcile-closing', anchors.find(event => event.effectiveDate === '2025-01-31').eventId);
  h.get('reconcile-source').value = 'INVENTED independently checked statement'; await h.get('reconcile-source').emit('input');
  await h.click('stage-reconciliation');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.match(text(h.get('position-coverage')), /reconciled complete/);
  assert.match(h.get('position-coverage-help').textContent, /Not reconciled complete/);
  assert.equal(h.state.writes, 1);
});

test('account closure requires explicit zero evidence and preserves account history across undo', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  assert.equal(h.get('stage-closure').disabled, true);
  assert.equal(h.get('reconcile-account').children.some(option => option.value === fixture.accounts.mortgage), true);
  await h.choose('balance-account', fixture.accounts.autoLoan);
  h.get('balance-date').value = '2025-02-28'; h.get('balance-amount').value = '0.00';
  h.get('balance-source').value = 'INVENTED paid-off auto statement'; await h.get('balance-source').emit('input');
  await h.click('stage-balance');
  const zero = h.modelSession.ledger.positionEvents.at(-1);
  await h.choose('closure-anchor', zero.eventId);
  assert.equal(h.get('stage-closure').disabled, true);
  h.get('closure-source').value = 'INVENTED account closure confirmation'; await h.get('closure-source').emit('input');
  await h.click('stage-closure');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.equal(h.modelSession.ledger.positionEvents.at(-1).eventType, 'account-closure');
  assert.equal(h.modelSession.ledger.accounts.length, fixture.ledger.accounts.length);
  h.get('position-date').value = '2025-03-01'; await h.get('position-date').emit('change');
  assert.match(text(h.get('position-accounts')), /closed/);
  await h.click('undo-last-change');
  assert.equal(h.modelSession.ledger.positionEvents.at(-1).eventType, 'balance-snapshot');
  assert.equal(h.state.writes, 0);
});

function editorFields(h, container) {
  return h.get(container).children.at(-1).children.filter(child => child.tagName === 'LABEL').map(label => label.children[0]);
}

test('manual holdings corrections resolve with audit evidence, undo, save and reopen', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  h.get('position-date').value = fixture.asOf; await h.get('position-date').emit('change');
  await h.choose('holdings-account', fixture.accounts.brokerage);
  await h.choose('holdings-scope', 'complete');
  h.get('holdings-date').value = fixture.asOf;
  h.get('holdings-source').value = 'INVENTED replacement holdings statement'; await h.get('holdings-source').emit('input');
  await h.click('add-holding');
  const [symbol,type,quantity,value] = editorFields(h,'holdings-rows');
  symbol.value = 'INVENTED-ETF'; type.value = 'etf'; quantity.value = '12.5000'; value.value = '5000.00';
  await h.click('stage-holdings');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.equal(h.modelSession.ledger.positionEvents.at(-1).holdings[0].quantity, '12.5000');
  assert.match(text(h.get('holdings-accounts')), /Conflicting holdings statements/);
  const card = h.get('holdings-accounts').children.find(card => text(card).includes('Invented brokerage'));
  card.children.find(child => child.tagName === 'INPUT').value = 'INVENTED corrected statement verified';
  await card.children.find(child => child.tagName === 'BUTTON' && child.textContent.includes('replacement holdings')).emit('click');
  assert.equal(h.modelSession.ledger.positionEvents.at(-1).eventType, 'holdings-resolution');
  assert.doesNotMatch(text(h.get('holdings-accounts')), /Conflicting holdings statements/);
  await h.click('undo-last-change');
  assert.match(text(h.get('holdings-accounts')), /Conflicting holdings statements/);
  const restoredCard = h.get('holdings-accounts').children.find(card => text(card).includes('Invented brokerage'));
  restoredCard.children.find(child => child.tagName === 'INPUT').value = 'INVENTED selection confirmed after undo';
  await restoredCard.children.find(child => child.tagName === 'BUTTON' && child.textContent.includes('replacement holdings')).emit('click');
  assert.equal(h.modelSession.ledger.positionEvents.at(-1).eventType, 'holdings-resolution');
  const proposal = structuredClone(h.modelSession.ledger);
  await h.click('save-ledger'); await h.click('reopen-ledger');
  assert.deepEqual(h.modelSession.ledger, proposal);
  assert.equal(h.state.writes, 1);
});

test('manual loan statements distinguish partial evidence from declared complete month and reject blank components', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  await h.choose('balance-account', fixture.accounts.mortgage);
  h.get('balance-date').value = '2024-12-31'; h.get('balance-amount').value = '100000.00';
  h.get('balance-source').value = 'INVENTED opening mortgage statement'; await h.get('balance-source').emit('input'); await h.click('stage-balance');
  await h.choose('month-filter', '2025-01'); await h.choose('reconcile-account', fixture.accounts.mortgage);
  const anchors = h.modelSession.ledger.positionEvents.filter(event => event.eventType === 'balance-snapshot' && event.accountId === fixture.accounts.mortgage);
  await h.choose('reconcile-opening', anchors.find(event => event.effectiveDate === '2024-12-31').eventId);
  await h.choose('reconcile-closing', anchors.find(event => event.effectiveDate === '2025-01-31').eventId);
  h.get('reconcile-source').value = 'INVENTED complete January mortgage statement'; await h.get('reconcile-source').emit('input');
  await h.click('add-component');
  const [kind,amount,reference] = editorFields(h,'component-rows');
  kind.value = 'principal-change'; amount.value = '-1000.00';
  const before = h.modelSession.ledger.positionEvents.length;
  await h.click('stage-reconciliation');
  assert.equal(h.get('action-status').dataset.kind, 'error'); assert.equal(h.modelSession.ledger.positionEvents.length, before);
  reference.value = 'INVENTED principal movement on statement'; await h.click('stage-reconciliation');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.equal(h.modelSession.ledger.positionEvents.at(-1).statementCoverage, undefined);
  assert.equal(buildAccountMonthCoverage(h.modelSession.ledger,{month:'2025-01',accountIds:[fixture.accounts.mortgage]}).complete,false);
  h.get('statement-full-month').checked = true; await h.click('stage-reconciliation');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.deepEqual(h.modelSession.ledger.positionEvents.at(-1).statementCoverage,{start:'2025-01-01',end:'2025-01-31'});
  assert.equal(buildAccountMonthCoverage(h.modelSession.ledger,{month:'2025-01',accountIds:[fixture.accounts.mortgage]}).complete,true);
  assert.equal(h.get('statement-full-month').checked, false);
  h.get('statement-full-month').checked = true; amount.value = '-999.00'; await h.click('stage-reconciliation');
  assert.equal(buildAccountMonthCoverage(h.modelSession.ledger,{month:'2025-01',accountIds:[fixture.accounts.mortgage]}).complete,false);
  await h.click('undo-last-change');
  assert.equal(buildAccountMonthCoverage(h.modelSession.ledger,{month:'2025-01',accountIds:[fixture.accounts.mortgage]}).complete,true);
});

test('a new synthetic mortgage can receive dated evidence and undo each stage without CSV activity', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const initialCount = h.modelSession.ledger.accounts.length;
  h.get('new-account-name').value = 'Invented second mortgage'; h.get('new-account-currency').value = 'USD';
  await h.choose('new-account-type','mortgage'); await h.get('new-account-name').emit('input');
  await h.click('stage-account');
  assert.equal(h.get('action-status').dataset.kind,'success');
  assert.equal(h.get('new-account-name').value, '');
  assert.equal(h.get('stage-account').disabled, true);
  const account = h.modelSession.ledger.accounts.at(-1);
  await h.choose('balance-account',account.accountId);
  h.get('balance-date').value = '2026-06-30'; h.get('balance-amount').value = '50000.00';
  h.get('balance-source').value = 'INVENTED new mortgage statement'; await h.get('balance-source').emit('input'); await h.click('stage-balance');
  await h.choose('account-filter',account.accountId); await h.choose('month-filter','2026-06');
  assert.match(h.get('position-coverage-help').textContent,/2026-06/);
  await h.click('undo-last-change'); await h.click('undo-last-change');
  assert.equal(h.get('action-status').dataset.kind, 'success');
  assert.equal(h.get('account-filter').value, '');
  assert.equal(h.modelSession.ledger.accounts.length,initialCount);
  assert.equal(h.state.writes,0);
});


test('statement declaration is invalidated by account, month and ledger replacement', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  await h.choose('month-filter','2025-01'); await h.choose('reconcile-account',fixture.accounts.mortgage);
  h.get('statement-full-month').checked = true; await h.click('add-component');
  await h.choose('reconcile-account',fixture.accounts.autoLoan);
  assert.equal(h.get('statement-full-month').checked,false); assert.equal(h.get('component-rows').children.length,0);
  h.get('statement-full-month').checked = true; await h.choose('month-filter','2024-12');
  assert.equal(h.get('statement-full-month').checked,false);
  assert.match(h.get('statement-coverage-period').textContent,/2024-12/);
  h.get('statement-full-month').checked = true; await h.click('add-component'); await h.click('reopen-ledger');
  assert.equal(h.get('statement-full-month').checked,false); assert.equal(h.get('component-rows').children.length,0);
});

test('reconciliation offers only required month-end anchors and explains missing evidence', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  await h.choose('month-filter', '2025-01'); await h.choose('reconcile-account', fixture.accounts.checking);
  const byId = new Map(h.modelSession.ledger.positionEvents.map(event => [event.eventId,event]));
  for (const option of h.get('reconcile-opening').children.filter(option => option.value)) assert.equal(byId.get(option.value).effectiveDate,'2024-12-31');
  for (const option of h.get('reconcile-closing').children.filter(option => option.value)) assert.equal(byId.get(option.value).effectiveDate,'2025-01-31');
  assert.match(h.get('reconcile-anchor-help').textContent,/2024-12-31.*2025-01-31/);
  await h.choose('reconcile-account', fixture.accounts.mortgage);
  assert.match(h.get('reconcile-anchor-help').textContent,/Add.*opening/);
  assert.equal(h.get('stage-reconciliation').disabled,true);
});

test('holding row add and removal keep keyboard focus in the editor', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  await h.click('add-holding');
  assert.equal(h.observed.focused,editorFields(h,'holdings-rows')[0]);
  const row = h.get('holdings-rows').children[0];
  await row.children.at(-1).emit('click');
  assert.equal(h.observed.focused,h.get('add-holding'));
});

test('holding validation gives local actionable feedback without losing entered evidence', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  await h.choose('holdings-account',fixture.accounts.brokerage);
  h.get('holdings-date').value = fixture.asOf; h.get('holdings-source').value = 'INVENTED negative holding';
  await h.get('holdings-source').emit('input'); await h.click('add-holding');
  const [symbol,type,quantity,value] = editorFields(h,'holdings-rows');
  symbol.value='INVENTED'; type.value='etf'; quantity.value='1'; value.value='-1.00';
  await h.click('stage-holdings');
  assert.match(h.get('holdings-form-status').textContent,/nonnegative/);
  assert.equal(h.observed.focused,h.get('holdings-form-status'));
  assert.equal(value.value,'-1.00'); assert.equal(h.modelSession.dirty,false); assert.equal(h.state.writes,0);
});

test('activity search preserves open position evidence and unfinished conflict decisions', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  await h.choose('balance-account',h.modelSession.ledger.accounts.find(account => account.accountType === 'checking').accountId);
  h.get('balance-date').value = '2025-01-31'; h.get('balance-amount').value = '2300.00'; h.get('balance-source').value = 'INVENTED conflict';
  await h.get('balance-source').emit('input'); await h.click('stage-balance');
  const card = h.get('position-accounts').children.find(card => card.children.some(child => child.tagName === 'INPUT'));
  assert.ok(card);
  const reason = card.children.find(child => child.tagName === 'INPUT'); reason.value = 'INVENTED reason still being checked';
  const details = card.children.find(child => child.tagName === 'DETAILS'); details.open = true; await details.emit('toggle');
  await h.search('INVENTED');
  assert.ok(h.get('position-accounts').children.includes(card));
  assert.equal(reason.value,'INVENTED reason still being checked'); assert.equal(details.open,true);
  await h.choose('review-only',true);
  assert.ok(h.get('position-accounts').children.includes(card));
});

test('switching the balance account cannot silently reuse another account evidence', async () => {
  const fixture = await createSyntheticFinancialPosition();
  const h = await workspacePage({ledger:fixture.ledger}); await h.click('open-ledger');
  await h.choose('balance-account',fixture.accounts.checking);
  h.get('balance-date').value = fixture.asOf; h.get('balance-amount').value = '42.00'; h.get('balance-source').value = 'INVENTED checking statement';
  h.observed.confirm = false;
  await h.choose('balance-account',fixture.accounts.mortgage);
  assert.equal(h.get('balance-account').value,fixture.accounts.checking); assert.equal(h.get('balance-amount').value,'42.00');
  h.observed.confirm = true;
  await h.choose('balance-account',fixture.accounts.mortgage);
  assert.equal(h.get('balance-amount').value,''); assert.equal(h.get('balance-source').value,'');
  assert.equal(h.get('stage-balance').disabled,true); assert.equal(h.modelSession.dirty,false);
});

test('reconciliation scope changes can be cancelled without losing components or statement evidence', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  const mortgage = h.modelSession.ledger.accounts.find(account => account.accountType === 'mortgage').accountId;
  const loan = h.modelSession.ledger.accounts.find(account => account.accountType === 'auto-loan').accountId;
  await h.choose('reconcile-account',mortgage); await h.click('add-component');
  const [kind,amount,reference] = editorFields(h,'component-rows');
  amount.value='-1000.00'; reference.value='INVENTED component';
  h.get('reconcile-source').value='INVENTED January statement'; h.get('statement-full-month').checked=true;
  h.observed.confirm=false;
  await h.choose('reconcile-account',loan);
  assert.equal(h.get('reconcile-account').value,mortgage); assert.equal(editorFields(h,'component-rows')[1],amount);
  await h.choose('month-filter','2024-12');
  assert.equal(h.get('month-filter').value,'2025-01'); assert.equal(amount.value,'-1000.00'); assert.equal(h.get('statement-full-month').checked,true);
  h.observed.confirm=true; await h.choose('month-filter','2024-12');
  assert.equal(h.get('component-rows').children.length,0); assert.equal(h.get('reconcile-source').value,'');
});

test('anchor guidance handles leap February and December rollover', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  const account = h.modelSession.ledger.accounts.find(account => account.accountType === 'checking').accountId;
  await h.choose('reconcile-account',account);
  for (const [month,opening,closing] of [['2024-02','2024-01-31','2024-02-29'],['2024-12','2024-11-30','2024-12-31'],['2025-01','2024-12-31','2025-01-31']]) {
    // Inject a legitimate month selection without relying on fixture activity coverage.
    h.get('month-filter').value=month; await h.get('month-filter').emit('change');
    assert.match(h.get('reconcile-anchor-help').textContent,new RegExp(opening+'.*'+closing));
  }
});

test('invalid as-of date and negative debt give actionable feedback without changing the ledger', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  const previous=h.get('position-date').value;
  h.get('position-date').value=''; await h.get('position-date').emit('change');
  assert.equal(h.get('position-date').value,previous); assert.match(h.get('action-status').textContent,/valid position date/);
  await h.choose('balance-account',h.modelSession.ledger.accounts.find(account => account.accountType === 'mortgage').accountId);
  h.get('balance-date').value='2025-01-31'; h.get('balance-amount').value='-1.00'; h.get('balance-source').value='INVENTED negative debt';
  await h.get('balance-source').emit('input'); await h.click('stage-balance');
  assert.match(h.get('position-form-status').textContent,/nonnegative amount owed/); assert.equal(h.modelSession.dirty,false);
});

test('holding account changes protect row evidence and clear complete-scope declaration only on confirmation', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  const account = h.modelSession.ledger.accounts.find(account => account.accountType === 'brokerage').accountId;
  await h.choose('holdings-account',account); await h.choose('holdings-scope','complete'); await h.click('add-holding');
  const [symbol] = editorFields(h,'holdings-rows'); symbol.value='INVENTED-ETF';
  h.observed.confirm=false; await h.choose('holdings-account','');
  assert.equal(h.get('holdings-account').value,account); assert.equal(symbol.value,'INVENTED-ETF');
  h.observed.confirm=true; await h.choose('holdings-account','');
  assert.equal(h.get('holdings-rows').children.length,0); assert.equal(h.get('holdings-scope').value,'partial');
});

test('focused pages preserve pending transaction editor text and selection across navigation and history', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.detail();
  await h.choose('correction-type','bank-correction');
  h.get('amount').value = '-123.456'; h.get('correction-rationale').value = 'INVENTED unfinished correction';
  await h.get('correction-rationale').emit('input');
  assert.equal(h.location.hash, '#activity-detail');
  assert.equal(h.get('transactions').hidden, true);
  assert.equal(h.get('activity-detail').hidden, false);
  const ledger = h.modelSession.ledger;
  for (const hash of ['#position','#holdings','#reconciliation','#storage','#overview','#transactions']) {
    await h.navigate(hash);
    assert.equal(h.get(hash.slice(1)).hidden, false);
    assert.equal(h.get('activity-detail').hidden, true);
    assert.equal(h.modelSession.ledger, ledger);
    assert.equal(h.get('amount').value, '-123.456');
    assert.equal(h.get('correction-rationale').value, 'INVENTED unfinished correction');
  }
  await h.navigate('#activity-detail');
  assert.equal(h.get('stage-correction').disabled, false);
  await h.back(); assert.equal(h.get('transactions').hidden, false);
  await h.forward(); assert.equal(h.get('activity-detail').hidden, false);
  assert.equal(h.get('amount').value, '-123.456');
  assert.equal(h.state.writes, 0); assert.equal(h.state.connects.length, 0);
});

test('balances, holdings and statement drafts survive page changes with their distinct scope', async () => {
  const h = await workspacePage(); await h.click('preview-position');
  const fixture = h.modelSession.ledger;
  const mortgage = fixture.accounts.find(account => account.accountType === 'mortgage').accountId;
  await h.choose('reconcile-account',mortgage); await h.click('add-component'); await h.click('add-holding');
  const component = editorFields(h,'component-rows'), holding = editorFields(h,'holdings-rows');
  component[1].value = '-100.00'; component[2].value = 'INVENTED pending mortgage evidence';
  holding[0].value = 'INVENTED-ETF'; holding[2].value = '0.000123'; holding[3].value = '12.0001';
  h.get('statement-full-month').checked = true;
  h.get('balance-amount').value = '123.4567'; h.get('balance-source').value = 'INVENTED pending balance';
  const month = h.get('month-filter').value, date = h.get('position-date').value;
  for (const hash of ['#holdings','#storage','#reconciliation','#overview','#position']) {
    await h.navigate(hash);
    assert.equal(h.get('balance-amount').value, '123.4567');
    assert.equal(component[1].value, '-100.00'); assert.equal(holding[2].value, '0.000123');
    assert.equal(h.get('statement-full-month').checked, true);
    assert.equal(h.get('month-filter').value, month); assert.equal(h.get('position-date').value, date);
  }
  assert.equal(h.get('month-scope').hidden, true);
  assert.equal(h.get('position-date-scope').hidden, false);
  assert.equal(h.state.writes, 0);
});

test('staged changes persist across pages and explicit save remains available without five sticky actions', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount('-150.00');
  const proposed = structuredClone(h.modelSession.ledger);
  assert.equal(h.get('draft-bar').hidden, false);
  assert.match(h.get('draft-summary').textContent, /1 staged change · not saved/);
  for (const page of ['#storage','#holdings','#reconciliation','#overview']) await h.navigate(page);
  assert.deepEqual(h.modelSession.ledger, proposed); assert.equal(h.state.writes, 0);
  await h.click('save-ledger');
  assert.equal(h.state.writes, 1); assert.equal(h.get('draft-bar').hidden, true, 'a clean verified save leaves nothing to save');
  assert.equal(h.location.hash, '#overview');
  assert.deepEqual(await h.storedLedger(), proposed);
});

test('page navigation after automatically recovered save preserves verified ledger without duplicate writes', async () => {
  const h=await workspacePage();await h.click('open-ledger');await h.stageAmount();const draft=structuredClone(h.modelSession.ledger);
  h.state.loseResponse=true;await h.click('save-ledger');assert.equal(h.modelSession.recoveryOutcome,'saved');assert.equal(h.modelSession.unverified,false);
  const writes=h.state.writes;await h.navigate('#position');await h.navigate('#storage');
  assert.deepEqual(h.modelSession.ledger,draft);assert.equal(h.state.writes,writes);assert.equal(h.get('save-ledger').disabled,true);assert.equal(h.get('draft-bar').hidden,true);
});

test('retired review links open the Needs review list and first-run preview opens Home without storage calls', async () => {
  const h = await workspacePage();
  assert.equal(h.get('workspace-scope').hidden,true);
  assert.equal(h.get('welcome-panel').hidden,false);
  await h.click('start-preview');
  assert.equal(h.location.hash,'#overview');
  assert.equal(h.get('welcome-panel').hidden,true);
  assert.equal(h.get('workspace-scope').hidden,false);
  await h.click('preview-year'); await h.navigate('#review'); await new Promise(setImmediate);
  assert.equal(h.location.hash,'#transactions');
  assert.equal(h.get('transactions').hidden,false);
  assert.equal(h.get('review-only').checked,true);
  assert.match(h.get('filter-count').textContent,/48 matching activities of 253/);
  assert.equal(records(h).every(row => row.attributes['data-review'] === 'true'),true);
  // Only activity decisions are waiting, so the source-row section stays out of the way.
  assert.equal(h.get('review-section').hidden,true);
  assert.equal(h.state.writes,0); assert.equal(h.state.connects.length,0);
});

test('closing detail and loading a replacement ledger never leaves a blank detail route', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.detail();
  await h.click('close-detail');
  assert.equal(h.location.hash,'#transactions');
  assert.equal(h.get('resume-detail').hidden,true);
  await h.navigate('#activity-detail');
  assert.equal(h.location.hash,'#transactions');
  await h.detail(); await h.navigate('#storage'); await h.click('preview-position');
  await h.navigate('#activity-detail');
  assert.equal(h.get('transactions').hidden,false);
  assert.equal(h.get('activity-detail').hidden,true);
});


test('a completed ledger open respects navigation chosen while verification was pending', async () => {
  const h = await workspacePage(); await h.navigate('#storage');
  h.state.openGate = deferred();
  const opening = h.click('open-ledger');
  await h.until(() => h.state.snapshotReads === 1);
  await h.navigate('#review');
  h.state.openGate.resolve(); await opening;
  assert.equal(h.location.hash, '#transactions');
  assert.equal(h.get('transactions').hidden, false);
  assert.equal(h.modelSession.mode, 'saved');
  assert.equal(h.state.writes, 0);
});

test('unknown posting status opens the usable editor and explicit evidence clears only that review reason', async () => {
  const h=await workspacePage();await h.click('open-ledger');
  await h.detail('INVENTED BROKERAGE FEE');
  assert.equal(h.get('correction-type').value,'posting-status-correction');
  assert.equal(h.get('posting-status-field').hidden,false);
  assert.equal(h.get('posting-status').value,'unknown');
  assert.equal(h.get('posting-date-field').hidden,true);
  assert.equal(h.get('posting-date').value,'');
  h.get('correction-rationale').value='Invented January statement confirms the fee posted';
  await h.get('correction-rationale').emit('input');
  await h.choose('posting-status','posted');
  assert.equal(h.get('posting-date-field').hidden,false);
  assert.equal(h.get('posting-date').required,true);
  assert.equal(h.get('stage-correction').disabled,true);
  h.get('posting-date').value='2025-02-30';await h.get('posting-date').emit('input');
  assert.equal(h.get('stage-correction').disabled,true);
  h.get('posting-date').value='2025-01-26';await h.get('posting-date').emit('input');
  assert.equal(h.get('stage-correction').disabled,false);
  await h.click('stage-correction');
  assert.match(h.get('detail-description').textContent,/posted/);
  assert.doesNotMatch(h.get('detail-description').textContent,/Posting status unknown/);
  assert.match(h.get('detail-description').textContent,/Not classified/);
  assert.match(text(h.get('detail-history')),/unknown \(no posting date\).*posted \(2025-01-26\)/);
  assert.match(text(h.get('detail-history')),/Invented January statement/);
  assert.equal(h.state.writes,0);
  assert.deepEqual(h.modelSession.ledger.activities,recipe.ledger.activities);
  assert.deepEqual(h.modelSession.ledger.observations,recipe.ledger.observations);
  await h.choose('correction-type','classification');await h.choose('classification','spending');
  h.get('correction-rationale').value='Invented fee is an expense';await h.get('correction-rationale').emit('input');
  await h.click('stage-correction');
  assert.doesNotMatch(h.get('detail-description').textContent,/Needs review/);
  const proposal=structuredClone(h.modelSession.ledger);
  await h.click('save-ledger');assert.equal(h.state.writes,1);
  assert.deepEqual(await h.storedLedger(),proposal);
  await h.click('reopen-ledger');await h.detail('INVENTED BROKERAGE FEE');
  assert.equal(h.get('posting-status').value,'posted');assert.equal(h.get('posting-date').value,'2025-01-26');
  assert.doesNotMatch(h.get('detail-description').textContent,/Needs review/);
});

test('posting editor preserves unfinished fields across navigation and rejects no-op without staging', async () => {
  const h=await workspacePage();await h.click('preview-year');await h.detail('INVENTED BROKERAGE FEE');
  h.get('correction-rationale').value='Invented unchanged unknown status';await h.get('correction-rationale').emit('input');
  const before=structuredClone(h.modelSession.ledger);
  await h.click('stage-correction');
  assert.match(h.get('action-status').textContent,/unchanged/);assert.deepEqual(h.modelSession.ledger,before);
  await h.choose('posting-status','posted');h.get('posting-date').value='2025-01-26';await h.get('posting-date').emit('input');
  h.get('correction-rationale').value='Invented date waiting for review';await h.get('correction-rationale').emit('input');
  await h.navigate('#overview');await h.back();
  assert.equal(h.get('posting-status').value,'posted');assert.equal(h.get('posting-date').value,'2025-01-26');
  assert.equal(h.get('correction-rationale').value,'Invented date waiting for review');
  assert.deepEqual(h.modelSession.ledger,before);assert.equal(h.state.writes,0);
  await h.click('close-detail');assert.deepEqual(h.modelSession.ledger,before);
});

test('pending or unknown corrections clear effective posting date and never submit a hidden date', async () => {
  const h=await workspacePage();await h.click('preview-year');await h.detail('INVENTED BROKERAGE FEE');
  await h.choose('posting-status','posted');h.get('posting-date').value='2025-01-26';await h.get('posting-date').emit('input');
  h.get('correction-rationale').value='Invented confirmation';await h.get('correction-rationale').emit('input');await h.click('stage-correction');
  for(const status of ['pending','unknown']) {
    await h.choose('posting-status',status);
    assert.equal(h.get('posting-date-field').hidden,true);assert.equal(h.get('posting-date').disabled,true);
    assert.equal(h.get('posting-date').required,false);
    h.get('correction-rationale').value='Invented status corrected to '+status;await h.get('correction-rationale').emit('input');
    await h.click('stage-correction');
    assert.deepEqual(h.modelSession.ledger.events.at(-1).proposedValues,{lifecycleStatus:status,postedDate:null});
    assert.equal(h.get('posting-date').value,'');
  }
  assert.match(h.get('detail-description').textContent,/Posting status unknown/);
  await h.click('undo-last-change');assert.equal(h.get('posting-status').value,'pending');
  assert.equal(h.state.writes,0);
});

test('Storage distinguishes the active full-snapshot saved format from local preview', async () => {
  const h = await workspacePage();
  assert.match(h.get('storage-format').textContent, /No saved format currently verified/);
  await h.click('preview-year');
  assert.match(h.get('storage-format').textContent, /Local preview, no saved format yet/);
  assert.match(h.get('storage-format').textContent, /new folder will use full-snapshot v1/);
  await h.click('open-ledger');
  assert.match(h.get('storage-format').textContent, /Last verified saved format: full-snapshot-v1/);
  await h.click('release-ledger');
  assert.match(h.get('storage-format').textContent, /No saved format currently verified/);
  await h.click('preview-year');
  await h.click('save-preview');
  assert.match(h.get('storage-format').textContent, /Last verified saved format: full-snapshot-v1/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /one complete canonical ledger snapshot and a small commit envelope/);
  assert.match(html, /Opening and recovery verify retained history/);
  assert.match(html, /Old-format folders are unsupported and are never silently converted/);
});


test('Home recent activity ignores Activity search, review filter and pagination, and returns focus after inspection', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const recent = h.get('recent-activities');
  assert.equal(recent.children.length, 4);
  const original = text(recent), count = h.get('attention-count').textContent;
  await h.navigate('#transactions');
  await h.search('a deliberately unmatched invented phrase');
  await h.choose('review-only', true);
  assert.equal(records(h).length, 0);
  assert.equal(text(recent), original);
  assert.equal(h.get('attention-count').textContent, count);
  await h.navigate('#overview');
  const button = recent.children[0];
  await button.click(); assert.equal(h.location.hash, '#activity-detail');
  assert.match(h.get('detail-description').textContent, /Invented/i);
  await h.click('close-detail');
  assert.equal(h.location.hash, '#overview'); assert.equal(h.observed.focused, button);
  assert.equal(h.state.writes, 0); assert.equal(h.state.connects.length, 0);
});

test('Home recent records follow account and month scope and preserve exact displayed source amounts', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  await h.choose('month-filter', '2025-01');
  const account = h.get('account-filter').children.find(option => option.value && /checking/i.test(option.textContent));
  await h.choose('account-filter', account.value);
  const recent = h.get('recent-activities');
  assert.ok(recent.children.length > 0 && recent.children.length <= 4);
  for (const button of recent.children) {
    assert.match(text(button), /2025-01-/);
    assert.ok(text(button).includes(account.textContent));
    assert.match(text(button), /\$[\d,]+\.\d{2}/);
  }
  assert.match(h.get('overview-review-title').textContent, /needs? a decision|Nothing to review/);
  assert.equal(h.state.writes, 0);
});


test('transaction rows open from their text while selection and bubbled button clicks remain safe', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  const row = records(h)[0], button = row.children.at(-1).children[0];
  h.window.getSelection = () => ({toString: () => 'Selected source description'});
  await row.emit('click', {target:row.children[1]});
  assert.equal(h.location.hash, '#transactions');
  h.window.getSelection = () => ({toString: () => ''});
  await row.emit('click', {target:row.children[1]});
  assert.equal(h.location.hash, '#activity-detail');
  await h.click('close-detail'); assert.equal(h.location.hash, '#transactions');
  await row.emit('click', {target:button});
  assert.equal(h.location.hash, '#transactions');
  await button.click(); assert.equal(h.location.hash, '#activity-detail');
  assert.equal(h.state.writes, 0);
});

test('an account with no activity shows an honest Home empty state and a separate coverage action', async () => {
  const h = await workspacePage(); await h.click('start-preview');
  const loan = h.get('account-filter').children.find(option => /auto loan/i.test(option.textContent));
  await h.choose('account-filter', loan.value);
  assert.match(text(h.get('recent-activities')), /No activity/);
  assert.equal(h.get('attention-count').textContent, '0');
  assert.match(h.get('overview-review-title').textContent, /Coverage still needs separate reconciliation/);
  assert.match(text(h.get('review-queue')), /Check account-month coverage/);
  assert.equal(h.state.writes, 0);
});

test('adversarial: reopening the same Home record preserves an unfinished transaction edit', async () => {
  const h = await workspacePage(); await h.click('start-preview');
  await h.get('recent-activities').children[0].click();
  h.get('correction-rationale').value = 'INVENTED unfinished explanation';
  await h.get('correction-rationale').emit('input');
  await h.navigate('#overview'); await h.get('recent-activities').children[0].click();
  assert.equal(h.get('correction-rationale').value, 'INVENTED unfinished explanation');
  assert.equal(h.observed.confirmations.length, 0);
  assert.equal(h.state.writes, 0);
});

test('adversarial: cancelling replacement or close keeps the unfinished editor and staged graph', async () => {
  const h = await workspacePage(); await h.click('start-preview');
  const recent = h.get('recent-activities'); await recent.children[0].click();
  const title = h.get('detail-title').textContent, graph = structuredClone(h.modelSession.ledger);
  h.get('correction-rationale').value = 'INVENTED keep this unfinished edit';
  await h.get('correction-rationale').emit('input');
  h.observed.confirm = false;
  await h.navigate('#overview'); await recent.children[1].click();
  assert.equal(h.get('detail-title').textContent, title);
  assert.equal(h.get('correction-rationale').value, 'INVENTED keep this unfinished edit');
  await recent.children[0].click(); await h.click('close-detail');
  assert.equal(h.location.hash, '#activity-detail');
  assert.ok(h.observed.confirmations.length >= 2);
  h.observed.confirm = true; await h.click('close-detail');
  assert.equal(h.location.hash, '#overview');
  assert.deepEqual(h.modelSession.ledger, graph); assert.equal(h.state.writes, 0);
});

test('adversarial: Home identifies unknown posting status as excluded rather than just needing review', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.detail('INVENTED BROKERAGE FEE');
  const broker = h.modelSession.ledger.accounts.find(account => account.accountType === 'brokerage');
  await h.choose('account-filter', broker.accountId); await h.navigate('#overview');
  assert.match(text(h.get('recent-activities')), /Unknown status · excluded/);
  assert.equal(h.state.writes, 0);
});

test('adversarial: pending classified spending is labeled as excluded in both Home and Activity', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.detail('INVENTED BROKERAGE FEE');
  await h.choose('posting-status', 'pending');
  h.get('correction-rationale').value = 'INVENTED pending evidence'; await h.get('correction-rationale').emit('input');
  await h.click('stage-correction');
  await h.choose('correction-type', 'classification'); await h.choose('classification', 'spending');
  h.get('correction-rationale').value = 'INVENTED fee classification'; await h.get('correction-rationale').emit('input');
  await h.click('stage-correction');
  const broker = h.modelSession.ledger.accounts.find(account => account.accountType === 'brokerage');
  await h.choose('account-filter', broker.accountId);
  assert.match(text(h.get('recent-activities')), /Pending · excluded/);
  assert.match(text(h.get('transaction-rows')), /Pending · excluded/);
  assert.equal(h.state.writes, 0);
});

test('adversarial: unstaged editor text participates in replacement and unload guards, clean editors do not', async () => {
  const h = await workspacePage(); await h.click('start-preview');
  await h.get('recent-activities').children[0].click();
  let prevented = false;
  await h.event('beforeunload', {preventDefault() { prevented = true; }});
  assert.equal(prevented, false);
  h.get('correction-rationale').value = 'INVENTED unsent explanation';
  await h.get('correction-rationale').emit('input');
  await h.event('beforeunload', {preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  const graph = structuredClone(h.modelSession.ledger);
  h.observed.confirm = false; await h.click('preview-year');
  assert.deepEqual(h.modelSession.ledger, graph);
  assert.equal(h.get('correction-rationale').value, 'INVENTED unsent explanation');
  h.observed.confirm = true; await h.click('close-detail');
  prevented = false;
  await h.event('beforeunload', {preventDefault() { prevented = true; }});
  assert.equal(prevented, false); assert.equal(h.state.writes, 0);
});


test('Home reads stay cached during Activity filtering and invalidate with scope or ledger changes', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const initial = h.state.homeReads;
  await h.search('INVENTED'); await h.click('show-more');
  await h.choose('review-only', true); await h.search('UTILITY');
  assert.equal(h.state.homeReads, initial);
  await h.choose('month-filter', '2025-01');
  assert.equal(h.state.homeReads, initial + 1);
  const account = h.get('account-filter').children.find(option => option.value && /checking/i.test(option.textContent));
  await h.choose('account-filter', account.value);
  assert.equal(h.state.homeReads, initial + 2);
  await h.choose('review-only', false);
  const beforeEdit = h.state.homeReads;
  await h.stageAmount('-151.00');
  assert.equal(h.state.homeReads, beforeEdit + 1);
  assert.equal(h.modelSession.dirty, true);
});

test('developer diagnostics self-test stays local and exposes copyable context', async () => {
  const p = await workspacePage();
  await p.get('diagnostic-self-test').click();
  const panels = p.diagnostics();
  const find = (node, tag) => node.tagName === tag ? node : node.children.map(child => find(child, tag)).find(Boolean);
  const report = JSON.parse(find(panels.at(-1), 'TEXTAREA').value);
  assert.equal(report.error.code, 'diagnostic-self-test');
  assert.equal(report.where.actionId, 'diagnostic-self-test');
  assert.equal(report.where.page, 'storage');
  assert.equal(p.state.writes, 0);
  assert.equal(p.state.connects.length, 0);
  assert.ok(p.get('recent-problems').children.length > 0);
});

// The report must distinguish one save from requests accumulated while connected.
test('failed save reports its own request window and clears it before the next action', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  let time = 0;
  const metrics = createDriveRequestMetrics({now: () => time});
  h.lifecycle.requestMetrics = metrics;
  const fetch = metrics.wrapFetch(async () => { time += 20; return {status:200}; });
  await fetch('https://example.invalid', {method:'GET'});
  time += 1000;
  h.state.measureSave = () => fetch('https://example.invalid', {method:'PATCH'});
  h.state.failSave = true;
  await h.click('save-ledger');
  const find = (node, tag) => node.tagName === tag ? node : node.children.map(child => find(child, tag)).find(Boolean);
  const report = JSON.parse(find(h.diagnostics().at(-1), 'TEXTAREA').value);
  assert.equal(report.where.actionId, 'save-ledger');
  assert.equal(report.requests.requests, 2);
  assert.equal(report.requests.elapsedMs, 1040);
  assert.equal(report.actionRequests.requests, 1);
  assert.equal(report.actionRequests.patch, 1);
  assert.equal(report.actionRequests.elapsedMs, 20);
  // A later action must never inherit the failed save's measurements.
  await h.get('diagnostic-self-test').click();
  const next = JSON.parse(find(h.diagnostics().at(-1), 'TEXTAREA').value);
  assert.equal(next.error.code, 'diagnostic-self-test');
  assert.equal(next.actionRequests, undefined);
  h.state.snapshotError = true;
  await h.click('open-ledger');
  const reopened = JSON.parse(find(h.diagnostics().at(-1), 'TEXTAREA').value);
  assert.equal(reopened.where.actionId, 'open-ledger');
  assert.equal(reopened.actionRequests.requests, 0);
});

test('successful storage timing stays tab-local, labels unavailable counts and clears explicitly',async()=>{
 const h=await workspacePage();await h.click('open-ledger');
 const summary=JSON.parse(h.get('success-metrics').textContent);
 assert.equal(summary.action,'open');assert.equal(summary.requestCoverage,'unavailable');
 assert.equal(summary.requests,null);assert.equal(summary.manifestPatches,null);assert.equal(summary.path,'unavailable');
 assert.equal(h.session.size,0);assert.doesNotMatch(JSON.stringify(summary),/invented|ledgerId|copyId|rootHash|https:/);
 await h.click('clear-success-metrics');assert.match(h.get('success-metrics').textContent,/No successful action/);
});

test('privacy close clears financial display and unfinished forms only after explicit confirmation', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.detail();
  h.get('correction-rationale').value = 'Invented unfinished private note';
  for (const id of ['balance-source','balance-amount','holdings-source','new-account-name','backup-password','backup-password-confirm','restore-password']) h.get(id).value = 'Invented private form value';
  h.observed.confirm = false;
  await h.click('release-ledger');
  assert.equal(h.state.releases, 0);
  assert.equal(h.get('correction-rationale').value, 'Invented unfinished private note');
  assert.notEqual(h.modelSession.ledger, null);
  h.observed.confirm = true;
  await h.click('release-ledger');
  assert.equal(h.modelSession.ledger, null);
  for (const id of ['correction-rationale','balance-source','balance-amount','holdings-source','new-account-name','backup-password','backup-password-confirm','restore-password']) assert.equal(h.get(id).value, '', id);
  for (const id of ['detail-title','detail-description','detail-amount']) assert.equal(h.get(id).textContent, '', id);
  assert.match(h.observed.confirmations.at(-1), /cleared from this tab/);
  assert.match(h.get('action-status').textContent, /does not erase browser or device traces/);
  assert.equal(h.get('activity-detail').hidden, true);
  assert.equal(h.get('overview-loaded').hidden, true);
  assert.equal(h.get('welcome-panel').hidden, false);
});

for (const action of ['release-ledger','open-ledger']) test(`${action} protects unfinished position evidence even when the saved ledger is clean`, async () => {
  const h = await workspacePage(); await h.click('open-ledger');
  const ledger = h.modelSession.ledger;
  h.get('balance-amount').value = '123.45';
  h.get('balance-source').value = 'Invented unstaged statement';
  h.observed.confirm = false;
  const connections = h.state.connects.length;
  await h.click(action);
  assert.equal(h.observed.confirmations.length, 1);
  assert.equal(h.state.releases, 0);
  assert.equal(h.state.connects.length, connections);
  assert.equal(h.modelSession.ledger, ledger);
  assert.equal(h.get('balance-amount').value, '123.45');
  assert.equal(h.get('balance-source').value, 'Invented unstaged statement');
});

test('unavailable storage actions stay visible, explain prerequisites and reject activation', async () => {
  const h = await workspacePage();
  const actions = ['export-backup','backup-save-first','backup-saved-only','restore-backup','verify-save-outcome','retry-save','recover-ledger','recover-stale','save-ledger','draft-storage-link'];
  for (const id of actions) {
    assert.equal(Boolean(h.get(id).hidden), false, id + ' stays visible within its contextual panel');
    assert.equal(h.get(id).disabled, true, id + ' is disabled');
    assert.equal(h.get(id).attributes['aria-describedby'], id + '-help');
    assert.ok(h.get(id + '-help').textContent.length > 10, id + ' explains prerequisite');
    await h.get(id).emit('click');
  }
  assert.equal(h.state.connects.length, 0); assert.equal(h.state.writes, 0); assert.equal(h.state.recovers, 0);
  await h.click('preview-year');
  assert.equal(h.get('save-ledger').hidden, false); assert.equal(h.get('save-ledger').disabled, true);
  assert.match(h.get('save-ledger-help').textContent, /preview/i);
  assert.equal(h.get('draft-storage-link').hidden, false); assert.equal(h.get('draft-storage-link').disabled, false);
  await h.click('draft-storage-link'); assert.equal(h.location.hash, '#storage');
});

test('visible recovery actions keep state and offline gates, with readable explanations', async () => {
  const h = await workspacePage(); await h.click('open-ledger');
  for (const id of ['restore-backup','retry-save','recover-ledger','recover-stale','backup-save-first','backup-saved-only']) {
    assert.equal(h.get(id).hidden, false, id); assert.equal(h.get(id).disabled, true, id);
  }
  h.modelSession.recoveryOutcome = 'not-saved';
  h.modelSession.unverified = true;
  await h.event('online');
  assert.equal(h.get('retry-save').disabled, false);
  assert.match(h.get('retry-save-help').textContent, /explicit confirmation/);
  h.navigator.onLine = false; await h.event('offline');
  for (const id of ['retry-save','verify-save-outcome','recover-ledger','recover-stale','release-ledger']) {
    assert.equal(h.get(id).hidden, false, id); assert.equal(h.get(id).disabled, true, id);
    assert.match(h.get(id + '-help').textContent, /internet/, id);
    await h.get(id).emit('click');
  }
  assert.equal(h.state.releases, 0); assert.equal(h.state.recovers, 0); assert.equal(h.state.writes, 0);
});

test('release stays visible but disabled until ownership and save outcome permit verified closure', async () => {
  const h = await workspacePage(); await h.click('open-ledger');
  const coordinator = h.lifecycle.coordinator;
  const original = Object.getOwnPropertyDescriptor(coordinator, 'canWrite');
  Object.defineProperty(coordinator, 'canWrite', {configurable:true,value:false});
  await h.event('online');
  assert.equal(h.get('release-ledger').disabled, true);
  assert.match(h.get('release-ledger-help').textContent, /ownership/);
  await h.get('release-ledger').emit('click'); assert.equal(h.state.releases, 0);
  if (original) Object.defineProperty(coordinator, 'canWrite', original); else delete coordinator.canWrite;
  Object.defineProperty(h.lifecycle.engine, 'recoveryRequired', {configurable:true,value:true}); await h.event('online');
  assert.equal(h.get('release-ledger').disabled, true);
  assert.match(h.get('release-ledger-help').textContent, /ownership/);
  delete h.lifecycle.engine.recoveryRequired;
  h.modelSession.pendingSave = {lifecycle:h.lifecycle,priorSequence:0};
  Object.defineProperty(h.lifecycle.engine, 'saveAttempt', {configurable:true,value:{sequence:1,authorityDispatched:true}});
  await h.event('online');
  assert.equal(h.get('release-ledger').disabled, true);
  assert.match(h.get('release-ledger-help').textContent, /save outcome/);
  await h.get('release-ledger').emit('click'); assert.equal(h.state.releases, 0);
  delete h.lifecycle.engine.saveAttempt; h.modelSession.pendingSave = null;
  h.modelSession.recoveryOutcome = 'not-saved';
  await h.event('online');
  assert.equal(h.get('release-ledger').disabled, false, 'verified not-saved draft can be explicitly discarded');
});

const inventedHistory = (workbook = 'Invented monthly records.xlsx', amount = '123.4500') => ({
  format:'finance-tracker-historical-monthly-summaries',version:1,
  expectedMonthRange:{start:'2023-01',end:'2023-03'},
  records:[{
    month:'2023-01',
    summary:{incomeTotal:{amount,currency:'USD'},expenseTotal:{amount:'0.00',currency:'USD'},netWorthSnapshot:{amount:'912.34',currency:'USD'}},
    provenance:{workbook,worksheet:'Monthly',mapping:'invented-v1'},scope:{kind:'aggregate'}
  }]
});
function historyTestFile(data, gate) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return {size:bytes.byteLength,async arrayBuffer() { if (gate) await gate.promise; return bytes.buffer; }};
}
async function selectHistoryFile(h, file) {
  const picker = h.get('historical-summary-file');
  picker.files = [file]; picker.value = 'invented.json';
  await picker.emit('change');
}

test('Storage history preview shows gaps and conflicts, then stages locally and independently reopens saved data', async () => {
  const h = await workspacePage();
  await h.navigate('#storage');
  assert.equal(h.get('historical-summary-stage').disabled,true);
  await h.click('open-ledger');
  await h.navigate('#storage');
  const file = inventedHistory('<img src="invalid">');
  file.records.push({...inventedHistory('Other invented source.xlsx','20.00').records[0]});
  await selectHistoryFile(h,historyTestFile(file));
  await h.click('historical-summary-preview');
  assert.match(h.get('historical-preview-status').textContent,/2 expected month\(s\) absent/);
  assert.match(text(h.get('historical-summary-workflow')),/overlapping month summaries/);
  assert.match(text(h.get('historical-preview-rows')),/<img src="invalid">/);
  assert.match(text(h.get('historical-preview-rows')),/Expenses: 0.00 USD/);
  for (const [choice, rationale] of [['accept','Verified synthetic primary source'],['accept','Overlapping alternate source']].entries()) {
    await h.choose('historical-record-' + choice + '-action',rationale[0]);
    const field = h.get('historical-record-' + choice + '-reason');
    field.value = rationale[1]; await field.emit('input');
  }
  assert.equal(h.get('historical-summary-stage').disabled,true);
  assert.match(h.get('historical-stage-help').textContent,/at most one source/);
  await h.choose('historical-record-1-action','exclude');
  assert.equal(h.state.writes,0);
  assert.equal(h.get('historical-summary-stage').disabled,false);
  await h.click('historical-summary-stage');
  assert.equal(h.state.writes,0);
  assert.equal(h.modelSession.dirty,true);
  assert.match(text(h.get('historical-month-view')),/Historical workbook summary/);
  assert.match(text(h.get('historical-month-view')),/123.4500 USD/);
  assert.match(text(h.get('historical-month-view')),/Net-worth snapshot \(workbook\): 912.34 USD/);
  assert.match(text(h.get('historical-month-view')),/Other invented source.xlsx/);
  assert.equal(h.get('historical-reconcile-stage').disabled,true);
  assert.match(h.get('historical-reconcile-help').textContent,/workbook summary remains the source/);
  await h.click('save-ledger');
  assert.equal(h.state.writes,1);
  const saved = await h.storedLedger();
  assert.deepEqual(saved.historicalSummaryBatches[0].entries.map(row => row.action),['accept','exclude']);
  await h.click('reopen-ledger');
  assert.match(text(h.get('historical-month-view')),/123.4500 USD/);
  assert.equal(h.modelSession.dirty,false);
  await h.click('release-ledger');
  assert.doesNotMatch(text(h.get('historical-summary-workflow')),/123.4500|Other invented source/);
  assert.equal(h.get('historical-summary-stage').disabled,true);
});

test('late historical file reads cannot overwrite a newer selection or resurrect discarded preview after navigation', async () => {
  const h = await workspacePage();
  await h.click('open-ledger');
  await h.navigate('#storage');
  const first = deferred();
  await selectHistoryFile(h,historyTestFile(inventedHistory('Old file.xlsx'),first));
  const stale = h.click('historical-summary-preview');
  await selectHistoryFile(h,historyTestFile(inventedHistory('New file.xlsx','42.00')));
  await h.click('historical-summary-preview');
  first.resolve(); await stale;
  assert.match(text(h.get('historical-preview-rows')),/New file.xlsx/);
  assert.doesNotMatch(text(h.get('historical-preview-rows')),/Old file.xlsx/);
  const next = deferred();
  await selectHistoryFile(h,historyTestFile(inventedHistory('Removed file.xlsx'),next));
  const pending = h.click('historical-summary-preview');
  await h.navigate('#overview');
  next.resolve(); await pending;
  await h.navigate('#storage');
  assert.equal(h.get('historical-summary-file').value,'');
  assert.equal(h.get('historical-summary-stage').disabled,true);
  assert.doesNotMatch(text(h.get('historical-summary-workflow')),/(New|Removed) file.xlsx/);
  assert.equal(h.state.writes,0);
});

test('Storage reconciliation switches only cash-flow source, preserves net worth and requires explicit confirmation', async () => {
  const {ledger} = replayFixture();
  const setupSession = new CanonicalWorkspaceSession({storage:{lifecycle:null},online:()=>true});
  setupSession.preview(ledger);
  setupSession.correct({activityId:ledger.activities[0].activityId,type:'classification',activityKind:'spending',rationale:'Invented source reviewed'});
  const h = await workspacePage({ledger:setupSession.ledger});
  await h.click('open-ledger');
  await h.navigate('#storage');
  const file = inventedHistory();
  file.expectedMonthRange = {start:'2026-01',end:'2026-01'};
  file.records[0].month = '2026-01';
  file.records[0].scope = {kind:'accounts',accountIds:[ledger.accounts[0].accountId]};
  await selectHistoryFile(h,historyTestFile(file));
  await h.click('historical-summary-preview');
  await h.choose('historical-record-0-action','accept');
  const reviewReason = h.get('historical-record-0-reason');
  reviewReason.value = 'Verified invented source'; await reviewReason.emit('input');
  await h.click('historical-summary-stage');
  assert.match(text(h.get('historical-month-view')),/Historical workbook summary/);
  assert.match(text(h.get('historical-month-view')),/Invented replay account/);
  const button = h.get('historical-reconcile-stage');
  assert.equal(button.disabled,true);
  for (const [field, value] of [['reason','All in-scope source records checked'],['evidence','Invented January records']]) {
    const control = h.get('historical-reconcile-' + field);
    assert.equal(control.disabled,false);
    control.value = value; await control.emit('input');
  }
  assert.equal(button.disabled,true);
  await h.choose('historical-reconcile-confirm',true);
  assert.equal(button.disabled,false);
  const gate = deferred();
  h.state.historyReconciliationGate = gate;
  const staleReconciliation = h.click('historical-reconcile-stage');
  await h.navigate('#overview');
  gate.resolve(); await staleReconciliation;
  assert.equal(h.modelSession.ledger.historicalReconciliations.length,0);
  await h.navigate('#storage');
  await h.until(() => /Historical workbook summary/.test(text(h.get('historical-month-view'))));
  h.state.historyReconciliationGate = null;
  for (const [field, value] of [['reason','All in-scope source records checked'],['evidence','Invented January records']]) {
    const control = h.get('historical-reconcile-' + field);
    control.value = value; await control.emit('input');
  }
  await h.choose('historical-reconcile-confirm',true);
  await h.click('historical-reconcile-stage');
  await h.until(() => /Reconciled transaction detail/.test(text(h.get('historical-month-view'))));
  assert.equal(h.state.writes,0);
  assert.match(text(h.get('historical-month-view')),/Expenses: 12.34 USD/);
  assert.match(text(h.get('historical-month-view')),/Net-worth snapshot \(workbook\): 912.34 USD/);
  assert.match(text(h.get('historical-month-view')),/All in-scope source records checked/);
  assert.equal(button.disabled,true);
});

async function chooseHistoricalReview(h, index, value) {
  await h.choose('historical-record-' + index + '-action','accept');
  const field = h.get('historical-record-' + index + '-reason');
  field.value = value; await field.emit('input');
}

test('canceling candidate authorization preserves a paged history review in the unchanged local preview', async () => {
  const h = await workspacePage();
  await h.navigate('#storage'); await h.click('preview-year'); await h.navigate('#storage');
  const input = inventedHistory();
  input.expectedMonthRange.end = '2024-01';
  input.records = Array.from({length:13},(_,index) => ({
    ...structuredClone(input.records[0]),month:new Date(Date.UTC(2023,index,1)).toISOString().slice(0,7)
  }));
  const file = historyTestFile(input);
  await selectHistoryFile(h,file);
  await h.click('historical-summary-preview');
  await chooseHistoricalReview(h,0,'First page reviewed');
  await h.click('historical-next');
  await chooseHistoricalReview(h,12,'Second page reviewed');
  const original = h.modelSession.ledger;
  h.state.connectionError = 'authorization-cancelled';
  h.state.publishCandidateFailure = true;
  await h.click('save-preview');
  assert.equal(h.modelSession.ledger,original);
  assert.equal(h.modelSession.mode,'preview');
  assert.equal(h.state.writes,0);
  assert.match(h.get('action-status').textContent,/cancelled/i);
  assert.equal(h.get('historical-summary-file').files[0],file);
  assert.equal(h.get('historical-summary-file').value,'invented.json');
  assert.match(h.get('historical-review-range').textContent,/Showing records 13–13 of 13/);
  assert.equal(h.get('historical-record-12-reason').value,'Second page reviewed');
  await h.click('historical-prev');
  assert.equal(h.get('historical-record-0-action').value,'accept');
  assert.equal(h.get('historical-record-0-reason').value,'First page reviewed');
  h.state.connectionError = null;
  await h.click('save-preview');
  assert.equal(h.modelSession.mode,'saved');
  assert.equal(h.state.writes,1);
  assert.equal(h.get('historical-summary-file').value,'');
  assert.equal(h.get('historical-preview-rows').children.length,0);
});

for (const saveAction of ['save-ledger','backup-save-first']) test(saveAction + ' preserves unfinished history review when it verifies the same ledger in the same folder',async () => {
  const {ledger} = replayFixture();
  const setupSession = new CanonicalWorkspaceSession({storage:{lifecycle:null},online:()=>true});
  setupSession.preview(ledger);
  setupSession.correct({activityId:ledger.activities[0].activityId,type:'classification',activityKind:'spending',rationale:'Reviewed invented purchase'});
  const h = await workspacePage({ledger:setupSession.ledger});
  await h.click('open-ledger'); await h.navigate('#storage');
  const first = inventedHistory();
  first.expectedMonthRange = {start:'2026-01',end:'2026-01'};
  first.records[0].month = '2026-01';
  first.records[0].scope = {kind:'accounts',accountIds:[ledger.accounts[0].accountId]};
  await selectHistoryFile(h,historyTestFile(first));
  await h.click('historical-summary-preview');
  await chooseHistoricalReview(h,0,'First batch reviewed');
  await h.click('historical-summary-stage');
  await h.until(() => !h.get('historical-reconcile-reason').disabled);
  for (const [field, value] of [['reason','Reviewed January coverage'],['evidence','Invented January source']]) {
    const control = h.get('historical-reconcile-' + field);
    control.value = value; await control.emit('input');
  }
  await h.choose('historical-reconcile-confirm',true);
  const second = historyTestFile(inventedHistory('Invented second batch.xlsx'));
  await selectHistoryFile(h,second);
  await h.click('historical-summary-preview');
  await chooseHistoricalReview(h,0,'Second batch reviewed');
  const original = h.modelSession.ledger;
  await h.click(saveAction);
  assert.equal(h.state.writes,1);
  assert.notEqual(h.modelSession.ledger,original);
  assert.deepEqual(h.modelSession.ledger,original);
  assert.match(h.get('action-status').textContent,saveAction === 'save-ledger' ? /Changes saved and independently verified/ : /Backup download requested/);
  assert.equal(h.get('historical-summary-file').files[0],second);
  assert.equal(h.get('historical-record-0-action').value,'accept');
  assert.equal(h.get('historical-record-0-reason').value,'Second batch reviewed');
  assert.equal(h.get('historical-summary-stage').disabled,false);
  assert.equal(h.get('historical-reconcile-reason').value,'Reviewed January coverage');
  assert.equal(h.get('historical-reconcile-evidence').value,'Invented January source');
  assert.equal(h.get('historical-reconcile-confirm').checked,true);
  assert.equal(h.get('historical-reconcile-stage').disabled,false);
  if (saveAction === 'save-ledger') {
    await h.click('release-ledger');
    assert.equal(h.get('historical-summary-file').value,'');
    assert.equal(h.get('historical-preview-rows').children.length,0);
    assert.equal(h.get('historical-reconcile-reason').value,'');
    assert.equal(h.get('historical-reconcile-confirm').checked,false);
  } else {
    // Staging after rebinding must use the newly verified ledger reference.
    await h.click('historical-summary-stage');
    assert.equal(h.modelSession.ledger.historicalSummaryBatches.length,2);
    assert.equal(h.state.writes,1);
    await selectHistoryFile(h,historyTestFile(inventedHistory('Invented third batch.xlsx')));
    await h.click('historical-summary-preview');
    await chooseHistoricalReview(h,0,'Unstaged third batch');
    await h.click('undo-last-change');
    assert.equal(h.modelSession.ledger.historicalSummaryBatches.length,1);
    assert.equal(h.get('historical-summary-file').value,'');
    assert.equal(h.get('historical-preview-rows').children.length,0);
  }
});

test('a file read pending during an equivalent verified save refreshes against the new ledger',async () => {
  const h = await workspacePage();
  await h.click('open-ledger'); await h.navigate('#storage');
  await selectHistoryFile(h,historyTestFile(inventedHistory()));
  await h.click('historical-summary-preview');
  await chooseHistoricalReview(h,0,'First batch reviewed');
  await h.click('historical-summary-stage');
  const firstRead = deferred();
  const content = new TextEncoder().encode(JSON.stringify(inventedHistory('Invented pending workbook.xlsx')));
  let calls = 0;
  await selectHistoryFile(h,{size:content.byteLength,async arrayBuffer() {
    if (++calls === 1) await firstRead.promise;
    return content.buffer;
  }});
  const pending = h.click('historical-summary-preview');
  await h.click('save-ledger');
  await h.until(() => /Invented pending workbook.xlsx/.test(text(h.get('historical-preview-rows'))));
  firstRead.resolve(); await pending;
  assert.equal(calls,2);
  assert.match(text(h.get('historical-preview-rows')),/Invented pending workbook.xlsx/);
  await chooseHistoricalReview(h,0,'Reviewed after save');
  await h.click('historical-summary-stage');
  assert.equal(h.modelSession.ledger.historicalSummaryBatches.length,2);
  assert.equal(h.state.writes,1);
});

test('redesigned shell keeps one connect panel, one save action per mode, and a trend that drills into Activity', async () => {
  const h = await workspacePage();
  assert.equal(h.get('draft-bar').hidden, true, 'nothing to save before a ledger opens');
  await h.click('start-preview');
  assert.ok(h.get('more-connect').children.includes(h.get('ledger-entry')), 'open ledger: Open and Reconnect stay reachable in More');
  assert.equal(h.get('create-ledger').hidden, true, 'a loaded preview offers one save-to-new-folder action');
  assert.equal(h.get('save-ledger-option').hidden, true);
  assert.equal(h.get('draft-storage-option').hidden, false);
  assert.equal(h.get('draft-bar').hidden, true, 'an unchanged preview has nothing to save');
  const months = h.get('home-trend-months').children;
  assert.equal(months.length, 6);
  assert.ok(months.every(item => /^\d{4}-\d{2}$/.test(item.children[0].dataset.month)));
  assert.match(h.get('home-trend-context').textContent, /USD · All accounts\. Known transactions only, possibly partial; an empty month means no data, not zero\./);
  const gap = months.find(item => item.children[0].dataset.source === 'no-data');
  assert.ok(gap, 'months without transactions are labelled, never drawn as zero');
  assert.match(gap.children[0].attributes['aria-label'], /no data/);
  const december = months.find(item => item.children[0].dataset.month === '2024-12').children[0];
  await december.click();
  assert.equal(december.attributes['aria-pressed'], 'true');
  const note = h.get('home-trend-readout').children[1];
  assert.match(text(h.get('home-trend-readout')), /December 2024/);
  await note.children.find(child => child.tagName === 'BUTTON').click();
  assert.equal(h.location.hash, '#transactions');
  assert.equal(h.get('month-filter').value, '2024-12');
  assert.equal(h.get('clear-activity-filters').hidden, true);
  await h.search('INVENTED');
  assert.equal(h.get('clear-activity-filters').hidden, false);
  await h.click('clear-activity-filters');
  assert.equal(h.get('transaction-search').value, '');
  assert.equal(h.get('review-only').checked, false);
  assert.equal(h.get('clear-activity-filters').hidden, true);
  assert.equal(h.state.writes, 0);
});

const findText = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children || []) { const found = findText(child, predicate); if (found) return found; }
  return null;
};

test('type and category facets, status chips and sort change rows only and clear back to the full list', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  const annual = h.summary();
  const typeOption = id => h.get('type-options').children.find(option => option.children[0].value === id).children[0];
  const spending = typeOption('spending'); spending.checked = true; await spending.emit('change');
  assert.match(h.get('filter-count').textContent, /^108 matching activities of 253/);
  assert.equal(records(h).every(row => row.attributes['data-kind'] === 'spending'), true);
  assert.equal(h.get('type-facet-summary').textContent, 'Spending');
  assert.equal(h.summary(), annual, 'filters never change the period totals');
  const groceries = h.get('category-options').children.find(option => option.children[0].value === 'groceries').children[0];
  groceries.checked = true; await groceries.emit('change');
  assert.match(h.get('filter-count').textContent, /^24 matching/);
  assert.equal(h.get('active-filters').hidden, false);
  assert.deepEqual(h.get('active-filter-chips').children.map(item => text(item).trim()), ['Spending', 'Groceries']);
  // Month headers say they total the matching rows only while filters are active.
  const header = h.get('transaction-rows').children[0];
  assert.equal(header.className, 'month-group');
  assert.match(text(header), /December 2025.*2 activities.*Shown.*\$194\.75/);
  await h.get('active-filter-chips').children[0].children[0].click();
  assert.match(h.get('filter-count').textContent, /^24 matching/, 'removing the type chip keeps the category filter');
  await h.choose('activity-sort', 'largest-out');
  assert.equal(h.get('transaction-rows').children.some(row => row.className === 'month-group'), false, 'amount order is one ranked list');
  await h.click('clear-activity-filters');
  assert.match(h.get('filter-count').textContent, /^253 matching/);
  assert.equal(h.get('activity-sort').value, 'newest');
  assert.equal(h.get('active-filters').hidden, true);
  assert.equal(h.summary(), annual);
  assert.equal(h.state.writes, 0);
});

test('month headers total posted rows with the report rule and Show more continues the list', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  const header = h.get('transaction-rows').children[0];
  assert.match(text(header), /December 2025.*21 activities.*In.*\$7,613\.00.*Out.*\$2,826\.75.*4 not counted/);
  assert.doesNotMatch(text(header), /Shown/, 'an unfiltered header is the month total for this scope');
  assert.equal(records(h).length, 50);
  assert.equal(h.get('show-more').hidden, false);
  assert.equal(h.get('show-more').textContent, 'Show 50 more');
  await h.click('show-more');
  assert.equal(records(h).length, 100);
  assert.equal(h.get('page-status').textContent, 'Showing 100 of 253');
  assert.equal(h.observed.focused, records(h)[50].children.at(-1).children[0], 'focus continues at the first new row');
  while (!h.get('show-more').hidden) await h.click('show-more');
  assert.equal(records(h).length, 253);
  assert.equal(h.get('show-more').hidden, true);
  const months = h.get('transaction-rows').children.filter(row => row.className === 'month-group');
  assert.equal(months.length, 12, 'each month heads its rows once');
  const transfers = h.get('type-options').children.find(option => option.children[0].value === 'transfer').children[0];
  transfers.checked = true; await transfers.emit('change');
  assert.match(text(h.get('transaction-rows').children[0]), /No income or spending/, 'transfers never read as $0.00 in or out');
  assert.doesNotMatch(text(h.get('transaction-rows').children[0]), /\$0\.00/);
});

test('inline decision stages type and category without leaving the list, then moves to the next flagged row', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  await h.choose('review-only', true);
  const first = records(h)[0];
  const decide = findText(first, node => node.className === 'decide-button');
  assert.ok(decide, 'flagged rows offer an inline decision');
  assert.equal(decide.textContent, 'Decide');
  await decide.click();
  assert.equal(h.location.hash, '#transactions');
  assert.equal(h.observed.focused, h.get('quick-type'));
  assert.deepEqual(h.get('quick-type').children.map(option => option.value), ['spending', 'transfer'], 'money out offers only compatible types');
  assert.match(h.get('quick-help').textContent, /Still needs the full view: posting status unknown/);
  h.get('quick-category').value = '__new'; await h.get('quick-category').emit('change');
  const stage = findText(h.get('quick-review'), node => node.textContent === 'Stage decision');
  assert.equal(stage.disabled, true, 'a new category needs a name');
  const input = findText(h.get('quick-review'), node => node.tagName === 'INPUT' && node.type === 'text');
  input.value = 'Brokerage costs'; await input.emit('input');
  assert.equal(stage.disabled, false);
  const second = records(h)[1];
  await stage.click();
  const fee = getEffectiveActivities(h.modelSession.ledger).find(activity => activity.sourceDescription === 'INVENTED BROKERAGE FEE' && activity.effectiveDate === '2025-12-26');
  assert.equal(fee.activityKind, 'spending');
  assert.equal(fee.categoryId, 'brokerage-costs');
  assert.equal(h.modelSession.dirty, true);
  assert.equal(h.state.writes, 0, 'staging never saves');
  assert.match(h.get('action-status').textContent, /Decision staged locally/);
  const secondDescription = text(second.children[1]);
  const nextRow = records(h).find(item => text(item.children[1]) === secondDescription);
  assert.equal(h.observed.focused, findText(nextRow, node => node.className === 'decide-button'));
  // Posting status is still unknown, so the row stays in Needs review without an inline action.
  const row = records(h).find(item => /INVENTED BROKERAGE FEE/.test(text(item)));
  assert.match(text(row), /Posting status unknown/);
  assert.equal(findText(row, node => node.className === 'decide-button'), null);
});

test('Cancel closes an inline decision and discards its draft', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  await h.choose('review-only', true);
  await findText(records(h)[0], node => node.className === 'decide-button').click();
  h.get('quick-category').value = 'groceries'; await h.get('quick-category').emit('change');
  await findText(h.get('quick-review'), node => node.textContent === 'Cancel').click();
  assert.equal(h.get('transaction-rows').children.some(row => row.className === 'quick-review'), false);
  await findText(records(h)[0], node => node.className === 'decide-button').click();
  assert.equal(h.get('quick-category').value, '', 'a cancelled draft is not restored');
  assert.equal(h.modelSession.dirty, false);
});

test('verified release clears facet labels, counts, chips and filters that could name records', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.navigate('#transactions');
  const groceries = h.get('category-options').children.find(option => option.children[0].value === 'groceries').children[0];
  groceries.checked = true; await groceries.emit('change');
  await h.choose('review-only', true);
  assert.equal(h.get('category-facet-summary').textContent, 'Groceries');
  assert.notEqual(h.get('review-facet-count').textContent, '');
  h.state.releaseVerified = true; await h.click('release-ledger');
  assert.equal(h.modelSession.ledger, null);
  for (const id of ['type-facet-summary', 'category-facet-summary', 'review-facet-count', 'pending-facet-count', 'filter-badge']) assert.equal(h.get(id).textContent, '', id);
  for (const id of ['type-options', 'category-options', 'active-filter-chips', 'transaction-rows', 'review-queue']) assert.equal(h.get(id).children.length, 0, id);
  assert.equal(h.get('apply-filter-sheet').textContent, 'Show results');
  assert.equal(h.get('review-only').checked, false);
  assert.equal(h.get('active-filters').hidden, true);
  assert.equal(h.state.writes, 0);
});

test('inline notes follow the change until edited, and the rule checkbox is an explicit opt-in', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  await h.choose('review-only', true);
  await findText(records(h)[0], node => node.className === 'decide-button').click();
  const panel = h.get('quick-review');
  const note = findText(panel, node => node.tagName === 'LABEL' && node.textContent === 'Note for the history').children[0];
  const ruleField = findText(panel, node => /quick-rule/.test(node.className || ''));
  const rule = ruleField.children[0];
  assert.equal(note.value, 'Reviewed in Activity: classified as spending (was unclassified).');
  assert.equal(ruleField.hidden, true, 'no rule choice until the category changes');
  h.get('quick-category').value = 'fees-and-interest'; await h.get('quick-category').emit('change');
  assert.equal(note.value, 'Reviewed in Activity: classified as spending (was unclassified); category set to Fees and interest (was no category).');
  assert.equal(ruleField.hidden, false);
  assert.equal(rule.checked, false, 'rules are opt-in');
  rule.checked = true; await rule.emit('change');
  assert.match(note.value, /Also applied to later imports with the same description\.$/);
  h.get('quick-type').value = 'transfer'; await h.get('quick-type').emit('change');
  assert.match(note.value, /^Reviewed in Activity: classified as transfer \(was unclassified\); category set to Fees and interest/);
  await findText(panel, node => node.textContent === 'Stage decision').click();
  const fee = getEffectiveActivities(h.modelSession.ledger).find(activity => activity.sourceDescription === 'INVENTED BROKERAGE FEE' && activity.effectiveDate === '2025-12-26');
  assert.deepEqual([fee.activityKind, fee.categoryId], ['transfer', 'fees-and-interest']);
  const events = h.modelSession.ledger.events.filter(event => event.activityId === fee.activityId);
  assert.equal(events.at(-1).prospectiveRule.enabled, true);
  assert.ok(events.every(event => event.evidence.rationale === note.value));
  // An edited note is the owner's own words and is never overwritten.
  await findText(records(h).find(item => findText(item, node => node.className === 'decide-button')), node => node.className === 'decide-button').click();
  const second = findText(h.get('quick-review'), node => node.tagName === 'LABEL' && node.textContent === 'Note for the history').children[0];
  second.value = 'Invented owner reason'; await second.emit('input');
  h.get('quick-category').value = 'groceries'; await h.get('quick-category').emit('change');
  assert.equal(second.value, 'Invented owner reason');
});

test('the full correction form suggests a note from the change and defaults to no rule', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  await h.detail('GROCER 1');
  assert.equal(h.get('category-rule-field').hidden, true);
  await h.choose('correction-type', 'category-correction');
  assert.equal(h.get('category-rule-field').hidden, false);
  assert.equal(h.get('category-rule').checked, false);
  assert.equal(h.get('correction-rationale').value, '', 'no change, no note');
  assert.equal(h.get('stage-correction').disabled, true);
  h.get('category').value = 'dining'; await h.get('category').emit('input');
  assert.equal(h.get('correction-rationale').value, 'Changed category from Groceries to Dining.');
  assert.equal(h.get('stage-correction').disabled, false);
  await h.click('stage-correction');
  const event = h.modelSession.ledger.events.at(-1);
  assert.equal(event.evidence.rationale, 'Changed category from Groceries to Dining.');
  assert.deepEqual([event.prospectiveRule.requested, event.prospectiveRule.enabled], [false, false]);
  assert.match(text(h.get('detail-history')), /This transaction only\. No rule for later imports\./);
  await h.choose('correction-type', 'bank-correction');
  h.get('amount').value = '-12.00'; await h.get('amount').emit('input');
  assert.match(h.get('correction-rationale').value, /^Corrected amount from -\$[\d,]+\.\d{2} to -\$12\.00\.$/);
});

test('History migration page stages a typed year with one confirmation, saves it, and resumes after reopen', async () => {
  const h = await workspacePage();
  const type = async (id, value) => { const node = h.get(id); node.value = value; await node.emit('input'); };
  assert.equal(h.get('home-migration-link').hidden, true);
  await h.click('open-ledger');
  assert.equal(h.get('home-migration-link').hidden, false);
  await h.navigate('#migration');
  assert.equal(h.get('page-title').textContent, 'History migration');
  await type('migration-workbook', 'Invented finances.xlsx');
  await type('migration-opening', '1,000.00');
  const last = h.get('migration-last'); last.value = '2023-03'; await last.emit('change');
  const account = h.modelSession.ledger.accounts.find(item => item.institutionId !== 'fidelity');
  await h.choose('migration-account-' + account.accountId, true);
  await type('migration-income-label-r0', 'Invented pay');
  await type('migration-expenses-label-r1', 'Invented living');
  assert.equal(h.get('migration-stage').disabled, true);
  assert.match(h.get('migration-stage-help').textContent, /Fill every cell for 2023/);
  for (const month of ['2023-01', '2023-02', '2023-03']) {
    await type(`migration-cell-${month}-income-r0`, '$100');
    await type(`migration-cell-${month}-expenses-r1`, '40.00');
  }
  await type('migration-check-2023-02', '1060.00');
  await type('migration-check-2023-03', '1100.00');
  assert.match(text(h.get('migration-grid-wrap')), /Matches/);
  assert.match(text(h.get('migration-grid-wrap')), /Off by 20.00/);
  assert.match(h.get('migration-stage-help').textContent, /Confirm that you compared/);
  await h.choose('migration-confirm', true);
  assert.equal(h.get('migration-stage').disabled, false);
  await h.click('migration-stage');
  assert.equal(h.state.writes, 0, 'staging never writes');
  assert.equal(h.modelSession.dirty, true);
  assert.match(text(h.get('migration-progress-summary')), /0 of 3 months saved\s+· 3 staged, not saved yet/);
  await h.click('save-ledger');
  assert.equal(h.state.writes, 1);
  assert.match(text(h.get('migration-progress-summary')), /3 of 3 months saved/);
  assert.equal(h.get('home-migration-link').hidden, true, 'the Home link disappears once every month is saved');
  const saved = await h.storedLedger();
  const batch = saved.historicalSummaryBatches.at(-1);
  assert.equal(batch.version, 2);
  assert.deepEqual(batch.entries.map(entry => [entry.record.month, entry.action, entry.reason]), ['2023-01', '2023-02', '2023-03']
    .map(month => [month, 'accept', 'Typed by hand from the 2023 sheet of Invented finances.xlsx.']));
  assert.deepEqual(batch.entries[0].record.summary.netWorthSnapshot, {amount:'1060.00', currency:'USD'});
  assert.deepEqual(batch.entries[1].record.scope, {kind:'accounts', accountIds:[account.accountId]});
  assert.equal(JSON.stringify(saved).includes('1100.00'), false, 'workbook check values are never stored');
  await h.click('reopen-ledger');
  await h.navigate('#migration');
  assert.match(text(h.get('migration-progress-summary')), /3 of 3 months saved/);
  assert.equal(h.get('migration-workbook').value, 'Invented finances.xlsx');
  assert.equal(h.get('migration-stage').disabled, true);
  assert.match(h.get('migration-stage-help').textContent, /already saved/);
  await h.click('release-ledger');
  assert.doesNotMatch(text(h.get('history-migration')), /Invented finances|Invented pay/);
});
