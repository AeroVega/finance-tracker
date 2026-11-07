import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveRequestMetrics, safeRequestMetrics, combineRequestMetrics, REQUEST_METRIC_FIELDS } from '../js/drive-request-metrics.mjs';
import { ApplicationStorageLifecycle } from '../js/application-storage-lifecycle.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('metrics count concurrent attempts, fixed methods, HTTP classes and rejected fetches without reading bodies', async () => {
  let time = 10;
  const metrics = createDriveRequestMetrics({ now: () => time });
  const a = deferred(), b = deferred(), pending = [a, b];
  const fetch = metrics.wrapFetch(() => pending.shift().promise);
  const window = metrics.openWindow();
  const first = fetch('https://private.invalid/file/secret?token=secret', { method: 'GET', headers: { Authorization: 'secret' }, body: 'secret' });
  time = 15; const second = fetch('secret', { method: 'PATCH' });
  assert.equal(metrics.snapshot().inFlight, 2); assert.equal(metrics.snapshot().peakConcurrency, 2);
  const response = new Response('secret response body', { status: 429 });
  time = 30; b.resolve(response);
  assert.equal(await second, response); assert.equal(response.bodyUsed, false);
  time = 40; const original = new Error('secret provider body'); a.reject(original);
  await assert.rejects(first, error => error === original);
  const value = window.close();
  assert.deepEqual(value, { requests: 2, completed: 2, inFlight: 0, peakConcurrency: 2, elapsedMs: 30, requestMs: 45, maxRequestMs: 30,
    http2xx: 0, http3xx: 0, http4xx: 1, http5xx: 0, httpOther: 0, networkErrors: 1, get: 1, post: 0, patch: 1, delete: 0, otherMethod: 0 });
  assert.deepEqual(Object.keys(value), REQUEST_METRIC_FIELDS);
  assert.doesNotMatch(JSON.stringify(value), /secret|token|file|headers|body|private|invalid/);
  assert.equal(await response.text(), 'secret response body');
  time = 100; assert.equal(window.snapshot().elapsedMs, 30);
});

test('closed windows keep pending completions separate from new capture windows', async () => {
  let time = 0;
  const metrics = createDriveRequestMetrics({ now: () => time });
  const gate = deferred();
  const fetch = metrics.wrapFetch(() => gate.promise);
  const old = metrics.openWindow(), first = fetch('not-retained');
  time = 5; old.close();
  const fresh = metrics.openWindow();
  time = 10; gate.resolve({ status: 200 }); await first;
  assert.equal(old.snapshot().requests, 1); assert.equal(old.snapshot().completed, 1); assert.equal(old.snapshot().inFlight, 0);
  assert.equal(old.snapshot().elapsedMs, 5);
  assert.equal(fresh.snapshot().requests, 0); assert.equal(fresh.snapshot().completed, 0); assert.equal(fresh.snapshot().inFlight, 0);
  await fetch('not-retained'); fresh.close();
  assert.equal(fresh.snapshot().requests, 1); assert.equal(metrics.snapshot().requests, 2);
  assert.equal(combineRequestMetrics([old.snapshot(), fresh.snapshot()]).requests, 2);
});

test('throwing observers, clock failures and unusual responses preserve original return and error identity', async () => {
  const metrics = createDriveRequestMetrics({ now: () => { throw new Error('private clock failure'); } });
  metrics.subscribe(() => { throw new Error('private observer failure'); });
  const response = { get status() { throw new Error('private getter'); }, body: 'do not consume' };
  assert.equal(await metrics.wrapFetch(async () => response)('private'), response);
  const original = new Error('private synchronous failure');
  assert.throws(() => metrics.wrapFetch(() => { throw original; })('private'), error => error === original);
  assert.equal(metrics.snapshot().requests, 2); assert.equal(metrics.snapshot().httpOther, 1); assert.equal(metrics.snapshot().networkErrors, 1);
  assert.equal(metrics.snapshot().inFlight, 0); assert.equal(metrics.snapshot().requestMs, 0);
  assert.doesNotMatch(JSON.stringify(metrics.snapshot()), /private|consume/);
});

test('method and status vocabularies retain only coarse aggregate scalars', async () => {
  const metrics = createDriveRequestMetrics();
  for (const [method, status] of [['GET', 200], ['POST', 302], ['PATCH', 403], ['DELETE', 503], ['secret method', 0]]) {
    const result = { status };
    assert.equal(await metrics.wrapFetch(async () => result)('private', { method }), result);
  }
  const value = metrics.snapshot();
  for (const field of ['get', 'post', 'patch', 'delete', 'otherMethod', 'http2xx', 'http3xx', 'http4xx', 'http5xx', 'httpOther']) assert.equal(value[field], 1);
  assert.equal(value.requests, 5); assert.equal(value.completed, 5);
});

test('sanitization rejects non-scalars, impossible counts and extra private fields without coercion', () => {
  const base = createDriveRequestMetrics({ now: () => 0 }).snapshot();
  const poisoned = { ...base, fileId: 'secret', url: 'secret', rawError: 'secret' };
  assert.deepEqual(safeRequestMetrics(poisoned), base);
  for (const value of ['1', NaN, Infinity, -1, [], { toString() { throw new Error('must not coerce'); } }]) assert.equal(safeRequestMetrics({ ...base, requests: value }), null);
  assert.equal(safeRequestMetrics({ ...base, completed: 1 }), null);
  assert.equal(safeRequestMetrics({ get requests() { throw new Error('secret'); } }), null);
  assert.equal(combineRequestMetrics([]), null);
});

test('lifecycle sends session and transaction adapter fetch attempts through one shared counter', async () => {
  const fetches = [], received = [];
  const lifecycle = new ApplicationStorageLifecycle({ syntheticOnly: true, folderName: 'invented synthetic folder', folderId: 'invented-folder', manifestFileId: 'invented-manifest',
    accessToken: () => 'invented-token', makeManifest: () => ({}),
    fetchImpl: async (...args) => { fetches.push(args); return new Response(JSON.stringify(args[0].includes('/invented-file?') ? { id: 'invented-file', parents: ['invented-folder'], trashed: false } : { files: [], incompleteSearch: false }), { status: 200 }); },
    factories: { createEngine: () => ({}), createCoordinator: () => ({}) }
  });
  lifecycle.createComponents();
  await lifecycle.sessionAdapter.read();
  await lifecycle.transactionAdapter.readMetadata('invented-file');
  assert.equal(fetches.length, 2); assert.equal(lifecycle.requestMetrics.snapshot().requests, 2);
  assert.equal(lifecycle.requestMetrics.snapshot().get, 2);
  const window = lifecycle.requestMetrics.openWindow();
  const unsubscribe = lifecycle.requestMetrics.subscribe(() => received.push(lifecycle.requestMetrics.snapshot()));
  await lifecycle.sessionAdapter.read(); unsubscribe();
  assert.equal(window.close().requests, 1); assert.equal(lifecycle.requestMetrics.snapshot().requests, 3);
  assert.equal(received.length, 2); assert.doesNotMatch(JSON.stringify(received), /invented-(token|folder|file|manifest)/);
});
