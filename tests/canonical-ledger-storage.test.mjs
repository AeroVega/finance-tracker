import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent, summarizeLedger, getEffectiveActivities, applyReviewDecision, reverseReviewDecision} from '../js/canonical-import.mjs';
import {parseProviderCsv} from '../js/provider-csv.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {createPagedFixture} from './helpers/paged-canonical-fixture.mjs';
const now = '2026-11-06T12:00:00.000Z';

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
  const setup = await createPagedFixture();
  const lifecycle = setup.lifecycle;
  const store = new CanonicalLedgerStore({ lifecycle });
  assert.equal(await store.load(), null);
  const ledger = await importedLedger();
  assert.deepEqual(await store.save(ledger), ledger);
  const manifest = await lifecycle.readManifest();
  assert.equal(manifest.revision, '1');
  assert.equal(JSON.parse(new TextDecoder().decode(setup.objects.get(manifest.root))).version, 5);
  const reopened = new CanonicalLedgerStore({ lifecycle });
  const actual = await reopened.load();
  assert.deepEqual(actual, ledger);
  assert.deepEqual(summarizeLedger(actual, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }),
    summarizeLedger(ledger, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }));
  const mutations = setup.commits.length;
  await reopened.save(actual);
  assert.equal(setup.commits.length, mutations, "unchanged save is not another financial commit");
});

test("stale reviews and uncertain saves cannot silently overwrite newer canonical data", async () => {
  const setup = await createPagedFixture();
  const lifecycle = setup.lifecycle;
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
  const baseline = setup.commits.length;
  lifecycle.savePartitionedRoot = async () => { throw Object.assign(new Error('uncertain write'), {code:'transaction-unresolved'}); };
  await assert.rejects(first.save(corrected), { code: "transaction-unresolved" });
  await assert.rejects(first.save(corrected), { code: "verified-base-required" });
});

test("category rules and unresolved retries survive canonical object ordering and reopen", async () => {
  const setup = await createPagedFixture();
  const store = new CanonicalLedgerStore({ lifecycle: setup.lifecycle });
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
  const setup = await createPagedFixture();
  const store = new CanonicalLedgerStore({ lifecycle: setup.lifecycle });
  await store.load();
  const ledger = await importedLedger();
  await store.save(ledger);
  const removed = structuredClone(ledger); removed.events = [];
  await assert.rejects(store.save(removed), { code: "history-removal-refused" });
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
  await assert.rejects(store.save(production));
});

test("corrected source overlaps remain reviewable and preserve totals through save and independent reopen", async () => {
  const setup = await createPagedFixture(), lifecycle = setup.lifecycle;
  let store = new CanonicalLedgerStore({ lifecycle });
  await store.load();
  let ledger = registerAccount(createLedger({ now }), { institutionId: "wells-fargo", displayName: "Invented corrected checking", currency: "USD", accountType: "checking" }, { now });
  const accountId = ledger.accounts[0].accountId;
  const input = parsed => ({ parsed, syntheticOnly: true, accountMappings: { default: accountId }, coverageByAccount: {
    [accountId]: { start: "2026-01-01", end: "2026-01-31", provenance: "user-confirmed" } } });
  const fixture = async name => parseProviderCsv({ bytes: await readFile(new URL("../fixtures/pr28/" + name, import.meta.url)), sourceFormat: "wells-fargo-csv-v1" });
  ledger = prepareCanonicalImport(ledger, input(await fixture("wells-fargo-foundation.csv")), { now }).ledger;
  const marketId = ledger.activities[0].activityId;
  ledger = applyFinancialEvent(ledger, { type: "classification", commandId: "classify-corrected-market", activityId: marketId, activityKind: "spending" }, { now });
  for (const amountText of ["-95.00", "-90.00"]) ledger = applyFinancialEvent(ledger, { type: "bank-correction", commandId: "correct-market-" + amountText,
    activityId: marketId, amountText, evidence: { reason: "Invented sequential correction" } }, { now });
  const original = structuredClone(ledger.activities[0]), events = structuredClone(ledger.events);
  ledger = await store.save(ledger);
  store = new CanonicalLedgerStore({ lifecycle });
  assert.deepEqual(await store.load(), ledger);
  const reviewInput = input(await fixture("wells-fargo-review.csv"));
  ledger = prepareCanonicalImport(await store.load(), reviewInput, { now }).ledger;
  assert.equal(ledger.imports.at(-1).counts.created, 2);
  assert.equal(ledger.imports.at(-1).counts.review, 1);
  const overlapId = ledger.observations.find(o => o.disposition === "review").observationId;
  ledger = await store.save(ledger);
  store = new CanonicalLedgerStore({ lifecycle });
  ledger = prepareCanonicalImport(await store.load(), reviewInput, { now }).ledger;
  assert.equal(ledger.activities.length, 6);
  assert.equal(ledger.observations.find(o => o.observationId === overlapId).disposition, "review");
  ledger = applyReviewDecision(ledger, { observationId: overlapId, action: "match", activityId: marketId, rationale: "Invented original receipt before correction" }, { now });
  const decisionId = ledger.reviewDecisions.at(-1).reviewDecisionId;
  ledger = await store.save(ledger);
  store = new CanonicalLedgerStore({ lifecycle });
  const reopened = await store.load();
  assert.deepEqual(reopened, ledger);
  assert.deepEqual(reopened.activities[0], original);
  assert.deepEqual(reopened.events, events);
  assert.equal(reopened.observations.find(o => o.observationId === overlapId).activityId, marketId);
  assert.equal(summarizeLedger(reopened, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }).spending, "90.00");
  const intermediate = await parseProviderCsv({ sourceFormat: "wells-fargo-csv-v1", bytes: new TextEncoder().encode(
    "DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\n01/05/2026,INVENTED MARKET PURCHASE,-95.00,,Posted\n") });
  ledger = prepareCanonicalImport(reopened, input(intermediate), { now }).ledger;
  assert.equal(ledger.observations.at(-1).reasonCode, "insufficient-composite-evidence");
  ledger = reverseReviewDecision(ledger, { reviewDecisionId: decisionId, rationale: "Invented reversal for another review" }, { now });
  ledger = await store.save(ledger);
  assert.deepEqual(await new CanonicalLedgerStore({ lifecycle }).load(), ledger);
  assert.deepEqual(ledger.events, events);
  assert.equal(ledger.activities.length, 6);
  assert.equal(summarizeLedger(ledger, { start: "2026-01-01", end: "2026-01-31", currency: "USD" }).spending, "90.00");
});

test("full review, reversal, prospective rule, correction, and refund history survives v5 save and independent reopen", async () => {
  const setup = await createPagedFixture();
  const store = new CanonicalLedgerStore({ lifecycle: setup.lifecycle });
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
  const target = new CanonicalLedgerStore({lifecycle: setup.lifecycle});
  assert.deepEqual(await target.load(), ledger);
  assert.equal(getEffectiveActivities(await target.load()).find(a => a.activityId === futureId).categoryId, "invented-coffee");
  assert.equal(getEffectiveActivities(await target.load()).find(a => a.activityId === refundId).categoryId, "invented-refund-override");
});
