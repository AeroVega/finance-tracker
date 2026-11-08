import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { encode, hashRaw, mapImmutableReads, readCatalog, verifyCatalogHistory, writeVerified } from "../js/catalog-storage.mjs";
import { GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";
import { setupCatalog } from "./helpers/catalog-drive.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function idAdapter(fetchImpl) {
  return new GoogleDriveTransactionAdapter({ accessToken: () => "invented-test-token", folderId: "invented-folder", fetchImpl });
}

test("file IDs allocate lazily in batches with one refill for concurrent callers", async () => {
  let calls = 0, nextId = 0, active = 0, peak = 0;
  const adapter = idAdapter(async (url) => {
    calls++;
    peak = Math.max(peak, ++active);
    const target = new URL(url);
    assert.equal(target.pathname, "/drive/v3/files/generateIds");
    assert.equal(target.searchParams.get("space"), "drive");
    assert.equal(target.searchParams.get("count"), "16");
    try {
      await tick();
      return Response.json({ ids: Array.from({ length: 16 }, () => "invented-id-" + ++nextId) });
    } finally { active--; }
  });
  assert.equal(calls, 0);
  const ids = await Promise.all(Array.from({ length: 33 }, () => adapter.allocateFileId()));
  assert.equal(calls, 3);
  assert.equal(peak, 1);
  assert.equal(new Set(ids).size, 33);
  assert.equal(await adapter.allocateFileId(), "invented-id-34");
  assert.equal(calls, 3);
});

test("malformed or repeated ID batches fail closed without handing out partial IDs", async (t) => {
  const ids = Array.from({ length: 16 }, (_, index) => "invented-id-" + index);
  for (const invalid of [[], ids.slice(1), [...ids, "extra"], [...ids.slice(1), ids[1]],
    [...ids.slice(1), ""], [...ids.slice(1), 1], null]) {
    await t.test(JSON.stringify(invalid), async () => {
      let calls = 0;
      const adapter = idAdapter(async () => { calls++; await tick(); return Response.json({ ids: invalid }); });
      const results = await Promise.allSettled([adapter.allocateFileId(), adapter.allocateFileId()]);
      assert.equal(calls, 1);
      assert.ok(results.every((result) => result.status === "rejected" && result.reason.code === "invalid-generated-id"));
      adapter.fetch = async () => Response.json({ ids });
      assert.equal(await adapter.allocateFileId(), ids[0]);
    });
  }
  const repeated = idAdapter(async () => Response.json({ ids }));
  const first = await Promise.all(ids.map(() => repeated.allocateFileId()));
  assert.deepEqual(first, ids);
  await assert.rejects(repeated.allocateFileId(), { code: "invalid-generated-id" });
});

test("failed ID refill releases all waiters and a later allocation can try a new batch", async () => {
  const adapter = idAdapter(async () => { await tick(); throw new TypeError("invented transport failure"); });
  const results = await Promise.allSettled([adapter.allocateFileId(), adapter.allocateFileId()]);
  assert.ok(results.every((result) => result.status === "rejected"));
  adapter.fetch = async () => Response.json({ ids: Array.from({ length: 16 }, (_, index) => "invented-retry-" + index) });
  assert.equal(await adapter.allocateFileId(), "invented-retry-0");
});

test("immutable read pool preserves order, caps concurrency, and drains before deterministic failure", async () => {
  const pending = Array.from({ length: 8 }, deferred);
  const started = [];
  let settled = false;
  const result = mapImmutableReads(pending, async (item, index) => {
    started.push(index);
    return item.promise;
  });
  const first = new Error("first input failure");
  const later = new Error("earlier arrival at later input");
  const rejected = assert.rejects(result, (error) => error === first).then(() => { settled = true; });
  assert.deepEqual(started, [0, 1, 2, 3]);
  pending[2].reject(later);
  await tick();
  assert.equal(settled, false);
  assert.deepEqual(started, [0, 1, 2, 3]);
  pending[0].reject(first);
  pending[1].resolve(1);
  pending[3].resolve(3);
  await rejected;
  assert.deepEqual(started, [0, 1, 2, 3]);
  const values = await mapImmutableReads([3, 1, 2], async (value) => {
    for (let i = 0; i < value; i++) await tick();
    return value;
  });
  assert.deepEqual(values, [3, 1, 2]);
});

test("a full catalog verification reads every retained object once with at most four active reads", async () => {
  const { adapter, engine, transaction } = await setupCatalog();
  const { manifest } = await engine.transact(transaction);
  const catalog = await readCatalog(adapter, manifest);
  const read = adapter.readBytes.bind(adapter);
  const counts = new Map();
  let active = 0, peak = 0;
  adapter.readBytes = async (id) => {
    counts.set(id, (counts.get(id) || 0) + 1);
    peak = Math.max(peak, ++active);
    try { await tick(); return await read(id); }
    finally { active--; }
  };
  const verified = await verifyCatalogHistory(adapter, manifest);
  assert.equal(active, 0);
  assert.equal(peak, 4);
  assert.deepEqual([...verified.objects.keys()], Object.keys(catalog.entries));
  for (const entry of Object.values(catalog.entries)) assert.equal(counts.get(entry.fileId), 1);
  assert.equal(counts.get(manifest.locatorCatalog.fileId), 1);
});

function enableBatchMetadata(adapter) {
  for (const file of adapter.files.values()) file.metadata.version = "1";
  adapter.readMetadataBatch = GoogleDriveTransactionAdapter.prototype.readMetadataBatch;
}

test("batch history verification brackets every body with fresh listings and no retained metadata GETs", async () => {
  const { adapter, engine, transaction } = await setupCatalog();
  const { manifest } = await engine.transact(transaction);
  const catalog = await readCatalog(adapter, manifest);
  enableBatchMetadata(adapter);
  const read = adapter.readBytes.bind(adapter);
  const metadata = adapter.readMetadata.bind(adapter);
  const list = adapter.listChildren.bind(adapter);
  const bodies = new Map();
  const metadataIds = [];
  let lists = 0, active = 0, peak = 0;
  adapter.readMetadata = async (id) => { metadataIds.push(id); return metadata(id); };
  adapter.listChildren = async () => { lists++; return list(); };
  adapter.readBytes = async (id) => {
    bodies.set(id, (bodies.get(id) || 0) + 1);
    peak = Math.max(peak, ++active);
    try { await tick(); return await read(id); }
    finally { active--; }
  };
  await verifyCatalogHistory(adapter, manifest);
  assert.equal(lists, 2);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(metadataIds, [manifest.locatorCatalog.fileId]);
  for (const entry of Object.values(catalog.entries)) assert.equal(bodies.get(entry.fileId), 1);
  const historical = Object.values(catalog.entries).find((entry) => entry.kind === "data-object");
  adapter.files.get(historical.fileId).bytes = encode("invented changed bytes");
  await assert.rejects(verifyCatalogHistory(adapter, manifest), { code: "immutable-hash-mismatch" });
  assert.equal(lists, 3, "a later call makes a fresh initial listing and rejects corrupt bytes");
  assert.equal(active, 0, "all admitted reads finish before rejection");
});

test("batch contract and every retained binding are checked before body admission without fallback", async (t) => {
  const cases = [
    ["rejected batch", (map) => { throw Object.assign(new Error("invented batch failure"), { code: "invented-batch-failure" }); }],
    ["absent result", () => undefined],
    ["wrong result type", (map) => [...map]],
    ["missing entry", (map, id) => { map.delete(id); return map; }],
    ["extra entry", (map) => { map.set("extra-id", {}); return map; }],
    ["wrong id", (map, id) => { map.get(id).id = "wrong-id"; return map; }],
    ["missing version", (map, id) => { delete map.get(id).version; return map; }],
    ["numeric version", (map, id) => { map.get(id).version = 1; return map; }],
    ["malformed version", (map, id) => { map.get(id).version = "not-a-version"; return map; }],
    ["wrong folder", (map, id) => { map.get(id).parents = ["wrong-folder"]; return map; }],
    ["malformed parents", (map, id) => { map.get(id).parents = "invented-synthetic-folder"; return map; }],
    ["trashed", (map, id) => { map.get(id).trashed = true; return map; }],
    ["rebound hash", (map, id) => { map.get(id).appProperties.financeTrackerHash = "0".repeat(64); return map; }],
    ["rebound kind", (map, id) => { map.get(id).appProperties.financeTrackerKind = "commit-record"; return map; }],
    ["rebound transaction", (map, id) => { map.get(id).appProperties.financeTrackerTransaction = "another-transaction"; return map; }]
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => {
      const { adapter, engine, transaction } = await setupCatalog();
      const { manifest } = await engine.transact(transaction);
      const catalog = await readCatalog(adapter, manifest);
      const journal = Object.values(catalog.entries).find((entry) => entry.kind === "journal-event");
      const read = adapter.readBytes.bind(adapter);
      const metadata = adapter.readMetadata.bind(adapter);
      const metadataIds = [], bodyIds = [];
      adapter.readMetadata = async (id) => { metadataIds.push(id); return metadata(id); };
      adapter.readBytes = async (id) => { bodyIds.push(id); return read(id); };
      adapter.readMetadataBatch = async (ids) => change(new Map(ids.map((id) =>
        [id, { ...structuredClone(adapter.files.get(id).metadata), version: "1" }])), journal.fileId);
      await assert.rejects(verifyCatalogHistory(adapter, manifest));
      assert.deepEqual(metadataIds, [manifest.locatorCatalog.fileId]);
      assert.deepEqual(bodyIds, [manifest.locatorCatalog.fileId]);
    });
  }
});

test("post-body metadata bracket rejects changes made while retained body reads are in flight", async (t) => {
  const cases = [
    ["moved", (file) => { file.metadata.parents = ["another-folder"]; }, "object-location-mismatch"],
    ["trashed", (file) => { file.metadata.trashed = true; }, "object-location-mismatch"],
    ["hash", (file) => { file.metadata.appProperties.financeTrackerHash = "0".repeat(64); }, "immutable-metadata-mismatch"],
    ["kind", (file) => { file.metadata.appProperties.financeTrackerKind = "commit-record"; }, "immutable-metadata-mismatch"],
    ["transaction", (file) => { file.metadata.appProperties.financeTrackerTransaction = "rebound-transaction"; }, "immutable-metadata-mismatch"],
    ["version", (file) => { file.metadata.version = "2"; }, "immutable-version-mismatch"],
    ["body changed after read", (file) => { file.bytes = encode("invented replacement"); file.metadata.version = "2"; }, "immutable-version-mismatch"]
  ];
  for (const [name, change, code] of cases) {
    await t.test(name, async () => {
      const { adapter, engine, transaction } = await setupCatalog();
      const { manifest } = await engine.transact(transaction);
      const catalog = await readCatalog(adapter, manifest);
      const target = Object.values(catalog.entries).find((entry) => entry.kind === "journal-event");
      enableBatchMetadata(adapter);
      const read = adapter.readBytes.bind(adapter);
      let changed = false;
      adapter.readBytes = async (id) => {
        const bytes = await read(id);
        if (id === target.fileId && !changed) { changed = true; change(adapter.files.get(id)); }
        await tick();
        return bytes;
      };
      await assert.rejects(verifyCatalogHistory(adapter, manifest), { code });
      assert.equal(changed, true);
    });
  }
});

async function receiptSetup({ createStatus = 200, transportFailure = false, afterMutation } = {}) {
  const content = encode("invented immutable bytes");
  const sha256 = await hashRaw(content);
  const metadata = { id: "invented-object", parents: ["invented-folder"], trashed: false,
    appProperties: { financeTrackerKind: "snapshot-object", financeTrackerTransaction: "invented-transaction", financeTrackerHash: sha256 } };
  const counts = { create: 0, metadata: 0, media: 0 };
  const adapter = new GoogleDriveTransactionAdapter({ accessToken: async () => "invented-test-token", folderId: "invented-folder",
    visibilityAttempts: 1, visibilityDelayMs: 0, afterMutation,
    fetchImpl: async (url, options) => {
      if (options.method === "POST") {
        counts.create++;
        if (transportFailure) throw new TypeError("invented lost transport response");
        // Deliberately not the requested ID: a POST response cannot prove the readback.
        return new Response(JSON.stringify({ id: "untrusted-create-response" }), { status: createStatus });
      }
      assert.ok(String(url).includes("/files/invented-object?"));
      if (String(url).endsWith("alt=media")) { counts.media++; return new Response(content); }
      counts.metadata++;
      return new Response(JSON.stringify(metadata));
    } });
  const input = { fileId: metadata.id, name: "invented.bin", kind: "snapshot-object", transactionId: "invented-transaction", content };
  return { adapter, input, sha256, metadata, counts };
}

test("writeVerified rechecks a successful adapter receipt without duplicate network reads", async () => {
  const { adapter, input, sha256, counts } = await receiptSetup();
  const result = await writeVerified(adapter, input, async () => {});
  assert.deepEqual(result, { fileId: input.fileId, sha256 });
  assert.deepEqual(counts, { create: 1, metadata: 1, media: 1 });
});

test("exact-ID verification resolves ambiguous creates without allocating replacement IDs", async (t) => {
  for (const options of [{ createStatus: 409 }, { createStatus: 500 }, { transportFailure: true }]) {
    await t.test(JSON.stringify(options), async () => {
      const { adapter, input, counts } = await receiptSetup(options);
      adapter.allocateFileId = () => { throw new Error("must retain the exact pre-generated ID"); };
      await writeVerified(adapter, input, async () => {});
      assert.deepEqual(counts, { create: 1, metadata: 1, media: 1 });
    });
  }
});

test("a thrown afterMutation hook requires fresh exact-ID verification", async () => {
  const { adapter, input, counts } = await receiptSetup({ afterMutation: async () => { throw new Error("invented lost completion"); } });
  await writeVerified(adapter, input, async () => {});
  assert.deepEqual(counts, { create: 1, metadata: 2, media: 2 });
});

test("an ambiguous write with corrupt stored bytes does not reuse an earlier receipt", async () => {
  const { adapter, input, counts } = await receiptSetup();
  const lost = Object.assign(new Error("invented lost completion"), { code: "invented-lost-response" });
  adapter.afterMutation = async () => {
    input.content.fill(0);
    throw lost;
  };
  await assert.rejects(writeVerified(adapter, input, async () => {}), (error) => error === lost);
  assert.deepEqual(counts, { create: 1, metadata: 2, media: 2 });
});

test("adapter receipt copies exact-ID readback bytes and metadata", async () => {
  const { adapter, input, metadata, sha256 } = await receiptSetup();
  const media = input.content.slice();
  const before = media.slice();
  adapter.waitForMetadata = async () => metadata;
  adapter.readBytes = async () => media;
  const created = await adapter.createImmutable({ ...input, expectedSha256: sha256 });
  media.fill(0);
  input.content.fill(1);
  metadata.parents[0] = "other-folder";
  assert.deepEqual(created.readback.bytes, before);
  assert.deepEqual(created.readback.metadata.parents, ["invented-folder"]);
});

test("hash-only and partial create receipts fall back to remote verification", async (t) => {
  for (const receipt of [undefined, {}, { metadata: {} }, { bytes: [] }, { metadata: {}, bytes: [] }]) {
    await t.test(JSON.stringify(receipt) || "no receipt", async () => {
      const { adapter, input, sha256, counts } = await receiptSetup();
      adapter.createImmutable = async () => ({ fileId: input.fileId, sha256, readback: receipt });
      await writeVerified(adapter, input, async () => {});
      assert.deepEqual(counts, { create: 0, metadata: 1, media: 1 });
    });
  }
});

test("complete receipts must pass every metadata binding and exact-byte hash", async (t) => {
  const mutations = [
    (receipt) => { receipt.metadata.id = "wrong-id"; },
    (receipt) => { receipt.metadata.parents = ["wrong-folder"]; },
    (receipt) => { receipt.metadata.trashed = true; },
    (receipt) => { receipt.metadata.appProperties.financeTrackerHash = "0".repeat(64); },
    (receipt) => { receipt.metadata.appProperties.financeTrackerKind = "journal-event"; },
    (receipt) => { receipt.metadata.appProperties.financeTrackerTransaction = "wrong-transaction"; },
    (receipt) => { receipt.bytes[0] ^= 1; }
  ];
  for (const [index, mutate] of mutations.entries()) {
    await t.test("invalid field " + index, async () => {
      const { adapter, input, metadata, counts } = await receiptSetup();
      const readback = { metadata, bytes: input.content.slice() };
      mutate(readback);
      adapter.createImmutable = async () => ({ readback });
      await assert.rejects(writeVerified(adapter, input, async () => {}),
        { code: index === 6 ? "immutable-hash-mismatch" : "immutable-metadata-mismatch" });
      assert.deepEqual(counts, { create: 0, metadata: 0, media: 0 });
    });
  }
});

test("recovery reuses indexed journal bytes only within its operation and still closes with a full scan", async () => {
  const { adapter, engine, transaction, manifestFileId } = await setupCatalog();
  const { manifest } = await engine.transact(transaction);
  const catalog = await readCatalog(adapter, manifest);
  const read = adapter.readBytes.bind(adapter);
  const counts = new Map();
  adapter.readBytes = async (id) => { counts.set(id, (counts.get(id) || 0) + 1); return read(id); };
  const recovered = await engine.recover({ manifestFileId });
  assert.deepEqual(recovered.manifest, manifest);
  assert.ok(recovered.verified.objects instanceof Map);
  for (const entry of Object.values(catalog.entries)) assert.equal(counts.get(entry.fileId), 2);
  const historical = Object.values(catalog.entries).find((entry) => entry.kind === "data-object");
  // Returned evidence is not an engine cache; a later operation rechecks Drive.
  recovered.verified.objects.get("data-object:" + historical.identity).fill(0);
  adapter.files.get(historical.fileId).bytes = encode("invented corruption");
  await assert.rejects(engine.recover({ manifestFileId }), { code: "immutable-hash-mismatch" });
  assert.equal(engine.recoveryRequired, true);
});

test("recovery still rejects duplicate journal enumeration and rebound tags before mutation", async (t) => {
  for (const mode of ["duplicate", "hash", "transaction"]) {
    await t.test(mode, async () => {
      const { adapter, engine, transaction, manifestFileId } = await setupCatalog();
      await engine.transact(transaction);
      const list = adapter.listChildren.bind(adapter);
      adapter.listChildren = async () => {
        const files = await list();
        const journal = files.find((file) => file.appProperties.financeTrackerKind === "journal-event");
        if (mode === "duplicate") files.push(structuredClone(journal));
        if (mode === "hash") journal.appProperties.financeTrackerHash = "0".repeat(64);
        if (mode === "transaction") journal.appProperties.financeTrackerTransaction = "rebound-transaction";
        return files;
      };
      const before = adapter.mutations;
      await assert.rejects(engine.recover({ manifestFileId }));
      assert.equal(adapter.mutations, before);
      assert.equal(engine.recoveryRequired, true);
    });
  }
});

test("changed manifest during recovery's closing verification blocks further writes", async () => {
  const { adapter, engine, manifestFileId } = await setupCatalog();
  const read = adapter.readJson.bind(adapter);
  let reads = 0;
  adapter.readJson = async (id) => {
    const value = await read(id);
    return id === manifestFileId && ++reads === 2 ? { ...value, changedDuringRecovery: true } : value;
  };
  await assert.rejects(engine.recover({ manifestFileId }), { code: "base-conflict" });
  assert.equal(engine.recoveryRequired, true);
});

test("retained corruption after staging or before catalog finalization still blocks publication", async (t) => {
  for (const { boundary, batch } of [false, true].flatMap((batch) =>
    ["commit-record", "transaction-committed"].map((boundary) => ({ boundary, batch })))) {
    await t.test((batch ? "batched metadata: " : "per-file metadata: ") + boundary, async () => {
      const { adapter, engine, transaction, manifestFileId } = await setupCatalog();
      const first = await engine.transact(transaction);
      const catalog = await readCatalog(adapter, first.manifest);
      const historical = Object.values(catalog.entries).find((entry) => entry.kind === "data-object");
      if (batch) enableBatchMetadata(adapter);
      const create = adapter.createImmutable.bind(adapter);
      adapter.createImmutable = async (input) => {
        const result = await create(input);
        if (batch) adapter.files.get(input.fileId).metadata.version = "1";
        const terminal = input.kind === "journal-event" && JSON.parse(new TextDecoder().decode(input.content)).eventType === "transaction-committed";
        if (input.kind === boundary || (boundary === "transaction-committed" && terminal)) {
          adapter.files.get(historical.fileId).bytes = encode("invented retained corruption");
          if (batch) adapter.files.get(historical.fileId).metadata.version = "2";
        }
        return result;
      };
      await assert.rejects(engine.transact({ ...transaction, expectedBase: first.manifest,
        objects: [{ logicalPath: "synthetic/ledger.json", content: '{"syntheticOnly":true,"value":2}' }] }),
      (error) => error.code === "transaction-unresolved" && error.details.cause === "immutable-hash-mismatch");
      const current = await adapter.readJson(manifestFileId);
      assert.equal(current.revision, boundary === "commit-record" ? 1 : 2);
      assert.equal(current.catalogFinalizationPending === null, boundary === "commit-record");
      assert.equal(engine.recoveryRequired, true);
      await assert.rejects(engine.recover({ manifestFileId }), { code: "immutable-hash-mismatch" });
    });
  }
});
