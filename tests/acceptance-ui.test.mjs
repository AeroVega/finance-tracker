import test from 'node:test';
import assert from 'node:assert/strict';
import * as plan from '../prototype/acceptance-plan.mjs';
import { pageController } from './helpers/page-controller.mjs';

const source = 'a'.repeat(40);
const report = h => JSON.parse(h.get('report').value);
const allNotRun = h => assert.ok(Object.values(report(h).manual).every(status => status === 'not-run'));
async function ready(options) {
  const h = await pageController('acceptance', plan, options);
  await h.choose('source-confirmed', true); await h.choose('browser', 'Safari on iPhone');
  return h;
}

test('actual checklist handlers reset observations on browser/source changes and require both before Pass', async () => {
  const h = await ready(); await h.choose('device-status', 'pass');
  assert.equal(report(h).manual.device, 'pass'); assert.equal(report(h).sourceCommit, source);
  await h.choose('browser', 'Safari on iPad'); allNotRun(h); assert.equal(report(h).browser, 'Safari on iPad');
  await h.choose('device-status', 'pass'); await h.choose('source-confirmed', false); allNotRun(h);
  assert.equal(report(h).sourceCommit, 'unverified');
  assert.equal(h.get('device-status').children.find(option => option.value === 'pass').disabled, true);
  await h.choose('source-confirmed', true); allNotRun(h);
  await h.choose('browser', 'Not recorded');
  assert.equal(h.get('device-status').children.find(option => option.value === 'pass').disabled, true);
});

test('reload keeps only same-source checklist choices and a changed deployed source resets them', async () => {
  const h = await ready(); await h.choose('device-status', 'pass'); await h.choose('oauth-status', 'blocked');
  const reloaded = await pageController('acceptance', plan, { session: h.session, source });
  assert.deepEqual(report(reloaded), report(h)); assert.equal(reloaded.get('source-confirmed').checked, true);
  const changed = await pageController('acceptance', plan, { session: h.session, source: 'b'.repeat(40) });
  allNotRun(changed); assert.equal(changed.get('source-confirmed').checked, false); assert.equal(report(changed).browser, 'Not recorded');
  const unstamped = await pageController('acceptance', plan, { session: h.session, source: 'development (not deployed)' });
  assert.equal(unstamped.get('source-confirmed').disabled, true); allNotRun(unstamped); assert.equal(h.session.size, 0);
});

test('changing a source observation clears only dependents; handlers preserve focus and fresh-run cancellation', async () => {
  const h = await ready(); await h.choose('device-status', 'pass'); await h.choose('year-v5-status', 'pass'); await h.choose('copies-status', 'pass');
  await h.choose('year-v5-status', 'fail');
  assert.equal(report(h).manual.copies, 'not-run'); assert.equal(report(h).manual.device, 'pass');
  assert.equal(h.observed.focused, h.get('year-v5-status'));
  const before = report(h); h.observed.confirm = false; await h.click('fresh'); assert.deepEqual(report(h), before);
  h.observed.confirm = true; await h.click('fresh'); allNotRun(h);
  assert.equal(h.get('source-confirmed').checked, false); assert.equal(h.get('browser').value, 'Not recorded');
});

test('clipboard rejection offers the actual safe report for manual copy, then a later copy succeeds', async () => {
  const h = await ready(); await h.choose('device-status', 'pass'); h.observed.clipboardFailure = true;
  await h.click('copy'); assert.equal(h.observed.copied.length, 0);
  assert.match(h.get('report-status').textContent, /Copy unavailable/);
  assert.equal(h.observed.focused, h.get('report')); assert.equal(h.observed.selected, h.get('report'));
  const expected = report(h);
  assert.deepEqual(Object.keys(expected), ['plan', 'sourceCommit', 'browser', 'provenance', 'manual', 'scope']);
  assert.match(expected.provenance, /Manual tester observations only/);
  h.observed.clipboardFailure = false; await h.click('copy');
  assert.equal(h.observed.copied.length, 1); assert.deepEqual(JSON.parse(h.observed.copied[0]), expected);
  assert.equal(h.get('report-status').textContent, 'Safe report copied.');
});

test('failed session storage is disclosed without losing the current report or inventing persistence', async () => {
  const h = await ready(); h.observed.storageFailure = true; await h.choose('device-status', 'pass');
  assert.match(h.get('continuity').textContent, /Session storage unavailable/); assert.equal(report(h).manual.device, 'pass');
  await h.click('copy'); assert.equal(JSON.parse(h.observed.copied[0]).manual.device, 'pass');
});
