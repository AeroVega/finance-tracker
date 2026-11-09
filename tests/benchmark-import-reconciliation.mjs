// Synthetic-only CPU benchmark; not a timing-based test.
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { reconcileImport } from "../js/import-reconciliation.mjs";
import { reconcileImport as scan } from "./fixtures/import-reconciliation-scan-oracle.mjs";
const base = { institutionId: "synthetic", accountId: "account", sourceFormat: "sofi-csv-v1", fileFingerprint: "invented" };
const row = i => ({ effectiveDate: "2026-02-01", sourceDescription: "Invented merchant", amountMinor: i, currency: "USD", lifecycleStatus: "posted" });
for (const size of [1000, 10000, 50000]) {
  const existingActivities = Array.from({ length: size }, (_, i) => ({ ...base, ...row(i), activityId: `a${i}` }));
  const existingObservations = existingActivities.map((a, i) => ({ accountId: "account", sourceRecordId: `s${i}`, activityId: a.activityId }));
  for (const mode of ["source", "composite"]) {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ ...row(size - 1000 + i), sourceRecordId: mode === "source" ? `s${size - 1000 + i}` : null }));
    const input = { ...base, existingActivities, existingObservations, rows };
    const times = {};
    let expected;
    for (const [name, fn] of [["scan", scan], ["indexed", reconcileImport]]) {
      const start = performance.now();
      const result = fn(input);
      times[name] = Math.round((performance.now() - start) * 10) / 10;
      if (expected) assert.deepEqual(result, expected); else expected = result;
    }
    console.log(JSON.stringify({ size, rows: rows.length, mode, milliseconds: times, speedup: Math.round(times.scan / times.indexed * 10) / 10 }));
  }
}
for (const size of [1000, 10000, 50000]) {
  const current = { ...base, ...row(100), activityId: "single-activity" };
  const input = { ...base, existingActivities: [current],
    existingCompositeEvidence: Array.from({ length: size }, () => ({ ...current, amountMinor: null, amountDecimal: "01.000" })),
    rows: Array.from({ length: 1000 }, () => row(100)) };
  const times = {};
  let expected;
  for (const [name, fn] of [["scan", scan], ["indexed", reconcileImport]]) {
    const start = performance.now();
    const result = fn(input);
    times[name] = Math.round((performance.now() - start) * 10) / 10;
    if (expected) assert.deepEqual(result, expected); else expected = result;
  }
  console.log(JSON.stringify({ historicalEvidence: size, rows: 1000, mode: "repeated-single-candidate",
    milliseconds: times, speedup: Math.round(times.scan / times.indexed * 10) / 10 }));
}
