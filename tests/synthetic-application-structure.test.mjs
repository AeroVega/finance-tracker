import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateSyntheticApplicationSnapshot } from "../js/synthetic-application-structure.mjs";

const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const dashboard = { format: "finance-tracker-dashboard-snapshot", syntheticOnly: true,
  transactions: [{ id: "invented-1", date: "2026-01-01", description: "Invented fixture", amount: 1, syntheticOnly: true }] };
const dashboardPath = "synthetic/dashboard-transactions.json";

test("shared backup validator accepts genesis and dashboard diagnostic snapshots", () => {
  assert.equal(validateSyntheticApplicationSnapshot({ objects: {} }), true);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { [dashboardPath]: bytes(dashboard) } }), true);
});

test("shared backup validator rejects unsupported paths, malformed dashboard, and incomplete canonical history", () => {
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { "unexpected.json": bytes({}) } }), false);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { [dashboardPath]: bytes({ ...dashboard, syntheticOnly: false }) } }), false);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { [dashboardPath]: new Uint8Array([0xff]) } }), false);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { "synthetic/canonical-v1/index.json": bytes({}) } }), false);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { "synthetic/canonical-v1/orphan.json": bytes({}) } }), false);
});

test("browser canonical backups use paged verification instead of a flat snapshot validator", async () => {
  const source = await readFile(new URL("../prototype/pr25-acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /canonicalPartitionVerificationPlans/);
  assert.match(source, /exportPagedCanonicalArchive/);
  assert.doesNotMatch(source, /validateSyntheticApplicationSnapshot/);
});
