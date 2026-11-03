import { createOriginalRetentionRecord, assessOriginalRetention, processOriginalRetentionBatch, originalMayBeRestored,
  prepareOriginalRestore } from "./original-retention-policy.mjs";
import { encode, hashRaw, readVerified, writeVerified, storageError } from "./catalog-storage.mjs";
import { canonicalizeJcs } from "./transaction-protocol.mjs";

const INDEX_NAME = "ft-synthetic-original-imports.json";
const INDEX_KIND = "synthetic-original-import-index";
const API = "https://www.googleapis.com/drive/v3/files/";

/** A delete receipt plus same-authorization absence check, never a bare 404. */
export class GoogleDriveOriginalDeletion {
  constructor({ adapter, assertWritable }) { this.adapter = adapter; this.assertWritable = assertWritable; this.receipts = new Map(); }
  async deleteFile(fileId, record) {
    const metadata = await this.adapter.readMetadata(fileId);
    if (metadata.appProperties?.financeTrackerKind !== "retained-original" || metadata.mimeType === "application/vnd.google-apps.folder" ||
        !record || record.sourceFileId !== fileId || metadata.appProperties.financeTrackerTransaction !== record.importId ||
        metadata.appProperties.financeTrackerHash !== record.sourceSha256) {
      throw storageError("not-retained-original", "Only a verified synthetic retained-original object may be deleted.");
    }
    await readVerified(this.adapter, { fileId, sha256: record.sourceSha256, kind: "retained-original", transactionId: record.importId });
    const token = await this.adapter.accessToken();
    await this.assertWritable();
    if (await this.adapter.accessToken() !== token) throw storageError("authorization-changed", "Reconnect before deleting an original under changed authorization.");
    const response = await this.adapter.request(API + encodeURIComponent(fileId), { method: "DELETE" });
    if (!response.ok) throw storageError("delete-not-accepted", "Drive did not accept the original deletion.");
    if (await this.adapter.accessToken() !== token) throw storageError("authorization-changed", "Deletion outcome needs verification after authorization changed.");
    this.receipts.set(fileId, token);
  }
  async confirmAbsent(fileId) {
    const token = await this.adapter.accessToken();
    if (!this.receipts.has(fileId) || this.receipts.get(fileId) !== token) return false;
    await this.assertWritable();
    // Loss of the folder grant or a different account must not masquerade as
    // absence. A lone 404 can also mean permission loss, so it is insufficient.
    const folderResponse = await this.adapter.request(API + encodeURIComponent(this.adapter.folderId) + "?fields=id,mimeType,trashed");
    const folder = await folderResponse.json();
    if (folder.id !== this.adapter.folderId || folder.trashed || folder.mimeType !== "application/vnd.google-apps.folder") return false;
    const response = await this.adapter.request(API + encodeURIComponent(fileId) + "?fields=id,trashed", {}, { allowStatuses: [404] });
    return response.status === 404 && await this.adapter.accessToken() === token;
  }
}

function importFields(record) {
  return { privateSourceFileRef: record.sourceFileId, sourceFileRetainedAt: record.retainedAt,
    sourceFileRetentionExpiresAt: record.expiresAt, sourceFileRetentionStatus: record.state,
    sourceFileDeletedAt: record.deletionConfirmedAt };
}

/** Explicit synthetic import integration; the permanent CSV import stays local. */
export class SyntheticOriginalRetentionStore {
  constructor({ adapter, withWrite, assertWritable, now = () => new Date().toISOString(), deletionAdapter = null }) {
    this.adapter = adapter; this.withWrite = withWrite; this.assertWritable = assertWritable; this.now = now;
    this.deletion = deletionAdapter || new GoogleDriveOriginalDeletion({ adapter, assertWritable });
    this.queue = Promise.resolve();
  }
  run(operation) {
    const result = this.queue.then(() => this.withWrite(operation), () => this.withWrite(operation));
    this.queue = result.catch(() => {});
    return result;
  }
  async read() {
    const candidates = (await this.adapter.listChildren()).filter((file) => file.name === INDEX_NAME);
    if (candidates.length > 1) throw storageError("ambiguous-original-import-index", "Multiple original-import indexes exist.");
    if (!candidates.length) return { fileId: null, index: { format: "finance-tracker-synthetic-original-imports", version: 1, syntheticOnly: true, imports: [] } };
    const file = candidates[0];
    const metadata = await this.adapter.readMetadata(file.id);
    if (metadata.appProperties?.financeTrackerKind !== INDEX_KIND) throw storageError("invalid-original-import-index", "Original-import index metadata is invalid.");
    const index = await this.adapter.readJson(file.id);
    if (index.format !== "finance-tracker-synthetic-original-imports" || index.version !== 1 || index.syntheticOnly !== true || !Array.isArray(index.imports)) {
      throw storageError("invalid-original-import-index", "Original-import metadata is malformed.");
    }
    const ids = new Set();
    const locators = new Set();
    for (const item of index.imports) {
      if (!item.importId || ids.has(item.importId) || item.syntheticOnly !== true || item.status !== "completed") throw storageError("invalid-original-import", "Synthetic import records must have unique identities and completed status.");
      ids.add(item.importId);
      if (item.originalRetention) {
        const locator = item.originalRetention.sourceFileId;
        if (locator && locators.has(locator)) throw storageError("duplicate-original-locator", "A source file cannot belong to multiple import retention records.");
        if (locator) locators.add(locator);
        assessOriginalRetention(item.originalRetention, this.now());
        if (item.originalRetention.importId !== item.importId || Object.entries(importFields(item.originalRetention)).some(([key, value]) => item[key] !== value)) {
          throw storageError("original-import-binding-mismatch", "Import retention fields disagree with their original retention record.");
        }
      } else if (item.privateSourceFileRef !== null) throw storageError("missing-original-retention", "An original locator requires retention metadata.");
    }
    return { fileId: file.id, index };
  }
  async persist(base, index) {
    await this.assertWritable();
    if (base.fileId) {
      if (canonicalizeJcs(await this.adapter.readJson(base.fileId)) !== canonicalizeJcs(base.index)) throw storageError("original-index-conflict", "Original-import metadata changed before update.");
      await this.adapter.publishManifest(base.fileId, index, { beforeMutation: this.assertWritable });
    } else {
      await writeVerified(this.adapter, { content: index, kind: INDEX_KIND, transactionId: "synthetic-original-imports", name: INDEX_NAME }, this.assertWritable);
    }
    const readBack = await this.read();
    if (canonicalizeJcs(readBack.index) !== canonicalizeJcs(index)) throw storageError("original-index-unverified", "Original-import metadata did not read back exactly.");
    return readBack.index;
  }
  async retainFixture({ importId = globalThis.crypto.randomUUID() } = {}) {
    return this.run(async () => {
      const base = await this.read();
      if (base.index.imports.some((item) => item.importId === importId)) return base.index.imports.find((item) => item.importId === importId);
      // Generated here, rather than accepting a user's financial CSV as input.
      const bytes = encode("date,description,amount\n2026-01-01,Invented retention fixture,1.00\n");
      const location = await writeVerified(this.adapter, { content: bytes, kind: "retained-original", transactionId: importId,
        name: "ft-synthetic-original.csv" }, this.assertWritable);
      const retention = createOriginalRetentionRecord({ importId, sourceFileId: location.fileId, sourceSha256: location.sha256, retainedAt: this.now() });
      const item = { importId, status: "completed", syntheticOnly: true, ...importFields(retention), originalRetention: retention };
      await this.persist(base, { ...base.index, imports: [...base.index.imports, item] });
      return item;
    });
  }
  async process({ now = this.now() } = {}) {
    return this.run(async () => {
      const base = await this.read();
      const records = base.index.imports.filter((item) => item.originalRetention).map((item) => item.originalRetention);
      const byFileId = new Map(records.map((record) => [record.sourceFileId, record]));
      const batch = await processOriginalRetentionBatch(records, { now,
        deleteFile: (id) => this.deletion.deleteFile(id, byFileId.get(id)), confirmAbsent: (id) => this.deletion.confirmAbsent(id) });
      const updated = new Map(batch.records.map((record) => [record.importId, record]));
      const imports = base.index.imports.map((item) => updated.has(item.importId)
        ? { ...item, ...importFields(updated.get(item.importId)), originalRetention: updated.get(item.importId) } : item);
      if (canonicalizeJcs(imports) !== canonicalizeJcs(base.index.imports)) await this.persist(base, { ...base.index, imports });
      return batch.outcomes;
    });
  }
}

function base64(bytes) { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }

export async function validateArchivedOriginalImports(imports, exportedAt) {
  if (!Array.isArray(imports)) throw storageError("invalid-original-archive", "The archive must declare its original-import metadata list.");
  const ids = new Set();
  for (const item of imports) {
    if (!item.importId || ids.has(item.importId) || item.status !== "completed" || item.syntheticOnly !== true || item.privateSourceFileRef !== null) {
      throw storageError("invalid-original-archive", "Archived imports must have unique synthetic identities and no physical source locator.");
    }
    ids.add(item.importId);
    if (item.originalRetention && (item.originalRetention.importId !== item.importId ||
        Object.entries(importFields(item.originalRetention)).some(([key, value]) => key !== "privateSourceFileRef" && item[key] !== value))) {
      throw storageError("invalid-original-archive", "Archived import fields do not match their retained-original clock and status.");
    }
    if (item.originalOmitted === true) {
      if (item.contentBase64 !== null) throw storageError("expired-original-content", "An omitted original must not carry source bytes.");
      if (item.originalRetention) {
        const record = item.originalRetention;
        const assessment = assessOriginalRetention({ ...record, sourceFileId: record.state === "deleted" ? null : "omitted" }, exportedAt);
        if (!assessment.deletionEligible && record.state !== "deleted") throw storageError("invalid-original-omission", "An unexpired retained original cannot be silently omitted.");
      }
    } else {
      if (item.originalOmitted !== false || !item.originalRetention || !originalMayBeRestored(item.originalRetention, exportedAt) ||
          item.originalRetention.importId !== item.importId || item.originalRetention.sourceFileId !== "portable-original:" + item.importId ||
          typeof item.contentBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.contentBase64)) {
        throw storageError("invalid-original-archive", "An archived live original requires its unchanged retention clock and verified bytes.");
      }
      const bytes = Uint8Array.from(atob(item.contentBase64), (character) => character.charCodeAt(0));
      if (await hashRaw(bytes) !== item.originalRetention.sourceSha256) throw storageError("original-hash-mismatch", "Archived original bytes failed SHA-256 verification.");
    }
  }
}

/** Originals live outside immutable financial history so expiry can remove them. */
export async function archiveOriginalImports(adapter, now) {
  const store = new SyntheticOriginalRetentionStore({ adapter, withWrite: (operation) => operation(), assertWritable: async () => {}, now: () => now });
  const { index } = await store.read();
  const archived = [];
  for (const item of index.imports) {
    const record = item.originalRetention;
    const included = record && originalMayBeRestored(record, now);
    let contentBase64 = null;
    if (included) contentBase64 = base64(await readVerified(adapter, { fileId: record.sourceFileId, sha256: record.sourceSha256, kind: "retained-original", transactionId: item.importId }));
    archived.push({ ...item, privateSourceFileRef: null,
      originalRetention: record ? { ...record, sourceFileId: included ? "portable-original:" + item.importId : null } : null,
      contentBase64, originalOmitted: !included });
  }
  return archived;
}

export async function restoreOriginalImports({ adapter, imports, guard, now = new Date().toISOString() }) {
  if (!imports?.length) return;
  const restored = [];
  for (const item of imports) {
    const { contentBase64, originalOmitted, ...metadata } = item;
    let record = null;
    if (!originalOmitted && item.originalRetention && originalMayBeRestored(item.originalRetention, now)) {
      const bytes = Uint8Array.from(atob(contentBase64), (character) => character.charCodeAt(0));
      if (await hashRaw(bytes) !== item.originalRetention.sourceSha256) throw storageError("original-hash-mismatch", "A retained original archive object failed verification.");
      const location = await writeVerified(adapter, { content: bytes, kind: "retained-original", transactionId: item.importId, name: "ft-synthetic-original.csv" }, guard);
      record = prepareOriginalRestore(item.originalRetention, { now, restoredFileId: location.fileId });
    }
    restored.push({ ...metadata, originalRetention: record, ...(record ? importFields(record) : {
      privateSourceFileRef: null, sourceFileRetentionStatus: item.sourceFileRetentionStatus === "deleted" ? "deleted" : "not-retained",
      sourceFileOmittedReason: "expired-or-deleted-original-not-restored" }) });
  }
  const store = new SyntheticOriginalRetentionStore({ adapter, withWrite: (operation) => operation(), assertWritable: guard, now: () => now });
  const base = await store.read();
  if (base.index.imports.length) throw storageError("existing-original-imports", "Restore requires a fresh original-import index.");
  await store.persist(base, { ...base.index, imports: restored });
}
