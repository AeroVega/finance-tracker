import { createDriveResponseLimits, readBoundedDriveJson, discardDriveResponse, assertResponseSize } from "./drive-response-transport.mjs";
import { DRIVE_FILES_ENDPOINT, DRIVE_UPLOAD_ENDPOINT, listFolderChildren } from "./drive-feasibility-spike.mjs";
import { SessionCoordinationError } from "./session-coordination.mjs";

export const SESSION_MARKER_NAME = "finance-tracker-active-session.json";
export const SESSION_MARKER_PROPERTY = "financeTrackerSession";

function error(code, message, sessionCheck, cause) {
  const failure = new SessionCoordinationError(code, message, cause);
  if (sessionCheck) failure.sessionCheck = sessionCheck;
  return failure;
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
 * A single marker is discovered by complete candidate enumeration. Duplicate or
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
  // Retry visibility, never the mutation. Normal reads remain fail-closed.
  const verificationDelays = settings.verificationDelays ?? [200, 400, 800];
  if (!Array.isArray(verificationDelays) || verificationDelays.length > 5 ||
      verificationDelays.some(ms => !Number.isSafeInteger(ms) || ms < 0 || ms > 2000)) {
    throw error("invalid-timing", "Session verification delays must be bounded.");
  }
  const delays = [...verificationDelays];
  const wait = settings.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const operationTimeoutMs = settings.operationTimeoutMs ?? 60_000;
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 120_000) {
    throw error("invalid-timing", "Session I/O requires a finite timeout.");
  }
  const pending = new Set();
  async function withDeadline(operation) {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), operationTimeoutMs);
    try { return await operation(controller.signal); }
    finally { clearTimeout(timer); pending.delete(controller); }
  }
  const request = (signal, url, init = {}) => {
    signal.throwIfAborted();
    return fetchImpl(url, {...init, signal});
  };
  // Private failed-bracket observations are never ownership evidence.
  const changedVersionRecords = new WeakMap();
  let writtenFileId = null;
  let operationGeneration = 0;
  const assertCurrent = epoch => {
    if (epoch !== operationGeneration) throw error("session-operation-cancelled", "Session verification was cancelled. Preserve the folder and marker.");
  };
  let lastReadRecord;
  let lastReadFileId = null;
  let hasRead = false;
  let evidence = null;
  let generation = 0;
  const clear = () => { generation++; evidence = null; };
  const binding = file => JSON.stringify([file.id, file.name, file.mimeType,
    [...file.parents].sort(), file.appProperties[SESSION_MARKER_PROPERTY], file.version]);
  const validVersion = file => typeof file.version === "string" && /^[0-9]+$/.test(file.version);

  async function read(epoch = operationGeneration, signal) {
    if (!signal) return withDeadline(signal => read(epoch, signal));
    assertCurrent(epoch);
    try { const record = await readCurrent(signal); signal.throwIfAborted(); assertCurrent(epoch); return record; }
    catch (cause) { clear(); throw cause; }
  }

  async function readCurrent(signal) {
    const epoch = generation;
    const files = await listFolderChildren({
      // listFolderChildren accepts a bearer-token string, unlike this adapter's
      // other Drive requests which resolve the provider inside authHeaders().
      accessToken: typeof accessToken === "function" ? accessToken() : accessToken,
      folderId,
      markerFilter: {name: SESSION_MARKER_NAME, property: SESSION_MARKER_PROPERTY, value: "v1"},
      responseLimits,
      signal,
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
      if (writtenFileId) throw error("session-marker-not-visible", "The written session marker is not visible. Preserve the folder and marker.");
      clear();
      lastReadRecord = null;
      lastReadFileId = null;
      hasRead = true;
      return null;
    }

    const file = candidates[0];
    if (writtenFileId && file.id !== writtenFileId) {
      throw error("ownership-unknown", "A different session marker replaced the written marker.", "marker-id-changed");
    }
    if (file.trashed === true || file.name !== SESSION_MARKER_NAME ||
        file.mimeType !== "application/json" ||
        !Array.isArray(file.parents) || !file.parents.includes(folderId) ||
        !file.appProperties ||
        file.appProperties[SESSION_MARKER_PROPERTY] !== "v1") {
      throw error("ambiguous-session-record", "The session marker metadata is malformed or belongs to another folder.");
    }

    // Every ownership check still enumerates all candidate markers. Only an
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
      response = await request(signal,
        DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(file.id) + "?alt=media",
        { method: "GET", cache: "no-store", headers: authHeaders(accessToken) }
      );
    } catch (cause) {
      throw error("network-error", "The session marker could not be read from Google Drive.", undefined, cause);
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
      throw error("ambiguous-session-record", "The session marker content is not valid JSON.", undefined, cause);
    }
    if (validVersion(file)) {
      let closingResponse;
      try {
        closingResponse = await request(signal, DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(file.id) +
          "?fields=id,name,mimeType,parents,appProperties,version,trashed",
          { method: "GET", cache: "no-store", headers: authHeaders(accessToken) });
      } catch (cause) { throw error("network-error", "The session marker version could not be confirmed.", undefined, cause); }
      if (!closingResponse?.ok) {
        await discardDriveResponse(closingResponse);
        throw error("drive-read-failed", "The session marker version could not be confirmed.");
      }
      const closing = await readBoundedDriveJson(closingResponse, { kind: "metadata", limits: responseLimits });
      // Keep every original bracket requirement; report only which fixed check
      // failed, never either metadata value. These are failures, not retry hints.
      const sessionCheck = closing?.trashed !== false ? "closing-trashed-unconfirmed" :
        !Array.isArray(closing.parents) ? "closing-parents-missing" :
        !closing.appProperties ? "closing-properties-missing" :
        !validVersion(closing) ? "closing-version-invalid" :
        closing.id !== file.id ? "closing-id-changed" :
        closing.name !== file.name ? "closing-name-changed" :
        closing.mimeType !== file.mimeType ? "closing-mime-changed" :
        JSON.stringify([...closing.parents].sort()) !== JSON.stringify([...file.parents].sort()) ? "closing-parents-changed" :
        closing.appProperties[SESSION_MARKER_PROPERTY] !== file.appProperties[SESSION_MARKER_PROPERTY] ? "closing-session-property-changed" :
        closing.version !== file.version ? "closing-version-changed" : null;
      if (sessionCheck) {
        const failure = error("ownership-unknown", "The session marker changed while its content was being verified.", sessionCheck);
        if (sessionCheck === "closing-version-changed") changedVersionRecords.set(failure, record);
        throw failure;
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

  async function generateId(signal) {
    let response;
    try {
      response = await request(signal, DRIVE_FILES_ENDPOINT + "/generateIds?count=1&space=drive", {
        method: "GET",
        headers: authHeaders(accessToken)
      });
    } catch (cause) {
      throw error("network-error", "Google Drive could not generate a session marker ID.", undefined, cause);
    }
    if (!response || !response.ok) {
      await discardDriveResponse(response);
      throw error("drive-create-failed", "Google Drive could not generate a session marker ID.");
    }
    let payload;
    try { payload = await readBoundedDriveJson(response, { kind: "generated-ids", limits: responseLimits }); }
    catch (cause) {
      if (cause.code !== "invalid-json-object") throw cause;
      throw error("invalid-response", "Google Drive returned an invalid generated ID response.", undefined, cause);
    }
    if (!payload || !Array.isArray(payload.ids) || typeof payload.ids[0] !== "string" || !payload.ids[0]) {
      throw error("invalid-response", "Google Drive returned no usable session marker ID.");
    }
    return payload.ids[0];
  }

  async function readBackExpected(expected, previous, epoch, signal) {
    for (let attempt = 0; ; attempt++) {
      assertCurrent(epoch);
      let actual;
      try { actual = await read(epoch, signal); }
      catch (cause) {
        if (cause.code !== "session-marker-not-visible") {
          // A version-only disagreement after our own mutation may be metadata
          // settling. Never accept that read or retry a mutation. Re-enumerate
          // all candidates and obtain a fresh media/metadata bracket instead.
          const observed = changedVersionRecords.get(cause);
          if (!observed || (!sameRecord(observed, expected) && !sameRecord(observed, previous)) ||
              attempt === delays.length) throw cause;
        }
      }
      assertCurrent(epoch);
      if (sameRecord(actual, expected)) return;
      // Only absence or the exact pre-write record can be delayed visibility.
      // A changed owner, malformed marker or incomplete listing is not retried.
      if (actual !== undefined && actual !== null && !sameRecord(actual, previous)) {
        throw error("ownership-unknown", "The session marker changed during write verification.", "readback-record-changed");
      }
      if (attempt === delays.length) {
        throw error("session-marker-not-visible", "Session write visibility was not verified within the retry budget. Preserve the folder and marker; do not retry creation.");
      }
      await wait(delays[attempt]);
      signal.throwIfAborted();
    }
  }

  async function write(record) {
    const epoch = operationGeneration;
    try { const owned = structuredClone(record); return await withDeadline(signal => writeCurrent(owned, epoch, signal)); }
    catch (cause) { clear(); throw cause; }
  }

  async function writeCurrent(record, epoch, signal) {
    assertResponseSize(new TextEncoder().encode(JSON.stringify(record)).length, { kind: "session-marker", limits: responseLimits });
    if (!hasRead) throw error("read-before-write-required", "Read the session marker before attempting to write.");
    const previousRecord = lastReadRecord;
    const previousFileId = lastReadFileId;
    const observed = await read(epoch, signal);
    if (!((observed === null && previousRecord === null) || sameRecord(observed, previousRecord)) ||
        (observed === null) !== (previousFileId === null) || lastReadFileId !== previousFileId) {
      throw error("ownership-unknown", "The session marker changed since it was last inspected. The write was refused.", "prewrite-record-changed");
    }

    // Force exact remote media verification after our own mutation, including
    // ambiguous responses. A later read must not trust the submitted record.
    clear();
    if (observed === null) {
      const fileId = await generateId(signal);
      assertCurrent(epoch);
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
      assertCurrent(epoch);
      writtenFileId = fileId;
      try {
        response = await request(signal,
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
        await readBackExpected(record, previousRecord, epoch, signal);
        return;
      }
      await discardDriveResponse(response);
      if (!response || (!response.ok && response.status !== 409)) {
        throw error("drive-create-failed", "Google Drive did not confirm session marker creation.");
      }
      await readBackExpected(record, previousRecord, epoch, signal);
      return;
    }

    const fileId = previousFileId;
    assertCurrent(epoch);
    writtenFileId = fileId;
    let response;
    try {
      response = await request(signal,
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
      await readBackExpected(record, previousRecord, epoch, signal);
      return;
    }
    await discardDriveResponse(response);
    if (!response || !response.ok) {
      throw error("drive-update-failed", "Google Drive did not confirm the session marker update.");
    }
    await readBackExpected(record, previousRecord, epoch, signal);
  }

  return Object.freeze({ read: () => read(), write, clear,
    cancelPending() { operationGeneration++; for (const controller of pending) controller.abort(); clear(); }
  });
}
