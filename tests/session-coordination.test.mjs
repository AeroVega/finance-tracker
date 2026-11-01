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
