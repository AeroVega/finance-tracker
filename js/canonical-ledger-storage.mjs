import { fragmentCanonicalObjects, reassembleCanonicalObjects, fragmentInventory, FRAGMENT_OBJECT_BYTES } from "./canonical-fragments.mjs";
import { canonicalizeJcs } from "./transaction-protocol.mjs";
import { validateLedger } from "./canonical-import.mjs";

// Financial records use the existing PR25 catalog and transaction protocol.
// This is a payload adapter, not another storage or recovery implementation.
export const CANONICAL_PREFIX = "synthetic/canonical-v1/";
export const CANONICAL_INDEX = CANONICAL_PREFIX + "index.json";
export const CANONICAL_COLLECTIONS = Object.freeze({
  accounts: "accountId", imports: "importRunId", observations: "observationId",
  activities: "activityId", events: "eventId", reviewDecisions: "reviewDecisionId"
});

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function safeId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    fail("invalid-record-id", "A record has an invalid opaque identity.");
  }
  return value;
}
function recordPath(collection, id) { return CANONICAL_PREFIX + collection + "/" + safeId(id) + ".json"; }

export function serializeCanonicalLedger(ledger) {
  const objects = new Map();
  objects.set(CANONICAL_INDEX, canonicalizeJcs(canonicalIndex(ledger, objects)));
  return objects;
}

function canonicalIndex(ledger, objects = null) {
  validateLedger(ledger);
  if (ledger.syntheticOnly !== true) fail("synthetic-data-required", "Only invented canonical records may use this adapter.");
  const metadata = { ...ledger };
  const collections = {};
  for (const [name, idField] of Object.entries(CANONICAL_COLLECTIONS)) {
    if (!Array.isArray(ledger[name])) fail("invalid-ledger", "A canonical collection is missing.");
    const seen = new Set();
    collections[name] = ledger[name].map((record) => {
      const id = safeId(record?.[idField]);
      if (seen.has(id)) fail("duplicate-record-id", "A canonical collection contains duplicate identities.");
      seen.add(id);
      if (objects) objects.set(recordPath(name, id), canonicalizeJcs(record));
      return id;
    });
    delete metadata[name];
  }
  return { format: "finance-tracker-canonical-index", version: 1, syntheticOnly: true, metadata, collections };
}

export const CANONICAL_CHUNK_RECORDS = 64;
export const CANONICAL_CHUNK_BYTES = 128 * 1024;
const chunkPath = (collection, ordinal) => CANONICAL_PREFIX + "chunks/" + collection + "/" + String(ordinal).padStart(6, "0") + ".json";

/** Opt-in layout for fresh synthetic copies. Fixed append-order boundaries
 * keep unchanged chunks reusable. Oversized chunks fail before any write.
 * The index stays at the legacy path with version 2, so old clients fail
 * closed instead of mistaking a packed ledger for an empty one.
 */
export function serializePackedCanonicalLedger(ledger) {
  return serializeGroupedCanonicalLedger(ledger, true);
}

export function serializeFragmentedCanonicalLedger(ledger, previousRoot = null) {
  return fragmentCanonicalObjects(serializeGroupedCanonicalLedger(ledger, false), previousRoot);
}

function serializeGroupedCanonicalLedger(ledger, bounded) {
  const index = canonicalIndex(ledger);
  index.version = 2;
  index.chunks = {};
  const objects = new Map();
  for (const name of Object.keys(CANONICAL_COLLECTIONS)) {
    index.chunks[name] = [];
    for (let offset = 0; offset < ledger[name].length; offset += CANONICAL_CHUNK_RECORDS) {
      const path = chunkPath(name, offset / CANONICAL_CHUNK_RECORDS);
      const text = canonicalizeJcs({format: "finance-tracker-canonical-chunk", version: 1,
        collection: name, records: ledger[name].slice(offset, offset + CANONICAL_CHUNK_RECORDS)});
      if (bounded && new TextEncoder().encode(text).byteLength > CANONICAL_CHUNK_BYTES) {
        fail("canonical-chunk-too-large", "This synthetic chunk exceeds the 128 KiB limit. No save was attempted.");
      }
      index.chunks[name].push(path);
      objects.set(path, text);
    }
  }
  objects.set(CANONICAL_INDEX, canonicalizeJcs(index));
  return objects;
}

function chunkRecords(index, name, ordinal, value, fragmented = false) {
  if (value?.format !== "finance-tracker-canonical-chunk" || value.version !== 1 || value.collection !== name ||
      Object.keys(value).sort().join(",") !== "collection,format,records,version" ||
      !Array.isArray(value.records) || (!fragmented && new TextEncoder().encode(canonicalizeJcs(value)).byteLength > CANONICAL_CHUNK_BYTES)) {
    fail("invalid-canonical-chunk", "A canonical chunk has an invalid format, collection or size.");
  }
  const ids = index.collections[name].slice(ordinal * CANONICAL_CHUNK_RECORDS, (ordinal + 1) * CANONICAL_CHUNK_RECORDS);
  if (value.records.length !== ids.length || value.records.some((record, i) => record?.[CANONICAL_COLLECTIONS[name]] !== ids[i])) {
    fail("canonical-identity-mismatch", "Chunk records do not match the exact indexed order and identities.");
  }
  return value.records;
}

function validateIndex(index) {
  if (!index || index.format !== "finance-tracker-canonical-index" || ![1, 2].includes(index.version) ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      !index.collections || typeof index.collections !== "object") {
    fail("invalid-canonical-index", "The canonical index is not a supported synthetic record set.");
  }
  const names = Object.keys(CANONICAL_COLLECTIONS);
  if (Object.keys(index.collections).length !== names.length || names.some((name) => !Array.isArray(index.collections[name]))) {
    fail("invalid-canonical-index", "The canonical index has an invalid collection inventory.");
  }
  if (index.version === 2 && (Object.keys(index).sort().join(",") !== "chunks,collections,format,metadata,syntheticOnly,version" ||
      !index.chunks || Object.keys(index.chunks).length !== names.length ||
      names.some(name => !Array.isArray(index.chunks[name])))) {
    fail("invalid-canonical-index", "Packed canonical collections require a complete chunk inventory.");
  }
  for (const name of names) {
    const ids = index.collections[name];
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length) fail("duplicate-record-id", "The canonical index repeats an identity.");
    if (index.version === 2 && (index.chunks[name].length !== Math.ceil(ids.length / CANONICAL_CHUNK_RECORDS) ||
        index.chunks[name].some((path, ordinal) => path !== chunkPath(name, ordinal)))) {
      fail("invalid-canonical-index", "Chunk paths must match their collection and fixed ordinal boundaries.");
    }
  }
}

/** Application validation callback for the existing backup/export/restore API. */
export function validateCanonicalSnapshot({ objects }) {
  return validateSnapshotObjects(objects, false);
}

function validateSnapshotObjects(objects, fragmented) {
  const paths = Object.keys(objects || {}).filter((path) => path.startsWith(CANONICAL_PREFIX));
  if (!paths.length) return true; // Genesis and retained pre-import snapshots.
  if (!Object.hasOwn(objects, CANONICAL_INDEX)) fail("canonical-index-missing", "Canonical history is missing its index.");
  const read = (path) => {
    if (!Object.hasOwn(objects, path)) fail("canonical-record-missing", "A retained snapshot is missing a canonical record.");
    if (!fragmented && path.startsWith(CANONICAL_PREFIX + "chunks/") && objects[path].byteLength > CANONICAL_CHUNK_BYTES) {
      fail("invalid-canonical-chunk", "A stored canonical chunk exceeds the byte limit.");
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(objects[path])); }
    catch { fail("invalid-canonical-object", "A retained canonical object is invalid."); }
  };
  const index = read(CANONICAL_INDEX);
  if (index?.version === 3 && !fragmented) {
    const physical = new Map(paths.map(path => {
      if (objects[path].byteLength > FRAGMENT_OBJECT_BYTES) fail("invalid-canonical-fragments", "A physical fragment exceeds its byte limit.");
      return [path, new TextDecoder("utf-8", { fatal: true }).decode(objects[path])];
    }));
    const logical = reassembleCanonicalObjects(index, physical);
    const inner = JSON.parse(logical.get(CANONICAL_INDEX));
    if (inner?.version !== 2) fail("invalid-canonical-index", "Fragmented copies require a grouped logical index.");
    return validateSnapshotObjects(Object.fromEntries([...logical].map(([path, text]) => [path, new TextEncoder().encode(text)])), true);
  }
  validateIndex(index);
  const ledger = { ...index.metadata };
  const expected = new Set([CANONICAL_INDEX]);
  for (const [name, idField] of Object.entries(CANONICAL_COLLECTIONS)) {
    if (index.version === 2) {
      ledger[name] = index.chunks[name].flatMap((path, ordinal) => {
        expected.add(path);
        return chunkRecords(index, name, ordinal, read(path), fragmented);
      });
      continue;
    }
    ledger[name] = index.collections[name].map((id) => {
      const path = recordPath(name, id);
      expected.add(path);
      const value = read(path);
      if (value?.[idField] !== id) fail("canonical-identity-mismatch", "A retained record has the wrong identity.");
      return value;
    });
  }
  if (paths.some((path) => !expected.has(path))) fail("unindexed-canonical-record", "A snapshot contains unindexed canonical records.");
  validateLedger(ledger);
  return true;
}

export class CanonicalLedgerStore {
  constructor({ lifecycle, cryptoImpl = globalThis.crypto, layout = "records-v1" }) {
    if (!lifecycle || typeof lifecycle.readManifest !== "function" ||
        typeof lifecycle.readObject !== "function" || typeof lifecycle.transact !== "function") {
      fail("invalid-config", "An existing verified synthetic storage lifecycle is required.");
    }
    if (!["records-v1", "chunks-v2", "fragments-v3"].includes(layout)) fail("unsupported-canonical-layout", "Choose a supported synthetic canonical layout.");
    this.layout = layout;
    this.lifecycle = lifecycle;
    this.crypto = cryptoImpl;
    this.base = null;
    this.records = new Map();
    this.storageObjects = new Map();
    this.ledger = null;
    this.busy = false;
  }

  async load() {
    if (this.busy) fail("operation-in-progress", "Finish the current canonical operation first.");
    this.busy = true;
    try { return await this.loadVerified(); }
    finally { this.busy = false; }
  }

  async loadVerified() {
    // Discard an earlier writable base before reading. Failed loads cannot leave
    // a stale candidate eligible for a later save.
    this.base = null;
    // The real catalog lifecycle verifies all retained history once and pins
    // this selected snapshot. Older/test lifecycle drivers keep their read path.
    const snapshot = typeof this.lifecycle.readVerifiedSnapshot === "function"
      ? await this.lifecycle.readVerifiedSnapshot() : null;
    const manifest = snapshot ? snapshot.manifest : await this.lifecycle.readManifest();
    if (manifest.syntheticOnly !== true) fail("synthetic-data-required", "Canonical application integration requires a synthetic copy.");
    const records = new Map();
    if (!Object.hasOwn(manifest.snapshot || {}, CANONICAL_INDEX)) {
      if (Object.keys(manifest.snapshot || {}).some((path) => path.startsWith(CANONICAL_PREFIX))) {
        fail("canonical-index-missing", "Canonical records exist without their required index.");
      }
      this.base = manifest;
      this.records = records;
      this.storageObjects = records;
      this.ledger = null;
      return null;
    }
    let logicalObjects = null;
    const readJson = async (path) => {
      if (logicalObjects) {
        if (!logicalObjects.has(path)) fail("canonical-record-missing", "A logical fragment group is missing.");
        return JSON.parse(logicalObjects.get(path));
      }
      let text;
      let value;
      try {
        if (snapshot && !Object.hasOwn(snapshot.objects, path)) fail("canonical-record-missing", "A verified snapshot is missing a required canonical record.");
        const bytes = snapshot ? snapshot.objects[path] : await this.lifecycle.readObject(path);
        if ((path === CANONICAL_INDEX || path.startsWith(CANONICAL_PREFIX + "fragments/")) && bytes.byteLength > FRAGMENT_OBJECT_BYTES &&
            (path !== CANONICAL_INDEX || JSON.parse(new TextDecoder().decode(bytes))?.version === 3)) {
          fail("invalid-canonical-fragments", "A physical fragment exceeds its byte limit.");
        }
        if (path.startsWith(CANONICAL_PREFIX + "chunks/") && bytes.byteLength > CANONICAL_CHUNK_BYTES) {
          fail("invalid-canonical-chunk", "A stored canonical chunk exceeds the byte limit.");
        }
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        value = JSON.parse(text);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) fail("invalid-canonical-object", "A canonical object is not valid UTF-8 JSON.");
        throw error;
      }
      records.set(path, canonicalizeJcs(value));
      return value;
    };
    let index = await readJson(CANONICAL_INDEX);
    const fragmented = index?.version === 3;
    if (fragmented) {
      for (const path of fragmentInventory(index)) {
        if (!Object.hasOwn(manifest.snapshot, path)) fail("canonical-record-missing", "A fragment is missing.");
        await readJson(path);
      }
      logicalObjects = reassembleCanonicalObjects(index, records);
      index = await readJson(CANONICAL_INDEX);
      if (index?.version !== 2) fail("invalid-canonical-index", "Fragmented copies require a grouped logical index.");
    }
    validateIndex(index);
    const ledger = { ...index.metadata };
    for (const [name, idField] of Object.entries(CANONICAL_COLLECTIONS)) {
      ledger[name] = [];
      if (index.version === 2) {
        for (const [ordinal, path] of index.chunks[name].entries()) {
          if (!(logicalObjects ? logicalObjects.has(path) : Object.hasOwn(manifest.snapshot, path))) fail("canonical-record-missing", "A canonical chunk is missing.");
          ledger[name].push(...chunkRecords(index, name, ordinal, await readJson(path), fragmented));
        }
        continue;
      }
      for (const id of index.collections[name]) {
        const path = recordPath(name, id);
        if (!Object.hasOwn(manifest.snapshot, path)) fail("canonical-record-missing", "The verified snapshot is missing a required canonical record.");
        const record = await readJson(path);
        if (record?.[idField] !== id) fail("canonical-identity-mismatch", "A canonical record does not match its indexed identity.");
        ledger[name].push(record);
      }
    }
    if (Object.keys(manifest.snapshot).some((path) => path.startsWith(CANONICAL_PREFIX) && !records.has(path))) {
      fail("unindexed-canonical-record", "The snapshot contains canonical history outside its index.");
    }
    const indexedChunks = logicalObjects ? new Set(Object.values(index.chunks).flat()) : null;
    if (logicalObjects && [...logicalObjects.keys()].some(path => path !== CANONICAL_INDEX && !indexedChunks.has(path))) {
      fail("unindexed-canonical-record", "Fragmented history contains unindexed logical chunks.");
    }
    logicalObjects = null;
    validateLedger(ledger);
    // readVerifiedSnapshot already checked the exact manifest after reading all
    // bytes and rechecked ownership. This is a point-in-time view, not a cache.
    const current = snapshot ? manifest : await this.lifecycle.readManifest();
    if (canonicalizeJcs(current) !== canonicalizeJcs(manifest)) {
      fail("base-conflict", "Storage changed while canonical records were loading. Reopen and review the latest state.");
    }
    this.base = current;
    this.layout = fragmented ? "fragments-v3" : index.version === 2 ? "chunks-v2" : "records-v1";
    this.storageObjects = records;
    // Existing immutable-history checks always compare individual logical
    // records, irrespective of the physical layout selected by this copy.
    this.records = index.version === 2 ? serializeCanonicalLedger(ledger) : records;
    this.ledger = ledger;
    return structuredClone(ledger);
  }

  async save(ledger) {
    if (this.busy) fail("operation-in-progress", "Finish the current canonical operation first.");
    if (!this.base) fail("verified-base-required", "Reopen verified canonical data before saving.");
    this.busy = true;
    try {
      const objects = serializeCanonicalLedger(ledger);
      // Corrections are events. This integration never removes historical
      // records or substitutes a new ledger for an existing one.
      if (this.ledger && ledger.ledgerId !== this.ledger.ledgerId) fail("ledger-identity-mismatch", "A save cannot replace the selected canonical ledger identity.");
      if (this.ledger) {
        for (const [name, idField] of Object.entries(CANONICAL_COLLECTIONS)) {
          if (this.ledger[name].some((record, position) => ledger[name][position]?.[idField] !== record[idField])) {
            fail("history-order-change-refused", "Existing canonical record order is append-only.");
          }
        }
      }
      for (const path of this.records.keys()) {
        if (!objects.has(path)) fail("history-removal-refused", "Canonical history cannot be removed by this import workflow.");
        if (path === CANONICAL_INDEX && canonicalizeJcs(JSON.parse(this.records.get(path)).metadata) !== canonicalizeJcs(JSON.parse(objects.get(path)).metadata)) {
          fail("ledger-metadata-rewrite-refused", "Existing ledger identity and creation evidence are immutable.");
        }
        const immutable = ["accounts/", "activities/", "events/", "reviewDecisions/"]
          .some((part) => path.startsWith(CANONICAL_PREFIX + part));
        if (immutable && objects.get(path) !== this.records.get(path)) {
          fail("history-rewrite-refused", "Existing financial records must be corrected through additional events.");
        }
        if (path.startsWith(CANONICAL_PREFIX + "observations/")) {
          const before = JSON.parse(this.records.get(path));
          const after = JSON.parse(objects.get(path));
          const evidenceKeys = ["observationId", "importRunId", "accountId", "institutionId", "rowOrdinal", "physicalLine", "sourceFields", "sourceRecordId", "sourceRowFingerprint", "observedAt", "candidate"];
          if (evidenceKeys.some((key) => canonicalizeJcs(before[key] ?? null) !== canonicalizeJcs(after[key] ?? null))) {
            fail("source-evidence-rewrite-refused", "Import review cannot overwrite original source evidence.");
          }
        }
        if (path.startsWith(CANONICAL_PREFIX + "imports/")) {
          const before = JSON.parse(this.records.get(path));
          const after = JSON.parse(objects.get(path));
          const sourceKeys = ["importRunId", "institutionId", "accountId", "sourceFormat", "fileFingerprint", "startedAt", "completedAt", "declaredCoverage", "observedStart", "observedEnd", "observationIds", "sourceFileRetentionStatus", "privateSourceFileRef", "sourceFileRetainedAt", "sourceFileRetentionExpiresAt", "sourceFileDeletedAt", "coverageReconciled"];
          if (sourceKeys.some((key) => canonicalizeJcs(before[key] ?? null) !== canonicalizeJcs(after[key] ?? null))) {
            fail("import-evidence-rewrite-refused", "Import review cannot replace its original file or coverage evidence.");
          }
          if (before.retryAttempts.some((attempt, position) => canonicalizeJcs(after.retryAttempts[position] ?? null) !== canonicalizeJcs(attempt))) {
            fail("retry-history-rewrite-refused", "Retry evidence must remain append-only.");
          }
        }
      }
      const storageObjects = this.layout === "fragments-v3"
        ? serializeFragmentedCanonicalLedger(ledger, this.storageObjects.has(CANONICAL_INDEX) ? JSON.parse(this.storageObjects.get(CANONICAL_INDEX)) : null)
        : this.layout === "chunks-v2" ? serializePackedCanonicalLedger(ledger) : objects;
      for (const path of this.storageObjects.keys()) {
        if (!storageObjects.has(path)) fail("history-removal-refused", "A save cannot drop an existing canonical chunk or record.");
      }
      const changed = [...storageObjects].filter(([path, content]) => this.storageObjects.get(path) !== content)
        .map(([logicalPath, content]) => ({ logicalPath, content }));
      if (changed.length && typeof this.lifecycle.assertCurrentManifest === "function") {
        // The real transaction engine verifies all retained history before its
        // first mutation. This handoff checks ownership and the exact base
        // without duplicating that whole-history scan. It is not a data read.
        try { await this.lifecycle.assertCurrentManifest(this.base); }
        catch (error) { if (error?.code === "base-conflict") this.base = null; throw error; }
      } else {
        // No-op saves still verify storage. Older lifecycle drivers retain the
        // complete preflight rather than assuming they implement this handoff.
        const current = await this.lifecycle.readManifest();
        if (canonicalizeJcs(current) !== canonicalizeJcs(this.base)) {
          this.base = null;
          fail("base-conflict", "Storage changed after the review. Reopen and recompute the import before saving.");
        }
      }
      if (!changed.length) return structuredClone(this.ledger);
      if (!this.crypto?.randomUUID) fail("crypto-unavailable", "Cryptographic transaction identities are required.");
      const transaction = {
        manifestFileId: this.lifecycle.manifestFileId,
        expectedBase: this.base,
        transactionId: this.crypto.randomUUID(),
        objects: changed,
        commitRecord: { operationType: "synthetic-canonical-import", schemaVersion: 1 }
      };
      // An uncertain write must go through the existing lifecycle recovery.
      // Clearing the base prevents a blind retry of the reviewed proposal.
      this.base = null;
      await this.lifecycle.transact(transaction);
      const verified = await this.loadVerified();
      if (canonicalizeJcs(verified) !== canonicalizeJcs(ledger)) {
        this.base = null;
        fail("canonical-readback-mismatch", "Canonical records did not match their verified post-commit read-back.");
      }
      return verified;
    } finally { this.busy = false; }
  }
}
