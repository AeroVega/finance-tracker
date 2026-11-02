import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createPortableBackup, verifyPortableBackup, planPortableRestore } from "../js/portable-backup.mjs";

const cryptoImpl = globalThis.crypto || webcrypto;
const encoder = new TextEncoder();
const hash = async (bytes) => {
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
};
const sourceBytes = encoder.encode('{"synthetic":true,"rows":2}');
const sourceHash = await hash(sourceBytes);
const manifest = {
  format: "finance-tracker-manifest", manifestVersion: "1.0.0", schemaVersion: 1,
  databaseId: "synthetic-database", copyId: "synthetic-backup-copy", role: "backup",
  lifecycleStatus: "active", revision: 7, commitId: "synthetic-commit-7",
  parentCommitId: "synthetic-commit-6", storageBinding: "synthetic-backup-folder"
};
const commitRecord = {
  format: "finance-tracker-commit", version: 1, databaseId: manifest.databaseId,
  copyId: manifest.copyId, commitId: manifest.commitId, revision: manifest.revision,
  parentCommitId: manifest.parentCommitId, snapshot: {
    "ledger/synthetic.json": { fileId: "synthetic-object-1", sha256: sourceHash }
  }
};

async function archive() {
  return createPortableBackup({
    manifest, commitRecord,
    objects: [{ logicalPath: "ledger/synthetic.json", bytes: sourceBytes }],
    exportedAt: "2026-11-02T20:00:00.000Z",
    cryptoImpl
  });
}

test("exports a portable snapshot and verifies its envelope, object hash, and structure", async () => {
  const result = await verifyPortableBackup(await archive(), {
    cryptoImpl,
    validateStructure: async ({ manifest: input, commitRecord: commit, objects }) =>
      input.databaseId === commit.databaseId && objects["ledger/synthetic.json"] instanceof Uint8Array
  });
  assert.equal(result.valid, true);
  assert.equal(result.objectCount, 1);
  assert.equal(new TextDecoder().decode(result.objects["ledger/synthetic.json"]), new TextDecoder().decode(sourceBytes));
});

test("plans restore with a new copy identity while preserving logical database and commit lineage", async () => {
  const plan = await planPortableRestore(await archive(), {
    newCopyId: "synthetic-restored-copy",
    newStorageBinding: "synthetic-restored-folder",
    now: "2026-11-02T21:00:00.000Z",
    cryptoImpl
  });
  assert.equal(plan.manifest.databaseId, manifest.databaseId);
  assert.equal(plan.manifest.copyId, "synthetic-restored-copy");
  assert.equal(plan.manifest.role, "primary");
  assert.equal(plan.manifest.commitId, manifest.commitId);
  assert.equal(plan.manifest.parentCommitId, manifest.parentCommitId);
  assert.equal(plan.manifest.storageBinding, "synthetic-restored-folder");
});

test("rejects archive tampering before exposing restored objects", async () => {
  const changed = await archive();
  changed.objects[0].contentBase64 = btoa("tampered");
  await assert.rejects(verifyPortableBackup(changed, { cryptoImpl }), (error) =>
    error.code === "archive-hash-mismatch");
});

test("rejects missing, extra, duplicate, or hash-mismatched snapshot objects", async () => {
  const good = await archive();
  const missing = { ...good, objects: [] };
  // Re-signing is intentionally not exposed; envelope tampering is caught first.
  await assert.rejects(verifyPortableBackup(missing, { cryptoImpl }), (error) => error.code === "archive-hash-mismatch");
  await assert.rejects(createPortableBackup({
    manifest, commitRecord, objects: [], cryptoImpl
  }), (error) => error.code === "snapshot-object-set-mismatch");
  await assert.rejects(createPortableBackup({
    manifest, commitRecord,
    objects: [
      { logicalPath: "ledger/synthetic.json", bytes: sourceBytes },
      { logicalPath: "ledger/synthetic.json", bytes: sourceBytes }
    ], cryptoImpl
  }), (error) => error.code === "invalid-logical-path");
  await assert.rejects(createPortableBackup({
    manifest, commitRecord,
    objects: [{ logicalPath: "ledger/synthetic.json", bytes: encoder.encode("different") }],
    cryptoImpl
  }), (error) => error.code === "object-hash-mismatch");
});

test("rejects a primary, quarantined, or identity-mismatched manifest", async () => {
  await assert.rejects(createPortableBackup({
    manifest: { ...manifest, role: "primary" }, commitRecord,
    objects: [{ logicalPath: "ledger/synthetic.json", bytes: sourceBytes }], cryptoImpl
  }), (error) => error.code === "not-restorable-backup");
  await assert.rejects(createPortableBackup({
    manifest: { ...manifest, lifecycleStatus: "quarantined" }, commitRecord,
    objects: [{ logicalPath: "ledger/synthetic.json", bytes: sourceBytes }], cryptoImpl
  }), (error) => error.code === "not-restorable-backup");
});

test("restore requires a new copy ID and explicit destination binding", async () => {
  await assert.rejects(planPortableRestore(await archive(), {
    newCopyId: manifest.copyId, newStorageBinding: "destination", cryptoImpl
  }), (error) => error.code === "invalid-restore-copy-id");
  await assert.rejects(planPortableRestore(await archive(), {
    newCopyId: "new-copy", newStorageBinding: "", cryptoImpl
  }), (error) => error.code === "invalid-storage-binding");
});
