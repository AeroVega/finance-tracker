import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLiveRunner, LIVE_IDS, blankLive, prepareInterruption, verifyInterruption } from '../prototype/pr28-live-checks.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { summarizeLedger } from '../js/canonical-import.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';
const loadBytes = path => readFile(new URL('../prototype/' + path, import.meta.url));

async function harness() {
  const setup = await createPagedFixture(),lifecycle=setup.lifecycle;
  let failWrite=false;
  const save=lifecycle.savePartitionedRoot;
  lifecycle.savePartitionedRoot=async args=>{if(failWrite)throw Object.assign(new Error('uncertain write'),{code:'transaction-unresolved'});return save(args);};
  setup.adapter={get mutations(){return setup.commits.length;},set stopAfter(value){failWrite=true;},reboot(){failWrite=false;}};
  setup.engine={recover:async()=>{}};
  let store = new CanonicalLedgerStore({ lifecycle }); await store.load();
  let staged, dirty = false, connected = true, occupied = false;
  const calls = { saves: 0, opens: 0, portable: 0, revalidated: 0, releases: 0, leases: 0 };
  const identity = { databaseId: setup.manifest.databaseId, copyId: setup.manifest.copyId };
  const driver = {
    async requireFresh() { assert.equal(dirty, false); assert.equal(await store.load(), null); assert.equal(store.base.revision, '0'); assert.equal(store.base.pending, null); },
    async identity() { return structuredClone(identity); },
    stage(next) { staged = structuredClone(next); dirty = true; },
    async save(next) { calls.saves++; const saved = await store.save(next); staged = saved; dirty = false; return saved; },
    async reopen() { calls.opens++; store = new CanonicalLedgerStore({ lifecycle }); staged = await store.load(); dirty = false; return staged; },
    async verifyPortable() { calls.portable++; assert.deepEqual(await new CanonicalLedgerStore({lifecycle}).load(),staged); },
    async revalidate() { calls.revalidated++; },
    async release() { calls.releases++; connected = false; }
  };
  const withWorkbench = async operation => { calls.leases++; assert.equal(connected, true); assert.equal(dirty, false); assert.equal(occupied, false); occupied = true; try { return await operation(driver); } finally { occupied = false; } };
  return { setup, lifecycle, calls, driver, withWorkbench, identity, connect() { connected = true; }, get ledger() { return staged; }, get dirty() { return dirty; } };
}

test('live runner uses v5 fixture for full invented recipe, saves, independent opens, portable callback and release', async () => {
  const h = await harness(); let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => { last = update; } });
  assert.equal(await runner.run(), true, JSON.stringify(last));
  assert.deepEqual(Object.keys(last.results), LIVE_IDS);
  assert.equal(Object.values(last.results).filter(value => value === 'passed').length, LIVE_IDS.length - 1);
  assert.equal(last.results['reconnect-same-copy'], 'not-run');
  assert.equal(h.calls.portable, 1); assert.equal(h.calls.releases, 1); assert.equal(h.calls.revalidated, 1);
  assert.equal(h.ledger.accounts.length, 5); assert.equal(h.ledger.events.length, 15); assert.equal(h.ledger.reviewDecisions.length, 8);
  const total = summarizeLedger(h.ledger, { start: '2026-01-01', end: '2026-03-31', currency: 'USD' });
  assert.equal(total.spending, '101.75'); assert.equal(total.income, '2250.37'); assert.equal(total.complete, false);
  h.connect(); assert.equal(await runner.verifyReconnect(), true); assert.equal(last.results['reconnect-same-copy'], 'passed');
  h.identity.copyId = 'different-copy'; assert.equal(await runner.verifyReconnect(), false); assert.equal(last.results['reconnect-same-copy'], 'failed');
  const mutations = h.setup.adapter.mutations;
  assert.equal(await runner.run(), false); assert.equal(last.state, 'blocked'); assert.equal(h.setup.adapter.mutations, mutations);
});

test('partial/failing runs report fixed statuses, never raw errors, never release or silently retry', async () => {
  const h = await harness(); let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes: async () => { throw new Error('private-token-and-provider-body'); }, onUpdate: update => { last = update; } });
  assert.equal(await runner.run(), false); assert.equal(last.results['mapping-coverage'], 'failed');
  assert.equal(last.results['first-save-reopen'], 'not-run'); assert.equal(h.calls.saves, 0); assert.equal(h.calls.releases, 0);
  assert.doesNotMatch(JSON.stringify(last), /private-token/);
});

test('concurrent clicks take one lease and stop waits for an admitted operation', async () => {
  const h = await harness(); let unblock, waiting;
  const gate = new Promise(resolve => { unblock = resolve; });
  const entered = new Promise(resolve => { waiting = resolve; });
  const originalSave = h.driver.save;
  h.driver.save = async value => { waiting(); await gate; return originalSave(value); };
  let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => { last = update; } });
  const pending = runner.run(); await entered;
  assert.equal(await runner.run(), false); assert.equal(h.calls.leases, 1);
  runner.stop(); assert.equal(runner.isRunning(), true); unblock();
  assert.equal(await pending, false); assert.equal(last.state, 'stopped');
  assert.equal(last.results['first-save-reopen'], 'passed'); assert.equal(last.results['repeat-import'], 'not-run');
  assert.equal(h.calls.saves, 1); assert.equal(h.calls.releases, 0);
  assert.equal(await runner.run(), false); assert.equal(last.state, 'blocked');
});

test('failed durable save is not repeated and leaves later checks unrun', async () => {
  const h = await harness(); let last;
  h.setup.adapter.stopAfter = h.setup.adapter.mutations + 1;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => { last = update; } });
  assert.equal(await runner.run(), false); assert.equal(last.results['first-save-reopen'], 'failed'); assert.equal(h.calls.saves, 1);
  assert.equal(last.results['repeat-import'], 'not-run'); assert.equal(h.calls.releases, 0);
  assert.equal(runner.canVerifyReconnect(), false);
});

test('interruption preparation saves baseline and stages just one unsaved classification', async () => {
  const h = await harness(); await prepareInterruption(h.withWorkbench, loadBytes);
  assert.equal(h.calls.saves, 1); assert.equal(h.calls.opens, 1); assert.equal(h.calls.releases, 0);
  assert.equal(h.ledger.events.length, 1); assert.equal(h.dirty, true);
  const saved = await new CanonicalLedgerStore({ lifecycle: h.lifecycle }).load();
  assert.equal(saved.events.length, 0); assert.equal(saved.activities.length, 4);
});

test('live status allowlist drops identifiers, strings outside its vocabulary and object coercion', () => {
  const result = blankLive({ 'fresh-base': ['passed'], 'mapping-coverage': 'passed', token: 'private' });
  assert.equal(result['fresh-base'], 'not-run'); assert.equal(result['mapping-coverage'], 'passed'); assert.equal(Object.hasOwn(result, 'token'), false);
});


test('historical statuses survive blocked preflight but never authorize reconnect; reset cannot resurrect them', async () => {
  let last;
  const runner = createLiveRunner({ recordedResults: { 'first-save-reopen': 'passed' }, withWorkbench: async () => { throw new Error('not-connected'); }, onUpdate: value => { last = value; } });
  assert.equal(runner.canVerifyReconnect(), false); assert.equal(await runner.verifyReconnect(), false);
  assert.equal(await runner.run(), false); assert.equal(last.state, 'blocked'); assert.equal(last.results['first-save-reopen'], 'passed');
  runner.forgetResults(); assert.equal(await runner.run(), false);
  assert.equal(last.results['first-save-reopen'], 'not-run'); assert.equal(runner.canVerifyReconnect(), false);
});

test('request metrics and throwing progress observers cannot alter operations or mark unrun checks passed', async () => {
  const { createDriveRequestMetrics } = await import('../js/drive-request-metrics.mjs');
  const requestMetrics = createDriveRequestMetrics();
  const fetch = requestMetrics.wrapFetch(async () => ({ status: 200 }));
  let parsed = 0;
  const runner = createLiveRunner({
    withWorkbench: operation => operation({ requestMetrics,
      async requireFresh() { await fetch('private-fresh'); },
      async identity() { await fetch('private-identity'); return { copyId: 'private-copy' }; }
    }),
    loadBytes: async () => { parsed++; throw new Error('private-fixture-failure'); },
    onUpdate: () => { throw new Error('private-observer-failure'); }
  });
  assert.equal(await runner.run(), false);
  assert.equal(parsed, 1, 'observer failures must not abort the admitted work');
  const metrics = runner.getMetrics();
  assert.equal(metrics.available, true); assert.equal(metrics.total.requests, 2);
  assert.equal(metrics.phases['fresh-base'].requests, 2);
  assert.equal(metrics.phases['mapping-coverage'].requests, 0);
  assert.equal(metrics.phases['first-save-reopen'], null);
  assert.doesNotMatch(JSON.stringify(metrics), /private-/);
  runner.forgetResults(); assert.equal(runner.getMetrics().available, false);
  assert.equal(requestMetrics.snapshot().requests, 2, 'reset only forgets reporting windows, not storage state');
});


test('interruption verifier accepts the prior exact v5 graph and saves one retry only', async () => {
  const h = await harness();
  const prepared = await prepareInterruption(h.withWorkbench, loadBytes);
  h.setup.adapter.stopAfter = h.setup.adapter.mutations + 1;
  await assert.rejects(h.driver.save(prepared.ledger));
  h.setup.adapter.reboot();
  await h.setup.engine.recover({ manifestFileId: h.setup.manifestFileId });
  await h.driver.reopen();
  assert.equal(h.ledger.events.length, 0);
  const saves = h.calls.saves;
  assert.equal(await verifyInterruption(h.withWorkbench, loadBytes), 'baseline-retried');
  assert.equal(h.calls.saves, saves + 1);
  assert.deepEqual(h.ledger, prepared.ledger);
  assert.equal(await verifyInterruption(h.withWorkbench, loadBytes), 'saved-classification-verified');
  assert.equal(h.calls.saves, saves + 1, 'a repeated verification does not repeat the classification save');
});

test('interruption verifier accepts the entire committed recipe without adding another event', async () => {
  const h = await harness(), prepared = await prepareInterruption(h.withWorkbench, loadBytes);
  await h.driver.save(prepared.ledger);
  const saves = h.calls.saves, mutations = h.setup.adapter.mutations;
  assert.equal(await verifyInterruption(h.withWorkbench, loadBytes), 'saved-classification-verified');
  assert.equal(h.calls.saves, saves); assert.equal(h.setup.adapter.mutations, mutations);
  assert.deepEqual(h.ledger, prepared.ledger);
});

for (const modification of ['account', 'amount', 'coverage', 'extra-event', 'old-recipe', 'extra-field']) test(`interruption verifier refuses ${modification} before staging or saving`, async () => {
  const h = await harness(), prepared = await prepareInterruption(h.withWorkbench, loadBytes);
  await h.driver.reopen();
  const recovered = structuredClone(h.ledger);
  if (modification === 'account') recovered.accounts[0].displayName = 'Invented modified account';
  if (modification === 'amount') recovered.activities[0].amountMinor = -9000;
  if (modification === 'coverage') recovered.imports[0].declaredCoverage.end = '2026-02-01';
  if (modification === 'extra-event') recovered.events = [...prepared.ledger.events, { ...prepared.ledger.events[0], eventId: crypto.randomUUID() }];
  if (modification === 'old-recipe') recovered.accounts[0].displayName = 'Invented interruption checking';
  if (modification === 'extra-field') recovered.imports[0].unexpected = true;
  const saves = h.calls.saves, mutations = h.setup.adapter.mutations;
  h.driver.reopen = async () => structuredClone(recovered);
  h.driver.stage = () => assert.fail('must not stage a modified or old recipe');
  await assert.rejects(verifyInterruption(h.withWorkbench, loadBytes), /interruption-recipe-unrecognized/);
  assert.equal(h.calls.saves, saves); assert.equal(h.setup.adapter.mutations, mutations);
});

test('interruption verification never retries a failed save and refuses dirty or overlapping leases', async () => {
  const h = await harness(); await prepareInterruption(h.withWorkbench, loadBytes);
  await assert.rejects(verifyInterruption(h.withWorkbench, loadBytes));
  await h.driver.reopen();
  const saves = h.calls.saves;
  h.setup.adapter.stopAfter = h.setup.adapter.mutations + 1;
  await assert.rejects(verifyInterruption(h.withWorkbench, loadBytes));
  assert.equal(h.calls.saves, saves + 1);
  await assert.rejects(verifyInterruption(h.withWorkbench, loadBytes));
  assert.equal(h.calls.saves, saves + 1);
});

test('interruption phase observers cannot change save results or expose graph values', async () => {
  let saved, staged, saves = 0;
  const phases = [];
  const driver = { async requireFresh() {}, async identity() { return { copyId: 'private-copy' }; }, stage(value) { staged = value; }, async save(value) { saves++; return saved = structuredClone(value); }, async reopen() { return structuredClone(saved); } };
  const withWorkbench = operation => operation(driver);
  const onPhase = phase => { phases.push(phase); throw new Error('private-observer-error'); };
  const receipt = await prepareInterruption(withWorkbench, loadBytes, onPhase);
  assert.equal(saves, 1); assert.equal(staged.events.length, 1);
  assert.equal(await verifyInterruption(withWorkbench, loadBytes, onPhase), 'baseline-retried');
  assert.equal(saves, 2); assert.deepEqual(saved, receipt.ledger);
  assert.deepEqual(phases, ['fresh-check', 'fixture', 'baseline-save', 'baseline-reopen', 'stage', 'recovered-reopen', 'recipe-compare', 'retry-save', 'retry-reopen', 'graph-totals']);
  assert.doesNotMatch(JSON.stringify(phases), /private|[0-9a-f]{8}-[0-9a-f]{4}/);
});
