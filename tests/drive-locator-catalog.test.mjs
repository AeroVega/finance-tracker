import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createLocatorCatalog,
  hashLocatorCatalog,
  locatorKey,
  resolveLocator,
  resolveSnapshotLocators,
  validateLocatorCatalog
} from "../js/drive-locator-catalog.mjs";

const cryptoImpl = globalThis.crypto || webcrypto;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const DATA_A = { kind: "data-object", identity: HASH_A, sha256: HASH_A, fileId: "drive-object-a" };
const COMMIT = { kind: "commit-record", identity: "commit-a", sha256: HASH_B, fileId: "drive-commit-a" };
const JOURNAL = {
  kind: "journal-event", identity: "event-a", sha256: HASH_C, fileId: "drive-event-a",
  transactionId: "transaction-a", sequence: 0
};

test("initial locator catalog binds data, commit, and journal objects to unique physical IDs", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A, COMMIT, JOURNAL]
  });
  assert.equal(catalog.format, "finance-tracker-locator-catalog");
  assert.equal(catalog.generation, 0);
  assert.equal(catalog.parentCatalogHash, null);
  assert.deepEqual(catalog.entries[locatorKey("data-object", HASH_A)], DATA_A);
  assert.deepEqual(catalog.entries[locatorKey("commit-record", "commit-a")], COMMIT);
  assert.deepEqual(catalog.entries[locatorKey("journal-event", "event-a")], JOURNAL);
  assert.equal(validateLocatorCatalog(catalog), catalog);
});

test("copy-on-write catalog extension preserves prior locators and links its parent hash", async () => {
  const first = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A]
  });
  const parentHash = await hashLocatorCatalog(first, cryptoImpl);
  const second = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    previousCatalog: first,
    previousCatalogHash: parentHash,
    additions: [COMMIT, JOURNAL]
  });
  assert.equal(second.generation, 1);
  assert.equal(second.parentCatalogHash, parentHash);
  assert.deepEqual(second.entries[locatorKey("data-object", HASH_A)], DATA_A);
  assert.deepEqual(second.entries[locatorKey("commit-record", "commit-a")], COMMIT);
  assert.deepEqual(second.entries[locatorKey("journal-event", "event-a")], JOURNAL);
  assert.deepEqual(Object.keys(first.entries), [locatorKey("data-object", HASH_A)], "the prior immutable catalog is unchanged");
});

test("catalog hashing is deterministic regardless of insertion order", async () => {
  const left = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A, COMMIT]
  });
  const right = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [COMMIT, DATA_A]
  });
  assert.equal(await hashLocatorCatalog(left, cryptoImpl), await hashLocatorCatalog(right, cryptoImpl));
});

test("an existing immutable-object identity cannot be rebound to another file ID", () => {
  const first = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A]
  });
  assert.throws(() => createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    previousCatalog: first,
    previousCatalogHash: "d".repeat(64),
    additions: [{ ...DATA_A, fileId: "drive-object-a-replacement" }]
  }), { code: "locator-replacement-forbidden" });
});

test("one physical file ID cannot be assigned to different immutable objects", () => {
  assert.throws(() => createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [
      DATA_A,
      { kind: "data-object", identity: HASH_B, sha256: HASH_B, fileId: DATA_A.fileId }
    ]
  }), { code: "duplicate-physical-locator" });
});

test("catalogs cannot be reused across logical databases or physical copies", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A]
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
    additions: [DATA_A, { kind: "data-object", identity: HASH_B, sha256: HASH_B, fileId: "drive-object-b" }]
  });
  const snapshot = { "ledger/one.json": HASH_A, "ledger/two.json": HASH_B };
  const resolved = resolveSnapshotLocators(snapshot, catalog);
  assert.deepEqual(resolved, {
    "ledger/one.json": { sha256: HASH_A, fileId: "drive-object-a" },
    "ledger/two.json": { sha256: HASH_B, fileId: "drive-object-b" }
  });
  assert.deepEqual(snapshot, { "ledger/one.json": HASH_A, "ledger/two.json": HASH_B });
});

test("all immutable protocol object classes can be resolved independently", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A, COMMIT, JOURNAL]
  });
  assert.equal(resolveLocator(catalog, { kind: "commit-record", identity: "commit-a" }).fileId, "drive-commit-a");
  assert.equal(resolveLocator(catalog, { kind: "journal-event", identity: "event-a" }).fileId, "drive-event-a");
  assert.throws(() => resolveLocator(catalog, { kind: "migration-record", identity: "missing" }),
    { code: "locator-not-found" });
});

test("snapshot resolution fails closed when a hash has no physical locator", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A]
  });
  assert.throws(() => resolveSnapshotLocators({ "ledger/missing.json": HASH_B }, catalog),
    { code: "locator-not-found" });
});

test("malformed catalog entries, journal locators, and unsafe logical paths are rejected", () => {
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [DATA_A]
  });
  assert.throws(() => validateLocatorCatalog({
    ...catalog,
    entries: { [locatorKey("data-object", HASH_A)]: { ...DATA_A, fileId: " " } }
  }), { code: "invalid-locator-entry" });
  assert.throws(() => createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [{ ...JOURNAL, sequence: -1 }]
  }), { code: "invalid-journal-locator" });
  const unsafeSnapshot = JSON.parse('{"__proto__":"' + HASH_A + '"}');
  assert.throws(() => resolveSnapshotLocators(unsafeSnapshot, catalog),
    { code: "invalid-logical-snapshot-entry" });
});
