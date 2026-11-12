import { sessionClaimDiagnostic } from "./session-claim-diagnostic.mjs";

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

function fail(code, message, sessionCheck) {
  const error = new SessionCoordinationError(code, message);
  if (sessionCheck) error.sessionCheck = sessionCheck;
  throw error;
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
    record.startedAt <= record.heartbeatAt &&
    ((record.state === "active" && record.releasedAt === null) ||
      (record.state === "released" && Number.isSafeInteger(record.releasedAt) &&
        record.releasedAt >= record.heartbeatAt))
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
    this.operationGeneration = 0;
    this.session = null;
    this.ownership = "unowned";
    this.releasing = false;
    this.writeQueue = Promise.resolve();
    this.sessionQueue = Promise.resolve();
    this.activeWrites = 0;
    this.releaseFinalizing = false;
  }

  cancelPending() {
    this.operationGeneration++;
    this.ownership = "unknown";
    this.heartbeatStop?.();
    this.adapter.cancelPending?.();
  }

  operationGuard() {
    const generation = this.operationGeneration;
    return () => {
      if (generation !== this.operationGeneration) fail("session-operation-cancelled", "Session acquisition was cancelled. Preserve the folder and marker.");
    };
  }

  get canWrite() {
    return this.ownership === "owned" && Boolean(this.session);
  }

  async inspect() {
    let record;
    try {
      record = await this.adapter.read();
    } catch (error) {
      // Preserve a safe diagnostic so the UI can distinguish Drive read,
      // malformed-marker, and authorization failures without weakening the
      // fail-closed ownership decision.
      return {
        status: "unknown",
        record: null,
        errorCode: typeof error?.code === "string" ? error.code : "session-read-failed",
        sessionCheck: sessionClaimDiagnostic(error)?.check || "coordinator-read-failed"
      };
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
    } catch (cause) {
      this.ownership = "unknown";
      fail(failureCode, "Session ownership could not be verified after the write. All writes are disabled.",
        sessionClaimDiagnostic(cause)?.check || "coordinator-read-failed");
    }
    if (!sameRecord(actual, expected)) {
      this.ownership = "unknown";
      fail(failureCode, "The session record changed or could not be verified. All writes are disabled.", "coordinator-record-changed");
    }
  }

  // Session-marker operations must serialize with each other, not with the
  // full transaction queue: a slow upload must not starve its own heartbeat.
  withSessionOperation(operation) {
    const assertCurrent = this.operationGuard();
    const run = this.sessionQueue.then(() => { assertCurrent(); return operation(); });
    this.sessionQueue = run.catch(() => undefined);
    return run;
  }

  start() {
    if (this.releasing) return Promise.reject(new SessionCoordinationError("not-owner", "Session handoff is in progress."));
    return this.withSessionOperation(() => this._start());
  }

  async _start() {
    const assertCurrent = this.operationGuard();
    if (this.releasing) fail("not-owner", "Session handoff is in progress.");
    if (this.canWrite) return this.session;
    const current = await this.inspect();
    assertCurrent();
    if (current.status === "active") fail("session-active", "Another active session is already registered. End that session before switching devices.");
    if (current.status === "stale") fail("stale-session", "A session appears stale. Automatic takeover is disabled; use the explicit stale-session recovery flow.");
    if (current.status === "ambiguous" || current.status === "unknown") {
      this.ownership = "unknown";
      if (current.errorCode === "authorization-required") {
        fail("authorization-required", "Google authorization is required to inspect the existing Drive session. Reconnect to Google; no session or stored data was changed. Writes remain disabled.");
      }
      const detail = current.errorCode ? " Drive check failed (" + current.errorCode + ")." : "";
      fail("ownership-unknown", "The existing session state cannot be trusted. Writes are disabled." + detail);
    }

    const record = this.makeRecord(String(this.createSessionId()));
    this.session = record;
    this.ownership = "unknown";
    try {
      assertCurrent();
      await this.adapter.write(record);
      assertCurrent();
    } catch (cause) {
      this.ownership = "unknown";
      assertCurrent();
      const detail = typeof cause?.code === "string" && /^[a-z][a-z0-9-]{0,95}$/.test(cause.code) ? " (" + cause.code + ")" : "";
      fail("ownership-unknown", "The session claim could not be confirmed" + detail + ". Preserve the folder and marker. Do not retry creation or switch devices.",
        sessionClaimDiagnostic(cause)?.check);
    }
    await this.verifyWrittenRecord(record, "ownership-unknown");
    assertCurrent();
    this.session = record;
    this.ownership = "owned";
    return record;
  }

  recoverStale(options) {
    if (this.releasing) return Promise.reject(new SessionCoordinationError("not-owner", "Session handoff is in progress."));
    return this.withSessionOperation(() => this._recoverStale(options));
  }

  async _recoverStale(options) {
    const assertCurrent = this.operationGuard();
    if (this.releasing) fail("not-owner", "Session handoff is in progress.");
    if (!options || options.confirm !== true) {
      fail("confirmation-required", "Explicit confirmation is required to recover a stale session.");
    }
    const current = await this.inspect();
    assertCurrent();
    if (current.status !== "stale") {
      this.ownership = "unknown";
      fail("not-stale", "The session is not conclusively stale. Recovery was refused.");
    }

    // Re-read immediately before the takeover. This narrows, but cannot remove,
    // the race because the Drive update path has no tested atomic precondition.
    let latest;
    try {
      latest = await this.adapter.read();
      assertCurrent();
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
    this.session = record;
    this.ownership = "unknown";
    try {
      assertCurrent();
      await this.adapter.write(record);
      assertCurrent();
    } catch {
      this.ownership = "unknown";
      fail("ownership-unknown", "The recovery write could not be confirmed. Writes are disabled.");
    }
    await this.verifyWrittenRecord(record, "ownership-unknown");
    assertCurrent();
    this.session = record;
    this.ownership = "owned";
    return record;
  }

  resume() {
    if (this.releasing) return Promise.reject(new SessionCoordinationError("not-owner", "Session handoff is in progress."));
    return this.withSessionOperation(() => this._resume());
  }

  async _resume() {
    const assertCurrent = this.operationGuard();
    if (this.releasing) fail("not-owner", "Session handoff is in progress.");
    if (!this.session) fail("no-session-context", "This page has no prior session identity to revalidate.");
    const expectedSessionId = this.session.sessionId;
    const current = await this.inspect();
    assertCurrent();
    if (current.status === "active" && current.record.sessionId === expectedSessionId) {
      this.session = current.record;
      this.ownership = "owned";
      return this.session;
    }
    if (current.status === "stale" && current.record.sessionId === expectedSessionId) {
      this.ownership = "unknown";
      fail("stale-session", "This session's heartbeat expired. Use explicit stale-session recovery before writing.");
    }
    if (current.status === "released" && current.record.sessionId === expectedSessionId) {
      this.session = null;
      this.ownership = "released";
      fail("session-released", "This session has already been released.");
    }
    if (current.status === "unknown" && current.errorCode === "authorization-required") {
      this.ownership = "unknown";
      fail("authorization-required", "Google authorization is required to revalidate this Drive session. Reconnect to Google; the existing session and stored data were not changed. Writes remain disabled.");
    }
    this.ownership = "unknown";
    fail("ownership-lost", "The prior session identity could not be revalidated. Writes remain disabled.", current.sessionCheck || "coordinator-record-changed");
  }

  async heartbeat() {
    return this.withSessionOperation(async () => {
      if (!this.canWrite || this.releaseFinalizing) fail("not-owner", "This session does not own an available active session record.");
      const current = await this.inspect();
      if (current.status !== "active" || current.record.sessionId !== this.session.sessionId) {
        this.ownership = "unknown";
        fail("ownership-lost", "Session ownership is no longer verified. Writes are disabled.", current.sessionCheck || "coordinator-record-changed");
      }

      if (!this.canWrite) fail("ownership-unknown", "Ownership was lost while checking the heartbeat.");
      const heartbeatAt = this.now();
      const record = {
        ...this.session,
        heartbeatAt,
        expiresAt: heartbeatAt + this.staleAfterMs,
        releasedAt: null
      };
      try {
        await this.adapter.write(record);
      } catch {
        this.ownership = "unknown";
        fail("ownership-unknown", "The heartbeat could not be confirmed. Writes are disabled until ownership is re-established.");
      }
      await this.verifyWrittenRecord(record, "ownership-unknown");
      if (!this.canWrite) fail("ownership-unknown", "Ownership was lost while verifying the heartbeat.");
      this.session = record;
      return record;
    });
  }

  startHeartbeat(options) {
    const settings = options || {};
    const intervalMs = Number(settings.intervalMs || Math.floor(this.staleAfterMs / 3));
    if (!this.canWrite || this.releasing) fail("not-owner", "Acquire a verified session before starting heartbeats.");
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs >= this.staleAfterMs) {
      fail("invalid-timing", "The heartbeat interval must be positive and shorter than the session expiry window.");
    }
    if (this.heartbeatStop) this.heartbeatStop();
    const setIntervalImpl = settings.setIntervalImpl || globalThis.setInterval;
    const clearIntervalImpl = settings.clearIntervalImpl || globalThis.clearInterval;
    const isOnline = settings.isOnline || (() =>
      typeof globalThis.navigator === "undefined" || globalThis.navigator.onLine !== false);
    const onError = typeof settings.onError === "function" ? settings.onError : () => {};
    if (typeof setIntervalImpl !== "function" || typeof clearIntervalImpl !== "function") {
      fail("timer-unavailable", "Heartbeat scheduling is unavailable.");
    }
    let stopped = false;
    const timer = setIntervalImpl(async () => {
      if (stopped) return;
      if (!isOnline()) {
        this.ownership = "unknown";
        stopped = true;
        clearIntervalImpl(timer);
        this.heartbeatStop = null;
        onError(new SessionCoordinationError("offline", "The page went offline. Writes are disabled."));
        return;
      }
      try {
        await this.heartbeat();
      } catch (error) {
        // A tick already queued when orderly release stopped the timer must
        // not overwrite the successful released status with a late error.
        if (stopped) return;
        stopped = true;
        clearIntervalImpl(timer);
        this.heartbeatStop = null;
        onError(error);
      }
    }, intervalMs);
    this.heartbeatStop = () => {
      if (stopped) return;
      stopped = true;
      clearIntervalImpl(timer);
      this.heartbeatStop = null;
    };
    return this.heartbeatStop;
  }

  async assertCanWrite(options) {
    // Offline invalidation must remain immediate, including during an in-flight
    // heartbeat. Online inspections share the marker queue so our own heartbeat
    // cannot change the metadata bracket of an admitted write guard.
    if (options?.online === false) return this._assertCanWrite(options);
    return this.withSessionOperation(() => this._assertCanWrite(options));
  }

  async _assertCanWrite(options) {
    if (options && options.online === false) {
      this.ownership = "unknown";
      fail("offline", "Offline writes are prohibited. Reconnect and re-establish the session before writing.");
    }
    if (!this.canWrite || this.releaseFinalizing || (this.releasing && this.activeWrites === 0)) {
      fail("not-owner", "No verified active session is available to this page.");
    }
    const current = await this.inspect();
    if (!this.canWrite || current.status !== "active" || current.record.sessionId !== this.session.sessionId) {
      this.ownership = "unknown";
      fail("ownership-lost", "The active session could not be verified. Writes are disabled.", current.sessionCheck || "coordinator-record-changed");
    }
    return true;
  }

  withWrite(operation, options) {
    if (this.releasing) {
      return Promise.reject(new SessionCoordinationError("not-owner", "Session handoff is in progress; new writes are disabled."));
    }
    if (typeof operation !== "function") {
      return Promise.reject(new SessionCoordinationError("invalid-operation", "A write operation is required."));
    }
    const run = this.writeQueue.then(async () => {
      this.activeWrites++;
      try {
        await this.assertCanWrite(options);
        return await operation();
      } finally {
        this.activeWrites--;
      }
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async release({ beforeRelease = () => {} } = {}) {
    if (typeof beforeRelease !== "function") fail("invalid-operation", "A release verification callback is required.");
    if (!this.canWrite || this.releasing) fail("not-owner", "This page does not own a releasable session.");
    // Close admission, but keep admitted transaction guards and heartbeats
    // alive until the transaction queue has drained.
    this.releasing = true;
    try {
      await this.writeQueue;
      return await this.withSessionOperation(async () => {
        await beforeRelease();
        this.releaseFinalizing = true;
        const current = await this.inspect();
        if (!this.canWrite || current.status !== "active" || current.record.sessionId !== this.session.sessionId) {
          this.ownership = "unknown";
          fail("ownership-lost", "The session cannot be safely released because ownership is no longer verified.", current.sessionCheck || "coordinator-record-changed");
        }
        if (this.heartbeatStop) this.heartbeatStop();
        const record = {
          ...this.session,
          state: "released",
          releasedAt: this.now()
        };
        try {
          await this.adapter.write(record);
        } catch {
          this.ownership = "unknown";
          fail("release-unconfirmed", "Session release could not be confirmed. Do not switch devices yet.");
        }
        await this.verifyWrittenRecord(record, "release-unconfirmed");
        this.session = null;
        this.ownership = "released";
        return { released: true };
      });
    } finally {
      this.releasing = false;
      this.releaseFinalizing = false;
    }
  }
}
