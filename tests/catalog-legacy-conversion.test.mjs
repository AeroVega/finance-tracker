import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCatalogDrive } from "./helpers/catalog-drive.mjs";
import { DriveTransactionEngine } from "../js/drive-transaction-engine.mjs";
import { encode, writeVerified, verifyCatalogHistory } from "../js/catalog-storage.mjs";
import { convertLegacySyntheticCopy } from "../js/catalog-legacy-conversion.mjs";

const gate = (operation) => operation();
const guard = async () => {};

test("explicit legacy conversion preserves source and carries complete original evidence into a new synthetic copy", async () => {
  const sourceAdapter = new MemoryCatalogDrive("legacy-synthetic-folder");
  const base = { format: "finance-tracker-manifest", manifestVersion: "1.0.0", schemaVersion: 1, syntheticOnly: true,
    databaseId: "invented-db", copyId: "invented-old-copy", role: "primary", revision: 0,
    commitId: crypto.randomUUID(), parentCommitId: null, snapshot: {} };
  const { fileId: sourceManifestFileId } = await writeVerified(sourceAdapter, { content: base, name: "ft-synthetic-dashboard-manifest.json",
    kind: "dashboard-synthetic-manifest", transactionId: "dashboard-synthetic-bootstrap" }, guard);
  const engine = new DriveTransactionEngine({ adapter: sourceAdapter, assertWritable: guard, isOnline: () => true });
  const result = await engine.transact({ manifestFileId: sourceManifestFileId, expectedBase: base,
    objects: [{ logicalPath: "synthetic/ledger.json", content: '{"syntheticOnly":true}' }], commitRecord: { operationType: "synthetic-conversion-test", snapshot: {} },
    makeManifest: ({ current, record, commitFileId, commitHash }) => ({ ...current, revision: record.revision, commitId: record.commitId,
      parentCommitId: record.parentCommitId, commitRecordFileId: commitFileId, commitRecordHash: commitHash, snapshot: record.snapshot }) });
  const before = structuredClone([...sourceAdapter.files]);
  const targetAdapter = new MemoryCatalogDrive("converted-synthetic-folder");
  const converted = await convertLegacySyntheticCopy({ sourceAdapter, sourceManifestFileId, withSourceLock: gate, assertSourceWritable: guard,
    targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure: () => true });
  const verified = await verifyCatalogHistory(targetAdapter, converted.manifest);
  assert.equal(converted.manifest.databaseId, base.databaseId);
  assert.equal(converted.manifest.commitId, result.commitId);
  assert.notEqual(converted.manifest.copyId, base.copyId);
  assert.deepEqual([...sourceAdapter.files], before);
  assert.match(verified.record.snapshot["synthetic/ledger.json"], /^[a-f0-9]{64}$/);
  assert.equal(Object.values(verified.catalog.entries).some((entry) => entry.kind === "migration-record" && entry.identity === "legacy-selected-manifest"), true);
  assert.equal(Object.values(verified.catalog.entries).filter((entry) => entry.kind === "commit-record").length, 2);
});

test("missing legacy history fails closed without creating a destination manifest", async () => {
  const sourceAdapter = new MemoryCatalogDrive("legacy-synthetic-folder");
  const base = { format: "finance-tracker-manifest", manifestVersion: "1.0.0", syntheticOnly: true, role: "primary",
    databaseId: "invented-db", copyId: "invented-copy", revision: 3, commitId: "missing-commit", snapshot: {} };
  const { fileId: sourceManifestFileId } = await writeVerified(sourceAdapter, { content: encode(base), name: "manifest.json", kind: "dashboard-synthetic-manifest", transactionId: "bootstrap" }, guard);
  const targetAdapter = new MemoryCatalogDrive("fresh-synthetic-folder");
  await assert.rejects(convertLegacySyntheticCopy({ sourceAdapter, sourceManifestFileId, withSourceLock: gate, assertSourceWritable: guard,
    targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure: () => true }), { code: "missing-legacy-history" });
  assert.equal(targetAdapter.files.size, 0);
});
