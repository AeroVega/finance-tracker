// Wall-clock latency model for Drive save, open and stale-session open, run
// through the real workspace session, lifecycle and adapters. Invented data only.
// Each request waits a fixed latency, and its bytes cross one shared link, so
// concurrent transfers get no extra bandwidth. A file's version moves on its
// first media read after a write, as in the server-settling scenario profile.
// The timings are assumptions, not measured Google performance. Run:
//   node tests/benchmark-drive-latency.mjs [--history=N] [--profile=phone|slow|trace] [--dense] [--trace]
// --history is the number of saved revisions before the timed save (default 3).
// --dense uses the invented dense one-year ledger instead of the synthetic year.
// Each result line reports the process peak RSS so far.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {FullSnapshotApplication,inspectFullSnapshotFolder} from '../js/full-snapshot-application.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';

export const LATENCY_PROFILES = Object.freeze({
  // Assumed phone on home Wi-Fi.
  phone: {readMs: 180, writeMs: 700, upBytesPerSecond: 1_500_000, downBytesPerSecond: 6_000_000},
  // The slow profile of docs/DRIVE_SIMULATOR.md.
  slow: {readMs: 250, writeMs: 1300, upBytesPerSecond: 1_000_000, downBytesPerSecond: 5_000_000},
  // Near-zero latency, for request-order traces only.
  trace: {readMs: 2, writeMs: 4, upBytesPerSecond: 1e9, downBytesPerSecond: 1e9}
});

class LatencyDrive extends HttpFullSnapshotDrive {
  constructor({timing, settle = true, ...options}) {
    super(options);
    this.timing = timing;
    this.settle = settle;
    this.pendingSettlement = new Set();
    this.link = Promise.resolve();
  }
  async transfer(bytes, perSecond, signal) {
    if (!bytes) return;
    signal?.throwIfAborted();
    const turn = this.link.then(() => signal?.aborted ? undefined : delay(bytes / perSecond * 1000));
    this.link = turn;
    await turn;
    signal?.throwIfAborted();
  }
  async respond(target, options, category, id, row) {
    // Server-side version settling after a write, as in the scenario profiles.
    const file = this.files.get(id);
    if (this.settle && category === 'media' && this.pendingSettlement.delete(id))
      file.metadata.version = String(BigInt(file.metadata.version) + 1n);
    row.t0 = performance.now();
    const write = category === 'create' || category === 'update';
    // Like browser fetch, an aborted request rejects at once.
    const signal = options.signal;
    await this.transfer(row.requestBytes, this.timing.upBytesPerSecond, signal);
    await delay(write ? this.timing.writeMs : this.timing.readMs, undefined, {signal});
    const result = await super.respond(target, options, category, id, row);
    if (this.settle && write && result.ok) this.pendingSettlement.add(row.fileId);
    await this.transfer(Number(result.headers.get('Content-Length')) || 0, this.timing.downBytesPerSecond, signal);
    row.t1 = performance.now();
    return result;
  }
}

function setup(timing) {
  const http = new LatencyDrive({timing});
  const create = () => new FullSnapshotApplication({folderId: http.folderId, accessToken: () => 'invented-test-token',
    fetchImpl: http.fetch, cryptoImpl: webcrypto, setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}, lifecycleTarget: null, isOnline: () => true});
  // Mirrors DashboardSyntheticStorage.connect: read-only admission, start, and
  // stale recovery on explicit Open. Google sign-in and Picker are not modeled.
  const storage = {lifecycle: null,
    async connect({requireExisting = false} = {}) {
      const preflight = new GoogleDriveTransactionAdapter({folderId: http.folderId, accessToken: () => 'invented-test-token', fetchImpl: http.fetch});
      const {admission} = await inspectFullSnapshotFolder(preflight, {requireEmpty: !requireExisting, requireExisting});
      this.lifecycle = create();
      try { await this.lifecycle.start({initialize: !requireExisting, admission}); }
      catch (error) {
        if (!requireExisting || error?.code !== 'stale-session') throw error;
        await this.lifecycle.recoverStaleSession({confirm: true, admission});
      }
    },
    createLedgerStore() { return this.lifecycle.createLedgerStore(); },
    async release() { const result = await this.lifecycle.release(); this.lifecycle = null; return result; }};
  return {http, storage, session: new CanonicalWorkspaceSession({storage, online: () => true})};
}

// A crashed tab leaves an active marker whose heartbeat has aged out.
function ageMarker(http) {
  const marker = [...http.files.values()].find(file => file.metadata.appProperties?.financeTrackerSession === 'v1');
  const record = JSON.parse(new TextDecoder().decode(marker.bytes));
  assert.equal(record.state, 'active');
  const old = Date.now() - 10 * 60_000;
  Object.assign(record, {startedAt: old, heartbeatAt: old, expiresAt: old + 120_000});
  marker.bytes = new TextEncoder().encode(JSON.stringify(record));
  marker.metadata.version = String(BigInt(marker.metadata.version) + 1n);
  marker.metadata.size = String(marker.bytes.length);
}

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const history = Number(args.history ?? 3);
const profiles = args.profile ? [args.profile] : ['phone', 'slow'];
assert.ok(Number.isSafeInteger(history) && history >= 1 && profiles.every(name => Object.hasOwn(LATENCY_PROFILES, name)));

async function measure(h, phase, fn) {
  h.http.phase = phase;
  const start = performance.now();
  h.http.started = start;
  await fn();
  const elapsed = performance.now() - start;
  const rows = h.http.requests.filter(row => row.phase === phase);
  const result = {phase, seconds: +(elapsed / 1000).toFixed(2), requests: rows.length,
    writes: rows.filter(row => row.method !== 'GET').length,
    downloadedKB: Math.round(rows.reduce((sum, row) => sum + (row.responseBytes || 0), 0) / 1024)};
  if (args.trace) result.trace = rows.map(row => [Math.round(row.t0 - h.http.started), Math.round(row.t1 - h.http.started), row.category, row.kind.replace('finance-tracker-full-snapshot-',''), row.fileId?.slice(-3)].join(' '));
  return result;
}

for (const profile of profiles) {
  const h = setup(LATENCY_PROFILES.trace);
  const out = [];
  try {
    // History is built at near-zero latency, inside one session lease; the
    // benchmark has no heartbeat timer.
    h.session.preview((args.dense ? denseLedgerFixture(1) : await createSyntheticFinancialYear()).ledger);
    h.http.phase = 'setup';
    await h.session.savePreviewToNewCopy();
    // Build retained history without timing it.
    for (let i = 1; i < history; i++) {
      h.session.correct({activityId: h.session.ledger.activities[i].activityId, type: 'category-correction', categoryId: 'invented', rationale: 'Invented history ' + i});
      await h.session.save();
    }
    h.session.correct({activityId: h.session.ledger.activities[0].activityId, type: 'category-correction', categoryId: 'invented', rationale: 'Invented'});
    const expected = structuredClone(h.session.ledger);
    h.http.timing = LATENCY_PROFILES[profile];
    out.push(await measure(h, 'save', () => h.session.save()));
    await h.session.release();
    out.push(await measure(h, 'open-released', async () => { assert.deepEqual(await h.session.open(), expected); }));
    // Simulate a crash: drop the page without release, then age its marker.
    h.storage.lifecycle.engine.invalidate();
    h.storage.lifecycle = null;
    ageMarker(h.http);
    h.session = new CanonicalWorkspaceSession({storage: h.storage, online: () => true});
    out.push(await measure(h, 'open-stale', async () => { assert.deepEqual(await h.session.open(), expected); }));
  } finally { await h.storage.lifecycle?.release().catch(() => {}); }
  const peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
  for (const row of out) console.log(JSON.stringify({profile, history, dense: Boolean(args.dense), ...row, peakRssMB}));
}
