import test from "node:test";
import assert from "node:assert/strict";
import {
  ORIGINAL_RETENTION_DAYS, createOriginalRetentionRecord, assessOriginalRetention,
  confirmOriginalDeletion, recordOriginalDeletionFailure, copyOriginalRetentionForBackup,
  originalMayBeRestored, prepareOriginalRestore, processOriginalRetentionBatch
} from "../js/original-retention-policy.mjs";

const retainedAt = "2026-01-01T00:00:00.000Z";
const record = () => createOriginalRetentionRecord({
  sourceFileId: "synthetic-source-file",
  retainedAt,
  sourceSha256: "a".repeat(64),
  importId: "synthetic-import-001"
});
const expiry = new Date(Date.parse(retainedAt) + ORIGINAL_RETENTION_DAYS * 86400000).toISOString();

test("sets the approved 540-day clock from successful private retention", () => {
  const created = record();
  assert.equal(created.retainedAt, retainedAt);
  assert.equal(created.expiresAt, expiry);
  assert.equal(assessOriginalRetention(created, "2026-01-02T00:00:00.000Z").deletionEligible, false);
});

test("does not make an original eligible one millisecond before expiry", () => {
  const created = record();
  const before = new Date(Date.parse(expiry) - 1).toISOString();
  assert.equal(assessOriginalRetention(created, before).deletionEligible, false);
  assert.equal(assessOriginalRetention(created, expiry).deletionEligible, true);
});

test("a backup preserves the original retention clock and locator", () => {
  const created = record();
  const copied = copyOriginalRetentionForBackup(created, {
    backupFileId: "synthetic-backup-source-file",
    now: "2026-02-01T00:00:00.000Z"
  });
  assert.equal(copied.retainedAt, created.retainedAt);
  assert.equal(copied.expiresAt, created.expiresAt);
  assert.equal(copied.sourceFileId, "synthetic-backup-source-file");
  assert.notEqual(copied.sourceFileId, created.sourceFileId);
  assert.equal(copyOriginalRetentionForBackup(created, { backupFileId: "late-backup-file", now: expiry }), null);
});

test("a failed eligible deletion remains visible and retryable", () => {
  const failed = recordOriginalDeletionFailure(record(), { attemptedAt: expiry, failureCode: "provider-unavailable" });
  assert.equal(failed.state, "deletion-failed");
  assert.equal(failed.sourceFileId, "synthetic-source-file");
  assert.equal(failed.lastDeletionAttemptAt, expiry);
  assert.equal(assessOriginalRetention(failed, expiry).deletionEligible, true);
});

test("deletion requires provider-confirmed absence and clears the locator only then", () => {
  assert.throws(() => confirmOriginalDeletion(record(), { confirmedAt: expiry, providerConfirmedAbsent: false }),
    (error) => error.code === "deletion-not-confirmed");
  const deleted = confirmOriginalDeletion(record(), { confirmedAt: expiry, providerConfirmedAbsent: true });
  assert.equal(deleted.state, "deleted");
  assert.equal(deleted.sourceFileId, null);
  assert.equal(originalMayBeRestored(deleted, expiry), false);
});

test("expiry and confirmed deletion cannot be undone by backup restore", () => {
  const created = record();
  assert.equal(originalMayBeRestored(created, expiry), false);
  assert.equal(prepareOriginalRestore(created, { now: expiry, restoredFileId: "new-id" }), null);
  const live = prepareOriginalRestore(created, { now: "2026-02-01T00:00:00.000Z", restoredFileId: "restored-id" });
  assert.equal(live.sourceFileId, "restored-id");
  assert.equal(live.retainedAt, retainedAt);
  assert.equal(live.expiresAt, expiry);
});

test("rejects tampered clocks, missing hashes, and premature deletion", () => {
  assert.throws(() => createOriginalRetentionRecord({ sourceFileId: "id", retainedAt, sourceSha256: "bad", importId: "i" }),
    (error) => error.code === "invalid-source-hash");
  assert.throws(() => confirmOriginalDeletion(record(), { confirmedAt: "2026-02-01T00:00:00.000Z", providerConfirmedAbsent: true }),
    (error) => error.code === "retention-not-expired");
  assert.throws(() => assessOriginalRetention({ ...record(), expiresAt: retainedAt }, expiry),
    (error) => error.code === "retention-clock-mismatch");
});


test("retention sweep only clears locators after provider absence verification", async () => {
  const expired = record();
  let deleted = false;
  const result = await processOriginalRetentionBatch([expired], {
    now: expiry,
    deleteFile: async (fileId) => { assert.equal(fileId, expired.sourceFileId); deleted = true; },
    confirmAbsent: async () => deleted
  });
  assert.equal(result.outcomes[0].outcome, "deleted");
  assert.equal(result.records[0].sourceFileId, null);
  assert.equal(result.records[0].state, "deleted");
});

test("retention sweep keeps a failed deletion retryable when absence is not confirmed", async () => {
  const expired = record();
  const result = await processOriginalRetentionBatch([expired], {
    now: expiry,
    deleteFile: async () => {},
    confirmAbsent: async () => false
  });
  assert.equal(result.outcomes[0].outcome, "retryable-failure");
  assert.equal(result.records[0].sourceFileId, expired.sourceFileId);
  assert.equal(result.records[0].state, "deletion-failed");
  assert.equal(assessOriginalRetention(result.records[0], expiry).deletionEligible, true);
});

test("retention sweep does not call the provider before expiry or for confirmed deletions", async () => {
  const fresh = record();
  const deleted = confirmOriginalDeletion(fresh, { confirmedAt: expiry, providerConfirmedAbsent: true });
  let calls = 0;
  const result = await processOriginalRetentionBatch([fresh, deleted], {
    now: "2026-01-02T00:00:00.000Z",
    deleteFile: async () => { calls += 1; },
    confirmAbsent: async () => true
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.outcomes.map((entry) => entry.outcome), ["not-eligible", "already-deleted"]);
});


test("retention sweep accepts an idempotent delete only after independent absence verification", async () => {
  const expired = record();
  const result = await processOriginalRetentionBatch([expired], {
    now: expiry,
    deleteFile: async () => { throw Object.assign(new Error("already absent"), { code: "not-found" }); },
    confirmAbsent: async () => true
  });
  assert.equal(result.outcomes[0].outcome, "deleted");
  assert.equal(result.records[0].sourceFileId, null);
});

test("retention sweep preserves provider permission failures for retry", async () => {
  const expired = record();
  const result = await processOriginalRetentionBatch([expired], {
    now: expiry,
    deleteFile: async () => { throw Object.assign(new Error("forbidden"), { code: "permission-denied" }); },
    confirmAbsent: async () => false
  });
  assert.equal(result.outcomes[0].outcome, "retryable-failure");
  assert.equal(result.outcomes[0].failureCode, "permission-denied");
  assert.equal(result.records[0].sourceFileId, expired.sourceFileId);
});
