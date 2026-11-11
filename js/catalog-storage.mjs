import { canonicalizeJcs, verifyJournal } from "./transaction-protocol.mjs";
import { copyOwnedBytes } from "./byte-ownership.mjs";
import { createLocatorCatalog, validateLocatorCatalog, createCatalogResolver, LOCATOR_CATALOG_FORMAT } from "./drive-locator-catalog.mjs";

import { validateCatalogRoot, validateCatalogSegment, SEGMENTED_CATALOG_VERSION,
  CATALOG_SEGMENT_ENTRIES, CATALOG_SEGMENT_BYTES, CATALOG_ROOT_BYTES } from "./catalog-segments.mjs";

// Private provenance binds a materialized lookup map to its verified stored root.
// A cloned or modified map cannot silently claim a different immutable prefix.
const catalogOrigins = new WeakMap();

export function storageError(code, message) { return Object.assign(new Error(message), { code }); }
export const encode = (value) => new TextEncoder().encode(typeof value === "string" ? value : canonicalizeJcs(value));
export async function hashRaw(bytes, cryptoImpl = globalThis.crypto) {
  const hash = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export const physicalKind = (kind) => kind === "data-object" ? "snapshot-object" : kind;

/** Exact-ID read-back is the only way to resolve an ambiguous create response. */
export async function writeVerified(adapter, { content, kind, transactionId, name, fileId }, guard, cryptoImpl = globalThis.crypto) {
  const bytes = content instanceof Uint8Array ? copyOwnedBytes(content) : encode(content);
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
  bytes = copyOwnedBytes(bytes);
  if (await hashRaw(bytes, cryptoImpl) !== reference.sha256) throw storageError("immutable-hash-mismatch", "An immutable object failed exact-byte verification.");
  return bytes;
}

export async function readVerified(adapter, reference, cryptoImpl = globalThis.crypto) {
  const { fileId } = reference;
  const metadata = await adapter.readMetadata(fileId);
  verifyMetadata(adapter, reference, metadata);
  const bytes = await adapter.readBytes(fileId, { kind: reference.kind });
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
  return loadCatalog(adapter, manifest, cryptoImpl);
}

// Only the private session verifier can supply reuse evidence. Public reads,
// exports and explicit reconnect begin with exact remote bytes.
async function loadCatalog(adapter, manifest, cryptoImpl, cache = null) {
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
  const reused = new Map();
  const candidates = new Map();
  const batchBindings = async bindings => {
    const metadata = await adapter.readMetadataBatch([...bindings.keys()]);
    if (!(metadata instanceof Map) || metadata.size !== bindings.size) throw storageError("invalid-metadata-batch", "Catalog metadata must cover exactly the requested file IDs.");
    for (const [fileId, value] of bindings) {
      const reference = value.reference;
      const file = metadata.get(fileId);
      verifyMetadata(adapter, reference, file);
      if (typeof file?.version !== "string" || !/^[0-9]+$/.test(file.version)) throw storageError("invalid-metadata-batch", "Catalog metadata requires fresh file versions.");
    }
    return structuredClone(metadata);
  };
  const previous = cache?.previousCatalog;
  const before = previous?.size && typeof adapter.readMetadataBatch === "function" ? await batchBindings(previous) : null;
  const readPart = async reference => {
    if (!cache || typeof adapter.readMetadataBatch !== "function") return readVerified(adapter, reference, cryptoImpl);
    const prior = previous?.get(reference.fileId);
    const file = before?.get(reference.fileId) || await adapter.readMetadata(reference.fileId);
    verifyMetadata(adapter, reference, file);
    if (typeof file?.version !== "string" || !/^[0-9]+$/.test(file.version)) throw storageError("invalid-metadata-batch", "Catalog metadata requires fresh file versions.");
    const canReuse = prior && canonicalizeJcs(prior.reference) === canonicalizeJcs(reference) && prior.version === file.version;
    const source = canReuse ? prior.bytes : await adapter.readBytes(reference.fileId, { kind: reference.kind });
    const bytes = await verifyReadback(adapter, reference, { metadata: file, bytes: source }, cryptoImpl);
    const evidence = { reference: { ...reference }, version: file.version };
    // Every reused byte requires the closing bracket, even when the next cache
    // budget cannot retain it. New cache candidates need that bracket too.
    if (canReuse) reused.set(reference.fileId, evidence);
    if (cache.nextCatalog.size < cache.maxEntries && cache.bytes + bytes.byteLength <= cache.maxBytes) {
      candidates.set(reference.fileId, evidence);
      cache.nextCatalog.set(reference.fileId, { ...evidence, bytes: copyOwnedBytes(bytes) });
      cache.bytes += bytes.byteLength;
    }
    return bytes;
  };
  const pointer = manifest.locatorCatalog;
  const bytes = await readVerified(adapter, { ...pointer, kind: "locator-catalog" }, cryptoImpl);
  const root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  let catalog;
  if (root.version === 1) {
    catalog = validateLocatorCatalog(root, manifest);
  } else {
    if (bytes.byteLength > CATALOG_ROOT_BYTES) throw storageError("catalog-root-limit", "A catalog root exceeds its per-object byte limit.");
    validateCatalogRoot(root, manifest);
    const entries = Object.create(null);
    const structuralIds = new Set([pointer.fileId]);
    const physicalIds = new Set();
    const append = source => {
      for (const [key, entry] of Object.entries(source)) {
        if (Object.hasOwn(entries, key)) throw storageError("duplicate-catalog-binding", "A catalog chain repeats an immutable identity.");
        if (physicalIds.has(entry.fileId)) throw storageError("duplicate-physical-locator", "A catalog chain reuses a physical file ID.");
        physicalIds.add(entry.fileId);
        entries[key] = entry;
      }
    };
    let segmentPointer = root.segmentTip;
    let sequence = root.segmentCount - 1;
    let generation = root.generation;
    // Iterate rather than recurse: retained history has no total segment limit.
    while (segmentPointer !== null) {
      if (structuralIds.has(segmentPointer.fileId)) throw storageError("catalog-segment-cycle", "A catalog chain repeats a physical segment ID.");
      structuralIds.add(segmentPointer.fileId);
      const segmentBytes = await readPart({ ...segmentPointer, kind: "locator-catalog-segment" });
      if (segmentBytes.byteLength > CATALOG_SEGMENT_BYTES) throw storageError("catalog-segment-limit", "A catalog segment exceeds its per-object byte limit.");
      const segment = validateCatalogSegment(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(segmentBytes)), manifest);
      if (segment.sequence !== sequence || segment.generation > generation || segment.generation < generation - 1 ||
          (sequence === root.segmentCount - 1 && segment.generation !== root.generation)) {
        throw storageError("catalog-segment-chain-mismatch", "Catalog segment order or generation does not match its root.");
      }
      append(segment.entries);
      generation = segment.generation;
      sequence--;
      segmentPointer = segment.previousSegment;
    }
    if (sequence !== -1) throw storageError("catalog-segment-chain-mismatch", "The catalog chain has missing segments.");
    let firstGeneration = 0;
    if (root.legacyCatalog) {
      if (structuralIds.has(root.legacyCatalog.fileId)) throw storageError("catalog-segment-cycle", "A legacy base cannot reuse a segment ID.");
      structuralIds.add(root.legacyCatalog.fileId);
      const legacyBytes = await readPart({ ...root.legacyCatalog, kind: "locator-catalog" });
      const legacy = validateLocatorCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(legacyBytes)), manifest);
      firstGeneration = legacy.generation + 1;
      append(legacy.entries);
    }
    if (generation !== firstGeneration || Object.keys(entries).length !== root.entryCount) {
      throw storageError("catalog-segment-chain-mismatch", "Catalog generations or retained entry counts do not match.");
    }
    for (const id of structuralIds) if (physicalIds.has(id)) throw storageError("duplicate-physical-locator", "Catalog metadata cannot also identify a retained protocol object.");
    catalog = validateLocatorCatalog({ format: LOCATOR_CATALOG_FORMAT, version: 1, databaseId: root.databaseId,
      copyId: root.copyId, generation: root.generation, parentCatalogHash: root.parentCatalogHash, entries }, manifest);
  }
  const checked = new Map([...reused, ...candidates]);
  if (checked.size) {
    const after = await batchBindings(checked);
    for (const [fileId, value] of checked) if (after.get(fileId).version !== value.version) {
      throw storageError("immutable-version-mismatch", "A catalog segment changed during verification.");
    }
  }
  catalogOrigins.set(catalog, { adapter, pointer: { ...pointer }, root: structuredClone(root.version === 1 ? null : root),
    fingerprint: await hashRaw(encode(catalog), cryptoImpl) });
  return catalog;
}

export async function writeCatalog(adapter, { manifest, previousCatalog = null, additions }, guard, cryptoImpl = globalThis.crypto) {
  if (manifest.syntheticOnly !== true) throw storageError("synthetic-catalog-required", "Segmented catalog writes are restricted to synthetic copies.");
  const catalog = createLocatorCatalog({ databaseId: manifest.databaseId, copyId: manifest.copyId,
    previousCatalog, previousCatalogHash: previousCatalog ? manifest.locatorCatalog.sha256 : null, additions });
  let origin = null;
  if (previousCatalog) {
    origin = catalogOrigins.get(previousCatalog);
    const fingerprint = await hashRaw(encode(previousCatalog), cryptoImpl);
    if (origin) {
      if (origin.adapter !== adapter || canonicalizeJcs(origin.pointer) !== canonicalizeJcs(manifest.locatorCatalog) || origin.fingerprint !== fingerprint) {
        throw storageError("catalog-base-mismatch", "The materialized catalog no longer matches its verified base pointer.");
      }
    } else {
      // Compatibility for callers constructing a legacy v1 base themselves.
      if (fingerprint !== manifest.locatorCatalog.sha256) throw storageError("catalog-base-mismatch", "An unverified catalog cannot extend the selected immutable base.");
      origin = { pointer: { ...manifest.locatorCatalog }, root: null };
    }
  }
  const missing = Object.entries(catalog.entries).filter(([key]) => !previousCatalog || !Object.hasOwn(previousCatalog.entries, key));
  if (previousCatalog && !missing.length) return { catalog: previousCatalog, pointer: { ...origin.pointer } };
  const root = { format: LOCATOR_CATALOG_FORMAT, version: SEGMENTED_CATALOG_VERSION,
    databaseId: catalog.databaseId, copyId: catalog.copyId, generation: catalog.generation,
    parentCatalogHash: catalog.parentCatalogHash, entryCount: Object.keys(catalog.entries).length,
    segmentCount: origin?.root?.segmentCount || 0, segmentTip: origin?.root?.segmentTip || null,
    legacyCatalog: origin ? origin.root?.legacyCatalog || (origin.root ? null : origin.pointer) : null };
  const transactionId = manifest.catalogFinalizationPending || "synthetic-catalog-maintenance";
  let offset = 0;
  while (offset < missing.length) {
    const segment = { format: "finance-tracker-locator-segment", version: 1, databaseId: catalog.databaseId,
      copyId: catalog.copyId, generation: catalog.generation, sequence: root.segmentCount,
      previousSegment: root.segmentTip, entries: Object.create(null) };
    let count = 0;
    while (offset < missing.length && count < CATALOG_SEGMENT_ENTRIES) {
      const [key, entry] = missing[offset];
      segment.entries[key] = entry;
      if (encode(segment).byteLength > CATALOG_SEGMENT_BYTES) {
        delete segment.entries[key];
        if (!count) throw storageError("catalog-segment-limit", "One locator cannot fit within a catalog segment's byte limit.");
        break;
      }
      offset++; count++;
    }
    validateCatalogSegment(segment, manifest);
    root.segmentTip = await writeVerified(adapter, { content: segment, kind: "locator-catalog-segment",
      transactionId, name: "ft-locator-segment.json" }, guard, cryptoImpl);
    root.segmentCount++;
  }
  validateCatalogRoot(root, manifest);
  if (encode(root).byteLength > CATALOG_ROOT_BYTES) throw storageError("catalog-root-limit", "A catalog root exceeds its per-object byte limit.");
  const pointer = await writeVerified(adapter, { content: root, kind: "locator-catalog",
    transactionId, name: "ft-locator-catalog.json" }, guard, cryptoImpl);
  catalogOrigins.set(catalog, { adapter, pointer: { ...pointer }, root: structuredClone(root),
    fingerprint: await hashRaw(encode(catalog), cryptoImpl) });
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
export async function verifyCatalogHistory(adapter, manifest, cryptoImpl = globalThis.crypto, { retainDataObjects = true } = {}) {
  return verifyHistory(adapter, manifest, cryptoImpl, null, { retainDataObjects });
}

/**
 * Session-local evidence, populated only by successful complete verification.
 * A fresh Drive version and all bindings bracket every reuse. No upload payload,
 * caller-provided bytes, persisted evidence, or prior manifest is trusted.
 */
export function createCatalogHistoryVerifier({ maxBytes = 16 * 1024 * 1024, maxEntries = 20000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) {
    throw storageError("invalid-history-cache-limit", "History evidence limits must be nonnegative safe integers.");
  }
  let evidence = null;
  let generation = 0;
  const clear = () => { generation++; evidence = null; };
  return Object.freeze({ clear, async verify(adapter, manifest, cryptoImpl = globalThis.crypto) {
    try {
      requireCatalogManifest(manifest, adapter);
      const scope = canonicalizeJcs([adapter.folderId, manifest.databaseId, manifest.copyId]);
      if (evidence && (evidence.adapter !== adapter || evidence.crypto !== cryptoImpl || evidence.scope !== scope ||
          manifest.revision < evidence.revision)) clear();
      const epoch = generation;
      const cache = { previous: evidence?.entries, previousCatalog: evidence?.catalogParts, next: new Map(), nextCatalog: new Map(), bytes: 0, maxBytes, maxEntries };
      const verified = await verifyHistory(adapter, manifest, cryptoImpl, cache);
      // An offline/release/error transition during a read must not repopulate it.
      if (generation === epoch) evidence = { adapter, crypto: cryptoImpl, scope,
        revision: manifest.revision, entries: cache.next, catalogParts: cache.nextCatalog };
      return verified;
    } catch (error) { clear(); throw error; }
  } });
}

async function verifyHistory(adapter, manifest, cryptoImpl, cache = null, { retainDataObjects = true } = {}) {
  const catalog = await loadCatalog(adapter, manifest, cryptoImpl, cache);
  const resolver = createCatalogResolver(catalog);
  const objects = new Map();
  const journals = new Map();
  const entries = Object.entries(catalog.entries);
  const readMetadataBatch = async () => {
    const result = await adapter.readMetadataBatch(entries.map(([, entry]) => entry.fileId));
    if (!(result instanceof Map) || result.size !== entries.length) {
      throw storageError("invalid-metadata-batch", "Batch metadata must cover exactly the retained file IDs.");
    }
    // A fresh complete listing may replace per-file metadata GETs. Validate
    // every binding before admitting downloads or previously verified bytes.
    for (const [, entry] of entries) {
      const file = result.get(entry.fileId);
      verifyMetadata(adapter, entry, file);
      if (typeof file.version !== "string" || !/^[0-9]+$/.test(file.version)) {
        throw storageError("invalid-metadata-batch", "Batch metadata must provide a valid version for every retained file.");
      }
    }
    return structuredClone(result);
  };
  const metadata = typeof adapter.readMetadataBatch === "function" ? await readMetadataBatch() : null;
  const verifiedBytes = await mapImmutableReads(entries, async ([key, entry]) => {
    if (!metadata) {
      const bytes = await readVerified(adapter, entry, cryptoImpl);
      return !retainDataObjects && entry.kind === "data-object" ? null : bytes;
    }
    const prior = cache?.previous?.get(key);
    const reusable = prior && prior.binding === canonicalizeJcs(entry) &&
      prior.version === metadata.get(entry.fileId).version;
    // Detach returned bytes from private evidence, and hash them on every use.
    const source = reusable ? prior.bytes : await adapter.readBytes(entry.fileId, { kind: entry.kind });
    const bytes = await verifyReadback(adapter, entry, { metadata: metadata.get(entry.fileId), bytes: source }, cryptoImpl);
    return !retainDataObjects && entry.kind === "data-object" ? null : bytes;
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
    if (verifiedBytes[index] !== null) objects.set(key, verifiedBytes[index]);
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
      const entry = resolver.resolve({ kind: "commit-record", identity: state.commit.commitId });
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
    const entry = resolver.resolve({ kind: "commit-record", identity: commitId });
    const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(objects.get("commit-record:" + commitId)));
    validateLogicalCommit(record, manifest.databaseId);
    if (record.commitId !== commitId || record.revision !== revision) throw storageError("commit-history-mismatch", "A retained commit has invalid ancestry.");
    resolver.resolveSnapshot(record.snapshot);
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
  if (cache && metadata && retainDataObjects) {
    // Keep only this fully verified catalog, bounded in both bytes and entries.
    // Uncached objects are always downloaded again; hitting a limit is safe.
    for (const [key, entry] of entries) {
      const bytes = objects.get(key);
      if (cache.next.size + cache.nextCatalog.size >= cache.maxEntries || cache.bytes + bytes.byteLength > cache.maxBytes) continue;
      cache.next.set(key, { binding: canonicalizeJcs(entry), version: metadata.get(entry.fileId).version, bytes: copyOwnedBytes(bytes) });
      cache.bytes += bytes.byteLength;
    }
  }
  return { catalog, record: currentRecord, objects,
    versions: metadata ? new Map(entries.map(([, entry]) => [entry.fileId, metadata.get(entry.fileId).version])) : null };
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
