import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { DriveTransactionEngine } from "../js/drive-transaction-engine.mjs";

const cryptoImpl = globalThis.crypto || webcrypto;
const BASE = {
  databaseId: "synthetic-database",
  copyId: "synthetic-copy",
  revision: 3,
  commitId: "synthetic-base-commit",
  role: "primary"
};

class SyntheticDrive {
  constructor({ failAfterMutation = 0 } = {}) {
    this.files = new Map();
    this.nextId = 0;
    this.mutations = 0;
    this.failAfterMutation = failAfterMutation;
    this.files.set("manifest", {
      bytes: new TextEncoder().encode(JSON.stringify(BASE)),
      json: { ...BASE },
      appProperties: {}
    });
  }

  mutate() {
    this.mutations += 1;
    if (this.mutations === this.failAfterMutation) {
      const error = new Error("Synthetic lost response after durable mutation");
      error.code = "synthetic-lost-response";
      throw error;
    }
  }

  async allocateFileId() { this.nextId += 1; return `synthetic-file-${this.nextId}`; }
  async readJson(id) {
    const file = this.files.get(id);
    if (!file) { const error = new Error("not found"); error.code = "drive-request-failed"; error.details = { status: 404 }; throw error; }
    return file.json || JSON.parse(new TextDecoder().decode(file.bytes));
  }
  async readMetadata(id) {
    const file = this.files.get(id);
    if (!file) throw new Error("not found");
    return { id, parents: ["synthetic-folder"], appProperties: file.appProperties || {} };
  }
  async waitForMetadata(id) { return this.readMetadata(id); }
  async readBytes(id) {
    const file = this.files.get(id);
    if (!file) throw new Error("not found");
    return file.bytes;
  }
  async appendJournal(event, fileId) {
    const bytes = new TextEncoder().encode(JSON.stringify(event));
    this.files.set(fileId, {
      bytes, json: event,
      appProperties: { financeTrackerKind: "journal-event", financeTrackerTransaction: event.transactionId }
    });
    this.mutate();
    return { fileId };
  }
  async createImmutable({ fileId, name, kind, transactionId, content, expectedSha256 }) {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content);
    const json = typeof content === "string" ? JSON.parse(content) : null;
    this.files.set(fileId, {
      bytes, json, name,
      appProperties: { financeTrackerKind: kind, financeTrackerTransaction: transactionId, financeTrackerHash: expectedSha256 }
    });
    this.mutate();
    return { fileId };
  }
  async publishManifest(id, manifest) {
    this.files.set(id, { bytes: new TextEncoder().encode(JSON.stringify(manifest)), json: manifest });
    this.mutate();
    return manifest;
  }
  async listChildren() {
    return [...this.files.entries()]
      .filter(([id]) => id !== "manifest")
      .map(([id, file]) => ({ id, appProperties: file.appProperties || {} }));
  }
}

function setup(failAfterMutation = 0) {
  const adapter = new SyntheticDrive({ failAfterMutation });
  const engine = new DriveTransactionEngine({
    adapter,
    assertWritable: async () => true,
    isOnline: () => true,
    cryptoImpl,
    now: () => "2026-11-01T19:00:00.000Z"
  });
  const transaction = {
    manifestFileId: "manifest",
    expectedBase: BASE,
    objects: [{ logicalPath: "ledger/synthetic.json", content: '{"synthetic":true}' }],
    commitRecord: {
      operationType: "synthetic-test",
      schemaVersion: 1,
      snapshot: {}
    },
    makeManifest: async ({ current, record, commitFileId, commitHash }) => ({
      ...current,
      revision: record.revision,
      commitId: record.commitId,
      parentCommitId: record.parentCommitId,
      commitRecordFileId: commitFileId,
      commitRecordHash: commitHash
    })
  };
  return { adapter, engine, transaction };
}

test("synthetic transaction stages immutable data and publishes the manifest last", async () => {
  const { adapter, engine, transaction } = setup();
  const result = await engine.transact(transaction);
  assert.equal(result.revision, 4);
  assert.equal(result.manifest.parentCommitId, BASE.commitId);
  assert.equal(adapter.files.get("manifest").json.commitId, result.commitId);
  const kinds = [...adapter.files.values()].map((file) => file.appProperties?.financeTrackerKind).filter(Boolean);
  assert.ok(kinds.includes("snapshot-object"));
  assert.ok(kinds.includes("commit-record"));
  assert.equal(engine.recoveryRequired, false);
});

test("serialized transactions reject a stale second writer", async () => {
  const { engine, transaction } = setup();
  const results = await Promise.allSettled([engine.transact(transaction), engine.transact(transaction)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "base-conflict");
});

test("every durable mutation boundary is injectable and preserves evidence", async () => {
  // 8 journal appends + 1 immutable data object + 1 immutable commit + 1 manifest publish.
  for (let boundary = 1; boundary <= 11; boundary += 1) {
    const { adapter, engine, transaction } = setup(boundary);
    await assert.rejects(engine.transact(transaction), (error) =>
      error.code === "transaction-unresolved" && Boolean(error.details.transactionId));
    assert.equal(adapter.mutations, boundary);
    assert.equal(engine.recoveryRequired, true);
    assert.ok(adapter.files.size >= 2, `boundary ${boundary} retains its durable evidence`);
    const recovered = await engine.recover({
      manifestFileId: "manifest",
      makeManifest: transaction.makeManifest
    });
    const outcome = recovered.transactions[0];
    if (boundary === 1 || boundary === 3 || boundary === 4) {
      assert.equal(outcome.outcome, "aborted", `boundary ${boundary} safely aborts at the original base`);
      assert.equal(adapter.files.get("manifest").json.commitId, BASE.commitId);
      assert.equal(engine.recoveryRequired, false);
    } else if (boundary === 2 || boundary === 5) {
      await assert.rejects(
        engine.recover({ manifestFileId: "manifest", makeManifest: transaction.makeManifest }),
        (error) => error.message === "not found"
      );
      assert.equal(adapter.files.get("manifest").json.commitId, BASE.commitId);
      assert.equal(engine.recoveryRequired, true);
    } else {
      assert.equal(outcome.outcome, "committed", `boundary ${boundary} resumes or verifies the commit`);
      assert.equal(adapter.files.get("manifest").json.revision, 4);
      assert.equal(engine.recoveryRequired, false);
    }
  }
});

test("recovery verifies a manifest published before its response was lost", async () => {
  const { adapter, engine, transaction } = setup(9);
  await assert.rejects(engine.transact(transaction), (error) => error.code === "transaction-unresolved");
  const manifest = adapter.files.get("manifest").json;
  assert.equal(manifest.revision, 4);
  const recovered = await engine.recover({ manifestFileId: "manifest", makeManifest: transaction.makeManifest });
  assert.equal(recovered.transactions[0].action, "verified-committed");
  assert.equal(engine.recoveryRequired, false);
});

test("recovery verifies publication when the manifest-published journal response is lost", async () => {
  const { engine, transaction } = setup(10);
  await assert.rejects(engine.transact(transaction), (error) => error.code === "transaction-unresolved");
  const recovered = await engine.recover({ manifestFileId: "manifest" });
  assert.equal(recovered.transactions[0].action, "verified-committed");
  assert.equal(recovered.transactions[0].outcome, "committed");
});

test("recovery verifies a terminal commit when the final journal response is lost", async () => {
  const { engine, transaction } = setup(11);
  await assert.rejects(engine.transact(transaction), (error) => error.code === "transaction-unresolved");
  const recovered = await engine.recover({ manifestFileId: "manifest" });
  assert.equal(recovered.transactions[0].action, "verified-committed");
  assert.equal(recovered.transactions[0].outcome, "committed");
});

test("recovery resumes a fully staged transaction when the manifest remains at its verified base", async () => {
  const { adapter, engine, transaction } = setup(8);
  await assert.rejects(engine.transact(transaction), (error) => error.code === "transaction-unresolved");
  const recovered = await engine.recover({
    manifestFileId: "manifest",
    makeManifest: transaction.makeManifest
  });
  assert.equal(recovered.transactions[0].outcome, "committed");
  assert.equal(adapter.files.get("manifest").json.revision, 4);
  assert.equal(engine.recoveryRequired, false);
});

test("offline writes are refused before the first durable mutation", async () => {
  const { adapter, engine, transaction } = setup();
  engine.isOnline = () => false;
  await assert.rejects(engine.transact(transaction), (error) => error.code === "offline");
  assert.equal(adapter.mutations, 0);
});
