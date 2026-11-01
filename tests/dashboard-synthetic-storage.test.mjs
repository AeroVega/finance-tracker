import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createSnapshotTransaction,
  isSyntheticDashboardSnapshot
} from "../js/dashboard-synthetic-storage.mjs";

const manifest = {
  format: "finance-tracker-manifest",
  syntheticOnly: true,
  revision: 2,
  snapshot: { "prior/object.json": { fileId: "drive-id", sha256: "a".repeat(64) } }
};

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
