import { GOOGLE_CONFIG } from "../js/google-config.js";
import {
  DRIVE_FILES_ENDPOINT,
  runSyntheticDriveProbe
} from "../js/drive-probe-core.mjs";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const state = {
  accessToken: "",
  tokenExpiresAt: 0,
  folderId: "",
  folderName: ""
};

const $ = (id) => document.getElementById(id);
const connectButton = $("connect-google");
const selectFolderButton = $("select-folder");
const runProbeButton = $("run-probe");
const folderStatus = $("folder-status");
const probeStatus = $("probe-status");

function setStatus(node, message, kind) {
  node.textContent = message;
  node.dataset.kind = kind || "info";
}

function getConfig() {
  return {
    clientId: String(GOOGLE_CONFIG.clientId || "").trim(),
    apiKey: String(GOOGLE_CONFIG.apiKey || "").trim(),
    projectNumber: String(GOOGLE_CONFIG.projectNumber || "").trim()
  };
}

function validateConfig(config) {
  if (!config.clientId) {
    throw new Error("Google sign-in is not configured for this deployment. Add the GOOGLE_OAUTH_CLIENT_ID Actions variable and redeploy.");
  }
  if (!config.apiKey) {
    throw new Error("Google Picker is not configured for this deployment. Add the GOOGLE_PICKER_API_KEY Actions variable and redeploy.");
  }
  if (!/^\d+$/.test(config.projectNumber)) {
    throw new Error("The Google Cloud project number for Picker is not configured correctly.");
  }
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
        reject(new Error("Google " + label + " did not load. Reload the page and try again."));
      }
    }, 50);
  });
}

async function ensureGoogleLibraries() {
  await Promise.all([
    waitFor(() => window.google && window.google.accounts && window.google.accounts.oauth2, "authorization library"),
    waitFor(() => window.gapi && typeof window.gapi.load === "function", "Drive Picker library")
  ]);
  await new Promise((resolve, reject) => {
    window.gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Google Picker could not load.")),
      timeout: 10000,
      ontimeout: () => reject(new Error("Google Picker timed out while loading."))
    });
  });
}

function requestAccessToken(clientId) {
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response && response.error) {
          reject(new Error("Google did not authorize Drive access."));
          return;
        }
        if (!response || !response.access_token) {
          reject(new Error("Google returned no Drive access token."));
          return;
        }
        resolve(response);
      },
      error_callback: () => reject(new Error("Google authorization was closed or blocked."))
    });
    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

function getUsableToken() {
  if (!state.accessToken || Date.now() >= state.tokenExpiresAt - 30000) {
    state.accessToken = "";
    throw new Error("The access token is missing or expired. Press Connect to authorize again.");
  }
  return state.accessToken;
}

async function driveGet(url, token) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  if (!response.ok) throw new Error("Drive folder check failed (HTTP " + response.status + ").");
  return response.json();
}

function handlePickerResponse(data) {
  if (!data || data.action !== window.google.picker.Action.PICKED) {
    setStatus(folderStatus, "No folder selected.", "info");
    return;
  }
  const item = data.docs && data.docs[0];
  if (!item || !item.id) {
    setStatus(folderStatus, "Picker returned no folder. Try again.", "error");
    return;
  }
  void verifySelectedFolder(item);
}

async function verifySelectedFolder(item) {
  try {
    const token = getUsableToken();
    const metadata = await driveGet(
      DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(item.id) + "?fields=id%2Cname%2CmimeType",
      token
    );
    if (metadata.mimeType !== FOLDER_MIME) {
      throw new Error("Select a folder from Drive, not a file.");
    }
    state.folderId = metadata.id;
    state.folderName = metadata.name || item.name || "Selected Drive folder";
    runProbeButton.disabled = false;
    setStatus(folderStatus, "Selected folder: " + state.folderName, "success");
    setStatus(probeStatus, "Ready. The test will touch only a temporary synthetic file.", "info");
  } catch (error) {
    state.folderId = "";
    state.folderName = "";
    runProbeButton.disabled = true;
    setStatus(folderStatus, error instanceof Error ? error.message : "Could not access that folder.", "error");
  }
}

function openFolderPicker() {
  try {
    const token = getUsableToken();
    const config = getConfig();
    const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME);
    const picker = new window.google.picker.PickerBuilder()
      .addView(folderView)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.projectNumber)
      .setOrigin(window.location.origin)
      .setTitle("Choose the Finance Tracker Drive folder")
      .setCallback(handlePickerResponse)
      .build();
    picker.setVisible(true);
  } catch (error) {
    setStatus(folderStatus, error instanceof Error ? error.message : "Could not open Google Picker.", "error");
  }
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  selectFolderButton.disabled = true;
  runProbeButton.disabled = true;
  state.accessToken = "";
  state.folderId = "";
  state.folderName = "";
  setStatus(folderStatus, "Opening Google account selection and authorization…", "info");
  try {
    const config = getConfig();
    validateConfig(config);
    const tokenResponse = await requestAccessToken(config.clientId);
    state.accessToken = tokenResponse.access_token;
    state.tokenExpiresAt = Date.now() + Number(tokenResponse.expires_in || 0) * 1000;
    selectFolderButton.disabled = false;
    setStatus(folderStatus, "Connected for this page session. Choose the target folder.", "success");
  } catch (error) {
    setStatus(folderStatus, error instanceof Error ? error.message : "Could not connect to Google Drive.", "error");
  } finally {
    connectButton.disabled = false;
  }
});

selectFolderButton.addEventListener("click", () => {
  try {
    getUsableToken();
    const config = getConfig();
    validateConfig(config);
    openFolderPicker();
  } catch (error) {
    setStatus(folderStatus, error instanceof Error ? error.message : "Could not open Google Picker.", "error");
  }
});

runProbeButton.addEventListener("click", async () => {
  runProbeButton.disabled = true;
  setStatus(probeStatus, "Writing and reading synthetic test data…", "info");
  try {
    const token = getUsableToken();
    const result = await runSyntheticDriveProbe({
      accessToken: token,
      folderId: state.folderId,
      confirmDelete: ({ fileName, roundTripVerified }) => {
        const summary = roundTripVerified
          ? "The synthetic file was written and read back successfully."
          : "The synthetic file could not be fully verified.";
        return window.confirm(
          summary + "\n\nDelete the temporary file " + fileName + " from the selected folder?"
        );
      }
    });
    if (result.cleanedUp) {
      setStatus(probeStatus, "PASS: Drive write and read-back matched. The temporary synthetic file was deleted.", "success");
    } else {
      setStatus(
        probeStatus,
        "PASS: Drive write and read-back matched. The temporary file remains in the selected folder as " + result.fileName + ".",
        "warning"
      );
    }
  } catch (error) {
    const result = error && error.probeResult;
    const suffix = result && result.cleanupSkipped
      ? " The temporary synthetic file remains as " + result.fileName + "."
      : "";
    setStatus(
      probeStatus,
      (error instanceof Error ? error.message : "Synthetic Drive check failed.") + suffix,
      "error"
    );
  } finally {
    runProbeButton.disabled = !state.folderId;
  }
});

connectButton.disabled = true;
setStatus(folderStatus, "Loading Google's authorization and Picker libraries…", "info");
setStatus(probeStatus, "No Drive read/write check has run.", "info");

ensureGoogleLibraries().then(() => {
  const config = getConfig();
  const configured = Boolean(config.clientId && config.apiKey && /^\d+$/.test(config.projectNumber));
  connectButton.disabled = !configured;
  if (configured) {
    setStatus(folderStatus, "Google is ready. Continue to choose your account and authorize Drive access.", "info");
  } else {
    setStatus(folderStatus, "Google connection is not configured for this deployment. Set the repository Actions variables and redeploy this branch.", "warning");
  }
}).catch((error) => {
  setStatus(folderStatus, error instanceof Error ? error.message : "Google services could not load.", "error");
});
