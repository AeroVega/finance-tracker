import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as plan from '../prototype/pr28-testing-plan.mjs';
import * as liveChecks from '../prototype/pr28-live-checks.mjs';
import { runFixtureChecks } from '../prototype/pr28-testing-checks.mjs';
import { createDriveRequestMetrics } from '../js/drive-request-metrics.mjs';

const [html, script, workbench, controls, css, hub] = await Promise.all([
  'prototype/pr28-testing.html', 'prototype/pr28-testing.mjs', 'prototype/pr28-import.mjs', 'prototype/pr28-import.html', 'prototype/pr28-testing.css', 'prototype/index.html'
].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
const loadBytes = path => readFile(new URL('../prototype/' + path, import.meta.url));

test('guided fixture checks exercise exact recipe against real parser and financial APIs', async () => {
  const result = await runFixtureChecks(loadBytes);
  assert.deepEqual(Object.keys(result), plan.AUTOMATED_IDS);
  assert.equal(Object.values(result).every(status => status === 'passed'), true);
});
test('fixture failure emits only fixed check/status fields and leaves later checks not run', async () => {
  const result = await runFixtureChecks(async () => { throw new Error('invented-private-provider-body'); });
  assert.equal(result['fixture-foundation'], 'failed');
  assert.equal(Object.values(result).filter(status => status === 'not-run').length, plan.AUTOMATED_IDS.length - 1);
  assert.doesNotMatch(JSON.stringify(result), /private-provider/);
});
test('all manual tests start not-run and have unique fixed IDs and expected results', () => {
  assert.equal(new Set(plan.CHECKS.map(item => item.id)).size, plan.CHECKS.length);
  assert.equal(Object.values(plan.blankResults()).every(value => value === 'not-run'), true);
  for (const check of plan.CHECKS) {
    assert.ok(check.actions.length >= 2); assert.ok(check.expected.length > 30);
    assert.match(controls, new RegExp('id="' + check.target + '"'));
  }
});
test('report allowlist excludes private fields and coerced arrays or objects from every scalar field', () => {
  const poison = text => ({ toString: () => text, unexpectedPayload: 'invented-private-placeholder' });
  for (const status of [['passed'], poison('passed'), 1, true, null, 'not-a-status']) {
    const report = JSON.parse(plan.createSafeReport({ manual: { setup: status, folderId: 'invented-private-placeholder' }, automated: { 'fixture-foundation': status, token: 'invented-private-placeholder' }, browser: poison('Safari on iPad'), source: poison('a'.repeat(40)), sourceConfirmed: true, date: poison('2026-11-06'), accountId: 'invented-private-placeholder' }));
    assert.equal(report.manual.setup, 'not-run'); assert.equal(report.automated['fixture-foundation'], 'not-run');
    assert.equal(report.browser, 'Not recorded'); assert.equal(report.sourceCommit, 'unverified'); assert.equal(report.date, 'not-recorded');
    assert.doesNotMatch(JSON.stringify(report), /invented-private-placeholder|unexpectedPayload|folderId|accountId|token/);
    assert.equal(Object.values(report.manual).every(value => typeof value === 'string'), true);
  }
});
test('report only includes a full source SHA after explicit confirmation and a valid date', () => {
  const base = { manual: { setup: 'passed' }, automated: { 'fixture-foundation': 'passed' }, browser: 'Safari on iPad', source: 'a'.repeat(40), date: '2026-11-06' };
  assert.equal(JSON.parse(plan.createSafeReport(base)).sourceCommit, 'unverified');
  const good = JSON.parse(plan.createSafeReport({ ...base, sourceConfirmed: true }));
  assert.equal(good.sourceCommit, 'a'.repeat(40)); assert.equal(good.manual.setup, 'passed');
  assert.equal(good.date, '2026-11-06'); assert.match(good.manualProvenance, /Tester selections/);
  for (const source of ['development (not deployed)', 'branch-name', 'aaaaaaa', 'a'.repeat(40) + ' ']) assert.equal(plan.verifiedSource(source, true), 'unverified');
  assert.equal(JSON.parse(plan.createSafeReport({ ...base, date: '2026-02-30' })).date, 'not-recorded');
});
test('hub prominently links one shared-workbench testing page with generated source provenance', () => {
  assert.ok(hub.indexOf('./pr28-testing.html') < hub.indexOf('./pr28-import.html'));
  assert.match(html, /id="build-sha"/); assert.match(html, /src="\.\.\/js\/build-info\.js"/);
  assert.doesNotMatch(html, /<iframe|type="file"/);
  assert.match(script, /querySelectorAll\('main > section'\)/);
  assert.equal((script.match(/import\('\.\/pr28-import\.mjs'\)/g) || []).length, 1);
  assert.match(workbench, /document\.getElementById\('workbench'\) \|\| document/);
  assert.doesNotMatch(script, /new DashboardSyntheticStorage|new CanonicalLedgerStore|innerHTML|localStorage|console\./);
});
test('canonical pause is optional, explicit, uses existing save and stops after first mutation', () => {
  assert.match(workbench, /if \(\$\('pause-canonical'\)\) action\('pause-canonical'/);
  assert.match(workbench, /if \(!confirm\('Pause a canonical save/);
  assert.match(workbench, /afterMutation: async \(\) => \{\s*if \(!pauseAfterFirstWrite\) return;\s*pauseAfterFirstWrite = false;/);
  assert.match(workbench, /await new Promise\(\(\) => \{\}\)/);
  assert.match(workbench, /finally \{ pauseAfterFirstWrite = false; \}/);
  assert.doesNotMatch(controls, /id="pause-canonical"/);
  assert.match(script, /pause\.id = 'pause-canonical'/);
  assert.match(plan.CHECKS.find(item => item.id === 'recovery').actions.join(' '), /Copy the safe report before closing/);
});
test('guidance distinguishes live coverage, missing refund evidence, prior checkpoints and independent tools', () => {
  assert.match(plan.MANUAL_RECIPE.find(item => item.id === 'refund-missing-date').actions.join(' '), /Do not save this probe/);
  assert.match(plan.MANUAL_RECIPE.find(item => item.id === 'refund-date').expected, /70\.00/);
  assert.match(plan.MANUAL_RECIPE.find(item => item.id === 'future-rule').expected, /66\.00/);
  assert.match(plan.CHECKS.find(item => item.id === 'recovery').actions.join(' '), /one canonical boundary/);
  assert.match(plan.CHECKS.find(item => item.id === 'backup-restore').actions.join(' '), /release/);
  assert.match(html, /Every manual check starts Not run/);
  assert.match(css, /min-height:44px/); assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/);
});

function controller({ stamp = 'a'.repeat(40), saved = null, unavailableStorage = false, clipboardFails = false, workbenchModule = null } = {}) {
  const nodes = new Map(), stored = new Map(), copied = [], calls = { imports: 0, fetches: 0, checks: 0 };
  if (saved) stored.set('finance-tracker-' + plan.PLAN_VERSION, JSON.stringify(saved));
  function element(tag = '') {
    return { tag, textContent: '', value: '', checked: false, disabled: false, dataset: {}, children: [], attributes: {},
      append(...items) { this.children.push(...items); if (this.tag === 'select' && this.value === '' && items[0]) this.value = items[0].value; },
      replaceChildren(...items) { this.children = items; }, setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, handler) { this[name] = handler; }, focus() { this.focused = true; }, select() { this.selected = true; },
      setSelectionRange(start, end) { this.selection = [start, end]; }
    };
  }
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, element(['step-choice', 'step-status', 'test-browser'].includes(id) ? 'select' : ''));
    return nodes.get(id);
  }
  get('build-sha').textContent = stamp;
  const sections = Array.from({ length: 6 }, () => { const item = element('section'); return item; });
  get('workbench').querySelectorAll = () => sections;
  const context = { ...plan, ...liveChecks, URL, Date, JSON, Promise, Object, Number,
    document: { getElementById: get, createElement: element, importNode: item => item },
    DOMParser: class { parseFromString() { return { querySelectorAll: () => sections, getElementById: () => ({}) }; } },
    sessionStorage: { getItem(key) { if (unavailableStorage) throw new Error('unavailable'); return stored.get(key) || null; }, setItem(key, value) { if (unavailableStorage) throw new Error('unavailable'); stored.set(key, value); } },
    navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw new Error('denied'); copied.push(value); } } },
    confirm: () => true,
    fetch: async () => { calls.fetches++; return { ok: true, text: async () => controls }; },
    mountModule: async () => { calls.imports++; return workbenchModule || { withAcceptanceWorkbench: async () => { throw new Error('not-connected'); }, subscribeAcceptanceStatus: listener => listener({ ready: false, busy: false }) }; },
    createLiveRunner: options => liveChecks.createLiveRunner({ ...options, loadBytes }),
    runFixtureChecks: async () => { calls.checks++; return Object.fromEntries(plan.AUTOMATED_IDS.map(id => [id, 'passed'])); }
  };
  const source = script.replace(/^import .*;$/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('../prototype/pr28-testing.mjs', import.meta.url).href)).replace("import('./pr28-import.mjs')", 'mountModule()');
  vm.runInNewContext(source, context);
  return { get, stored, copied, calls, context };
}
const tick = () => new Promise(setImmediate);

test('actual guide handlers keep manual status separate from local checks and mount one workbench', async () => {
  const h = controller(); await tick();
  assert.equal(h.calls.fetches, 1); assert.equal(h.calls.imports, 1);
  assert.equal(h.get('step-status').value, 'not-run');
  h.get('step-status').value = 'passed'; h.get('step-status').change();
  await h.get('run-fixture-checks').click();
  const report = JSON.parse(h.get('safe-report').value);
  assert.equal(report.manual.setup, 'passed'); assert.equal(report.manual['device-usability'], 'not-run');
  assert.equal(Object.values(report.automated).every(status => status === 'passed'), true);
  h.get('next-step').click(); assert.equal(h.get('step-choice').value, '1'); assert.equal(h.get('step-status').value, 'not-run');
  await h.get('copy-report').click(); assert.equal(h.copied.length, 1); assert.equal(h.copied[0], h.get('safe-report').value);
});
test('clipboard failure exposes selected report for manual copy and never sends it', async () => {
  const h = controller({ clipboardFails: true }); await h.get('copy-report').click();
  assert.equal(h.copied.length, 0); assert.equal(h.get('safe-report').selected, true);
  assert.deepEqual(h.get('safe-report').selection, [0, h.get('safe-report').value.length]);
  assert.match(h.get('report-status').textContent, /use your device Copy command/);
});
test('reset clears only safe checklist state and does not remount or mutate storage workbench', async () => {
  const h = controller(); await tick();
  h.get('step-status').value = 'passed'; h.get('step-status').change(); await h.get('run-fixture-checks').click();
  h.get('reset-checklist').click();
  const report = JSON.parse(h.get('safe-report').value);
  assert.equal(Object.values(report.manual).every(status => status === 'not-run'), true);
  assert.equal(Object.values(report.automated).every(status => status === 'not-run'), true);
  assert.equal(h.calls.imports, 1); assert.equal(h.calls.fetches, 1);
  assert.match(h.get('report-status').textContent, /Saved data, staged changes and the session are unchanged/);
});
test('reload restores manual choices only for the same full source stamp, never unknown or changed source', () => {
  const saved = { version: plan.PLAN_VERSION, source: 'a'.repeat(40), manual: { setup: 'passed' }, selected: 1, browser: 'Safari on iPhone', sourceConfirmed: true, date: '2026-11-06' };
  const same = controller({ saved }); assert.equal(JSON.parse(same.get('safe-report').value).manual.setup, 'passed');
  assert.equal(same.get('step-choice').value, '1');
  for (const stamp of ['b'.repeat(40), 'development (not deployed)']) {
    const h = controller({ stamp, saved }); assert.equal(JSON.parse(h.get('safe-report').value).manual.setup, 'not-run');
  }
  const unknown = controller({ stamp: 'development (not deployed)', saved: { ...saved, source: 'unverified' } });
  assert.equal(JSON.parse(unknown.get('safe-report').value).manual.setup, 'not-run'); assert.equal(unknown.get('source-confirmed').disabled, true);
  assert.match(unknown.get('checklist-storage').textContent, /will not restore after reload/);
});
test('session storage refusal still permits checklist use and safe report copying', async () => {
  const h = controller({ unavailableStorage: true });
  h.get('step-status').value = 'blocked'; h.get('step-status').change(); await h.get('copy-report').click();
  assert.equal(JSON.parse(h.copied[0]).manual.setup, 'blocked');
  assert.match(h.get('checklist-storage').textContent, /unavailable/);
});


test('restored live evidence is explicitly historical, source-scoped, and never resumes checks', async () => {
  const saved = { version: plan.PLAN_VERSION, source: 'a'.repeat(40), live: { 'fresh-base': 'passed', 'first-save-reopen': 'passed' }, liveState: 'running' };
  const h = controller({ saved }); await tick();
  const report = JSON.parse(h.get('safe-report').value);
  assert.equal(report.liveEvidence, 'historical'); assert.equal(report.live['first-save-reopen'], 'passed');
  assert.equal(report.requestMetrics.available, false);
  assert.match(h.get('live-result').textContent, /No live checks ran after reload/);
  assert.equal(h.get('verify-live-reconnect').disabled, true);
  assert.equal(h.calls.checks, 0);
  const different = controller({ stamp: 'b'.repeat(40), saved });
  assert.equal(JSON.parse(different.get('safe-report').value).live['first-save-reopen'], 'not-run');
});

test('safe report live status allowlist does not serialize caller objects or identifiers', () => {
  const text = plan.createSafeReport({ live: { 'fresh-base': 'passed', 'first-save-reopen': { private: 'never-copy-me' }, folderId: 'never-copy-me' }, liveState: { private: 'never-copy-me' } });
  const report = JSON.parse(text); assert.equal(report.live['fresh-base'], 'passed'); assert.equal(report.live['first-save-reopen'], 'not-run');
  assert.equal(report.liveEvidence, 'not-run'); assert.doesNotMatch(text, /never-copy-me|folderId/);
});

test('default human checklist contains no duplicated deterministic import recipe', () => {
  assert.deepEqual(plan.CHECKS.map(check => check.id), ['setup', 'device-usability', 'recovery', 'backup-restore']);
  assert.match(html, /id="run-live-checks" disabled/); assert.match(html, /id="stop-live-checks" disabled/);
  assert.match(html, /id="prepare-interruption" disabled/);
  assert.match(script, /await liveRunner.run\(\)/); assert.match(script, /await liveRunner.verifyReconnect\(\)/);
  assert.match(workbench, /store.base\?\.revision !== 0/); assert.match(workbench, /Object.keys\(store.base\?\.snapshot/);
});

test('safe report serializes only fixed metric fields and phases, never caller payloads or coerced values', async () => {
  const collector = createDriveRequestMetrics({ now: () => 0 });
  await collector.wrapFetch(async () => ({ status: 503 }))('secret-url', { method: 'POST', body: 'secret-data' });
  const value = { ...collector.snapshot(), token: 'secret-token', fileId: 'secret-id', url: 'secret-url', error: 'secret-error' };
  const report = JSON.parse(plan.createSafeReport({ metrics: { available: true, total: value, phases: { 'first-save-reopen': value, 'secret-stage': value } } }));
  assert.equal(report.requestMetrics.total.requests, 1);
  assert.equal(report.requestMetrics.phases['first-save-reopen'].http5xx, 1);
  assert.equal(report.live['first-save-reopen'], 'not-run');
  assert.deepEqual(Object.keys(report.requestMetrics.phases), liveChecks.LIVE_IDS);
  assert.doesNotMatch(JSON.stringify(report), /secret|fileId|"token"|"url"|"error"/);
  for (const poisoned of [NaN, Infinity, '1', { toString: () => '1' }, ['1']]) {
    const bad = JSON.parse(plan.createSafeReport({ metrics: { available: true, total: { ...value, requests: poisoned }, phases: {} } }));
    assert.equal(bad.requestMetrics.available, false); assert.equal(bad.requestMetrics.total, null);
  }
});

test('actual guide handlers display measured totals and phases, copy aggregates, and never persist metrics', async () => {
  const collector = createDriveRequestMetrics();
  const measuredFetch = collector.wrapFetch(async () => ({ status: 200 }));
  let savedLedger, releases = 0;
  const driver = { requestMetrics: collector,
    async requireFresh() { await measuredFetch('private-folder'); },
    async identity() { await measuredFetch('private-identity'); return { copyId: 'private-copy' }; },
    stage() {},
    async save(value) { await measuredFetch('private-save', { method: 'POST' }); if (savedLedger && value.accounts[0].displayName === 'Invented forbidden rewrite') throw Object.assign(new Error('private-detail'), { code: 'history-rewrite-refused' }); savedLedger = structuredClone(value); return structuredClone(value); },
    async reopen() { await measuredFetch('private-reopen'); return structuredClone(savedLedger); },
    async verifyPortable() { await measuredFetch('private-export'); },
    async revalidate() { await measuredFetch('private-session'); },
    async release() { releases++; await measuredFetch('private-release', { method: 'PATCH' }); }
  };
  const h = controller({ workbenchModule: { withAcceptanceWorkbench: operation => operation(driver), subscribeAcceptanceStatus: listener => listener({ ready: true, busy: false }) } });
  await tick(); await h.get('run-live-checks').click();
  assert.equal(releases, 1);
  let report = JSON.parse(h.get('safe-report').value);
  assert.equal(Object.values(report.live).filter(value => value === 'passed').length, 24);
  assert.equal(report.requestMetrics.available, true);
  assert.equal(report.requestMetrics.total.requests, collector.snapshot().requests);
  assert.equal(report.requestMetrics.phases['first-save-reopen'].requests, 2);
  assert.match(h.get('request-totals').textContent, /requests.*completed.*in flight.*peak.*elapsed.*HTTP/);
  assert.match(h.get('live-results').children[liveChecks.LIVE_IDS.indexOf('first-save-reopen')].textContent, /2 requests/);
  assert.doesNotMatch([...h.stored.values()].join(''), /requestMetrics|requestMs|peakConcurrency|private-/);
  await h.get('copy-report').click(); assert.doesNotMatch(h.copied[0], /private-/);
  await h.get('verify-live-reconnect').click();
  report = JSON.parse(h.get('safe-report').value);
  assert.equal(report.live['reconnect-same-copy'], 'passed');
  assert.equal(report.requestMetrics.phases['reconnect-same-copy'].requests, 2);
  assert.equal(report.requestMetrics.total.requests, collector.snapshot().requests);
  h.get('reset-checklist').click();
  assert.equal(JSON.parse(h.get('safe-report').value).requestMetrics.available, false);
  assert.equal(releases, 1); assert.ok(savedLedger);
  assert.match(h.get('request-totals').textContent, /unavailable/);
});
