import test from 'node:test';
import assert from 'node:assert/strict';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createWorkspaceView, getWorkspaceActivity} from '../js/canonical-workspace-model.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {CanonicalLedgerStore, serializePackedCanonicalLedger} from '../js/canonical-ledger-storage.mjs';
import {registerAccount} from '../js/canonical-import.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {pageController, deferred} from './helpers/page-controller.mjs';

const recipe = await createSyntheticFinancialYear();
const text = element => [element.textContent, ...element.children.map(text)].join(' ');

async function workspacePage({ledger = recipe.ledger} = {}) {
  const state = {connects:[],writes:0,snapshotReads:0,releases:0,recovers:0,connectionError:null,saveGate:null,readbackGate:null,
    loseResponse:false,failSave:false,releaseVerified:true};
  const manifest = {syntheticOnly:true,databaseId:'invented-ui-db',copyId:'invented-ui-copy',revision:1,snapshot:{}};
  const objects = Object.fromEntries([...serializePackedCanonicalLedger(ledger)].map(([path, value]) => [path,new TextEncoder().encode(value)]));
  for (const path of Object.keys(objects)) manifest.snapshot[path] = 'invented-hash';
  let storage, session, browserNavigator;
  const lifecycle = {
    state:'ready',acceptingWrites:true,coordinator:{canWrite:true},folderId:'invented-ui-folder',
    async readManifest() { return structuredClone(manifest); },
    async readObject(path) { return objects[path]; },
    async readVerifiedSnapshot() {
      state.snapshotReads++;
      if (manifest.revision > 1 && state.readbackGate) await state.readbackGate.promise;
      return {manifest:structuredClone(manifest),objects:structuredClone(objects)};
    },
    async transact(transaction) {
      assert.deepEqual(transaction.expectedBase, manifest);
      if (state.saveGate) await state.saveGate.promise;
      if (state.failSave) throw Object.assign(new Error('Private provider detail'), {code:'base-conflict'});
      state.writes++;
      for (const {logicalPath, content} of transaction.objects) {
        objects[logicalPath] = new TextEncoder().encode(content); manifest.snapshot[logicalPath] = 'invented-hash';
      }
      manifest.revision++;
      if (state.loseResponse) {
        lifecycle.state = 'recovery-required'; lifecycle.acceptingWrites = false;
        storage.options.onStatus({state:lifecycle.state});
        throw Object.assign(new Error('Private lost commit response'), {code:'transaction-unresolved'});
      }
    },
    async recover() {
      state.recovers++; lifecycle.state = 'ready'; lifecycle.acceptingWrites = true;
      storage.options.onStatus({state:'ready'});
    },
  };
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; this.accessToken = 'invented-token'; storage = this; }
    async prepare() {}
    async connect(options) {
      state.connects.push(options);
      if (state.connectionError) throw Object.assign(new Error('Private provider detail'), {code:state.connectionError});
      assert.equal(options.requireExisting, true);
      assert.equal(options.requireEmpty, undefined);
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
    CanonicalWorkspaceSession:BrowserSession, createWorkspaceView,getWorkspaceActivity,createSyntheticFinancialYear,TypeError},
  {htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs'});
  browserNavigator = page.navigator;
  return {...page,state,manifest,objects,storage,lifecycle,modelSession:session,
    summary:() => text(page.get('summary-cards')),
    async search(value) { page.get('transaction-search').value = value; await page.get('transaction-search').emit('input'); },
    async detail(description = 'INVENTED UTILITY') {
      await page.choose('month-filter', '2025-01');
      page.get('transaction-search').value = description; await page.get('transaction-search').emit('input');
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
  assert.match(h.get('save-state').textContent, /Local preview changes only/);
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
  assert.match(h.get('save-state').textContent, /1 unsaved correction/);
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
  assert.equal(h.observed.focused, h.get('transaction-search'));
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
