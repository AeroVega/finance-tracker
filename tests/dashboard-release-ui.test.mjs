import test from "node:test";
import assert from "node:assert/strict";
import { DashboardSyntheticStorage, createDashboardReleaseHandler } from "../js/dashboard-synthetic-storage.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("dashboard rejects release without a lifecycle instead of announcing success", async () => {
  const statuses = [];
  const storage = new DashboardSyntheticStorage({ onStatus: (status) => statuses.push(status) });
  await assert.rejects(storage.release(), (error) => error.code === "release-unconfirmed");
  assert.deepEqual(statuses, []);
});

test("late release completion cannot erase a newly unresolved save", async () => {
  const statuses = [];
  const storage = new DashboardSyntheticStorage({ onStatus: (status) => statuses.push(status) });
  const gate = deferred();
  const lifecycle = { state: "ready", engine: { recoveryRequired: false }, release: () => gate.promise };
  storage.lifecycle = lifecycle;
  const releasing = storage.release();
  lifecycle.state = "recovery-required";
  lifecycle.engine.recoveryRequired = true;
  storage.publish("recovery-required", "A save needs recovery.", "error");
  gate.resolve({ released: true });
  await assert.rejects(releasing, (error) => error.code === "release-unconfirmed");
  assert.equal(storage.lifecycle, lifecycle);
  assert.equal(statuses.at(-1).state, "recovery-required");
  assert.equal(statuses.some((status) => status.kind === "success"), false);
});

test("release cannot clear a newer lifecycle even after an old successful release", async () => {
  const storage = new DashboardSyntheticStorage();
  const gate = deferred();
  storage.lifecycle = { state: "released", engine: { recoveryRequired: false }, release: () => gate.promise };
  const releasing = storage.release();
  const newer = { state: "ready" };
  storage.lifecycle = newer;
  gate.resolve({ released: true });
  await assert.rejects(releasing, (error) => error.code === "release-unconfirmed");
  assert.equal(storage.lifecycle, newer);
});

test("verified dashboard handoff publishes success only after lifecycle verification", async () => {
  const statuses = [];
  const storage = new DashboardSyntheticStorage({ onStatus: (status) => statuses.push(status) });
  const lifecycle = { state: "ready", engine: { recoveryRequired: false }, async release() { this.state = "released"; return { released: true }; } };
  storage.lifecycle = lifecycle;
  assert.deepEqual(await storage.release(), { released: true });
  assert.equal(storage.lifecycle, null);
  assert.deepEqual(statuses, [{ state: "disconnected", message: "Synthetic storage session released.", kind: "success" }]);
});

test("UI handler records event provenance and never writes its own delayed success", async () => {
  const gate = deferred();
  const calls = [];
  let visibleStatus = "initial";
  const handler = createDashboardReleaseHandler({
    getStorage: () => ({ release: () => gate.promise }),
    setPending: (pending) => calls.push(["pending", pending]),
    onDiagnostic: (entry) => calls.push(entry),
    onError: (error) => { visibleStatus = error.message; }
  });
  const pending = handler({ isTrusted: false });
  visibleStatus = "newer recovery-required warning";
  gate.resolve({ released: true });
  await pending;
  assert.equal(visibleStatus, "newer recovery-required warning");
  assert.deepEqual(calls, [{ event: "release-click", isTrusted: false }, ["pending", true]]);
});

test("UI handler refuses missing storage and unverified release results", async () => {
  for (const storage of [null, { release: async () => ({ released: false }) }]) {
    const failures = [];
    const pending = [];
    await createDashboardReleaseHandler({ getStorage: () => storage, setPending: (value) => pending.push(value), onError: (error) => failures.push(error) })({ isTrusted: true });
    assert.equal(failures.length, 1);
    assert.deepEqual(pending, [true, false]);
  }
});

test("a failing diagnostic observer cannot prevent release", async () => {
  let released = false;
  const failures = [];
  await createDashboardReleaseHandler({
    getStorage: () => ({ async release() { released = true; return { released: true }; } }),
    setPending: () => {},
    onError: (error) => failures.push(error),
    onDiagnostic: () => { throw new Error("synthetic observer failure"); }
  })({ isTrusted: true });
  assert.equal(released, true);
  assert.deepEqual(failures, []);
});
