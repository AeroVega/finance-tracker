import { createDiagnostic, diagnosticMessage } from './app-diagnostics.mjs';
import {PagedApplicationStorage,isObsoletePagedVerificationFailure,currentPagedVerificationFailure} from './paged-application-storage.mjs';
import { GoogleDriveTransactionAdapter, DriveTransactionEngine } from "./drive-transaction-engine.mjs";
import { createDriveSessionAdapter } from "./drive-session-adapter.mjs";
import { SessionCoordinator } from "./session-coordination.mjs";
import { CatalogTransactionEngine } from "./catalog-transaction-engine.mjs";
import { verifyCatalogHistory } from "./catalog-storage.mjs";
import { resolveSnapshotLocators } from "./drive-locator-catalog.mjs";
import { canonicalizeJcs } from "./transaction-protocol.mjs";
import { createDriveRequestMetrics } from "./drive-request-metrics.mjs";

export class ApplicationStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApplicationStorageError";
    this.code = code;
  }
}

// Internal control flow keeps its existing code semantics; presentation is
// independently allowlisted by publish(). A hostile getter must not skip cleanup.
function failureCode(error) {
  try { const code = error?.code; return typeof code === 'string' ? code : undefined; } catch { return undefined; }
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
      factories = {}, catalogProtocol = false, pagedCanonical = false, verificationPlans, adapterOptions = {}, afterMutation = null
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
    this.requestMetrics = createDriveRequestMetrics();
    // Both adapters share this one wrapper. Count actual fetch attempts once,
    // including session checks, retries and requests that reject before headers.
    this.fetchImpl = this.requestMetrics.wrapFetch(fetchImpl);
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
    this.pagedCanonical = pagedCanonical;
    this.verificationPlans = verificationPlans;
    this.adapterOptions = adapterOptions;
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
      if (!this.coordinator?.canWrite) this.coordinator?.cancelPending?.();
      void this.release({ reason: "pagehide" }).catch(() => {});
    };
  }

  diagnostic(event, details = {}) {
    // Diagnostic observers must never affect ownership or transaction behavior.
    try { this.onDiagnostic({ event, state: this.state, ...details }); } catch { /* observational only */ }
  }

  publish(state, message, code = null) {
    if (state !== "ready") {
      this.engine?.invalidateHistory?.();
      this.sessionAdapter?.clear?.();
    }
    this.state = state;
    const safe = code ? createDiagnostic({code}) : null;
    this.onStatus({ state, message: safe ? diagnosticMessage({code: safe.code}) : message, code: safe?.code || null });
  }

  createComponents() {
    this.sessionAdapter = (this.factories.createSessionAdapter || createDriveSessionAdapter)({
      accessToken: () => this.accessToken(),
      folderId: this.folderId,
      fetchImpl: this.fetchImpl
    });
    this.coordinator = (this.factories.createCoordinator || ((options) => new SessionCoordinator(options)))({ adapter: this.sessionAdapter });
    const transactionAdapter = (this.factories.createTransactionAdapter || ((options) => new GoogleDriveTransactionAdapter(options)))({
      ...this.adapterOptions,
      accessToken: this.accessToken,
      folderId: this.folderId,
      fetchImpl: this.fetchImpl,
      afterMutation: this.afterMutation,
      cryptoImpl: this.crypto,
      ...(this.pagedCanonical?{captureMutationGuard:()=>{
        const engine=this.engine,generation=engine?.verificationGeneration?.(),coordinator=this.coordinator,
          sessionId=coordinator?.session?.sessionId,folderId=this.folderId,assertEngine=engine?.captureMutationGuard?.();
        return ()=>{
          const online=this.isOnline();
          if(this.transactionAdapter!==transactionAdapter||this.engine!==engine||this.coordinator!==coordinator||this.folderId!==folderId||transactionAdapter.folderId!==folderId||
            coordinator?.session?.sessionId!==sessionId||!coordinator?.canWrite||this.releasePending||!online)
            fail("verification-scope-closed","Mutation lifetime or ownership changed before dispatch.");
          engine?.assertVerificationGeneration?.(generation);assertEngine?.();
        };
      },
      onExpiredMutation:error=>{
        if(this.transactionAdapter!==transactionAdapter)return;
        // Unlike an obsolete read, a dispatched write can change this copy.
        this.engine.recoveryRequired=true;
        if(this.state!=="recovery-required"||this.acceptingWrites)this.pauseAfterReadFailure(error);
      }}:{})
    });
    this.transactionAdapter=transactionAdapter;
    this.engine = (this.factories.createEngine || ((options) => new (this.pagedCanonical ? PagedApplicationStorage : this.catalogProtocol ? CatalogTransactionEngine : DriveTransactionEngine)(options)))({
      adapter: this.transactionAdapter,
      verificationPlans: this.verificationPlans,
      onReadFailure: error => this.pauseAfterReadFailure(error),
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
        this.publish("ownership-unknown", "Connection could not be verified. Writes are paused.", failureCode(error) || "ownership-unknown");
      }
    });
  }

  async recoverBeforeUse() {
    this.transactionAdapter?.assertMutationsSettled?.();
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
    this.attachLifecycleListeners();
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
      const state = !this.isOnline() ? "offline" : failureCode(error) === "stale-session" ? "stale-session" :
        failureCode(error) === "session-active" ? "session-active" :
        this.coordinator?.canWrite || this.engine?.recoveryRequired ? "recovery-required" :
        acquired ? "ownership-unknown" : "connection-error";
      this.publish(state, "Storage connection could not be verified.", failureCode(error) || "unknown");
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
        this.publish("recovery-required", "Session was acquired, but transaction recovery is unresolved.", failureCode(error) || "recovery-required");
      } else {
        this.publish("connection-error", "Session recovery could not be verified.", failureCode(error) || "unknown");
      }
      throw error;
    }
  }

  async handleOffline() {
    this.coordinator?.cancelPending?.();
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
        this.publish("recovery-required", "Transaction recovery remains unresolved.", failureCode(error) || "recovery-required");
      } else {
        const state = failureCode(error) === "stale-session" ? "stale-session" : "ownership-unknown";
        this.publish(state, "The previous session could not be revalidated.", failureCode(error) || "unknown");
      }
    }
  }

  async verifyHistory(manifest) {
    // The catalog engine owns private session evidence; legacy/custom engines
    // without it retain the complete remote verification path.
    return this.engine?.verifyHistory ? this.engine.verifyHistory(manifest)
      : verifyCatalogHistory(this.transactionAdapter, manifest, this.crypto);
  }

  async readPartitionedSnapshot() {
    const engine=this.engine,generation=engine?.verificationGeneration?.();
    try { await this.requireReady();engine?.assertVerificationGeneration?.(generation);
      if (!this.pagedCanonical) fail("paged-required", "This copy does not use canonical v4.");
      const snapshot=await engine.readSnapshot();engine.assertSnapshotCurrent(snapshot);return snapshot;
    } catch (error) { if(!isObsoletePagedVerificationFailure(error))this.pauseAfterReadFailure(error); throw error; }
  }

  async savePartitionedRoot(input) {
    if (!this.pagedCanonical) fail("paged-required", "This copy does not use canonical v4.");
    return this.transact(input);
  }

  async readManifest() {
    const engine=this.engine,generation=engine?.verificationGeneration?.();
    try {
      await this.requireReady();engine?.assertVerificationGeneration?.(generation);
      const manifest = this.pagedCanonical ? JSON.parse(new TextDecoder().decode(await this.engine.readManifest())) : await this.transactionAdapter.readJson(this.manifestFileId, { kind: "manifest" });
      if (this.pagedCanonical) {
        if (manifest.pending !== null) fail("recovery-required", "Finish root publication before reading.");
      } else if (this.catalogProtocol) {
        if (manifest.catalogFinalizationPending !== null) fail("recovery-required", "Catalog finalization must complete before reading application state.");
        await this.verifyHistory(manifest);
      }
      engine?.assertVerificationGeneration?.(generation);return manifest;
    } catch (error) { if(!isObsoletePagedVerificationFailure(error))this.pauseAfterReadFailure(error); throw error; }
  }

  // Changed-save preflight only. The transaction engine still verifies full
  // retained history before writing; this is not a replacement snapshot reader.
  async assertCurrentManifest(expectedManifest) {
    let closure;
    const engine=this.engine,generation=engine?.verificationGeneration?.();
    try {
      await this.requireReady();engine?.assertVerificationGeneration?.(generation);
      const current = this.pagedCanonical ? JSON.parse(new TextDecoder().decode(await this.engine.readManifest())) : await this.transactionAdapter.readJson(this.manifestFileId, { kind: "manifest" });
      if (this.pagedCanonical) {
        engine.assertVerificationGeneration(generation);
        closure=await this.engine.finishSnapshot();engine.assertVerificationGeneration(generation);
        const after = JSON.parse(new TextDecoder().decode(await this.engine.readManifest()));engine.assertVerificationGeneration(generation);
        if (canonicalizeJcs(after) !== canonicalizeJcs(current)) fail("base-conflict", "Root changed while physical evidence was being checked.");
      }
      if (canonicalizeJcs(current) !== canonicalizeJcs(expectedManifest)) fail("base-conflict", "Storage changed. Reopen before continuing.");
      await this.requireReady();
      if(this.pagedCanonical){engine.assertVerificationGeneration(generation);this.engine.completeSnapshot(closure,current);}
      return current;
    } catch (error) {
      const outdated=isObsoletePagedVerificationFailure(error);
      if(this.pagedCanonical)this.engine.discardSnapshot(closure,generation);
      if (failureCode(error) !== "base-conflict"&&!outdated) this.pauseAfterReadFailure(error);
      throw error;
    }
  }

  async readObject(logicalPath) {
    try { return await this.readObjectVerified(logicalPath); }
    catch (error) { this.pauseAfterReadFailure(error); throw error; }
  }

  /** One verified, pinned snapshot; fresh metadata gates any private byte reuse. */
  async readVerifiedSnapshot() {
    try {
      await this.requireReady();
      if (!this.catalogProtocol) fail("catalog-required", "A verified snapshot requires the version-2 catalog protocol.");
      const manifest = await this.transactionAdapter.readJson(this.manifestFileId, { kind: "manifest" });
      if (manifest.catalogFinalizationPending !== null) fail("recovery-required", "Complete catalog finalization before reading a snapshot.");
      const verified = await this.verifyHistory(manifest);
      // This validates every selected logical path and its catalog binding.
      const references = resolveSnapshotLocators(manifest.snapshot, verified.catalog);
      const objects = Object.create(null);
      for (const path of Object.keys(references)) {
        const bytes = verified.objects.get("data-object:" + manifest.snapshot[path]);
        if (!(bytes instanceof Uint8Array)) fail("object-not-found", "A selected snapshot object was not verified.");
        objects[path] = bytes.slice();
      }
      const current = await this.transactionAdapter.readJson(this.manifestFileId, { kind: "manifest" });
      if (canonicalizeJcs(current) !== canonicalizeJcs(manifest)) fail("base-conflict", "Storage changed while the snapshot was being verified. Reopen before continuing.");
      await this.requireReady();
      return { manifest: structuredClone(manifest), objects };
    } catch (error) { if(!isObsoletePagedVerificationFailure(error))this.pauseAfterReadFailure(error); throw error; }
  }

  pauseAfterReadFailure(error) {
    this.acceptingWrites = false;
    if (this.engine) this.engine.recoveryRequired = true;
    this.publish(failureCode(error) === "authorization-required" ? "authorization-required" : "recovery-required",
      "Storage could not be verified. Reconnect and recover before continuing.", failureCode(error) || "read-unverified");
  }

  async readObjectVerified(logicalPath) {
    await this.requireReady();
    if (typeof logicalPath !== "string" || !logicalPath) fail("invalid-path", "A logical object path is required.");
    const manifest = await this.transactionAdapter.readJson(this.manifestFileId, { kind: "manifest" });
    if (this.catalogProtocol && manifest.catalogFinalizationPending !== null) fail("recovery-required", "Finish catalog recovery before reading objects.");
    const reference = this.catalogProtocol
      ? resolveSnapshotLocators(manifest.snapshot, (await this.verifyHistory(manifest)).catalog)[logicalPath]
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
    const engine=this.engine,generation=engine?.verificationGeneration?.();
    try {
      if(this.pagedCanonical)this.transactionAdapter?.assertNoExpiredMutation?.();
      if (!this.started || !this.acceptingWrites || this.state !== "ready") {
        fail("storage-not-ready", "Private storage is not in a verified ready state.");
      }
      await this.coordinator.assertCanWrite({ online: this.isOnline() });
      engine?.assertVerificationGeneration?.(generation);
      if(!this.started||!this.acceptingWrites||this.state!=="ready")fail("storage-not-ready","Storage readiness changed during ownership verification.");
    } catch (error) {
      engine?.assertVerificationGeneration?.(generation);
      this.engine?.invalidateHistory?.();
      this.sessionAdapter?.clear?.();
      throw engine?.verificationFailure?.(error)??currentPagedVerificationFailure(error);
    }
  }

  async transact(transaction) {
    if(this.pagedCanonical)transaction={...transaction,expectedBase:structuredClone(transaction.expectedBase)};
    const engine=this.engine,generation=engine?.verificationGeneration?.();
    await this.requireReady();engine?.assertVerificationGeneration?.(generation);
    let result,handedOff=false;
    try {
      result = await this.coordinator.withWrite(() => {
        engine?.assertVerificationGeneration?.(generation);handedOff=true;return engine.transact(transaction);
      });
      if(this.pagedCanonical)engine.assertTransactionCurrent(result);
      // A committed transaction is not proof that ownership survived its final
      // read-back. Preserve a concurrent heartbeat/offline failure status.
      if (!this.releasePending && this.acceptingWrites && this.coordinator.canWrite && this.isOnline()) {
        this.publish("ready", "Changes synchronized.");
      }
      if(this.pagedCanonical){await this.requireReady();this.engine.completeTransaction(result);}
      return result;
    } catch (error) {
      if(!handedOff){engine?.assertVerificationGeneration?.(generation);error=currentPagedVerificationFailure(error);}
      const outdated=isObsoletePagedVerificationFailure(error);
      if(this.pagedCanonical)this.engine.discardTransaction(result);
      if(outdated)throw error;
      if (failureCode(error) === "transaction-unresolved" || this.engine.recoveryRequired) {
        this.acceptingWrites = false;
        this.publish("recovery-required", "A save needs recovery before more changes can be made.", failureCode(error) || "recovery-required");
      } else if (failureCode(error) === "offline" || failureCode(error) === "ownership-lost" || failureCode(error) === "ownership-unknown") {
        this.acceptingWrites = false;
        this.publish("ownership-unknown", "Connection could not be verified. Writes are paused.", failureCode(error));
      }
      throw error;
    }
  }

  async recover() {
    this.transactionAdapter?.assertMutationsSettled?.();
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
      this.publish("recovery-required", "Recovery remains unresolved. No further writes are allowed.", failureCode(error) || "recovery-required");
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
      if (this.engine?.recoveryRequired || failureCode(error) === "recovery-required") {
        this.publish("recovery-required", "A save needs recovery before more changes can be made.", "recovery-required");
      } else {
        this.publish("release-unconfirmed", "Session release could not be verified. Do not switch devices yet.", failureCode(error) || "release-unconfirmed");
      }
      this.diagnostic("release-refused", { reason });
      throw error;
    } finally {
      this.releasePending = false;
    }
  }
}
