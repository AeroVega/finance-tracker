import { GoogleDriveTransactionAdapter, DriveTransactionEngine } from "./drive-transaction-engine.mjs";
import { createDriveSessionAdapter } from "./drive-session-adapter.mjs";
import { SessionCoordinator } from "./session-coordination.mjs";
import { CatalogTransactionEngine } from "./catalog-transaction-engine.mjs";
import { verifyCatalogHistory } from "./catalog-storage.mjs";
import { resolveSnapshotLocators } from "./drive-locator-catalog.mjs";

export class ApplicationStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApplicationStorageError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ApplicationStorageError(code, message);
}

async function sha256(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) fail("crypto-unavailable", "SHA-256 verification is unavailable.");
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Application-level lifecycle boundary for synthetic Drive integration.
 *
 * This controller deliberately refuses non-synthetic folders. It composes the
 * already-tested session coordinator and transaction engine; it does not
 * initialize a production database or authorize real financial-data storage.
 */
export class ApplicationStorageLifecycle {
  constructor(options = {}) {
    const {
      syntheticOnly = false, folderName = "", folderId, manifestFileId,
      initializeManifest, accessToken, makeManifest, fetchImpl = globalThis.fetch,
      cryptoImpl = globalThis.crypto, isOnline = () => globalThis.navigator?.onLine !== false,
      onStatus = () => {}, onDiagnostic = () => {}, lifecycleTarget = globalThis,
      setIntervalImpl = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval,
      factories = {}, catalogProtocol = false, afterMutation = null
    } = options;

    if (syntheticOnly !== true || !/synthetic/i.test(folderName)) {
      fail("synthetic-folder-required", "Application storage integration is restricted to a dedicated synthetic Drive folder.");
    }
    if (!folderId || (!manifestFileId && typeof initializeManifest !== "function") ||
        typeof accessToken !== "function" || typeof makeManifest !== "function" || typeof fetchImpl !== "function") {
      fail("invalid-config", "A verified synthetic folder, manifest ID or session-gated manifest initializer, access-token provider, and manifest builder are required.");
    }

    this.folderName = folderName;
    this.folderId = folderId;
    this.manifestFileId = manifestFileId || null;
    this.initializeManifest = initializeManifest || null;
    this.accessToken = accessToken;
    this.makeManifest = makeManifest;
    this.fetchImpl = fetchImpl;
    this.crypto = cryptoImpl;
    this.isOnline = isOnline;
    this.onStatus = onStatus;
    this.onDiagnostic = onDiagnostic;
    this.releasePending = false;
    this.lifecycleTarget = lifecycleTarget;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.factories = factories;
    this.catalogProtocol = catalogProtocol;
    this.afterMutation = afterMutation;
    this.state = "disconnected";
    this.sessionAdapter = null;
    this.coordinator = null;
    this.transactionAdapter = null;
    this.engine = null;
    this.heartbeatStop = null;
    this.started = false;
    this.listenersAttached = false;
    this.acceptingWrites = false;
    this._onOffline = () => this.handleOffline();
    this._onOnline = () => { void this.handleOnline(); };
    this._onPageHide = (event) => {
      this.diagnostic("pagehide", { isTrusted: event?.isTrusted === true, persisted: event?.persisted === true,
        visibility: this.lifecycleTarget?.document?.visibilityState });
      void this.release({ reason: "pagehide" }).catch(() => {});
    };
  }

  diagnostic(event, details = {}) {
    // Diagnostic observers must never affect ownership or transaction behavior.
    try { this.onDiagnostic({ event, state: this.state, ...details }); } catch { /* observational only */ }
  }

  publish(state, message, code = null) {
    this.state = state;
    this.onStatus({ state, message, code });
  }

  createComponents() {
    this.sessionAdapter = (this.factories.createSessionAdapter || createDriveSessionAdapter)({
      accessToken: () => this.accessToken(),
      folderId: this.folderId,
      fetchImpl: this.fetchImpl
    });
    this.coordinator = (this.factories.createCoordinator || ((options) => new SessionCoordinator(options)))({ adapter: this.sessionAdapter });
    this.transactionAdapter = (this.factories.createTransactionAdapter || ((options) => new GoogleDriveTransactionAdapter(options)))({
      accessToken: this.accessToken,
      folderId: this.folderId,
      fetchImpl: this.fetchImpl,
      afterMutation: this.afterMutation,
      cryptoImpl: this.crypto
    });
    this.engine = (this.factories.createEngine || ((options) => new (this.catalogProtocol ? CatalogTransactionEngine : DriveTransactionEngine)(options)))({
      adapter: this.transactionAdapter,
      cryptoImpl: this.crypto,
      isOnline: this.isOnline,
      assertWritable: () => this.coordinator.assertCanWrite({ online: this.isOnline() })
    });
  }

  attachLifecycleListeners() {
    if (this.listenersAttached || !this.lifecycleTarget?.addEventListener) return;
    this.lifecycleTarget.addEventListener("offline", this._onOffline);
    this.lifecycleTarget.addEventListener("online", this._onOnline);
    this.lifecycleTarget.addEventListener("pagehide", this._onPageHide);
    this.listenersAttached = true;
  }

  detachLifecycleListeners() {
    if (!this.listenersAttached || !this.lifecycleTarget?.removeEventListener) return;
    this.lifecycleTarget.removeEventListener("offline", this._onOffline);
    this.lifecycleTarget.removeEventListener("online", this._onOnline);
    this.lifecycleTarget.removeEventListener("pagehide", this._onPageHide);
    this.listenersAttached = false;
  }

  startHeartbeat() {
    this.heartbeatStop?.();
    this.heartbeatStop = this.coordinator.startHeartbeat({
      setIntervalImpl: this.setIntervalImpl,
      clearIntervalImpl: this.clearIntervalImpl,
      isOnline: this.isOnline,
      onError: (error) => {
        this.acceptingWrites = false;
        this.heartbeatStop = null;
        this.publish("ownership-unknown", "Connection could not be verified. Writes are paused.", error?.code || "ownership-unknown");
      }
    });
  }

  async recoverBeforeUse() {
    this.acceptingWrites = false;
    this.publish("recovering", "Checking Drive transaction state…");
    const result = await this.coordinator.withWrite(async () => {
      const recovered = await this.engine.recover({
        manifestFileId: this.manifestFileId,
        makeManifest: this.makeManifest
      });
      await this.coordinator.assertCanWrite({ online: this.isOnline() });
      return recovered;
    });
    if (!this.releasePending) {
      this.acceptingWrites = true;
      this.publish("ready", "Connected and synchronized.");
    }
    return result;
  }

  async start() {
    if (this.releasePending) fail("release-unconfirmed", "Session handoff is still in progress.");
    if (this.started && this.state === "ready") return;
    if (!this.isOnline()) fail("offline", "Connect to the internet before opening the database.");
    this.publish("connecting", "Connecting to private storage…");
    if (!this.coordinator) this.createComponents();
    let acquired = false;
    try {
      await this.coordinator.start();
      acquired = true;
      this.startHeartbeat();
      if (!this.manifestFileId && this.initializeManifest) {
        this.manifestFileId = await this.coordinator.withWrite(() =>
          this.initializeManifest({ adapter: this.transactionAdapter, folderId: this.folderId,
            guard: () => this.coordinator.assertCanWrite({ online: this.isOnline() }) })
        );
      }
      if (!this.manifestFileId) fail("manifest-unavailable", "A verified synthetic manifest is required before recovery.");
      await this.recoverBeforeUse();
      this.startHeartbeat();
      this.attachLifecycleListeners();
      this.started = true;
    } catch (error) {
      this.acceptingWrites = false;
      if (acquired || this.coordinator?.canWrite) {
        this.started = true;
        if (this.coordinator?.canWrite) this.startHeartbeat();
        this.attachLifecycleListeners();
      }
      const state = error?.code === "stale-session" ? "stale-session" :
        error?.code === "session-active" ? "session-active" :
        this.coordinator?.canWrite || this.engine?.recoveryRequired ? "recovery-required" :
        acquired ? "ownership-unknown" : "connection-error";
      this.publish(state, error?.message || "Storage connection could not be verified.", error?.code || "unknown");
      throw error;
    }
  }

  async recoverStaleSession({ confirm = false } = {}) {
    if (this.releasePending) fail("release-unconfirmed", "Session handoff is still in progress.");
    if (!this.coordinator) this.createComponents();
    if (!this.isOnline()) fail("offline", "Reconnect before recovering a stale session.");
    this.publish("recovering-session", "Verifying stale session…");
    try {
      await this.coordinator.recoverStale({ confirm });
      this.startHeartbeat();
      if (!this.manifestFileId && this.initializeManifest) {
        this.manifestFileId = await this.coordinator.withWrite(() =>
          this.initializeManifest({ adapter: this.transactionAdapter, folderId: this.folderId,
            guard: () => this.coordinator.assertCanWrite({ online: this.isOnline() }) })
        );
      }
      if (!this.manifestFileId) fail("manifest-unavailable", "A verified synthetic manifest is required before recovery.");
      await this.recoverBeforeUse();
      this.startHeartbeat();
      this.attachLifecycleListeners();
      this.started = true;
    } catch (error) {
      this.acceptingWrites = false;
      if (this.coordinator?.canWrite) {
        this.started = true;
        this.startHeartbeat();
        this.attachLifecycleListeners();
        this.publish("recovery-required", error?.message || "Session was acquired, but transaction recovery is unresolved.", error?.code || "recovery-required");
      } else {
        this.publish("connection-error", error?.message || "Session recovery could not be verified.", error?.code || "unknown");
      }
      throw error;
    }
  }

  async handleOffline() {
    this.acceptingWrites = false;
    this.heartbeatStop?.();
    this.heartbeatStop = null;
    if (this.coordinator?.canWrite) {
      try { await this.coordinator.assertCanWrite({ online: false }); } catch { /* fail-closed state is set by coordinator */ }
    }
    this.publish("offline", "Offline. Changes are not being saved.");
  }

  async handleOnline() {
    if (this.releasePending || !this.started || !this.coordinator?.session) return;
    this.acceptingWrites = false;
    this.publish("reconnecting", "Rechecking the existing session…");
    try {
      await this.coordinator.resume();
      this.startHeartbeat();
      await this.recoverBeforeUse();
      this.startHeartbeat();
    } catch (error) {
      this.acceptingWrites = false;
      if (this.coordinator?.canWrite && this.engine?.recoveryRequired) {
        this.startHeartbeat();
        this.publish("recovery-required", error?.message || "Transaction recovery remains unresolved.", error?.code || "recovery-required");
      } else {
        const state = error?.code === "stale-session" ? "stale-session" : "ownership-unknown";
        this.publish(state, error?.message || "The previous session could not be revalidated.", error?.code || "unknown");
      }
    }
  }

  async readManifest() {
    try {
      await this.requireReady();
      const manifest = await this.transactionAdapter.readJson(this.manifestFileId);
      if (this.catalogProtocol) {
        if (manifest.catalogFinalizationPending !== null) fail("recovery-required", "Catalog finalization must complete before reading application state.");
        await verifyCatalogHistory(this.transactionAdapter, manifest, this.crypto);
      }
      return manifest;
    } catch (error) { this.pauseAfterReadFailure(error); throw error; }
  }

  async readObject(logicalPath) {
    try { return await this.readObjectVerified(logicalPath); }
    catch (error) { this.pauseAfterReadFailure(error); throw error; }
  }

  pauseAfterReadFailure(error) {
    this.acceptingWrites = false;
    if (this.engine) this.engine.recoveryRequired = true;
    this.publish(error?.code === "authorization-required" ? "authorization-required" : "recovery-required",
      "Storage could not be verified. Reconnect and recover before continuing.", error?.code || "read-unverified");
  }

  async readObjectVerified(logicalPath) {
    await this.requireReady();
    if (typeof logicalPath !== "string" || !logicalPath) fail("invalid-path", "A logical object path is required.");
    const manifest = await this.transactionAdapter.readJson(this.manifestFileId);
    if (this.catalogProtocol && manifest.catalogFinalizationPending !== null) fail("recovery-required", "Finish catalog recovery before reading objects.");
    const reference = this.catalogProtocol
      ? resolveSnapshotLocators(manifest.snapshot, (await verifyCatalogHistory(this.transactionAdapter, manifest, this.crypto)).catalog)[logicalPath]
      : manifest.snapshot?.[logicalPath];
    if (!reference?.fileId || !/^[0-9a-f]{64}$/.test(String(reference.sha256 || ""))) {
      fail("object-not-found", "The requested object is not present in the verified manifest.");
    }
    const metadata = await this.transactionAdapter.readMetadata(reference.fileId);
    if (metadata.appProperties?.financeTrackerHash !== reference.sha256) {
      fail("object-metadata-mismatch", "The requested object does not match its manifest reference.");
    }
    const bytes = await this.transactionAdapter.readBytes(reference.fileId);
    if (await sha256(bytes, this.crypto) !== reference.sha256) {
      fail("object-integrity-failure", "The requested object failed SHA-256 verification.");
    }
    return bytes;
  }

  async requireReady() {
    if (!this.started || !this.acceptingWrites || this.state !== "ready") {
      fail("storage-not-ready", "Private storage is not in a verified ready state.");
    }
    await this.coordinator.assertCanWrite({ online: this.isOnline() });
  }

  async transact(transaction) {
    await this.requireReady();
    try {
      const result = await this.coordinator.withWrite(() => this.engine.transact(transaction));
      // A committed transaction is not proof that ownership survived its final
      // read-back. Preserve a concurrent heartbeat/offline failure status.
      if (!this.releasePending && this.acceptingWrites && this.coordinator.canWrite && this.isOnline()) {
        this.publish("ready", "Changes synchronized.");
      }
      return result;
    } catch (error) {
      if (error?.code === "transaction-unresolved" || this.engine.recoveryRequired) {
        this.acceptingWrites = false;
        this.publish("recovery-required", "A save needs recovery before more changes can be made.", error?.code || "recovery-required");
      } else if (error?.code === "offline" || error?.code === "ownership-lost" || error?.code === "ownership-unknown") {
        this.acceptingWrites = false;
        this.publish("ownership-unknown", "Connection could not be verified. Writes are paused.", error.code);
      }
      throw error;
    }
  }

  async recover() {
    if (this.releasePending) fail("release-unconfirmed", "Session handoff is still in progress.");
    if (!this.coordinator?.canWrite || !this.isOnline()) fail("storage-not-ready", "A verified online session is required for recovery.");
    this.acceptingWrites = false;
    this.publish("recovering", "Recovering the last transaction…");
    try {
      if (!this.manifestFileId && this.initializeManifest) {
        this.manifestFileId = await this.coordinator.withWrite(() =>
          this.initializeManifest({ adapter: this.transactionAdapter, folderId: this.folderId,
            guard: () => this.coordinator.assertCanWrite({ online: this.isOnline() }) })
        );
      }
      if (!this.manifestFileId) fail("manifest-unavailable", "A verified synthetic manifest is required before recovery.");
      const result = await this.coordinator.withWrite(async () => {
        const recovered = await this.engine.recover({ manifestFileId: this.manifestFileId, makeManifest: this.makeManifest });
        await this.coordinator.assertCanWrite({ online: this.isOnline() });
        return recovered;
      });
      if (!this.releasePending) {
        this.acceptingWrites = true;
        this.publish("ready", "Recovery verified. Storage is ready.");
      }
      return result;
    } catch (error) {
      this.publish("recovery-required", "Recovery remains unresolved. No further writes are allowed.", error?.code || "recovery-required");
      throw error;
    }
  }

  async release({ reason = "handoff" } = {}) {
    this.diagnostic("release-request", { reason });
    const requireResolved = () => {
      if (this.state === "recovery-required" || this.engine?.recoveryRequired) {
        fail("recovery-required", "Storage ownership cannot be released while a transaction is unresolved. Recover and verify the transaction before handing off this device.");
      }
    };
    try {
      requireResolved();
      if (this.releasePending || !this.coordinator?.canWrite) {
        fail("release-unconfirmed", "This page cannot verify an available session for handoff. Reconnect and recover before switching devices.");
      }
    } catch (error) {
      this.diagnostic("release-refused", { reason });
      throw error;
    }
    this.releasePending = true;
    this.acceptingWrites = false;
    this.publish("releasing", "Finishing storage handoff…");
    try {
      // Keep renewal alive while admitted writes drain. Recheck their outcome
      // before relinquishing ownership: a save may fail during this wait.
      const result = await this.coordinator.release({ beforeRelease: requireResolved });
      this.heartbeatStop?.();
      this.heartbeatStop = null;
      this.detachLifecycleListeners();
      this.started = false;
      this.publish("released", "Storage session released.");
      this.diagnostic("release-complete", { reason });
      return { ...result, reason };
    } catch (error) {
      if (this.engine?.recoveryRequired || error?.code === "recovery-required") {
        this.publish("recovery-required", "A save needs recovery before more changes can be made.", "recovery-required");
      } else {
        this.publish("release-unconfirmed", "Session release could not be verified. Do not switch devices yet.", error?.code || "release-unconfirmed");
      }
      this.diagnostic("release-refused", { reason });
      throw error;
    } finally {
      this.releasePending = false;
    }
  }
}
