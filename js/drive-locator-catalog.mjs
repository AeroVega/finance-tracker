import { canonicalizeJcs, sha256Hex } from "./transaction-protocol.mjs";

const FORMAT = "finance-tracker-locator-catalog";
const VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;
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

/**
 * Validate one immutable, copy-specific map from content hashes to Drive IDs.
 * Commit records never contain these physical IDs; only this catalog does.
 */
export function validateLocatorCatalog(catalog, expected = {}) {
  if (!isRecord(catalog) || catalog.format !== FORMAT || catalog.version !== VERSION ||
      typeof catalog.databaseId !== "string" || !catalog.databaseId.trim() ||
      typeof catalog.copyId !== "string" || !catalog.copyId.trim() ||
      !Number.isSafeInteger(catalog.generation) || catalog.generation < 0 ||
      !(catalog.parentCatalogHash === null || SHA256.test(String(catalog.parentCatalogHash))) ||
      !isRecord(catalog.locators)) {
    fail("invalid-locator-catalog", "The locator catalog is malformed or uses an unsupported format.");
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
  for (const [hash, fileId] of Object.entries(catalog.locators)) {
    if (!SHA256.test(hash) || typeof fileId !== "string" || !fileId.trim() ||
        FORBIDDEN_KEYS.has(hash) || ids.has(fileId)) {
      fail("invalid-locator-entry", "Every content hash must map to exactly one unique, non-empty physical file ID.", { hash });
    }
    ids.add(fileId);
  }
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
    fail("invalid-locator-catalog-input", "A database ID, copy ID, and object-addition list are required.");
  }

  let generation = 0;
  let parentCatalogHash = null;
  const locators = Object.create(null);

  if (previousCatalog !== null) {
    validateLocatorCatalog(previousCatalog, { databaseId, copyId });
    if (!SHA256.test(String(previousCatalogHash || ""))) {
      fail("invalid-parent-catalog-hash", "A verified SHA-256 hash is required when extending an existing locator catalog.");
    }
    generation = previousCatalog.generation + 1;
    parentCatalogHash = previousCatalogHash;
    for (const [hash, fileId] of Object.entries(previousCatalog.locators)) locators[hash] = fileId;
  } else if (previousCatalogHash !== null) {
    fail("unexpected-parent-catalog-hash", "An initial locator catalog cannot declare a parent hash.");
  }

  const ids = new Map(Object.entries(locators).map(([hash, fileId]) => [fileId, hash]));
  for (const item of additions) {
    const hash = item?.sha256;
    const fileId = item?.fileId;
    if (!SHA256.test(String(hash || "")) || typeof fileId !== "string" || !fileId.trim()) {
      fail("invalid-locator-addition", "A locator addition requires a SHA-256 content hash and physical file ID.");
    }
    if (Object.hasOwn(locators, hash)) {
      if (locators[hash] !== fileId) {
        fail("locator-replacement-forbidden", "An existing content hash cannot be rebound to a different physical file ID.", { hash });
      }
      continue;
    }
    const priorHash = ids.get(fileId);
    if (priorHash && priorHash !== hash) {
      fail("duplicate-physical-locator", "One physical file ID cannot identify two different content hashes.", { fileId });
    }
    locators[hash] = fileId;
    ids.set(fileId, hash);
  }

  const catalog = {
    format: FORMAT,
    version: VERSION,
    databaseId,
    copyId,
    generation,
    parentCatalogHash,
    locators
  };
  return validateLocatorCatalog(catalog, { databaseId, copyId, generation });
}

export async function hashLocatorCatalog(catalog, cryptoImpl = globalThis.crypto) {
  validateLocatorCatalog(catalog);
  return sha256Hex(canonicalizeJcs(catalog), cryptoImpl);
}

/** Resolve a commit's logicalPath -> SHA-256 map through this physical copy's catalog. */
export function resolveSnapshotLocators(snapshot, catalog) {
  validateLocatorCatalog(catalog);
  if (!isRecord(snapshot)) fail("invalid-logical-snapshot", "A committed snapshot must be a logical path-to-hash map.");

  const resolved = Object.create(null);
  for (const [logicalPath, hash] of Object.entries(snapshot)) {
    if (!logicalPath.trim() || FORBIDDEN_KEYS.has(logicalPath) || !SHA256.test(String(hash || ""))) {
      fail("invalid-logical-snapshot-entry", "A committed snapshot contains an invalid logical path or content hash.", { logicalPath });
    }
    const fileId = catalog.locators[hash];
    if (typeof fileId !== "string" || !fileId) {
      fail("locator-not-found", "The selected physical copy has no locator for a committed content hash.", { logicalPath, hash });
    }
    resolved[logicalPath] = { sha256: hash, fileId };
  }
  return resolved;
}

export const LOCATOR_CATALOG_FORMAT = FORMAT;
export const LOCATOR_CATALOG_VERSION = VERSION;
