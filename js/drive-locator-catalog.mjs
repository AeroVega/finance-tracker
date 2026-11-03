import { canonicalizeJcs, sha256Hex } from "./transaction-protocol.mjs";

const FORMAT = "finance-tracker-locator-catalog";
const VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;
const KINDS = new Set(["data-object", "commit-record", "journal-event", "migration-record", "protocol-object"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class LocatorCatalogError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LocatorCatalogError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new LocatorCatalogError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function locatorKey(kind, identity) {
  if (!KINDS.has(kind) || typeof identity !== "string" || !identity.trim() ||
      FORBIDDEN_KEYS.has(identity)) {
    fail("invalid-locator-identity", "A locator requires a supported immutable-object kind and non-empty identity.");
  }
  return kind + ":" + identity;
}

function validateEntry(key, entry, ids) {
  if (!isRecord(entry) || !KINDS.has(entry.kind) ||
      typeof entry.identity !== "string" || !entry.identity.trim() ||
      typeof entry.fileId !== "string" || !entry.fileId.trim() ||
      typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256) ||
      key !== locatorKey(entry.kind, entry.identity)) {
    fail("invalid-locator-entry", "A locator entry has an invalid key, identity, file ID, kind, or content hash.", { key });
  }
  if (entry.kind === "data-object" && entry.identity !== entry.sha256) {
    fail("invalid-data-object-identity", "A data-object locator identity must equal its exact content hash.", { key });
  }
  if (entry.kind === "journal-event" &&
      (typeof entry.transactionId !== "string" || !entry.transactionId.trim() ||
       !Number.isSafeInteger(entry.sequence) || entry.sequence < 0)) {
    fail("invalid-journal-locator", "A journal-event locator must include its transaction ID and non-negative sequence.", { key });
  }
  if (ids.has(entry.fileId)) {
    fail("duplicate-physical-locator", "One physical file ID cannot identify multiple immutable catalog entries.", { fileId: entry.fileId });
  }
  ids.add(entry.fileId);
  return entry;
}

/**
 * Validate one immutable, copy-specific index of all retained immutable
 * protocol objects. The current catalog file is intentionally not self-indexed.
 */
export function validateLocatorCatalog(catalog, expected = {}) {
  if (!isRecord(catalog) || catalog.format !== FORMAT || catalog.version !== VERSION ||
      typeof catalog.databaseId !== "string" || !catalog.databaseId.trim() ||
      typeof catalog.copyId !== "string" || !catalog.copyId.trim() ||
      !Number.isSafeInteger(catalog.generation) || catalog.generation < 0 ||
      !(catalog.parentCatalogHash === null || (typeof catalog.parentCatalogHash === "string" && SHA256.test(catalog.parentCatalogHash))) ||
      !isRecord(catalog.entries)) {
    fail("invalid-locator-catalog", "The locator catalog is malformed or uses an unsupported format.");
  }
  if ((catalog.generation === 0) !== (catalog.parentCatalogHash === null)) {
    fail("invalid-catalog-parent", "Only an initial catalog may have a null parent hash.");
  }

  for (const field of ["databaseId", "copyId"]) {
    if (expected[field] !== undefined && catalog[field] !== expected[field]) {
      fail("locator-catalog-identity-mismatch", "The locator catalog belongs to a different logical database or physical copy.", {
        field,
        expected: expected[field],
        actual: catalog[field]
      });
    }
  }
  if (expected.generation !== undefined && catalog.generation !== expected.generation) {
    fail("locator-catalog-generation-mismatch", "The locator catalog generation does not match the expected generation.");
  }

  const ids = new Set();
  for (const [key, entry] of Object.entries(catalog.entries)) validateEntry(key, entry, ids);
  return catalog;
}

/**
 * Build the next immutable catalog by copying the previous map and adding
 * newly verified objects. Existing mappings are never silently replaced.
 */
export function createLocatorCatalog({
  databaseId,
  copyId,
  previousCatalog = null,
  previousCatalogHash = null,
  additions = []
} = {}) {
  if (typeof databaseId !== "string" || !databaseId.trim() ||
      typeof copyId !== "string" || !copyId.trim() || !Array.isArray(additions)) {
    fail("invalid-locator-catalog-input", "A database ID, copy ID, and immutable-object addition list are required.");
  }

  let generation = 0;
  let parentCatalogHash = null;
  const entries = Object.create(null);

  if (previousCatalog !== null) {
    validateLocatorCatalog(previousCatalog, { databaseId, copyId });
    if (!SHA256.test(String(previousCatalogHash || ""))) {
      fail("invalid-parent-catalog-hash", "A verified SHA-256 hash is required when extending an existing locator catalog.");
    }
    generation = previousCatalog.generation + 1;
    parentCatalogHash = previousCatalogHash;
    for (const [key, entry] of Object.entries(previousCatalog.entries)) entries[key] = { ...entry };
  } else if (previousCatalogHash !== null) {
    fail("unexpected-parent-catalog-hash", "An initial locator catalog cannot declare a parent hash.");
  }

  const ids = new Map(Object.entries(entries).map(([key, entry]) => [entry.fileId, key]));
  for (const addition of additions) {
    if (!isRecord(addition)) fail("invalid-locator-addition", "Each locator addition must be an object.");
    const entry = {
      kind: addition.kind,
      identity: addition.identity,
      fileId: addition.fileId,
      sha256: addition.sha256
    };
    if (addition.kind === "journal-event") {
      entry.transactionId = addition.transactionId;
      entry.sequence = addition.sequence;
    }
    const key = locatorKey(entry.kind, entry.identity);
    validateEntry(key, entry, new Set());
    const existing = entries[key];
    if (existing) {
      if (existing.fileId !== entry.fileId || existing.sha256 !== entry.sha256 ||
          existing.transactionId !== entry.transactionId || existing.sequence !== entry.sequence) {
        fail("locator-replacement-forbidden", "An existing immutable-object identity cannot be rebound to another file ID or hash.", { key });
      }
      continue;
    }
    const priorKey = ids.get(entry.fileId);
    if (priorKey && priorKey !== key) {
      fail("duplicate-physical-locator", "One physical file ID cannot identify multiple immutable catalog entries.", { fileId: entry.fileId });
    }
    entries[key] = entry;
    ids.set(entry.fileId, key);
  }

  const catalog = {
    format: FORMAT,
    version: VERSION,
    databaseId,
    copyId,
    generation,
    parentCatalogHash,
    entries
  };
  return validateLocatorCatalog(catalog, { databaseId, copyId, generation });
}

export async function hashLocatorCatalog(catalog, cryptoImpl = globalThis.crypto) {
  validateLocatorCatalog(catalog);
  return sha256Hex(canonicalizeJcs(catalog), cryptoImpl);
}

export function resolveLocator(catalog, { kind, identity } = {}) {
  validateLocatorCatalog(catalog);
  const key = locatorKey(kind, identity);
  const entry = catalog.entries[key];
  if (!entry) fail("locator-not-found", "The selected physical copy has no locator for the requested immutable object.", { key });
  return entry;
}

/** Resolve a commit's logicalPath -> SHA-256 map through this physical copy's catalog. */
export function resolveSnapshotLocators(snapshot, catalog) {
  validateLocatorCatalog(catalog);
  if (!isRecord(snapshot)) fail("invalid-logical-snapshot", "A committed snapshot must be a logical path-to-hash map.");

  const resolved = {};
  for (const [logicalPath, hash] of Object.entries(snapshot)) {
    if (!logicalPath.trim() || FORBIDDEN_KEYS.has(logicalPath) || typeof hash !== "string" || !SHA256.test(hash)) {
      fail("invalid-logical-snapshot-entry", "A committed snapshot contains an invalid logical path or content hash.", { logicalPath });
    }
    const entry = resolveLocator(catalog, { kind: "data-object", identity: hash });
    if (entry.sha256 !== hash) {
      fail("locator-hash-mismatch", "The data-object locator does not match the committed content hash.", { logicalPath, hash });
    }
    resolved[logicalPath] = { sha256: hash, fileId: entry.fileId };
  }
  return resolved;
}

export const LOCATOR_CATALOG_FORMAT = FORMAT;
export const LOCATOR_CATALOG_VERSION = VERSION;
