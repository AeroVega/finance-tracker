import { GOOGLE_CONFIG } from "../js/google-config.js";
import { validateGoogleConfig } from "../js/google-config-validation.mjs";
import {
  DRIVE_FILES_ENDPOINT,
  createSyntheticObject,
  createRaceTarget,
  listFolderChildren,
  readRaceTarget,
  attemptConditionalWrite,
  deleteSyntheticFile
} from "../js/drive-feasibility-spike.mjs";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const state = {
  accessToken: "",
  tokenExpiresAt: 0,
  folderId: "",
  folderName: "",
  raceEtag: "",
  raceVersion: "",
  createdFileIds: new Set()
};
const $ = (id) => document.getElementById(id);

function status(id, message, kind = "info") {
  const node = $(id);
  node.textContent = message;
  node.dataset.kind = kind;
}
function validateConfig() {
  if (!GOOGLE_CONFIG.clientId) throw new Error("The deployed Google OAuth client ID is missing. Check the repository's deployment configuration.");
  if (!GOOGLE_CONFIG.apiKey) throw new Error("The deployed restricted Picker API key is missing. Check the repository's deployment configuration.");
  if (!/^\\d+$/.test(GOOGLE_CONFIG.projectNumber)) throw new Error("The deployed Google Cloud project number is missing or invalid.");
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
    client.requestAccessToken();
  });
}
function token() {
  if (!state.accessToken || Date.now() >= state.tokenExpiresAt - 30000) {
    state.accessToken = "";
    throw new Error("The access token is missing or expired. Reconnect with Google.");
  }
  return state.accessToken;
}
async function driveGet(url) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token() } });
  if (!response.ok) throw new Error("Drive folder verification failed (HTTP " + response.status + ").");
  return response.json();
}
function setReady(ready) {
  ["list-children", "create-object", "create-race", "read-race", "reread-race"].forEach((id) => {
    $(id).disabled = !ready;
  });
  $("cleanup").disabled = !state.accessToken || !state.createdFileIds.size;
  $("attempt-write").disabled = !ready || !state.raceEtag;
}
function onPicker(data) {
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
}
async function verifyFolder(item) {
  try {
    const metadata = await driveGet(
      DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(item.id) + "?fields=id,name,mimeType"
    );
    if (metadata.mimeType !== FOLDER_MIME) throw new Error("Select a Drive folder, not a file.");
    if (!window.confirm("Confirm that “" + (metadata.name || item.name || "this folder") + "” is a dedicated synthetic test folder containing no personal financial data. Continue?")) {
      state.folderId = "";
      setReady(false);
      status("connection-status", "Folder selection cancelled. Choose a dedicated synthetic test folder.", "warning");
      return;
    }
    state.folderId = metadata.id;
    state.folderName = metadata.name || item.name || "Selected test folder";
    setReady(true);
    status("connection-status", "Selected test folder: " + state.folderName, "success");
  } catch (error) {
    state.folderId = "";
    setReady(false);
    status("connection-status", error instanceof Error ? error.message : "Could not access the selected folder.", "error");
  }
}
function openPicker() {
  validateConfig();
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
    .setTitle("Choose a dedicated synthetic test folder")
    .setCallback(onPicker)
    .build();
  picker.setVisible(true);
}

$("connect-google").addEventListener("click", async () => {
  $("connect-google").disabled = true;
  $("select-folder").disabled = true;
  state.accessToken = "";
  state.folderId = "";
  state.raceEtag = "";
  state.raceVersion = "";
  setReady(false);
  status("connection-status", "Opening Google's authorization flow…");
  try {
    validateConfig();
    const response = await requestToken(GOOGLE_CONFIG.clientId);
    state.accessToken = response.access_token;
    state.tokenExpiresAt = Date.now() + Number(response.expires_in || 0) * 1000;
    $("cleanup").disabled = !state.createdFileIds.size;
    $("select-folder").disabled = false;
    status("connection-status", "Connected for this page session. Choose a dedicated test folder.", "success");
  } catch (error) {
    status("connection-status", error instanceof Error ? error.message : "Could not connect to Google.", "error");
  } finally {
    $("connect-google").disabled = false;
  }
});
$("select-folder").addEventListener("click", () => {
  try { openPicker(); }
  catch (error) { status("connection-status", error instanceof Error ? error.message : "Could not open Picker.", "error"); }
});

$("list-children").addEventListener("click", async () => {
  $("list-children").disabled = true;
  status("listing-status", "Enumerating every visible child page…");
  try {
    const files = await listFolderChildren({ accessToken: token(), folderId: state.folderId });
    status("listing-status", "PASS: complete listing returned " + files.length + " child item(s). Names are not treated as unique IDs.", "success");
  } catch (error) {
    status("listing-status", error instanceof Error ? error.message : "Folder enumeration failed.", "error");
  } finally { $("list-children").disabled = false; }
});

$("create-object").addEventListener("click", async () => {
  $("create-object").disabled = true;
  status("object-status", "Creating synthetic object, discarding the first response, retrying, and verifying SHA-256…");
  try {
    const result = await createSyntheticObject({
      accessToken: token(),
      folderId: state.folderId,
      fileName: "finance-tracker-spike-object-" + crypto.randomUUID() + ".txt",
      content: "Synthetic Drive feasibility payload. No personal or financial data.\n",
      simulateLostResponse: true
    });
    state.createdFileIds.add(result.fileId);
    $("cleanup").disabled = false;
    status("object-status", "PASS: retry returned HTTP 409; the existing object was read back and its exact SHA-256 verified. File ID: " + result.fileId + " · SHA-256: " + result.sha256, "success");
  } catch (error) {
    if (error && error.fileId) { state.createdFileIds.add(error.fileId); $("cleanup").disabled = false; }
    status("object-status", error instanceof Error ? error.message + (error.fileId ? " Temporary file ID: " + error.fileId : "") : "Synthetic object test failed.", "error");
  } finally { $("create-object").disabled = false; }
});

$("create-race").addEventListener("click", async () => {
  $("create-race").disabled = true;
  status("race-read-status", "Creating a disposable race-test file…");
  try {
    const result = await createRaceTarget({
      accessToken: token(),
      folderId: state.folderId,
      runId: crypto.randomUUID(),
      fetchImpl: globalThis.fetch
    });
    state.createdFileIds.add(result.fileId);
    $("race-file-id").value = result.fileId;
    $("cleanup").disabled = false;
    status("race-read-status", "Created synthetic race-test file. Share this ID with the second session: " + result.fileId, "success");
  } catch (error) {
    if (error && error.fileId) { state.createdFileIds.add(error.fileId); $("cleanup").disabled = false; }
    status("race-read-status", error instanceof Error ? error.message + (error.fileId ? " Temporary file ID: " + error.fileId : "") : "Could not create race-test file.", "error");
  } finally { $("create-race").disabled = false; }
});

$("read-race").addEventListener("click", async () => {
  $("read-race").disabled = true;
  state.raceEtag = "";
  state.raceVersion = "";
  try {
    const result = await readRaceTarget({ accessToken: token(), fileId: $("race-file-id").value.trim(), expectedFolderId: state.folderId });
    state.raceEtag = result.etag || "";
    state.raceVersion = result.version || "";
    const etagText = result.etagVisible ? result.etag : "not exposed to browser";
    status(
      "race-read-status",
      "Baseline read: version " + (result.version || "unavailable") + " · ETag " + etagText +
        " · description " + result.description,
      result.etagVisible ? "success" : "warning"
    );
    $("attempt-write").disabled = !result.etagVisible;
  } catch (error) {
    status("race-read-status", error instanceof Error ? error.message : "Could not read race-test file.", "error");
  } finally { $("read-race").disabled = false; }
});

$("attempt-write").addEventListener("click", async () => {
  $("attempt-write").disabled = true;
  status("race-write-status", "Sending conditional update with the captured baseline ETag…");
  const writerMarker = "synthetic-writer-" + crypto.randomUUID();
  try {
    const result = await attemptConditionalWrite({
      accessToken: token(),
      fileId: $("race-file-id").value.trim(),
      expectedFolderId: state.folderId,
      etag: state.raceEtag,
      writerMarker
    });
    const kind = result.outcome === "updated" ? "success" :
      result.outcome === "precondition-failed" ? "warning" : "error";
    status("race-write-status", "Conditional-write result: " + result.outcome + " (HTTP " + (result.status || "unknown") + "). Writer marker: " + writerMarker, kind);
  } catch (error) {
    status("race-write-status", error instanceof Error ? error.message : "Conditional write failed.", "error");
  }
});

$("reread-race").addEventListener("click", async () => {
  $("reread-race").disabled = true;
  try {
    const result = await readRaceTarget({ accessToken: token(), fileId: $("race-file-id").value.trim(), expectedFolderId: state.folderId });
    status("race-write-status", "Final state: version " + (result.version || "unavailable") + " · description " + result.description + " · ETag " + (result.etag || "not exposed"), "success");
  } catch (error) {
    status("race-write-status", error instanceof Error ? error.message : "Could not read final state.", "error");
  } finally { $("reread-race").disabled = false; }
});

$("cleanup").addEventListener("click", async () => {
  if (!state.createdFileIds.size) {
    status("cleanup-status", "No temporary files were created by this session.");
    return;
  }
  const ids = Array.from(state.createdFileIds);
  if (!window.confirm("Delete " + ids.length + " synthetic test file(s) created by this browser session?")) return;
  $("cleanup").disabled = true;
  const failures = [];
  for (const fileId of ids) {
    try { await deleteSyntheticFile({ accessToken: token(), fileId }); }
    catch { failures.push(fileId); }
  }
  if (failures.length) {
    state.createdFileIds = new Set(failures);
    status("cleanup-status", "Some files could not be deleted. Remaining IDs: " + failures.join(", "), "warning");
  } else {
    state.createdFileIds.clear();
    status("cleanup-status", "All synthetic files created by this session were deleted or already absent.", "success");
  }
  $("cleanup").disabled = !state.createdFileIds.size;
});

$("connect-google").disabled = true;
setReady(false);
loadGoogleLibraries().then(() => {
  $("connect-google").disabled = false;
  status("connection-status", "Google services are ready. Enter the Cloud configuration, then connect.");
}).catch((error) => {
  status("connection-status", error instanceof Error ? error.message : "Google services could not load.", "error");
});
