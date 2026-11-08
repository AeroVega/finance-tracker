import test from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, resultTiming, createElapsedTimer } from '../prototype/pr28-testing-timing.mjs';

test('elapsed labels use readable whole units and keep missing time distinct from subsecond work', () => {
  for (const [value, label] of [[0, 'less than 1 second'], [999, 'less than 1 second'], [1000, '1 second'], [12000, '12 seconds'], [59999, '1 minute'], [61000, '1 minute 1 second'], [132000, '2 minutes 12 seconds'], [3600000, '1 hour'], [3661000, '1 hour 1 minute 1 second']]) assert.equal(formatElapsed(value), label);
  for (const value of [undefined, null, -1, NaN, Infinity, '12000', {}, [], 1.5]) assert.equal(formatElapsed(value), 'unmeasured');
});

test('timing never upgrades status or assigns measured times to historical or unrun checks', () => {
  assert.equal(resultTiming('passed', 12000), 'Passed in 12 seconds');
  assert.equal(resultTiming('failed', 12000), 'Failed after 12 seconds');
  assert.equal(resultTiming('not-run', 12000), 'Not run');
  assert.equal(resultTiming('not-run', 12000, { running: true }), 'Checking · 12 seconds elapsed');
  assert.equal(resultTiming('passed', null), 'Passed · time unmeasured');
  assert.equal(resultTiming('passed', 12000, { historical: true }), 'Passed earlier · time unmeasured');
  assert.equal(resultTiming('failed', 12000, { historical: true }), 'Failed earlier · time unmeasured');
  assert.equal(resultTiming('not-run', null, { historical: true }), 'Not run');
});

test('shared operations and repeated reconnect attempts have explicit non-independent timing labels', () => {
  assert.equal(resultTiming('passed', 12000, { shared: true }), 'Passed · shared run 12 seconds');
  assert.equal(resultTiming('passed', 12000, { cumulative: true }), 'Passed · total check time 12 seconds');
  assert.equal(resultTiming('not-run', 12000, { running: true, cumulative: true }), 'Checking · total 12 seconds elapsed');
});

test('fixture timer freezes on completion and reports clock failures as unmeasured', () => {
  let now = 100;
  const timer = createElapsedTimer(() => now);
  now = 12100;
  assert.equal(timer.elapsedMs(), 12000);
  assert.equal(timer.stop(), 12000);
  now = 900000;
  assert.equal(timer.elapsedMs(), 12000); assert.equal(timer.stop(), 12000);
  for (const bad of [() => undefined, () => NaN, () => '100', () => { throw new Error('clock'); }]) assert.equal(createElapsedTimer(bad).stop(), null);
  now = 100; const backwards = createElapsedTimer(() => now); now = 50;
  assert.equal(backwards.stop(), null);
});
