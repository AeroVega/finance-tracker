import test from "node:test";
import assert from "node:assert/strict";
import { parseMoney, reconcileImport } from "../js/import-reconciliation.mjs";

const base = {
  institutionId: "sofi",
  accountId: "acct-edge",
  sourceFormat: "sofi-csv-v1",
  fileFingerprint: "edge-fingerprint",
};
const row = (overrides = {}) => ({
  rowOrdinal: 1,
  effectiveDate: "2026-02-01",
  postedDate: null,
  amountMinor: -1234,
  amountDecimal: null,
  currency: "USD",
  sourceDescription: "EXAMPLE PAYMENT",
  normalizedDescription: "example payment",
  sourceAction: "Payment",
  lifecycleStatus: "posted",
  activityKind: "cash-transaction",
  sourceRecordId: null,
  ...overrides,
});

test("money parser preserves exact precision for signed, zero, and trailing-zero values", () => {
  assert.equal(parseMoney("0.00", "USD").amountMinor, 0);
  assert.equal(parseMoney("-0.00", "USD").amountMinor, 0);
  assert.equal(parseMoney("12.3400", "USD").amountMinor, 1234);
  assert.equal(parseMoney("-12.3400", "USD").amountMinor, -1234);
  assert.throws(() => parseMoney("12.3401", "USD"), /unsupported-money-precision/);
  assert.throws(() => parseMoney("1e2", "USD"), /invalid-money/);
  assert.throws(() => parseMoney("NaN", "USD"), /invalid-money/);
});

test("money parser falls back to exact decimal text when integer minor units exceed safe range", () => {
  assert.deepEqual(parseMoney("90071992547409.92", "USD"), {
    amountMinor: null,
    amountDecimal: "90071992547409.92",
    currency: "USD",
  });
  assert.deepEqual(parseMoney("-90071992547409.92", "USD"), {
    amountMinor: null,
    amountDecimal: "-90071992547409.92",
    currency: "USD",
  });
});

test("malformed amount representations and impossible dates are rejected without creating activities", () => {
  const result = reconcileImport({
    ...base,
    rows: [
      row({ amountMinor: 1.5 }),
      row({ rowOrdinal: 2, amountMinor: null, amountDecimal: "1.2.3" }),
      row({ rowOrdinal: 3, effectiveDate: "2026-02-29" }),
    ],
  });
  assert.equal(result.status, "needs-review");
  assert.equal(result.counts.rejected, 3);
  assert.equal(result.activities.length, 0);
  assert.equal(result.counts.created + result.counts.matched + result.counts.review +
    result.counts.rejected + result.counts.ignored, result.counts.rowsRecognized);
});

test("invalid canonical posted dates are rejected while source date provenance remains intact", () => {
  const invalid = reconcileImport({ ...base, rows: [row({ postedDate: "2026-02-30" })] });
  assert.equal(invalid.counts.rejected, 1);
  assert.equal(invalid.activities.length, 0);

  const valid = reconcileImport({ ...base, rows: [row({
    effectiveDate: "2026-02-01",
    postedDate: "2026-02-03",
    sourceFields: { Date: "02/01/2026", Posted: "02/03/2026" },
  })] });
  assert.equal(valid.activities[0].effectiveDate, "2026-02-01");
  assert.equal(valid.activities[0].postedDate, "2026-02-03");
  assert.deepEqual(valid.observations[0].sourceFields, { Date: "02/01/2026", Posted: "02/03/2026" });
});

test("failed prior attempts do not suppress a retry of the same file", () => {
  const result = reconcileImport({
    ...base,
    rows: [row()],
    completedRuns: [{
      importRunId: "failed-run",
      institutionId: base.institutionId,
      accountId: base.accountId,
      sourceFormat: base.sourceFormat,
      fileFingerprint: base.fileFingerprint,
      status: "failed",
    }],
  });
  assert.equal(result.status, "processed");
  assert.equal(result.counts.created, 1);
});

test("identical fingerprints in a different account or format context are not no-ops", () => {
  const completedRuns = [{
    importRunId: "other-context",
    institutionId: base.institutionId,
    accountId: "different-account",
    sourceFormat: base.sourceFormat,
    fileFingerprint: base.fileFingerprint,
    status: "processed",
  }];
  const result = reconcileImport({ ...base, rows: [row()], completedRuns });
  assert.equal(result.status, "processed");
  assert.equal(result.counts.created, 1);
});

test("partial reversal records only its supplied amount and leaves the original unchanged", () => {
  const original = {
    activityId: "original-activity",
    institutionId: base.institutionId,
    accountId: base.accountId,
    amountMinor: -1234,
    currency: "USD",
    lifecycleStatus: "posted",
  };
  const result = reconcileImport({
    ...base,
    rows: [row({ amountMinor: 500, reversalOfActivityId: original.activityId })],
    existingActivities: [original],
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventType, "reversal");
  assert.equal(result.events[0].reversalAmountMinor, 500);
  assert.equal(original.amountMinor, -1234);
});


test("reversal targets outside the current institution or account go to review", () => {
  for (const target of [
    { institutionId: "fidelity", accountId: base.accountId },
    { institutionId: base.institutionId, accountId: "other-account" },
    { accountId: base.accountId },
  ]) {
    const result = reconcileImport({
      ...base,
      rows: [row({ amountMinor: 500, reversalOfActivityId: "target-1" })],
      existingActivities: [{
        activityId: "target-1", institutionId: base.institutionId,
        accountId: base.accountId, amountMinor: -1234, currency: "USD", ...target,
      }],
    });
    assert.equal(result.counts.review, 1);
    assert.equal(result.events.length, 0);
    assert.equal(result.observations[0].reasonCode, "reversal-target-out-of-scope");
  }
});

test("reversal amount must have opposite sign and not exceed original absolute amount", () => {
  const original = {
    activityId: "purchase-1", institutionId: base.institutionId,
    accountId: base.accountId, amountMinor: -1234, amountDecimal: null,
    currency: "USD", lifecycleStatus: "posted",
  };
  for (const amountMinor of [-500, 0, 1235]) {
    const result = reconcileImport({
      ...base,
      rows: [row({ amountMinor, reversalOfActivityId: original.activityId })],
      existingActivities: [original],
    });
    assert.equal(result.counts.review, 1, `amount ${amountMinor} should be reviewed`);
    assert.equal(result.events.length, 0);
    assert.equal(result.observations[0].reasonCode, "invalid-reversal-amount");
  }
  const valid = reconcileImport({
    ...base,
    rows: [row({ amountMinor: 500, reversalOfActivityId: original.activityId })],
    existingActivities: [original],
  });
  assert.equal(valid.counts.matched, 1);
  assert.equal(valid.events[0].reversalAmountMinor, 500);
});

test("exact decimal fallback reversal amounts are compared without floating-point rounding", () => {
  const original = {
    activityId: "large-purchase", institutionId: base.institutionId,
    accountId: base.accountId, amountMinor: null, amountDecimal: "-90071992547409.92",
    currency: "USD", lifecycleStatus: "posted",
  };
  const valid = reconcileImport({
    ...base,
    rows: [row({ amountMinor: null, amountDecimal: "90071992547409.91", reversalOfActivityId: original.activityId })],
    existingActivities: [original],
  });
  assert.equal(valid.counts.matched, 1);
  assert.equal(valid.events[0].reversalAmountDecimal, "90071992547409.91");

  const invalid = reconcileImport({
    ...base,
    rows: [row({ amountMinor: null, amountDecimal: "90071992547409.93", reversalOfActivityId: original.activityId })],
    existingActivities: [original],
  });
  assert.equal(invalid.counts.review, 1);
  assert.equal(invalid.events.length, 0);
});

test("transfer sides are only carried as linked movements when an explicit group is supplied", () => {
  const outgoing = reconcileImport({
    ...base,
    rows: [row({ amountMinor: -5000, transferGroupId: "transfer-example-1", activityKind: "transfer" })],
  });
  const incoming = reconcileImport({
    ...base,
    accountId: "acct-edge-destination",
    fileFingerprint: "edge-fingerprint-destination",
    rows: [row({ amountMinor: 5000, transferGroupId: "transfer-example-1", activityKind: "transfer" })],
  });
  assert.equal(outgoing.activities[0].transferGroupId, "transfer-example-1");
  assert.equal(incoming.activities[0].transferGroupId, "transfer-example-1");
  assert.equal(outgoing.activities[0].amountMinor, -incoming.activities[0].amountMinor);
  assert.equal(outgoing.activities[0].activityKind, "transfer");
  assert.equal(incoming.activities[0].activityKind, "transfer");
});

test("same amount and date do not auto-link a transfer without explicit identity evidence", () => {
  const result = reconcileImport({
    ...base,
    rows: [row({ amountMinor: -5000, activityKind: "transfer" })],
    existingActivities: [{
      activityId: "other-account-activity",
      accountId: "different-account",
      amountMinor: -5000,
      amountDecimal: null,
      currency: "USD",
      effectiveDate: "2026-02-01",
      sourceDescription: "EXAMPLE PAYMENT",
      normalizedDescription: "example payment",
      sourceAction: "Payment",
      activityKind: "transfer",
    }],
  });
  assert.equal(result.counts.created, 1);
  assert.equal(result.activities.length, 1);
});

test("matching source IDs scoped to another account must not establish identity", () => {
  const result = reconcileImport({
    ...base,
    rows: [row({ sourceRecordId: "provider-id-1" })],
    existingActivities: [{
      activityId: "other-account-activity",
      accountId: "different-account",
      amountMinor: -1234,
      currency: "USD",
      sourceRecordId: "provider-id-1",
    }],
    existingObservations: [{
      accountId: "different-account",
      sourceRecordId: "provider-id-1",
      activityId: "other-account-activity",
    }],
  });
  assert.equal(result.counts.created, 1);
});


test("source IDs cannot link across institutions even when account IDs and provider IDs collide", () => {
  const result = reconcileImport({
    ...base,
    institutionId: "sofi",
    accountId: "same-local-account-id",
    rows: [row({ sourceRecordId: "provider-id-collision" })],
    existingActivities: [{
      activityId: "other-institution-activity",
      institutionId: "fidelity",
      accountId: "same-local-account-id",
      amountMinor: -1234,
      amountDecimal: null,
      currency: "USD",
    }],
    existingObservations: [{
      institutionId: "fidelity",
      accountId: "same-local-account-id",
      sourceRecordId: "provider-id-collision",
      activityId: "other-institution-activity",
    }],
  });
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.matched, 0);
  assert.equal(result.activities[0].institutionId, "sofi");
});

test("contradictory repeated source IDs in one file send every conflicting occurrence to review", () => {
  const result = reconcileImport({
    ...base,
    rows: [
      row({ rowOrdinal: 1, sourceRecordId: "repeated-provider-id", amountMinor: -1234 }),
      row({ rowOrdinal: 2, sourceRecordId: "repeated-provider-id", amountMinor: -9999 }),
    ],
  });
  assert.equal(result.status, "needs-review");
  assert.equal(result.counts.created, 0);
  assert.equal(result.counts.review, 2);
  assert.deepEqual(result.observations.map((observation) => observation.disposition), ["review", "review"]);
  assert.deepEqual(result.observations.map((observation) => observation.reasonCode), [
    "source-id-conflict-within-file",
    "source-id-conflict-within-file",
  ]);
  assert.equal(result.counts.created + result.counts.matched + result.counts.review +
    result.counts.rejected + result.counts.ignored, result.counts.rowsRecognized);
});

test("identical repeated source IDs in one file may attach to the first observation without duplicating activity", () => {
  const result = reconcileImport({
    ...base,
    rows: [
      row({ rowOrdinal: 1, sourceRecordId: "repeated-provider-id" }),
      row({ rowOrdinal: 2, sourceRecordId: "repeated-provider-id" }),
    ],
  });
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.matched, 1);
  assert.equal(result.activities.length, 1);
  assert.equal(result.observations[0].activityId, result.observations[1].activityId);
});

test("unknown currency keeps exact decimal text and does not coerce through floating point", () => {
  assert.deepEqual(parseMoney("-12345678901234567890.123456", "XTS"), {
    amountMinor: null,
    amountDecimal: "-12345678901234567890.123456",
    currency: "XTS",
  });
});

test("monetary rows require a valid currency whenever an amount is present", () => {
  const result = reconcileImport({
    ...base,
    rows: [
      row({ currency: null }),
      row({ rowOrdinal: 2, amountMinor: null, amountDecimal: "1.25", currency: null }),
      row({ rowOrdinal: 3, amountMinor: 125, amountDecimal: "1.25", currency: "USD" }),
    ],
  });
  assert.equal(result.counts.rejected, 3);
  assert.equal(result.activities.length, 0);
  assert.equal(result.status, "needs-review");
});
