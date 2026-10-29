import { GOOGLE_CONFIG } from "../js/google-config.js?v=standalone-discovery-1";
import { discoverFoldersByExactName } from "../js/drive-folder-discovery.mjs?v=standalone-discovery-1";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const STORAGE_KEY = "finance-tracker.drive-folder-discovery.v1";
const state = {
  accessToken: "",
  tokenExpiresAt: 0,
  selectedFolderId: "",
  selectedFolderName: ""
};

const $ = (id) => document.getElementById(id);
const connectButton = $("connect-google");
const selectFolderButton = $("select-folder");
const clearReferenceButton = $("clear-reference");
const discoverButton = $("discover-folder");
const folderNameInput = $("folder-name");
const authStatus = $("auth-status");
const selectionStatus = $("selection-status");
const discoveryStatus = $("discovery-status");

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
  if (!config.clientId) throw new Error("Google sign-in is not configured for this deployment.");
  if (!config.apiKey) throw new Error("Google Picker is not configured for this deployment.");
  if (!/^\d+$/.test(config.projectNumber)) throw new Error("The Google Cloud project number is invalid.");
}

function loadSelection() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (
      saved &&
      typeof saved.folderId === "string" &&
      saved.folderId &&
      typeof saved.folderName === "string" &&
      saved.folderName
    ) {
      state.selectedFolderId = saved.folderId;
      state.selectedFolderName = saved.folderName;
      folderNameInput.value = saved.folderName;
      setStatus(
        selectionStatus,
        "Previous selection restored for comparison: " + saved.folderName + ". Reauthorize, then discover without Picker.",
        "info"
      );
    }
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
}

function saveSelection(folderId, folderName) {
  state.selectedFolderId = folderId;
  state.selectedFolderName = folderName;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ folderId, folderName }));
}

function clearSavedReference() {
  state.selectedFolderId = "";
  state.selectedFolderName = "";
  window.sessionStorage.removeItem(STORAGE_KEY);
  setStatus(selectionStatus, "Saved Picker comparison reference cleared. Discovery can now run without it.", "success");
  setStatus(discoveryStatus, "Ready to test independent discovery by folder name.", "info");
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
    waitFor(() => window.gapi && typeof window.gapi.load === "function", "Picker library")
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
    throw new Error("The access token is missing or expired. Press Continue with Google again.");
  }
  return state.accessToken;
}

function openFolderPicker() {
  const config = getConfig();
  const token = getUsableToken();
  const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMimeTypes(FOLDER_MIME_TYPE);
  const picker = new window.google.picker.PickerBuilder()
    .addView(folderView)
    .setOAuthToken(token)
    .setDeveloperKey(config.apiKey)
    .setAppId(config.projectNumber)
    .setOrigin(window.location.origin)
    .setTitle("Select the Finance Tracker folder for this experiment")
    .setCallback((data) => {
      if (!data || data.action !== window.google.picker.Action.PICKED) {
        setStatus(selectionStatus, "No folder selected.", "info");
        return;
      }
      const item = data.docs && data.docs[0];
      if (!item || !item.id) {
        setStatus(selectionStatus, "Picker returned no folder. Try again.", "error");
        return;
      }
      const name = String(item.name || "").trim();
      if (!name) {
        setStatus(selectionStatus, "Picker returned no folder name. Try again.", "error");
        return;
      }
      try {
        saveSelection(item.id, name);
        folderNameInput.value = name;
        setStatus(selectionStatus, "Selected folder saved for this tab's reload test: " + name + ".", "success");
        setStatus(discoveryStatus, "Ready. Run discovery now, then reload and repeat after authorization.", "info");
      } catch {
        setStatus(selectionStatus, "The browser could not retain the temporary comparison reference.", "error");
      }
    })
    .build();
  picker.setVisible(true);
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  selectFolderButton.disabled = true;
  discoverButton.disabled = true;
  state.accessToken = "";
  setStatus(authStatus, "Opening Google's authorization flow…", "info");
  try {
    const config = getConfig();
    validateConfig(config);
    const tokenResponse = await requestAccessToken(config.clientId);
    state.accessToken = tokenResponse.access_token;
    state.tokenExpiresAt = Date.now() + Number(tokenResponse.expires_in || 0) * 1000;
    selectFolderButton.disabled = false;
    discoverButton.disabled = false;
    setStatus(authStatus, "Authorized for this page session. The token remains in memory only.", "success");
    if (state.selectedFolderId) {
      setStatus(
        selectionStatus,
        "Previous selection restored for comparison: " + state.selectedFolderName + ". Discovery can run without Picker.",
        "info"
      );
    }
  } catch (error) {
    setStatus(authStatus, error instanceof Error ? error.message : "Could not authorize Google Drive.", "error");
  } finally {
    connectButton.disabled = false;
  }
});

clearReferenceButton.addEventListener("click", clearSavedReference);

selectFolderButton.addEventListener("click", () => {
  try {
    getUsableToken();
    openFolderPicker();
  } catch (error) {
    setStatus(selectionStatus, error instanceof Error ? error.message : "Could not open Google Picker.", "error");
  }
});

discoverButton.addEventListener("click", async () => {
  discoverButton.disabled = true;
  setStatus(discoveryStatus, "Searching Drive for the exact folder name…", "info");
  try {
    const result = await discoverFoldersByExactName({
      accessToken: getUsableToken(),
      folderName: folderNameInput.value
    });
    if (result.matchCount === 0) {
      setStatus(
        discoveryStatus,
        "NO MATCH: Drive returned no accessible folder with that exact name. This does not prove the folder is absent.",
        "warning"
      );
    } else if (result.matchCount > 1) {
      setStatus(
        discoveryStatus,
        "AMBIGUOUS: Drive returned " + result.matchCount + " exact-name folders. The app did not choose one.",
        "warning"
      );
    } else if (!state.selectedFolderId) {
      setStatus(
        discoveryStatus,
        "FOUND: Drive returned one exact-name folder without using a saved Picker reference. The folder name was unique in the accessible results; no file was changed.",
        "success"
      );
    } else if (result.match.id === state.selectedFolderId) {
      setStatus(
        discoveryStatus,
        "PASS: One exact-name folder was found and its identity matches the folder selected before reload. No file was changed.",
        "success"
      );
    } else {
      setStatus(
        discoveryStatus,
        "MISMATCH: One exact-name folder was found, but it is not the folder selected before reload. No file was changed.",
        "error"
      );
    }
  } catch (error) {
    setStatus(
      discoveryStatus,
      error instanceof Error ? error.message : "Drive folder discovery failed.",
      "error"
    );
  } finally {
    discoverButton.disabled = !state.accessToken;
  }
});

loadSelection();
connectButton.disabled = true;
selectFolderButton.disabled = true;
discoverButton.disabled = true;
setStatus(authStatus, "Loading Google's authorization and Picker libraries…", "info");
setStatus(discoveryStatus, "No folder discovery query has run.", "info");

ensureGoogleLibraries().then(() => {
  connectButton.disabled = false;
  setStatus(authStatus, "Google services are ready. Continue with Google to begin.", "info");
}).catch((error) => {
  setStatus(authStatus, error instanceof Error ? error.message : "Google services could not load.", "error");
});
