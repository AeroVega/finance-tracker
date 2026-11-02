import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DriveTransactionEngine, GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";

import { createJournalEvent } from "../js/transaction-protocol.mjs";

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
  async waitForMetadata(id) {
    try { return await this.readMetadata(id); }
    catch {
      const error = new Error("Drive metadata visibility failed for synthetic missing file.");
      error.code = "visibility-timeout";
      error.details = { fileId: id, attempts: 8, lastStatus: 404 };
      throw error;
    }
  }
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
      error.code === "transaction-unresolved" &&
      Boolean(error.details.transactionId) &&
      Boolean(error.details.cause) &&
      Boolean(error.details.causeMessage) &&
      error.message.includes(error.details.cause) &&
      error.message.includes(error.details.causeMessage) &&
      Number.isInteger(error.details.journalEventCount));
    assert.equal(adapter.mutations, boundary);
    assert.equal(engine.recoveryRequired, true);
    assert.ok(adapter.files.size >= 2, `boundary ${boundary} retains its durable evidence`);
    const recovered = await engine.recover({
      manifestFileId: "manifest",
      makeManifest: transaction.makeManifest
    });
    const outcome = recovered.transactions[0];
    if (boundary === 2 || boundary === 5) {
      assert.equal(outcome.outcome, "aborted", `boundary ${boundary} safely aborts when a planned file never becomes visible`);
      assert.equal(outcome.preservedEvidence, true);
      assert.equal(adapter.files.get("manifest").json.commitId, BASE.commitId);
      assert.equal(engine.recoveryRequired, false);
      continue;
    }
    if (boundary === 1 || boundary === 3 || boundary === 4) {
      assert.equal(outcome.outcome, "aborted", `boundary ${boundary} safely aborts at the original base`);
      assert.equal(adapter.files.get("manifest").json.commitId, BASE.commitId);
      assert.equal(engine.recoveryRequired, false);
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

test("reusing a transaction ID is rejected before any new durable write", async () => {
  const { adapter, engine, transaction } = setup();
  const transactionId = cryptoImpl.randomUUID();
  await engine.transact({ ...transaction, transactionId });
  const mutations = adapter.mutations;
  await assert.rejects(
    engine.transact({ ...transaction, transactionId }),
    (error) => error.code === "transaction-already-exists"
  );
  assert.equal(adapter.mutations, mutations);
});

test("a malformed manifest builder cannot publish a different revision or lineage", async () => {
  const { adapter, engine, transaction } = setup();
  await assert.rejects(
    engine.transact({
      ...transaction,
      makeManifest: async ({ current, record }) => ({
        ...current,
        revision: record.revision + 10,
        commitId: record.commitId,
        parentCommitId: current.commitId
      })
    }),
    (error) => error.code === "transaction-unresolved" && error.details.cause === "invalid-next-manifest"
  );
  assert.equal(adapter.files.get("manifest").json.commitId, BASE.commitId);
});

test("offline writes are refused before the first durable mutation", async () => {
  const { adapter, engine, transaction } = setup();
  engine.isOnline = () => false;
  await assert.rejects(engine.transact(transaction), (error) => error.code === "offline");
  assert.equal(adapter.mutations, 0);
});

test("recovery rejects a manifest whose immutable commit-record pointer is inconsistent", async () => {
  for (const field of ["commitRecordFileId", "commitRecordHash"]) {
    const { adapter, engine, transaction } = setup();
    await engine.transact(transaction);
    const manifest = adapter.files.get("manifest").json;
    manifest[field] = field === "commitRecordFileId" ? "synthetic-wrong-commit-file" : "0".repeat(64);
    adapter.files.get("manifest").json = manifest;
    adapter.files.get("manifest").bytes = new TextEncoder().encode(JSON.stringify(manifest));
    await assert.rejects(
      engine.recover({ manifestFileId: "manifest" }),
      (error) => error.code === "manifest-commit-pointer-mismatch"
    );
    assert.equal(engine.recoveryRequired, true);
  }
});

test("Drive transaction engine and browser smoke-test module have valid JavaScript syntax", () => {
  const enginePath = fileURLToPath(new URL("../js/drive-transaction-engine.mjs", import.meta.url));
  const browserPath = fileURLToPath(new URL("../prototype/drive-feasibility-spike.mjs", import.meta.url));
  execFileSync(process.execPath, ["--check", enginePath], { stdio: "pipe" });
  execFileSync(process.execPath, ["--check", browserPath], { stdio: "pipe" });
});


test("Drive metadata visibility retries transient 404s with a bounded backoff", async () => {
  let requests = 0;
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: () => "synthetic-token",
    folderId: "synthetic-folder",
    visibilityAttempts: 4,
    visibilityDelayMs: 1,
    visibilityMaxDelayMs: 2,
    fetchImpl: async () => {
      requests += 1;
      if (requests < 4) return new Response("not visible yet", { status: 404 });
      return new Response(JSON.stringify({
        id: "new-file",
        name: "synthetic-object",
        parents: ["synthetic-folder"],
        trashed: false,
        appProperties: {}
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  const metadata = await adapter.waitForMetadata("new-file");
  assert.equal(metadata.id, "new-file");
  assert.equal(requests, 4);
});

test("Drive metadata visibility timeout preserves diagnostic details after bounded retries", async () => {
  let requests = 0;
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: () => "synthetic-token",
    folderId: "synthetic-folder",
    visibilityAttempts: 3,
    visibilityDelayMs: 1,
    visibilityMaxDelayMs: 2,
    fetchImpl: async () => {
      requests += 1;
      return new Response("not found", { status: 404 });
    }
  });

  await assert.rejects(adapter.waitForMetadata("missing-file"), (error) =>
    error.code === "visibility-timeout" &&
    error.details.fileId === "missing-file" &&
    error.details.attempts === 3 &&
    error.details.lastStatus === 404 &&
    Number.isInteger(error.details.elapsedMs) &&
    error.details.cause === "drive-request-failed" &&
    /missing-file/.test(error.message) &&
    /HTTP 404/.test(error.message) &&
    /3 checks/.test(error.message));
  assert.equal(requests, 3);
});

test("Drive metadata visibility does not retry authorization failures", async () => {
  let requests = 0;
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: () => "synthetic-token",
    folderId: "synthetic-folder",
    visibilityAttempts: 5,
    visibilityDelayMs: 1,
    fetchImpl: async () => {
      requests += 1;
      return new Response("forbidden", { status: 403 });
    }
  });

  await assert.rejects(adapter.waitForMetadata("protected-file"), (error) =>
    error.code === "authorization-required");
  assert.equal(requests, 1);
});


async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

test("Drive immutable create surfaces definitive client errors without polling", async () => {
  let requests = 0;
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: () => "synthetic-token",
    folderId: "synthetic-folder",
    visibilityAttempts: 3,
    visibilityDelayMs: 1,
    visibilityMaxDelayMs: 2,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: "Invalid request metadata" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const content = '{"synthetic":true}';
  await assert.rejects(adapter.createImmutable({
    fileId: "generated-file-id",
    name: "synthetic-object",
    kind: "snapshot-object",
    transactionId: cryptoImpl.randomUUID(),
    content,
    expectedSha256: await sha256Hex(content)
  }), (error) =>
    error.code === "drive-request-failed" &&
    error.details.status === 400 &&
    /HTTP 400/.test(error.message));
  assert.equal(requests, 1, "a definitive create rejection must not trigger metadata polling");
});

test("successful Drive create response is preserved when exact-ID metadata read-back remains unavailable", async () => {
  let requests = 0;
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: () => "synthetic-token",
    folderId: "synthetic-folder",
    visibilityAttempts: 2,
    visibilityDelayMs: 1,
    visibilityMaxDelayMs: 1,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({
          id: "generated-file-id",
          name: "synthetic-object",
          mimeType: "application/octet-stream",
          parents: ["synthetic-folder"]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not visible", { status: 404 });
    }
  });

  const content = '{"synthetic":true}';
  await assert.rejects(adapter.createImmutable({
    fileId: "generated-file-id",
    name: "synthetic-object",
    kind: "snapshot-object",
    transactionId: cryptoImpl.randomUUID(),
    content,
    expectedSha256: await sha256Hex(content)
  }), (error) =>
    error.code === "visibility-timeout" &&
    error.details.createRequest?.status === 200 &&
    error.details.createRequest?.returnedId === "generated-file-id" &&
    error.details.lastStatus === 404 &&
    /create outcome: HTTP 200/.test(error.message) &&
    /returned ID generated-file-id/.test(error.message));
  assert.equal(requests, 3, "one successful create plus two exact-ID metadata checks");
});

test("ambiguous Drive create server errors retain their original diagnostics if read-back times out", async () => {
  let requests = 0;
  const adapter = new GoogleDriveTransactionAdapter({
    accessToken: () => "synthetic-token",
    folderId: "synthetic-folder",
    visibilityAttempts: 2,
    visibilityDelayMs: 1,
    visibilityMaxDelayMs: 1,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({ error: { message: "Backend error" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("not visible", { status: 404 });
    }
  });

  const content = '{"synthetic":true}';
  await assert.rejects(adapter.createImmutable({
    fileId: "generated-file-id",
    name: "synthetic-object",
    kind: "snapshot-object",
    transactionId: cryptoImpl.randomUUID(),
    content,
    expectedSha256: await sha256Hex(content)
  }), (error) =>
    error.code === "visibility-timeout" &&
    error.details.createRequest?.status === 500 &&
    /create outcome: HTTP 500/.test(error.message));
  assert.equal(requests, 3, "one create plus two metadata checks");
});

async function addSyntheticStart(adapter, payload) {
  const event = await createJournalEvent({
    transactionId: cryptoImpl.randomUUID(), eventId: cryptoImpl.randomUUID(),
    sequence: 0, eventType: "transaction-started", timestamp: "2026-11-01T19:00:00.000Z",
    payload, previousEventHash: null, cryptoImpl
  });
  const id = await adapter.allocateFileId();
  await adapter.appendJournal(event, id);
  return { id, event };
}

const recoveryBase = (overrides = {}) => ({
  databaseId: BASE.databaseId, copyId: BASE.copyId,
  baseRevision: BASE.revision, baseCommitId: BASE.commitId, ...overrides
});

test("recovery leaves other verified database/copy journals untouched at every interruption boundary", async () => {
  for (const foreignIdentity of [
    { databaseId: "another-synthetic-db", copyId: "another-synthetic-copy" },
    { databaseId: BASE.databaseId, copyId: "another-synthetic-copy" }
  ]) {
    for (let boundary = 1; boundary <= 11; boundary += 1) {
      const { adapter, engine, transaction } = setup(boundary);
      await assert.rejects(engine.transact(transaction), { code: "transaction-unresolved" });
      adapter.files.set("selected-manifest", { json: { ...BASE, ...foreignIdentity } });
      const before = structuredClone([...adapter.files]);
      const mutations = adapter.mutations;
      const result = await engine.recover({ manifestFileId: "selected-manifest", makeManifest: transaction.makeManifest });
      assert.deepEqual(result.transactions, []);
      assert.equal(engine.recoveryRequired, false);
      assert.equal(adapter.mutations, mutations);
      assert.deepEqual([...adapter.files], before);
    }
  }
});

test("recovery resolves the selected copy but preserves a foreign nonterminal journal", async () => {
  const { adapter, engine, transaction } = setup();
  const foreign = await addSyntheticStart(adapter, recoveryBase({ databaseId: "foreign-db", copyId: "foreign-copy" }));
  const own = await addSyntheticStart(adapter, recoveryBase());
  const before = structuredClone(adapter.files.get(foreign.id));
  const result = await engine.recover({ manifestFileId: "manifest", makeManifest: transaction.makeManifest });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].transactionId, own.event.transactionId);
  assert.equal(result.transactions[0].outcome, "aborted");
  assert.deepEqual(adapter.files.get(foreign.id), before);
  assert.equal([...adapter.files.values()].filter(file => file.json?.transactionId === foreign.event.transactionId).length, 1);
});

test("unscopable or conflicting journal identities block before any recovery mutation", async () => {
  for (const identity of [
    { databaseId: undefined, copyId: "foreign-copy" },
    { databaseId: "foreign-db", copyId: "" },
    { databaseId: "foreign-db", copyId: BASE.copyId }
  ]) {
    const { adapter, engine, transaction } = setup();
    await addSyntheticStart(adapter, recoveryBase()); // Would otherwise be aborted first.
    const payload = recoveryBase(identity);
    for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
    await addSyntheticStart(adapter, payload);
    const before = structuredClone([...adapter.files]);
    const mutations = adapter.mutations;
    await assert.rejects(engine.recover({ manifestFileId: "manifest", makeManifest: transaction.makeManifest }),
      error => ["invalid-recovery-identity", "journal-identity-mismatch"].includes(error.code));
    assert.equal(engine.recoveryRequired, true);
    assert.equal(adapter.mutations, mutations);
    assert.deepEqual([...adapter.files], before);
  }
});

test("an apparently foreign journal must pass hash verification before it can be excluded", async () => {
  const { adapter, engine, transaction } = setup();
  await addSyntheticStart(adapter, recoveryBase());
  const foreign = await addSyntheticStart(adapter, recoveryBase({ databaseId: "foreign-db", copyId: "foreign-copy" }));
  adapter.files.get(foreign.id).json.payload.copyId = "tampered-copy";
  const mutations = adapter.mutations;
  await assert.rejects(engine.recover({ manifestFileId: "manifest", makeManifest: transaction.makeManifest }),
    { code: "event-hash-mismatch" });
  assert.equal(adapter.mutations, mutations);
  assert.equal(engine.recoveryRequired, true);
});

test("recovery refuses a manifest without a database/copy identity", async () => {
  const { adapter, engine, transaction } = setup();
  adapter.files.get("manifest").json.copyId = null;
  await assert.rejects(engine.recover({ manifestFileId: "manifest", makeManifest: transaction.makeManifest }),
    { code: "invalid-recovery-identity" });
  assert.equal(adapter.mutations, 0);
  assert.equal(engine.recoveryRequired, true);
});

for (const failUpload of [false, true]) {
  test(`real engine and lifecycle drain a long ${failUpload ? "failed" : "successful"} synthetic upload safely`, async () => {
    const { ApplicationStorageLifecycle } = await import("../js/application-storage-lifecycle.mjs");
    const { SessionCoordinator } = await import("../js/session-coordination.mjs");
    const { adapter, transaction } = setup();
    let now = 1_000_000, tick, marker = null, entered, resume;
    const begun = new Promise((resolve) => { entered = resolve; });
    const pause = new Promise((resolve) => { resume = resolve; });
    const create = adapter.createImmutable.bind(adapter);
    adapter.createImmutable = async (input) => {
      if (input.kind === "snapshot-object") {
        entered();
        await pause;
        if (failUpload) throw Object.assign(new Error("invented upload failure"), { code: "drive-request-failed" });
      }
      return create(input);
    };
    const statuses = [];
    const lifecycle = new ApplicationStorageLifecycle({
      syntheticOnly: true, folderName: "synthetic", folderId: "synthetic-folder", manifestFileId: "manifest",
      accessToken: () => "invented-token", makeManifest: transaction.makeManifest, cryptoImpl, lifecycleTarget: null,
      onStatus: (status) => statuses.push(status.state),
      setIntervalImpl: (callback) => { tick = callback; return 1; }, clearIntervalImpl: () => {},
      factories: {
        createSessionAdapter: () => ({ async read() { return structuredClone(marker); }, async write(record) { marker = structuredClone(record); } }),
        createCoordinator: ({ adapter }) => new SessionCoordinator({ adapter, now: () => now }),
        createTransactionAdapter: () => adapter
      }
    });
    await lifecycle.start();
    const saving = lifecycle.transact(transaction);
    await begun;
    const releasing = lifecycle.release();
    const finished = Promise.allSettled([saving, releasing]);
    for (let step = 0; step < 4; step++) { now += 40_000; await tick(); }
    resume();
    const [saved, released] = await finished;
    if (failUpload) {
      assert.equal(saved.reason.code, "transaction-unresolved");
      assert.equal(released.reason.code, "recovery-required");
      assert.equal(marker.state, "active");
      assert.equal(lifecycle.state, "recovery-required");
      assert.equal(statuses.includes("released"), false);
      assert.equal(adapter.files.get("manifest").json.revision, BASE.revision);
    } else {
      assert.equal(saved.value.revision, BASE.revision + 1);
      assert.equal(released.value.released, true);
      assert.equal(marker.state, "released");
      assert.equal(lifecycle.engine.recoveryRequired, false);
    }
  });
}
