import { GOOGLE_CONFIG } from "../js/google-config.js";
import { validateGoogleConfig } from "../js/google-config-validation.mjs";
import { createDriveSessionAdapter } from "../js/drive-session-adapter.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";
import { DRIVE_FILES_ENDPOINT } from "../js/drive-feasibility-spike.mjs";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PRODUCTION_FOLDER_NAME = "finance-tracker-database";
const state = {
  accessToken: "",
  tokenExpiresAt: 0,
  folderId: "",
  folderName: "",
  adapter: null,
  coordinator: null,
  heartbeatStop: null,
  lastInspection: null,
  inspectionSequence: 0
};
const $ = (id) => document.getElementById(id);

function status(id, message, kind = "info") {
  const node = $(id);
  node.textContent = message;
  node.dataset.kind = kind;
}
function setText(id, value) { $(id).textContent = value; }
function token() {
  if (!state.accessToken || Date.now() >= state.tokenExpiresAt - 30000) {
    state.accessToken = "";
    state.adapter = null;
    state.coordinator = null;
    setText("auth-state", "Reconnect required");
    setActions();
    throw new Error("Google authorization is missing or expired. Reconnect, select the test folder, then inspect ownership.");
  }
  return state.accessToken;
}
function hasFolder() {
  return Boolean(state.folderId && state.adapter && state.coordinator && state.accessToken);
}
function setActions() {
  const ready = hasFolder();
  const owned = Boolean(state.coordinator && state.coordinator.canWrite);
  const inspected = Boolean(state.lastInspection);
  $("select-folder").disabled = !state.accessToken;
  $("inspect-session").disabled = !ready;
  $("acquire-session").disabled = !ready || owned;
  $("guarded-write").disabled = !owned;
  $("heartbeat-once").disabled = !owned;
  $("heartbeat-start").disabled = !owned || Boolean(state.heartbeatStop);
  $("heartbeat-stop").disabled = !state.heartbeatStop;
  $("resume-session").disabled = !ready || !state.coordinator.session || owned;
  $("recover-session").disabled = !ready || !inspected || state.lastInspection.status !== "stale" || owned;
  $("release-session").disabled = !owned;
}
function clearCoordinator() {
  if (state.heartbeatStop) state.heartbeatStop();
  state.heartbeatStop = null;
  state.adapter = null;
  state.coordinator = null;
  state.lastInspection = null;
  state.folderId = "";
  state.folderName = "";
  setText("folder-state", "None");
  setText("marker-state", "Not inspected");
  setText("owner-state", "Unowned");
  setActions();
}
function waitFor(check, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (check()) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 15000) {
        window.clearInterval(timer);
        reject(new Error("Google " + label + " did not load. Reload and retry."));
      }
    }, 50);
  });
}
async function loadGoogleLibraries() {
  await Promise.all([
    waitFor(() => window.google && window.google.accounts && window.google.accounts.oauth2, "authorization library"),
    waitFor(() => window.gapi && typeof window.gapi.load === "function", "Picker library")
  ]);
  await new Promise((resolve, reject) => {
    window.gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Google Picker could not load.")),
      timeout: 10000,
      ontimeout: () => reject(new Error("Google Picker timed out."))
    });
  });
}
function requestToken(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response && response.error) return reject(new Error("Google did not authorize Drive access."));
        if (!response || !response.access_token) return reject(new Error("Google returned no access token."));
        resolve(response);
      },
      error_callback: () => reject(new Error("Google authorization was closed or blocked."))
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}
async function driveGet(url) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token() } });
  if (!response.ok) throw new Error("Drive folder verification failed (HTTP " + response.status + ").");
  return response.json();
}
function openPicker() {
  validateGoogleConfig(GOOGLE_CONFIG);
  const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMimeTypes(FOLDER_MIME);
  const picker = new window.google.picker.PickerBuilder()
    .addView(folderView)
    .setOAuthToken(token())
    .setDeveloperKey(GOOGLE_CONFIG.apiKey)
    .setAppId(GOOGLE_CONFIG.projectNumber)
    .setOrigin(window.location.origin)
    .setTitle("Choose a dedicated synthetic session-test folder")
    .setCallback((data) => {
      if (!data || data.action !== window.google.picker.Action.PICKED) {
        status("connection-status", "No folder selected.");
        return;
      }
      const item = data.docs && data.docs[0];
      if (!item || !item.id) {
        status("connection-status", "Picker returned no folder.", "error");
        return;
      }
      void verifyFolder(item);
    })
    .build();
  picker.setVisible(true);
}
async function verifyFolder(item) {
  try {
    const metadata = await driveGet(
      DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(item.id) + "?fields=id,name,mimeType"
    );
    if (!metadata || metadata.id !== item.id || metadata.mimeType !== FOLDER_MIME) {
      throw new Error("Select a Drive folder, not a file.");
    }
    if (metadata.name === PRODUCTION_FOLDER_NAME) {
      throw new Error("The production database folder is blocked. Select a separate synthetic test folder.");
    }
    const name = String(metadata.name || item.name || "Synthetic test folder");
    const confirmed = window.confirm(
      "Confirm that “" + name + "” is a dedicated synthetic test folder containing no personal financial data. The only file this page will create or update is " +
      "finance-tracker-active-session.json. Continue?"
    );
    if (!confirmed) {
      status("connection-status", "Folder selection cancelled. No Drive marker was accessed.", "warning");
      return;
    }
    clearCoordinator();
    state.folderId = metadata.id;
    state.folderName = name;
    state.adapter = createDriveSessionAdapter({
      accessToken: token(),
      folderId: state.folderId,
      fetchImpl: globalThis.fetch
    });
    state.coordinator = new SessionCoordinator({ adapter: state.adapter });
    setText("folder-state", state.folderName);
    status("connection-status", "Selected synthetic folder: " + state.folderName + ". Ready to inspect the session marker.", "success");
    setActions();
  } catch (error) {
    status("connection-status", error instanceof Error ? error.message : "Could not verify the selected folder.", "error");
  }
}
function describeInspection(result) {
  const labels = {
    absent: "No marker",
    active: "Active",
    stale: "Stale",
    released: "Released",
    ambiguous: "Ambiguous",
    unknown: "Unknown"
  };
  setText("marker-state", labels[result.status] || result.status);
  if (result.status === "active" && result.record) {
    const sameOwner = state.coordinator.session?.sessionId === result.record.sessionId;
    if (!sameOwner) state.coordinator.ownership = "unknown";
    setText("owner-state", sameOwner
      ? (state.coordinator.canWrite ? "This page owns it" : "This page; ownership not verified")
      : "Another page/device");
  } else {
    if (["unknown", "ambiguous", "stale", "released", "absent"].includes(result.status)) {
      state.coordinator.ownership = "unknown";
    }
    setText("owner-state", state.coordinator.canWrite ? "This page owns it" : "Unowned");
  }
  const record = result.record;
  const details = record
    ? "Session ID: " + record.sessionId + "\nLast heartbeat: " + new Date(record.heartbeatAt).toLocaleString() +
      "\nExpires: " + new Date(record.expiresAt).toLocaleString()
    : "";
  status("inspect-status", "Drive inspection: " + result.status + (details ? "\n" + details : ""), 
    result.status === "active" && state.coordinator.session?.sessionId !== record?.sessionId ? "warning" :
    ["ambiguous", "unknown"].includes(result.status) ? "error" : "info");
}
async function inspect() {
  const sequence = ++state.inspectionSequence;
  // Do not leave a previous marker label visible while a newer Drive read is pending.
  state.lastInspection = null;
  setText("marker-state", "Inspecting…");
  setText("owner-state", "Ownership unknown");
  status("inspect-status", "Reading the complete Drive folder listing and session marker…");
  setActions();

  const result = await state.coordinator.inspect();
  // A later inspection or a successful acquire/recover/release may have superseded this read.
  if (sequence !== state.inspectionSequence) return result;

  state.lastInspection = result;
  describeInspection(result);
  setActions();
  return result;
}
async function runAction(buttonId, statusId, working, action) {
  const button = $(buttonId);
  button.disabled = true;
  status(statusId, working);
  try {
    await action();
  } catch (error) {
    status(statusId, error instanceof Error ? error.message : "The operation failed.", "error");
    if (error && error.code === "authorization-required") {
      state.accessToken = "";
      state.adapter = null;
      state.coordinator = null;
      setText("auth-state", "Reconnect required");
    }
  } finally {
    setActions();
  }
}

$("connect-google").addEventListener("click", async () => {
  $("connect-google").disabled = true;
  $("select-folder").disabled = true;
  clearCoordinator();
  state.accessToken = "";
  setText("auth-state", "Connecting…");
  status("connection-status", "Opening Google's authorization flow…");
  try {
    validateGoogleConfig(GOOGLE_CONFIG);
    const response = await requestToken(GOOGLE_CONFIG.clientId);
    state.accessToken = response.access_token;
    state.tokenExpiresAt = Date.now() + Number(response.expires_in || 0) * 1000;
    setText("auth-state", "Connected for this page");
    status("connection-status", "Google authorization succeeded. Choose the dedicated synthetic test folder.", "success");
  } catch (error) {
    setText("auth-state", "Not connected");
    status("connection-status", error instanceof Error ? error.message : "Could not connect to Google.", "error");
  } finally {
    $("connect-google").disabled = false;
    setActions();
  }
});
$("select-folder").addEventListener("click", () => {
  try { openPicker(); }
  catch (error) { status("connection-status", error instanceof Error ? error.message : "Could not open Google Picker.", "error"); }
});
$("inspect-session").addEventListener("click", () => runAction(
  "inspect-session", "inspect-status", "Reading the complete Drive folder listing and session marker…",
  async () => { await inspect(); }
));
$("acquire-session").addEventListener("click", () => runAction(
  "acquire-session", "acquire-status", "Attempting to acquire and verify this page's session…",
  async () => {
    const record = await state.coordinator.start();
    state.inspectionSequence += 1;
    state.lastInspection = { status: "active", record };
    setText("marker-state", "Active");
    setText("owner-state", "This page owns it");
    status("acquire-status", "PASS: session acquired and verified. Session ID: " + record.sessionId, "success");
    setActions();
  }
));
$("guarded-write").addEventListener("click", () => runAction(
  "guarded-write", "acquire-status", "Checking ownership before a guarded no-op…",
  async () => {
    await state.coordinator.withWrite(() => ({ executed: true }), { online: navigator.onLine });
    status("acquire-status", "PASS: the coordinator verified current ownership and admitted the guarded no-op. No additional Drive file was written.", "success");
  }
));
$("heartbeat-once").addEventListener("click", () => runAction(
  "heartbeat-once", "heartbeat-status", "Verifying ownership and refreshing the heartbeat…",
  async () => {
    const record = await state.coordinator.heartbeat();
    status("heartbeat-status", "PASS: heartbeat verified. Lease expires " + new Date(record.expiresAt).toLocaleTimeString() + ".", "success");
  }
));
$("heartbeat-start").addEventListener("click", () => {
  try {
    state.heartbeatStop = state.coordinator.startHeartbeat({
      onError: (error) => {
        state.heartbeatStop = null;
        status("heartbeat-status", "Heartbeat stopped; writes are disabled: " + error.message, "error");
        setText("owner-state", "Ownership unknown");
        setActions();
      }
    });
    status("heartbeat-status", "Automatic heartbeat started. The coordinator will refresh and verify the Drive marker approximately every 40 seconds.", "success");
  } catch (error) {
    status("heartbeat-status", error instanceof Error ? error.message : "Could not start heartbeat.", "error");
  }
  setActions();
});
$("heartbeat-stop").addEventListener("click", () => {
  if (state.heartbeatStop) state.heartbeatStop();
  state.heartbeatStop = null;
  status("heartbeat-status", "Automatic heartbeat stopped. The lease will expire unless you send another heartbeat or release the session.", "warning");
  setActions();
});
$("resume-session").addEventListener("click", () => runAction(
  "resume-session", "heartbeat-status", "Rechecking this page's exact prior session ID…",
  async () => {
    const record = await state.coordinator.resume();
    state.inspectionSequence += 1;
    state.lastInspection = { status: "active", record };
    setText("marker-state", "Active");
    setText("owner-state", "This page owns it");
    status("heartbeat-status", "PASS: the exact prior session ID is still active. Ownership has been re-established.", "success");
  }
));
$("recover-session").addEventListener("click", () => runAction(
  "recover-session", "recovery-status", "Rechecking stale state before explicit recovery…",
  async () => {
    const confirmed = window.confirm("Recover the stale session in “" + state.folderName + "”? This replaces the stale coordination marker and may race with a device that is still alive. Continue only if you have confirmed the other device is no longer active.");
    if (!confirmed) {
      status("recovery-status", "Recovery cancelled. No marker was changed.", "warning");
      return;
    }
    const record = await state.coordinator.recoverStale({ confirm: true });
    state.inspectionSequence += 1;
    state.lastInspection = { status: "active", record };
    setText("marker-state", "Active");
    setText("owner-state", "This page owns it");
    status("recovery-status", "PASS: stale session replaced and the new owner verified by read-back. Session ID: " + record.sessionId, "success");
  }
));
$("release-session").addEventListener("click", () => runAction(
  "release-session", "release-status", "Stopping heartbeats, draining writes, and verifying release…",
  async () => {
    const result = await state.coordinator.release();
    state.heartbeatStop = null;
    state.inspectionSequence += 1;
    state.lastInspection = { status: "released", record: null };
    setText("marker-state", "Released");
    setText("owner-state", "Unowned");
    status("release-status", result.released ? "PASS: release was verified. It is now safe to hand off to the other device." : "Release was not confirmed.", result.released ? "success" : "error");
  }
));
window.addEventListener("offline", () => {
  if (state.coordinator) void state.coordinator.assertCanWrite({ online: false }).catch(() => {});
  if (state.heartbeatStop) {
    state.heartbeatStop();
    state.heartbeatStop = null;
  }
  setText("owner-state", "Ownership unknown");
  status("heartbeat-status", "Browser reports offline. All guarded operations pass online:false and are refused until the same session ID is revalidated.", "warning");
  setActions();
});
window.addEventListener("online", () => {
  status("heartbeat-status", "Browser is online again. Press Revalidate after reconnect before attempting any guarded operation.", "warning");
});
$("connect-google").disabled = true;
setActions();
loadGoogleLibraries().then(() => {
  $("connect-google").disabled = false;
  status("connection-status", "Google services are ready. Connect with Google to begin.");
}).catch((error) => {
  status("connection-status", error instanceof Error ? error.message : "Google services could not load.", "error");
});
