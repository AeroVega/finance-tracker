import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { ApplicationStorageLifecycle } from "../js/application-storage-lifecycle.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";

class MemorySessionAdapter {
  constructor(record = null) { this.record = record; }
  async read() { return this.record ? structuredClone(this.record) : null; }
  async write(record) { this.record = structuredClone(record); }
}

class FakeTarget extends EventTarget {}

function setup({ recoveryFailures = 0, initialRecord = null } = {}) {
  const statuses = [];
  const sessionAdapter = new MemorySessionAdapter(initialRecord);
  const calls = { recover: 0, transact: 0, readJson: 0 };
  const transactionAdapter = {
    async readJson() { calls.readJson++; return { revision: 1, commitId: "c1", snapshot: {} }; },
    async readMetadata() { return { appProperties: { financeTrackerHash: "0".repeat(64) } }; },
    async readBytes() { return new Uint8Array(); }
  };
  const engine = {
    recoveryRequired: false,
    async recover() {
      calls.recover++;
      if (recoveryFailures > 0) { recoveryFailures--; throw Object.assign(new Error("synthetic recovery failure"), { code: "recovery-needs-intervention" }); }
      return { manifest: { revision: 1 }, transactions: [] };
    },
    async transact(input) { calls.transact++; return { transactionId: input.transactionId || "tx1" }; }
  };
  let nextTimer = 0;
  const target = new FakeTarget();
  const lifecycle = new ApplicationStorageLifecycle({
    syntheticOnly: true,
    folderName: "Finance Tracker synthetic test",
    folderId: "synthetic-folder",
    manifestFileId: "synthetic-manifest",
    accessToken: () => "synthetic-token",
    makeManifest: () => ({}),
    cryptoImpl: webcrypto,
    lifecycleTarget: target,
    setIntervalImpl: () => ++nextTimer,
    clearIntervalImpl: () => {},
    onStatus: (status) => statuses.push(status),
    factories: {
      createSessionAdapter: () => sessionAdapter,
      createCoordinator: ({ adapter }) => new SessionCoordinator({ adapter }),
      createTransactionAdapter: () => transactionAdapter,
      createEngine: () => engine
    }
  });
  return { lifecycle, statuses, sessionAdapter, calls, target, engine };
}

test("refuses a non-synthetic folder before constructing storage adapters", () => {
  assert.throws(() => new ApplicationStorageLifecycle({
    syntheticOnly: true, folderName: "finance-tracker-database"
  }), (error) => error.code === "synthetic-folder-required");
});

test("acquires a session, recovers before ready, and starts background heartbeat", async () => {
  const { lifecycle, calls, sessionAdapter, statuses } = setup();
  await lifecycle.start();
  assert.equal(lifecycle.state, "ready");
  assert.equal(lifecycle.coordinator.canWrite, true);
  assert.equal(calls.recover, 1);
  assert.equal(sessionAdapter.record.state, "active");
  assert.equal(typeof lifecycle.heartbeatStop, "function");
  assert.equal(statuses.some((status) => status.state === "recovering"), true);
});

test("serializes application transactions through the owned session", async () => {
  const { lifecycle, calls } = setup();
  await lifecycle.start();
  const result = await lifecycle.transact({ transactionId: "synthetic-tx" });
  assert.equal(result.transactionId, "synthetic-tx");
  assert.equal(calls.transact, 1);
  assert.equal(lifecycle.state, "ready");
});

test("offline blocks writes and reconnect revalidates the same session before recovery", async () => {
  const { lifecycle, calls, target } = setup();
  await lifecycle.start();
  const sessionId = lifecycle.coordinator.session.sessionId;
  target.dispatchEvent(new Event("offline"));
  await Promise.resolve();
  assert.equal(lifecycle.state, "offline");
  assert.equal(lifecycle.acceptingWrites, false);
  await assert.rejects(lifecycle.transact({}), (error) => error.code === "storage-not-ready");

  target.dispatchEvent(new Event("online"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lifecycle.state, "ready");
  assert.equal(lifecycle.coordinator.session.sessionId, sessionId);
  assert.equal(calls.recover, 2);
});

test("recovery failure keeps the acquired session alive but blocks reads and writes", async () => {
  const { lifecycle, calls } = setup({ recoveryFailures: 1 });
  await assert.rejects(lifecycle.start(), (error) => error.code === "recovery-needs-intervention");
  assert.equal(lifecycle.state, "recovery-required");
  assert.equal(lifecycle.coordinator.canWrite, true);
  assert.equal(lifecycle.acceptingWrites, false);
  await assert.rejects(lifecycle.readManifest(), (error) => error.code === "storage-not-ready");
  await lifecycle.recover();
  assert.equal(calls.recover, 2);
  assert.equal(lifecycle.state, "ready");
  assert.equal(lifecycle.acceptingWrites, true);
});

test("unresolved transactions block release and retain the active ownership claim", async () => {
  const { lifecycle, sessionAdapter, engine } = setup();
  await lifecycle.start();
  engine.recoveryRequired = true;
  lifecycle.state = "recovery-required";
  lifecycle.acceptingWrites = false;

  await assert.rejects(lifecycle.release(), (error) => error.code === "recovery-required");
  assert.equal(sessionAdapter.record.state, "active");
  assert.equal(lifecycle.coordinator.canWrite, true);
  assert.equal(lifecycle.started, true);
  assert.equal(typeof lifecycle.heartbeatStop, "function");

  // Recovery resolves the pending transaction; only then may handoff proceed.
  engine.recoveryRequired = false;
  await lifecycle.recover();
  const result = await lifecycle.release();
  assert.equal(result.released, true);
  assert.equal(sessionAdapter.record.state, "released");
});

test("uncertain ownership does not masquerade as a completed release", async () => {
  const { lifecycle, sessionAdapter } = setup();
  await lifecycle.start();
  lifecycle.coordinator.ownership = "unknown";
  lifecycle.state = "ownership-unknown";
  lifecycle.acceptingWrites = false;

  await assert.rejects(lifecycle.release(), (error) => error.code === "release-unconfirmed");
  assert.equal(sessionAdapter.record.state, "active");
  assert.equal(lifecycle.started, true);
  assert.equal(typeof lifecycle.heartbeatStop, "function");
  assert.equal(lifecycle.coordinator.ownership, "unknown");
});

test("orderly release drains and releases the session", async () => {
  const { lifecycle, sessionAdapter } = setup();
  await lifecycle.start();
  const result = await lifecycle.release();
  assert.equal(result.released, true);
  assert.equal(sessionAdapter.record.state, "released");
  assert.equal(lifecycle.state, "released");
  assert.equal(lifecycle.started, false);
});

test("pagehide makes a best-effort release attempt", async () => {
  const { lifecycle, target, sessionAdapter } = setup();
  await lifecycle.start();
  target.dispatchEvent(new Event("pagehide"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sessionAdapter.record.state, "released");
});

test("session inspection preserves a safe Drive-read diagnostic while refusing ownership", async () => {
  const { lifecycle } = setup();
  lifecycle.factories.createSessionAdapter = () => ({
    async read() { throw Object.assign(new Error("synthetic adapter failure"), { code: "ambiguous-session-record" }); },
    async write() { throw new Error("write must not be attempted"); }
  });
  await assert.rejects(lifecycle.start(), (error) => {
    assert.equal(error.code, "ownership-unknown");
    assert.match(error.message, /ambiguous-session-record/);
    return true;
  });
  assert.equal(lifecycle.state, "connection-error");
  assert.equal(lifecycle.acceptingWrites, false);
  assert.equal(lifecycle.coordinator.canWrite, false);
});

test("stale sessions are never taken over automatically and require explicit recovery", async () => {
  const now = Date.now();
  const staleRecord = {
    format: "finance-tracker-session",
    version: 1,
    sessionId: "previous-page",
    state: "active",
    startedAt: now - 240_000,
    heartbeatAt: now - 240_000,
    expiresAt: now - 120_000,
    releasedAt: null
  };
  const { lifecycle, sessionAdapter } = setup({ initialRecord: staleRecord });
  await assert.rejects(lifecycle.start(), (error) => error.code === "stale-session");
  assert.equal(sessionAdapter.record.sessionId, "previous-page");
  await assert.rejects(lifecycle.recoverStaleSession({ confirm: false }), (error) => error.code === "confirmation-required");
  assert.equal(sessionAdapter.record.sessionId, "previous-page");
  await lifecycle.recoverStaleSession({ confirm: true });
  assert.equal(lifecycle.state, "ready");
  assert.notEqual(sessionAdapter.record.sessionId, "previous-page");
});

test("manifest initialization is gated behind verified session acquisition", async () => {
  const { lifecycle, sessionAdapter } = setup();
  lifecycle.manifestFileId = null;
  let initialized = false;
  lifecycle.initializeManifest = async () => {
    assert.equal(sessionAdapter.record?.state, "active");
    assert.equal(lifecycle.coordinator.canWrite, true);
    initialized = true;
    return "synthetic-manifest-created-under-session";
  };
  await lifecycle.start();
  assert.equal(initialized, true);
  assert.equal(lifecycle.manifestFileId, "synthetic-manifest-created-under-session");
  assert.equal(lifecycle.state, "ready");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("release drains a guard-bearing save without revoking its ownership", async () => {
  const { lifecycle, engine, sessionAdapter, statuses } = setup();
  await lifecycle.start();
  const entered = deferred(), proceed = deferred();
  engine.transact = async () => {
    entered.resolve();
    await proceed.promise;
    await lifecycle.coordinator.assertCanWrite();
    return { committed: true };
  };
  const saving = lifecycle.transact({});
  await entered.promise;
  const releasing = lifecycle.release();
  assert.equal(typeof lifecycle.heartbeatStop, "function");
  await assert.rejects(lifecycle.transact({}), (error) => error.code === "storage-not-ready");
  proceed.resolve();
  assert.deepEqual(await saving, { committed: true });
  assert.equal((await releasing).released, true);
  assert.equal(sessionAdapter.record.state, "released");
  const drainStatuses = statuses.slice(statuses.findIndex((entry) => entry.state === "releasing"));
  assert.deepEqual(drainStatuses.map((entry) => entry.state), ["releasing", "released"]);
});

test("a save that becomes unresolved during release keeps ownership and cannot turn green", async () => {
  const { lifecycle, engine, sessionAdapter, statuses } = setup();
  await lifecycle.start();
  const entered = deferred(), proceed = deferred();
  engine.transact = async () => {
    entered.resolve();
    await proceed.promise;
    engine.recoveryRequired = true;
    throw Object.assign(new Error("invented failed save"), { code: "transaction-unresolved" });
  };
  const saving = lifecycle.transact({});
  await entered.promise;
  const releasing = lifecycle.release();
  const results = Promise.allSettled([saving, releasing]);
  proceed.resolve();
  const [saved, released] = await results;
  assert.equal(saved.reason.code, "transaction-unresolved");
  assert.equal(released.reason.code, "recovery-required");
  assert.equal(sessionAdapter.record.state, "active");
  assert.equal(lifecycle.state, "recovery-required");
  assert.equal(lifecycle.coordinator.releasing, false);
  assert.equal(typeof lifecycle.heartbeatStop, "function");
  assert.equal(statuses.some((entry) => entry.state === "released"), false);
});

test("automatic pagehide cannot erase a save failure during its drain", async () => {
  const { lifecycle, engine, target, sessionAdapter, statuses } = setup();
  const diagnosticEvents = [];
  lifecycle.onDiagnostic = (event) => diagnosticEvents.push(event);
  await lifecycle.start();
  const entered = deferred(), proceed = deferred();
  engine.transact = async () => {
    entered.resolve();
    await proceed.promise;
    engine.recoveryRequired = true;
    throw Object.assign(new Error("invented failed save"), { code: "transaction-unresolved" });
  };
  const saving = lifecycle.transact({});
  await entered.promise;
  target.dispatchEvent(new Event("pagehide"));
  proceed.resolve();
  await assert.rejects(saving);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sessionAdapter.record.state, "active");
  assert.equal(lifecycle.state, "recovery-required");
  assert.equal(statuses.some((entry) => entry.state === "released"), false);
  assert.equal(diagnosticEvents.some((entry) => entry.event === "release-request" && entry.reason === "pagehide"), true);
  assert.equal(diagnosticEvents.some((entry) => entry.event === "release-refused"), true);
});

test("renewal starts before lengthy startup recovery and survives more than one lease", async () => {
  let now = 1_000_000, tick;
  const entered = deferred(), proceed = deferred();
  const sessionAdapter = new MemorySessionAdapter();
  const lifecycle = new ApplicationStorageLifecycle({
    syntheticOnly: true, folderName: "synthetic", folderId: "synthetic-folder", manifestFileId: "synthetic-manifest",
    accessToken: () => "invented-token", makeManifest: () => ({}), lifecycleTarget: null,
    setIntervalImpl: (callback) => { tick = callback; return 1; }, clearIntervalImpl: () => {},
    factories: {
      createSessionAdapter: () => sessionAdapter,
      createCoordinator: ({ adapter }) => new SessionCoordinator({ adapter, now: () => now }),
      createTransactionAdapter: () => ({}),
      createEngine: ({ assertWritable }) => ({
        async recover() { entered.resolve(); await proceed.promise; await assertWritable(); }
      })
    }
  });
  const starting = lifecycle.start();
  await entered.promise;
  assert.equal(typeof tick, "function");
  for (let step = 0; step < 4; step++) { now += 40_000; await tick(); }
  proceed.resolve();
  await starting;
  assert.equal(lifecycle.state, "ready");
  assert.equal(sessionAdapter.record.heartbeatAt, now);
  await lifecycle.release();
});

test("startup retains the original ownership failure if early renewal loses the session", async () => {
  const { lifecycle, engine, statuses } = setup();
  engine.recover = async () => {
    lifecycle.coordinator.ownership = "unknown";
    throw Object.assign(new Error("invented original failure"), { code: "ownership-lost" });
  };
  await assert.rejects(lifecycle.start(), (error) => error.code === "ownership-lost");
  assert.equal(lifecycle.state, "ownership-unknown");
  assert.equal(lifecycle.acceptingWrites, false);
  assert.equal(lifecycle.listenersAttached, true);
  assert.equal(statuses.at(-1).code, "ownership-lost");
});

test("a committed save does not erase ownership loss during its final read-back", async () => {
  const { lifecycle, engine, statuses } = setup();
  await lifecycle.start();
  engine.transact = async () => {
    lifecycle.coordinator.ownership = "unknown";
    lifecycle.acceptingWrites = false;
    lifecycle.publish("ownership-unknown", "Connection could not be verified.", "ownership-lost");
    return { committed: true };
  };
  assert.deepEqual(await lifecycle.transact({}), { committed: true });
  assert.equal(lifecycle.state, "ownership-unknown");
  assert.equal(statuses.at(-1).state, "ownership-unknown");
  assert.equal(engine.recoveryRequired, false);
});
