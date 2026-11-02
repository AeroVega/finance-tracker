export const ORIGINAL_RETENTION_DAYS = 540;
export const ORIGINAL_RETENTION_MS = ORIGINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export class RetentionPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RetentionPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RetentionPolicyError(code, message);
}

function parseInstant(value, field) {
  if (typeof value !== "string" || !value.trim()) fail("invalid-timestamp", `${field} must be an ISO timestamp.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail("invalid-timestamp", `${field} must be a canonical UTC ISO timestamp.`);
  }
  return milliseconds;
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

/** Create immutable source-retention timing at the moment private retention succeeds. */
export function createOriginalRetentionRecord({ sourceFileId, retainedAt, sourceSha256, importId }) {
  if (typeof sourceFileId !== "string" || !sourceFileId.trim()) fail("missing-source-locator", "A retained original requires its private source-file locator.");
  if (!/^[0-9a-f]{64}$/.test(String(sourceSha256 || ""))) fail("invalid-source-hash", "A retained original requires a SHA-256 content hash.");
  if (typeof importId !== "string" || !importId.trim()) fail("missing-import-id", "A retained original requires its import identity.");
  const retainedAtMs = parseInstant(retainedAt, "retainedAt");
  return Object.freeze({
    format: "finance-tracker-original-retention",
    version: 1,
    importId,
    sourceFileId,
    sourceSha256,
    retainedAt: iso(retainedAtMs),
    expiresAt: iso(retainedAtMs + ORIGINAL_RETENTION_MS),
    state: "retained",
    deletionConfirmedAt: null,
    deletionFailureCode: null
  });
}

export function assessOriginalRetention(record, now = new Date().toISOString()) {
  if (!record || record.format !== "finance-tracker-original-retention" || record.version !== 1) {
    fail("invalid-retention-record", "The original-retention record is missing or unsupported.");
  }
  const retainedAt = parseInstant(record.retainedAt, "retainedAt");
  const expiresAt = parseInstant(record.expiresAt, "expiresAt");
  const nowMs = parseInstant(now, "now");
  if (expiresAt !== retainedAt + ORIGINAL_RETENTION_MS) fail("retention-clock-mismatch", "The expiry must be exactly 540 days after successful retention.");
  if (record.state === "deleted") {
    if (record.sourceFileId !== null || !record.deletionConfirmedAt) fail("invalid-deletion-state", "Confirmed deletion must clear the live locator and retain its confirmation timestamp.");
    parseInstant(record.deletionConfirmedAt, "deletionConfirmedAt");
    return { state: "deleted", deletionEligible: false, daysRemaining: 0 };
  }
  if (!["retained", "deletion-failed"].includes(record.state) || typeof record.sourceFileId !== "string" || !record.sourceFileId) {
    fail("invalid-retention-state", "The retention state or source locator is invalid.");
  }
  const remaining = expiresAt - nowMs;
  return {
    state: record.state,
    deletionEligible: remaining <= 0,
    daysRemaining: Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000))),
    expiresAt: record.expiresAt
  };
}

/** Record a provider-confirmed deletion; a request/202 response alone is not confirmation. */
export function confirmOriginalDeletion(record, { confirmedAt, providerConfirmedAbsent } = {}) {
  const assessment = assessOriginalRetention(record, confirmedAt);
  if (!assessment.deletionEligible) fail("retention-not-expired", "The original file is not yet eligible for deletion.");
  if (providerConfirmedAbsent !== true) fail("deletion-not-confirmed", "The provider must confirm that the original file is absent.");
  return Object.freeze({
    ...record,
    sourceFileId: null,
    state: "deleted",
    deletionConfirmedAt: iso(parseInstant(confirmedAt, "confirmedAt")),
    lastDeletionAttemptAt: iso(parseInstant(confirmedAt, "confirmedAt")),
    deletionFailureCode: null
  });
}

/** Preserve the locator and make a failed eligible deletion visible and retryable. */
export function recordOriginalDeletionFailure(record, { attemptedAt, failureCode } = {}) {
  const assessment = assessOriginalRetention(record, attemptedAt);
  if (!assessment.deletionEligible) fail("retention-not-expired", "The original file is not yet eligible for deletion.");
  if (typeof failureCode !== "string" || !failureCode.trim()) fail("missing-deletion-failure", "A stable deletion failure code is required.");
  return Object.freeze({ ...record, state: "deletion-failed", lastDeletionAttemptAt: iso(parseInstant(attemptedAt, "attemptedAt")), deletionFailureCode: failureCode });
}

/** Backup copies carry the original clock unchanged; backup creation never restarts retention. */
export function copyOriginalRetentionForBackup(record) {
  assessOriginalRetention(record, record.expiresAt);
  return Object.freeze({ ...record });
}

/** Expired/deleted originals are intentionally omitted from restored copies. */
export function originalMayBeRestored(record, now = new Date().toISOString()) {
  const assessment = assessOriginalRetention(record, now);
  return record.state !== "deleted" && !assessment.deletionEligible;
}

/** Produce metadata for a restored original without changing its original retention clock. */
export function prepareOriginalRestore(record, { now = new Date().toISOString(), restoredFileId } = {}) {
  if (!originalMayBeRestored(record, now)) return null;
  if (typeof restoredFileId !== "string" || !restoredFileId.trim()) fail("missing-restored-locator", "A live restored original requires a new private file locator.");
  return Object.freeze({ ...record, sourceFileId: restoredFileId });
}


/**
 * Apply expiry to a supplied metadata batch. The caller owns persistence of the
 * returned records; a provider delete response alone is not treated as proof.
 */
export async function processOriginalRetentionBatch(records, {
  now = new Date().toISOString(), deleteFile, confirmAbsent
} = {}) {
  if (!Array.isArray(records) || typeof deleteFile !== "function" || typeof confirmAbsent !== "function") {
    fail("invalid-retention-adapter", "A retention record array, delete operation, and absence-verification operation are required.");
  }
  const updatedRecords = [];
  const outcomes = [];
  for (const record of records) {
    const assessment = assessOriginalRetention(record, now);
    if (!assessment.deletionEligible || record.state === "deleted") {
      updatedRecords.push(record);
      outcomes.push({ importId: record.importId, outcome: record.state === "deleted" ? "already-deleted" : "not-eligible" });
      continue;
    }
    let deleteError = null;
    try {
      await deleteFile(record.sourceFileId);
    } catch (error) {
      deleteError = error;
    }
    try {
      // Independent metadata absence is authoritative, including an idempotent
      // retry where Drive reports that the file was already deleted.
      if (await confirmAbsent(record.sourceFileId) !== true) {
        if (deleteError) throw deleteError;
        fail("deletion-not-confirmed", "The provider did not confirm that the expired original is absent.");
      }
      updatedRecords.push(confirmOriginalDeletion(record, { confirmedAt: now, providerConfirmedAbsent: true }));
      outcomes.push({ importId: record.importId, outcome: "deleted" });
    } catch (error) {
      const failureCode = typeof error?.code === "string" && error.code.trim() ? error.code : "provider-delete-failed";
      updatedRecords.push(recordOriginalDeletionFailure(record, { attemptedAt: now, failureCode }));
      outcomes.push({ importId: record.importId, outcome: "retryable-failure", failureCode });
    }
  }
  return { records: updatedRecords, outcomes };
}
