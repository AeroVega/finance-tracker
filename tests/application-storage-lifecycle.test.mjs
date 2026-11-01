import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { ApplicationStorageLifecycle } from "../js/application-storage-lifecycle.mjs";

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
      createCoordinator: ({ adapter }) => {
        const { SessionCoordinator } = globalThis.__sessionModule || {};
        return new (SessionCoordinator || class {})({ adapter });
      },
      createTransactionAdapter: () => transactionAdapter,
      createEngine: () => engine
    }
  });
  return { lifecycle, statuses, sessionAdapter, calls, target, engine };
}

// Inject the real state machine into the test factory without exposing a test-only
// production branch in the application module.
import { SessionCoordinator } from "../js/session-coordination.mjs";
globalThis.__sessionModule = { SessionCoordinator };

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
