import test from "node:test";
import assert from "node:assert/strict";
import { parseMoney, recognizeFormat, reconcileImport } from "../js/import-reconciliation.mjs";

const base = {
  institutionId: "sofi", accountId: "acct-1", sourceFormat: "sofi-csv-v1",
  fileFingerprint: "synthetic-fingerprint-1",
};
const row = (overrides = {}) => ({
  rowOrdinal: 1, effectiveDate: "2026-02-01", postedDate: null,
  amountMinor: -2341, currency: "USD", sourceDescription: "EXAMPLE MARKET PURCHASE",
  normalizedDescription: "example market purchase", sourceAction: "Card Purchase",
  lifecycleStatus: "posted", activityKind: "cash-transaction", sourceRecordId: null,
  sourceFields: { Description: "EXAMPLE MARKET PURCHASE" }, ...overrides,
});
const activity = (overrides = {}) => ({
  activityId: "activity-1", accountId: "acct-1", institutionId: "sofi",
  effectiveDate: "2026-02-01", amountMinor: -2341, currency: "USD",
  sourceDescription: "EXAMPLE MARKET PURCHASE", normalizedDescription: "example market purchase",
  sourceAction: "Card Purchase", lifecycleStatus: "posted", ...overrides,
});

test("money parsing uses integer minor units and exact decimal fallback", () => {
  assert.deepEqual(parseMoney("-23.41", "USD"), { amountMinor: -2341, amountDecimal: null, currency: "USD" });
  assert.deepEqual(parseMoney("125", "JPY"), { amountMinor: 125, amountDecimal: null, currency: "JPY" });
  assert.deepEqual(parseMoney("1.234", "KWD"), { amountMinor: 1234, amountDecimal: null, currency: "KWD" });
  assert.deepEqual(parseMoney("1.2345", "XTS"), { amountMinor: null, amountDecimal: "1.2345", currency: "XTS" });
  assert.throws(() => parseMoney("1.001", "USD"), /unsupported-money-precision/);\n  assert.deepEqual(parseMoney("125.00", "JPY"), { amountMinor: 125, amountDecimal: null, currency: "JPY" });
});

test("strict format recognition and explicit account mapping fail closed", () => {
  assert.equal(recognizeFormat("fidelity-accounts-history-csv-v1"), true);
  assert.equal(recognizeFormat("unknown-export-v2"), false);
  assert.throws(() => reconcileImport({ ...base, accountId: null, rows: [] }), /explicit-account-mapping-required/);
  assert.throws(() => reconcileImport({ ...base, sourceFormat: "unknown-export-v2", rows: [] }), /unsupported-source-format/);
});

test("identical completed file is a no-op with no new side effects", () => {
  const result = reconcileImport({ ...base, rows: [row()], completedRuns: [{
    importRunId: "run-old", institutionId: "sofi", accountId: "acct-1",
    sourceFormat: "sofi-csv-v1", fileFingerprint: base.fileFingerprint, status: "processed",
  }] });
  assert.equal(result.status, "no-op");
  assert.equal(result.noOpOfImportRunId, "run-old");
  assert.deepEqual(result.activities, []);
  assert.deepEqual(result.events, []);
});

test("overlapping import with one unique composite candidate attaches provenance instead of duplicating", () => {
  const result = reconcileImport({ ...base, rows: [row()], existingActivities: [activity()] });
  assert.equal(result.counts.matched, 1);
  assert.equal(result.activities.length, 0);
  assert.equal(result.observations[0].activityId, "activity-1");
});

test("same-day same-amount same-description collision with multiple candidates requires review", () => {
  const result = reconcileImport({ ...base, rows: [row()], existingActivities: [
    activity({ activityId: "activity-a" }), activity({ activityId: "activity-b" }),
  ] });
  assert.equal(result.status, "needs-review");
  assert.equal(result.counts.review, 1);
  assert.equal(result.observations[0].activityId, null);
});

test("repeated duplicate-shaped rows in a single file remain distinct activities", () => {
  const result = reconcileImport({ ...base, rows: [row({ rowOrdinal: 1 }), row({ rowOrdinal: 2 })] });
  assert.equal(result.counts.created, 2);
  assert.notEqual(result.activities[0].activityId, result.activities[1].activityId);
});

test("stable source ID links pending-to-posted observations and appends lifecycle event", () => {
  const prior = activity({ lifecycleStatus: "pending", sourceRecordId: "src-123" });
  const result = reconcileImport({
    ...base, rows: [row({ sourceRecordId: "src-123", lifecycleStatus: "posted" })],
    existingActivities: [prior], existingObservations: [{
      accountId: "acct-1", sourceRecordId: "src-123", activityId: prior.activityId,
    }],
  });
  assert.equal(result.counts.matched, 1);
  assert.equal(result.observations[0].activityId, "activity-1");
  assert.equal(result.events[0].eventType, "lifecycle-transition");
  assert.equal(result.events[0].appendOnly, true);
});

test("conflicting stable source ID goes to review unless an explicit correction link exists", () => {
  const prior = activity({ sourceRecordId: "src-123" });
  const context = {
    ...base, rows: [row({ sourceRecordId: "src-123", amountMinor: -9999 })],
    existingActivities: [prior], existingObservations: [{
      accountId: "acct-1", sourceRecordId: "src-123", activityId: prior.activityId,
    }],
  };
  const conflict = reconcileImport(context);
  assert.equal(conflict.counts.review, 1);
  const correction = reconcileImport({
    ...context, rows: [row({ sourceRecordId: "src-123", amountMinor: -9999, correctionOfActivityId: "activity-1" })],
  });
  assert.equal(correction.counts.matched, 1);
  assert.equal(correction.events[0].eventType, "correction");
  assert.equal(correction.events[0].appendOnly, true);
  assert.equal(prior.amountMinor, -2341);
});

test("malformed rows are rejected and safe partial results are explicitly needs-review", () => {
  const result = reconcileImport({ ...base, rows: [row(), row({ effectiveDate: "2026-02-30", rowOrdinal: 2 })] });
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.rejected, 1);
  assert.equal(result.status, "needs-review");
  assert.equal(result.observations[1].disposition, "rejected");
});

test("valid empty file succeeds with zero counts and unknown coverage", () => {
  const result = reconcileImport({ ...base, rows: [] });
  assert.equal(result.status, "processed");
  assert.equal(result.counts.rowsSeen, 0);
  assert.equal(result.coverageStart, null);
  assert.equal(result.coverageEnd, null);
});

test("re-execution of the pure reconciliation function is deterministic and has no external side effects", () => {
  const first = reconcileImport({ ...base, rows: [row()] });
  const retry = reconcileImport({ ...base, rows: [row()] });
  assert.deepEqual(retry, first);
  assert.equal(retry.activities.length, 1);
});
