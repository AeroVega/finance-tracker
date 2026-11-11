import { canonicalizeJcs, verifyJournal } from "./transaction-protocol.mjs";
import { createLocatorCatalog, locatorKey, createCatalogResolver, validateLocatorCatalog } from "./drive-locator-catalog.mjs";
import { encode, hashRaw, writeVerified, verifyCatalogHistory, validateLogicalCommit, storageError, readVerified, writeCatalog } from "./catalog-storage.mjs";
import { archiveOriginalImports, iterateArchivedOriginalImports, SyntheticOriginalRetentionStore, restoreOriginalImports, validateArchivedOriginalImports } from "./drive-original-retention.mjs";

// Observers receive only fixed phases and aggregate counts. They cannot delay
// a storage operation or turn an observer failure into a copy failure.
function reportProgress(onProgress, phase, completed = null, total = null) {
  if (typeof onProgress !== "function") return;
  try { Promise.resolve(onProgress(Object.freeze({ phase, completed, total }))).catch(() => {}); }
  catch { /* progress is observational */ }
}

/** Copy only independent retained bytes, never transaction/publication writes. */
async function copyRetainedObjects(verified, adapter, guard, onProgress) {
  const entries = Object.entries(verified.catalog.entries);
  const additions = new Array(entries.length);
  let next = 0, completed = 0;
  let failed = false, failure, failureIndex = Infinity;
  reportProgress(onProgress, "copying-objects", completed, entries.length);
  const worker = async () => {
    while (!failed && next < entries.length) {
      const index = next++;
      const [key, entry] = entries[index];
      try {
        const content = verified.readObject ? await verified.readObject(key, entry) : verified.objects.get(key);
        if (!(content instanceof Uint8Array) || await hashRaw(content) !== entry.sha256) {
          throw storageError("copy-source-hash-mismatch", "A retained source object changed before copying.");
        }
        const location = await writeVerified(adapter, { content,
          kind: entry.kind === "data-object" ? "snapshot-object" : entry.kind,
          transactionId: entry.transactionId || verified.transactionId, name: "ft-" + entry.kind + ".bin" }, guard);
        additions[index] = { ...entry, ...location };
        reportProgress(onProgress, "copying-objects", ++completed, entries.length);
      } catch (error) {
        // Keep the earliest input failure even when later work rejects first.
        if (index < failureIndex) { failure = error; failureIndex = index; }
        failed = true;
      }
    }
  };
  // Every admitted create and its exact-ID verification must settle before
  // quarantine, publication, or either session gate can complete.
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  if (failed) throw failure;
  return additions;
}

function base64(bytes) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}
function decodeBase64(text) {
  if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw storageError("invalid-base64", "Archive object bytes are malformed.");
  return Uint8Array.from(atob(text), (part) => part.charCodeAt(0));
}

export async function validateRetainedStructure({ manifest, catalog, objects, readObject, validateStructure }) {
  if (typeof validateStructure !== "function") throw storageError("structural-validator-required", "An application structural validator is required.");
  validateLocatorCatalog(catalog);
  const originalCatalog = canonicalizeJcs(catalog);
  const resolver = createCatalogResolver(catalog);
  const pinned = resolver.bindings();
  const originalBindings = canonicalizeJcs(pinned);
  const journals = new Map();
  for (const [key, entry] of Object.entries(pinned.entries)) {
    if (entry.kind === "commit-record") {
      const record = JSON.parse(new TextDecoder().decode(objects.get(key)));
      validateLogicalCommit(record, manifest.databaseId);
      if (record.commitId !== entry.identity) throw storageError("commit-identity-mismatch", "A commit locator has the wrong logical identity.");
      const resolved = resolver.resolveSnapshot(record.snapshot);
      const snapshotObjects = {};
      // Only one complete historical snapshot is admitted at a time. The
      // application validator still requires a complete graph, never a slice.
      for (const path of Object.keys(resolved)) {
        const key = "data-object:" + record.snapshot[path];
        snapshotObjects[path] = readObject ? await readObject(key, pinned.entries[key]) : objects.get(key);
      }
      if (await validateStructure({ manifest: { ...manifest, revision: record.revision, commitId: record.commitId }, commitRecord: record, objects: snapshotObjects }) !== true) {
        throw storageError("structural-validation-failed", "A retained historical snapshot failed application validation.");
      }
    }
    if (entry.kind === "journal-event") {
      const event = JSON.parse(new TextDecoder().decode(objects.get(key)));
      if (event.eventId !== entry.identity || event.transactionId !== entry.transactionId || event.sequence !== entry.sequence) {
        throw storageError("journal-identity-mismatch", "A retained journal event has the wrong catalog binding.");
      }
      if (!journals.has(event.transactionId)) journals.set(event.transactionId, []);
      journals.get(event.transactionId).push(event);
    }
  }
  for (const events of journals.values()) {
    events.sort((a, b) => a.sequence - b.sequence);
    const state = await verifyJournal(events);
    if (!["committed", "aborted"].includes(state.status)) throw storageError("unfinished-history", "Backups require terminal retained journals.");
  }
  // Caller-provided asynchronous validators cannot change what a subsequent
  // copy/export will consume. Reject before returning to either operation.
  const after = createCatalogResolver(catalog);
  if (canonicalizeJcs(catalog) !== originalCatalog || canonicalizeJcs(after.bindings()) !== originalBindings) {
    throw storageError("catalog-changed", "The catalog changed during retained structure verification.");
  }
}

/** Version 2 carries exact retained history; version-1 archives remain legacy-only. */
export async function exportCatalogArchive({ adapter, manifestFileId, withSourceLock, validateStructure, now = new Date().toISOString(), onProgress }) {
  if (typeof withSourceLock !== "function") throw storageError("source-lock-required", "Export requires the source session gate.");
  return withSourceLock(async () => {
    reportProgress(onProgress, "source-verification");
    const manifest = await adapter.readJson(manifestFileId, { kind: "manifest" });
    if (manifest.catalogFinalizationPending !== null) throw storageError("recovery-required", "Complete catalog recovery before export.");
    const { catalog, objects } = await verifyCatalogHistory(adapter, manifest);
    await validateRetainedStructure({ manifest, catalog, objects, validateStructure });
    const { locatorCatalog, copyPreparationFileId, ...portableManifest } = manifest;
    portableManifest.storageBinding = { provider: "portable-archive", folderId: null };
    const archive = { format: "finance-tracker-portable-backup", version: 2, exportedAt: now,
      sourceCopyId: manifest.copyId, manifest: portableManifest, originalImports: await archiveOriginalImports(adapter, now),
      objects: Object.entries(catalog.entries).map(([key, entry]) => {
        const { fileId, ...logical } = entry;
        return { ...logical, contentBase64: base64(objects.get(key)) };
      }) };
    archive.archiveSha256 = await hashRaw(encode(archive));
    if (canonicalizeJcs(await adapter.readJson(manifestFileId, { kind: "manifest" })) !== canonicalizeJcs(manifest)) throw storageError("source-changed", "The source manifest changed during export.");
    return archive;
  });
}

export async function verifyCatalogArchive(archive, { validateStructure, onProgress } = {}) {
  reportProgress(onProgress, "archive-verification");
  if (archive?.format !== "finance-tracker-portable-backup" || archive.version !== 2 || !Array.isArray(archive.objects) ||
      archive.manifest?.storageBinding?.provider !== "portable-archive" || archive.manifest.storageBinding.folderId !== null ||
      archive.manifest.copyId !== archive.sourceCopyId || archive.manifest.locatorCatalog || archive.manifest.copyPreparationFileId ||
      archive.manifest.catalogFinalizationPending !== null) throw storageError("invalid-catalog-archive", "A complete version-2 portable archive is required.");
  const { archiveSha256, ...unsigned } = archive;
  if (await hashRaw(encode(unsigned)) !== archiveSha256) throw storageError("archive-hash-mismatch", "The archive envelope failed SHA-256 verification.");
  await validateArchivedOriginalImports(archive.originalImports, archive.exportedAt);
  const objects = new Map();
  const additions = [];
  for (const item of archive.objects) {
    if (Object.hasOwn(item, "fileId")) throw storageError("physical-archive-locator", "Portable mappings cannot contain Drive file IDs.");
    const key = locatorKey(item.kind, item.identity);
    if (objects.has(key)) throw storageError("duplicate-archive-object", "Archive identities must be unique.");
    const bytes = decodeBase64(item.contentBase64);
    if (await hashRaw(bytes) !== item.sha256) throw storageError("archive-object-hash-mismatch", "An archive object failed exact-byte verification.");
    objects.set(key, bytes);
    additions.push({ ...item, fileId: "portable-" + additions.length });
  }
  const catalog = createLocatorCatalog({ databaseId: archive.manifest.databaseId, copyId: archive.sourceCopyId, additions });
  // Use the same ancestry/hash verifier as live storage, through an inert adapter.
  const catalogBytes = encode(catalog);
  const pointer = { fileId: "portable-catalog", sha256: await hashRaw(catalogBytes) };
  const byId = new Map(Object.entries(catalog.entries).map(([key, entry]) => [entry.fileId, { bytes: objects.get(key), entry }]));
  byId.set(pointer.fileId, { bytes: catalogBytes, entry: { ...pointer, kind: "locator-catalog" } });
  const adapter = { folderId: "portable-verification",
    readBytes: async (id) => byId.get(id).bytes,
    readMetadata: async (id) => { const entry = byId.get(id).entry; return { id, parents: ["portable-verification"],
      appProperties: { financeTrackerKind: entry.kind === "data-object" ? "snapshot-object" : entry.kind,
        financeTrackerHash: entry.sha256, financeTrackerTransaction: entry.transactionId } }; } };
  await verifyCatalogHistory(adapter, { ...archive.manifest, storageBinding: { provider: "google-drive", folderId: adapter.folderId }, locatorCatalog: pointer });
  await validateRetainedStructure({ manifest: archive.manifest, catalog, objects, validateStructure });
  return { catalog, objects, manifest: archive.manifest };
}

/** A prepared-state marker precedes the manifest; any failed copy stays quarantined. */
export async function restoreCatalogArchive({ archive, targetAdapter, newCopyId = globalThis.crypto.randomUUID(),
  role = "primary", withTargetLock, assertTargetWritable, validateStructure, beforePublish = async () => {}, onProgress }) {
  if (typeof withTargetLock !== "function" || typeof assertTargetWritable !== "function") throw storageError("target-lock-required", "A verified destination session gate is required.");
  const knownCopyIds = [archive?.sourceCopyId, archive?.manifest?.copyId, archive?.manifest?.restoredFromCopyId];
  if (typeof newCopyId !== "string" || !newCopyId.trim() || knownCopyIds.includes(newCopyId) || !["primary", "backup"].includes(role)) throw storageError("invalid-copy-identity", "A distinct destination copy identity and supported role are required.");
  return withTargetLock(async () => {
    const verified = await verifyCatalogArchive(archive, { validateStructure, onProgress });
    return restoreVerifiedCatalog({ verified, originalImports: archive.originalImports, targetAdapter, newCopyId,
      role, assertTargetWritable, beforePublish, onProgress });
  });
}

// Private entry point. Both callers have completed full source verification.
// A Drive backup does not need to encode and decode a portable archive first.
async function restoreVerifiedCatalog({ verified, originalImports, targetAdapter, newCopyId, role,
  assertTargetWritable, beforePublish, onProgress }) {
    if (typeof newCopyId !== "string" || !newCopyId.trim() ||
        [verified.manifest.copyId, verified.manifest.restoredFromCopyId].includes(newCopyId) ||
        !["primary", "backup"].includes(role)) {
      throw storageError("invalid-copy-identity", "A distinct destination copy identity and supported role are required.");
    }
    for (const [key, bytes] of verified.objects) {
      if (key.startsWith("journal-event:") || key.startsWith("migration-record:")) {
        let evidence;
        try { evidence = JSON.parse(new TextDecoder().decode(bytes)); } catch { continue; }
        const origin = evidence.eventType === "transaction-started" ? evidence.payload?.copyId :
          ["finance-tracker-manifest", "finance-tracker-commit"].includes(evidence.format) ? evidence.copyId : null;
        if (origin === newCopyId) throw storageError("invalid-copy-identity", "The destination cannot reuse an archived source-copy identity.");
      }
    }
    reportProgress(onProgress, "destination-preparation");
    const children = await targetAdapter.listChildren();
    if (children.some((file) => !(file.name === "finance-tracker-active-session.json" && file.appProperties?.financeTrackerSession === "v1"))) {
      throw storageError("fresh-destination-required", "Copy only into a fresh synthetic folder. Partial destinations remain evidence.");
    }
    const transactionId = globalThis.crypto.randomUUID();
    let markerId;
    const preparation = { format: "finance-tracker-copy-preparation", version: 1,
      databaseId: verified.manifest.databaseId, copyId: newCopyId, state: "quarantined" };
    try {
      const marker = await writeVerified(targetAdapter, { content: preparation, kind: "copy-preparation", transactionId,
        name: "ft-copy-preparation.json" }, assertTargetWritable);
      markerId = marker.fileId;
      const additions = await copyRetainedObjects({ ...verified, transactionId }, targetAdapter, assertTargetWritable, onProgress);
      const { pointer } = await writeCatalog(targetAdapter, {
        manifest: { ...verified.manifest, copyId: newCopyId, catalogFinalizationPending: transactionId }, additions
      }, assertTargetWritable);
      const manifest = { ...verified.manifest, copyId: newCopyId, role, lifecycleStatus: "active",
        storageBinding: { provider: "google-drive", folderId: targetAdapter.folderId }, locatorCatalog: pointer,
        restoredFromCopyId: verified.manifest.copyId, copyPreparationFileId: markerId };
      await restoreOriginalImports({ adapter: targetAdapter, imports: originalImports, guard: assertTargetWritable });
      reportProgress(onProgress, "destination-verification");
      // Mark preparation ready before publication; without the final manifest
      // this folder still cannot be selected as a database copy.
      await assertTargetWritable();
      await targetAdapter.publishManifest(markerId, { ...preparation, state: "ready" }, { beforeMutation: assertTargetWritable });
      await verifyCatalogHistory(targetAdapter, manifest, globalThis.crypto, { retainDataObjects: false });
      await beforePublish();
      reportProgress(onProgress, "publishing-manifest");
      const result = await writeVerified(targetAdapter, { content: manifest, kind: "dashboard-synthetic-manifest", transactionId,
        name: "ft-synthetic-dashboard-manifest.json" }, assertTargetWritable);
      reportProgress(onProgress, "final-verification");
      await verifyCatalogHistory(targetAdapter, await targetAdapter.readJson(result.fileId, { kind: "manifest" }), globalThis.crypto, { retainDataObjects: false });
      return { manifestFileId: result.fileId, manifest, objectCount: additions.length };
    } catch (error) {
      let quarantined = false;
      if (markerId) {
        try { await assertTargetWritable(); await targetAdapter.publishManifest(markerId, preparation, { beforeMutation: assertTargetWritable }); quarantined = true; }
        catch { /* never claim durable quarantine when the provider is unavailable */ }
      }
      throw Object.assign(storageError("copy-quarantined", "The copy is incomplete. Preserve the destination and retry in a fresh folder."),
        { cause: error, quarantineConfirmed: quarantined });
    }

}

export async function backupCatalogCopy({ sourceAdapter, sourceManifestFileId, withSourceLock, assertSourceWritable,
  targetAdapter, withTargetLock, assertTargetWritable, validateStructure, onProgress }) {
  if (sourceAdapter.folderId === targetAdapter.folderId) throw storageError("same-backup-destination", "Backup requires a separate physical folder.");
  if (typeof withSourceLock !== "function" || typeof assertSourceWritable !== "function") throw storageError("source-lock-required", "Backup requires the active source session gate.");
  return withSourceLock(async () => {
    const base = await sourceAdapter.readJson(sourceManifestFileId, { kind: "manifest" });
    if (base.catalogFinalizationPending !== null) throw storageError("recovery-required", "Complete catalog recovery before backup.");
    if (typeof withTargetLock !== "function" || typeof assertTargetWritable !== "function") {
      throw storageError("target-lock-required", "A verified destination session gate is required.");
    }
    reportProgress(onProgress, "source-verification");
    const verified = await verifyCatalogHistory(sourceAdapter, base, globalThis.crypto, { retainDataObjects: false });
    const readObject = (key, entry) => readVerified(sourceAdapter, entry);
    await validateRetainedStructure({ manifest: base, ...verified, readObject, validateStructure });
    const exportedAt = new Date().toISOString();
    const originalStore = new SyntheticOriginalRetentionStore({ adapter: sourceAdapter,
      withWrite: work => work(), assertWritable: assertSourceWritable, now: () => exportedAt });
    const pinnedOriginalIndex = canonicalizeJcs(await originalStore.read());
    const validatedOriginals = async function* () {
      const seen = new Set();
      for await (const item of iterateArchivedOriginalImports(sourceAdapter, exportedAt, { expectedIndex: pinnedOriginalIndex })) {
        if (seen.has(item.importId)) throw storageError("invalid-original-archive", "Archived imports must have unique identities.");
        seen.add(item.importId);
        await validateArchivedOriginalImports([item], exportedAt);
        yield item;
      }
    };
    // Match portable validation before writing the destination, including
    // unfinished original-retention intents. Keep at most one original body.
    for await (const item of validatedOriginals()) { /* validate and discard */ }
    const originalImports = validatedOriginals();
    const recheckSource = async () => {
      reportProgress(onProgress, "source-recheck");
      await assertSourceWritable();
      if (canonicalizeJcs(await originalStore.read()) !== pinnedOriginalIndex) {
        throw storageError("source-originals-changed", "The source original-import index changed during backup.");
      }
      if (canonicalizeJcs(await sourceAdapter.readJson(sourceManifestFileId, { kind: "manifest" })) !== canonicalizeJcs(base)) {
        throw storageError("source-changed", "The source changed during backup.");
      }
    };
    // The source must still be exact before any destination mutation, and once
    // more before the destination becomes selectable. Reads are re-hashed per
    // object while copying, so discarded bytes cannot become trusted evidence.
    await recheckSource();
    return withTargetLock(() => restoreVerifiedCatalog({ verified: { ...verified, manifest: base, readObject },
      originalImports, targetAdapter, newCopyId: globalThis.crypto.randomUUID(), role: "backup",
      assertTargetWritable, beforePublish: recheckSource, onProgress }));
  });
}
