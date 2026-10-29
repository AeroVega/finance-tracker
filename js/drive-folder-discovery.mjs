export const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

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
    const status = response && response.status ? response.status : "unknown";
    throw new Error("Drive folder discovery failed (HTTP " + status + ").");
  }
}

export async function discoverFoldersByExactName(options) {
  const settings = options || {};
  const accessToken = settings.accessToken;
  const folderName = String(settings.folderName || "").trim();
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const endpoint = settings.endpoint || DRIVE_FILES_ENDPOINT;

  if (!accessToken) throw new Error("A Google Drive access token is required.");
  if (!folderName) throw new Error("Enter the exact folder name to search for.");
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this browser.");

  const matches = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: makeFolderQuery(folderName),
      pageSize: "100",
      fields: "nextPageToken,files(id,name,mimeType)"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchImpl(endpoint + "?" + params.toString(), {
      method: "GET",
      headers: { Authorization: "Bearer " + accessToken }
    });
    requireOk(response);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.files)) {
      throw new Error("Drive folder discovery returned an unexpected response.");
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
