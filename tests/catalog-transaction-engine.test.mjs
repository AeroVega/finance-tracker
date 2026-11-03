import test from "node:test";
import assert from "node:assert/strict";
import { setupCatalog } from "./helpers/catalog-drive.mjs";
import { CatalogTransactionEngine } from "../js/catalog-transaction-engine.mjs";
import { verifyCatalogHistory, readCatalog, encode } from "../js/catalog-storage.mjs";
import { resolveSnapshotLocators } from "../js/drive-locator-catalog.mjs";

test("catalog engine publishes hash-only logical history and indexes terminal journal events", async () => {
  const { engine, transaction, adapter } = await setupCatalog();
  const result = await engine.transact(transaction);
  const verified = await verifyCatalogHistory(adapter, result.manifest);
  assert.equal(verified.record.version, 2);
  assert.equal(Object.hasOwn(verified.record, "copyId"), false);
  assert.match(verified.record.snapshot["synthetic/ledger.json"], /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.catalogFinalizationPending, null);
  const terminal = [...verified.objects.values()].map((bytes) => {
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  }).filter((value) => value?.eventType === "transaction-committed");
  assert.equal(terminal.length, 1);
  assert.equal(verified.catalog.generation, 2);
});

test("every durable mutation tolerates real page loss and a fresh engine recovery", async (t) => {
  const baseline = await setupCatalog();
  await baseline.engine.transact(baseline.transaction);
  const boundaries = baseline.adapter.mutations;
  assert.equal(boundaries, 14);
  for (let boundary = 1; boundary <= boundaries; boundary++) {
    await t.test("termination after durable mutation " + boundary, async () => {
      const { adapter, engine, transaction, manifestFileId } = await setupCatalog();
      adapter.stopAfter = boundary;
      await assert.rejects(engine.transact(transaction), (error) => error.code === "transaction-unresolved");
      adapter.reboot();
      const fresh = new CatalogTransactionEngine({ adapter, assertWritable: async () => {}, isOnline: () => true });
      const recovered = await fresh.recover({ manifestFileId });
      assert.equal(recovered.manifest.catalogFinalizationPending, null);
      assert.equal(fresh.recoveryRequired, false);
      await verifyCatalogHistory(adapter, recovered.manifest);
      const again = await fresh.recover({ manifestFileId });
      assert.deepEqual(again.manifest, recovered.manifest);
      assert.ok([0, 1].includes(again.manifest.revision));
    });
  }
});

test("retained history survives subsequent writes and identical objects reuse one locator", async () => {
  const { engine, adapter, transaction } = await setupCatalog();
  let result = await engine.transact(transaction);
  const previous = await verifyCatalogHistory(adapter, result.manifest);
  result = await engine.transact({ ...transaction, expectedBase: result.manifest });
  const next = await verifyCatalogHistory(adapter, result.manifest);
  for (const [key, entry] of Object.entries(previous.catalog.entries)) assert.deepEqual(next.catalog.entries[key], entry);
  assert.equal(Object.values(next.catalog.entries).filter((entry) => entry.kind === "data-object").length, 1);
  assert.equal(Object.values(next.catalog.entries).filter((entry) => entry.kind === "commit-record").length, 3);
});

test("recovery itself can be interrupted at each durable repair boundary", async (t) => {
  for (const originalBoundary of [1, 7, 11]) {
    const baseline = await setupCatalog();
    baseline.adapter.stopAfter = originalBoundary;
    await assert.rejects(baseline.engine.transact(baseline.transaction));
    baseline.adapter.reboot();
    baseline.adapter.mutations = 0;
    await baseline.engine.recover({ manifestFileId: baseline.manifestFileId });
    for (let repair = 1; repair <= baseline.adapter.mutations; repair++) {
      await t.test("original boundary " + originalBoundary + ", repair boundary " + repair, async () => {
        const setup = await setupCatalog();
        setup.adapter.stopAfter = originalBoundary;
        await assert.rejects(setup.engine.transact(setup.transaction));
        setup.adapter.reboot();
        setup.adapter.mutations = 0;
        setup.adapter.stopAfter = repair;
        await assert.rejects(setup.engine.recover({ manifestFileId: setup.manifestFileId }));
        setup.adapter.reboot();
        const fresh = new CatalogTransactionEngine({ adapter: setup.adapter, assertWritable: async () => {}, isOnline: () => true });
        const recovered = await fresh.recover({ manifestFileId: setup.manifestFileId });
        assert.equal(recovered.manifest.catalogFinalizationPending, null);
        assert.equal(recovered.manifest.revision, originalBoundary === 1 ? 0 : 1);
        await verifyCatalogHistory(setup.adapter, recovered.manifest);
      });
    }
  }
});

test("corrupt historical objects block reads, recovery, and later transactions", async () => {
  const { engine, adapter, transaction, manifestFileId } = await setupCatalog();
  const first = await engine.transact(transaction);
  const catalog = await readCatalog(adapter, first.manifest);
  const reference = resolveSnapshotLocators(first.manifest.snapshot, catalog)["synthetic/ledger.json"];
  const second = await engine.transact({ ...transaction, expectedBase: first.manifest,
    objects: [{ logicalPath: "synthetic/ledger.json", content: '{"syntheticOnly":true,"value":2}' }] });
  adapter.files.get(reference.fileId).bytes = encode("corrupt");
  await assert.rejects(verifyCatalogHistory(adapter, second.manifest), { code: "immutable-hash-mismatch" });
  await assert.rejects(engine.recover({ manifestFileId }), { code: "immutable-hash-mismatch" });
  await assert.rejects(engine.transact({ ...transaction, expectedBase: second.manifest }), { code: "recovery-required" });
});

test("legacy and backup copies refuse new catalog transactions", async () => {
  const { engine, adapter, transaction, manifestFileId, manifest } = await setupCatalog();
  adapter.files.get(manifestFileId).bytes = encode({ ...manifest, manifestVersion: "1.0.0" });
  await assert.rejects(engine.recover({ manifestFileId }), { code: "catalog-manifest-required" });
});
