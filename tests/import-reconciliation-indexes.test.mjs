import test from "node:test";
import assert from "node:assert/strict";
import { reconcileImport } from "../js/import-reconciliation.mjs";
import { reconcileImport as scan } from "./fixtures/import-reconciliation-scan-oracle.mjs";

const base = { institutionId: "synthetic", accountId: "account", sourceFormat: "sofi-csv-v1", fileFingerprint: "invented" };
const row = (extra = {}) => ({ effectiveDate: "2026-02-01", sourceDescription: "Invented merchant", amountMinor: 100, currency: "USD", lifecycleStatus: "posted", ...extra });
const activity = (extra = {}) => ({ ...base, ...row(), activityId: "a", ...extra });
function compare(input, ids = ["new-0", "new-1", "new-2"]) {
  const run = fn => { let i = 0; return fn({ ...base, ...input, idFactory: () => ids[i++] ?? `new-${i}` }); };
  assert.deepEqual(run(reconcileImport), run(scan));
}
test("indexed matching preserves duplicate IDs, dangling references, source order and transitions", () => {
  const existingActivities = [activity({ lifecycleStatus: "pending" }), activity({ accountId: "other" }), activity({ activityId: "b" })];
  const existingObservations = [
    { accountId: "account", sourceRecordId: "source", activityId: "a" },
    { accountId: "other", sourceRecordId: "source", activityId: "b" },
    { accountId: "account", sourceRecordId: "future", activityId: "new-0" },
    { accountId: "account", sourceRecordId: "multiple", activityId: "b" },
    { accountId: "account", sourceRecordId: "multiple", activityId: "a" },
  ];
  compare({ existingActivities, existingObservations, rows: [
    row({ sourceRecordId: "source" }), row({ sourceRecordId: "source" }),
    row({ sourceRecordId: "create" }), row({ sourceRecordId: "future" }),
    row({ sourceRecordId: "multiple" }), row({ reversalOfActivityId: "new-0", amountMinor: -100 }),
    row({ reversalOfActivityId: "a", amountMinor: -100 }),
  ] });
  compare({ existingActivities, existingObservations, rows: [row({ sourceRecordId: "create" }), row({ sourceRecordId: "create" })] }, ["a"]);
});
test("indexed composites preserve exact money and null/missing distinctions", () => {
  const monies = [
    {}, { amountMinor: undefined }, { amountMinor: null }, { amountMinor: 0 }, { amountMinor: -0 },
    { amountMinor: 100 }, { amountMinor: -100 }, { amountMinor: Number.MAX_SAFE_INTEGER },
    ...["1", "01.000", "-1.00", "0", "-0.000", "90071992547409.91", "1.23450"].map(amountDecimal => ({ amountMinor: null, amountDecimal })),
  ];
  for (const currency of ["USD", "JPY", "KWD", "XTS", null, undefined]) {
    for (const left of monies) for (const right of monies) {
      compare({ existingActivities: [activity({ amountMinor: undefined, currency, ...left })],
        rows: [row({ amountMinor: undefined, currency, ...right })] });
    }
  }
});
test("seeded adversarial differential imports preserve the complete output", () => {
  let state = 29471;
  const random = n => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n);
  const pick = values => values[random(values.length)];
  for (let trial = 0; trial < 250; trial++) {
    const existingActivities = Array.from({ length: 30 }, (_, i) => activity({
      activityId: `a${random(25)}`, accountId: pick(["account", "account", "other"]),
      currency: pick(["USD", "XTS", null]), amountMinor: pick([null, undefined, 0, 100, -100]),
      amountDecimal: pick([null, undefined, "1.00", "-0", "01.000"]),
      lifecycleStatus: pick(["pending", "posted"]), sourceDescription: `Invented ${i % 4}`,
    }));
    const existingObservations = Array.from({ length: 60 }, () => ({
      activityId: `a${random(35)}`, accountId: pick(["account", "other"]),
      sourceRecordId: pick([null, "", `s${random(20)}`, 7]),
    }));
    const rows = Array.from({ length: 40 }, (_, i) => row({
      sourceDescription: `Invented ${i % 4}`, sourceRecordId: pick([null, "", `s${random(20)}`, 7]),
      lifecycleStatus: pick(["pending", "posted"]), effectiveDate: pick(["2026-02-01", "2026-02-02", "bad"]),
      amountMinor: pick([null, undefined, 0, 100, -100]), amountDecimal: pick([null, undefined, "1.00", "01.000", "-0"]),
      reversalOfActivityId: pick([null, null, `a${random(30)}`]),
      correctionOfActivityId: pick([null, `a${random(30)}`]),
    }));
    compare({ existingActivities, existingObservations, existingCompositeEvidence: existingActivities.map(a => ({ ...a, amountMinor: 200 })), rows });
  }
});
test("indexed matching reads existing evidence a bounded number of times", () => {
  for (const mode of ["source", "composite"]) {
    let reads = 0;
    const existingActivities = Array.from({ length: 5000 }, (_, i) => new Proxy(activity({ activityId: `a${i}`, amountMinor: i }), {
      get(target, key) { if (key === "activityId" || key === "amountMinor") reads++; return target[key]; },
    }));
    const existingObservations = existingActivities.map((a, i) => ({ accountId: "account", sourceRecordId: `s${i}`, activityId: a.activityId }));
    reads = 0;
    reconcileImport({ ...base, existingActivities, existingObservations,
      rows: Array.from({ length: 1000 }, (_, i) => row({ amountMinor: i, sourceRecordId: mode === "source" ? `s${i}` : null })) });
    assert.ok(reads < 150000, `${mode}: ${reads} reads`);
  }
});
test("large ambiguous source and composite buckets stop once ambiguity is established", () => {
  let reads = 0;
  const existingActivities = Array.from({ length: 5000 }, (_, i) => new Proxy(activity({ activityId: `a${i}` }), {
    get(target, key) { if (key === "activityId") reads++; return target[key]; },
  }));
  const existingObservations = existingActivities.map(a => ({ accountId: "account", sourceRecordId: "shared", activityId: a.activityId }));
  for (const sourceRecordId of ["shared", null]) {
    reads = 0;
    const result = reconcileImport({ ...base, existingActivities, existingObservations,
      rows: Array.from({ length: 1000 }, () => row({ sourceRecordId })) });
    assert.equal(result.counts.review, 1000);
    assert.ok(reads < 50000, `${reads} ID reads`);
  }
});
