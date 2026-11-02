import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  classifyPickerAction,
  createSnapshotTransaction,
  isSyntheticDashboardSnapshot
} from "../js/dashboard-synthetic-storage.mjs";

const manifest = {
  format: "finance-tracker-manifest",
  syntheticOnly: true,
  revision: 2,
  snapshot: { "prior/object.json": { fileId: "drive-id", sha256: "a".repeat(64) } }
};

test("Google Picker load event waits for the user's folder choice instead of treating it as cancellation", () => {
  const actions = { LOADED: "loaded", PICKED: "picked", CANCEL: "cancel" };
  assert.equal(classifyPickerAction(actions.LOADED, actions), "pending");
  assert.equal(classifyPickerAction("unknown-event", actions), "pending");
  assert.equal(classifyPickerAction(actions.PICKED, actions), "picked");
  assert.equal(classifyPickerAction(actions.CANCEL, actions), "cancelled");
});

test("dashboard snapshot transaction contains only invented rows and uses a UUID v4", () => {
  const rows = [{
    id: "sample-1",
    date: "2026-10-15",
    description: "Sample paycheck",
    amount: 2450,
    syntheticOnly: true
  }];
  const transaction = createSnapshotTransaction({ manifest, transactions: rows, cryptoImpl: webcrypto });
  assert.match(transaction.transactionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(transaction.expectedBase, manifest);
  assert.equal(transaction.objects.length, 1);
  assert.equal(transaction.objects[0].logicalPath, "synthetic/dashboard-transactions.json");
  assert.deepEqual(JSON.parse(transaction.objects[0].content).transactions, rows);
  assert.equal(transaction.makeManifest instanceof Function, true);
});

test("dashboard storage rejects CSV or other non-synthetic rows before transaction creation", () => {
  assert.throws(() => createSnapshotTransaction({
    manifest,
    transactions: [{ id: "csv-row", date: "2026-10-15", description: "Real CSV row", amount: -10 }],
    cryptoImpl: webcrypto
  }), (error) => error.code === "synthetic-data-required");
});

test("dashboard snapshot validator rejects malformed and non-synthetic content", () => {
  assert.equal(isSyntheticDashboardSnapshot({
    format: "finance-tracker-dashboard-snapshot",
    syntheticOnly: true,
    transactions: [{ id: "sample", date: "2026-10-15", description: "Sample", amount: 1, syntheticOnly: true }]
  }), true);
  assert.equal(isSyntheticDashboardSnapshot({
    format: "finance-tracker-dashboard-snapshot",
    syntheticOnly: true,
    transactions: [{ id: "real", date: "2026-10-15", description: "CSV", amount: 1 }]
  }), false);
  assert.equal(isSyntheticDashboardSnapshot({ format: "wrong", syntheticOnly: true, transactions: [] }), false);
});

test("dashboard CSV import path remains local and cannot invoke Drive persistence", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const importStart = app.indexOf("async function importFile(file)");
  const renderStart = app.indexOf("function render()", importStart);
  assert.notEqual(importStart, -1);
  assert.notEqual(renderStart, -1);
  const importFlow = app.slice(importStart, renderStart);
  assert.equal(importFlow.includes("saveSyntheticSnapshot"), false);
  assert.equal(importFlow.includes("clearSyntheticSnapshot"), false);
  assert.match(importFlow, /CSV rows remain local and are never uploaded to Drive/);
});

test("empty synthetic snapshots are valid clear transactions", () => {
  const transaction = createSnapshotTransaction({ manifest, transactions: [], cryptoImpl: webcrypto });
  assert.deepEqual(JSON.parse(transaction.objects[0].content).transactions, []);
});

test("dashboard supplies a synchronous token provider to the Drive session adapter", () => {
  const source = readFileSync(new URL("../js/dashboard-synthetic-storage.mjs", import.meta.url), "utf8");
  assert.match(source, /accessToken: \(\) => this\.token\(\)/);
  assert.doesNotMatch(source, /accessToken: async \(\) => this\.token\(\)/);
});
