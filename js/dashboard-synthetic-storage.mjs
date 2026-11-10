import { ApplicationStorageLifecycle } from "./application-storage-lifecycle.mjs";
import { GoogleDriveTransactionAdapter } from "./drive-transaction-engine.mjs";
import { validateGoogleConfig } from "./google-config-validation.mjs";
import { googleStartupError } from "./google-startup-diagnostics.mjs";
import { initializeCatalogCopy, verifyCatalogHistory, storageError } from "./catalog-storage.mjs";
import { SyntheticOriginalRetentionStore } from "./drive-original-retention.mjs";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MANIFEST_NAME = "ft-synthetic-dashboard-manifest.json";
const MANIFEST_KIND = "dashboard-synthetic-manifest";
const SNAPSHOT_PATH = "synthetic/dashboard-transactions.json";
const PRODUCTION_FOLDER_NAME = "finance-tracker-database";

export function classifyPickerAction(action, pickerActions) {
  if (action === pickerActions.PICKED) return "picked";
  if (action === pickerActions.CANCEL) return "cancelled";
  // Google Picker emits LOADED before the user chooses a folder. It is not a
  // terminal result; keep the picker open and wait for PICKED or CANCEL.
  return "pending";
}

export function isSyntheticDashboardSnapshot(value) {
  return Boolean(value && value.format === "finance-tracker-dashboard-snapshot" &&
    value.syntheticOnly === true && Array.isArray(value.transactions) &&
    value.transactions.every((row) => row && row.syntheticOnly === true &&
      typeof row.id === "string" && typeof row.date === "string" &&
      typeof row.description === "string" && Number.isFinite(row.amount)));
}

export function createSnapshotTransaction({ manifest, transactions, cryptoImpl = globalThis.crypto }) {
  if (!Array.isArray(transactions) || !transactions.every((row) => row?.syntheticOnly === true)) {
    throw Object.assign(new Error("Only invented dashboard fixtures may be saved through this integration."), { code: "synthetic-data-required" });
  }
  if (!cryptoImpl?.randomUUID) throw Object.assign(new Error("Cryptographically generated UUIDs are required."), { code: "crypto-unavailable" });
  const transactionId = cryptoImpl.randomUUID();
  return {
    transactionId,
    expectedBase: manifest,
    objects: [{
      logicalPath: SNAPSHOT_PATH,
      content: JSON.stringify({
        format: "finance-tracker-dashboard-snapshot",
        version: 1,
        syntheticOnly: true,
        transactions
      })
    }],
    commitRecord: {
      operationType: "synthetic-dashboard-snapshot",
      schemaVersion: 1,
      snapshot: manifest.snapshot || {}
    },
    makeManifest: ({ current, record, commitFileId, commitHash, snapshot }) => ({
      ...current,
      revision: record.revision,
      commitId: record.commitId,
      parentCommitId: record.parentCommitId,
      commitRecordFileId: commitFileId,
      commitRecordHash: commitHash,
      snapshot
    })
  };
}

function waitFor(check, component) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (check()) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 15000) {
        window.clearInterval(timer);
        reject(googleStartupError("google-library-timeout", "Google library timed out.", { component }));
      }
    }, 50);
  });
}

async function loadGoogleLibraries() {
  const checks = await Promise.allSettled([
    waitFor(() => window.google?.accounts?.oauth2, "Google Identity Services (authorization)"),
    waitFor(() => window.gapi && typeof window.gapi.load === "function", "Google API client")
  ]);
  const failedComponents = checks.flatMap((result, index) => result.status === "rejected"
    ? [index === 0 ? "Google Identity Services" : "Google API client"]
    : []);
  if (failedComponents.length) {
    throw googleStartupError("google-libraries-unavailable", "Required Google browser libraries did not load.", {
      components: failedComponents
    });
  }
  await new Promise((resolve, reject) => window.gapi.load("picker", {
    callback: resolve,
    onerror: () => reject(googleStartupError("google-picker-unavailable", "Google Picker failed to load.")),
    timeout: 10000,
    ontimeout: () => reject(googleStartupError("google-picker-unavailable", "Google Picker timed out."))
  }));
}

async function loadConfig() {
  let response;
  try {
    response = await fetch(new URL("./google-config.json", import.meta.url), { cache: "no-store" });
  } catch {
    throw googleStartupError("google-config-network", "The Google deployment configuration request failed.");
  }
  if (!response.ok) {
    throw googleStartupError("google-config-http", "Google deployment configuration could not be loaded.", { status: response.status });
  }
  let config;
  try {
    config = await response.json();
  } catch {
    throw googleStartupError("google-config-json", "The deployed Google configuration file is not valid JSON.");
  }
  try {
    validateGoogleConfig(config);
  } catch (error) {
    throw googleStartupError("google-config-invalid", error.message);
  }
  return Object.freeze(config);
}

function requestToken(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response?.error || !response?.access_token) return reject(new Error("Google did not authorize Drive access."));
        resolve(response);
      },
      error_callback: () => reject(new Error("Google authorization was closed or blocked."))
    });
    client.requestAccessToken();
  });
}

function manifestBuilder({ current, record, commitFileId, commitHash, snapshot }) {
  return {
    ...current,
    revision: record.revision,
    commitId: record.commitId,
    parentCommitId: record.parentCommitId,
    commitRecordFileId: commitFileId,
    commitRecordHash: commitHash,
    snapshot
  };
}

export async function inspectPr25Folder(adapter) {
  const files = await adapter.listChildren();
  const named = files.filter((file) => file.name === MANIFEST_NAME);
  if (named.length > 1) throw storageError("ambiguous-manifest", "Multiple dashboard manifest candidates exist. Stop and inspect the test folder.");
  if (named.length === 1) {
    const file = named[0];
    if (file.appProperties?.financeTrackerKind !== MANIFEST_KIND) {
      throw storageError("invalid-manifest-metadata", "A file uses the synthetic dashboard manifest name but has unexpected metadata.");
    }
    const manifest = await adapter.readJson(file.id);
    if (manifest.manifestVersion !== "2.0.0") {
      throw storageError("unsupported-folder-format", "This folder uses the PR24 synthetic format. PR25 requires a fresh empty synthetic folder; this format is not supported and cannot be converted.");
    }
    if (manifest.format !== "finance-tracker-manifest" || manifest.syntheticOnly !== true ||
        !manifest.databaseId || !manifest.copyId || !Number.isSafeInteger(manifest.revision) ||
        typeof manifest.commitId !== "string" || !manifest.snapshot || typeof manifest.snapshot !== "object") {
      throw storageError("invalid-manifest", "The existing synthetic dashboard manifest failed identity validation.");
    }
    return { manifestFileId: file.id, manifest };
  }
  const unexpected = files.filter((file) => !(file.name === "finance-tracker-active-session.json" &&
    file.appProperties?.financeTrackerSession === "v1"));
  if (unexpected.length) {
    throw storageError("nonempty-folder", "PR25 requires a fresh empty synthetic folder. Existing files were found without a version-2 manifest.");
  }
  return { manifestFileId: null, manifest: null };
}

/** Strict fresh-target admission, before even a session marker is written.
 * drive.file can enumerate only app-visible children. The owner must also
 * confirm in Drive that the selected folder is newly created and empty.
 */
export async function requireEmptySyntheticFolder(adapter) {
  if ((await adapter.listChildren()).length !== 0) {
    throw storageError("empty-folder-required", "Choose a newly created empty synthetic folder. Existing files and sessions will not be overwritten.");
  }
}

export async function findOrCreateManifest(adapter, guard) {
  const existing = await inspectPr25Folder(adapter);
  if (existing.manifestFileId) {
    await verifyCatalogHistory(adapter, existing.manifest);
    return existing.manifestFileId;
  }
  return (await initializeCatalogCopy({ adapter, guard, manifestName: MANIFEST_NAME })).manifestFileId;
}

export class DashboardSyntheticStorage {
  constructor({ onStatus = () => {}, onSnapshot = () => {}, onDiagnostic = () => {}, afterMutation = null, maintainOriginals = true } = {}) {
    this.onStatus = onStatus;
    this.onSnapshot = onSnapshot;
    this.onDiagnostic = onDiagnostic;
    this.afterMutation = afterMutation;
    this.maintainOriginals = maintainOriginals;
    this.accessToken = "";
    this.tokenExpiresAt = 0;
    this.config = null;
    this.folderId = "";
    this.folderName = "";
    this.lifecycle = null;
    this.busy = false;
    this.readyPromise = null;
    this.originals = null;
    this.retentionTimer = null;
  }

  async prepare() {
    if (!this.readyPromise) {
      // Keep the phases ordered and independently diagnosable. A config failure
      // must not be misreported as a Google script-loading failure (or vice versa).
      this.readyPromise = loadConfig().then(async (config) => {
        await loadGoogleLibraries();
        this.config = config;
        return config;
      });
    }
    return this.readyPromise;
  }

  publish(state, message, kind = "info") {
    this.onStatus({ state, message, kind });
  }

  token() {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt - 5000) {
      this.accessToken = "";
      throw Object.assign(new Error("Google authorization expired. Reconnect before continuing."), { code: "authorization-required" });
    }
    return this.accessToken;
  }

  async connect({ requireEmpty = false, requireExisting = false } = {}) {
    if (this.busy) throw new Error("A storage operation is already in progress.");
    this.busy = true;
    try {
      this.publish("connecting", "Loading Google services and deployment configuration…");
      const config = this.config || await this.prepare();
      // Invoke GIS immediately from the button handler while its user activation is live.
      const authorization = requestToken(config.clientId);
      const response = await authorization;
      this.accessToken = response.access_token;
      const expiresInSeconds = Number(response.expires_in);
      // GIS normally supplies expires_in, but do not turn an omitted/malformed
      // lifetime into an already-expired token. Let Drive report a 401 if needed.
      this.tokenExpiresAt = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Date.now() + expiresInSeconds * 1000
        : Number.POSITIVE_INFINITY;
      await new Promise((resolve, reject) => {
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
          .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
        const picker = new window.google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(this.token())
          .setDeveloperKey(config.apiKey)
          .setAppId(config.projectNumber)
          .setOrigin(window.location.origin)
          .setTitle("Choose a dedicated synthetic test folder")
          .setCallback(async (data) => {
            const pickerResult = classifyPickerAction(data?.action, window.google.picker.Action);
            if (pickerResult === "pending") return;
            if (pickerResult === "cancelled") return reject(new Error("Folder selection cancelled."));
            const item = data.docs?.[0];
            if (!item?.id) return reject(new Error("Google Picker returned no folder."));
            try {
              const metadataResponse = await fetch(DRIVE_FILES + "/" + encodeURIComponent(item.id) + "?fields=id,name,mimeType,trashed", {
                headers: { Authorization: "Bearer " + this.token() }
              });
              if (!metadataResponse.ok) throw new Error("Drive folder verification failed (HTTP " + metadataResponse.status + ").");
              const metadata = await metadataResponse.json();
              if (metadata.id !== item.id || metadata.trashed || metadata.mimeType !== FOLDER_MIME) throw new Error("Select an available Drive folder, not a file.");
              if (metadata.name === PRODUCTION_FOLDER_NAME || !/synthetic/i.test(metadata.name || "")) {
                throw new Error("For safety, select a dedicated folder whose name contains “synthetic”. The production database folder is blocked.");
              }
              const confirmation = requireEmpty
                ? "Confirm that “" + metadata.name + "” is a newly created EMPTY folder you checked in Google Drive, dedicated only to invented test data. This app cannot see files outside its drive.file access. Upload the synthetic year here?"
                : "Confirm that “" + metadata.name + "” is a dedicated synthetic test folder containing no personal financial data. Only invented sample fixtures will be saved.";
              if (!window.confirm(confirmation)) {
                throw new Error("Folder selection cancelled.");
              }
              this.folderId = metadata.id;
              this.folderName = metadata.name;
              resolve();
            } catch (error) { reject(error); }
          }).build();
        picker.setVisible(true);
      });

      // Refuse PR24-format or otherwise nonempty folders before the lifecycle
      // creates or updates a session marker. A rejected folder stays untouched.
      const preflightAdapter = new GoogleDriveTransactionAdapter({
        folderId: this.folderId,
        accessToken: () => this.token()
      });
      if (requireEmpty) await requireEmptySyntheticFolder(preflightAdapter);
      const inspected = await inspectPr25Folder(preflightAdapter);
      if (requireExisting && !inspected.manifestFileId) {
        throw storageError("existing-copy-required", "No existing synthetic copy was found. Reconnect does not initialize a new folder.");
      }
      if (this.lifecycle && this.lifecycle.folderId !== this.folderId) {
        if (this.lifecycle.coordinator?.canWrite) {
          await this.lifecycle.release({ reason: "synthetic-folder-change" });
        } else if (this.lifecycle.started) {
          throw new Error("The previous storage session cannot be safely released. Keep this folder selected and resolve its lifecycle state first.");
        }
        this.lifecycle = null;
      }
      if (!this.lifecycle) {
        this.lifecycle = new ApplicationStorageLifecycle({
          syntheticOnly: true,
          catalogProtocol: true,
          afterMutation: this.afterMutation,
          folderName: this.folderName,
          folderId: this.folderId,
          initializeManifest: ({ adapter, guard }) => findOrCreateManifest(adapter, guard),
          // Session adapter folder enumeration consumes the token synchronously.
          // Keep this provider synchronous; an async wrapper becomes Bearer [object Promise].
          accessToken: () => this.token(),
          makeManifest: manifestBuilder,
          onStatus: (status) => this.publish(status.state, status.message, status.code ? "error" : "info"),
          onDiagnostic: (entry) => this.onDiagnostic(entry)
        });
      }
      if (this.lifecycle.coordinator?.canWrite && this.lifecycle.state === "recovery-required") {
        await this.lifecycle.recover();
      } else if (this.lifecycle.coordinator?.session && this.lifecycle.started) {
        await this.lifecycle.handleOnline();
        if (this.lifecycle.state !== "ready") {
          throw Object.assign(new Error("The existing storage session could not be revalidated. Writes remain disabled."), { code: "ownership-unknown" });
        }
      } else {
        await this.lifecycle.start();
      }
      const snapshot = await this.readSnapshot();
      await this.startOriginalRetention();
      this.onSnapshot(snapshot);
      this.publish("ready", "Synthetic storage connected. CSV imports remain local to this page.", "success");
      return { folderName: this.folderName, snapshot };
    } catch (error) {
      const lifecycleState = this.lifecycle?.state || "error";
      this.publish(lifecycleState, error.message || "Synthetic storage could not be connected.", "error");
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async startOriginalRetention() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    this.originals = null;
    // A dedicated fixture seeder never retains originals and must not run
    // deletion/retention maintenance before it recognizes a reselected copy.
    if (!this.maintainOriginals) return;
    this.originals = new SyntheticOriginalRetentionStore({ adapter: this.lifecycle.transactionAdapter,
      withWrite: (operation) => this.lifecycle.coordinator.withWrite(operation),
      assertWritable: async () => {
        if (this.lifecycle.engine.recoveryRequired) throw storageError("recovery-required", "Finish transaction recovery before retention maintenance.");
        await this.lifecycle.coordinator.assertCanWrite({ online: navigator.onLine !== false });
      } });
    await this.originals.process();
    this.retentionTimer = setInterval(() => {
      if (this.lifecycle?.state === "ready" && this.lifecycle.acceptingWrites) {
        void this.originals.process().catch(() => this.onDiagnostic({ event: "retention-retry-required" }));
      }
    }, 60 * 60 * 1000);
  }

  async readSnapshot() {
    if (!this.lifecycle || this.lifecycle.state !== "ready") throw new Error("Synthetic storage is not ready.");
    const manifest = await this.lifecycle.readManifest();
    const reference = manifest.snapshot?.[SNAPSHOT_PATH];
    if (!reference) return [];
    const bytes = await this.lifecycle.readObject(SNAPSHOT_PATH);
    const snapshot = JSON.parse(new TextDecoder().decode(bytes));
    if (!isSyntheticDashboardSnapshot(snapshot)) throw new Error("Stored dashboard snapshot failed synthetic fixture validation.");
    return snapshot.transactions;
  }

  async saveSyntheticSnapshot(transactions) {
    if (!this.lifecycle || this.lifecycle.state !== "ready") throw new Error("Synthetic storage is not ready.");
    if (!transactions.every((row) => row?.syntheticOnly === true)) {
      throw Object.assign(new Error("CSV-imported or other non-synthetic rows are never written to Drive in PR #24."), { code: "synthetic-data-required" });
    }
    const manifest = await this.lifecycle.readManifest();
    const transaction = createSnapshotTransaction({ manifest, transactions });
    const result = await this.lifecycle.transact({ manifestFileId: this.lifecycle.manifestFileId, ...transaction });
    const verified = await this.readSnapshot();
    if (JSON.stringify(verified) !== JSON.stringify(transactions)) throw new Error("Synthetic dashboard snapshot did not match its post-commit read-back.");
    this.onSnapshot(verified);
    return result;
  }

  async clearSyntheticSnapshot() {
    if (!this.lifecycle || this.lifecycle.state !== "ready") throw new Error("Synthetic storage is not ready.");
    return this.saveSyntheticSnapshot([]);
  }

  async recoverStaleSession() {
    if (!this.lifecycle || this.lifecycle.state !== "stale-session") {
      throw new Error("There is no conclusively stale synthetic session to recover.");
    }
    await this.lifecycle.recoverStaleSession({ confirm: true });
    const snapshot = await this.readSnapshot();
    this.onSnapshot(snapshot);
    this.publish("ready", "Stale session recovered and synthetic snapshot verified.", "success");
    return snapshot;
  }

  async release() {
    const lifecycle = this.lifecycle;
    if (!lifecycle) {
      throw Object.assign(new Error("There is no active storage session to release."), { code: "release-unconfirmed" });
    }
    const result = await lifecycle.release({ reason: "dashboard-handoff" });
    // An older completion must not erase a newer lifecycle or recovery failure.
    if (result?.released !== true || this.lifecycle !== lifecycle ||
        lifecycle.state !== "released" || lifecycle.engine?.recoveryRequired) {
      throw Object.assign(new Error("Storage release could not be verified. Keep this device selected and resolve the session before switching devices."), { code: "release-unconfirmed" });
    }
    this.lifecycle = null;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    this.originals = null;
    this.publish("disconnected", "Synthetic storage session released.", "success");
    return result;
  }
}

/** UI handoff has no independent success writer: only verified storage status may announce success. */
export function createDashboardReleaseHandler({ getStorage, setPending, onError, onDiagnostic = () => {} }) {
  return async (event) => {
    try { onDiagnostic({ event: "release-click", isTrusted: event?.isTrusted === true }); } catch { /* observational only */ }
    setPending(true);
    try {
      const storage = getStorage();
      if (!storage) throw new Error("Storage is not ready. No session release was attempted.");
      const result = await storage.release();
      if (result?.released !== true) throw new Error("Storage release could not be verified.");
    } catch (error) {
      onError(error);
      setPending(false);
    }
  };
}
