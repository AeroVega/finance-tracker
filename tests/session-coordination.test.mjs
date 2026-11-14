import test from "node:test";
import assert from "node:assert/strict";
import {
  SessionCoordinator,
  SessionCoordinationError,
  SESSION_FORMAT,
  SESSION_VERSION
} from "../js/session-coordination.mjs";

class MemorySessionAdapter {
  constructor(record = null) {
    this.record = record;
    this.failReads = false;
    this.failWrites = false;
    this.afterWrite = null;
  }
  async read() {
    if (this.failReads) throw new Error("synthetic network interruption");
    return this.record ? structuredClone(this.record) : null;
  }
  async write(record) {
    if (this.failWrites) throw new Error("synthetic network interruption");
    this.record = structuredClone(record);
    if (this.afterWrite) await this.afterWrite(this);
  }
}

function makeRecord(now, overrides = {}) {
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    sessionId: "old-session",
    state: "active",
    startedAt: now - 10_000,
    heartbeatAt: now - 10_000,
    expiresAt: now - 8_000,
    releasedAt: null,
    ...overrides
  };
}

function coordinator(adapter, now, sessionId = "new-session") {
  return new SessionCoordinator({
    adapter,
    now: () => now.value,
    createSessionId: () => sessionId,
    staleAfterMs: 2_000,
    clockSkewMs: 100
  });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) =>
    error instanceof SessionCoordinationError && error.code === code
  );
}

test("starts when no session exists and verifies the persisted owner", async () => {
  const adapter = new MemorySessionAdapter();
  const now = { value: 10_000 };
  const session = coordinator(adapter, now);
  const record = await session.start();
  assert.equal(record.sessionId, "new-session");
  assert.equal(session.canWrite, true);
  assert.equal(await session.assertCanWrite(), true);
});

test("refuses a second active session and leaves the record untouched", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter(makeRecord(now.value, {
    heartbeatAt: 9_500,
    expiresAt: 11_500
  }));
  const session = coordinator(adapter, now);
  await expectCode(session.start(), "session-active");
  assert.equal(adapter.record.sessionId, "old-session");
  assert.equal(session.canWrite, false);
});

test("requires explicit recovery for a stale session", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter(makeRecord(now.value));
  const session = coordinator(adapter, now);
  await expectCode(session.start(), "stale-session");
  await expectCode(session.recoverStale({ confirm: false }), "confirmation-required");
  assert.equal(adapter.record.sessionId, "old-session");
});

test("explicit stale recovery rechecks and verifies the replacement owner", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter(makeRecord(now.value));
  const session = coordinator(adapter, now);
  const recovered = await session.recoverStale({ confirm: true });
  assert.equal(recovered.sessionId, "new-session");
  assert.equal(adapter.record.sessionId, "new-session");
  assert.equal(session.canWrite, true);
});

test("refuses ambiguous, malformed, and future-dated ownership", async () => {
  const now = { value: 10_000 };
  const malformed = new MemorySessionAdapter({ format: "wrong" });
  await expectCode(coordinator(malformed, now).start(), "ownership-unknown");

  const future = new MemorySessionAdapter(makeRecord(now.value, {
    heartbeatAt: 20_000,
    expiresAt: 22_000
  }));
  await expectCode(coordinator(future, now).start(), "ownership-unknown");
});

test("network interruption while reading fails closed", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  adapter.failReads = true;
  const session = coordinator(adapter, now);
  await expectCode(session.start(), "ownership-unknown");
  assert.equal(session.canWrite, false);
});

test("a lost claim response can be resolved by revalidating the same session ID", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  adapter.afterWrite = async () => { throw new Error("synthetic response lost after persisted claim"); };
  const session = coordinator(adapter, now);
  await expectCode(session.start(), "ownership-unknown");
  assert.equal(session.canWrite, false);
  adapter.afterWrite = null;
  const resumed = await session.resume();
  assert.equal(resumed.sessionId, "new-session");
  assert.equal(session.canWrite, true);
});

test("network interruption while claiming cannot enable writes", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  adapter.failWrites = true;
  const session = coordinator(adapter, now);
  await expectCode(session.start(), "ownership-unknown");
  assert.equal(session.canWrite, false);
});

test("lost ownership during heartbeat blocks all subsequent writes", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  adapter.failWrites = true;
  await expectCode(session.heartbeat(), "ownership-unknown");
  await expectCode(session.assertCanWrite(), "not-owner");
  assert.equal(session.canWrite, false);
});

test("ownership can be revalidated after a transient network interruption", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  adapter.failReads = true;
  await expectCode(session.assertCanWrite(), "ownership-lost");
  assert.equal(session.canWrite, false);
  adapter.failReads = false;
  const resumed = await session.resume();
  assert.equal(resumed.sessionId, "new-session");
  assert.equal(session.canWrite, true);
});

test("network interruption during ownership verification fails closed", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  adapter.failReads = true;
  await expectCode(session.assertCanWrite(), "ownership-lost");
  assert.equal(session.canWrite, false);
});

test("offline writes are refused and ownership is discarded", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  await expectCode(session.assertCanWrite({ online: false }), "offline");
  assert.equal(session.canWrite, false);
});

test("withWrite serializes local writes and rechecks ownership before each", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  const order = [];
  await Promise.all([
    session.withWrite(async () => { order.push("first-start"); await Promise.resolve(); order.push("first-end"); }),
    session.withWrite(async () => { order.push("second"); })
  ]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("withWrite refuses a write after another session replaces the owner", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  adapter.record = makeRecord(now.value, {
    sessionId: "other-session",
    heartbeatAt: now.value,
    expiresAt: now.value + 2_000
  });
  let called = false;
  await expectCode(session.withWrite(() => { called = true; }), "ownership-lost");
  assert.equal(called, false);
});

test("orderly release is verified and permits the next device to start", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const first = coordinator(adapter, now, "device-a");
  await first.start();
  assert.deepEqual(await first.release(), { released: true });
  assert.equal(adapter.record.state, "released");

  const second = coordinator(adapter, now, "device-b");
  await second.start();
  assert.equal(second.session.sessionId, "device-b");
});

test("release waits for queued writes and blocks new writes during handoff", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  let finishWrite, signalAdmitted;
  const admitted = new Promise(resolve => { signalAdmitted = resolve; });
  const pending = session.withWrite(() => new Promise((resolve) => { finishWrite = resolve; signalAdmitted(); }));
  await admitted;
  const releasing = session.release();
  const blocked = session.withWrite(() => undefined);
  await expectCode(blocked, "not-owner");
  finishWrite("done");
  await pending;
  await releasing;
  assert.equal(adapter.record.state, "released");
});

test("release failure is not treated as a completed handoff", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  adapter.failWrites = true;
  await expectCode(session.release(), "release-unconfirmed");
  assert.equal(session.canWrite, false);
});

test("browser-crash simulation becomes stale only after the heartbeat window", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const crashed = coordinator(adapter, now, "crashed-device");
  await crashed.start();

  now.value += 1_999;
  assert.equal((await coordinator(adapter, now, "new-device").inspect()).status, "active");
  now.value += 1;
  const replacement = coordinator(adapter, now, "new-device");
  assert.equal((await replacement.inspect()).status, "stale");
  await expectCode(replacement.start(), "stale-session");
  await replacement.recoverStale({ confirm: true });
  assert.equal(replacement.canWrite, true);
});

test("scheduled heartbeats refresh ownership and stop cleanly", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  let tick;
  let cleared = false;
  session.startHeartbeat({
    intervalMs: 500,
    isOnline: () => true,
    setIntervalImpl: (callback) => { tick = callback; return 7; },
    clearIntervalImpl: (id) => { cleared = id === 7; }
  });
  now.value += 500;
  await tick();
  assert.equal(adapter.record.heartbeatAt, now.value);
  await session.release();
  assert.equal(cleared, true);
});

test("offline heartbeat scheduling immediately disables writes", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  let tick;
  let errorCode = "";
  session.startHeartbeat({
    intervalMs: 500,
    isOnline: () => false,
    setIntervalImpl: (callback) => { tick = callback; return 8; },
    clearIntervalImpl: () => undefined,
    onError: (error) => { errorCode = error.code; }
  });
  await tick();
  assert.equal(errorCode, "offline");
  assert.equal(session.canWrite, false);
});

test("heartbeat extends the lease only while the current owner is still verified", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  now.value += 1_000;
  const heartbeat = await session.heartbeat();
  assert.equal(heartbeat.heartbeatAt, now.value);
  assert.equal(heartbeat.expiresAt, now.value + 2_000);
});

test("a changed record during stale recovery causes a fail-closed result", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter(makeRecord(now.value));
  let reads = 0;
  const originalRead = adapter.read.bind(adapter);
  adapter.read = async () => {
    reads += 1;
    const value = await originalRead();
    if (reads === 2) {
      adapter.record = makeRecord(now.value, { sessionId: "raced-session" });
      return structuredClone(adapter.record);
    }
    return value;
  };
  const session = coordinator(adapter, now);
  await expectCode(session.recoverStale({ confirm: true }), "ownership-unknown");
  assert.equal(session.canWrite, false);
});


test("authorization failure is reported as recoverable sign-in, not as a corrupt or conflicting session", async () => {
  const now = { value: 10_000 };
  let authorized = false;
  const adapter = {
    record: null,
    async read() {
      if (!authorized) {
        const error = new Error("Google authorization required");
        error.code = "authorization-required";
        throw error;
      }
      return this.record ? structuredClone(this.record) : null;
    },
    async write(record) { this.record = structuredClone(record); }
  };
  const session = coordinator(adapter, now);
  await assert.rejects(session.start(), (error) =>
    error.code === "authorization-required" &&
    /Reconnect to Google/.test(error.message) &&
    /no session or stored data was changed/.test(error.message)
  );
  assert.equal(session.canWrite, false);
  authorized = true;
  const acquired = await session.start();
  assert.equal(acquired.sessionId, "new-session");
  assert.equal(session.canWrite, true);
});


test("same-session resume distinguishes expired authorization from lost ownership", async () => {
  const now = { value: 10_000 };
  let authorized = true;
  const adapter = {
    record: null,
    async read() {
      if (!authorized) {
        const error = new Error("Google authorization required");
        error.code = "authorization-required";
        throw error;
      }
      return this.record ? structuredClone(this.record) : null;
    },
    async write(record) { this.record = structuredClone(record); }
  };
  const session = coordinator(adapter, now);
  await session.start();
  authorized = false;
  await assert.rejects(session.resume(), (error) =>
    error.code === "authorization-required" && /Reconnect to Google/.test(error.message)
  );
  assert.equal(session.canWrite, false);
  authorized = true;
  const resumed = await session.resume();
  assert.equal(resumed.sessionId, "new-session");
  assert.equal(session.canWrite, true);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("handoff preserves guards of admitted writes and rechecks after they finish", async () => {
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, { value: 10_000 });
  await session.start();
  const entered = deferred();
  const finish = deferred();
  const events = [];
  const write = session.withWrite(async () => {
    entered.resolve();
    await finish.promise;
    await session.assertCanWrite();
    events.push("write-finished");
  });
  await entered.promise;
  const release = session.release({ beforeRelease: () => events.push("release-check") });
  await expectCode(session.withWrite(() => assert.fail("new write admitted")), "not-owner");
  finish.resolve();
  await write;
  await release;
  assert.deepEqual(events, ["write-finished", "release-check"]);
  assert.equal(adapter.record.state, "released");
});

test("a rejected post-drain check retains the active marker and heartbeat", async () => {
  const adapter = new MemorySessionAdapter();
  const now = { value: 10_000 };
  const session = coordinator(adapter, now);
  await session.start();
  let stopped = false;
  session.startHeartbeat({ setIntervalImpl: () => 1, clearIntervalImpl: () => { stopped = true; } });
  await assert.rejects(session.release({ beforeRelease: () => {
    throw Object.assign(new Error("Synthetic unresolved transaction"), { code: "recovery-required" });
  } }), { code: "recovery-required" });
  assert.equal(stopped, false);
  assert.equal(session.releasing, false);
  assert.equal(session.canWrite, true);
  now.value += 500;
  await session.heartbeat();
  assert.equal(adapter.record.state, "active");
  assert.equal(adapter.record.heartbeatAt, now.value);
  await session.release();
});

test("heartbeats renew during a transaction and handoff lasting longer than the default lease", async () => {
  const adapter = new MemorySessionAdapter();
  const now = { value: 1_000_000 };
  const session = new SessionCoordinator({ adapter, now: () => now.value, createSessionId: () => "synthetic-long-write" });
  await session.start();
  const entered = deferred();
  const finish = deferred();
  const write = session.withWrite(async () => {
    entered.resolve();
    await finish.promise;
    await session.assertCanWrite();
  });
  await entered.promise;
  const release = session.release();
  for (let i = 0; i < 4; i++) {
    now.value += 40_000;
    await session.heartbeat();
    assert.equal(adapter.record.heartbeatAt, now.value);
    assert.equal(adapter.record.state, "active");
  }
  finish.resolve();
  await write;
  await release;
  assert.equal(adapter.record.state, "released");
  await expectCode(session.heartbeat(), "not-owner");
  assert.equal(adapter.record.state, "released");
});

test("release serializes after an in-flight heartbeat and late scheduled ticks cannot resurrect it", async () => {
  const adapter = new MemorySessionAdapter();
  const now = { value: 10_000 };
  const session = coordinator(adapter, now);
  await session.start();
  const entered = deferred();
  const finish = deferred();
  adapter.afterWrite = async () => { entered.resolve(); await finish.promise; };
  let tick;
  const errors = [];
  session.startHeartbeat({ setIntervalImpl: (fn) => { tick = fn; return 1; }, clearIntervalImpl: () => {}, onError: (e) => errors.push(e.code) });
  now.value += 500;
  const heartbeat = tick();
  await entered.promise;
  const release = session.release();
  // Queue another tick while the first heartbeat is still awaiting read-back.
  const late = tick();
  finish.resolve();
  await Promise.all([heartbeat, release, late]);
  assert.equal(adapter.record.state, "released");
  assert.equal(session.canWrite, false);
  assert.deepEqual(errors, []);
  await tick();
  assert.equal(adapter.record.state, "released");
});

test("heartbeat cannot restore ownership invalidated by an offline event during read-back", async () => {
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, { value: 10_000 });
  await session.start();
  adapter.afterWrite = async () => { await expectCode(session.assertCanWrite({ online: false }), "offline"); };
  await expectCode(session.heartbeat(), "ownership-unknown");
  assert.equal(session.canWrite, false);
});

test("a stale lease is not silently renewed by the independent heartbeat queue", async () => {
  const now = { value: 10_000 };
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, now);
  await session.start();
  const original = structuredClone(adapter.record);
  now.value += 2_000;
  await expectCode(session.heartbeat(), "ownership-lost");
  assert.deepEqual(adapter.record, original);
});

test("a resume already checking ownership cannot reopen admission during release", async () => {
  const adapter = new MemorySessionAdapter();
  const session = coordinator(adapter, { value: 10_000 });
  await session.start();
  const entered = deferred();
  const finish = deferred();
  const originalRead = adapter.read.bind(adapter);
  let hold = true;
  adapter.read = async () => {
    if (hold) { hold = false; entered.resolve(); await finish.promise; }
    return originalRead();
  };
  const resume = session.resume();
  await entered.promise;
  const release = session.release();
  await expectCode(session.start(), "not-owner");
  await expectCode(session.resume(), "not-owner");
  finish.resolve();
  await resume;
  await expectCode(session.withWrite(() => assert.fail("write entered during release")), "not-owner");
  await release;
  assert.equal(adapter.record.state, "released");
});
