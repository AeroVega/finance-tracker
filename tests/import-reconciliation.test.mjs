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
  assert.throws(() => parseMoney("1.001", "USD"), /unsupported-money-precision/);
  assert.deepEqual(parseMoney("125.00", "JPY"), { amountMinor: 125, amountDecimal: null, currency: "JPY" });
});

test("decimal-string fallback survives reconciliation without floating-point conversion", () => {
  const result = reconcileImport({
    ...base,
    rows: [row({ amountMinor: null, amountDecimal: "-1.2345", currency: "XTS" })],
  });
  assert.equal(result.counts.created, 1);
  assert.equal(result.activities[0].amountMinor, null);
  assert.equal(result.activities[0].amountDecimal, "-1.2345");
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

test("needs-review prior run does not suppress retry of the identical file", () => {
  const result = reconcileImport({ ...base, rows: [row()], completedRuns: [{
    importRunId: "run-needs-review", institutionId: "sofi", accountId: "acct-1",
    sourceFormat: "sofi-csv-v1", fileFingerprint: base.fileFingerprint, status: "needs-review",
  }] });
  assert.equal(result.status, "processed");
  assert.equal(result.counts.created, 1);
  assert.equal(result.activities.length, 1);
});

test("overlapping import with one unique composite candidate requires corroboration", () => {
  const result = reconcileImport({ ...base, rows: [row()], existingActivities: [activity()] });
  assert.equal(result.counts.review, 1);
  assert.equal(result.activities.length, 0);
  assert.equal(result.observations[0].activityId, null);
});

test("historical composite evidence deduplicates canonical IDs without matching automatically", () => {
  const current = activity({ amountMinor: -2000 });
  const evidence = [activity(), activity(), current];
  const one = reconcileImport({ ...base, rows: [row(), row({ rowOrdinal: 2 })],
    existingActivities: [current], existingCompositeEvidence: evidence });
  assert.equal(one.counts.review, 2);
  assert.equal(one.counts.created, 0);
  assert.equal(one.counts.matched, 0);
  assert.ok(one.observations.every(o => o.reasonCode === "insufficient-composite-evidence" && o.activityId === null));
  const two = reconcileImport({ ...base, rows: [row()],
    existingActivities: [current, activity({ activityId: "activity-2", amountMinor: -1900 })],
    existingCompositeEvidence: [...evidence, activity({ activityId: "activity-2" })] });
  assert.equal(two.observations[0].reasonCode, "ambiguous-composite-match");
});

test("historical evidence cannot revive inactive IDs or cross institution, account or currency", () => {
  for (const existingActivities of [[], [activity({ activityId: "another-id" })],
    [activity({ institutionId: "wells-fargo" })], [activity({ accountId: "other-account" })],
    [activity({ currency: "EUR" })]]) {
    // A current matching record is excluded so only the supplied historical
    // evidence could influence this incoming row.
    const result = reconcileImport({ ...base, rows: [row()],
      existingActivities: existingActivities.map(a => ({ ...a, amountMinor: -2000 })),
      existingCompositeEvidence: [activity()] });
    assert.equal(result.counts.created, 1);
    assert.equal(result.counts.review, 0);
  }
});

test("historical composites do not override current source-ID conflicts or reversal amounts", () => {
  const context = { ...base, existingActivities: [activity({ amountMinor: -2000 })],
    existingCompositeEvidence: [activity()], existingObservations: [{
      accountId: "acct-1", sourceRecordId: "known-id", activityId: "activity-1", disposition: "created",
    }] };
  const conflict = reconcileImport({ ...context, rows: [row({ sourceRecordId: "known-id" })] });
  assert.equal(conflict.observations[0].reasonCode, "source-id-conflict");
  const matched = reconcileImport({ ...context, rows: [row({ sourceRecordId: "known-id", amountMinor: -2000 })] });
  assert.equal(matched.counts.matched, 1);
  const distinctId = reconcileImport({ ...context, rows: [row({ sourceRecordId: "different-id" })] });
  assert.equal(distinctId.counts.created, 1);
  const reversal = reconcileImport({ ...context, rows: [row({ reversalOfActivityId: "activity-1", amountMinor: 2341 })] });
  assert.equal(reversal.observations[0].reasonCode, "invalid-reversal-amount");
  assert.deepEqual(reversal.events, []);
});

test("composites compare exact signed decimal values across source and correction scales", () => {
  for (const [currency, amountDecimal, incoming] of [
    ["CHF", "-90.00", "-90"], ["AUD", "-90.000", "-90.0"],
    ["USD", "-90071992547409.9300", "-90071992547409.93"],
  ]) {
    const existing = activity({ currency, amountMinor: null, amountDecimal });
    const candidate = row({ currency, amountMinor: null, amountDecimal: incoming });
    const result = reconcileImport({ ...base, rows: [candidate], existingActivities: [existing] });
    assert.equal(result.counts.review, 1);
    assert.equal(result.observations[0].reasonCode, "insufficient-composite-evidence");
    assert.equal(existing.amountDecimal, amountDecimal);
    const opposite = reconcileImport({ ...base, rows: [{ ...candidate, amountDecimal: incoming.slice(1) }], existingActivities: [existing] });
    assert.equal(opposite.counts.created, 1);
  }
  const nonmonetary = reconcileImport({ ...base, rows: [row({ amountMinor: null, amountDecimal: null })],
    existingActivities: [activity({ amountMinor: null, amountDecimal: null })] });
  assert.equal(nonmonetary.counts.review, 1);
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

test("explicit reversal links append a reversal event without mutating the original activity", () => {
  const prior = activity();
  const result = reconcileImport({
    ...base, rows: [row({ amountMinor: 2341, reversalOfActivityId: "activity-1" })],
    existingActivities: [prior],
  });
  assert.equal(result.counts.matched, 1);
  assert.equal(result.events[0].eventType, "reversal");
  assert.equal(result.events[0].reversalAmountMinor, 2341);
  assert.equal(result.events[0].appendOnly, true);
  assert.equal(prior.amountMinor, -2341);
});

test("partial import preserves accepted rows, flags rejected and ambiguous rows, and reports exclusive counts", () => {
  const result = reconcileImport({
    ...base,
    rows: [
      row({ rowOrdinal: 1 }),
      row({ rowOrdinal: 2, effectiveDate: "2026-02-30" }),
      row({ rowOrdinal: 3, amountMinor: -7777, normalizedDescription: "ambiguous item", sourceDescription: "AMBIGUOUS ITEM" }),
    ],
    existingActivities: [
      activity({ activityId: "ambiguous-a", amountMinor: -7777, normalizedDescription: "ambiguous item", sourceDescription: "AMBIGUOUS ITEM" }),
      activity({ activityId: "ambiguous-b", amountMinor: -7777, normalizedDescription: "ambiguous item", sourceDescription: "AMBIGUOUS ITEM" }),
    ],
  });
  assert.equal(result.status, "needs-review");
  assert.equal(result.counts.rowsSeen, 3);
  assert.equal(result.counts.rowsRecognized, 3);
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.matched, 0);
  assert.equal(result.counts.review, 1);
  assert.equal(result.counts.rejected, 1);
  assert.equal(result.counts.ignored, 0);
  assert.equal(result.activities.length, 1);
  assert.deepEqual(result.observations.map((observation) => observation.disposition), ["created", "rejected", "review"]);
  assert.equal(result.counts.created + result.counts.matched + result.counts.review +
    result.counts.rejected + result.counts.ignored, result.counts.rowsRecognized);
  assert.equal(result.coverageStart, "2026-02-01");
  assert.equal(result.coverageEnd, "2026-02-01");
});

test("valid empty file succeeds with every data-row count zero and unknown coverage", () => {
  const result = reconcileImport({ ...base, rows: [] });
  assert.equal(result.status, "processed");
  assert.deepEqual(result.counts, {
    rowsSeen: 0, rowsRecognized: 0, created: 0, matched: 0, review: 0, rejected: 0, ignored: 0,
  });
  assert.equal(result.coverageStart, null);
  assert.equal(result.coverageEnd, null);
});

test("re-execution of the pure reconciliation function is deterministic and has no external side effects", () => {
  const first = reconcileImport({ ...base, rows: [row()], idFactory: () => "test-id" });
  const retry = reconcileImport({ ...base, rows: [row()], idFactory: () => "test-id" });
  assert.deepEqual(retry, first);
  assert.equal(retry.activities.length, 1);
});
