import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, summarizeLedger, getEffectiveActivities, applyReviewDecision, reverseReviewDecision } from "../js/canonical-import.mjs";
import { parseProviderCsv } from "../js/provider-csv.mjs";
import { CanonicalLedgerStore, CANONICAL_INDEX, serializeCanonicalLedger, validateCanonicalSnapshot } from "../js/canonical-ledger-storage.mjs";
import { setupCatalog, MemoryCatalogDrive } from "./helpers/catalog-drive.mjs";
import { CatalogTransactionEngine } from "../js/catalog-transaction-engine.mjs";
import { verifyCatalogHistory, readVerified } from "../js/catalog-storage.mjs";
import { resolveSnapshotLocators } from "../js/drive-locator-catalog.mjs";
import { exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from "../js/catalog-backup.mjs";
import { validateSyntheticApplicationSnapshot } from "../js/synthetic-application-structure.mjs";

const now = "2026-11-06T12:00:00.000Z";
const gate = (operation) => operation();
const guard = async () => {};

// The production adapter consumes ApplicationStorageLifecycle. This fixture
// uses the same catalog engine and verified object readers, without OAuth or
// network calls; existing lifecycle/session tests exercise their own boundary.
function lifecycleFor({ adapter, manifestFileId, engine }) {
  return {
    manifestFileId,
    async readManifest() {
      const manifest = await adapter.readJson(manifestFileId);
      await verifyCatalogHistory(adapter, manifest);
      return manifest;
    },
    async readObject(path) {
      const manifest = await this.readManifest();
      const { catalog } = await verifyCatalogHistory(adapter, manifest);
      const reference = resolveSnapshotLocators(manifest.snapshot, catalog)[path];
      if (!reference) throw Object.assign(new Error("Missing logical object"), { code: "object-not-found" });
      return readVerified(adapter, { ...reference, kind: "snapshot-object" });
    },
    transact: (transaction) => engine.transact(transaction)
  };
}

async function importedLedger() {
  let ledger = createLedger({ now });
  ledger = registerAccount(ledger, { institutionId: "wells-fargo", name: "Invented checking", currency: "USD", accountType: "checking" }, { now });
  const accountId = ledger.accounts[0].accountId;
  const bytes = await readFile(new URL("../fixtures/wells-fargo.csv", import.meta.url));
  const parsed = await parseProviderCsv({ bytes, sourceFormat: "wells-fargo-csv-v1" });
  ledger = prepareCanonicalImport(ledger, { parsed, accountMappings: { default: accountId },
    coverageByAccount: { [accountId]: { start: "2026-01-01", end: "2026-01-31", provenance: "user-confirmed" } }, syntheticOnly: true }, { now }).ledger;
  for (const [i, activity] of ledger.activities.entries()) {
    ledger = applyFinancialEvent(ledger, { type: "classification", commandId: "invented-classification-" + i,
      activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? "spending" : "income", categoryId: "invented-category" }, { now });
  }
  return ledger;
}

test("canonical data uses existing commits, partitions records, and reopens without changing financial meaning", async () => {
  const setup = await setupCatalog();
  const lifecycle = lifecycleFor(setup);
  const store = new CanonicalLedgerStore({ lifecycle });
  assert.equal(await store.load(), null);
  const ledger = await importedLedger();
  assert.deepEqual(await store.save(ledger), ledger);
  const manifest = await lifecycle.readManifest();
  assert.equal(manifest.revision, 1);
  assert.ok(Object.keys(manifest.snapshot).length > 6);
  assert.ok(Object.hasOwn(manifest.snapshot, CANONICAL_INDEX));
  const reopened = new CanonicalLedgerStore({ lifecycle });
  const actual = await reopened.load();
  assert.deepEqual(actual, ledger);
  assert.deepEqual(summarizeLedger(actual, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }),
    summarizeLedger(ledger, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }));
  const mutations = setup.adapter.mutations;
  await reopened.save(actual);
  assert.equal(setup.adapter.mutations, mutations, "unchanged save is not another financial commit");
});

test("stale reviews and uncertain saves cannot silently overwrite newer canonical data", async () => {
  const setup = await setupCatalog();
  const lifecycle = lifecycleFor(setup);
  const first = new CanonicalLedgerStore({ lifecycle });
  const stale = new CanonicalLedgerStore({ lifecycle });
  await first.load(); await stale.load();
  const ledger = await importedLedger();
  await first.save(ledger);
  await assert.rejects(stale.save(ledger), { code: "base-conflict" });
  await assert.rejects(stale.save(ledger), { code: "verified-base-required" });
  const current = await first.load();
  const corrected = applyFinancialEvent(current, { type: "bank-correction", commandId: "invented-correction",
    activityId: current.activities[0].activityId, amountText: "-10.00", evidence: "Invented bank correction evidence" }, { now });
  const baseline = setup.adapter.mutations;
  setup.adapter.stopAfter = baseline + 1;
  await assert.rejects(first.save(corrected), { code: "transaction-unresolved" });
  await assert.rejects(first.save(corrected), { code: "verified-base-required" });
});

test("category rules and unresolved retries survive canonical object ordering and reopen", async () => {
  const setup = await setupCatalog();
  const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
  await store.load();
  let ledger = await importedLedger();
  ledger = applyFinancialEvent(ledger, { type: "category-correction", commandId: "invented-category-correction",
    activityId: ledger.activities[0].activityId, categoryId: "invented-food" }, { now });
  await store.save(ledger);
  ledger = await store.load();
  assert.equal(getEffectiveActivities(ledger)[0].categoryId, "invented-food");
  const parsed = await parseProviderCsv({ bytes: await readFile(new URL("../fixtures/pr28/wells-fargo-review.csv", import.meta.url)), sourceFormat: "wells-fargo-csv-v1" });
  const accountId = ledger.accounts[0].accountId;
  const input = { parsed, accountMappings: { default: accountId }, coverageByAccount: {
    [accountId]: { start: "2026-01-01", end: "2026-01-31", provenance: "user-confirmed" } }, syntheticOnly: true };
  ledger = prepareCanonicalImport(ledger, input, { now }).ledger;
  await store.save(ledger);
  const reopened = await store.load();
  assert.equal(reopened.imports[1].status, "needs-review");
  const retried = prepareCanonicalImport(reopened, input, { now }).ledger;
  assert.deepEqual(retried.activities.map(record => record.activityId), reopened.activities.map(record => record.activityId));
  assert.equal(retried.imports[1].retryAttempts.length, 1);
  await store.save(retried);
  assert.deepEqual(await store.load(), retried);
  const changedRetry = structuredClone(retried);
  changedRetry.imports[1].retryAttempts[0].completedAt = "2026-11-07T12:00:00.000Z";
  await assert.rejects(store.save(changedRetry), { code: "retry-history-rewrite-refused" });
});

test("saved source evidence, activities, and audit events cannot be removed or rewritten", async () => {
  const setup = await setupCatalog();
  const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
  await store.load();
  const ledger = await importedLedger();
  await store.save(ledger);
  const removed = structuredClone(ledger); removed.events = [];
  await assert.rejects(store.save(removed), { code: "history-order-change-refused" });
  const reordered = structuredClone(ledger); reordered.events.reverse();
  await assert.rejects(store.save(reordered), { code: "history-order-change-refused" });
  const rewritten = structuredClone(ledger); rewritten.activities[0].sourceDescription = "Different source";
  await assert.rejects(store.save(rewritten), { code: "history-rewrite-refused" });
  const evidence = structuredClone(ledger); evidence.observations[0].sourceFields.DESCRIPTION = "Different source";
  await assert.rejects(store.save(evidence), { code: "source-evidence-rewrite-refused" });
  const normalized = structuredClone(ledger); normalized.observations[0].candidate.sourceDescription = "Different normalization";
  await assert.rejects(store.save(normalized), { code: "source-evidence-rewrite-refused" });
  const metadata = structuredClone(ledger); metadata.createdAt = "2026-11-07T12:00:00.000Z";
  await assert.rejects(store.save(metadata), { code: "ledger-metadata-rewrite-refused" });
  const retention = structuredClone(ledger); retention.imports[0].sourceFileRetentionStatus = "retained";
  await assert.rejects(store.save(retention), /retention/);
  const complete = structuredClone(ledger); complete.imports[0].coverageReconciled = true;
  await assert.rejects(store.save(complete), /completeness/);
  const production = structuredClone(ledger); production.syntheticOnly = false;
  assert.throws(() => serializeCanonicalLedger(production));
});

test("full review, reversal, prospective rule, correction, and refund history survives save, export, and restore", async () => {
  const setup = await setupCatalog();
  const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
  await store.load();
  let ledger = registerAccount(createLedger({ now }), { institutionId: "wells-fargo", displayName: "Invented full-flow checking", currency: "USD", accountType: "checking" }, { now });
  const accountId = ledger.accounts[0].accountId;
  const input = parsed => ({ parsed, syntheticOnly: true, accountMappings: { default: accountId }, coverageByAccount: {
    [accountId]: { start: "2026-01-01", end: "2026-01-31", provenance: "user-confirmed" } } });
  const parseFixture = async name => parseProviderCsv({ bytes: await readFile(new URL("../fixtures/pr28/" + name, import.meta.url)), sourceFormat: "wells-fargo-csv-v1" });
  ledger = prepareCanonicalImport(ledger, input(await parseFixture("wells-fargo-foundation.csv")), { now }).ledger;
  for (const activity of ledger.activities) ledger = applyFinancialEvent(ledger, { type: "classification", commandId: "classify-" + activity.activityId,
    activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? "spending" : "income", categoryId: "invented-default" }, { now });
  const marketId = ledger.activities[0].activityId;
  ledger = applyFinancialEvent(ledger, { type: "category-correction", commandId: "learn-invented-coffee", activityId: ledger.activities[2].activityId, categoryId: "invented-coffee" }, { now });
  ledger = await store.save(ledger);
  const reviewInput = input(await parseFixture("wells-fargo-review.csv"));
  ledger = prepareCanonicalImport(ledger, reviewInput, { now }).ledger;
  ledger = await store.save(ledger);
  ledger = prepareCanonicalImport(await store.load(), reviewInput, { now }).ledger;
  const overlapId = ledger.observations.find(o => o.disposition === "review").observationId;
  ledger = applyReviewDecision(ledger, { observationId: overlapId, action: "keep-separate", rationale: "Invented temporary split" }, { now });
  ledger = await store.save(ledger);
  const splitId = ledger.reviewDecisions.at(-1).activityId;
  ledger = reverseReviewDecision(ledger, { reviewDecisionId: ledger.reviewDecisions.at(-1).reviewDecisionId, rationale: "Invented evidence establishes overlap" }, { now });
  ledger = await store.save(ledger);
  assert.equal(getEffectiveActivities(ledger).find(a => a.activityId === splitId).active, false);
  ledger = applyReviewDecision(ledger, { observationId: overlapId, action: "match", activityId: marketId, rationale: "Same invented market receipt" }, { now });
  ledger = applyReviewDecision(ledger, { observationId: ledger.observations.find(o => o.disposition === "rejected" && !o.resolved).observationId,
    action: "reject", rationale: "Invented malformed amount retained" }, { now });
  const refundId = ledger.activities.find(a => a.sourceDescription.includes("PARTIAL REFUND")).activityId;
  ledger = applyFinancialEvent(ledger, { type: "refund-link", commandId: "link-invented-refund", activityId: refundId, originalActivityId: marketId,
    confirmedPostedDate: "2026-02-02", evidence: { receipt: "Invented refund receipt with February posting date" } }, { now });
  ledger = await store.save(ledger);
  assert.equal(getEffectiveActivities(ledger).find(a => a.activityId === refundId).categoryId, "invented-default");
  ledger = applyFinancialEvent(ledger, { type: "category-correction", commandId: "correct-market-category", activityId: marketId, categoryId: "invented-market" }, { now });
  ledger = await store.save(ledger);
  assert.equal(getEffectiveActivities(ledger).find(a => a.activityId === refundId).categoryId, "invented-market");
  ledger = applyFinancialEvent(ledger, { type: "category-correction", commandId: "explicit-refund-category", activityId: refundId, categoryId: "invented-refund-override" }, { now });
  ledger = applyFinancialEvent(ledger, { type: "category-correction", commandId: "later-market-category", activityId: marketId, categoryId: "invented-market-final" }, { now });
  ledger = applyFinancialEvent(ledger, { type: "bank-correction", commandId: "correct-invented-market", activityId: marketId,
    amountText: "-90.00", evidence: { receipt: "Invented bank correction" } }, { now });
  const future = await parseProviderCsv({ sourceFormat: "wells-fargo-csv-v1", bytes: new TextEncoder().encode("DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\n01/20/2026,INVENTED COFFEE PURCHASE,-6.00,,Posted\n") });
  ledger = prepareCanonicalImport(ledger, input(future), { now }).ledger;
  const futureId = ledger.activities.at(-1).activityId;
  assert.equal(getEffectiveActivities(ledger).at(-1).categoryId, "invented-coffee");
  ledger = applyFinancialEvent(ledger, { type: "classification", commandId: "classify-future-coffee", activityId: futureId, activityKind: "spending", categoryId: null }, { now });
  ledger = await store.save(ledger);
  assert.deepEqual(await store.load(), ledger);
  assert.equal(summarizeLedger(ledger, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }).spending, "106.00");
  assert.equal(summarizeLedger(ledger, { start: "2026-02-01", end: "2026-02-28", currency: "USD" }).spending, "-40.00");
  const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId,
    withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now });
  const targetAdapter = new MemoryCatalogDrive("invented-full-flow-restore");
  const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure: validateSyntheticApplicationSnapshot });
  const engine = new CatalogTransactionEngine({ adapter: targetAdapter, assertWritable: guard, isOnline: () => true });
  const target = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ adapter: targetAdapter, engine, manifestFileId: restored.manifestFileId }) });
  assert.deepEqual(await target.load(), ledger);
  assert.equal(getEffectiveActivities(await target.load()).find(a => a.activityId === futureId).categoryId, "invented-coffee");
  assert.equal(getEffectiveActivities(await target.load()).find(a => a.activityId === refundId).categoryId, "invented-refund-override");
});

test("every durable boundary recovers either the entire canonical import or the unchanged previous state", async (t) => {
  const ledger = await importedLedger();
  const baseline = await setupCatalog();
  const baseStore = new CanonicalLedgerStore({ lifecycle: lifecycleFor(baseline) });
  await baseStore.load(); await baseStore.save(ledger);
  const boundaries = baseline.adapter.mutations;
  assert.ok(boundaries > 14, "per-record objects exercise the existing multi-object protocol");
  for (let boundary = 1; boundary <= boundaries; boundary++) {
    await t.test("canonical import termination after mutation " + boundary, async () => {
      const setup = await setupCatalog();
      const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
      await store.load();
      setup.adapter.stopAfter = boundary;
      await assert.rejects(store.save(ledger), { code: "transaction-unresolved" });
      setup.adapter.reboot();
      const engine = new CatalogTransactionEngine({ adapter: setup.adapter, assertWritable: guard, isOnline: () => true });
      await engine.recover({ manifestFileId: setup.manifestFileId });
      const fresh = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ ...setup, engine }) });
      const recovered = await fresh.load();
      if (recovered !== null) assert.deepEqual(recovered, ledger);
      if (recovered === null) await fresh.save(ledger);
      assert.deepEqual(await fresh.load(), ledger);
      const mutations = setup.adapter.mutations;
      await fresh.save(ledger);
      assert.equal(setup.adapter.mutations, mutations);
    });
  }
});

test("existing portable export and restore preserve canonical records, events, and qualified totals", async () => {
  const setup = await setupCatalog();
  const dashboardPath = "synthetic/dashboard-transactions.json";
  const dashboard = { format: "finance-tracker-dashboard-snapshot", syntheticOnly: true,
    transactions: [{ id: "invented-backup", date: "2026-01-01", description: "Invented coexisting dashboard", amount: 1, syntheticOnly: true }] };
  await setup.engine.transact({ manifestFileId: setup.manifestFileId, expectedBase: await setup.adapter.readJson(setup.manifestFileId),
    transactionId: crypto.randomUUID(), objects: [{ logicalPath: dashboardPath, content: JSON.stringify(dashboard) }],
    commitRecord: { operationType: "synthetic-dashboard", schemaVersion: 1 } });
  const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
  await store.load();
  const ledger = await importedLedger();
  await store.save(ledger);
  const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId,
    withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now });
  await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
  const targetAdapter = new MemoryCatalogDrive("invented-canonical-restore");
  const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate,
    assertTargetWritable: guard, validateStructure: validateSyntheticApplicationSnapshot });
  const engine = new CatalogTransactionEngine({ adapter: targetAdapter, assertWritable: guard, isOnline: () => true });
  const target = new CanonicalLedgerStore({ lifecycle: lifecycleFor({ adapter: targetAdapter, engine, manifestFileId: restored.manifestFileId }) });
  assert.deepEqual(await target.load(), ledger);
  assert.notEqual(restored.manifest.copyId, archive.sourceCopyId);
  assert.equal(restored.manifest.commitId, archive.manifest.commitId);
  const restoredLifecycle = lifecycleFor({ adapter: targetAdapter, engine, manifestFileId: restored.manifestFileId });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await restoredLifecycle.readObject(dashboardPath))), dashboard);
  const objects = Object.fromEntries([...serializeCanonicalLedger(ledger)].map(([path, value]) => [path, new TextEncoder().encode(value)]));
  delete objects[Object.keys(objects).find((path) => path.includes("/activities/"))];
  assert.throws(() => validateCanonicalSnapshot({ objects }), { code: "canonical-record-missing" });
});
