import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateSyntheticApplicationSnapshot } from "../js/synthetic-application-structure.mjs";
import { createLedger } from "../js/canonical-import.mjs";
import { serializeCanonicalLedger, CANONICAL_INDEX, CANONICAL_PREFIX } from "../js/canonical-ledger-storage.mjs";

const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const dashboard = { format: "finance-tracker-dashboard-snapshot", syntheticOnly: true,
  transactions: [{ id: "invented-1", date: "2026-01-01", description: "Invented fixture", amount: 1, syntheticOnly: true }] };
const dashboardPath = "synthetic/dashboard-transactions.json";

test("shared backup validator accepts genesis, dashboard, canonical, and combined snapshots", () => {
  const canonical = Object.fromEntries([...serializeCanonicalLedger(createLedger())].map(([path, content]) => [path, new TextEncoder().encode(content)]));
  assert.equal(validateSyntheticApplicationSnapshot({ objects: {} }), true);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { [dashboardPath]: bytes(dashboard) } }), true);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: canonical }), true);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { ...canonical, [dashboardPath]: bytes(dashboard) } }), true);
});

test("shared backup validator rejects unsupported paths, malformed dashboard, and incomplete canonical history", () => {
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { "unexpected.json": bytes({}) } }), false);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { [dashboardPath]: bytes({ ...dashboard, syntheticOnly: false }) } }), false);
  assert.equal(validateSyntheticApplicationSnapshot({ objects: { [dashboardPath]: new Uint8Array([0xff]) } }), false);
  assert.throws(() => validateSyntheticApplicationSnapshot({ objects: { [CANONICAL_INDEX]: bytes({}) } }), { code: "invalid-canonical-index" });
  assert.throws(() => validateSyntheticApplicationSnapshot({ objects: { [CANONICAL_PREFIX + "orphan.json"]: bytes({}) } }), { code: "canonical-index-missing" });
});

test("PR25 browser backup, export, and restore use the shared strict application validator", async () => {
  const source = await readFile(new URL("../prototype/pr25-acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ validateSyntheticApplicationSnapshot \} from "\.\.\/js\/synthetic-application-structure\.mjs"/);
  assert.match(source, /const validateStructure = validateSyntheticApplicationSnapshot/);
  assert.doesNotMatch(source, /const validateStructure = \(\{ objects \}\)/);
});
