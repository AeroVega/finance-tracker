import { fragmentCanonicalObjects, reassembleCanonicalObjects, fragmentInventory, FRAGMENT_OBJECT_BYTES } from "./canonical-fragments.mjs";
import { canonicalizeJcs } from "./transaction-protocol.mjs";
import { validateLedger } from "./canonical-import.mjs";

// Financial records use the existing PR25 catalog and transaction protocol.
// This is a payload adapter, not another storage or recovery implementation.
export const CANONICAL_PREFIX = "synthetic/canonical-v1/";
export const CANONICAL_INDEX = CANONICAL_PREFIX + "index.json";
export const CANONICAL_COLLECTIONS = Object.freeze({
  accounts: "accountId", imports: "importRunId", observations: "observationId",
  activities: "activityId", events: "eventId", reviewDecisions: "reviewDecisionId", positionEvents: "eventId"
});

// Position history is optional so historical six-collection ledgers retain
// their exact representation. If present it must be indexed, never metadata.
const REQUIRED_COLLECTIONS = Object.keys(CANONICAL_COLLECTIONS).filter(name => name !== "positionEvents");
function ledgerCollections(ledger) {
  return Object.keys(CANONICAL_COLLECTIONS).filter(name => name !== "positionEvents" || Object.hasOwn(ledger, name));
}
function indexCollections(index) {
  const collections = index?.collections;
  if (!collections || typeof collections !== "object" || Array.isArray(collections) ||
      REQUIRED_COLLECTIONS.some(name => !Object.hasOwn(collections, name)) ||
      Object.keys(collections).some(name => !Object.hasOwn(CANONICAL_COLLECTIONS, name) || !Array.isArray(collections[name])) ||
      !index.metadata || typeof index.metadata !== "object" || Array.isArray(index.metadata) ||
      Object.keys(CANONICAL_COLLECTIONS).some(name => Object.hasOwn(index.metadata, name))) {
    fail("invalid-canonical-index", "The canonical index has an invalid collection inventory or embedded collection metadata.");
  }
  return Object.keys(CANONICAL_COLLECTIONS).filter(name => Object.hasOwn(collections, name));
}

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
  for (const name of ledgerCollections(ledger)) {
    const idField = CANONICAL_COLLECTIONS[name];
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

/** Version 3 is the only grouped/fragmented write layout. The logical group
 * schema is distinct from deprecated v2; fragment envelopes bound transport.
 */
export const CANONICAL_GROUP_RECORDS = 64;
// Keep the historical logical object paths stable so existing v3 fragment
// inventories can be rewritten without dropping any retained fragment.
const groupPath = (collection, ordinal) => CANONICAL_PREFIX + "chunks/" + collection + "/" + String(ordinal).padStart(6, "0") + ".json";
const legacyGroupPath = groupPath;

export function serializeFragmentedCanonicalLedger(ledger, previousRoot = null) {
  const index = canonicalIndex(ledger);
  index.version = 3;
  index.groups = {};
  const objects = new Map();
  for (const name of indexCollections(index)) {
    index.groups[name] = [];
    for (let offset = 0; offset < ledger[name].length; offset += CANONICAL_GROUP_RECORDS) {
      const path = groupPath(name, offset / CANONICAL_GROUP_RECORDS);
      const text = canonicalizeJcs({ format: "finance-tracker-canonical-group", version: 1,
        collection: name, records: ledger[name].slice(offset, offset + CANONICAL_GROUP_RECORDS) });
      index.groups[name].push(path);
      objects.set(path, text);
    }
  }
  objects.set(CANONICAL_INDEX, canonicalizeJcs(index));
  return fragmentCanonicalObjects(objects, previousRoot);
}

function validateFragmentedIndex(index) {
  if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 3 ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      Object.keys(index).sort().join(",") !== "collections,format,groups,metadata,syntheticOnly,version" ||
      !index.collections || !index.groups || typeof index.collections !== "object" || typeof index.groups !== "object") {
    fail("invalid-canonical-index", "The fragmented v3 logical index is invalid.");
  }
  const names = indexCollections(index);
  if (Object.keys(index.collections).length !== names.length || Object.keys(index.groups).length !== names.length ||
      names.some(name => !Array.isArray(index.collections[name]) || !Array.isArray(index.groups[name]))) {
    fail("invalid-canonical-index", "The fragmented v3 group inventory is incomplete.");
  }
  for (const name of names) {
    const ids = index.collections[name];
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length ||
        index.groups[name].length !== Math.ceil(ids.length / CANONICAL_GROUP_RECORDS) ||
        index.groups[name].some((path, ordinal) => path !== groupPath(name, ordinal))) {
      fail("invalid-canonical-index", "Fragmented v3 group paths or record identities are invalid.");
    }
  }
}

function validateLegacyV3Index(index) {
  const names = indexCollections(index);
  if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 2 ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      Object.keys(index).sort().join(",") !== "chunks,collections,format,metadata,syntheticOnly,version" ||
      !index.collections || !index.chunks || Object.keys(index.collections).length !== names.length ||
      Object.keys(index.chunks).length !== names.length) {
    fail("invalid-canonical-index", "The legacy v3 logical index is invalid.");
  }
  for (const name of names) {
    const ids = index.collections[name], paths = index.chunks[name];
    if (!Array.isArray(ids) || !Array.isArray(paths)) fail("invalid-canonical-index", "The legacy v3 group inventory is incomplete.");
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length || paths.length !== Math.ceil(ids.length / CANONICAL_GROUP_RECORDS) ||
        paths.some((path, ordinal) => path !== legacyGroupPath(name, ordinal))) {
      fail("invalid-canonical-index", "The legacy v3 group paths or record identities are invalid.");
    }
  }
}

function legacyV3GroupRecords(index, name, ordinal, value) {
  if (value?.format !== "finance-tracker-canonical-chunk" || value.version !== 1 || value.collection !== name ||
      Object.keys(value).sort().join(",") !== "collection,format,records,version" || !Array.isArray(value.records)) {
    fail("invalid-canonical-group", "A legacy v3 logical group has an invalid envelope.");
  }
  const ids = index.collections[name].slice(ordinal * CANONICAL_GROUP_RECORDS, (ordinal + 1) * CANONICAL_GROUP_RECORDS);
  if (value.records.length !== ids.length || value.records.some((record, position) => record?.[CANONICAL_COLLECTIONS[name]] !== ids[position])) {
    fail("canonical-identity-mismatch", "Legacy grouped records do not match their indexed order and identities.");
  }
  return value.records;
}

function groupRecords(index, name, ordinal, value) {
  if (value?.format !== "finance-tracker-canonical-group" || value.version !== 1 || value.collection !== name ||
      Object.keys(value).sort().join(",") !== "collection,format,records,version" || !Array.isArray(value.records)) {
    fail("invalid-canonical-group", "A fragmented v3 canonical group has an invalid envelope.");
  }
  const ids = index.collections[name].slice(ordinal * CANONICAL_GROUP_RECORDS, (ordinal + 1) * CANONICAL_GROUP_RECORDS);
  if (value.records.length !== ids.length || value.records.some((record, position) => record?.[CANONICAL_COLLECTIONS[name]] !== ids[position])) {
    fail("canonical-identity-mismatch", "Grouped records do not match their exact indexed order and identities.");
  }
  return value.records;
}

function validateIndex(index) {
  if (!index || index.format !== "finance-tracker-canonical-index" || index.version !== 1 ||
      index.syntheticOnly !== true || index.metadata?.syntheticOnly !== true ||
      Object.keys(index).sort().join(",") !== "collections,format,metadata,syntheticOnly,version" ||
      !index.collections || typeof index.collections !== "object") {
    fail("invalid-canonical-index", "The canonical index is not a supported synthetic record set.");
  }
  const names = indexCollections(index);
  if (Object.keys(index.collections).length !== names.length || names.some((name) => !Array.isArray(index.collections[name]))) {
    fail("invalid-canonical-index", "The canonical index has an invalid collection inventory.");
  }
  for (const name of names) {
    const ids = index.collections[name];
    ids.forEach(safeId);
    if (new Set(ids).size !== ids.length) fail("duplicate-record-id", "The canonical index repeats an identity.");
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
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(objects[path])); }
    catch { fail("invalid-canonical-object", "A retained canonical object is invalid."); }
  };
  const index = read(CANONICAL_INDEX);
  if (index?.version === 2 && !fragmented) {
    fail("deprecated-canonical-layout", "Standalone grouped canonical storage v2 is no longer supported. Use a fragmented v3 synthetic copy.");
  }
  if (index?.version === 3 && !fragmented) {
    if (!index.fragments) fail("invalid-canonical-fragments", "A fragmented v3 root is missing its physical inventory.");
    const physical = new Map(paths.map(path => {
      if (objects[path].byteLength > FRAGMENT_OBJECT_BYTES) fail("invalid-canonical-fragments", "A physical fragment exceeds its byte limit.");
      return [path, new TextDecoder("utf-8", { fatal: true }).decode(objects[path])];
    }));
    const logical = reassembleCanonicalObjects(index, physical);
    const inner = JSON.parse(logical.get(CANONICAL_INDEX));
    if (inner?.version !== 3 && inner?.version !== 2) fail("invalid-canonical-index", "Fragmented v3 copies require a supported v3 logical index.");
    return validateSnapshotObjects(Object.fromEntries([...logical].map(([path, text]) => [path, new TextEncoder().encode(text)])), true);
  }
  const ledger = {};
  const expected = new Set([CANONICAL_INDEX]);
  if (fragmented && index?.version === 2) {
    validateLegacyV3Index(index);
    Object.assign(ledger, index.metadata);
    for (const name of indexCollections(index)) {
      ledger[name] = index.chunks[name].flatMap((path, ordinal) => {
        expected.add(path);
        return legacyV3GroupRecords(index, name, ordinal, read(path));
      });
    }
  } else if (fragmented && index?.version === 3) {
    validateFragmentedIndex(index);
    Object.assign(ledger, index.metadata);
    for (const name of indexCollections(index)) {
      ledger[name] = index.groups[name].flatMap((path, ordinal) => {
        expected.add(path);
        return groupRecords(index, name, ordinal, read(path));
      });
    }
  } else {
    validateIndex(index);
    Object.assign(ledger, index.metadata);
    for (const name of indexCollections(index)) {
      const idField = CANONICAL_COLLECTIONS[name];
      ledger[name] = index.collections[name].map((id) => {
        const path = recordPath(name, id);
        expected.add(path);
        const value = read(path);
        if (value?.[idField] !== id) fail("canonical-identity-mismatch", "A retained record has the wrong identity.");
        return value;
      });
    }
  }
  if (paths.some((path) => !expected.has(path))) fail("unindexed-canonical-record", "A snapshot contains unindexed canonical records.");
  validateLedger(ledger);
  return true;
}

export class CanonicalLedgerStore {
  constructor({ lifecycle, cryptoImpl = globalThis.crypto, layout = "fragments-v3" }) {
    if (!lifecycle || typeof lifecycle.readManifest !== "function" ||
        typeof lifecycle.readObject !== "function" || typeof lifecycle.transact !== "function") {
      fail("invalid-config", "An existing verified synthetic storage lifecycle is required.");
    }
    if (!["records-v1", "fragments-v3"].includes(layout)) fail("unsupported-canonical-layout", "Only records-v1 reads and fragmented-v3 writes are supported.");
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
        if (!logicalObjects.has(path)) fail("canonical-record-missing", "A logical canonical record is missing.");
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
    const fragmented = index?.version === 3 && Object.hasOwn(index, "fragments");
    if (index?.version === 2 && !fragmented) {
      fail("deprecated-canonical-layout", "Standalone grouped canonical storage v2 is no longer supported. Use a fragmented v3 synthetic copy.");
    }
    if (index?.version === 3 && !fragmented) fail("invalid-canonical-index", "A standalone v3 logical index is not a physical fragmented copy.");
    if (fragmented) {
      for (const path of fragmentInventory(index)) {
        if (!Object.hasOwn(manifest.snapshot, path)) fail("canonical-record-missing", "A fragment is missing.");
        await readJson(path);
      }
      logicalObjects = reassembleCanonicalObjects(index, records);
      index = await readJson(CANONICAL_INDEX);
      if (index?.version !== 3 && index?.version !== 2) fail("invalid-canonical-index", "Fragmented v3 copies require a supported v3 logical index.");
    }
    const ledger = {};
    if (fragmented && index.version === 2) {
      validateLegacyV3Index(index);
      Object.assign(ledger, index.metadata);
      for (const name of indexCollections(index)) {
        ledger[name] = [];
        for (const [ordinal, path] of index.chunks[name].entries()) {
          if (!logicalObjects.has(path)) fail("canonical-record-missing", "A legacy v3 logical group is missing.");
          ledger[name].push(...legacyV3GroupRecords(index, name, ordinal, await readJson(path)));
        }
      }
    } else if (fragmented) {
      validateFragmentedIndex(index);
      Object.assign(ledger, index.metadata);
      for (const name of indexCollections(index)) {
        ledger[name] = [];
        for (const [ordinal, path] of index.groups[name].entries()) {
          if (!logicalObjects.has(path)) fail("canonical-record-missing", "A logical v3 group is missing.");
          ledger[name].push(...groupRecords(index, name, ordinal, await readJson(path)));
        }
      }
    } else {
      validateIndex(index);
      Object.assign(ledger, index.metadata);
      for (const name of indexCollections(index)) {
        const idField = CANONICAL_COLLECTIONS[name];
        ledger[name] = [];
        for (const id of index.collections[name]) {
          const path = recordPath(name, id);
          if (!Object.hasOwn(manifest.snapshot, path)) fail("canonical-record-missing", "The verified snapshot is missing a required canonical record.");
          const record = await readJson(path);
          if (record?.[idField] !== id) fail("canonical-identity-mismatch", "A canonical record does not match its indexed identity.");
          ledger[name].push(record);
        }
      }
    }
    if (Object.keys(manifest.snapshot).some((path) => path.startsWith(CANONICAL_PREFIX) && !records.has(path))) {
      fail("unindexed-canonical-record", "The snapshot contains canonical history outside its index.");
    }
    if (logicalObjects) {
      const indexedLogicalObjects = new Set([CANONICAL_INDEX, ...Object.values(index.version === 2 ? index.chunks : index.groups).flat()]);
      if ([...logicalObjects.keys()].some(path => !indexedLogicalObjects.has(path))) {
        fail("unindexed-canonical-record", "Fragmented history contains unindexed logical groups.");
      }
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
    this.layout = fragmented ? "fragments-v3" : "records-v1";
    this.storageObjects = records;
    // Existing immutable-history checks always compare individual logical
    // records, irrespective of the physical layout selected by this copy.
    this.records = fragmented ? serializeCanonicalLedger(ledger) : records;
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
        if (Object.hasOwn(this.ledger, "positionEvents") && !Object.hasOwn(ledger, "positionEvents")) {
          fail("history-removal-refused", "Existing position history cannot be removed.");
        }
        for (const [name, idField] of Object.entries(CANONICAL_COLLECTIONS)) {
          if ((this.ledger[name] || []).some((record, position) => ledger[name]?.[position]?.[idField] !== record[idField])) {
            fail("history-order-change-refused", "Existing canonical record order is append-only.");
          }
        }
      }
      for (const path of this.records.keys()) {
        if (!objects.has(path)) fail("history-removal-refused", "Canonical history cannot be removed by this import workflow.");
        if (path === CANONICAL_INDEX && canonicalizeJcs(JSON.parse(this.records.get(path)).metadata) !== canonicalizeJcs(JSON.parse(objects.get(path)).metadata)) {
          fail("ledger-metadata-rewrite-refused", "Existing ledger identity and creation evidence are immutable.");
        }
        const immutable = ["accounts/", "activities/", "events/", "reviewDecisions/", "positionEvents/"]
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
        : objects;
      for (const path of this.storageObjects.keys()) {
        if (!storageObjects.has(path)) fail("history-removal-refused", "A save cannot drop an existing canonical object.");
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
