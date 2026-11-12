import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';
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
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {registerAccount, prepareCanonicalImport, applyReviewDecision, getEffectiveActivities} from '../js/canonical-import.mjs';
import {exactSignedDecimal, isCalendarDate} from '../js/import-reconciliation.mjs';
import {replayFixture, replayInput, replayRow} from './helpers/ledger-replay-fixtures.mjs';
import {pageController, deferred} from './helpers/page-controller.mjs';

const recipe = await createSyntheticFinancialYear();
const text = element => [element.textContent, ...element.children.map(text)].join(' ');

async function workspacePage({ledger = recipe.ledger} = {}) {
  const state = {connects:[],writes:0,snapshotReads:0,releases:0,recovers:0,connectionError:null,saveGate:null,readbackGate:null,
    loseResponse:false,failSave:false,releaseVerified:true,snapshotError:false,recoveryGate:null};
  const physical = await createPagedFixture();
  const initialStore = new CanonicalLedgerStore({lifecycle:physical.lifecycle});
  await initialStore.load(); await initialStore.save(ledger);
  const {manifest,objects} = physical;
  const readSnapshot = physical.lifecycle.readPartitionedSnapshot, saveRoot = physical.lifecycle.savePartitionedRoot;
  let storage, session, browserNavigator;
  const timeouts = new Map();
  const timers = { setTimeout(callback, delay) { timeouts.set(callback, delay); return callback; }, clearTimeout(callback) { timeouts.delete(callback); } };
  const flushSearch = async () => { const callbacks = [...timeouts.keys()]; timeouts.clear(); for (const callback of callbacks) await callback(); };
  const lifecycle = {
    ...physical.lifecycle,
    state:'ready',acceptingWrites:true,coordinator:{canWrite:true},folderId:'invented-ui-folder',
    async readManifest() { return structuredClone(manifest); },
    async readObject(path) { return objects[path]; },
    async readPartitionedSnapshot() {
      state.snapshotReads++;
      if (state.openGate) await state.openGate.promise;
      if (state.snapshotError) throw Object.assign(new Error('Private provider body'), {code:'snapshot-unavailable'});
      if (manifest.revision > 1 && state.readbackGate) await state.readbackGate.promise;
      return readSnapshot();
    },
    async savePartitionedRoot(transaction) {
      assert.deepEqual(transaction.expectedBase, manifest);
      if (state.saveGate) await state.saveGate.promise;
      if (state.failSave) throw Object.assign(new Error('Private provider detail'), {code:'base-conflict'});
      state.writes++;
      await saveRoot(transaction);
      if (state.loseResponse) {
        lifecycle.state = 'recovery-required'; lifecycle.acceptingWrites = false;
        storage.options.onStatus({state:lifecycle.state});
        throw Object.assign(new Error('Private lost commit response'), {code:'transaction-unresolved'});
      }
    },
    async recover() {
      state.recovers++; if (state.recoveryGate) await state.recoveryGate.promise; lifecycle.state = 'ready'; lifecycle.acceptingWrites = true;
      storage.options.onStatus({state:'ready'});
    },
  };
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; this.accessToken = 'invented-token'; storage = this; }
    async prepare() {}
    async connect(options) {
      state.connects.push(options);
      if (state.connectionError) throw Object.assign(new Error('Private provider detail'), {code:state.connectionError});
      if (options.requireEmpty === true) {
        assert.equal(options.requireExisting, undefined);
        await physical.reset();
      } else {
        assert.equal(options.requireExisting, true);
        assert.equal(options.requireEmpty, undefined);
      }
      this.lifecycle = lifecycle; lifecycle.state = 'ready'; lifecycle.acceptingWrites = true;
      this.options.onStatus({state:'ready'});
    }
    async release() {
      state.releases++;
      if (state.releaseVerified) { this.lifecycle = null; this.options.onStatus({state:'disconnected'}); }
      return {released:state.releaseVerified};
    }
    async recoverStaleSession() { await lifecycle.recover(); }
  }
  class BrowserSession extends CanonicalWorkspaceSession {
    constructor(options) { super({...options, online:() => browserNavigator?.onLine !== false}); session = this; }
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
  return {...page,state,manifest,objects,storage,lifecycle,modelSession:session,timeouts,flushSearch,
    summary:() => text(page.get('summary-cards')),
    async search(value) { page.get('transaction-search').value = value; await page.get('transaction-search').emit('input'); await flushSearch(); },
    async detail(description = 'INVENTED UTILITY') {
      await page.navigate('#transactions');
      await page.choose('month-filter', '2025-01');
      page.get('transaction-search').value = description; await page.get('transaction-search').emit('input'); await flushSearch();
      const row = page.get('transaction-rows').children[0]; assert.ok(row, 'Expected an activity row');
      await row.children.at(-1).children[0].click();
    },
    async stageAmount(value = '-150.00') {
      await this.detail(); await page.choose('correction-type', 'bank-correction');
      page.get('amount').value = value;
      page.get('correction-rationale').value = 'Invented corrected utility receipt';
      await page.get('correction-rationale').emit('input');
      await page.click('stage-correction');
    },
    async replaceSavedLedger(next) {
      await physical.reset();
      const store = new CanonicalLedgerStore({lifecycle:physical.lifecycle});
      await store.load(); await store.save(next);
    },
    async storedLedger() { return new CanonicalLedgerStore({lifecycle}).load(); },
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
  assert.equal(h.get('transaction-rows').children.length, 25);
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
  assert.equal(h.get('transaction-rows').children.length, 12);
  assert.equal(h.summary(), annual);
  await h.search(''); await h.choose('review-only', true);
  assert.match(h.get('filter-count').textContent, /48 matching activities of 253/);
  assert.equal(h.summary(), annual);
  await h.click('next-page');
  assert.equal(h.get('page-status').textContent, 'Page 2 of 2');
  assert.equal(h.get('transaction-rows').children.length, 23);
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
  assert.equal(h.get('page-status').textContent, 'Page 1 of 1');
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
  assert.equal(h.storage.options.maintainOriginals, false);
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

for (const committed of [false, true]) test(`${committed ? 'lost commit response' : 'rejected save'} keeps draft and blocks retries until verified reopen`, async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposed = structuredClone(h.modelSession.ledger);
  h.state.loseResponse = committed; h.state.failSave = !committed;
  await h.click('save-ledger');
  assert.equal(h.state.writes, committed ? 1 : 0);
  assert.equal(h.get('save-state').dataset.state, 'unverified');
  assert.equal(h.get('action-status').dataset.kind, 'error');
  assert.match(h.get('save-state').textContent, /Save unverified/);
  assert.equal(h.get('save-ledger').disabled, true);
  assert.equal(h.get('stage-correction').disabled, true);
  assert.deepEqual(h.modelSession.ledger, proposed);
  await h.click('save-ledger');
  assert.equal(h.state.writes, committed ? 1 : 0);
  h.state.loseResponse = false; h.state.failSave = false;
  if (committed) {
    assert.equal(h.get('recover-ledger').hidden, false);
    await h.click('recover-ledger');
    assert.equal(h.state.recovers, 1);
    assert.equal(h.get('save-ledger').disabled, true);
    assert.deepEqual(h.modelSession.ledger, proposed);
  }
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
  assert.equal(h.get('data-mode').textContent, 'Synthetic · read-only');
  assert.deepEqual(h.modelSession.ledger, proposed);
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
  assert.equal(h.observed.focused, h.get('transaction-rows').children[0].children.at(-1).children[0]);
});

test('a positive spending correction stays visible in review with its financial exclusion explained', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount('160.00');
  assert.equal(h.get('detail-amount').textContent, '$160.00');
  assert.match(h.get('detail-description').textContent, /Needs review:/);
  await h.choose('review-only', true);
  assert.equal(h.get('transaction-rows').children.length, 1);
  assert.match(text(h.get('transaction-rows')), /Needs review:/);
  assert.match(h.summary(), /\$2,311\.25/);
  assert.equal(h.modelSession.dirty, true);
  assert.equal(h.state.writes, 0);
});

test('cancelled reopening explicitly announces cancellation without suggesting ongoing work', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  h.observed.confirm = false;
  h.get('transaction-search').value = 'nothing matches'; await h.get('transaction-search').emit('input');
  await h.click('reopen-ledger');
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.get('transaction-rows').children.length, 0);
  assert.match(h.get('action-status').textContent, /cancelled/i);
  assert.doesNotMatch(h.get('action-status').textContent, /Reopening and verifying/);
  assert.equal(h.modelSession.dirty, true);
  assert.equal(h.intervals.size, 0);
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
  assert.equal(h.get('transaction-rows').children.length, 12);
  assert.equal(h.summary(), summary);
  await h.get('transaction-search').emit('compositionstart');
  h.get('transaction-search').value = 'unmatched invented'; await h.get('transaction-search').emit('input');
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.get('transaction-rows').children.length, 12);
  await h.get('transaction-search').emit('compositionend');
  assert.equal(h.timeouts.size, 1); await h.flushSearch();
  assert.equal(h.get('transaction-rows').children.length, 0);
  assert.equal(h.summary(), summary);
});

test('account and period selections consume the latest pending search without a delayed stale render', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  h.get('transaction-search').value = 'utility'; await h.get('transaction-search').emit('input');
  await h.choose('month-filter', '2025-01');
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.get('transaction-rows').children.length, 1);
  assert.match(h.summary(), /\$2,471\.25/);
  await h.flushSearch();
  assert.equal(h.get('transaction-rows').children.length, 1);
  await h.choose('account-filter', recipe.accounts.investment);
  assert.equal(h.get('transaction-rows').children.length, 0);
  assert.equal((h.summary().match(/Unavailable/g) || []).length, 3);
});

test('filter changes preserve staged draft and a failed reopen preserves the last visible financial view', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  const proposal = structuredClone(h.modelSession.ledger);
  await h.search(''); await h.choose('month-filter', ''); await h.click('next-page');
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
  const inspect = h.get('transaction-rows').children[0].children.at(-1).children[0];
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
  const review = h.get('transaction-rows').children[0].children.at(-1).children[0];
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
  assert.match(text(h.get('review-queue')), /Showing 10 of 12 unresolved source observations in this account and period/);
  assert.equal(h.get('review-queue').children.filter(item => item.tagName === 'ARTICLE').length, 10);
  assert.equal(h.get('transaction-count').textContent, '1');
  await h.search('nothing matches');
  assert.match(text(h.get('review-queue')), /Showing 10 of 12/);
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
  assert.match(text(h.get('review-queue')), /Showing 10 of 11/);
  assert.equal(h.modelSession.ledger.activities.length, 1);
  assert.equal(h.state.writes, 0);
});


test('main workspace can explicitly save the exact local preview into a fresh synthetic copy', async () => {
  const h = await workspacePage();
  await h.click('preview-year');
  assert.equal(h.modelSession.mode, 'preview');
  assert.equal(h.get('save-preview').disabled, false);
  await h.click('save-preview');
  assert.deepEqual(h.state.connects, [{requireEmpty:true,canonicalLayout:'partitions-v5'}]);
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
  for (const hash of ['#position','#holdings','#review','#reconciliation','#storage','#overview','#transactions']) {
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
  assert.equal(h.state.writes, 1); assert.equal(h.get('draft-bar').hidden, true);
  assert.equal(h.location.hash, '#overview');
  assert.deepEqual(await h.storedLedger(), proposed);
});

test('page navigation during an uncertain save preserves warning, recovery and the staged ledger', async () => {
  const h = await workspacePage(); await h.click('open-ledger'); await h.stageAmount();
  h.state.loseResponse = true; await h.click('save-ledger');
  assert.equal(h.modelSession.unverified, true);
  assert.equal(h.get('draft-bar').hidden, false);
  assert.match(h.get('draft-summary').textContent, /Save unverified/);
  const draft = structuredClone(h.modelSession.ledger), writes = h.state.writes;
  await h.navigate('#position'); await h.navigate('#storage');
  assert.equal(h.get('recover-ledger').hidden, false);
  assert.deepEqual(h.modelSession.ledger,draft); assert.equal(h.state.writes,writes);
  assert.equal(h.get('save-ledger').disabled,true);
  assert.match(h.get('save-state').textContent,/Recover if offered/);
});

test('review drilldown opens Activity and first-run preview opens Home without storage calls', async () => {
  const h = await workspacePage();
  assert.equal(h.get('workspace-scope').hidden,true);
  assert.equal(h.get('welcome-panel').hidden,false);
  await h.click('start-preview');
  assert.equal(h.location.hash,'#overview');
  assert.equal(h.get('welcome-panel').hidden,true);
  assert.equal(h.get('workspace-scope').hidden,false);
  await h.click('preview-year'); await h.navigate('#review');
  const action = h.get('review-queue').children.find(child => child.tagName === 'BUTTON');
  await action.click();
  assert.equal(h.location.hash,'#transactions');
  assert.equal(h.get('review-only').checked,true);
  assert.equal(h.observed.focused,h.get('transaction-search'));
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
  assert.equal(h.location.hash, '#review');
  assert.equal(h.get('review').hidden, false);
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

test('Storage distinguishes the active saved format from preview and experimental formats', async () => {
  const h = await workspacePage();
  assert.match(h.get('storage-format').textContent, /No saved format currently verified/);
  await h.click('preview-year');
  assert.match(h.get('storage-format').textContent, /Local preview, no saved format yet/);
  assert.match(h.get('storage-format').textContent, /new folder will use canonical v5/);
  await h.click('open-ledger');
  assert.match(h.get('storage-format').textContent, /Last verified saved format: canonical v5, compact-json-v1/);
  await h.click('release-ledger');
  assert.match(h.get('storage-format').textContent, /No saved format currently verified/);
  await h.click('preview-year');
  await h.click('save-preview');
  assert.match(h.get('storage-format').textContent, /Last verified saved format: canonical v5, compact-json-v1/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /canonical v5 with the explicit compact-json-v1 value codec/);
  assert.match(html, /Opening a copy still verifies and loads the complete canonical ledger/);
  assert.match(html, /Existing folders are not silently converted/);
});


test('Home recent activity ignores Activity search, review filter and pagination, and returns focus after inspection', async () => {
  const h = await workspacePage(); await h.click('preview-year');
  const recent = h.get('recent-activities');
  assert.equal(recent.children.length, 4);
  const original = text(recent), count = h.get('attention-count').textContent;
  await h.navigate('#transactions');
  await h.search('a deliberately unmatched invented phrase');
  await h.choose('review-only', true);
  assert.equal(h.get('transaction-rows').children.length, 0);
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
  assert.match(h.get('overview-review-title').textContent, /records|unresolved/);
  assert.equal(h.state.writes, 0);
});


test('transaction rows open from their text while selection and bubbled button clicks remain safe', async () => {
  const h = await workspacePage(); await h.click('preview-year'); await h.navigate('#transactions');
  const row = h.get('transaction-rows').children[0], button = row.children.at(-1).children[0];
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
  await h.search('INVENTED'); await h.click('next-page');
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
