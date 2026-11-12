import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createImmutablePageTree } from "../js/immutable-page-tree.mjs";
import {
  encodeFramedBackup, createFramedBackupReadableStream, writeFramedBackup,
  restoreFramedBackup, FRAMED_BACKUP_VERSION
} from "../js/framed-backup-stream.mjs";

const utf8 = new TextEncoder();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = (...pieces) => {
  const result = createHash("sha256");
  for (const piece of pieces) result.update(piece);
  return result.digest();
};
const json = value => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + json(value[key])).join(",") + "}";
};
const bytes = value => utf8.encode(json(value));
const object = value => { const data = typeof value === "string" ? utf8.encode(value) : bytes(value); return { hash: hash(data), bytes: data, descriptor:{kind:"data-object",identity:hash(data)} }; };
const top = object({ synthetic: true, value: "bounded fixture" });
const rootFor = (item = top) => ({ databaseId: "synthetic-☃", sourceCopyId: "synthetic-source",
  revision: "90071992547409931234567890", profile:"canonical5-physical4",sourceEvidence:null,canonical: { version: 5, sha256: item.hash }, catalog: null, protocol: {version:4,sha256:item.hash} });
const options = objects => ({ root: rootFor(objects[0]), objects });
const magic = Buffer.from([70, 84, 66, 83, 13, 10, 3, 0]);
const domain = name => Buffer.from("finance-tracker-framed-backup:v3:" + name + "\0");
function frame(type, header, body = new Uint8Array()) {
  const head = bytes(header), prefix = Buffer.alloc(5);
  prefix[0] = type; prefix.writeUInt32BE(head.length, 1);
  return { prefix, header: head, body, all: Buffer.concat([prefix, head, body]) };
}

// Independent Node SHA implementation and encoder. Deliberately buffers small
// test fixtures; the production module uses neither Buffer nor this inventory.
function oracle(objects = [top], root = rootFor(objects[0]), terminalOverride = {}) {
  const rootFrame = frame(1, root);
  const frames = [rootFrame, ...objects.map(item => frame(2, { hash: item.hash, byteLength: item.bytes.length,
    ...(item.descriptor ? {descriptor:item.descriptor} : {}) }, item.bytes))];
  let chain = digest(domain("start"), magic);
  for (const item of frames) {
    const frameHash = digest(domain("frame"), item.prefix, item.header, digest(item.body));
    chain = digest(domain("chain"), chain, frameHash);
  }
  const terminal = frame(255, { objectCount: String(objects.length),
    totalObjectBytes: String(objects.reduce((sum, item) => sum + BigInt(item.bytes.length), 0n)), ...terminalOverride });
  terminal.body = digest(domain("end"), chain, terminal.prefix, terminal.header);
  terminal.all = Buffer.concat([terminal.prefix, terminal.header, terminal.body]);
  return { all: Buffer.concat([magic, ...frames.map(item => item.all), terminal.all]), frames, terminal };
}

async function collect(iterable) {
  const chunks = [];
  for await (const item of iterable) chunks.push(item);
  return Buffer.concat(chunks);
}
async function* chunks(data, size = 17) {
  for (let offset = 0; offset < data.length; offset += size) yield data.subarray(offset, offset + size);
}
function stage(extra = {}) {
  const records = new Map();
  const state = { status: "fresh", begins: 0, writes: 0, reads: 0, activeWrites: 0, peakWrites: 0, largestWrite: 0, root: null };
  return {
    records, state,
    async begin({ state: status, root }) {
      state.begins++;
      assert.equal(state.status, "fresh", "reused destination");
      assert.equal(records.size, 0, "nonempty destination");
      assert.equal(status, "incomplete");
      state.status = "incomplete"; state.root = root;
    },
    async write(data) {
      assert.equal(state.status, "incomplete");
      state.writes++; state.activeWrites++;
      state.peakWrites = Math.max(state.peakWrites, state.activeWrites);
      state.largestWrite = Math.max(state.largestWrite, data.length);
      const id = hash(data);
      if (records.has(id)) assert.deepEqual(records.get(id), data);
      else records.set(id, new Uint8Array(data));
      state.activeWrites--;
      return id;
    },
    async read(id, { maxBytes }) {
      state.reads++;
      if (!records.has(id)) throw new Error("missing staged object");
      assert(records.get(id).length <= maxBytes);
      return records.get(id);
    }, ...extra
  };
}
const verifyTop = async ({ root, store }) => {
  const value = JSON.parse(new TextDecoder().decode(await store.read(root.canonical.sha256)));
  return value.synthetic === true && value.value === "bounded fixture";
};
const restore = (source, staging = stage(), extra = {}) => restoreFramedBackup({ source, staging, verifyStructure: verifyTop, ...extra });
const reason = code => error => error.code === "restore-incomplete" && error.incomplete === true && error.cause?.code === code;

test("v3 bytes match an independent framing/hash-chain oracle", async () => {
  assert.equal(FRAMED_BACKUP_VERSION, 3);
  const records = [top, object("\0arbitrary\nraw bytes\xff"), object("")];
  const output = await collect(encodeFramedBackup(options(records)));
  assert.deepEqual(output, oracle(records).all);
});

test("one-byte chunks preserve binary objects, Unicode roots and exact revision strings", async () => {
  const data = oracle([top, object("")]);
  const target = stage();
  const result = await restore(chunks(data.all, 1), target);
  assert.equal(result.state, "verified-quarantined");
  assert.equal(result.objectCount, "2");
  assert.equal(result.totalObjectBytes, String(top.bytes.length));
  assert.equal(result.root.revision, "90071992547409931234567890");
  assert.equal(target.state.status, "incomplete");
  assert.equal(result.structureVerification, "callback-completed");
  assert.deepEqual(target.records.get(top.hash), top.bytes);
  assert(Object.isFrozen(result.root) && Object.isFrozen(result.root.canonical));
});

test("huge input chunks do not become huge parser blocks", async () => {
  const records = [top, ...Array.from({ length: 30 }, (_, i) => object(String(i).padEnd(8192, "x")))];
  const data = oracle(records).all;
  const target = stage();
  const result = await restore([data], target, { limits: { maxObjectBytes: 8192 } });
  assert(data.length > 200000);
  assert(result.maxParserBlockBytes <= 8192);
  assert.equal(target.state.peakWrites, 1);
  assert.equal(target.records.size, records.length);
  for (const item of records) assert.deepEqual(target.records.get(item.hash), item.bytes);
});

test("readable stream input/output and writable stream sink honor backpressure", async () => {
  let pulls = 0, active = 0, peak = 0;
  const objects = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(top); controller.close(); } }, { highWaterMark: 0 });
  const output = createFramedBackupReadableStream({ root: rootFor(), objects });
  assert.equal(pulls, 0);
  const target = stage();
  const result = await restore(output, target);
  assert.equal(result.objectCount, "1");
  assert.equal(pulls, 1);
  const parts = [];
  const sink = new WritableStream({
    async write(data) { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); parts.push(data); active--; }
  });
  await writeFramedBackup({ ...options([top]), sink });
  assert.equal(peak, 1);
  assert.deepEqual(Buffer.concat(parts), oracle().all);
  assert.equal(sink.locked, false);
});

test("repeated identical content frames are committed and stored idempotently", async () => {
  const repeated = [top, top, top];
  const target = stage();
  const result = await restore(encodeFramedBackup(options(repeated)), target);
  assert.equal(result.objectCount, "3");
  assert.equal(result.totalObjectBytes, String(top.bytes.length * 3));
  assert.equal(target.records.size, 1);
  assert.equal(target.state.writes, 3);
});

test("source/root mutation cannot change a header or already admitted body", async () => {
  const root = rootFor(), sourceBytes = new Uint8Array(top.bytes);
  const generator = encodeFramedBackup({ root, objects: [{ ...top, bytes: sourceBytes }] });
  const parts = [(await generator.next()).value];
  root.databaseId = "changed-after-root-snapshot";
  // root prefix, root header, object prefix: body is already copied and hashed.
  for (let i = 0; i < 3; i++) parts.push((await generator.next()).value);
  sourceBytes.fill(0);
  for await (const item of generator) parts.push(item);
  assert.deepEqual(Buffer.concat(parts), oracle().all);
});

test("caller supplied content IDs and finite frame limits are enforced", async () => {
  await assert.rejects(collect(encodeFramedBackup(options([{ ...top, hash: "a".repeat(64), bytes: top.bytes }]))), { code: "object-hash-mismatch" });
  await assert.rejects(collect(encodeFramedBackup({ ...options([top]), limits: { maxObjectBytes: 1 } })), { code: "object-byte-limit" });
  await assert.rejects(collect(encodeFramedBackup({ ...options([top]), limits: { maxObjectBytes: Infinity } })), { code: "invalid-limits" });
  await assert.rejects(collect(encodeFramedBackup({ ...options([top]), limits: { maxHeaderBytes: 0 } })), { code: "invalid-limits" });
  await assert.rejects(restore([oracle().all], stage(), { limits: { maxObjectBytes: 1 } }), reason("object-byte-limit"));
});

test("decorated typed arrays cannot spoof byte limits or virtual chunk methods", async () => {
  class Decorated extends Uint8Array {
    get length() { return 0; }
    get byteLength() { return 0; }
    get byteOffset() { return 999; }
    get buffer() { throw new Error("virtual buffer getter"); }
    subarray() { throw new Error("virtual subarray"); }
    slice() { throw new Error("virtual slice"); }
  }
  const tooLarge = new Decorated(4096);
  await assert.rejects(collect(encodeFramedBackup({ ...options([top]), objects: [{ ...top, hash: "a".repeat(64), bytes: tooLarge }],
    limits: { maxObjectBytes: 64 } })), { code: "object-byte-limit" });
  const data = oracle().all;
  const result = await restore([new Decorated(data)]);
  assert.equal(result.objectCount, "1");
  const target = stage({ read: async () => tooLarge });
  await assert.rejects(restore([data], target, { limits: { maxObjectBytes: 64 } }), reason("object-byte-limit"));
  const shared = new Uint8Array(new SharedArrayBuffer(1));
  Object.defineProperty(shared, "buffer", { value: new ArrayBuffer(1) });
  await assert.rejects(restore([shared]), reason("invalid-chunk"));
});

test("oversized header prefix rejects before reading or allocating the declared header", async () => {
  let calls = 0;
  const source = { [Symbol.asyncIterator]() { return this; }, next() {
    calls++;
    if (calls === 1) return { value: magic };
    if (calls === 2) return { value: Uint8Array.of(1, 255, 255, 255, 255) };
    throw new Error("must not read huge header");
  }, return() { return { done: true }; } };
  const target = stage();
  await assert.rejects(restore(source, target), reason("header-byte-limit"));
  assert.equal(calls, 2); assert.equal(target.state.begins, 0);
});

test("unknown stream/root versions and unexpected fields cannot be adopted", async () => {
  const badMagic = Buffer.from(oracle().all); badMagic[6] = 4;
  await assert.rejects(restore([badMagic]), reason("unsupported-stream-version"));
  const invalidRoot = rootFor(); invalidRoot.canonical.version = 6;
  await assert.rejects(restore([oracle([top], invalidRoot).all]), reason("unsupported-root-version"));
  await assert.rejects(restore([oracle([top], { ...rootFor(), complete: true }).all]), reason("invalid-header"));
});

test("invalid UTF-8, BOMs, duplicate JSON keys and noncanonical headers fail", async () => {
  const base = oracle();
  for (const header of [Buffer.from([0xc0, 0xaf]), Buffer.concat([Buffer.from([239, 187, 191]), base.frames[0].header]),
    Buffer.from(new TextDecoder().decode(base.frames[0].header).replace('{"canonical":', '{"revision":"0","canonical":')),
    Buffer.concat([Buffer.from(" "), base.frames[0].header])]) {
    const prefix = Buffer.alloc(5); prefix[0] = 1; prefix.writeUInt32BE(header.length, 1);
    await assert.rejects(restore([Buffer.concat([magic, prefix, header])]), error =>
      error.code === "restore-incomplete" && ["invalid-header", "noncanonical-header"].includes(error.cause?.code));
  }
});

test("reordered, omitted and inserted frames fail the original terminal commitment", async () => {
  const archive = oracle([top, object("second"), object("third")]);
  const [root, first, second, third] = archive.frames;
  for (const frames of [[root, second, first, third], [root, first, third], [root, first, second, second, third]]) {
    await assert.rejects(restore([Buffer.concat([magic, ...frames.map(item => item.all), archive.terminal.all])]), error =>
      error.code === "restore-incomplete" && ["terminal-count-mismatch", "terminal-commitment-mismatch"].includes(error.cause?.code));
  }
});

test("forged root metadata and checksum fail even when every body hash is valid", async () => {
  const archive = oracle();
  const forgedRoot = frame(1, { ...rootFor(), sourceCopyId: "other-copy" });
  await assert.rejects(restore([Buffer.concat([magic, forgedRoot.all, archive.frames[1].all, archive.terminal.all])]), reason("terminal-commitment-mismatch"));
  const badChecksum = Buffer.from(archive.all); badChecksum[badChecksum.length - 1] ^= 1;
  await assert.rejects(restore([badChecksum]), reason("terminal-commitment-mismatch"));
});

test("terminal integer counters remain exact and reject alternate numeric forms", async () => {
  for (const value of [1, "01", "-1", "1.0", "1e0"]) {
    await assert.rejects(restore([oracle([top], rootFor(), { objectCount: value }).all]), reason("invalid-count"));
  }
  for (const value of ["9007199254740992", "9007199254740993", "999999999999999999999999999999999999"]) {
    await assert.rejects(restore([oracle([top], rootFor(), { totalObjectBytes: value }).all]), reason("terminal-count-mismatch"));
  }
});

test("each truncation boundary and extra trailing bytes leave quarantine incomplete", async () => {
  const archive = oracle();
  const cuts = new Set([0, 1, 7, 8, 9, 12, 13, archive.all.length - 1, archive.all.length - 32]);
  let offset = 8;
  for (const item of [...archive.frames, archive.terminal]) {
    cuts.add(offset); cuts.add(offset + 5); cuts.add(offset + 5 + item.header.length); offset += item.all.length;
  }
  for (const cut of cuts) {
    const target = stage();
    await assert.rejects(restore(chunks(archive.all.subarray(0, cut), 3), target), reason("truncated-stream"));
    assert.notEqual(target.state.status, "complete");
  }
  await assert.rejects(restore([archive.all, Uint8Array.of(0)]), reason("trailing-bytes"));
  const result = await restore([new Uint8Array(), archive.all, new Uint8Array()]);
  assert.equal(result.objectCount, "1");
});

test("body corruption, malformed chunks and invalid frame order cannot verify", async () => {
  const archive = oracle();
  const corrupted = Buffer.from(archive.all);
  const bodyOffset = 8 + archive.frames[0].all.length + 5 + archive.frames[1].header.length;
  corrupted[bodyOffset] ^= 1;
  await assert.rejects(restore([corrupted]), reason("object-hash-mismatch"));
  await assert.rejects(restore(["not bytes"]), reason("invalid-chunk"));
  await assert.rejects(restore([Buffer.concat([magic, archive.frames[1].all])]), reason("invalid-frame-order"));
  await assert.rejects(restore([Buffer.concat([magic, archive.frames[0].all, archive.frames[0].all])]), reason("invalid-frame-order"));
});

test("hash-valid bytes do not establish semantic validity and a verifier is mandatory", async () => {
  const forged = object({ synthetic: true, value: "forged application state" });
  const target = stage();
  await assert.rejects(restore([oracle([forged]).all], target), reason("structural-verification-failed"));
  assert.equal(target.state.status, "incomplete");
  await assert.rejects(restoreFramedBackup({ source: [], staging: stage(), verifyStructure: true }), { code: "structural-verifier-required" });
  let called = false;
  const broken = oracle(); broken.all[broken.all.length - 1] ^= 1;
  await assert.rejects(restore([broken.all], stage(), { verifyStructure: async () => { called = true; return true; } }));
  assert.equal(called, false);
});

test("verification starts only after terminal and EOF, with read-only pinned roots", async () => {
  let eof = false;
  const target = stage();
  async function* source() { yield oracle().all; eof = true; }
  await restore(source(), target, { verifyStructure: async ({ root, store }) => {
    assert.equal(eof, true);
    assert.deepEqual(Object.keys(store), ["read"]);
    assert.throws(() => { root.revision = "0"; }, TypeError);
    return verifyTop({ root, store });
  } });
});

test("a missing root or dependency cannot be borrowed from a prior partial destination", async () => {
  const missing = object("absent");
  await assert.rejects(restore([oracle([top], rootFor(missing)).all]), error => error.code === "restore-incomplete" && /missing staged object/.test(error.cause.message));
  const target = stage(); target.records.set(top.hash, top.bytes);
  await assert.rejects(restore([oracle().all], target), error => error.code === "restore-incomplete" && /nonempty destination/.test(error.cause.message));
  assert.equal(target.state.writes, 0);
});

test("a failed write that persisted bytes leaves evidence and is not retried or deleted", async () => {
  const target = stage();
  target.write = async data => { target.state.writes++; target.records.set(hash(data), new Uint8Array(data)); throw new Error("lost write response"); };
  await assert.rejects(restore([oracle().all], target), error => error.code === "restore-incomplete" && /lost write response/.test(error.cause.message));
  assert.equal(target.state.writes, 1);
  assert.equal(target.records.size, 1);
  assert.equal(target.state.status, "incomplete");
  await assert.rejects(restore([oracle().all], target), error => error.code === "restore-incomplete" && /reused destination/.test(error.cause.message));
  assert.equal(target.state.writes, 1);
});

test("read-back and returned content ID are independently checked", async () => {
  const wrongId = stage({ write: async () => "f".repeat(64) });
  await assert.rejects(restore([oracle().all], wrongId), reason("staged-object-id-mismatch"));
  const wrongBytes = stage({ read: async () => utf8.encode("corrupt") });
  await assert.rejects(restore([oracle().all], wrongBytes), reason("staged-object-hash-mismatch"));
  const oversized = stage({ read: async () => new Uint8Array(65) });
  await assert.rejects(restore([oracle().all], oversized, { limits: { maxObjectBytes: 64 } }), reason("object-byte-limit"));
});

test("sink failure closes the source and does not emit a terminal frame", async () => {
  let closed = false, pulled = 0, aborted = 0, writes = 0;
  async function* objects() { try { pulled++; yield top; pulled++; yield top; } finally { closed = true; } }
  const sink = { async write() { if (++writes === 6) throw new Error("consumer failed"); }, async abort() { aborted++; } };
  await assert.rejects(writeFramedBackup({ root: rootFor(), objects: objects(), sink }), /consumer failed/);
  assert.equal(closed, true); assert.equal(pulled, 1); assert.equal(aborted, 1);
});

test("consumer break and ReadableStream cancellation close the object source", async () => {
  let closed = 0;
  async function* objects() { try { yield top; yield top; } finally { closed++; } }
  let frames = 0;
  for await (const chunk of encodeFramedBackup({ root: rootFor(), objects: objects() })) { assert(chunk); if (++frames === 6) break; }
  assert.equal(closed, 1);
  const stream = createFramedBackupReadableStream({ root: rootFor(), objects: objects() });
  const reader = stream.getReader();
  for (let i = 0; i < 6; i++) await reader.read();
  await reader.cancel("no longer wanted");
  assert.equal(closed, 2);
});

test("direct async iteration observes cancellation at every output boundary", async () => {
  for (const boundary of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const controller = new AbortController();
    const iterator = encodeFramedBackup({ ...options([top]), signal: controller.signal });
    for (let i = 0; i < boundary; i++) await iterator.next();
    controller.abort();
    await assert.rejects(iterator.next(), { name: "AbortError" });
  }
});

test("restore cancellation drains an admitted staged write before rejecting", async () => {
  const controller = new AbortController(), target = stage();
  let release, admitted;
  const began = new Promise(resolve => { admitted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const write = target.write.bind(target);
  target.write = async data => { admitted(); await gate; return write(data); };
  let settled = false;
  const pending = restore(chunks(oracle().all), target, { signal: controller.signal }).finally(() => { settled = true; });
  await began; controller.abort();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(settled, false);
  release();
  await assert.rejects(pending, error => error.code === "restore-incomplete" && error.cause.name === "AbortError");
  assert.equal(target.records.size, 1);
  assert.equal(target.state.status, "incomplete");
});

test("cancellation unblocks a pending ReadableStream read and releases its lock", async () => {
  const controller = new AbortController(); let cancelled = 0;
  const source = new ReadableStream({ pull() {}, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const pending = restore(source, stage(), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.cause.name === "AbortError");
  assert.equal(cancelled, 1);
  assert.equal(source.locked, false);
});

test("sink cancellation drains the current write before abort", async () => {
  const controller = new AbortController(); let release, admitted, aborted = false;
  const ready = new Promise(resolve => { admitted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const pending = writeFramedBackup({ ...options([top]), signal: controller.signal,
    sink: { async write() { admitted(); await gate; }, async abort() { aborted = true; } } });
  await ready; controller.abort();
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(aborted, false);
  release(); await assert.rejects(pending, { name: "AbortError" }); assert.equal(aborted, true);
});

test("source recheck failure leaves the stream unsealed", async () => {
  const parts = [];
  await assert.rejects(writeFramedBackup({ ...options([top]), beforeSeal: async () => { throw new Error("source changed"); },
    sink: { async write(data) { parts.push(data); } } }), /source changed/);
  await assert.rejects(restore(parts), reason("truncated-stream"));
});

test("a throwing verifier drains its admitted read before the incomplete result", async () => {
  const target = stage(); let release, entered, reads = 0, settled = false;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const read = target.read.bind(target);
  target.read = async (...args) => { if (++reads === 3) { entered(); await gate; } return read(...args); };
  const pending = restore([oracle().all], target, { verifyStructure: async ({ store }) => {
    store.read(top.hash); throw new Error("verifier failed");
  } }).finally(() => { settled = true; });
  await ready; await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(settled, false);
  release(); await assert.rejects(pending, error => /verifier failed/.test(error.cause.message));
});

test("concurrent or caught failed verifier reads cannot become a verified result", async () => {
  await assert.rejects(restore([oracle().all], stage(), { verifyStructure: async ({ store }) => {
    await Promise.allSettled([store.read(top.hash), store.read(top.hash)]); return true;
  } }), reason("concurrent-verification-read"));
  await assert.rejects(restore([oracle().all], stage(), { verifyStructure: async ({ store }) => {
    await store.read("f".repeat(64)).catch(() => {}); return true;
  } }), error => error.code === "restore-incomplete" && /missing staged object/.test(error.cause.message));
});

test("a successful verifier cannot keep reading after its verification scope closes", async () => {
  let savedStore;
  await restore([oracle().all], stage(), { verifyStructure: async ({ store }) => { savedStore = store; return true; } });
  await assert.rejects(savedStore.read(top.hash), { code: "verification-closed" });
});

test("growing archives retain fixed per-object admission and exact restored bytes", async () => {
  for (const size of [1, 25, 250]) {
    const target = stage();
    async function* objects() { yield top; for (let i = 1; i < size; i++) yield object(String(i).padEnd(512, "x")); }
    const result = await restore(encodeFramedBackup({ root: rootFor(), objects: objects(), limits: { maxObjectBytes: 512 } }), target,
      { limits: { maxObjectBytes: 512 } });
    assert.equal(result.objectCount, String(size));
    assert.equal(result.totalObjectBytes, String(BigInt(top.bytes.length) + BigInt(size - 1) * 512n));
    assert(result.maxParserBlockBytes <= 512);
    assert(target.state.largestWrite <= 512);
    assert.equal(target.state.peakWrites, 1);
    assert.equal(target.records.size, size);
    for (let i = 1; i < size; i++) { const item = object(String(i).padEnd(512, "x")); assert.deepEqual(target.records.get(item.hash), item.bytes); }
  }
});

test("real immutable tree walk restores into a read-only structural verifier", async () => {
  const records = new Map();
  const sourceStore = {
    async write(data) { const id = hash(data); records.set(id, new Uint8Array(data)); return id; },
    async read(id, { maxBytes }) { const data = records.get(id); assert(data && data.length <= maxBytes); return data; }
  };
  const tree = createImmutablePageTree(sourceStore, { maxNodeBytes: 1024, maxChildren: 3, maxEntries: 3 });
  async function* entries() {
    for (let i = 0; i < 100; i++) yield [String(i).padStart(4, "0"), { amountMinor: String(i * 7), synthetic: true }];
  }
  const treeHash = await tree.build(entries());
  // This is a deliberately invented catalog schema whose entire semantics are
  // checked below, not the future production catalog-v3/history contract.
  const wrapper = object({ kind: "synthetic-test-catalog", version: 3, treeHash });
  const root = rootFor(wrapper);
  async function* objects() { yield wrapper; for await(const page of tree.walk(treeHash))yield {...page,descriptor:{kind:"data-object",identity:page.hash}}; }
  const target = stage();
  const result = await restoreFramedBackup({
    source: encodeFramedBackup({ root, objects: objects(), limits: { maxObjectBytes: 1024 } }), staging: target,
    limits: { maxObjectBytes: 1024 },
    verifyStructure: async ({ root: pinned, store }) => {
      const catalog = JSON.parse(new TextDecoder().decode(await store.read(pinned.canonical.sha256, { maxBytes: 1024 })));
      assert.equal(catalog.kind, "synthetic-test-catalog"); assert.equal(catalog.version, 3);
      const restored = createImmutablePageTree(store, { maxNodeBytes: 1024, maxChildren: 3, maxEntries: 3 });
      let nodes = 0;
      for await (const page of restored.walk(catalog.treeHash)) { assert.equal(hash(page.bytes), page.hash); nodes++; }
      assert(nodes > 10);
      let count = 0;
      for await (const [key, value] of restored.entries(catalog.treeHash)) {
        assert.equal(key, String(count).padStart(4, "0"));
        assert.deepEqual(value, { amountMinor: String(count * 7), synthetic: true }); count++;
      }
      assert.equal(count, 100);
      return true;
    }
  });
  assert.equal(result.objectCount, String(records.size + 1));
  assert.equal(target.records.size, records.size + 1);
  assert.equal(target.state.status, "incomplete");
  for (const [id, data] of records) assert.deepEqual(target.records.get(id), data);
});

test('physical4 is an explicit archive3 profile with authenticated typed object headers',async()=>{
  const item={...top,descriptor:{kind:'data-object',identity:top.hash}};
  const root={...rootFor(),profile:'canonical5-physical4',canonical:{version:5,sha256:top.hash},sourceEvidence:{version:1,sha256:top.hash},protocol:{version:4,sha256:top.hash}};
  const data=await collect(encodeFramedBackup({root,objects:[item]}));
  let observed;
  const target=stage(),write=target.write.bind(target);
  target.write=async(raw,options)=>{observed=options.descriptor;return write(raw);};
  await restore(chunks(data),target);
  assert.deepEqual(observed,item.descriptor);
  // The old exact six-field root reader refuses this additional field before
  // interpreting protocol4 as protocol3. Old descriptors are still unchanged.
  const rootHeader=JSON.parse(new TextDecoder().decode(data.subarray(13,13+data.readUInt32BE(9))));
  assert.ok(!['databaseId','sourceCopyId','revision','canonical','catalog','protocol'].includes(Object.keys(rootHeader).find(k=>k==='profile')));
  await assert.rejects(collect(encodeFramedBackup({root:{...root,profile:'unknown'},objects:[item]})),{code:'unsupported-root-profile'});
  await assert.rejects(collect(encodeFramedBackup({root:{...root,protocol:{version:3,sha256:top.hash}},objects:[item]})),{code:'unsupported-root-version'});
  const {profile,sourceEvidence,...old}=root;
  await assert.rejects(collect(encodeFramedBackup({root:old,objects:[top]})),{code:'unsupported-root-profile'});
  await assert.rejects(collect(encodeFramedBackup({root,objects:[{...item,descriptor:{kind:'data-object',identity:'invented-not-hash'}}]})),{code:'invalid-descriptor'});
});

test('canonical5-physical4 keeps transport3 and requires its exact typed profile on encode and decode',async()=>{
  const item={...top,descriptor:{kind:'data-object',identity:top.hash}};
  const root={...rootFor(),profile:'canonical5-physical4',canonical:{version:5,sha256:top.hash},sourceEvidence:null,protocol:{version:4,sha256:top.hash}};
  const encoded=await collect(encodeFramedBackup({root,objects:[item]}));
  assert.deepEqual(encoded,oracle([item],root).all);
  const target=stage();await restore(chunks(encoded,1),target);
  assert.equal(target.state.root.profile,'canonical5-physical4');
  assert.equal(target.state.root.canonical.version,5);assert.equal(FRAMED_BACKUP_VERSION,3);
  for(const [changed,code] of [
    [{...root,profile:'canonical6-physical4'},'unsupported-root-profile'],
    [{...root,profile:'canonical4-physical4'},'unsupported-root-profile'],
    [{...root,canonical:{version:4,sha256:top.hash}},'unsupported-root-version'],
    [{...root,protocol:{version:3,sha256:top.hash}},'unsupported-root-version'],
    [{...root,catalog:{version:3,sha256:top.hash}},'invalid-root'],
    [Object.fromEntries(Object.entries(root).filter(([key])=>key!=='sourceEvidence')),'invalid-root'],
    [Object.fromEntries(Object.entries(root).filter(([key])=>!['profile','sourceEvidence'].includes(key))),'unsupported-root-profile']
  ]) {
    await assert.rejects(collect(encodeFramedBackup({root:changed,objects:[item]})),{code});
    const refused=stage();
    await assert.rejects(restore([oracle([item],changed).all],refused),reason(code));
    assert.equal(refused.state.begins,0);assert.equal(refused.state.writes,0);
  }
  const {descriptor,...untyped}=top;
  await assert.rejects(restore([oracle([untyped],root).all]),reason('invalid-header'));
  await assert.rejects(collect(encodeFramedBackup({root,objects:[untyped]})),{code:'invalid-header'});
});

test('old unprofiled canonical4 protocol3 roots are rejected before any staging',async()=>{
 const {profile,sourceEvidence,...base}=rootFor();
 const root={...base,canonical:{version:4,sha256:top.hash},protocol:{version:3,sha256:top.hash}};
 await assert.rejects(collect(encodeFramedBackup({root,objects:[top]})),{code:'unsupported-root-profile'});
 const target=stage();await assert.rejects(restore([oracle([top],root).all],target),reason('unsupported-root-profile'));
 assert.equal(target.state.begins,0);assert.equal(target.state.writes,0);
});
