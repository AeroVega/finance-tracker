import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCatalogDrive, setupCatalog } from "./helpers/catalog-drive.mjs";
import { SyntheticOriginalRetentionStore, GoogleDriveOriginalDeletion } from "../js/drive-original-retention.mjs";
import { ORIGINAL_RETENTION_MS } from "../js/original-retention-policy.mjs";
import { exportCatalogArchive, restoreCatalogArchive } from "../js/catalog-backup.mjs";
import { encode, hashRaw } from "../js/catalog-storage.mjs";

const guard = async () => {};
const gate = (operation) => operation();
const retainedAt = "2026-11-03T12:00:00.000Z";
const atExpiry = new Date(Date.parse(retainedAt) + ORIGINAL_RETENTION_MS).toISOString();

test("synthetic original upload persists canonical import retention fields; deletion preserves completed status", async () => {
  const adapter = new MemoryCatalogDrive();
  const deleted = new Set();
  const store = new SyntheticOriginalRetentionStore({ adapter, withWrite: gate, assertWritable: guard, now: () => retainedAt,
    deletionAdapter: { deleteFile: async (id) => { adapter.files.delete(id); deleted.add(id); }, confirmAbsent: async (id) => deleted.has(id) } });
  const item = await store.retainFixture({ importId: "invented-import" });
  assert.equal(item.sourceFileRetainedAt, retainedAt);
  assert.equal(item.sourceFileRetentionExpiresAt, atExpiry);
  assert.equal(item.status, "completed");
  assert.equal((await store.process({ now: new Date(Date.parse(atExpiry) - 1).toISOString() }))[0].outcome, "not-eligible");
  assert.equal((await store.process({ now: atExpiry }))[0].outcome, "deleted");
  const final = (await store.read()).index.imports[0];
  assert.equal(final.status, "completed");
  assert.equal(final.privateSourceFileRef, null);
  assert.equal(final.sourceFileRetentionStatus, "deleted");
  assert.equal((await store.process({ now: atExpiry }))[0].outcome, "already-deleted");
});

test("failed provider deletion keeps the live locator durable and retryable", async () => {
  const adapter = new MemoryCatalogDrive();
  const store = new SyntheticOriginalRetentionStore({ adapter, withWrite: gate, assertWritable: guard, now: () => retainedAt,
    deletionAdapter: { deleteFile: async () => { throw Object.assign(new Error("Denied"), { code: "authorization-required" }); }, confirmAbsent: async () => false } });
  const item = await store.retainFixture();
  assert.equal((await store.process({ now: atExpiry }))[0].outcome, "retryable-failure");
  const final = (await store.read()).index.imports[0];
  assert.equal(final.privateSourceFileRef, item.privateSourceFileRef);
  assert.equal(final.sourceFileRetentionStatus, "deletion-failed");
});

test("Drive deletion cannot accept wrong account, lost folder grant, or a bare 404 as confirmed absence", async () => {
  let token = "invented-token-a";
  let folderOK = true;
  let objectStatus = 404;
  const originalBytes = encode("invented original");
  const record = { sourceFileId: "original", importId: "invented-import", sourceSha256: await hashRaw(originalBytes) };
  const adapter = { folderId: "invented-folder", accessToken: async () => token,
    readBytes: async () => originalBytes,
    readMetadata: async () => ({ id: "original", parents: ["invented-folder"], appProperties: {
      financeTrackerKind: "retained-original", financeTrackerHash: record.sourceSha256, financeTrackerTransaction: record.importId } }),
    request: async (url, options = {}) => {
      if (options.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("invented-folder")) {
        if (!folderOK) throw Object.assign(new Error("Forbidden"), { code: "authorization-required" });
        return Response.json({ id: "invented-folder", mimeType: "application/vnd.google-apps.folder", trashed: false });
      }
      return new Response(null, { status: objectStatus });
    } };
  const deletion = new GoogleDriveOriginalDeletion({ adapter, assertWritable: guard });
  assert.equal(await deletion.confirmAbsent("original"), false);
  await deletion.deleteFile("original", record);
  objectStatus = 200;
  assert.equal(await deletion.confirmAbsent("original"), false);
  objectStatus = 404;
  assert.equal(await deletion.confirmAbsent("original"), true);
  token = "invented-token-b";
  assert.equal(await deletion.confirmAbsent("original"), false);
  token = "invented-token-a";
  folderOK = false;
  await assert.rejects(deletion.confirmAbsent("original"), { code: "authorization-required" });
});

test("backup and restore preserve original clocks and omit expired source bytes", async () => {
  const { adapter, manifestFileId } = await setupCatalog();
  const store = new SyntheticOriginalRetentionStore({ adapter, withWrite: gate, assertWritable: guard, now: () => retainedAt });
  await store.retainFixture({ importId: "invented-retention-import" });
  const archive = await exportCatalogArchive({ adapter, manifestFileId, withSourceLock: gate, validateStructure: () => true, now: retainedAt });
  assert.equal(archive.originalImports[0].originalRetention.retainedAt, retainedAt);
  const target = new MemoryCatalogDrive("restored-synthetic-folder");
  await restoreCatalogArchive({ archive, targetAdapter: target, withTargetLock: gate, assertTargetWritable: guard, validateStructure: () => true });
  const restored = new SyntheticOriginalRetentionStore({ adapter: target, withWrite: gate, assertWritable: guard, now: () => retainedAt });
  assert.equal((await restored.read()).index.imports[0].sourceFileRetentionExpiresAt, atExpiry);
  const expiredArchive = await exportCatalogArchive({ adapter, manifestFileId, withSourceLock: gate, validateStructure: () => true, now: atExpiry });
  assert.equal(expiredArchive.originalImports[0].contentBase64, null);
  const expiredTarget = new MemoryCatalogDrive("expired-synthetic-folder");
  await restoreCatalogArchive({ archive: expiredArchive, targetAdapter: expiredTarget, withTargetLock: gate, assertTargetWritable: guard, validateStructure: () => true });
  assert.equal((await expiredTarget.listChildren()).some((file) => file.appProperties.financeTrackerKind === "retained-original"), false);
});
