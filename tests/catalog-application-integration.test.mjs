import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationStorageLifecycle } from "../js/application-storage-lifecycle.mjs";
import { findOrCreateManifest, createSnapshotTransaction } from "../js/dashboard-synthetic-storage.mjs";

/** Synthetic HTTP provider exercises the real adapters, sessions and lifecycle. */
class DriveHttp {
  constructor() { this.files = new Map(); this.nextId = 0; this.denied = 0; }
  fetch = async (url, options = {}) => {
    if (this.denied) return Response.json({ error: "invented-authorization-failure" }, { status: this.denied });
    const parsed = new URL(url);
    const method = options.method || "GET";
    if (parsed.pathname.endsWith("/generateIds")) return Response.json({ ids: ["invented-file-" + ++this.nextId] });
    const fileId = parsed.pathname.split("/files/")[1];
    if (!fileId && method === "GET") return Response.json({ incompleteSearch: false, files: [...this.files.values()].map((file) => file.metadata) });
    if (method === "POST" || method === "PATCH") {
      let metadata;
      let content;
      const type = options.headers?.["Content-Type"] || "";
      const body = typeof options.body === "string" ? options.body : options.body instanceof Blob ? await options.body.text() : new TextDecoder().decode(options.body);
      if (type.includes("multipart")) {
        const boundary = type.split("boundary=")[1];
        const parts = body.split("--" + boundary);
        metadata = JSON.parse(parts[1].split("\r\n\r\n")[1].trim());
        content = parts[2].slice(parts[2].indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
      } else { metadata = {}; content = body; }
      const id = fileId || metadata.id;
      const previous = this.files.get(id)?.metadata || {};
      const file = { metadata: { ...previous, ...metadata, id, version: String(Number(previous.version || 0) + 1), trashed: false }, content };
      this.files.set(id, file);
      return Response.json(file.metadata);
    }
    const file = this.files.get(fileId);
    if (!file) return Response.json({ error: "invented-not-found" }, { status: 404 });
    return parsed.searchParams.get("alt") === "media" ? new Response(file.content) : Response.json(file.metadata);
  };
}

function setup() {
  const provider = new DriveHttp();
  const lifecycle = new ApplicationStorageLifecycle({ syntheticOnly: true, catalogProtocol: true, folderName: "Invented synthetic folder",
    folderId: "invented-folder", accessToken: () => "invented-token", fetchImpl: provider.fetch, isOnline: () => true,
    makeManifest: () => { throw new Error("The new engine must own manifest publication"); },
    initializeManifest: ({ adapter, guard }) => findOrCreateManifest(adapter, guard), lifecycleTarget: null,
    setIntervalImpl: () => 1, clearIntervalImpl: () => {} });
  return { provider, lifecycle };
}

test("real Drive adapters bootstrap through the session gate, save, release, and reopen catalog-backed dashboard state", async () => {
  const { provider, lifecycle } = setup();
  await lifecycle.start();
  assert.equal(lifecycle.state, "ready");
  const manifest = await lifecycle.readManifest();
  const rows = [{ id: "invented-row", description: "Invented", date: "2026-11-03", amount: 1, syntheticOnly: true }];
  await lifecycle.transact({ manifestFileId: lifecycle.manifestFileId, ...createSnapshotTransaction({ manifest, transactions: rows }) });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await lifecycle.readObject("synthetic/dashboard-transactions.json"))).transactions, rows);
  const manifestFileId = lifecycle.manifestFileId;
  await lifecycle.release();
  const reopened = setup().lifecycle;
  reopened.fetchImpl = provider.fetch;
  await reopened.start();
  assert.equal(reopened.manifestFileId, manifestFileId);
  assert.equal((await reopened.readManifest()).revision, 1);
  await reopened.release();
});

for (const status of [401, 403]) test("HTTP " + status + " disables writes and cannot turn into an empty/new database", async () => {
  const { lifecycle, provider } = setup();
  await lifecycle.start();
  const before = provider.files.size;
  provider.denied = status;
  await assert.rejects(lifecycle.readManifest(), { code: "ownership-lost" });
  assert.equal(lifecycle.acceptingWrites, false);
  assert.equal(lifecycle.engine.recoveryRequired, true);
  assert.equal(provider.files.size, before);
  await assert.rejects(lifecycle.transact({}), { code: "storage-not-ready" });
  provider.denied = 0;
  await lifecycle.handleOnline();
  assert.equal(lifecycle.state, "ready");
  assert.equal(provider.files.size, before);
  await lifecycle.release();
});

test("PR25 refuses PR24-format synthetic folders without changing them", async () => {
  const legacyManifest = {
    format: "finance-tracker-manifest", manifestVersion: "1.0.0", schemaVersion: 1,
    syntheticOnly: true, databaseId: "invented-db", copyId: "invented-pr24-copy",
    role: "primary", revision: 0, commitId: "invented-legacy-commit", snapshot: {}
  };
  let reads = 0;
  const adapter = {
    listChildren: async () => [{ id: "invented-manifest-id", name: "ft-synthetic-dashboard-manifest.json",
      appProperties: { financeTrackerKind: "dashboard-synthetic-manifest" } }],
    readJson: async () => { reads += 1; return legacyManifest; }
  };
  await assert.rejects(findOrCreateManifest(adapter, async () => {}), {
    code: "unsupported-folder-format"
  });
  assert.equal(reads, 1);
});

test("PR25 refuses an unrecognized nonempty folder rather than initializing over old contents", async () => {
  let reads = 0;
  const adapter = {
    listChildren: async () => [{ id: "invented-old-object", name: "old-pr24-object.json",
      appProperties: { financeTrackerKind: "snapshot-object" } }],
    readJson: async () => { reads += 1; throw new Error("Unexpected manifest read"); }
  };
  await assert.rejects(findOrCreateManifest(adapter, async () => {}), { code: "nonempty-folder" });
  assert.equal(reads, 0);
});
