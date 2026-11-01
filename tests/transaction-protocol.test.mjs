import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeJcs,
  createJournalEvent,
  verifyJournal,
  classifyTransactionRecovery,
  TransactionProtocolError
} from "../js/transaction-protocol.mjs";

const TX = "11111111-1111-4111-8111-111111111111";
const EVENT_IDS = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999"
];

async function journal(specs) {
  const events = [];
  let previousEventHash = null;
  for (let index = 0; index < specs.length; index += 1) {
    const event = await createJournalEvent({
      transactionId: TX,
      eventId: EVENT_IDS[index],
      sequence: index,
      eventType: specs[index][0],
      timestamp: "2026-11-01T18:00:00.000Z",
      payload: specs[index][1] || {},
      previousEventHash
    });
    events.push(event);
    previousEventHash = event.eventHash;
  }
  return events;
}

const objectHash = "a".repeat(64);
const recordHash = "b".repeat(64);
const commitId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("canonicalizes object keys recursively and preserves array order", () => {
  assert.equal(
    canonicalizeJcs({ z: 1, a: { y: true, x: null }, list: [2, 1] }),
    '{"a":{"x":null,"y":true},"list":[2,1],"z":1}'
  );
});

test("rejects values that cannot be represented in canonical JSON", () => {
  assert.throws(() => canonicalizeJcs({ amount: Number.NaN }), (error) =>
    error instanceof TransactionProtocolError && error.code === "invalid-number");
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJcs(cyclic), (error) =>
    error instanceof TransactionProtocolError && error.code === "cyclic-value");
  assert.throws(() => canonicalizeJcs({ absent: undefined }), (error) =>
    error instanceof TransactionProtocolError && error.code === "unsupported-value");
});

test("creates and verifies a hash-linked transaction journal", async () => {
  const events = await journal([
    ["transaction-started", { operationType: "import", baseRevision: 4, baseCommitId: "base-commit" }],
    ["object-stage-planned", { logicalPath: "ledger/2026-11.json", fileId: "drive-id-1", sha256: objectHash }],
    ["object-staged", { fileId: "drive-id-1", sha256: objectHash }],
    ["commit-stage-planned", { commitId }],
    ["commit-staged", { commitId, recordHash }],
    ["manifest-publication-planned", {
      baseRevision: 4, baseCommitId: "base-commit", intendedRevision: 5, intendedCommitId: commitId
    }],
    ["manifest-published", { commitId }],
    ["transaction-committed", { commitId }]
  ]);
  const state = await verifyJournal(events);
  assert.equal(state.status, "committed");
  assert.equal(state.transactionId, TX);
  assert.equal(state.sequence, 7);
  assert.equal(state.stagedObjects.length, 1);
  assert.equal(state.commit.commitId, commitId);
});

test("rejects a tampered event and a broken previous-event hash", async () => {
  const events = await journal([
    ["transaction-started", {}],
    ["object-stage-planned", { logicalPath: "ledger/a.json", fileId: "id-a", sha256: objectHash }]
  ]);
  const tampered = events.map((event) => ({ ...event }));
  tampered[1].payload.sha256 = "c".repeat(64);
  await assert.rejects(verifyJournal(tampered), (error) =>
    error instanceof TransactionProtocolError && error.code === "event-hash-mismatch");

  const brokenLink = events.map((event) => ({ ...event }));
  brokenLink[1].previousEventHash = "d".repeat(64);
  await assert.rejects(verifyJournal(brokenLink), (error) =>
    error instanceof TransactionProtocolError && error.code === "broken-chain");
});

test("requires every planned object to be staged before commit preparation", async () => {
  const events = await journal([
    ["transaction-started", {}],
    ["object-stage-planned", { logicalPath: "ledger/a.json", fileId: "id-a", sha256: objectHash }],
    ["commit-stage-planned", { commitId }]
  ]);
  await assert.rejects(verifyJournal(events), (error) =>
    error instanceof TransactionProtocolError && error.code === "invalid-transition");
});

test("does not permit abort after manifest publication has been planned", async () => {
  const events = await journal([
    ["transaction-started", {}],
    ["commit-stage-planned", { commitId }],
    ["commit-staged", { commitId, recordHash }],
    ["manifest-publication-planned", {
      baseRevision: 4, baseCommitId: "base-commit", intendedRevision: 5, intendedCommitId: commitId
    }],
    ["transaction-aborted", { reason: "late-abort" }]
  ]);
  await assert.rejects(verifyJournal(events), (error) =>
    error instanceof TransactionProtocolError && error.code === "invalid-abort");
});

test("classifies an already-published manifest for full verification", () => {
  const state = {
    status: "published-unverified",
    commit: { commitId },
    publication: { baseRevision: 4, baseCommitId: "base-commit", intendedRevision: 5, intendedCommitId: commitId }
  };
  assert.deepEqual(
    classifyTransactionRecovery({ journalState: state, manifest: { revision: 5, commitId } }),
    { action: "verify-intended-commit", commitId }
  );
});

test("classifies a staged commit at the original base for safe revalidation before publication", () => {
  const state = {
    status: "ready-to-publish",
    commit: { commitId },
    publication: { baseRevision: 4, baseCommitId: "base-commit", intendedRevision: 5, intendedCommitId: commitId }
  };
  assert.deepEqual(
    classifyTransactionRecovery({ journalState: state, manifest: { revision: 4, commitId: "base-commit" } }),
    { action: "revalidate-and-resume-publication", commitId }
  );
});

test("stops when the manifest matches neither the known base nor intended commit", () => {
  const state = {
    status: "publishing",
    commit: { commitId },
    publication: { baseRevision: 4, baseCommitId: "base-commit", intendedRevision: 5, intendedCommitId: commitId }
  };
  assert.deepEqual(
    classifyTransactionRecovery({ journalState: state, manifest: { revision: 6, commitId: "other-commit" } }),
    { action: "stop", reason: "manifest-does-not-match-known-base-or-intended-state" }
  );
});
