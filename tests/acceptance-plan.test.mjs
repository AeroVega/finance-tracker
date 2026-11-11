import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { PLAN_VERSION, PHASES, STATUSES, BROWSERS, validSource, safeStatuses, cleanState, restoreState, prerequisitesMet, createReport, recordObservation } from '../prototype/acceptance-plan.mjs';
const sha = 'a'.repeat(40);
test('source requires a full stamp; confirmation must be explicit boolean', () => {
  for (const value of ['abcdef0', 'development (not deployed)', 'A'.repeat(40), `${sha}?secret`, null]) assert.equal(validSource(value), false);
  assert.equal(validSource(sha), true);
  assert.equal(cleanState({ sourceConfirmed: 'yes' }, sha).sourceConfirmed, false);
  assert.equal(JSON.parse(createReport({ sourceConfirmed: true }, 'short')).sourceCommit, 'unverified');
});
test('statuses and report exclude arbitrary keys, text, identifiers and nested payloads', () => {
  const input = { sourceConfirmed: true, browser: 'secret browser', tokens: 'SECRET', source: 'SECRET', manual: { device: 'pass', oauth: 'SECRET', 'year-v2': { token: 'SECRET' }, account: 'SECRET' }, logs: ['SECRET'] };
  const state = cleanState(input, sha);
  assert.deepEqual(Object.keys(state.manual), PHASES.map(p => p.id));
  assert.equal(state.manual.device, 'pass'); assert.equal(state.manual.oauth, 'not-run');
  const report = createReport(input, sha);
  assert.equal(report.includes('SECRET'), false);
  const parsed = JSON.parse(report);
  assert.equal(parsed.browser, 'Not recorded');
  assert.deepEqual(Object.keys(parsed), ['plan', 'sourceCommit', 'browser', 'provenance', 'manual', 'scope']);
  assert.match(parsed.provenance, /Manual tester observations only/);
  assert.equal('automated' in parsed, false);
  for (const status of STATUSES) assert.equal(safeStatuses({ device: status }).device, status);
});
test('session continuity is restricted to the same identified source and plan', () => {
  const saved = cleanState({ sourceConfirmed: true, browser: BROWSERS[1], manual: { device: 'pass' } }, sha);
  assert.equal(restoreState(saved, sha).manual.device, 'pass');
  for (const [input, current] of [[saved, 'b'.repeat(40)], [saved, 'development'], [{ ...saved, plan: 'old' }, sha], [null, sha]]) {
    const restored = restoreState(input, current);
    assert.equal(restored.sourceConfirmed, false);
    assert.ok(Object.values(restored.manual).every(status => status === 'not-run'));
  }
  assert.equal(restoreState({ ...saved, unexpected: 'SECRET' }, sha).unexpected, undefined);
  assert.ok(Object.values(cleanState({}, sha).manual).every(status => status === 'not-run'));
});
test('phase order has valid earlier prerequisites and no automatic pass', () => {
  const state = cleanState({ sourceConfirmed: true, browser: BROWSERS[1] }, sha);
  for (const [index, phase] of PHASES.entries()) {
    assert.ok(phase.requires.every(id => PHASES.slice(0, index).some(p => p.id === id)));
    assert.equal(prerequisitesMet(phase.id, state), true);
    assert.equal(state.manual[phase.id], 'not-run');
    state.manual[phase.id] = 'pass';
  }
  assert.equal(prerequisitesMet('unknown', state), false);
  assert.equal(prerequisitesMet('device', { ...state, sourceConfirmed: false }), false);
  assert.equal(prerequisitesMet('device', { ...state, browser: BROWSERS[0] }), false);
  assert.equal(prerequisitesMet('copies', { ...state, manual: {} }), false);
});
test('all tool links resolve to existing local files', async () => {
  for (const phase of PHASES) {
    assert.match(phase.href, /^[a-z0-9-]+\.html(?:\?guide=(?:pr28|v4))?$/);
    await access(new URL(`../prototype/${phase.href.split('?')[0]}`, import.meta.url));
  }
});
test('center has no Drive imports, external scripts, embedded engines or free-text input', async () => {
  const html = await readFile(new URL('../prototype/acceptance.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../prototype/acceptance.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /iframe|src="https:|type="file"|type="text"/);
  assert.match(html, /textarea[^>]+readonly/);
  assert.doesNotMatch(script, /fetch\(|localStorage|google\.|access_token/);
  assert.match(script, /sessionStorage/);
  assert.match(html, /limited app access cannot prove it/);
  const plan = JSON.stringify(PHASES);
  for (const phrase of ['new empty', 'never take over a live session', 'not a large-device capacity claim', 'saved file', 'separate physical copy locators', 'Do not press Upload', 'Production remains NO-GO']) assert.ok((plan + html).includes(phrase), phrase);
  assert.equal(PLAN_VERSION, 'owner-acceptance-v3-paged5');
});

test('blocked independent checks do not erase other observations; source-dependent checks reset', () => {
  const state = cleanState({ sourceConfirmed: true, browser: BROWSERS[1], manual: Object.fromEntries(PHASES.map(p => [p.id, 'pass'])) }, sha);
  const cancelled = recordObservation(state, 'oauth', 'blocked');
  assert.equal(cancelled.manual.oauth, 'blocked');
  for (const phase of PHASES.filter(p => p.id !== 'oauth')) assert.equal(cancelled.manual[phase.id], 'pass');
  const changedSource = recordObservation(cancelled, 'year-v5', 'fail');
  assert.equal(changedSource.manual.copies, 'not-run');
  assert.equal(changedSource.manual.interruption, 'pass');
  assert.equal(changedSource.manual.handoff, 'pass');
  assert.equal(recordObservation(changedSource, 'copies', 'pass').manual.copies, 'not-run');
  assert.equal(recordObservation(changedSource, 'unknown', 'pass').manual.unknown, undefined);
});
test('handoff uses deterministic year verification rather than the import runner same-tab verifier', () => {
  const handoff = PHASES.find(p => p.id === 'handoff');
  assert.equal(handoff.href, 'synthetic-year.html');
  assert.match(handoff.folder, /completed YEAR/);
  assert.match(handoff.steps.join(' '), /same-tab comparison/);
  assert.match(PHASES.find(p => p.id === 'import').steps.join(' '), /same tab/);
});

test('calendar checks require a preview connection; idle offline testing never requests a new upload', () => {
  const device = PHASES.find(p => p.id === 'device');
  assert.match(device.folder, /DEVICE/);
  assert.match(device.steps.join(' '), /preview the foundation fixture/);
  assert.match(device.steps.join(' '), /Do not stage or save/);
  const offline = PHASES.find(p => p.id === 'offline');
  assert.equal(offline.href, 'synthetic-year.html');
  assert.match(offline.folder, /completed/);
  assert.match(offline.steps.join(' '), /do not start a save, recovery or release while offline/);
  assert.match(offline.steps.join(' '), /mark Blocked/);
});

test('new-format live copy acceptance uses the completed canonical v5 year', () => {
  const copies = PHASES.find(p => p.id === 'copies');
  assert.deepEqual(copies.requires, ['year-v5']);
  assert.match(copies.folder, /YEAR-V5/);
  assert.match(copies.expected, /canonical v5 year/);
});

test('paged manual plan resets old passes and gives explicit migration controls',()=>{
 const restored=restoreState({plan:'owner-acceptance-v2-paged4',source:sha,sourceConfirmed:true,browser:BROWSERS[1],manual:{copies:'pass','year-v4':'pass'}},sha);
 assert.equal(restored.manual.copies,'not-run');assert.equal(restored.sourceConfirmed,false);
 assert.ok(!PHASES.some(p=>['year-v2','year-v3','year-v4'].includes(p.id)));
 const migration=PHASES.find(p=>p.id==='migration');assert.equal(migration.href,'pr25-acceptance.html?guide=v4');
 assert.match(migration.steps.join(' '),/explicitly choose Migrate/);
 assert.match(PHASES.find(p=>p.id==='copies').steps.join(' '),/without reconnecting the source/);
});
