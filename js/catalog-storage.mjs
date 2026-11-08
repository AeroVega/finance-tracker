import { canonicalizeJcs, verifyJournal } from "./transaction-protocol.mjs";
import { createLocatorCatalog, validateLocatorCatalog, resolveLocator, resolveSnapshotLocators } from "./drive-locator-catalog.mjs";

export function storageError(code, message) { return Object.assign(new Error(message), { code }); }
export const encode = (value) => new TextEncoder().encode(typeof value === "string" ? value : canonicalizeJcs(value));
export async function hashRaw(bytes, cryptoImpl = globalThis.crypto) {
  const hash = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export const physicalKind = (kind) => kind === "data-object" ? "snapshot-object" : kind;

/** Exact-ID read-back is the only way to resolve an ambiguous create response. */
export async function writeVerified(adapter, { content, kind, transactionId, name, fileId }, guard, cryptoImpl = globalThis.crypto) {
  const bytes = typeof content === "string" ? encode(content) : content instanceof Uint8Array ? content : encode(content);
  const sha256 = await hashRaw(bytes, cryptoImpl);
  fileId ||= await adapter.allocateFileId();
  await guard();
  let createError;
  let created;
  try { created = await adapter.createImmutable({ fileId, content: bytes, kind, transactionId, name, expectedSha256: sha256 }); }
  catch (error) { createError = error; }
  // The optional receipt contains exact-ID metadata and media read back by the
  // adapter, never the upload payload or POST response. Recheck every binding
  // and the raw bytes here. A hash-only success result is not a receipt.
  if (!createError && created?.readback?.metadata && created.readback.bytes instanceof Uint8Array) {
    await verifyReadback(adapter, { fileId, sha256, kind, transactionId }, created.readback, cryptoImpl);
    return { fileId, sha256 };
  }
  try { await readVerified(adapter, { fileId, sha256, kind, transactionId }, cryptoImpl); }
  catch (error) { throw createError || error; }
  return { fileId, sha256 };
}

function verifyMetadata(adapter, { fileId, sha256, kind, transactionId }, metadata) {
  if (metadata?.id !== fileId || metadata.trashed === true || !Array.isArray(metadata.parents) || !metadata.parents.includes(adapter.folderId) ||
      metadata.appProperties?.financeTrackerHash !== sha256 ||
      (kind && metadata.appProperties?.financeTrackerKind !== physicalKind(kind)) ||
      (transactionId && metadata.appProperties?.financeTrackerTransaction !== transactionId)) {
    throw storageError("immutable-metadata-mismatch", "An immutable object has an unexpected folder, kind, identity, or hash binding.");
  }
}

async function verifyReadback(adapter, reference, { metadata, bytes }, cryptoImpl) {
  verifyMetadata(adapter, reference, metadata);
  if (await hashRaw(bytes, cryptoImpl) !== reference.sha256) throw storageError("immutable-hash-mismatch", "An immutable object failed exact-byte verification.");
  return bytes;
}

export async function readVerified(adapter, reference, cryptoImpl = globalThis.crypto) {
  const { fileId } = reference;
  const metadata = await adapter.readMetadata(fileId);
  verifyMetadata(adapter, reference, metadata);
  const bytes = await adapter.readBytes(fileId);
  return verifyReadback(adapter, reference, { metadata, bytes }, cryptoImpl);
}

/** Bound independent reads, preserve input order, and drain reads before failing. */
export async function mapImmutableReads(items, read) {
  const results = new Array(items.length);
  let next = 0;
  let failure;
  let failureIndex = Infinity;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await read(items[index], index); }
      catch (error) {
        if (index < failureIndex) { failure = error; failureIndex = index; }
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  if (failed) throw failure;
  return results;
}

export function requireCatalogManifest(manifest, adapter) {
  if (manifest?.format !== "finance-tracker-manifest" || manifest.manifestVersion !== "2.0.0" ||
      manifest.syntheticOnly !== true || manifest.lifecycleStatus !== "active" ||
      !["primary", "backup"].includes(manifest.role) || !manifest.databaseId || !manifest.copyId ||
      manifest.schemaVersion !== 1 || !manifest.snapshot || typeof manifest.snapshot !== "object" || Array.isArray(manifest.snapshot) ||
      !Number.isSafeInteger(manifest.revision) || manifest.revision < 0 || !manifest.commitId ||
      !Object.hasOwn(manifest, "parentCommitId") ||
      manifest.storageBinding?.provider !== "google-drive" || manifest.storageBinding.folderId !== adapter.folderId ||
      !manifest.locatorCatalog?.fileId || !/^[0-9a-f]{64}$/.test(manifest.locatorCatalog?.sha256 || "") ||
      !/^[0-9a-f]{64}$/.test(manifest.commitRecordHash || "") ||
      !(manifest.catalogFinalizationPending === null || typeof manifest.catalogFinalizationPending === "string")) {
    throw storageError("catalog-manifest-required", "A verified version-2 synthetic copy is required. Legacy copies need explicit conversion into a fresh folder.");
  }
}

export async function readCatalog(adapter, manifest, cryptoImpl = globalThis.crypto) {
  requireCatalogManifest(manifest, adapter);
  if (manifest.copyPreparationFileId) {
    const metadata = await adapter.readMetadata(manifest.copyPreparationFileId);
    const preparation = await adapter.readJson(manifest.copyPreparationFileId);
    if (metadata.id !== manifest.copyPreparationFileId || !metadata.parents?.includes(adapter.folderId) || metadata.trashed === true ||
        metadata.appProperties?.financeTrackerKind !== "copy-preparation" ||
        preparation.format !== "finance-tracker-copy-preparation" || preparation.version !== 1 ||
        preparation.copyId !== manifest.copyId || preparation.databaseId !== manifest.databaseId || preparation.state !== "ready") {
      throw storageError("copy-quarantined", "This destination has not completed verified copy preparation.");
    }
  }
  const bytes = await readVerified(adapter, { ...manifest.locatorCatalog, kind: "locator-catalog" }, cryptoImpl);
  const catalog = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  validateLocatorCatalog(catalog, { databaseId: manifest.databaseId, copyId: manifest.copyId });
  return catalog;
}

export async function writeCatalog(adapter, { manifest, previousCatalog = null, additions }, guard, cryptoImpl = globalThis.crypto) {
  const catalog = createLocatorCatalog({ databaseId: manifest.databaseId, copyId: manifest.copyId,
    previousCatalog, previousCatalogHash: previousCatalog ? manifest.locatorCatalog.sha256 : null, additions });
  const pointer = await writeVerified(adapter, { content: catalog, kind: "locator-catalog",
    transactionId: manifest.catalogFinalizationPending || "synthetic-catalog-maintenance", name: "ft-locator-catalog.json" }, guard, cryptoImpl);
  return { catalog, pointer };
}

export function validateLogicalCommit(record, databaseId) {
  if (record?.format !== "finance-tracker-commit" || record.version !== 2 || record.databaseId !== databaseId ||
      typeof record.commitId !== "string" || !record.commitId || Object.hasOwn(record, "copyId") ||
      !Number.isSafeInteger(record.revision) || record.revision < 0 ||
      !(record.parentCommitId === null || typeof record.parentCommitId === "string") ||
      !record.snapshot || typeof record.snapshot !== "object" || Array.isArray(record.snapshot)) {
    throw storageError("invalid-logical-commit", "A version-2 commit must contain logical history without a physical copy identity.");
  }
  for (const [path, hash] of Object.entries(record.snapshot)) {
    if (!path.trim() || ["__proto__", "prototype", "constructor"].includes(path) || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      throw storageError("invalid-logical-snapshot", "Commit snapshots must map logical paths directly to lowercase SHA-256 strings.");
    }
  }
}

/** Verify every retained object and the entire selected commit ancestry. */
export async function verifyCatalogHistory(adapter, manifest, cryptoImpl = globalThis.crypto) {
  const catalog = await readCatalog(adapter, manifest, cryptoImpl);
  const objects = new Map();
  const journals = new Map();
  const entries = Object.entries(catalog.entries);
  const readMetadataBatch = async () => {
    const result = await adapter.readMetadataBatch(entries.map(([, entry]) => entry.fileId));
    if (!(result instanceof Map) || result.size !== entries.length) {
      throw storageError("invalid-metadata-batch", "Batch metadata must cover exactly the retained file IDs.");
    }
    // A fresh complete listing may replace per-file metadata GETs, but never
    // byte verification. Validate all bindings before admitting any body reads.
    for (const [, entry] of entries) {
      const file = result.get(entry.fileId);
      verifyMetadata(adapter, entry, file);
      if (typeof file.version !== "string" || !/^[0-9]+$/.test(file.version)) {
        throw storageError("invalid-metadata-batch", "Batch metadata must provide a valid version for every retained file.");
      }
    }
    return result;
  };
  const metadata = typeof adapter.readMetadataBatch === "function" ? await readMetadataBatch() : null;
  const verifiedBytes = await mapImmutableReads(entries, async ([, entry]) => {
    if (!metadata) return readVerified(adapter, entry, cryptoImpl);
    const bytes = await adapter.readBytes(entry.fileId);
    return verifyReadback(adapter, entry, { metadata: metadata.get(entry.fileId), bytes }, cryptoImpl);
  });
  if (metadata) {
    // Bracket media reads with a second fresh complete enumeration. Membership,
    // tags and Drive versions must still agree. This is not an atomic snapshot.
    const after = await readMetadataBatch();
    for (const [, entry] of entries) {
      if (metadata.get(entry.fileId).version !== after.get(entry.fileId).version) {
        throw storageError("immutable-version-mismatch", "A retained file changed while its bytes were being verified.");
      }
    }
  }
  for (const [index, [key, entry]] of entries.entries()) {
    objects.set(key, verifiedBytes[index]);
    if (entry.kind === "journal-event") {
      const event = JSON.parse(new TextDecoder().decode(objects.get(key)));
      if (event.eventId !== entry.identity || event.transactionId !== entry.transactionId || event.sequence !== entry.sequence) {
        throw storageError("journal-identity-mismatch", "An indexed journal does not match its typed identity.");
      }
      if (!journals.has(event.transactionId)) journals.set(event.transactionId, []);
      journals.get(event.transactionId).push(event);
    }
  }
  for (const [transactionId, events] of journals) {
    events.sort((a, b) => a.sequence - b.sequence);
    const state = await verifyJournal(events, { cryptoImpl });
    if (events[0].payload.databaseId !== manifest.databaseId || !events[0].payload.copyId) {
      throw storageError("journal-identity-mismatch", "Retained journal history belongs to another database or has no physical origin.");
    }
    if (!["committed", "aborted"].includes(state.status) && manifest.catalogFinalizationPending !== transactionId) {
      throw storageError("unfinished-history", "The selected catalog contains an unfinished journal without a pending recovery marker.");
    }
    if (state.status === "committed") {
      const entry = resolveLocator(catalog, { kind: "commit-record", identity: state.commit.commitId });
      const record = JSON.parse(new TextDecoder().decode(objects.get("commit-record:" + state.commit.commitId)));
      const base = events[0].payload;
      if (entry.sha256 !== state.commit.recordHash || record.transactionId !== transactionId ||
          record.parentCommitId !== base.baseCommitId || record.revision !== base.baseRevision + 1) {
        throw storageError("journal-commit-mismatch", "Terminal journal evidence does not match its retained logical commit.");
      }
    }
  }
  let commitId = manifest.commitId;
  let revision = manifest.revision;
  let currentRecord;
  const seen = new Set();
  while (commitId !== null) {
    if (seen.has(commitId)) throw storageError("commit-history-cycle", "The retained commit history contains a cycle.");
    seen.add(commitId);
    const entry = resolveLocator(catalog, { kind: "commit-record", identity: commitId });
    const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(objects.get("commit-record:" + commitId)));
    validateLogicalCommit(record, manifest.databaseId);
    if (record.commitId !== commitId || record.revision !== revision) throw storageError("commit-history-mismatch", "A retained commit has invalid ancestry.");
    resolveSnapshotLocators(record.snapshot, catalog);
    if (!currentRecord) {
      currentRecord = record;
      if (entry.sha256 !== manifest.commitRecordHash || record.parentCommitId !== manifest.parentCommitId ||
          canonicalizeJcs(record.snapshot) !== canonicalizeJcs(manifest.snapshot)) {
        throw storageError("manifest-commit-mismatch", "The manifest does not match its immutable logical commit.");
      }
    }
    commitId = record.parentCommitId;
    revision -= 1;
  }
  if (revision !== -1) throw storageError("missing-history", "The retained history does not reach a verified genesis commit.");
  for (const entry of Object.values(catalog.entries).filter((entry) => entry.kind === "commit-record")) {
    if (!seen.has(entry.identity)) throw storageError("disconnected-history", "A catalog commit is not part of the selected retained ancestry.");
  }
  return { catalog, record: currentRecord, objects };
}

/** Fresh-folder bootstrap only; callers hold the verified session gate. */
export async function initializeCatalogCopy({ adapter, guard, databaseId = globalThis.crypto.randomUUID(),
  copyId = globalThis.crypto.randomUUID(), cryptoImpl = globalThis.crypto, manifestName = "ft-synthetic-dashboard-manifest.json" }) {
  const files = await adapter.listChildren();
  if (files.some((file) => !(file.name === "finance-tracker-active-session.json" &&
      file.appProperties?.financeTrackerSession === "v1"))) {
    throw storageError("fresh-destination-required", "Initialize only an empty synthetic folder; preserve existing copies for explicit conversion.");
  }
  const record = { format: "finance-tracker-commit", version: 2, databaseId,
    commitId: cryptoImpl.randomUUID(), parentCommitId: null, revision: 0,
    operationType: "synthetic-genesis", snapshot: {} };
  const commit = await writeVerified(adapter, { content: record, kind: "commit-record", transactionId: "synthetic-genesis", name: "ft-genesis.json" }, guard, cryptoImpl);
  const manifest = { format: "finance-tracker-manifest", manifestVersion: "2.0.0", schemaVersion: 1,
    syntheticOnly: true, databaseId, copyId, role: "primary", lifecycleStatus: "active",
    revision: 0, commitId: record.commitId, parentCommitId: null, commitRecordHash: commit.sha256,
    storageBinding: { provider: "google-drive", folderId: adapter.folderId }, snapshot: {}, catalogFinalizationPending: null };
  const { pointer } = await writeCatalog(adapter, { manifest, additions: [{ kind: "commit-record", identity: record.commitId, ...commit }] }, guard, cryptoImpl);
  manifest.locatorCatalog = pointer;
  const result = await writeVerified(adapter, { content: manifest, kind: "dashboard-synthetic-manifest",
    transactionId: "dashboard-synthetic-bootstrap", name: manifestName }, guard, cryptoImpl);
  await verifyCatalogHistory(adapter, manifest, cryptoImpl);
  return { manifestFileId: result.fileId, manifest };
}
