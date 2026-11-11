import { LOCATOR_CATALOG_FORMAT, validateLocatorCatalog, LocatorCatalogError } from "./drive-locator-catalog.mjs";

export const SEGMENTED_CATALOG_VERSION = 2;
export const CATALOG_SEGMENT_ENTRIES = 128;
export const CATALOG_SEGMENT_BYTES = 64 * 1024;
export const CATALOG_ROOT_BYTES = 16 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const fail = (code, message) => { throw new LocatorCatalogError(code, message); };
const record = value => value && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const catalogPointer = value => record(value) && typeof value.fileId === "string" && !!value.fileId.trim() && HASH.test(value.sha256);

function identity(value, expected) {
  for (const field of ["databaseId", "copyId"]) {
    if (typeof value[field] !== "string" || !value[field].trim() ||
        (expected[field] !== undefined && value[field] !== expected[field])) {
      fail("locator-catalog-identity-mismatch", "Catalog metadata belongs to a different database or physical copy.");
    }
  }
}

/** A fixed-size publication root. Previous roots and segment bytes never change. */
export function validateCatalogRoot(root, expected = {}) {
  if (!record(root) || root.format !== LOCATOR_CATALOG_FORMAT || root.version !== SEGMENTED_CATALOG_VERSION ||
      !integer(root.generation) || !integer(root.entryCount) || !integer(root.segmentCount) ||
      !(root.parentCatalogHash === null || HASH.test(root.parentCatalogHash)) ||
      !(root.segmentTip === null || catalogPointer(root.segmentTip)) ||
      !(root.legacyCatalog === null || catalogPointer(root.legacyCatalog)) ||
      Object.hasOwn(root, "entries") || (root.generation === 0) !== (root.parentCatalogHash === null) ||
      (root.segmentCount === 0) !== (root.segmentTip === null) ||
      (root.legacyCatalog !== null && root.generation === 0)) {
    fail("invalid-catalog-root", "The segmented catalog root is malformed.");
  }
  identity(root, expected);
  return root;
}

/** Each segment contains new bindings only, with an exact-byte link to its predecessor. */
export function validateCatalogSegment(segment, expected = {}) {
  if (!record(segment) || segment.format !== "finance-tracker-locator-segment" || segment.version !== 1 ||
      !integer(segment.generation) || !integer(segment.sequence) ||
      !(segment.previousSegment === null || catalogPointer(segment.previousSegment)) ||
      (segment.sequence === 0) !== (segment.previousSegment === null) || !record(segment.entries)) {
    fail("invalid-catalog-segment", "An immutable catalog segment is malformed.");
  }
  identity(segment, expected);
  const count = Object.keys(segment.entries).length;
  if (count < 1 || count > CATALOG_SEGMENT_ENTRIES) fail("catalog-segment-limit", "A catalog segment has an invalid entry count.");
  // Reuse the complete typed-binding and physical-ID validation contract.
  validateLocatorCatalog({ format: LOCATOR_CATALOG_FORMAT, version: 1, databaseId: segment.databaseId,
    copyId: segment.copyId, generation: 0, parentCatalogHash: null, entries: segment.entries });
  return segment;
}
