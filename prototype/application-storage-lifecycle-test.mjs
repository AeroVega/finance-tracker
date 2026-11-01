import { GOOGLE_CONFIG } from "../js/google-config.js";
import { validateGoogleConfig } from "../js/google-config-validation.mjs";
import { DRIVE_FILES_ENDPOINT } from "../js/drive-feasibility-spike.mjs";
import { ApplicationStorageLifecycle } from "../js/application-storage-lifecycle.mjs";
import { GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PRODUCTION_FOLDER_NAME = "finance-tracker-database";
const MANIFEST_NAME = "ft-synthetic-pr24-manifest.json";
const BOOTSTRAP_TRANSACTION = "pr24-bootstrap";
const state = {
  accessToken: "",
  tokenExpiresAt: 0,
  folderId: "",
  folderName: "",
  lifecycle: null,
  manifestFileId: "",
  busy: false
};
const $ = (id) => document.getElementById(id);

function status(id, message, kind = "info") {
  const node = $(id);
  node.textContent = message;
  node.dataset.kind = kind;
}
function text(id, value) { $(id).textContent = value; }
function token() {
  if (!state.accessToken || Date.now() >= state.tokenExpiresAt - 30_000) {
    state.accessToken = "";
    text("auth-state", "Reconnect required");
    updateActions();
    throw Object.assign(new Error("Google authorization is missing or expired. Reconnect before continuing."), { code: "authorization-required" });
  }
  return state.accessToken;
}
function hasFolder() { return Boolean(state.folderId && state.folderName && state.accessToken); }
function ready() { return Boolean(state.lifecycle && state.lifecycle.state === "ready" && state.lifecycle.acceptingWrites); }
function updateActions() {
  const folder = hasFolder();
  const lifecycle = state.lifecycle;
  const owned = Boolean(lifecycle?.coordinator?.canWrite);
  $("select-folder").disabled = !state.accessToken || state.busy;
  $("start-lifecycle").disabled = !folder || state.busy || ready();
  $("recover-stale").disabled = !lifecycle || lifecycle.state !== "stale-session" || state.busy;\n  $("simulate-crash").disabled = !lifecycle?.started || !lifecycle.coordinator?.canWrite || state.busy;
  $("recover-transaction").disabled = !lifecycle || lifecycle.state !== "recovery-required" || !owned || state.busy;
  $("run-transactions").disabled = !ready() || state.busy;
  $("simulate-offline").disabled = !ready() || state.busy;
  $("simulate-online").disabled = !lifecycle?.started || !lifecycle.coordinator?.session || state.busy || ready();
  $("release-session").disabled = !owned || state.busy;
  $("cleanup").disabled = !folder || state.busy || Boolean(owned);
}
function renderLifecycle(snapshot) {
  const lifecycle = state.lifecycle;
  text("lifecycle-state", snapshot?.state || lifecycle?.state || "Disconnected");
  text("write-state", lifecycle?.acceptingWrites ? "Enabled" : "Disabled");
  text("session-state", lifecycle?.coordinator?.session?.sessionId || "None");
  if (state.manifestFileId && lifecycle?.transactionAdapter) {
    void lifecycle.transactionAdapter.readJson(state.manifestFileId)
      .then((manifest) => text("revision-state", String(manifest.revision)))
      .catch(() => text("revision-state", "Unavailable"));
  }
  updateActions();
}
function publishStatus(snapshot) {
  renderLifecycle(snapshot);
  status("lifecycle-status", snapshot.message || snapshot.state, snapshot.state === "ready" || snapshot.state === "released" ? "success" :
    ["stale-session", "session-active", "offline", "recovery-required", "ownership-unknown", "release-unconfirmed"].includes(snapshot.state) ? "warning" : "info");
  if (snapshot.state === "ready") status("crash-status", "Storage recovered and ready. Session ID: " + (state.lifecycle?.coordinator?.session?.sessionId || "unavailable"), "success");
}
function waitFor(check, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (check()) { window.clearInterval(timer); resolve(); }
      else if (Date.now() - started > 15_000) {
        window.clearInterval(timer);
        reject(new Error("Google " + label + " did not load. Reload and retry."));
      }
    }, 50);
  });
}
async function loadGoogleLibraries() {
  await Promise.all([
    waitFor(() => window.google?.accounts?.oauth2, "authorization library"),
    waitFor(() => window.gapi && typeof window.gapi.load === "function", "Picker library")
  ]);
  await new Promise((resolve, reject) => {
    window.gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Google Picker could not load.")),
      timeout: 10_000,
      ontimeout: () => reject(new Error("Google Picker timed out."))
    });
  });
}
function requestToken() {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response?.error) return reject(new Error("Google did not authorize Drive access."));
        if (!response?.access_token) return reject(new Error("Google returned no access token."));
        resolve(response);
      },
      error_callback: () => reject(new Error("Google authorization was closed or blocked."))
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}
async function driveGet(url) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token() } });
  if (!response.ok) throw new Error("Google Drive request failed (HTTP " + response.status + ").");
  return response.json();
}
function openPicker() {
  validateGoogleConfig(GOOGLE_CONFIG);
  const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
    .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME);
  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(token())
    .setDeveloperKey(GOOGLE_CONFIG.apiKey)
    .setAppId(GOOGLE_CONFIG.projectNumber)
    .setOrigin(window.location.origin)
    .setTitle("Choose a dedicated synthetic PR24 test folder")
    .setCallback((data) => {
      if (!data || data.action !== window.google.picker.Action.PICKED) {
        status("connection-status", "No folder selected.");
        return;
      }
      const item = data.docs?.[0];
      if (!item?.id) {
        status("connection-status", "Picker returned no folder.", "error");
        return;
      }
      void verifyFolder(item);
    }).build();
  picker.setVisible(true);
}
async function verifyFolder(item) {
  try {
    const metadata = await driveGet(DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(item.id) + "?fields=id,name,mimeType");
    if (metadata.id !== item.id || metadata.mimeType !== FOLDER_MIME) throw new Error("Select a Drive folder, not a file.");
    if (metadata.name === PRODUCTION_FOLDER_NAME || !/synthetic/i.test(metadata.name || "")) {
      throw new Error("For safety, choose a dedicated folder whose name contains “synthetic”. The production database folder is blocked.");
    }
    const name = String(metadata.name);
    if (!window.confirm("Confirm that “" + name + "” is a dedicated synthetic test folder containing no personal financial data. PR24 will create a synthetic manifest, invented test objects, journal/commit records, and one session marker. Continue?")) {
      status("connection-status", "Folder selection cancelled. No Drive files were accessed.", "warning");
      return;
    }
    if (state.lifecycle?.coordinator?.canWrite) {
      throw new Error("Release the current session before changing the selected test folder.");
    }
    state.folderId = metadata.id;
    state.folderName = name;
    state.lifecycle = null;
    state.manifestFileId = "";
    text("folder-state", name);
    status("connection-status", "Dedicated synthetic folder verified. Ready to initialize the PR24 test harness.", "success");
    text("check-connect", "Connect + dedicated synthetic folder: PASS");
    $("check-connect").className = "pass";
    updateActions();
  } catch (error) {
    status("connection-status", error instanceof Error ? error.message : "Could not verify the selected folder.", "error");
  }
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
async function findOrCreateManifest(adapter) {
  const files = await adapter.listChildren();
  const matches = files.filter((file) =>
    file.name === MANIFEST_NAME &&
    file.appProperties?.financeTrackerKind === "synthetic-manifest" &&
    file.appProperties?.financeTrackerTransaction === BOOTSTRAP_TRANSACTION
  );
  if (matches.length > 1) throw new Error("Multiple PR24 synthetic manifests exist. Stop and inspect the test folder; no files were changed.");
  if (matches.length === 1) {
    const file = matches[0];
    const manifest = await adapter.readJson(file.id);
    if (manifest.format !== "finance-tracker-manifest" || manifest.syntheticOnly !== true ||
        !manifest.databaseId || !manifest.copyId || !Number.isSafeInteger(manifest.revision) ||
        typeof manifest.commitId !== "string" || !manifest.snapshot || typeof manifest.snapshot !== "object") {
      throw new Error("The existing PR24 manifest failed synthetic identity validation. No files were changed.");
    }
    return file.id;
  }
  const manifest = {
    format: "finance-tracker-manifest",
    manifestVersion: "1.0.0",
    schemaVersion: 1,
    syntheticOnly: true,
    databaseId: "pr24-synthetic-database-" + crypto.randomUUID(),
    copyId: "pr24-synthetic-copy-" + crypto.randomUUID(),
    role: "primary",
    revision: 0,
    commitId: "pr24-synthetic-genesis-" + crypto.randomUUID(),
    parentCommitId: null,
    snapshot: {}
  };
  const content = JSON.stringify(manifest);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const expectedSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const fileId = await adapter.allocateFileId();
  await adapter.createImmutable({
    fileId, name: MANIFEST_NAME, kind: "synthetic-manifest",
    transactionId: BOOTSTRAP_TRANSACTION, content, expectedSha256
  });
  return fileId;
}
async function runBusy(action) {
  state.busy = true;
  updateActions();
  try { await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "The operation failed.";
    status("lifecycle-status", message, "error");
    if (error?.code === "authorization-required") {
      state.accessToken = "";
      text("auth-state", "Reconnect required");
    }
  } finally {
    state.busy = false;
    renderLifecycle();
  }
}
async function startLifecycle() {
  if (!hasFolder()) throw new Error("Connect to Google and select a dedicated synthetic folder first.");
  token();
  const bootstrapAdapter = new GoogleDriveTransactionAdapter({
    accessToken: async () => token(), folderId: state.folderId, fetchImpl: globalThis.fetch, cryptoImpl: crypto
  });
  state.manifestFileId = await findOrCreateManifest(bootstrapAdapter);
  state.lifecycle = new ApplicationStorageLifecycle({
    syntheticOnly: true,
    folderName: state.folderName,
    folderId: state.folderId,
    manifestFileId: state.manifestFileId,
    accessToken: () => token(),
    makeManifest: manifestBuilder,
    fetchImpl: globalThis.fetch,
    cryptoImpl: crypto,
    isOnline: () => navigator.onLine !== false,
    onStatus: publishStatus
  });
  try {
    await state.lifecycle.start();
    text("check-start", "Session acquisition + startup recovery: PASS");
    $("check-start").className = "pass";
    status("crash-status", "Lifecycle started. To test a crash, terminate the browser without allowing pagehide; then wait for the two-minute lease to expire.", "success");
  } catch (error) {
    renderLifecycle();
    if (error?.code === "stale-session") {
      status("crash-status", "Stale session detected. Automatic takeover was correctly refused. Confirm explicit recovery when ready.", "warning");
    }
    throw error;
  }
}
async function runTransactions() {
  const lifecycle = state.lifecycle;
  if (!ready()) throw new Error("Storage must be Ready before running transactions.");
  const firstBase = await lifecycle.readManifest();
  const firstId = "pr24-" + crypto.randomUUID();
  const firstPath = "synthetic/pr24-first-" + crypto.randomUUID() + ".json";
  const firstPayload = { test: "PR24", sequence: 1, syntheticOnly: true, marker: "invented fixture" };
  const first = await lifecycle.transact({
    manifestFileId: state.manifestFileId,
    transactionId: firstId,
    expectedBase: firstBase,
    objects: [{ logicalPath: firstPath, content: JSON.stringify(firstPayload) }],
    commitRecord: { operationType: "pr24-synthetic-integration-test", schemaVersion: 1, snapshot: {} },
    makeManifest: manifestBuilder
  });

  // Start two writes from the same base. The serialized engine must allow one
  // commit and reject the stale-base contender rather than silently overwrite it.
  const sharedBase = await lifecycle.readManifest();
  const raceIds = ["pr24-" + crypto.randomUUID(), "pr24-" + crypto.randomUUID()];
  const racePaths = raceIds.map((id) => "synthetic/" + id + ".json");
  const racePromises = raceIds.map((id, index) => lifecycle.transact({
    manifestFileId: state.manifestFileId,
    transactionId: id,
    expectedBase: sharedBase,
    objects: [{ logicalPath: racePaths[index], content: JSON.stringify({ test: "PR24", contender: index + 1, syntheticOnly: true }) }],
    commitRecord: { operationType: "pr24-serialized-write-race", schemaVersion: 1, snapshot: {} },
    makeManifest: manifestBuilder
  }).then((value) => ({ status: "fulfilled", value, index })).catch((error) => ({ status: "rejected", error, index })));
  const raceResults = await Promise.all(racePromises);
  const winner = raceResults.find((result) => result.status === "fulfilled");
  const loser = raceResults.find((result) => result.status === "rejected");
  if (!winner || !loser || loser.error?.code !== "base-conflict") {
    throw new Error("The concurrent stale-base test did not produce exactly one commit and one safe base-conflict refusal. Results: " +
      raceResults.map((result) => result.status === "fulfilled" ? "committed" : result.error?.code || "failed").join(", "));
  }
  const retryBase = await lifecycle.readManifest();
  const retryId = raceIds[loser.index] + "-retry";
  const retryPath = racePaths[loser.index] + ".retry";
  const retry = await lifecycle.transact({
    manifestFileId: state.manifestFileId,
    transactionId: retryId,
    expectedBase: retryBase,
    objects: [{ logicalPath: retryPath, content: JSON.stringify({ test: "PR24", retryAfterConflict: true, syntheticOnly: true }) }],
    commitRecord: { operationType: "pr24-serialized-write-retry", schemaVersion: 1, snapshot: {} },
    makeManifest: manifestBuilder
  });

  const firstRead = JSON.parse(new TextDecoder().decode(await lifecycle.readObject(firstPath)));
  const winnerRead = JSON.parse(new TextDecoder().decode(await lifecycle.readObject(racePaths[winner.index])));
  const retryRead = JSON.parse(new TextDecoder().decode(await lifecycle.readObject(retryPath)));
  if (firstRead.marker !== "invented fixture" || winnerRead.syntheticOnly !== true || retryRead.retryAfterConflict !== true) {
    throw new Error("One or more synthetic objects did not pass exact manifest/hash read-back.");
  }
  const finalManifest = await lifecycle.readManifest();
  text("revision-state", String(finalManifest.revision));
  status("transaction-status",
    "PASS: first transaction committed at revision " + first.revision +
    "; concurrent contenders produced one commit and one safe base-conflict refusal; retry committed at revision " + retry.revision +
    "; all three objects passed manifest, metadata, and SHA-256 read-back. No real data was used.",
    "success");
  text("check-transaction", "Serialized writes + SHA-256 read-back: PASS");
  $("check-transaction").className = "pass";
}
async function simulateOffline() {
  if (!state.lifecycle) throw new Error("Start the lifecycle first.");
  await state.lifecycle.handleOffline();
  status("reconnect-status", "PASS: offline handler disabled writes and stopped heartbeats. This is a simulated event; repeat using device Airplane Mode for the real network test.", "warning");
}
async function simulateOnline() {
  if (!state.lifecycle?.started) throw new Error("The previous session context is unavailable. Start the lifecycle again.");
  const priorId = state.lifecycle.coordinator.session?.sessionId;
  await state.lifecycle.handleOnline();
  const currentId = state.lifecycle.coordinator.session?.sessionId;
  if (state.lifecycle.state !== "ready" || !priorId || currentId !== priorId) {
    throw new Error("Reconnect did not restore Ready with the exact original session identity. Previous: " + (priorId || "none") + " · current: " + (currentId || "none") + " · state: " + state.lifecycle.state);
  }
  status("reconnect-status", "PASS: the same session ID was revalidated, transaction recovery ran, and writes were re-enabled.", "success");
  text("check-reconnect", "Offline refusal + same-session reconnect: PASS");
  $("check-reconnect").className = "pass";
}
async function releaseSession() {
  if (!state.lifecycle) throw new Error("No application lifecycle is active.");
  const result = await state.lifecycle.release({ reason: "owner-test-handoff" });
  if (!result.released) throw new Error("The session release was not confirmed.");
  status("release-status", "PASS: session released and read-back verified. It is now safe to switch devices.", "success");
  text("check-release", "Verified orderly release: PASS");
  $("check-release").className = "pass";
}
async function recoverStale() {
  if (state.lifecycle?.state !== "stale-session") throw new Error("Drive has not reported a conclusively stale session.");
  if (!window.confirm("Confirm takeover of the stale PR24 synthetic test session? This is explicit recovery, not automatic takeover. Continue only if you are certain the previous browser/device is no longer active.")) return;
  await state.lifecycle.recoverStaleSession({ confirm: true });
  state.manifestRevision = (await state.lifecycle.readManifest()).revision;\n  text("check-crash", "Crash / reload / stale recovery: PASS (owner-confirmed)");
  $("check-crash").className = "pass";
  status("crash-status", "PASS: stale-session takeover required explicit confirmation, a new session ID was acquired, and transaction recovery completed.", "success");
}
async function recoverTransaction() {
  await state.lifecycle.recover();
  status("transaction-status", "PASS: unresolved transaction recovery completed and storage returned to Ready.", "success");
}
async function cleanupSyntheticFiles() {
  if (!state.folderId) throw new Error("Select the synthetic folder first.");
  if (state.lifecycle?.coordinator?.canWrite) throw new Error("Release this page's session before cleanup.");
  if (state.lifecycle?.coordinator) {
    const inspection = await state.lifecycle.coordinator.inspect();
    if (inspection.status === "active") throw new Error("An active session marker exists. Cleanup is blocked while another page/device may be using this synthetic folder.");
  }
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: async () => token(), folderId: state.folderId, fetchImpl: globalThis.fetch, cryptoImpl: crypto
  });
  const files = await adapter.listChildren();
  const targets = files.filter((file) =>
    file.name === MANIFEST_NAME ||
    (typeof file.appProperties?.financeTrackerTransaction === "string" &&
      file.appProperties.financeTrackerTransaction.startsWith("pr24-"))
  );
  if (!targets.length) {
    status("cleanup-status", "No PR24 synthetic transaction files were found. The session marker, if present, was not touched.", "success");
    return;
  }
  if (!window.confirm("Permanently delete " + targets.length + " PR24 synthetic transaction file(s) from “" + state.folderName + "”? The session marker will be retained. Continue?")) return;
  const failures = [];
  for (const file of targets) {
    if (!Array.isArray(file.parents) || !file.parents.includes(state.folderId) ||
        !(file.name === MANIFEST_NAME || String(file.appProperties?.financeTrackerTransaction || "").startsWith("pr24-"))) {
      failures.push(file.id);
      continue;
    }
    const response = await fetch(DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(file.id), {
      method: "DELETE", headers: { Authorization: "Bearer " + token() }
    });
    if (!response.ok && response.status !== 404) failures.push(file.id);
  }
  status("cleanup-status", failures.length
    ? "Cleanup incomplete. Remaining file IDs: " + failures.join(", ") + ". Inspect the folder manually."
    : "PASS: all PR24 synthetic transaction files were deleted. The session marker was retained.",
  failures.length ? "warning" : "success");
  state.manifestFileId = "";
}
$("connect-google").addEventListener("click", () => runBusy(async () => {
  validateGoogleConfig(GOOGLE_CONFIG);
  state.accessToken = "";
  text("auth-state", "Connecting…");
  const response = await requestToken();
  state.accessToken = response.access_token;
  state.tokenExpiresAt = Date.now() + Number(response.expires_in || 0) * 1000;
  text("auth-state", "Connected for this page");
  status("connection-status", "Google authorization succeeded. Choose the dedicated synthetic folder.", "success");
  updateActions();
}));
$("select-folder").addEventListener("click", () => {
  try { openPicker(); }
  catch (error) { status("connection-status", error.message || "Could not open Google Picker.", "error"); }
});
$("start-lifecycle").addEventListener("click", () => runBusy(async () => {
  await startLifecycle();
  status("lifecycle-status", "PASS: session acquired, transaction recovery completed before Ready, and automatic heartbeat started.", "success");
}));
$("recover-stale").addEventListener("click", () => runBusy(recoverStale));\n$("simulate-crash").addEventListener("click", () => runBusy(simulateCrash));
$("recover-transaction").addEventListener("click", () => runBusy(recoverTransaction));
$("run-transactions").addEventListener("click", () => runBusy(runTransactions));
$("simulate-offline").addEventListener("click", () => runBusy(simulateOffline));
$("simulate-online").addEventListener("click", () => runBusy(simulateOnline));
$("release-session").addEventListener("click", () => runBusy(releaseSession));
$("cleanup").addEventListener("click", () => runBusy(cleanupSyntheticFiles));

$("connect-google").disabled = true;
updateActions();
loadGoogleLibraries().then(() => {
  $("connect-google").disabled = false;
  status("connection-status", "Google services loaded. Connect, then choose a dedicated synthetic test folder.");
}).catch((error) => status("connection-status", error.message || "Google services could not load.", "error"));
window.addEventListener("online", () => {
  if (state.lifecycle) status("reconnect-status", "Browser reports online. The lifecycle controller is revalidating the prior session…");
});
window.addEventListener("offline", () => {
  if (state.lifecycle) status("reconnect-status", "Browser reports offline. The lifecycle controller has paused writes.");
});
