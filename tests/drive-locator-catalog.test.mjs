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

test("catalog generations require the correct parent-hash shape", () => {
  const initial = createLocatorCatalog({ databaseId: "synthetic-db", copyId: "synthetic-copy" });
  assert.throws(() => validateLocatorCatalog({ ...initial, generation: 1 }), { code: "invalid-catalog-parent" });
  assert.throws(() => validateLocatorCatalog({ ...initial, parentCatalogHash: HASH_A }), { code: "invalid-catalog-parent" });
});

test("journal transaction and sequence bindings cannot be silently changed", async () => {
  const initial = createLocatorCatalog({ databaseId: "synthetic-db", copyId: "synthetic-copy", additions: [JOURNAL] });
  const hash = await hashLocatorCatalog(initial);
  for (const addition of [{ ...JOURNAL, transactionId: "other-transaction" }, { ...JOURNAL, sequence: 1 }]) {
    assert.throws(() => createLocatorCatalog({ databaseId: initial.databaseId, copyId: initial.copyId,
      previousCatalog: initial, previousCatalogHash: hash, additions: [addition] }), { code: "locator-replacement-forbidden" });
  }
});

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

test("migration and other protocol records are included in the same per-copy index", () => {
  const migration = { kind: "migration-record", identity: "migration-1", sha256: HASH_B, fileId: "drive-migration-1" };
  const protocol = { kind: "protocol-object", identity: "checkpoint-1", sha256: HASH_C, fileId: "drive-checkpoint-1" };
  const catalog = createLocatorCatalog({
    databaseId: "synthetic-database",
    copyId: "synthetic-copy",
    additions: [migration, protocol]
  });
  assert.deepEqual(resolveLocator(catalog, { kind: "migration-record", identity: "migration-1" }), migration);
  assert.deepEqual(resolveLocator(catalog, { kind: "protocol-object", identity: "checkpoint-1" }), protocol);
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

test('snapshot lookup validates the full catalog a bounded number of times, independent of path count', () => {
  let accesses = 0;
  const additions = Array.from({ length: 1000 }, (_, i) => {
    const hash = i.toString(16).padStart(64, '0');
    return { kind: 'data-object', identity: hash, sha256: hash, fileId: 'invented-' + i };
  });
  const catalog = createLocatorCatalog({ databaseId: 'invented-db', copyId: 'invented-copy', additions });
  for (const entry of Object.values(catalog.entries)) {
    const hash = entry.sha256;
    Object.defineProperty(entry, 'sha256', { enumerable: true, get() { accesses++; return hash; } });
  }
  const snapshot = Object.fromEntries(additions.map((entry, i) => ['invented/path-' + i, entry.sha256]));
  const result = resolveSnapshotLocators(snapshot, catalog);
  assert.equal(Object.keys(result).length, 1000);
  assert.ok(accesses <= 6000, 'catalog visits must not multiply by snapshot paths: ' + accesses);
});

test('operation-local resolution owns checked bindings and never trusts a caller cache flag', async () => {
  const { createCatalogResolver } = await import('../js/drive-locator-catalog.mjs');
  const catalog = createLocatorCatalog({ databaseId: 'invented-db', copyId: 'invented-copy', additions: [DATA_A, COMMIT, JOURNAL] });
  const resolver = createCatalogResolver(catalog);
  const selected = resolver.resolve({ kind: 'data-object', identity: HASH_A });
  selected.fileId = 'caller-overwrite';
  catalog.entries['data-object:' + HASH_A].fileId = 'mutated-input';
  assert.equal(resolver.resolve({ kind: 'data-object', identity: HASH_A }).fileId, DATA_A.fileId);
  assert.equal(resolver.resolveSnapshot({ path: HASH_A }).path.fileId, DATA_A.fileId);
  catalog.entries['data-object:' + HASH_A].fileId = '';
  assert.throws(() => createCatalogResolver(catalog), { code: 'invalid-locator-entry' });
  assert.throws(() => resolveSnapshotLocators({ path: HASH_A }, catalog), { code: 'invalid-locator-entry' });
});

test('pinned resolution retains malformed snapshot, missing locator and forbidden identity failures', async () => {
  const { createCatalogResolver } = await import('../js/drive-locator-catalog.mjs');
  const resolver = createCatalogResolver(createLocatorCatalog({ databaseId: 'invented-db', copyId: 'invented-copy', additions: [DATA_A] }));
  assert.throws(() => resolver.resolveSnapshot(null), { code: 'invalid-logical-snapshot' });
  assert.throws(() => resolver.resolveSnapshot({ path: 'bad' }), { code: 'invalid-logical-snapshot-entry' });
  assert.throws(() => resolver.resolveSnapshot({ path: HASH_B }), { code: 'locator-not-found' });
  assert.throws(() => resolver.resolveSnapshot(JSON.parse('{"__proto__":"' + HASH_A + '"}')), { code: 'invalid-logical-snapshot-entry' });
  assert.throws(() => resolver.resolve({ kind: 'commit-record', identity: '__proto__' }), { code: 'invalid-locator-identity' });
});

test('pinned lookup preserves accepted non-enumerable required scalar bindings', async () => {
  const { createCatalogResolver } = await import('../js/drive-locator-catalog.mjs');
  const catalog = createLocatorCatalog({ databaseId: 'invented-db', copyId: 'invented-copy', additions: [DATA_A, JOURNAL] });
  for (const field of ['format', 'version', 'databaseId', 'copyId', 'generation', 'parentCatalogHash']) {
    Object.defineProperty(catalog, field, { enumerable: false });
  }
  for (const entry of Object.values(catalog.entries)) for (const field of Object.keys(entry)) {
    Object.defineProperty(entry, field, { enumerable: false });
  }
  const resolver = createCatalogResolver(catalog);
  assert.deepEqual(resolver.resolveSnapshot({ path: HASH_A }), { path: { sha256: HASH_A, fileId: DATA_A.fileId } });
  assert.equal(resolver.resolve({ kind: 'journal-event', identity: JOURNAL.identity }).transactionId, JOURNAL.transactionId);
});
