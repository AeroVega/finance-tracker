export const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";

function makeRunId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function statusText(response) {
  return "HTTP " + String(response.status || "unknown");
}

function requireOk(response, operation) {
  if (!response || !response.ok) {
    throw new Error("Drive " + operation + " failed (" + statusText(response) + ").");
  }
}

export function createSyntheticProbePayload(runId, createdAt) {
  return {
    schemaVersion: 1,
    kind: "synthetic-drive-round-trip-probe",
    runId: String(runId),
    createdAt: String(createdAt),
    transactions: [
      {
        id: "synthetic-" + String(runId),
        date: "2026-01-02",
        description: "Synthetic test transaction",
        amount: 1.23,
        currency: "USD"
      }
    ]
  };
}

function createMultipartBody(boundary, metadata, payload) {
  return [
    "--" + boundary,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    "--" + boundary,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload),
    "--" + boundary + "--",
    ""
  ].join("\r\n");
}

/*
 * This probe writes only invented data to a uniquely named temporary file.
 * It never reads or modifies the canonical ledger. Deletion always requires
 * an explicit confirmation callback; if confirmation is declined, the result
 * identifies the temporary file for manual cleanup.
 */
export async function runSyntheticDriveProbe(options) {
  const settings = options || {};
  const accessToken = settings.accessToken;
  const folderId = settings.folderId;
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const confirmDelete = settings.confirmDelete;
  const runId = settings.runId || makeRunId();
  const createdAt = settings.createdAt || new Date().toISOString();

  if (!accessToken) throw new Error("A Google Drive access token is required.");
  if (!folderId) throw new Error("Select a Drive folder first.");
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this browser.");

  const payload = createSyntheticProbePayload(runId, createdAt);
  const fileName = "finance-tracker-drive-probe-" + String(runId) + ".json";
  const metadata = {
    name: fileName,
    mimeType: "application/json",
    parents: [String(folderId)],
    description: "Temporary synthetic Finance Tracker Drive round-trip check."
  };
  const boundary = "finance_tracker_probe_" + String(runId).replace(/[^a-zA-Z0-9]/g, "");
  const authorization = { Authorization: "Bearer " + accessToken };
  let fileId = null;
  let primaryError = null;
  let cleanupError = null;
  let cleanupSkipped = false;
  let roundTripVerified = false;
  let cleanedUp = false;

  try {
    const createResponse = await fetchImpl(
      DRIVE_UPLOAD_ENDPOINT + "?uploadType=multipart&fields=id%2Cname%2CmimeType%2Cparents",
      {
        method: "POST",
        headers: Object.assign({}, authorization, {
          "Content-Type": "multipart/related; boundary=" + boundary
        }),
        body: createMultipartBody(boundary, metadata, payload)
      }
    );
    requireOk(createResponse, "synthetic file creation");
    const created = await createResponse.json();
    fileId = created && created.id;
    if (!fileId) throw new Error("Drive created no file ID for the synthetic probe.");

    const readResponse = await fetchImpl(
      DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(fileId) + "?alt=media",
      { method: "GET", headers: authorization }
    );
    requireOk(readResponse, "synthetic file read-back");
    const readPayload = await readResponse.json();
    if (JSON.stringify(readPayload) !== JSON.stringify(payload)) {
      throw new Error("Drive read-back did not match the synthetic test payload.");
    }
    roundTripVerified = true;
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error("The synthetic Drive probe failed.");
  }

  if (fileId) {
    let approved = false;
    try {
      approved = typeof confirmDelete === "function"
        ? Boolean(await confirmDelete({ fileName, fileId, roundTripVerified }))
        : false;
    } catch {
      approved = false;
    }

    if (!approved) {
      cleanupSkipped = true;
    } else {
      try {
        const deleteResponse = await fetchImpl(
          DRIVE_FILES_ENDPOINT + "/" + encodeURIComponent(fileId),
          { method: "DELETE", headers: authorization }
        );
        requireOk(deleteResponse, "temporary synthetic file cleanup");
        cleanedUp = true;
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : "Temporary file cleanup failed.";
      }
    }
  }

  const result = {
    fileName,
    roundTripVerified,
    cleanedUp,
    cleanupSkipped
  };
  if (cleanupError) {
    result.cleanupError = cleanupError;
    result.leftoverFileId = fileId;
  }
  if (primaryError) {
    const message = cleanupError
      ? primaryError.message + " Cleanup also failed; remove " + fileName + " from the selected folder."
      : cleanupSkipped
        ? primaryError.message + " The temporary file remains as " + fileName + "."
        : primaryError.message;
    const wrapped = new Error(message);
    wrapped.probeResult = result;
    throw wrapped;
  }
  return result;
}
