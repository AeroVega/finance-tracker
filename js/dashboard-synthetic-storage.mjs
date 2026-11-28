import { provePrivateGoogleFolder } from './google-private-folder-proof.mjs';
import {AppError} from './app-error.mjs';
import {FullSnapshotApplication,inspectFullSnapshotFolder} from './full-snapshot-application.mjs';
import { createDiagnostic, diagnosticMessage } from './app-diagnostics.mjs';
import { reportError, getReport } from './error-reporting.mjs';
import { SURFACES } from './diagnostic-context.mjs';
import { GoogleDriveTransactionAdapter } from "./drive-transaction-engine.mjs";
import { validateGoogleConfig } from "./google-config-validation.mjs";
import { googleStartupError } from "./google-startup-diagnostics.mjs";
import { releasedDataClass } from "./release-profile.mjs";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PRODUCTION_FOLDER_NAME = "finance-tracker-database";

export function classifyPickerAction(action, pickerActions) {
  if (action === pickerActions.PICKED) return "picked";
  if (action === pickerActions.CANCEL) return "cancelled";
  if (pickerActions.ERROR !== undefined && action === pickerActions.ERROR) return "error";
  // Google Picker emits LOADED before the user chooses a folder. It is not a
  // terminal result; keep the picker open and wait for PICKED or CANCEL.
  return "pending";
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
    // Provider payloads may contain arbitrary text. Classify only documented
    // discriminators; never retain the payload or copy it into diagnostics.
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response?.error === 'access_denied') return reject(new AppError('authorization-cancelled'));
          if (response?.error || typeof response?.access_token !== 'string' || !response.access_token.trim())
            return reject(new AppError('authorization-failed'));
          resolve(response);
        },
        error_callback: (error) => {
          if (error?.type === 'popup_closed') return reject(new AppError('authorization-cancelled'));
          if (error?.type === 'popup_failed_to_open') return reject(new AppError('authorization-popup-blocked'));
          reject(new AppError('authorization-failed'));
        }
      });
      client.requestAccessToken();
    } catch {
      reject(new AppError('authorization-failed'));
    }
  });
}

// Only an account fingerprint is retained locally. It is not a credential or
// an access-control boundary; clearing browser site data requires designation again.
const ACCOUNT_KEY = 'finance-tracker.designated-account.v1';
async function accountFingerprint(id) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('finance-tracker-account-v1:' + id));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
// Production only: a per-browser hash of (designated account, folder). It can
// refuse a folder, never admit one; Google OAuth and Drive permissions remain
// the access authority. It is not logged, published or sent anywhere.
const FOLDER_KEY = 'finance-tracker.designated-private-folder.v1';
async function folderFingerprint(accountId, folderId) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('finance-tracker-folder-v1:' + accountId + ':' + folderId));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function readFolderPin() {
  try { return window.localStorage.getItem(FOLDER_KEY); }
  catch (cause) { throw new AppError('account-designation-unavailable', {cause}); }
}
async function verifiedAccount(token) {
  let response;
  try { response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,me)', {
    headers: { Authorization: 'Bearer ' + token }, cache: 'no-store'
  }); } catch (cause) { throw new AppError('account-verification-failed', {cause}); }
  if (!response.ok) throw new AppError('account-verification-failed');
  let user;
  try { user = (await response.json()).user; } catch (cause) { throw new AppError('account-verification-failed', {cause}); }
  if (user?.me !== true || typeof user.permissionId !== 'string' || !user.permissionId ||
      typeof user.emailAddress !== 'string' || !user.emailAddress || user.emailAddress.length > 320) throw new AppError('account-verification-failed');
  return user;
}
function authorizationExpiry(response) {
  const seconds = Number(response.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 5) throw new AppError('authorization-required');
  return Date.now() + seconds * 1000;
}

/** Strict fresh-target admission, before even a session marker is written.
 * drive.file can enumerate only app-visible children. The owner must also
 * confirm in Drive that the selected folder is newly created and empty.
 */
export async function requireEmptySyntheticFolder(adapter) {
  if ((await adapter.listChildren()).length !== 0) {
    throw new AppError("empty-folder-required");
  }
}

export class DashboardSyntheticStorage {
  constructor({ diagnosticSurface = 'workspace', onStatus = () => {}, onSnapshot = () => {}, onDiagnostic = () => {}, dataClass = 'synthetic', release } = {}) {
    // Release gate first: an unreleased class cannot even be selected.
    this.releaseProfile = release;
    this.dataClass = releasedDataClass(dataClass, release);
    this.folderFingerprint = "";
    this.folderDesignation = null;
    this.diagnosticSurface = SURFACES.has(diagnosticSurface) ? diagnosticSurface : 'workspace';
    this.onStatus = onStatus;
    this.onSnapshot = onSnapshot;
    this.onDiagnostic = onDiagnostic;
    this.accessToken = "";
    this.tokenExpiresAt = 0;
    this.accountId = "";
    this.config = null;
    this.folderId = "";
    this.folderName = "";
    this.lifecycle = null;
    this.busy = false;
    this.readyPromise = null;
  }

  createLedgerStore(){return this.lifecycle.createLedgerStore();}

  /** Choose the session class before any connection, never while one exists. */
  setDataClass(dataClass) {
    if (this.busy || this.lifecycle) throw new AppError('release-before-preview');
    this.dataClass = releasedDataClass(dataClass, this.releaseProfile);
    this.folderFingerprint = ""; this.folderDesignation = null;
    return this.dataClass;
  }

  /** Drive transport for the stored token. A 401 means Google no longer
   * accepts that token (for example, access was revoked). Forget it so the
   * next explicit action asks for sign-in again instead of reusing a dead
   * token until its nominal expiry. Never renews; only an older token's late
   * 401 cannot clear a newer one. 403 is not treated as revocation: Drive
   * also uses it for quota and permission refusals. */
  async driveFetch(url, options) {
    const response = await globalThis.fetch(url, options);
    if (response?.status === 401) {
      let sent = null;
      try { sent = new Headers(options?.headers).get('Authorization'); } catch { /* unreadable headers: keep the token */ }
      if (this.accessToken && sent === 'Bearer ' + this.accessToken) { this.accessToken = ''; this.tokenExpiresAt = 0; }
    }
    return response;
  }

  #lifecycle(folderId) {
    return new FullSnapshotApplication({folderId,accessToken:()=>this.token(),fetchImpl:(url,options)=>this.driveFetch(url,options),dataClass:this.dataClass,release:this.releaseProfile,
      onStatus:status=>this.publish(status.state,"",status.code?"error":"info",status.code?{code:status.code}:null)});
  }

  /** Production: record a new designated folder only after independent verification. */
  commitFolderDesignation() {
    if (this.dataClass !== 'production') return;
    const fingerprint = this.folderDesignation;
    if (!fingerprint) return;
    if (fingerprint !== this.folderFingerprint || !this.lifecycle || this.lifecycle.folderId !== this.folderId) throw new AppError('reconnect-required');
    try {
      window.localStorage.setItem(FOLDER_KEY, fingerprint);
      if (window.localStorage.getItem(FOLDER_KEY) !== fingerprint) throw new AppError('account-designation-unavailable');
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError('account-designation-unavailable', {cause});
    }
    this.folderDesignation = null;
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

  publish(state, message, kind = "info", error = null, reportId = null) {
    let diagnostic;
    try { if (kind === "error") diagnostic = getReport(reportId) || reportError(error, {surface: this.diagnosticSurface, state}); }
    catch { /* best-effort: reporting must not change connection behavior */ }
    const safe = diagnostic || (kind === "error" ? createDiagnostic(error) : null);
    this.onStatus({ state, message: safe ? diagnosticMessage({code: safe.code}) : message, kind,
      ...(safe ? {code: safe.code} : {}), ...(diagnostic ? {reportId: diagnostic.id} : {}) });
  }

  token() {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt - 5000) {
      this.accessToken = "";
      throw Object.assign(new Error("Google authorization expired. Reconnect before continuing."), { code: "authorization-required" });
    }
    return this.accessToken;
  }

  async authorizeAccount(response, { refresh = false } = {}) {
    const expiresAt = authorizationExpiry(response);
    const user = await verifiedAccount(response.access_token);
    if (this.accountId && user.permissionId !== this.accountId) throw new AppError('account-mismatch');
    if (refresh && !this.accountId) throw new AppError('account-verification-failed');
    if (!refresh) {
      let saved;
      const fingerprint = await accountFingerprint(user.permissionId);
      try { saved = window.localStorage.getItem(ACCOUNT_KEY); }
      catch (cause) { throw new AppError('account-designation-unavailable', {cause}); }
      if (saved && saved !== fingerprint) throw new AppError('account-mismatch');
      // The designated account is already proven by its fingerprint above, so only
      // the first designation in this browser asks (owner decision, 2026-11-28).
      if (!saved && !window.confirm(`Designate ${user.emailAddress} as your only Finance Tracker Google account in this browser? A non-secret account fingerprint will be remembered locally, not your email or token. Use the same account on every device. No folder will be created automatically.`)) {
        throw new AppError('authorization-cancelled');
      }
      try {
        // Recheck after confirmation: another tab may have designated an account.
        const current = window.localStorage.getItem(ACCOUNT_KEY);
        if (current && current !== fingerprint) throw new AppError('account-mismatch');
        window.localStorage.setItem(ACCOUNT_KEY, fingerprint);
        if (window.localStorage.getItem(ACCOUNT_KEY) !== fingerprint) throw new AppError('account-designation-unavailable');
      } catch (cause) {
        if (cause instanceof AppError) throw cause;
        throw new AppError('account-designation-unavailable', {cause});
      }
    }
    return { token: response.access_token, expiresAt, accountId: user.permissionId };
  }

  async connect({ requireEmpty = false, requireExisting = false, canonicalLayout = "full-snapshot-v1" } = {}) {
    if (canonicalLayout !== "full-snapshot-v1") throw new AppError("unsupported-canonical-layout");
    if (this.busy) throw new Error("A storage operation is already in progress.");
    this.busy = true;
    try {
      this.publish("connecting", "Loading Google services and deployment configuration…");
      const config = this.config || await this.prepare();
      // Invoke GIS immediately from the button handler while its user activation is live.
      const authorization = requestToken(config.clientId);
      const response = await authorization;
      const candidate = await this.authorizeAccount(response);
      const candidateToken = () => {
        if (Date.now() >= candidate.expiresAt - 5000) throw new AppError('authorization-required');
        return candidate.token;
      };
      const folder = await new Promise((resolve, reject) => {
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
          .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
        const picker = new window.google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(candidateToken())
          .setDeveloperKey(config.apiKey)
          .setAppId(config.projectNumber)
          .setOrigin(window.location.origin)
          .setTitle(this.dataClass === "production" ? "Choose your private database folder" : "Choose a dedicated synthetic test folder")
          .setCallback(async (data) => {
            const pickerResult = classifyPickerAction(data?.action, window.google.picker.Action);
            if (pickerResult === "pending") return;
            if (pickerResult === "error") return reject(googleStartupError("google-picker-unavailable", "Google Picker reported an error."));
            if (pickerResult === "cancelled") return reject(new Error("Folder selection cancelled."));
            const item = data.docs?.[0];
            if (!item?.id) return reject(new Error("Google Picker returned no folder."));
            try {
              const metadataResponse = await fetch(DRIVE_FILES + "/" + encodeURIComponent(item.id) + "?fields=id,name,mimeType,trashed", {
                headers: { Authorization: "Bearer " + candidateToken() }
              });
              if (!metadataResponse.ok) throw new Error("Drive folder verification failed (HTTP " + metadataResponse.status + ").");
              const metadata = await metadataResponse.json();
              if (metadata.id !== item.id || metadata.trashed || metadata.mimeType !== FOLDER_MIME) throw new Error("Select an available Drive folder, not a file.");
              // Names only refuse obvious mix-ups. They never authorize a folder.
              if (this.dataClass === "production") {
                if (/synthetic/i.test(metadata.name || "")) throw new AppError("data-class-mismatch");
              } else if (metadata.name === PRODUCTION_FOLDER_NAME || !/synthetic/i.test(metadata.name || "")) {
                throw new Error("For safety, select a dedicated folder whose name contains “synthetic”. The production database folder is blocked.");
              }
              // Opening an existing folder asks nothing (owner decision, 2026-11-28): the
              // folder designation, privacy proof and format checks below still gate it.
              // Writing into a new empty folder still asks first.
              const confirmation = !requireEmpty ? null : this.dataClass === "production"
                ? "Confirm that “" + metadata.name + "” is a newly created EMPTY folder you own in Google Drive, shared with no one, dedicated only to your private Finance Tracker database. This app cannot see files outside its drive.file access."
                : "Confirm that “" + metadata.name + "” is a newly created EMPTY folder you checked in Google Drive, dedicated only to invented test data. This app cannot see files outside its drive.file access. Upload the synthetic year here?";
              if (confirmation && !window.confirm(confirmation)) {
                throw new Error("Folder selection cancelled.");
              }
              resolve({id: metadata.id, name: metadata.name});
            } catch (error) { reject(error); }
          }).build();
        picker.setVisible(true);
      });

      // Production designation is local and read-only: refuse a different
      // folder before the privacy proof, any content read, session release or write.
      let fingerprint = "", designation = null;
      if (this.dataClass === "production") {
        fingerprint = await folderFingerprint(candidate.accountId, folder.id);
        const pinned = readFolderPin();
        if (pinned !== fingerprint) {
          if (requireExisting && pinned) throw new AppError("designated-folder-mismatch");
          const question = pinned
            ? "Replace this browser’s designated private database folder with “" + folder.name + "”? The current designation stays until the new copy is independently verified. The previous folder is not changed or deleted."
            : "Designate “" + folder.name + "” as the only private database folder in this browser? A non-secret fingerprint is remembered locally, not the folder name or ID.";
          if (!window.confirm(question)) throw new AppError("authorization-cancelled");
          designation = fingerprint;
        }
      }
      // A Picker result is a candidate, not proof of ownership or privacy.
      // Run before inspecting contents, releasing the old session, or writing.
      await provePrivateGoogleFolder({ folderId: folder.id, ...candidate });
      // Refuse unsupported or otherwise nonempty folders before the lifecycle
      // creates or updates a session marker. A rejected folder stays untouched.
      const preflightAdapter = new GoogleDriveTransactionAdapter({
        folderId: folder.id,
        accessToken: candidateToken
      });
      if (requireEmpty) await requireEmptySyntheticFolder(preflightAdapter);
      const {admission}=await inspectFullSnapshotFolder(preflightAdapter,{requireEmpty,requireExisting,dataClass:this.dataClass});
      candidateToken(); // Do not release an old session for a candidate that expired during the last read.
      if (this.lifecycle && this.lifecycle.folderId !== folder.id) {
        if (this.lifecycle.coordinator?.canWrite) {
          const released = await this.lifecycle.release({ reason: "synthetic-folder-change" });
          if (released?.released !== true || this.lifecycle.state !== "released") throw new AppError("release-unconfirmed");
        } else if (this.lifecycle.started) {
          throw new Error("The previous storage session cannot be safely released. Keep this folder selected and resolve its lifecycle state first.");
        }
        this.lifecycle = null;
      }
      // Commit the selection only after admission and verified old-session release.
      this.accessToken = candidate.token;
      this.tokenExpiresAt = candidate.expiresAt;
      this.accountId = candidate.accountId;
      this.folderId = folder.id;
      this.folderName = folder.name;
      this.folderFingerprint = fingerprint;
      this.folderDesignation = designation;
      if (!this.lifecycle) this.lifecycle = this.#lifecycle(this.folderId);
      try {
        if (this.lifecycle.coordinator?.canWrite && this.lifecycle.state === "recovery-required") {
          await this.lifecycle.recover({admission});
        } else if (this.lifecycle.coordinator?.session && this.lifecycle.started) {
          await this.lifecycle.handleOnline({admission});
          if (this.lifecycle.state !== "ready") {
            throw Object.assign(new Error("The existing storage session could not be revalidated. Writes remain disabled."), { code: "ownership-unknown" });
          }
        } else {
          await this.lifecycle.start({initialize:requireEmpty,admission});
        }
      } catch (error) {
        // Only an explicit Open/Reconnect can reclaim. The coordinator rereads
        // the exact stale marker immediately before takeover; all other
        // failures (including a fresh or uncertain competing marker) refuse.
        if (!requireExisting || requireEmpty || error?.code !== 'stale-session') throw error;
        await this.lifecycle.recoverStaleSession({ confirm: true, admission });
      }
      // An existing copy is designated only after its full history verified.
      if (requireExisting) this.commitFolderDesignation();
      const snapshot = await this.readSnapshot();
      this.onSnapshot(snapshot);
      this.publish("ready", (this.dataClass === "production" ? "Private database connected." : "Synthetic storage connected.") + " CSV imports remain local to this page.", "success");
      return { folderName: this.folderName, snapshot };
    } catch (error) {
      const lifecycleState = this.lifecycle?.state || "error";
      this.publish(lifecycleState, "", "error", error);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async refreshRecoveryAuthorization(){
    const lifecycle=this.lifecycle,folderId=this.folderId;
    if(!lifecycle||lifecycle.folderId!==folderId||this.busy)throw new AppError('reconnect-required');
    try{this.token();return;}catch(error){if(error.code!=='authorization-required')throw error;}
    if(!this.config)throw new AppError('authorization-required');
    // Explicit user recheck only, never from automatic recovery. Keep GIS in
    // the click gesture and do not reopen Picker or switch the selected folder.
    this.busy=true;
    try {
      const response=await requestToken(this.config.clientId);
      const candidate=await this.authorizeAccount(response,{refresh:true});
      if(this.lifecycle!==lifecycle||this.folderId!==folderId)throw new AppError('reconnect-required');
      await provePrivateGoogleFolder({ folderId, ...candidate });
      if(this.lifecycle!==lifecycle||this.folderId!==folderId)throw new AppError('reconnect-required');
      this.accessToken=candidate.token;
      this.tokenExpiresAt=candidate.expiresAt;
    } finally { this.busy=false; }
  }

  /** Explicit recheck only: this page's own session expired (for example its
   * heartbeat stopped while access was revoked). Admit read-only, then reclaim
   * the exact stale marker as Open does. Another session's marker refuses. */
  async reclaimOwnStaleSession(lifecycle) {
    if (!lifecycle || lifecycle !== this.lifecycle || lifecycle.folderId !== this.folderId) throw new AppError('reconnect-required');
    // Bind the takeover to this page's own expired session identity.
    const expectedStaleSessionId = lifecycle.coordinator?.session?.sessionId;
    if (typeof expectedStaleSessionId !== 'string' || !expectedStaleSessionId) throw new AppError('reconnect-required');
    const preflight = new GoogleDriveTransactionAdapter({folderId: this.folderId, accessToken: () => this.token(), fetchImpl: (url, options) => this.driveFetch(url, options)});
    const {admission} = await inspectFullSnapshotFolder(preflight, {requireExisting: true, dataClass: this.dataClass});
    if (lifecycle !== this.lifecycle) throw new AppError('reconnect-required');
    await lifecycle.recoverStaleSession({confirm: true, admission, expectedStaleSessionId});
    if (lifecycle !== this.lifecycle || lifecycle.state !== 'ready') throw new AppError('reconnect-required');
  }

  async reopenIndependent() {
    const previous=this.lifecycle,folderId=this.folderId;
    if(!previous||previous.folderId!==folderId||this.busy)throw new AppError('reconnect-required');
    this.busy=true;
    try{
      // The cold verification is a new claim, not a continuation of the old
      // ownership proof. Recheck privacy and read the exact manifest first.
      await provePrivateGoogleFolder({folderId,accountId:this.accountId,
        token:this.token(),expiresAt:this.tokenExpiresAt,fetchImpl:(url,options)=>this.driveFetch(url,options)});
      const preflight=new GoogleDriveTransactionAdapter({folderId,accessToken:()=>this.token(),fetchImpl:(url,options)=>this.driveFetch(url,options)});
      const {admission}=await inspectFullSnapshotFolder(preflight,{requireExisting:true,dataClass:this.dataClass});
      if(this.lifecycle!==previous||this.folderId!==folderId)throw new AppError('reconnect-required');
      this.token();
      const result=await previous.release();
      if(result?.released!==true||this.lifecycle!==previous||this.folderId!==folderId)throw new AppError('release-unconfirmed');
      const fresh=this.#lifecycle(folderId);
      this.lifecycle=fresh;
      await fresh.start({admission});
      if(this.lifecycle!==fresh||this.folderId!==folderId)throw new AppError('reconnect-required');
      return fresh;
    }finally{this.busy=false;}
  }

  async readSnapshot() {
    if (!this.lifecycle || this.lifecycle.state !== "ready") throw new Error("Synthetic storage is not ready.");
    // Canonical records are opened through the full-snapshot store after connect.
    return [];
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
    if (this.busy) throw new AppError("operation-in-progress");
    this.busy = true;
    try {
      const lifecycle = this.lifecycle;
      const accessToken = this.accessToken;
      const tokenExpiresAt = this.tokenExpiresAt;
      if (!lifecycle) {
        throw Object.assign(new Error("There is no active storage session to release."), { code: "release-unconfirmed" });
      }
      const result = await lifecycle.release({ reason: "dashboard-handoff" });
      // An older completion must not erase a newer lifecycle or recovery failure.
      if (result?.released !== true || this.lifecycle !== lifecycle ||
          lifecycle.state !== "released" || lifecycle.engine?.recoveryRequired ||
          // Reauthorization can replace credentials while release is awaiting
          // Drive. An older completion must not clear that newer authorization.
          // Natural expiry may already have cleared the old token; that is safe.
          (this.accessToken && (this.accessToken !== accessToken || this.tokenExpiresAt !== tokenExpiresAt))) {
        throw Object.assign(new Error("Storage release could not be verified. Keep this device selected and resolve the session before switching devices."), { code: "release-unconfirmed" });
      }
      this.accessToken = "";
      this.tokenExpiresAt = 0;
      this.lifecycle = null;
      this.folderFingerprint = ""; this.folderDesignation = null;
      this.publish("disconnected", this.dataClass === "production" ? "Private database session released." : "Synthetic storage session released.", "success");
      this.onSnapshot([]);
      return result;
    } finally { this.busy = false; }
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
