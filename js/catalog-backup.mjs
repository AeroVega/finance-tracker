import { canonicalizeJcs, verifyJournal } from "./transaction-protocol.mjs";
import { createLocatorCatalog, locatorKey, resolveSnapshotLocators } from "./drive-locator-catalog.mjs";
import { encode, hashRaw, writeVerified, verifyCatalogHistory, validateLogicalCommit, storageError } from "./catalog-storage.mjs";
import { archiveOriginalImports, restoreOriginalImports, validateArchivedOriginalImports } from "./drive-original-retention.mjs";

function base64(bytes) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}
function decodeBase64(text) {
  if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw storageError("invalid-base64", "Archive object bytes are malformed.");
  return Uint8Array.from(atob(text), (part) => part.charCodeAt(0));
}

export async function validateRetainedStructure({ manifest, catalog, objects, validateStructure }) {
  if (typeof validateStructure !== "function") throw storageError("structural-validator-required", "An application structural validator is required.");
  const journals = new Map();
  for (const [key, entry] of Object.entries(catalog.entries)) {
    if (entry.kind === "commit-record") {
      const record = JSON.parse(new TextDecoder().decode(objects.get(key)));
      validateLogicalCommit(record, manifest.databaseId);
      if (record.commitId !== entry.identity) throw storageError("commit-identity-mismatch", "A commit locator has the wrong logical identity.");
      const resolved = resolveSnapshotLocators(record.snapshot, catalog);
      const snapshotObjects = Object.fromEntries(Object.keys(resolved).map((path) => [path, objects.get("data-object:" + record.snapshot[path])]));
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
}

/** Version 2 carries exact retained history; version-1 archives remain legacy-only. */
export async function exportCatalogArchive({ adapter, manifestFileId, withSourceLock, validateStructure, now = new Date().toISOString() }) {
  if (typeof withSourceLock !== "function") throw storageError("source-lock-required", "Export requires the source session gate.");
  return withSourceLock(async () => {
    const manifest = await adapter.readJson(manifestFileId);
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
    if (canonicalizeJcs(await adapter.readJson(manifestFileId)) !== canonicalizeJcs(manifest)) throw storageError("source-changed", "The source manifest changed during export.");
    return archive;
  });
}

export async function verifyCatalogArchive(archive, { validateStructure } = {}) {
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
  role = "primary", withTargetLock, assertTargetWritable, validateStructure, beforePublish = async () => {} }) {
  if (typeof withTargetLock !== "function" || typeof assertTargetWritable !== "function") throw storageError("target-lock-required", "A verified destination session gate is required.");
  const knownCopyIds = [archive?.sourceCopyId, archive?.manifest?.copyId, archive?.manifest?.restoredFromCopyId];
  if (typeof newCopyId !== "string" || !newCopyId.trim() || knownCopyIds.includes(newCopyId) || !["primary", "backup"].includes(role)) throw storageError("invalid-copy-identity", "A distinct destination copy identity and supported role are required.");
  return withTargetLock(async () => {
    const verified = await verifyCatalogArchive(archive, { validateStructure });
    for (const [key, bytes] of verified.objects) {
      if (key.startsWith("journal-event:") || key.startsWith("migration-record:")) {
        let evidence;
        try { evidence = JSON.parse(new TextDecoder().decode(bytes)); } catch { continue; }
        const origin = evidence.eventType === "transaction-started" ? evidence.payload?.copyId :
          ["finance-tracker-manifest", "finance-tracker-commit"].includes(evidence.format) ? evidence.copyId : null;
        if (origin === newCopyId) throw storageError("invalid-copy-identity", "The destination cannot reuse an archived source-copy identity.");
      }
    }
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
      const additions = [];
      for (const [key, entry] of Object.entries(verified.catalog.entries)) {
        const location = await writeVerified(targetAdapter, { content: verified.objects.get(key), kind: entry.kind === "data-object" ? "snapshot-object" : entry.kind,
          transactionId: entry.transactionId || transactionId, name: "ft-" + entry.kind + ".bin" }, assertTargetWritable);
        additions.push({ ...entry, ...location });
      }
      const catalog = createLocatorCatalog({ databaseId: verified.manifest.databaseId, copyId: newCopyId, additions });
      const pointer = await writeVerified(targetAdapter, { content: catalog, kind: "locator-catalog", transactionId,
        name: "ft-locator-catalog.json" }, assertTargetWritable);
      const manifest = { ...verified.manifest, copyId: newCopyId, role, lifecycleStatus: "active",
        storageBinding: { provider: "google-drive", folderId: targetAdapter.folderId }, locatorCatalog: pointer,
        restoredFromCopyId: archive.sourceCopyId, copyPreparationFileId: markerId };
      await restoreOriginalImports({ adapter: targetAdapter, imports: archive.originalImports, guard: assertTargetWritable });
      // Mark preparation ready before publication; without the final manifest
      // this folder still cannot be selected as a database copy.
      await assertTargetWritable();
      await targetAdapter.publishManifest(markerId, { ...preparation, state: "ready" }, { beforeMutation: assertTargetWritable });
      await verifyCatalogHistory(targetAdapter, manifest);
      await beforePublish();
      const result = await writeVerified(targetAdapter, { content: manifest, kind: "dashboard-synthetic-manifest", transactionId,
        name: "ft-synthetic-dashboard-manifest.json" }, assertTargetWritable);
      await verifyCatalogHistory(targetAdapter, await targetAdapter.readJson(result.fileId));
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
  });
}

export async function backupCatalogCopy({ sourceAdapter, sourceManifestFileId, withSourceLock, assertSourceWritable,
  targetAdapter, withTargetLock, assertTargetWritable, validateStructure }) {
  if (sourceAdapter.folderId === targetAdapter.folderId) throw storageError("same-backup-destination", "Backup requires a separate physical folder.");
  if (typeof withSourceLock !== "function" || typeof assertSourceWritable !== "function") throw storageError("source-lock-required", "Backup requires the active source session gate.");
  return withSourceLock(async () => {
    const base = await sourceAdapter.readJson(sourceManifestFileId);
    const archive = await exportCatalogArchive({ adapter: sourceAdapter, manifestFileId: sourceManifestFileId,
      withSourceLock: (operation) => operation(), validateStructure });
    return restoreCatalogArchive({ archive, targetAdapter, role: "backup", withTargetLock, assertTargetWritable,
      validateStructure, beforePublish: async () => {
        await assertSourceWritable();
        if (canonicalizeJcs(await sourceAdapter.readJson(sourceManifestFileId)) !== canonicalizeJcs(base)) throw storageError("source-changed", "The source changed during backup.");
      } });
  });
}
