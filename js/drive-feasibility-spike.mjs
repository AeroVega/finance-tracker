// Historical filename retained for the shared bounded Drive listing primitive.
import {markRequestPurpose} from './drive-request-metrics.mjs';
import { createDriveResponseLimits, readBoundedDriveJson, discardDriveResponse } from "./drive-response-transport.mjs";
export const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveFeasibilityError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "DriveFeasibilityError";
    this.code = code;
    this.status = status;
  }
}

function authHeaders(accessToken) {
  if (!accessToken) throw new DriveFeasibilityError("missing-token", "A Google Drive access token is required.");
  return { Authorization: "Bearer " + accessToken };
}

async function requireOk(response, operation) {
  if (!response || !response.ok) {
    await discardDriveResponse(response);
    const status = response && Number.isInteger(response.status) ? response.status : null;
    throw new DriveFeasibilityError(
      status === 401 ? "authorization-required" : status === 403 ? "permission-denied" : "http-error",
      "Drive " + operation + " failed" + (status === null ? "." : " (HTTP " + status + ")."),
      status
    );
  }
}

async function readJson(response, operation, kind = "metadata", limits) {
  try {
    return await readBoundedDriveJson(response, { kind, limits });
  } catch (error) {
    if (error.code !== "invalid-json-object") throw error;
    throw new DriveFeasibilityError("invalid-response", "Drive returned an unreadable response for " + operation + ".");
  }
}

export async function listFolderChildren(options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const folderId = String(settings.folderId || "");
  if (!folderId) throw new DriveFeasibilityError("missing-folder", "Select a Drive folder first.");
  if (typeof fetchImpl !== "function") throw new DriveFeasibilityError("fetch-unavailable", "Fetch is unavailable.");

  const limits = createDriveResponseLimits(settings.responseLimits);
  const headers = authHeaders(settings.accessToken);
  const quote = value => "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  let purpose='inventory-list';
  let query = quote(folderId) + " in parents and trashed = false";
  // Session ownership needs every candidate marker, not every ledger object.
  // Match either identifying field so malformed/name-only markers remain visible.
  if (settings.markerFilter) {
    purpose='owner-list';
    const {name, property, value} = settings.markerFilter;
    if (![name, property, value].every(value => typeof value === "string" && value.length > 0)) {
      throw new DriveFeasibilityError("invalid-filter", "A complete marker filter is required.");
    }
    query += " and (name = " + quote(name) + " or appProperties has { key=" + quote(property) + " and value=" + quote(value) + " })";
  }
  const files = [];
  const seenTokens = new Set();
  let pageToken = "";

  do {
    settings.signal?.throwIfAborted();
    const params = new URLSearchParams({
      q: query,
      pageSize: String(Math.min(1000, Math.max(1, Number(settings.pageSize) || 1000))),
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,size,md5Checksum,version,appProperties)"
    });
    if (pageToken) params.set("pageToken", pageToken);

    let response;
    try {
      response = await fetchImpl(DRIVE_FILES_ENDPOINT + "?" + params.toString(), markRequestPurpose({ method: "GET", headers, cache: "no-store", ...(settings.signal ? {signal: settings.signal} : {}) },purpose));
    } catch {
      throw new DriveFeasibilityError("network-error", "Could not reach Google Drive while listing the selected folder.");
    }
    await requireOk(response, "folder-child enumeration");
    const payload = await readJson(response, "folder-child enumeration", "list-page", limits);
    if (!payload || !Array.isArray(payload.files) || payload.files.length > Number(params.get("pageSize")) ||
        (payload.nextPageToken != null && typeof payload.nextPageToken !== "string")) {
      throw new DriveFeasibilityError("invalid-response", "Drive returned an unexpected folder listing.");
    }
    if (payload.incompleteSearch !== false) {
      throw new DriveFeasibilityError("incomplete-search", "Drive did not explicitly confirm that the folder listing is complete. The folder cannot be treated as empty or fully enumerated.");
    }
    files.push(...payload.files);
    const next = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
    if (next && seenTokens.has(next)) {
      throw new DriveFeasibilityError("pagination-loop", "Drive repeated a page token. Enumeration stopped rather than claiming completeness.");
    }
    if (next) seenTokens.add(next);
    pageToken = next;
  } while (pageToken);

  return files;
}
