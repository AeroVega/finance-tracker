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

function requireOk(response, operation) {
  if (!response || !response.ok) {
    const status = response && Number.isInteger(response.status) ? response.status : null;
    throw new DriveFeasibilityError(
      status === 401 ? "authorization-required" : status === 403 ? "permission-denied" : "http-error",
      "Drive " + operation + " failed" + (status === null ? "." : " (HTTP " + status + ")."),
      status
    );
  }
}

async function readJson(response, operation) {
  try {
    return await response.json();
  } catch {
    throw new DriveFeasibilityError("invalid-response", "Drive returned an unreadable response for " + operation + ".");
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    throw new DriveFeasibilityError("crypto-unavailable", "Web Crypto SHA-256 is unavailable.");
  }
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function listFolderChildren(options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const folderId = String(settings.folderId || "");
  if (!folderId) throw new DriveFeasibilityError("missing-folder", "Select a Drive folder first.");
  if (typeof fetchImpl !== "function") throw new DriveFeasibilityError("fetch-unavailable", "Fetch is unavailable.");

  const headers = authHeaders(settings.accessToken);
  const files = [];
  const seenTokens = new Set();
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      q: "'" + folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "' in parents and trashed = false",
      pageSize: String(Math.min(1000, Math.max(1, Number(settings.pageSize) || 1000))),
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,size,md5Checksum,version,appProperties)"
    });
    if (pageToken) params.set("pageToken", pageToken);

    let response;
    try {
      response = await fetchImpl(DRIVE_FILES_ENDPOINT + "?" + params.toString(), { method: "GET", headers });
    } catch {
      throw new DriveFeasibilityError("network-error", "Could not reach Google Drive while listing the selected folder.");
    }
    requireOk(response, "folder-child enumeration");
    const payload = await readJson(response, "folder-child enumeration");
    if (!payload || !Array.isArray(payload.files)) {
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

async function generateFileId(accessToken, fetchImpl) {
  const response = await fetchImpl(DRIVE_FILES_ENDPOINT + "/generateIds?count=1&space=drive", {
    method: "GET",
    headers: authHeaders(accessToken)
  });
  requireOk(response, "pre-generated file ID request");
  const payload = await readJson(response, "pre-generated file ID request");
  if (!payload || !Array.isArray(payload.ids) || typeof payload.ids[0] !== "string" || !payload.ids[0]) {
    throw new DriveFeasibilityError("invalid-generated-id", "Drive did not return a usable pre-generated file ID.");
  }
  return payload.ids[0];
}

function multipartBody(boundary, metadata, content) {
  return new Blob([
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata) + "\r\n",
    "--" + boundary + "\r\n",
    "Content-Type: application/octet-stream\r\n\r\n",
    content,
    "\r\n--" + boundary + "--\r\n"
  ]);
}

async function readSyntheticFile({ accessToken, fileId, expectedHash, expectedFolderId, fetchImpl }) {
  const headers = authHeaders(accessToken);
  const metadataResponse = await fetchImpl(
    DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(fileId) +
      "?fields=id,name,mimeType,parents,description,appProperties,version",
    { method: "GET", headers }
  );
  requireOk(metadataResponse, "synthetic object metadata verification");
  const metadata = await readJson(metadataResponse, "synthetic object metadata verification");
  if (!metadata || metadata.id !== fileId) {
    throw new DriveFeasibilityError("metadata-mismatch", "The pre-generated ID did not resolve to the expected Drive file.");
  }
  if (expectedFolderId && (!Array.isArray(metadata.parents) || !metadata.parents.includes(expectedFolderId))) {
    throw new DriveFeasibilityError("parent-mismatch", "The synthetic object is not in the selected test folder.");
  }

  const contentResponse = await fetchImpl(
    DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(fileId) + "?alt=media",
    { method: "GET", headers }
  );
  requireOk(contentResponse, "synthetic object read-back");
  const contentBytes = new Uint8Array(await contentResponse.arrayBuffer());
  const actualHash = await sha256Hex(contentBytes);
  const content = new TextDecoder().decode(contentBytes);
  if (actualHash !== expectedHash) {
    throw new DriveFeasibilityError("hash-mismatch", "The synthetic object's raw-byte SHA-256 did not match the expected value.");
  }
  return { metadata, content, sha256: actualHash };
}

export async function createSyntheticObject(options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const accessToken = settings.accessToken;
  const folderId = String(settings.folderId || "");
  const content = String(settings.content || "");
  const fileName = String(settings.fileName || "finance-tracker-spike-object.txt");
  if (!folderId) throw new DriveFeasibilityError("missing-folder", "Select a Drive folder first.");
  if (!fileName.startsWith("finance-tracker-spike-")) {
    throw new DriveFeasibilityError("unsafe-name", "Synthetic feasibility files must use the finance-tracker-spike- prefix.");
  }
  if (typeof fetchImpl !== "function") throw new DriveFeasibilityError("fetch-unavailable", "Fetch is unavailable.");

  const expectedHash = await sha256Hex(content);
  const fileId = await generateFileId(accessToken, fetchImpl);
  const boundary = "finance_tracker_spike_" + fileId.replace(/[^a-zA-Z0-9]/g, "");
  const metadata = {
    id: fileId,
    name: fileName,
    mimeType: "application/octet-stream",
    parents: [folderId],
    description: "Temporary synthetic Finance Tracker storage-feasibility test file.",
    appProperties: {
      financeTrackerSpike: "synthetic-only",
      contentSha256: expectedHash
    }
  };
  if (settings.description) metadata.description = String(settings.description);

  const request = () => fetchImpl(
    DRIVE_UPLOAD_ENDPOINT + "?uploadType=multipart&fields=id%2Cname%2CmimeType%2Cparents%2CappProperties%2Cversion",
    {
      method: "POST",
      headers: Object.assign({}, authHeaders(accessToken), {
        "Content-Type": "multipart/related; boundary=" + boundary
      }),
      body: multipartBody(boundary, metadata, content)
    }
  );

  let createResponse;
  try {
    if (settings.simulateLostResponse === true) {
      createResponse = await request();
      if (!createResponse || !createResponse.ok) {
        requireOk(createResponse, "first synthetic object creation");
      }
      // Deliberately discard the successful response to model a lost response.
      createResponse = await request();
      if (!createResponse || createResponse.status !== 409) {
        throw new DriveFeasibilityError("retry-not-conflict", "Retrying the same pre-generated ID did not return the expected HTTP 409.");
      }
    } else {
      try {
        createResponse = await request();
      } catch {
        // The outcome is unknown. Retry only with the exact same pre-generated ID.
        createResponse = await request();
      }
      if (!createResponse || (!createResponse.ok && createResponse.status !== 409)) {
        requireOk(createResponse, "synthetic object creation");
      }
    }
  } catch (error) {
    if (error && typeof error === "object") {
      error.fileId = fileId;
      error.fileName = fileName;
    }
    throw error;
  }

  let verified;
  try {
    verified = await readSyntheticFile({
      accessToken,
      fileId,
      expectedHash,
      expectedFolderId: folderId,
      fetchImpl
    });
    if (verified.content !== content) {
      throw new DriveFeasibilityError("content-mismatch", "The synthetic object content differed after read-back.");
    }
  } catch (error) {
    if (error && typeof error === "object") {
      error.fileId = fileId;
      error.fileName = fileName;
    }
    throw error;
  }
  return { fileId, fileName, sha256: expectedHash, retryReturned409: createResponse.status === 409, verified: true };
}

export async function createRaceTarget(options) {
  const settings = options || {};
  const marker = "finance-tracker-race-base-" + String(settings.runId || Date.now());
  const result = await createSyntheticObject({
    ...settings,
    fileName: "finance-tracker-spike-race-" + String(settings.runId || Date.now()) + ".txt",
    content: "Synthetic race-test content. No financial data.",
    description: marker
  });
  return { ...result, baseMarker: marker };
}

export async function readRaceTarget(options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const fileId = String(settings.fileId || "");
  if (!fileId) throw new DriveFeasibilityError("missing-file-id", "Enter the shared synthetic race-test file ID.");
  const response = await fetchImpl(
    DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(fileId) +
      "?fields=id,name,description,version,parents,appProperties",
    { method: "GET", headers: authHeaders(settings.accessToken) }
  );
  requireOk(response, "race target read");
  const metadata = await readJson(response, "race target read");
  if (
    !metadata ||
    metadata.id !== fileId ||
    typeof metadata.name !== "string" ||
    !metadata.name.startsWith("finance-tracker-spike-race-") ||
    !metadata.appProperties ||
    metadata.appProperties.financeTrackerSpike !== "synthetic-only"
  ) {
    throw new DriveFeasibilityError("unsafe-race-target", "The selected file is not a Finance Tracker synthetic race-test file. No update was attempted.");
  }
  if (settings.expectedFolderId && (!Array.isArray(metadata.parents) || !metadata.parents.includes(settings.expectedFolderId))) {
    throw new DriveFeasibilityError("race-folder-mismatch", "The synthetic race-test file is not in the selected test folder. No update was attempted.");
  }
  const etag = response.headers && typeof response.headers.get === "function"
    ? response.headers.get("etag")
    : null;
  return {
    id: metadata.id,
    name: metadata.name,
    synthetic: true,
    description: metadata.description || "",
    version: metadata.version || null,
    etag,
    etagVisible: Boolean(etag)
  };
}

export async function attemptConditionalWrite(options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  if (!settings.fileId) throw new DriveFeasibilityError("missing-file-id", "Enter the shared synthetic race-test file ID.");
  if (!settings.etag) return { outcome: "etag-unavailable", status: null };
  await readRaceTarget({
    accessToken: settings.accessToken,
    fileId: settings.fileId,
    expectedFolderId: settings.expectedFolderId,
    fetchImpl
  });

  let response;
  try {
    response = await fetchImpl(
      DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(settings.fileId) + "?fields=id,description,version",
      {
        method: "PATCH",
        headers: Object.assign({}, authHeaders(settings.accessToken), {
          "Content-Type": "application/json",
          "If-Match": String(settings.etag)
        }),
        body: JSON.stringify({ description: String(settings.writerMarker) })
      }
    );
  } catch {
    return { outcome: "network-unknown", status: null };
  }

  if (response.status === 412) return { outcome: "precondition-failed", status: 412 };
  if (response.ok) return { outcome: "updated", status: response.status };
  return { outcome: "http-error", status: response.status };
}

export async function deleteSyntheticFile(options) {
  const settings = options || {};
  const response = await (settings.fetchImpl || globalThis.fetch)(
    DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(settings.fileId),
    { method: "DELETE", headers: authHeaders(settings.accessToken) }
  );
  if (!response || !(response.ok || response.status === 404)) {
    requireOk(response, "synthetic test-file deletion");
  }
  return { deletedOrAbsent: true };
}
