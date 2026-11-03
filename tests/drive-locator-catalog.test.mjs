import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createLocatorCatalog,
  hashLocatorCatalog,
  resolveSnapshotLocators,
  validateLocatorCatalog
} from "../js/drive-locator-catalog.mjs";

const cryptoImpl = globalThis.crypto || webcrypto;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

test("initial locator catalog binds content hashes to unique physical IDs", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }]
  });
  assert.equal(catalog.format, "finance-tracker-locator-catalog");
  assert.equal(catalog.generation, 0);
  assert.equal(catalog.parentCatalogHash, null);
  assert.deepEqual(catalog.locators, { [HASH_A]: "drive-object-a" });
  assert.equal(validateLocatorCatalog(catalog), catalog);
});

test("copy-on-write catalog extension preserves prior locators and links its parent hash", async () => {
  const first = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }]
  });
  const parentHash = await hashLocatorCatalog(first, cryptoImpl);
  const second = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    previousCatalog: first,
    previousCatalogHash: parentHash,
    additions: [
      { sha256: HASH_B, fileId: "drive-object-b" },
      { sha256: HASH_C, fileId: "drive-object-c" }
    ]
  });
  assert.equal(second.generation, 1);
  assert.equal(second.parentCatalogHash, parentHash);
  assert.deepEqual(second.locators, {
    [HASH_A]: "drive-object-a",
    [HASH_B]: "drive-object-b",
    [HASH_C]: "drive-object-c"
  });
  assert.deepEqual(first.locators, { [HASH_A]: "drive-object-a" }, "the prior immutable catalog is unchanged");
});

test("catalog hashing is deterministic regardless of insertion order", async () => {
  const left = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }, { sha256: HASH_B, fileId: "drive-object-b" }]
  });
  const right = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_B, fileId: "drive-object-b" }, { sha256: HASH_A, fileId: "drive-object-a" }]
  });
  assert.equal(await hashLocatorCatalog(left, cryptoImpl), await hashLocatorCatalog(right, cryptoImpl));
});

test("an existing content hash cannot be rebound to another file ID", () => {
  const first = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }]
  });
  assert.throws(() => createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    previousCatalog: first,
    previousCatalogHash: "d".repeat(64),
    additions: [{ sha256: HASH_A, fileId: "drive-object-a-replacement" }]
  }), { code: "locator-replacement-forbidden" });
});

test("one physical file ID cannot be assigned to different content hashes", () => {
  assert.throws(() => createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [
      { sha256: HASH_A, fileId: "same-drive-id" },
      { sha256: HASH_B, fileId: "same-drive-id" }
    ]
  }), { code: "duplicate-physical-locator" });
});

test("catalogs cannot be reused across logical databases or physical copies", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }]
  });
  assert.throws(() => validateLocatorCatalog(catalog, { databaseId: "other-database" }),
    { code: "locator-catalog-identity-mismatch" });
  assert.throws(() => createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "other-copy",
    previousCatalog: catalog,
    previousCatalogHash: "d".repeat(64)
  }), { code: "locator-catalog-identity-mismatch" });
});

test("snapshot resolution returns per-copy file IDs without modifying logical commit data", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [
      { sha256: HASH_A, fileId: "drive-object-a" },
      { sha256: HASH_B, fileId: "drive-object-b" }
    ]
  });
  const snapshot = { "ledger/one.json": HASH_A, "ledger/two.json": HASH_B };
  const resolved = resolveSnapshotLocators(snapshot, catalog);
  assert.deepEqual(resolved, {
    "ledger/one.json": { sha256: HASH_A, fileId: "drive-object-a" },
    "ledger/two.json": { sha256: HASH_B, fileId: "drive-object-b" }
  });
  assert.deepEqual(snapshot, { "ledger/one.json": HASH_A, "ledger/two.json": HASH_B });
});

test("snapshot resolution fails closed when a hash has no physical locator", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }]
  });
  assert.throws(() => resolveSnapshotLocators({ "ledger/missing.json": HASH_B }, catalog),
    { code: "locator-not-found" });
});

test("malformed catalog entries and unsafe logical paths are rejected", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ sha256: HASH_A, fileId: "drive-object-a" }]
  });
  assert.throws(() => validateLocatorCatalog({ ...catalog, locators: { [HASH_A]: " ", [HASH_B]: "same" } }),
    { code: "invalid-locator-entry" });
  assert.throws(() => resolveSnapshotLocators({ "__proto__": HASH_A }, catalog),
    { code: "invalid-logical-snapshot-entry" });
});
