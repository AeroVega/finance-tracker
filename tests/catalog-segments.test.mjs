import test from "node:test";
import assert from "node:assert/strict";
import { setupCatalog, MemoryCatalogDrive } from "./helpers/catalog-drive.mjs";
import { createLocatorCatalog } from "../js/drive-locator-catalog.mjs";
import { readCatalog, writeCatalog, writeVerified, encode, hashRaw, verifyCatalogHistory } from "../js/catalog-storage.mjs";
import { CATALOG_SEGMENT_BYTES, CATALOG_SEGMENT_ENTRIES, CATALOG_ROOT_BYTES } from "../js/catalog-segments.mjs";

const guard = async () => {};
const addition = index => ({ kind: "protocol-object", identity: "invented-object-" + index,
  fileId: "invented-file-" + index, sha256: "a".repeat(64) });
const catalogFiles = adapter => [...adapter.files.values()].filter(file => file.metadata.appProperties.financeTrackerKind.startsWith("locator-catalog"));
async function changedRoot(h, edit) {
  const root = await h.adapter.readJson(h.manifest.locatorCatalog.fileId);
  await edit(root);
  const pointer = await writeVerified(h.adapter, { content: root, kind: "locator-catalog", transactionId: "invented-test" }, guard);
  return { ...h.manifest, locatorCatalog: pointer };
}

test("new writes use bounded immutable segments and reuse every previous segment", async () => {
  const h = await setupCatalog(), previous = await readCatalog(h.adapter, h.manifest);
  const oldFiles = new Map(catalogFiles(h.adapter).map(file => [file.metadata.id, file.bytes.slice()]));
  const additions = Array.from({ length: 300 }, (_, index) => addition(index));
  const next = await writeCatalog(h.adapter, { manifest: h.manifest, previousCatalog: previous, additions }, guard);
  const manifest = { ...h.manifest, locatorCatalog: next.pointer };
  const root = await h.adapter.readJson(next.pointer.fileId);
  assert.equal(root.version, 2);
  assert.equal(root.segmentCount, 4);
  assert.equal(root.parentCatalogHash, h.manifest.locatorCatalog.sha256);
  assert.equal(Object.hasOwn(root, "entries"), false);
  assert.ok(encode(root).byteLength <= CATALOG_ROOT_BYTES);
  for (const [id, bytes] of oldFiles) assert.deepEqual(h.adapter.files.get(id).bytes, bytes);
  for (const file of catalogFiles(h.adapter).filter(file => file.metadata.appProperties.financeTrackerKind === "locator-catalog-segment")) {
    assert.ok(file.bytes.byteLength <= CATALOG_SEGMENT_BYTES);
    assert.ok(Object.keys(JSON.parse(new TextDecoder().decode(file.bytes)).entries).length <= CATALOG_SEGMENT_ENTRIES);
  }
  assert.deepEqual(await readCatalog(h.adapter, manifest), next.catalog);
  const before = h.adapter.mutations;
  const unchanged = await writeCatalog(h.adapter, { manifest, previousCatalog: next.catalog, additions }, guard);
  assert.deepEqual(unchanged.pointer, next.pointer);
  assert.equal(h.adapter.mutations, before, "identical bindings reuse the exact generation");
});

test("legacy v1 reads stay unchanged and the first explicit update retains its exact base", async () => {
  const h = await setupCatalog(), materialized = await readCatalog(h.adapter, h.manifest);
  const legacy = createLocatorCatalog({ databaseId: h.manifest.databaseId, copyId: h.manifest.copyId, additions: Object.values(materialized.entries) });
  const pointer = await writeVerified(h.adapter, { content: legacy, kind: "locator-catalog", transactionId: "invented-legacy" }, guard);
  const manifest = { ...h.manifest, locatorCatalog: pointer }, before = h.adapter.mutations;
  const read = await readCatalog(h.adapter, manifest);
  assert.equal(h.adapter.mutations, before, "reads do not migrate");
  const next = await writeCatalog(h.adapter, { manifest, previousCatalog: read, additions: [addition(1)] }, guard);
  const root = await h.adapter.readJson(next.pointer.fileId);
  assert.deepEqual(root.legacyCatalog, pointer);
  assert.deepEqual(encode(await h.adapter.readJson(pointer.fileId)), encode(legacy));
  const reopened = await readCatalog(h.adapter, { ...manifest, locatorCatalog: next.pointer });
  for (const [key, entry] of Object.entries(legacy.entries)) assert.deepEqual(reopened.entries[key], entry);
  assert.equal(reopened.generation, 1);
});

test("write validation rejects rebinding, cross-copy or altered materialized prefixes before mutation", async () => {
  const h = await setupCatalog(), catalog = await readCatalog(h.adapter, h.manifest);
  const existing = Object.values(catalog.entries)[0], before = h.adapter.mutations;
  await assert.rejects(writeCatalog(h.adapter, { manifest: h.manifest, previousCatalog: catalog,
    additions: [{ ...existing, fileId: "invented-rebound" }] }, guard), { code: "locator-replacement-forbidden" });
  await assert.rejects(writeCatalog(h.adapter, { manifest: { ...h.manifest, copyId: "invented-other-copy" }, previousCatalog: catalog,
    additions: [addition(1)] }, guard), { code: "locator-catalog-identity-mismatch" });
  await assert.rejects(writeCatalog(h.adapter, { manifest: { ...h.manifest, locatorCatalog: { ...h.manifest.locatorCatalog, fileId: "invented-other-root" } },
    previousCatalog: catalog, additions: [addition(1)] }, guard), { code: "catalog-base-mismatch" });
  existing.fileId = "invented-altered";
  await assert.rejects(writeCatalog(h.adapter, { manifest: h.manifest, previousCatalog: catalog, additions: [addition(1)] }, guard), { code: "catalog-base-mismatch" });
  assert.equal(h.adapter.mutations, before);
});

test("segment bytes, folder, kind, sequence, generation and declared counts fail closed", async t => {
  for (const type of ["bytes", "folder", "kind", "sequence", "generation", "entryCount", "segmentCount", "copyId", "missing"]) await t.test(type, async () => {
    const h = await setupCatalog(), root = await h.adapter.readJson(h.manifest.locatorCatalog.fileId);
    const file = h.adapter.files.get(root.segmentTip.fileId);
    if (type === "bytes") file.bytes[0] ^= 1;
    if (type === "folder") file.metadata.parents = ["invented-other-folder"];
    if (type === "kind") file.metadata.appProperties.financeTrackerKind = "data-object";
    if (type === "missing") h.adapter.files.delete(root.segmentTip.fileId);
    if (["sequence", "generation", "copyId"].includes(type)) {
      const segment = await h.adapter.readJson(root.segmentTip.fileId);
      if (type === "copyId") segment.copyId = "invented-foreign-copy";
      else segment[type]++;
      h.manifest = await changedRoot(h, async value => {
        value.segmentTip = await writeVerified(h.adapter, { content: segment, kind: "locator-catalog-segment", transactionId: "invented-test" }, guard);
      });
    }
    if (["entryCount", "segmentCount"].includes(type)) h.manifest = await changedRoot(h, value => { value[type]++; });
    await assert.rejects(readCatalog(h.adapter, h.manifest));
  });
});

test("a correctly hashed segment cannot repeat a binding or physical ID from its prefix", async t => {
  for (const type of ["identity", "physical"]) await t.test(type, async () => {
    const h = await setupCatalog(), catalog = await readCatalog(h.adapter, h.manifest);
    const existing = Object.values(catalog.entries)[0];
    const entry = type === "identity" ? existing : { ...addition(1), fileId: existing.fileId };
    h.manifest = await changedRoot(h, async root => {
      const segment = { format: "finance-tracker-locator-segment", version: 1, databaseId: root.databaseId, copyId: root.copyId,
        generation: root.generation + 1, sequence: root.segmentCount, previousSegment: root.segmentTip,
        entries: { [entry.kind + ":" + entry.identity]: entry } };
      root.segmentTip = await writeVerified(h.adapter, { content: segment, kind: "locator-catalog-segment", transactionId: "invented-test" }, guard);
      root.generation++; root.segmentCount++; root.entryCount++; root.parentCatalogHash = h.manifest.locatorCatalog.sha256;
    });
    await assert.rejects(readCatalog(h.adapter, h.manifest), { code: type === "identity" ? "duplicate-catalog-binding" : "duplicate-physical-locator" });
  });
});

test("interrupted multi-segment writes never publish or remove the old authoritative catalog", async t => {
  for (const boundary of [1, 2, 3, 4]) await t.test("segment/root write " + boundary, async () => {
    const h = await setupCatalog(), previous = await readCatalog(h.adapter, h.manifest), oldIds = [...h.adapter.files.keys()];
    h.adapter.stopAfter = boundary;
    await assert.rejects(writeCatalog(h.adapter, { manifest: h.manifest, previousCatalog: previous,
      additions: Array.from({ length: 300 }, (_, index) => addition(index)) }, guard));
    h.adapter.reboot();
    assert.deepEqual(await h.adapter.readJson(h.manifestFileId), h.manifest);
    assert.deepEqual(await readCatalog(h.adapter, h.manifest), previous);
    for (const id of oldIds) assert.ok(h.adapter.files.has(id));
    assert.ok(h.adapter.files.size > oldIds.length, "unpublished immutable evidence is preserved");
  });
});

test("segment byte limits split large locators without imposing a total catalog cap", async () => {
  const h = await setupCatalog(), catalog = await readCatalog(h.adapter, h.manifest);
  const additions = Array.from({ length: 160 }, (_, index) => ({ ...addition(index), fileId: "x".repeat(2000) + index }));
  const next = await writeCatalog(h.adapter, { manifest: h.manifest, previousCatalog: catalog, additions }, guard);
  const root = await h.adapter.readJson(next.pointer.fileId);
  assert.ok(root.segmentCount > 3, "the byte bound splits before the entry bound");
  assert.equal(Object.keys((await readCatalog(h.adapter, { ...h.manifest, locatorCatalog: next.pointer })).entries).length, 161);
  const before = h.adapter.mutations;
  await assert.rejects(writeCatalog(h.adapter, { manifest: { ...h.manifest, locatorCatalog: next.pointer }, previousCatalog: next.catalog,
    additions: [{ ...addition(999), fileId: "x".repeat(CATALOG_SEGMENT_BYTES) }] }, guard), { code: "catalog-segment-limit" });
  assert.equal(h.adapter.mutations, before);
});

test("bounded-payload history verification discards data bytes but still checks corruption and complete ancestry", async () => {
  const h = await setupCatalog();
  const result = await h.engine.transact(h.transaction);
  const full = await verifyCatalogHistory(h.adapter, result.manifest);
  const reduced = await verifyCatalogHistory(h.adapter, result.manifest, globalThis.crypto, { retainDataObjects: false });
  assert.deepEqual(reduced.record, full.record);
  assert.deepEqual(reduced.catalog, full.catalog);
  assert.ok([...reduced.objects.keys()].every(key => !key.startsWith("data-object:")));
  assert.ok([...reduced.objects.keys()].some(key => key.startsWith("journal-event:")));
  const data = Object.values(full.catalog.entries).find(entry => entry.kind === "data-object");
  h.adapter.files.get(data.fileId).bytes[0] ^= 1;
  await assert.rejects(verifyCatalogHistory(h.adapter, result.manifest, globalThis.crypto, { retainDataObjects: false }), { code: "immutable-hash-mismatch" });
});

test("one binding writes bounded bytes as retained catalog size grows", async t => {
  const measurements = [];
  for (const retained of [10, 100, 1000]) {
    const adapter = new MemoryCatalogDrive("invented-growth-folder");
    let manifest = { syntheticOnly: true, databaseId: "invented-database", copyId: "invented-copy", catalogFinalizationPending: null };
    const initial = await writeCatalog(adapter, { manifest, additions: Array.from({ length: retained }, (_, index) => addition(index)) }, guard);
    manifest = { ...manifest, locatorCatalog: initial.pointer };
    const before = new Set(adapter.files.keys());
    const next = await writeCatalog(adapter, { manifest, previousCatalog: initial.catalog, additions: [addition(retained)] }, guard);
    const bytes = [...adapter.files].filter(([id]) => !before.has(id)).reduce((sum, [, file]) => sum + file.bytes.byteLength, 0);
    measurements.push({ retained, segmentedBytes: bytes, legacyWholeCatalogBytes: encode(next.catalog).byteLength });
    assert.ok(bytes < 1500);
  }
  assert.ok(measurements.at(-1).legacyWholeCatalogBytes > measurements[0].legacyWholeCatalogBytes * 50);
  assert.ok(Math.max(...measurements.map(row => row.segmentedBytes)) - Math.min(...measurements.map(row => row.segmentedBytes)) < 100);
  t.diagnostic(JSON.stringify(measurements));
});

test("a long segment chain opens iteratively without a total-history segment ceiling", async () => {
  const h = await setupCatalog();
  h.manifest = await changedRoot(h, async root => {
    for (let index = 0; index < 1500; index++) {
      const entry = addition(index);
      const segment = { format: "finance-tracker-locator-segment", version: 1,
        databaseId: root.databaseId, copyId: root.copyId, generation: 0,
        sequence: root.segmentCount, previousSegment: root.segmentTip,
        entries: { [entry.kind + ":" + entry.identity]: entry } };
      root.segmentTip = await writeVerified(h.adapter, { content: segment, kind: "locator-catalog-segment", transactionId: "invented-long-chain" }, guard);
      root.segmentCount++; root.entryCount++;
    }
  });
  const reopened = await readCatalog(h.adapter, h.manifest);
  assert.equal(Object.keys(reopened.entries).length, 1501);
  assert.deepEqual(reopened.entries["protocol-object:invented-object-1499"], addition(1499));
});
