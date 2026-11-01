export const SESSION_FORMAT = "finance-tracker-session";
export const SESSION_VERSION = 1;
export const DEFAULT_SESSION_TTL_MS = 120_000;

export class SessionCoordinationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionCoordinationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SessionCoordinationError(code, message);
}

function validRecord(record) {
  return Boolean(
    record &&
    record.format === SESSION_FORMAT &&
    record.version === SESSION_VERSION &&
    typeof record.sessionId === "string" &&
    record.sessionId.length > 0 &&
    (record.state === "active" || record.state === "released") &&
    Number.isSafeInteger(record.startedAt) &&
    Number.isSafeInteger(record.heartbeatAt) &&
    Number.isSafeInteger(record.expiresAt) &&
    record.expiresAt >= record.heartbeatAt &&
    (record.releasedAt === null || Number.isSafeInteger(record.releasedAt))
  );
}

function sameRecord(left, right) {
  return Boolean(left && right &&
    left.format === right.format &&
    left.version === right.version &&
    left.sessionId === right.sessionId &&
    left.state === right.state &&
    left.startedAt === right.startedAt &&
    left.heartbeatAt === right.heartbeatAt &&
    left.expiresAt === right.expiresAt &&
    left.releasedAt === right.releasedAt);
}

/**
 * Best-effort single-active-session coordinator.
 *
 * adapter.read() must return the complete session record or null when absent.
 * adapter.write(record) must durably replace the record or reject. It must not
 * claim atomic compare-and-swap semantics.
 *
 * Every storage mutation must be gated by assertCanWrite()/withWrite(). The
 * coordinator is not a server-enforced lock and cannot prevent all races.
 */
export class SessionCoordinator {
  constructor(options) {
    const settings = options || {};
    if (!settings.adapter ||
        typeof settings.adapter.read !== "function" ||
        typeof settings.adapter.write !== "function") {
      fail("invalid-adapter", "A readable and writable session adapter is required.");
    }
    this.adapter = settings.adapter;
    this.now = settings.now || Date.now;
    this.createSessionId = settings.createSessionId ||
      (() => globalThis.crypto.randomUUID());
    this.staleAfterMs = Number(settings.staleAfterMs || DEFAULT_SESSION_TTL_MS);
    this.clockSkewMs = Number(settings.clockSkewMs ?? 5_000);
    if (!Number.isSafeInteger(this.staleAfterMs) || this.staleAfterMs < 1 ||
        !Number.isSafeInteger(this.clockSkewMs) || this.clockSkewMs < 0) {
      fail("invalid-timing", "Session timing settings are invalid.");
    }
    this.session = null;
    this.ownership = "unowned";
    this.writeQueue = Promise.resolve();
  }

  get canWrite() {
    return this.ownership === "owned" && Boolean(this.session);
  }

  async inspect() {
    let record;
    try {
      record = await this.adapter.read();
    } catch {
      return { status: "unknown", record: null };
    }
    if (record === null) return { status: "absent", record: null };
    if (!validRecord(record)) return { status: "ambiguous", record: null };

    const now = this.now();
    if (record.heartbeatAt > now + this.clockSkewMs) {
      return { status: "ambiguous", record };
    }
    if (record.state === "released") return { status: "released", record };
    if (now - record.heartbeatAt >= this.staleAfterMs ||
        record.expiresAt <= now) {
      return { status: "stale", record };
    }
    return { status: "active", record };
  }

  makeRecord(sessionId, state = "active", startedAt = this.now()) {
    const heartbeatAt = this.now();
    return {
      format: SESSION_FORMAT,
      version: SESSION_VERSION,
      sessionId,
      state,
      startedAt,
      heartbeatAt,
      expiresAt: heartbeatAt + this.staleAfterMs,
      releasedAt: null
    };
  }

  async verifyWrittenRecord(expected, failureCode) {
    let actual;
    try {
      actual = await this.adapter.read();
    } catch {
      this.ownership = "unknown";
      this.session = null;
      fail(failureCode, "Session ownership could not be verified after the write. All writes are disabled.");
    }
    if (!sameRecord(actual, expected)) {
      this.ownership = "unknown";
      this.session = null;
      fail(failureCode, "The session record changed or could not be verified. All writes are disabled.");
    }
  }

  async start() {
    if (this.canWrite) return this.session;
    const current = await this.inspect();
    if (current.status === "active") fail("session-active", "Another active session is already registered. End that session before switching devices.");
    if (current.status === "stale") fail("stale-session", "A session appears stale. Automatic takeover is disabled; use the explicit stale-session recovery flow.");
    if (current.status === "ambiguous" || current.status === "unknown") {
      this.ownership = "unknown";
      fail("ownership-unknown", "The existing session state cannot be trusted. Writes are disabled.");
    }

    const record = this.makeRecord(String(this.createSessionId()));
    try {
      await this.adapter.write(record);
    } catch {
      this.ownership = "unknown";
      fail("ownership-unknown", "The session claim could not be confirmed. Writes are disabled.");
    }
    await this.verifyWrittenRecord(record, "ownership-unknown");
    this.session = record;
    this.ownership = "owned";
    return record;
  }

  async recoverStale(options) {
    if (!options || options.confirm !== true) {
      fail("confirmation-required", "Explicit confirmation is required to recover a stale session.");
    }
    const current = await this.inspect();
    if (current.status !== "stale") {
      this.ownership = "unknown";
      fail("not-stale", "The session is not conclusively stale. Recovery was refused.");
    }

    // Re-read immediately before the takeover. This narrows, but cannot remove,
    // the race because the Drive update path has no tested atomic precondition.
    let latest;
    try {
      latest = await this.adapter.read();
    } catch {
      this.ownership = "unknown";
      fail("ownership-unknown", "The stale session could not be rechecked. Recovery was refused.");
    }
    if (!sameRecord(latest, current.record) ||
        this.now() - latest.heartbeatAt < this.staleAfterMs ||
        latest.state !== "active") {
      this.ownership = "unknown";
      fail("ownership-unknown", "The session changed during stale-session recovery. Writes remain disabled.");
    }

    const record = this.makeRecord(String(this.createSessionId()));
    try {
      await this.adapter.write(record);
    } catch {
      this.ownership = "unknown";
      fail("ownership-unknown", "The recovery write could not be confirmed. Writes are disabled.");
    }
    await this.verifyWrittenRecord(record, "ownership-unknown");
    this.session = record;
    this.ownership = "owned";
    return record;
  }

  async heartbeat() {
    if (!this.canWrite) fail("not-owner", "This session does not own the active session record.");
    const current = await this.inspect();
    if (current.status !== "active" || current.record.sessionId !== this.session.sessionId) {
      this.ownership = "unknown";
      this.session = null;
      fail("ownership-lost", "Session ownership is no longer verified. Writes are disabled.");
    }

    const record = {
      ...this.session,
      heartbeatAt: this.now(),
      expiresAt: this.now() + this.staleAfterMs,
      releasedAt: null
    };
    try {
      await this.adapter.write(record);
    } catch {
      this.ownership = "unknown";
      this.session = null;
      fail("ownership-unknown", "The heartbeat could not be confirmed. Writes are disabled until ownership is re-established.");
    }
    await this.verifyWrittenRecord(record, "ownership-unknown");
    this.session = record;
    this.ownership = "owned";
    return record;
  }

  async assertCanWrite(options) {
    if (options && options.online === false) {
      this.ownership = "unknown";
      this.session = null;
      fail("offline", "Offline writes are prohibited. Reconnect and re-establish the session before writing.");
    }
    if (!this.canWrite) fail("not-owner", "No verified active session is held by this page.");
    const current = await this.inspect();
    if (current.status !== "active" || current.record.sessionId !== this.session.sessionId) {
      this.ownership = "unknown";
      this.session = null;
      fail("ownership-lost", "The active session could not be verified. Writes are disabled.");
    }
    return true;
  }

  withWrite(operation, options) {
    if (typeof operation !== "function") {
      return Promise.reject(new SessionCoordinationError("invalid-operation", "A write operation is required."));
    }
    const run = this.writeQueue.then(async () => {
      await this.assertCanWrite(options);
      return operation();
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async release() {
    if (!this.canWrite) fail("not-owner", "This page does not own a releasable session.");
    const current = await this.inspect();
    if (current.status !== "active" || current.record.sessionId !== this.session.sessionId) {
      this.ownership = "unknown";
      this.session = null;
      fail("ownership-lost", "The session cannot be safely released because ownership is no longer verified.");
    }

    const record = {
      ...this.session,
      state: "released",
      releasedAt: this.now()
    };
    try {
      await this.adapter.write(record);
    } catch {
      this.ownership = "unknown";
      this.session = null;
      fail("release-unconfirmed", "Session release could not be confirmed. Do not switch devices yet.");
    }
    await this.verifyWrittenRecord(record, "release-unconfirmed");
    this.session = null;
    this.ownership = "released";
    return { released: true };
  }
}
