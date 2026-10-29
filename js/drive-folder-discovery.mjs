export const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export class DriveFolderDiscoveryError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "DriveFolderDiscoveryError";
    this.code = code;
    this.status = status;
  }
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function makeFolderQuery(folderName) {
  return [
    "name = '" + escapeDriveQueryValue(folderName) + "'",
    "mimeType = '" + FOLDER_MIME_TYPE + "'",
    "trashed = false"
  ].join(" and ");
}

function requireOk(response) {
  if (!response || !response.ok) {
    const status = response && Number.isInteger(response.status) ? response.status : null;
    if (status === 401) {
      throw new DriveFolderDiscoveryError(
        "authorization-required",
        "Google authorization expired or was rejected. Reconnect with Google, then retry discovery.",
        status
      );
    }
    if (status === 403) {
      throw new DriveFolderDiscoveryError(
        "permission-denied",
        "Google denied access to the folder search. Check the selected account and Drive permission; no folder was selected.",
        status
      );
    }
    throw new DriveFolderDiscoveryError(
      "http-error",
      "Drive folder discovery failed" + (status === null ? "" : " (HTTP " + status + ")") + ". Retry or choose the intended folder with Google Picker.",
      status
    );
  }
}

export function classifyFolderDiscoveryResult(result) {
  if (!result || !Number.isInteger(result.matchCount) || result.matchCount < 0) {
    return { status: "invalid-result", mayUsePicker: true, candidate: null };
  }
  if (result.matchCount === 0) {
    return { status: "not-found", mayUsePicker: true, candidate: null };
  }
  if (result.matchCount > 1) {
    return { status: "ambiguous", mayUsePicker: true, candidate: null };
  }
  if (!result.match || typeof result.match.id !== "string" || !result.match.id) {
    return { status: "invalid-result", mayUsePicker: true, candidate: null };
  }
  return {
    status: "candidate-found",
    mayUsePicker: false,
    candidate: result.match,
    requiresIdentityVerification: true
  };
}

export async function discoverFoldersByExactName(options) {
  const settings = options || {};
  const accessToken = settings.accessToken;
  const folderName = String(settings.folderName || "").trim();
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const endpoint = settings.endpoint || DRIVE_FILES_ENDPOINT;

  if (!accessToken) {
    throw new DriveFolderDiscoveryError("missing-token", "A Google Drive access token is required.");
  }
  if (!folderName) {
    throw new DriveFolderDiscoveryError("missing-folder-name", "Enter the exact folder name to search for.");
  }
  if (typeof fetchImpl !== "function") {
    throw new DriveFolderDiscoveryError("fetch-unavailable", "Fetch is unavailable in this browser.");
  }

  const matches = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: makeFolderQuery(folderName),
      pageSize: "100",
      fields: "nextPageToken,files(id,name,mimeType)"
    });
    if (pageToken) params.set("pageToken", pageToken);
    let response;
    try {
      response = await fetchImpl(endpoint + "?" + params.toString(), {
        method: "GET",
        headers: { Authorization: "Bearer " + accessToken }
      });
    } catch {
      throw new DriveFolderDiscoveryError(
        "network-error",
        "Could not reach Google Drive. Check your connection and retry; no folder was selected."
      );
    }
    requireOk(response);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new DriveFolderDiscoveryError("invalid-response", "Drive folder discovery returned an unreadable response.");
    }
    if (!payload || !Array.isArray(payload.files)) {
      throw new DriveFolderDiscoveryError("invalid-response", "Drive folder discovery returned an unexpected response.");
    }
    for (const file of payload.files) {
      if (
        file &&
        file.mimeType === FOLDER_MIME_TYPE &&
        file.name === folderName &&
        typeof file.id === "string" &&
        file.id.length > 0
      ) {
        matches.push({ id: file.id, name: file.name, mimeType: file.mimeType });
      }
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
  } while (pageToken);

  return {
    folderName,
    matchCount: matches.length,
    match: matches.length === 1 ? matches[0] : null
  };
}
