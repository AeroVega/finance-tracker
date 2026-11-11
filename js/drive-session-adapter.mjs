import { createDriveResponseLimits, readBoundedDriveJson, discardDriveResponse, assertResponseSize } from "./drive-response-transport.mjs";
import { DRIVE_FILES_ENDPOINT, DRIVE_UPLOAD_ENDPOINT, listFolderChildren } from "./drive-feasibility-spike.mjs";
import { SessionCoordinationError } from "./session-coordination.mjs";

export const SESSION_MARKER_NAME = "finance-tracker-active-session.json";
export const SESSION_MARKER_PROPERTY = "financeTrackerSession";

function error(code, message) {
  return new SessionCoordinationError(code, message);
}

function authHeaders(accessToken) {
  const token = typeof accessToken === "function" ? accessToken() : accessToken;
  if (!token) throw error("authorization-required", "A Google Drive access token is required.");
  return { Authorization: "Bearer " + token };
}

function sameRecord(left, right) {
  return Boolean(left && right &&
    left.format === right.format &&
    left.version === right.version &&
    left.sessionId === right.sessionId &&
    left.state === right.state &&
    left.startedAt === right.startedAt &&
    left.heartbeatAt === right.heartbeatAt &&
    left.expiresAt === right.expiresAt &&
    left.releasedAt === right.releasedAt);
}

function multipartBody(boundary, metadata, content) {
  return new Blob([
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata) + "\r\n",
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    content,
    "\r\n--" + boundary + "--\r\n"
  ]);
}

/**
 * Drive-backed best-effort session marker adapter.
 *
 * A single marker is discovered by complete folder enumeration. Duplicate or
 * malformed markers are errors, never treated as an empty folder. Updates are
 * deliberately not described as atomic: the tested Drive If-Match path is not
 * enforced, so this adapter provides detection and read-back only.
 */
export function createDriveSessionAdapter(options) {
  const settings = options || {};
  const accessToken = settings.accessToken;
  const folderId = String(settings.folderId || "");
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  if (!folderId) throw error("missing-folder", "Select the intended Drive folder first.");
  if (typeof fetchImpl !== "function") throw error("fetch-unavailable", "Fetch is unavailable.");

  const responseLimits = createDriveResponseLimits(settings.responseLimits);
  let lastReadRecord;
  let lastReadFileId = null;
  let hasRead = false;
  let evidence = null;
  let generation = 0;
  const clear = () => { generation++; evidence = null; };
  const binding = file => JSON.stringify([file.id, file.name, file.mimeType,
    [...file.parents].sort(), file.appProperties[SESSION_MARKER_PROPERTY], file.version]);
  const validVersion = file => typeof file.version === "string" && /^[0-9]+$/.test(file.version);

  async function read() {
    try { return await readCurrent(); }
    catch (cause) { clear(); throw cause; }
  }

  async function readCurrent() {
    const epoch = generation;
    const files = await listFolderChildren({
      // listFolderChildren accepts a bearer-token string, unlike this adapter's
      // other Drive requests which resolve the provider inside authHeaders().
      accessToken: typeof accessToken === "function" ? accessToken() : accessToken,
      folderId,
      responseLimits,
      fetchImpl
    });
    const ids = new Set();
    for (const file of files) {
      if (typeof file?.id !== "string" || !file.id || ids.has(file.id)) {
        throw error("ambiguous-session-record", "Folder enumeration contains invalid or duplicate file identities.");
      }
      ids.add(file.id);
    }
    const candidates = files.filter((file) =>
      file && (file.name === SESSION_MARKER_NAME ||
        (file.appProperties && file.appProperties[SESSION_MARKER_PROPERTY] === "v1"))
    );
    if (candidates.length > 1) {
      throw error("ambiguous-session-record", "More than one session marker exists in the selected folder. Resolve the duplicate markers before writing.");
    }
    if (candidates.length === 0) {
      clear();
      lastReadRecord = null;
      lastReadFileId = null;
      hasRead = true;
      return null;
    }

    const file = candidates[0];
    if (file.trashed === true || file.name !== SESSION_MARKER_NAME ||
        file.mimeType !== "application/json" ||
        !Array.isArray(file.parents) || !file.parents.includes(folderId) ||
        !file.appProperties ||
        file.appProperties[SESSION_MARKER_PROPERTY] !== "v1") {
      throw error("ambiguous-session-record", "The session marker metadata is malformed or belongs to another folder.");
    }

    // Every ownership check still enumerates the complete folder. Only an
    // unchanged server version and binding can reuse one privately held record.
    // Its first media GET was bracketed by matching metadata. No write payload
    // or POST/PATCH response can establish this evidence.
    if (validVersion(file) && evidence?.binding === binding(file)) {
      lastReadRecord = structuredClone(evidence.record);
      lastReadFileId = file.id;
      hasRead = true;
      return structuredClone(lastReadRecord);
    }
    let response;
    try {
      response = await fetchImpl(
        DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(file.id) + "?alt=media",
        { method: "GET", cache: "no-store", headers: authHeaders(accessToken) }
      );
    } catch {
      throw error("network-error", "The session marker could not be read from Google Drive.");
    }
    if (!response || !response.ok) {
      await discardDriveResponse(response);
      throw error("drive-read-failed", "The session marker could not be read from Google Drive.");
    }

    let record;
    try {
      record = await readBoundedDriveJson(response, { kind: "session-marker", limits: responseLimits });
    } catch (cause) {
      if (cause.code !== "invalid-json-object") throw cause;
      throw error("ambiguous-session-record", "The session marker content is not valid JSON.");
    }
    if (validVersion(file)) {
      let closingResponse;
      try {
        closingResponse = await fetchImpl(DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(file.id) +
          "?fields=id,name,mimeType,parents,appProperties,version,trashed",
          { method: "GET", cache: "no-store", headers: authHeaders(accessToken) });
      } catch { throw error("network-error", "The session marker version could not be confirmed."); }
      if (!closingResponse?.ok) {
        await discardDriveResponse(closingResponse);
        throw error("drive-read-failed", "The session marker version could not be confirmed.");
      }
      const closing = await readBoundedDriveJson(closingResponse, { kind: "metadata", limits: responseLimits });
      if (closing?.trashed !== false || !Array.isArray(closing.parents) || !closing.appProperties ||
          !validVersion(closing) || binding(closing) !== binding(file)) {
        throw error("ownership-unknown", "The session marker changed while its content was being verified.");
      }
      if (epoch === generation) evidence = { binding: binding(file), record: structuredClone(record) };
    } else {
      // Legacy/custom providers without versions remain on complete media reads.
      evidence = null;
    }
    lastReadRecord = structuredClone(record);
    lastReadFileId = file.id;
    hasRead = true;
    return structuredClone(record);
  }

  async function generateId() {
    let response;
    try {
      response = await fetchImpl(DRIVE_FILES_ENDPOINT + "/generateIds?count=1&space=drive", {
        method: "GET",
        headers: authHeaders(accessToken)
      });
    } catch {
      throw error("network-error", "Google Drive could not generate a session marker ID.");
    }
    if (!response || !response.ok) {
      await discardDriveResponse(response);
      throw error("drive-create-failed", "Google Drive could not generate a session marker ID.");
    }
    let payload;
    try { payload = await readBoundedDriveJson(response, { kind: "generated-ids", limits: responseLimits }); }
    catch (cause) {
      if (cause.code !== "invalid-json-object") throw cause;
      throw error("invalid-response", "Google Drive returned an invalid generated ID response.");
    }
    if (!payload || !Array.isArray(payload.ids) || typeof payload.ids[0] !== "string" || !payload.ids[0]) {
      throw error("invalid-response", "Google Drive returned no usable session marker ID.");
    }
    return payload.ids[0];
  }

  async function readBackExpected(expected) {
    const actual = await read();
    if (!sameRecord(actual, expected)) {
      throw error("ownership-unknown", "The session marker write could not be verified by exact read-back.");
    }
  }

  async function write(record) {
    try { return await writeCurrent(record); }
    catch (cause) { clear(); throw cause; }
  }

  async function writeCurrent(record) {
    assertResponseSize(new TextEncoder().encode(JSON.stringify(record)).length, { kind: "session-marker", limits: responseLimits });
    if (!hasRead) throw error("read-before-write-required", "Read the session marker before attempting to write.");
    const previousRecord = lastReadRecord;
    const previousFileId = lastReadFileId;
    const observed = await read();
    if (!((observed === null && previousRecord === null) || sameRecord(observed, previousRecord)) ||
        (observed === null) !== (previousFileId === null) || lastReadFileId !== previousFileId) {
      throw error("ownership-unknown", "The session marker changed since it was last inspected. The write was refused.");
    }

    // Force exact remote media verification after our own mutation, including
    // ambiguous responses. A later read must not trust the submitted record.
    clear();
    if (observed === null) {
      const fileId = await generateId();
      const boundary = "finance_tracker_session_" + fileId.replace(/[^a-zA-Z0-9]/g, "");
      const metadata = {
        id: fileId,
        name: SESSION_MARKER_NAME,
        mimeType: "application/json",
        parents: [folderId],
        description: "Finance Tracker best-effort active-session marker. Not a server lock.",
        appProperties: { [SESSION_MARKER_PROPERTY]: "v1" }
      };
      const body = multipartBody(boundary, metadata, JSON.stringify(record));
      let response;
      try {
        response = await fetchImpl(
          DRIVE_UPLOAD_ENDPOINT + "?uploadType=multipart&fields=id%2Cname%2CmimeType%2Cparents%2CappProperties",
          {
            method: "POST",
            headers: Object.assign({}, authHeaders(accessToken), {
              "Content-Type": "multipart/related; boundary=" + boundary
            }),
            body
          }
        );
      } catch {
        // Resolve a lost create response only by exact folder scan and read-back.
        await readBackExpected(record);
        return;
      }
      await discardDriveResponse(response);
      if (!response || (!response.ok && response.status !== 409)) {
        throw error("drive-create-failed", "Google Drive did not confirm session marker creation.");
      }
      await readBackExpected(record);
      return;
    }

    const fileId = previousFileId;
    let response;
    try {
      response = await fetchImpl(
        DRIVE_UPLOAD_ENDPOINT + "/" + encodeURIComponent(fileId) + "?uploadType=media",
        {
          method: "PATCH",
          headers: Object.assign({}, authHeaders(accessToken), {
            "Content-Type": "application/json"
          }),
          body: JSON.stringify(record)
        }
      );
    } catch {
      // A lost update response is resolved only if the exact new record is visible.
      await readBackExpected(record);
      return;
    }
    await discardDriveResponse(response);
    if (!response || !response.ok) {
      throw error("drive-update-failed", "Google Drive did not confirm the session marker update.");
    }
    await readBackExpected(record);
  }

  return Object.freeze({ read, write, clear });
}
