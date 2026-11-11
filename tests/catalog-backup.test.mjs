import test from "node:test";
import assert from "node:assert/strict";
import { setupCatalog, MemoryCatalogDrive } from "./helpers/catalog-drive.mjs";
import { exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive, backupCatalogCopy } from "../js/catalog-backup.mjs";
import { verifyCatalogHistory, hashRaw, encode } from "../js/catalog-storage.mjs";

const gate = (operation) => operation();
const guard = async () => {};
const validateStructure = ({ objects }) => Object.values(objects).every((bytes) => JSON.parse(new TextDecoder().decode(bytes)).syntheticOnly === true);

async function fixture() {
  const setup = await setupCatalog();
  await setup.engine.transact(setup.transaction);
  const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId, withSourceLock: gate, validateStructure });
  return { ...setup, archive };
}

test("archive and restored Drive copy preserve exact logical history with different physical IDs", async () => {
  const { adapter, manifestFileId, archive } = await fixture();
  const source = await verifyCatalogHistory(adapter, await adapter.readJson(manifestFileId));
  const targetAdapter = new MemoryCatalogDrive("other-synthetic-folder");
  const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure });
  const target = await verifyCatalogHistory(targetAdapter, restored.manifest);
  assert.notEqual(restored.manifest.copyId, archive.sourceCopyId);
  assert.equal(restored.manifest.commitRecordHash, archive.manifest.commitRecordHash);
  for (const [key, entry] of Object.entries(source.catalog.entries)) {
    assert.notEqual(target.catalog.entries[key].fileId, entry.fileId);
    assert.deepEqual(target.objects.get(key), source.objects.get(key));
  }
  assert.equal(archive.objects.some((item) => Object.hasOwn(item, "fileId")), false);
  assert.equal(targetAdapter.files.get(restored.manifestFileId).metadata.name, "ft-synthetic-dashboard-manifest.json");
});

test("separately bound backup uses a source gate and publishes only after source stability verification", async () => {
  const { adapter, manifestFileId } = await fixture();
  const targetAdapter = new MemoryCatalogDrive("backup-synthetic-folder");
  let locked = false;
  const result = await backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: async (operation) => { locked = true; try { return await operation(); } finally { locked = false; } },
    assertSourceWritable: async () => assert.equal(locked, true), targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure });
  assert.equal(result.manifest.role, "backup");
  assert.equal([...targetAdapter.files.keys()].at(-1), result.manifestFileId);
  await verifyCatalogHistory(targetAdapter, result.manifest);
});

test("archive missing history and altered objects fail even after the envelope is rehashed", async () => {
  const { archive } = await fixture();
  const damaged = structuredClone(archive);
  damaged.objects = damaged.objects.filter((item) => item.kind !== "commit-record" || item.identity === archive.manifest.commitId);
  delete damaged.archiveSha256;
  damaged.archiveSha256 = await hashRaw(encode(damaged));
  await assert.rejects(verifyCatalogArchive(damaged, { validateStructure }), { code: "locator-not-found" });
  const modified = structuredClone(archive);
  modified.objects[0].contentBase64 = btoa("corrupt");
  delete modified.archiveSha256;
  modified.archiveSha256 = await hashRaw(encode(modified));
  await assert.rejects(verifyCatalogArchive(modified, { validateStructure }), { code: "archive-object-hash-mismatch" });
});

test("failed copies retain a durable quarantine marker and cannot be reopened", async () => {
  const { archive } = await fixture();
  const targetAdapter = new MemoryCatalogDrive("quarantine-synthetic-folder");
  await assert.rejects(restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure,
    beforePublish: async () => { throw new Error("Synthetic source changed"); } }), (error) => error.code === "copy-quarantined" && error.quarantineConfirmed === true);
  const preparation = await targetAdapter.readJson([...targetAdapter.files.keys()][0]);
  assert.equal(preparation.state, "quarantined");
  assert.equal((await targetAdapter.listChildren()).some((file) => file.appProperties.financeTrackerKind === "dashboard-synthetic-manifest"), false);
  await assert.rejects(restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure }), { code: "fresh-destination-required" });
});

test("restores cannot reuse a primary identity carried through a backup archive", async () => {
  const { adapter, manifestFileId } = await fixture();
  const originalCopyId = (await adapter.readJson(manifestFileId)).copyId;
  const backupAdapter = new MemoryCatalogDrive("identity-backup-synthetic-folder");
  const backup = await backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId, withSourceLock: gate,
    assertSourceWritable: guard, targetAdapter: backupAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure });
  const archive = await exportCatalogArchive({ adapter: backupAdapter, manifestFileId: backup.manifestFileId, withSourceLock: gate, validateStructure });
  const targetAdapter = new MemoryCatalogDrive("identity-restore-synthetic-folder");
  await assert.rejects(restoreCatalogArchive({ archive, newCopyId: originalCopyId, targetAdapter,
    withTargetLock: gate, assertTargetWritable: guard, validateStructure }), { code: "invalid-copy-identity" });
  assert.equal(targetAdapter.files.size, 0);
});

test("source changes during copying quarantine the destination and never alter the source", async () => {
  const { adapter, manifestFileId } = await fixture();
  const targetAdapter = new MemoryCatalogDrive("unstable-synthetic-folder");
  await assert.rejects(backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId, withSourceLock: gate,
    assertSourceWritable: async () => { const manifest = await adapter.readJson(manifestFileId); adapter.files.get(manifestFileId).bytes = encode({ ...manifest, syntheticChange: true }); },
    targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure }), (error) => error.code === "source-changed");
});

test('retained validation rejects callback changes to the catalog before returning to copy/export', async t => {
  const { validateRetainedStructure } = await import('../js/catalog-backup.mjs');
  const { createLocatorCatalog } = await import('../js/drive-locator-catalog.mjs');
  const hash = 'a'.repeat(64);
  for (const mutation of ['invalid', 'valid rebound', 'changed kind', 'changed map', 'hidden binding']) await t.test(mutation, async () => {
    const catalog = createLocatorCatalog({ databaseId: 'invented-db', copyId: 'invented-copy', additions: [
      { kind: 'data-object', identity: hash, sha256: hash, fileId: 'invented-data' },
      ...['one', 'two'].map(identity => ({ kind: 'commit-record', identity, sha256: hash, fileId: 'invented-' + identity }))
    ] });
    const entry = catalog.entries['data-object:' + hash];
    if (mutation === 'hidden binding') Object.defineProperty(entry, 'fileId', { enumerable: false });
    const objects = new Map(['one', 'two'].map((id, i) => ['commit-record:' + id, new TextEncoder().encode(JSON.stringify({
      format: 'finance-tracker-commit', version: 2, databaseId: 'invented-db', commitId: id,
      revision: i, parentCommitId: i ? 'one' : null, snapshot: { path: hash }
    }))]));
    let calls = 0;
    await assert.rejects(validateRetainedStructure({ manifest: { databaseId: 'invented-db' }, catalog, objects,
      validateStructure: async () => {
        if (++calls === 1) {
          await Promise.resolve();
          if (mutation === 'invalid') entry.fileId = '';
          else if (mutation === 'changed kind') catalog.entries['commit-record:two'].kind = 'protocol-object';
          else if (mutation === 'changed map') catalog.entries = {};
          else entry.fileId = 'invented-rebound';
        }
        return true;
      } }));
  });
});


test("Drive backup bypasses portable base64 and verifies discarded source payloads before copying", async () => {
  const { adapter, manifestFileId } = await fixture();
  const targetAdapter = new MemoryCatalogDrive("streamed-synthetic-folder");
  const previous = globalThis.btoa;
  globalThis.btoa = () => { throw new Error("Drive backup must not build a base64 archive"); };
  let result;
  try {
    result = await backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
      withSourceLock: gate, assertSourceWritable: guard, targetAdapter, withTargetLock: gate,
      assertTargetWritable: guard, validateStructure });
  } finally { globalThis.btoa = previous; }
  const source = await verifyCatalogHistory(adapter, await adapter.readJson(manifestFileId));
  const target = await verifyCatalogHistory(targetAdapter, result.manifest);
  assert.deepEqual(target.objects, source.objects);
});

test("Drive backup rejects source data corrupted after validation and quarantines the target", async () => {
  const { adapter, manifestFileId } = await fixture();
  const targetAdapter = new MemoryCatalogDrive("changed-payload-synthetic-folder");
  const source = await verifyCatalogHistory(adapter, await adapter.readJson(manifestFileId));
  const entry = Object.values(source.catalog.entries).find(entry => entry.kind === "data-object");
  await assert.rejects(backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: gate, assertSourceWritable: guard, targetAdapter, withTargetLock: gate,
    assertTargetWritable: guard, validateStructure, onProgress: event => {
      if (event.phase === "destination-preparation") adapter.files.get(entry.fileId).bytes = encode("invented changed payload");
    } }), error => error.code === "copy-quarantined" && error.cause.code === "immutable-hash-mismatch");
  assert.equal((await targetAdapter.listChildren()).some(file => file.appProperties.financeTrackerKind === "dashboard-synthetic-manifest"), false);
});

test("Drive backup refuses unfinished original-retention intent before destination mutation", async () => {
  const { SyntheticOriginalRetentionStore } = await import("../js/drive-original-retention.mjs");
  const { adapter, manifestFileId } = await fixture();
  const originals = new SyntheticOriginalRetentionStore({ adapter, withWrite: gate, assertWritable: guard });
  adapter.stopAfter = adapter.mutations + 1;
  await assert.rejects(originals.retainFixture({ importId: "invented-pending-original" }), { code: "page-terminated" });
  adapter.reboot();
  const targetAdapter = new MemoryCatalogDrive("pending-original-synthetic-folder");
  await assert.rejects(backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: gate, assertSourceWritable: guard, targetAdapter, withTargetLock: gate,
    assertTargetWritable: guard, validateStructure }), { code: "invalid-original-archive" });
  assert.equal(targetAdapter.files.size, 0);
});


test("Drive backup quarantines if the original-import inventory changes after validation", async () => {
  const { SyntheticOriginalRetentionStore } = await import("../js/drive-original-retention.mjs");
  const { adapter, manifestFileId } = await fixture();
  const originals = new SyntheticOriginalRetentionStore({ adapter, withWrite: gate, assertWritable: guard });
  await originals.retainFixture({ importId: "invented-index-change-original" });
  const originalBase = await originals.read();
  const targetAdapter = new MemoryCatalogDrive("changed-original-inventory-synthetic-folder");
  await assert.rejects(backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: gate, assertSourceWritable: guard, targetAdapter, withTargetLock: gate,
    assertTargetWritable: guard, validateStructure, onProgress: event => {
      if (event.phase === "destination-preparation") {
        adapter.files.get(originalBase.fileId).bytes = encode({ ...originalBase.index, imports: [] });
      }
    } }), error => error.code === "copy-quarantined" && error.cause.code === "source-originals-changed" && error.quarantineConfirmed);
  assert.equal((await targetAdapter.listChildren()).some(file => file.appProperties.financeTrackerKind === "dashboard-synthetic-manifest"), false);
});


test("Drive backup compares the inventory actually consumed, even if it changes back before publication", async () => {
  const { SyntheticOriginalRetentionStore } = await import("../js/drive-original-retention.mjs");
  const { adapter, manifestFileId } = await fixture();
  const originals = new SyntheticOriginalRetentionStore({ adapter, withWrite: gate, assertWritable: guard });
  await originals.retainFixture({ importId: "invented-inventory-aba-original" });
  const originalBase = await originals.read();
  const originalBytes = adapter.files.get(originalBase.fileId).bytes;
  const targetAdapter = new MemoryCatalogDrive("aba-original-inventory-synthetic-folder");
  await assert.rejects(backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: gate, assertSourceWritable: guard, targetAdapter, withTargetLock: gate,
    assertTargetWritable: guard, validateStructure, onProgress: event => {
      if (event.phase === "destination-preparation") adapter.files.get(originalBase.fileId).bytes = encode({ ...originalBase.index, imports: [] });
      if (event.phase === "destination-verification") adapter.files.get(originalBase.fileId).bytes = originalBytes;
    } }), error => error.code === "copy-quarantined" && error.cause.code === "source-originals-changed");
  assert.equal((await targetAdapter.listChildren()).some(file => file.appProperties.financeTrackerKind === "dashboard-synthetic-manifest"), false);
});
