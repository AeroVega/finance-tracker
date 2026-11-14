import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, registerAccount, summarizeLedger } from '../js/canonical-import.mjs';
import { createLiveRunner, LIVE_IDS } from '../prototype/pr28-live-checks.mjs';
import { HTTP_CATEGORIES } from './helpers/http-catalog-drive.mjs';
import { setupHttpCanonicalWorkbench as setup, loadCanonicalFixtureBytes as loadBytes } from './helpers/pr28-http-workbench.mjs';

// Measured at e55faec, using the same actual lifecycle, adapters and recipe.
// Bootstrap/connect, reconnect verification, OAuth, fixture downloads, periodic
// heartbeat, retry/backoff, pagination and browser CORS requests are excluded.
const BEFORE_REQUESTS = 4633; // Historical catalog measurement, not a v5 acceptance bound.
const BEFORE_SMALL_COMMITS = [201, 279, 357, 435, 513, 591, 669, 747, 825, 903];

function assertConcurrency(http, { requireParallel = false } = {}) {
  if (requireParallel) assert.ok(http.peakConcurrency > 1, 'independent immutable reads should overlap');
  assert.ok(http.peakConcurrency <= 8, 'immutable read concurrency must remain bounded');
  assert.ok(http.peakMutations <= 4, 'independent immutable writes remain bounded');
  assert.ok(http.requests.filter(row=>row.category==='update').every(row=>row.concurrentMutations===1), 'manifest publication must not overlap another mutation');
  assert.equal(http.active, 0, 'no background HTTP requests may outlive the operation');
}

test('actual v5 HTTP adapters complete the assisted recipe with inspectable request counts', async t => {
  const h = await setup();
  let last;
  const runner = createLiveRunner({ withWorkbench: h.withWorkbench, loadBytes, onUpdate: update => {
    last = update;
    if (update.current) h.http.phase = update.current;
  } });
  const before = h.http.requests.length;
  assert.equal(await runner.run(), true, JSON.stringify(last));
  const requests = h.http.requests.length - before;
  const counted = h.http.requests.slice(before);
  const categories = Object.fromEntries(HTTP_CATEGORIES.map(category => [category, counted.filter(row => row.category === category).length]));
  t.diagnostic(JSON.stringify({ before: BEFORE_REQUESTS, after: requests, categories,
    phases: Object.fromEntries(LIVE_IDS.slice(0, -1).map(phase => [phase, h.http.summary(phase).requests])),
    peakConcurrency: h.http.peakConcurrency, peakMutations: h.http.peakMutations }));
  assert.equal(Object.values(last.results).filter(value => value === 'passed').length, LIVE_IDS.length - 1);
  assert.equal(last.results['reconnect-same-copy'], 'not-run');
  assert.ok(requests <= 2300, `v5 recipe exceeded request budget: ${requests}`);
  for (const phase of ['mapping-coverage', 'foundation', 'classification', 'category-rule', 'review-retry',
    'review-reversal', 'review-decisions', 'missing-refund-date', 'refund-period', 'amount-correction',
    'future-category', 'refund-category', 'other-providers', 'currency-reversal']) {
    assert.equal(h.http.summary(phase).requests, 0, phase + ' must remain local-only');
  }
  assert.equal(Object.values(categories).reduce((sum, value) => sum + value, 0), requests);
  assert.ok(Object.values(categories).every(count => count > 0), 'exercise every production request category');
  assert.ok(counted.every(row => row.status === 200 || (row.status === 404 && row.category === 'metadata')), 'only expected exact-ID absence checks may return 404');
  assert.equal(last.metrics.available, true);
  assert.equal(last.metrics.total.requests, requests, 'live metrics must count session and transaction HTTP attempts');
  assert.equal(last.metrics.total.completed, requests); assert.equal(last.metrics.total.inFlight, 0);
  assert.equal(last.metrics.total.http2xx, counted.filter(row=>row.status===200).length); assert.equal(last.metrics.total.networkErrors, 0);
  assert.equal(last.metrics.total.post, categories.create); assert.equal(last.metrics.total.patch, categories.update);
  assert.equal(last.metrics.total.get, requests - categories.create - categories.update);
  for (const phase of LIVE_IDS.slice(0, -1)) assert.equal(last.metrics.phases[phase].requests, h.http.summary(phase).requests, phase + ' metrics disagree with raw HTTP');
  assert.equal(h.lifecycle.requestMetrics.snapshot().requests, h.http.requests.filter(row => row.phase !== 'bootstrap').length);
  assertConcurrency(h.http);
  assert.equal(h.calls.archives, 1); assert.equal(h.calls.releases, 1);
  assert.deepEqual(Object.fromEntries(['accounts', 'imports', 'observations', 'activities', 'events', 'reviewDecisions']
    .map(name => [name, h.ledger[name].length])),
  { accounts: 5, imports: 7, observations: 15, activities: 15, events: 15, reviewDecisions: 8 });
  const totals = summarizeLedger(h.ledger, { start: '2026-01-01', end: '2026-03-31', currency: 'USD' });
  assert.equal(totals.spending, '101.75'); assert.equal(totals.income, '2250.37'); assert.equal(totals.complete, false);
  const manifest = h.http.json(h.manifestFileId);
  assert.equal(manifest.revision, '3'); assert.equal(manifest.pending, null);
  assert.equal(manifest.version, 4);

  h.http.phase = 'reconnect'; await h.lifecycle.start(); await h.driver.reopen();
  assert.equal(await runner.verifyReconnect(), true, JSON.stringify(last));
  assert.ok(Object.values(last.results).every(value => value === 'passed'));
  const mutations = h.http.mutations;
  const passedResults = structuredClone(last.results), recordedMetrics = structuredClone(last.metrics);
  assert.equal(await runner.run(), false, 'populated copies must fail the unchanged fresh-base gates');
  assert.equal(last.state, 'blocked'); // A refused preflight preserves prior evidence.
  assert.deepEqual(last.results, passedResults); assert.deepEqual(last.metrics, recordedMetrics);
  assert.equal(h.http.mutations, mutations, 'refused repeat must not reset or overwrite the ledger');
  await h.lifecycle.release();
});

test('repeated v5 saves retain verifiable history and report request growth', async t => {
  const h = await setup();
  let ledger = createLedger();
  const counts = [];
  let firstIndexId;
  for (let i = 0; i < BEFORE_SMALL_COMMITS.length; i++) {
    h.http.phase = 'small-save-' + (i + 1);
    ledger = registerAccount(ledger, { institutionId: 'wells-fargo', displayName: 'Invented account ' + (i + 1), currency: 'USD', accountType: 'checking' });
    await h.driver.save(ledger);
    assert.deepEqual(await h.driver.reopen(), ledger);
    counts.push(h.http.summary(h.http.phase).requests);
    if (i === 0) {
      const manifest = h.http.json(h.manifestFileId);
      firstIndexId = [...h.http.files].find(([,file])=>file.metadata.appProperties?.financeTrackerHash===manifest.root)[0];
    }
  }
  t.diagnostic(JSON.stringify({ before: BEFORE_SMALL_COMMITS, after: counts }));
  // V5 retained-history verification still grows with history. This invented
  // fixture measures that cost without claiming bounded whole-database reads.
  assert.ok(counts.every(count=>count>0&&count<=450));
  for(let i=1;i<counts.length;i++)assert.ok(counts[i]-counts[i-1]<=25);
  assertConcurrency(h.http, { requireParallel: false });
  const mutations = h.http.mutations;
  h.http.files.get(firstIndexId).bytes[0] ^= 1;
  h.http.files.get(firstIndexId).metadata.version = "2"; // Drive versions change with every server-side mutation.
  await assert.rejects(h.store.load(), { code: 'hash-mismatch' });
  assert.equal(h.store.base, null); assert.equal(h.lifecycle.acceptingWrites, false);
  assert.equal(h.lifecycle.engine.recoveryRequired, true);
  assert.equal(h.http.mutations, mutations, 'corruption must pause reads without mutating evidence');
  assert.equal(h.http.active, 0, 'parallel reads must drain before reporting verification failure');
});

test('lost create response blocks more writes and exact-ID recovery retains a whole ledger', async () => {
  const h = await setup();
  const ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented recovery account', currency: 'USD', accountType: 'checking' });
  h.http.phase = 'interrupted-save';
  h.http.stopAfterMutation = h.http.mutations + 1;
  await assert.rejects(h.driver.save(ledger), { code: 'write-unresolved' });
  assert.equal(h.lifecycle.acceptingWrites, false); assert.equal(h.lifecycle.engine.recoveryRequired, true);
  assert.equal(h.http.json(h.manifestFileId).revision, '0');
  assert.ok(h.lifecycle.requestMetrics.snapshot().networkErrors > 0, 'lost responses must appear in request metrics');
  assert.equal(h.lifecycle.requestMetrics.snapshot().requests, h.http.requests.filter(row => row.phase !== 'bootstrap').length);
  const failedMutations = h.http.mutations;
  await assert.rejects(h.store.save(ledger));
  assert.equal(h.http.mutations, failedMutations, 'no write retry before recovery');
  h.http.reboot(); h.http.phase = 'recovery';
  await h.lifecycle.recover();
  assert.equal(h.lifecycle.state, 'ready');
  assert.equal(await h.driver.reopen(), null, 'unpublished interrupted save recovers the entire prior state');
  await h.driver.save(ledger);
  assert.deepEqual(await h.driver.reopen(), ledger);
  await h.driver.verifyPortable();
  assert.equal(h.http.json(h.manifestFileId).pending, null);
  assertConcurrency(h.http);
  await h.lifecycle.release();
});

test('fresh batch metadata follows every HTTP listing page and returns detached bindings', async () => {
  const h = await setup();
  const ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented paginated account', currency: 'USD', accountType: 'checking' });
  await h.driver.save(ledger);
  const ids = [...h.http.files.keys()];
  h.http.pageSize = 3;
  h.http.phase = 'paginated-metadata';
  const metadata = await h.lifecycle.transactionAdapter.readMetadataBatch(ids);
  assert.ok(metadata instanceof Map); assert.equal(metadata.size, ids.length);
  for (const id of ids) for (const field of ['id', 'name', 'mimeType', 'parents', 'appProperties', 'version', 'trashed']) {
    assert.deepEqual(metadata.get(id)[field], h.http.files.get(id).metadata[field], 'listing must request each verified metadata field');
  }
  assert.equal(h.http.summary(h.http.phase).categories.list, Math.ceil(h.http.files.size / 3));
  assert.equal(h.http.summary(h.http.phase).categories.metadata, 0);
  assert.equal(h.http.summary(h.http.phase).categories.media, 0);
  metadata.get(ids[0]).parents[0] = 'mutated-returned-value';
  const again = await h.lifecycle.transactionAdapter.readMetadataBatch(ids);
  assert.deepEqual(again.get(ids[0]).parents, [h.http.folderId], 'each call gets a new complete listing');
  h.http.phase = 'paginated-reopen';
  assert.deepEqual(await h.driver.reopen(), ledger, 'real lifecycle supports paginated metadata and session scans');
  assertConcurrency(h.http, { requireParallel: false });
  h.lifecycle.engine.invalidateHistory();
  assert.deepEqual(await h.driver.reopen(), ledger);
  assertConcurrency(h.http); // A cold read still overlaps up to four downloads.
  await h.lifecycle.release();
});

test('batch HTTP metadata rejects incomplete, duplicate, missing and invalid file bindings', async t => {
  const scenarios = {
    'incomplete search': h => { h.http.transformListingPage = page => ({ ...page, incompleteSearch: true }); },
    'malformed files': h => { h.http.transformListingPage = page => ({ ...page, files: {} }); },
    'repeated page token': h => { h.http.pageSize = 2; h.http.transformListingPage = page => ({ ...page, nextPageToken: 'invented-page-0' }); },
    'duplicate ID across pages': (h, id) => { h.http.pageSize = 2; h.http.transformListing = files => [...files, structuredClone(files.find(file => file.id === id))]; },
    'missing requested ID': (h, id) => { h.http.transformListing = files => files.filter(file => file.id !== id); },
    'wrong folder': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, parents: ['invented-other-folder'] } : file); },
    'invalid parents type': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, parents: h.http.folderId } : file); },
    'trashed retained file': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, trashed: true } : file); },
    'missing trash state': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, trashed: undefined } : file); },
    'missing version': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, version: undefined } : file); },
    'non-string version': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, version: 1 } : file); },
    'invalid version': (h, id) => { h.http.transformListing = files => files.map(file => file.id === id ? { ...file, version: 'unknown' } : file); }
  };
  for (const [name, configure] of Object.entries(scenarios)) await t.test(name, async () => {
    const h = await setup();
    const id = h.manifestFileId;
    configure(h, id);
    h.http.phase = 'invalid-batch';
    const mutations = h.http.mutations;
    await assert.rejects(h.lifecycle.transactionAdapter.readMetadataBatch([id]));
    assert.equal(h.http.summary(h.http.phase).categories.metadata, 0, 'bad enumeration must not silently fall back to exact-ID metadata');
    assert.equal(h.http.summary(h.http.phase).categories.media, 0, 'no object body may be admitted from a bad batch');
    assert.equal(h.http.mutations, mutations); assert.equal(h.http.active, 0);
  });
});
