import test from "node:test";
import assert from "node:assert/strict";
import {
  createDriveSessionAdapter,
  SESSION_MARKER_NAME,
  SESSION_MARKER_PROPERTY
} from "../js/drive-session-adapter.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function textResponse(value, status = 200) {
  return new Response(value, { status, headers: { "Content-Type": "application/json" } });
}
function record(sessionId = "session-a") {
  return {
    format: "finance-tracker-session",
    version: 1,
    sessionId,
    state: "active",
    startedAt: 1_000,
    heartbeatAt: 1_000,
    expiresAt: 121_000,
    releasedAt: null
  };
}
function file(id = "marker-1") {
  return {
    id,
    name: SESSION_MARKER_NAME,
    mimeType: "application/json",
    parents: ["folder-1"],
    appProperties: { [SESSION_MARKER_PROPERTY]: "v1" }
  };
}

test("Drive adapter treats a complete empty folder as no active marker", async () => {
  const adapter = createDriveSessionAdapter({
    accessToken: "synthetic-token",
    folderId: "folder-1",
    fetchImpl: async () => jsonResponse({ files: [], incompleteSearch: false })
  });
  assert.equal(await adapter.read(), null);
});

test("Drive adapter resolves a token-provider function before folder enumeration", async () => {
  let providerCalls = 0;
  const adapter = createDriveSessionAdapter({
    accessToken: () => { providerCalls++; return "synthetic-token"; },
    folderId: "folder-1",
    fetchImpl: async (_url, init = {}) => {
      assert.equal(init.headers.Authorization, "Bearer synthetic-token");
      return jsonResponse({ files: [], incompleteSearch: false });
    }
  });
  assert.equal(await adapter.read(), null);
  assert.equal(providerCalls, 1);
});

test("Drive adapter rejects incomplete enumeration instead of claiming no session", async () => {
  const adapter = createDriveSessionAdapter({
    accessToken: "synthetic-token",
    folderId: "folder-1",
    fetchImpl: async () => jsonResponse({ files: [], incompleteSearch: true })
  });
  await assert.rejects(adapter.read());
});

test("Drive adapter rejects duplicate markers as ambiguous", async () => {
  const adapter = createDriveSessionAdapter({
    accessToken: "synthetic-token",
    folderId: "folder-1",
    fetchImpl: async () => jsonResponse({
      files: [file("marker-1"), file("marker-2")],
      incompleteSearch: false
    })
  });
  await assert.rejects(adapter.read(), /More than one session marker/);
});

test("Drive adapter reads and parses the exact marker content", async () => {
  const expected = record();
  const adapter = createDriveSessionAdapter({
    accessToken: "synthetic-token",
    folderId: "folder-1",
    fetchImpl: async (url) => String(url).includes("alt=media")
      ? textResponse(JSON.stringify(expected))
      : jsonResponse({ files: [file()], incompleteSearch: false })
  });
  assert.deepEqual(await adapter.read(), expected);
});

test("Drive adapter fails closed on malformed marker JSON", async () => {
  const adapter = createDriveSessionAdapter({
    accessToken: "synthetic-token",
    folderId: "folder-1",
    fetchImpl: async (url) => String(url).includes("alt=media")
      ? textResponse("{bad-json")
      : jsonResponse({ files: [file()], incompleteSearch: false })
  });
  await assert.rejects(adapter.read(), /not valid JSON/);
});

test("Drive adapter creates and reads back a marker with a pre-generated ID", async () => {
  const expected = record();
  let stored = null;
  let fileStored = false;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("/files?") && target.includes("pageSize")) {
      return jsonResponse({ files: fileStored ? [file()] : [], incompleteSearch: false });
    }
    if (target.includes("/generateIds")) return jsonResponse({ ids: ["marker-1"] });
    if (target.includes("/upload/") && init.method === "POST") {
      stored = JSON.parse(await extractMultipartJson(init.body));
      fileStored = true;
      return jsonResponse({ id: "marker-1" });
    }
    if (target.includes("alt=media")) return textResponse(JSON.stringify(stored));
    throw new Error("unexpected request " + target);
  };
  const adapter = createDriveSessionAdapter({ accessToken: "synthetic-token", folderId: "folder-1", fetchImpl });
  assert.equal(await adapter.read(), null);
  await adapter.write(expected);
  assert.deepEqual(await adapter.read(), expected);
});

test("Drive adapter resolves a lost create response only by exact read-back", async () => {
  const expected = record("lost-create");
  let stored = null;
  let fileStored = false;
  let createAttempted = false;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("/files?") && target.includes("pageSize")) {
      return jsonResponse({ files: fileStored ? [file()] : [], incompleteSearch: false });
    }
    if (target.includes("/generateIds")) return jsonResponse({ ids: ["marker-1"] });
    if (target.includes("/upload/") && init.method === "POST") {
      stored = JSON.parse(await extractMultipartJson(init.body));
      fileStored = true;
      createAttempted = true;
      throw new Error("synthetic lost response after successful create");
    }
    if (target.includes("alt=media")) return textResponse(JSON.stringify(stored));
    throw new Error("unexpected request " + target);
  };
  const adapter = createDriveSessionAdapter({ accessToken: "synthetic-token", folderId: "folder-1", fetchImpl });
  await adapter.read();
  await adapter.write(expected);
  assert.equal(createAttempted, true);
  assert.deepEqual(await adapter.read(), expected);
});

test("Drive adapter resolves a lost update response only by exact read-back", async () => {
  let stored = record("old");
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("alt=media")) return textResponse(JSON.stringify(stored));
    if (target.includes("/files?") && target.includes("pageSize")) return jsonResponse({ files: [file()], incompleteSearch: false });
    if (target.includes("/upload/") && init.method === "PATCH") {
      stored = JSON.parse(init.body);
      throw new Error("synthetic lost response after successful update");
    }
    throw new Error("unexpected request " + target);
  };
  const adapter = createDriveSessionAdapter({ accessToken: "synthetic-token", folderId: "folder-1", fetchImpl });
  await adapter.read();
  const next = record("new-after-lost-response");
  await adapter.write(next);
  assert.deepEqual(stored, next);
});

test("Drive adapter updates an existing marker and verifies the replacement", async () => {
  let stored = record("old");
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("alt=media")) return textResponse(JSON.stringify(stored));
    if (target.includes("/files?") && target.includes("pageSize")) return jsonResponse({ files: [file()], incompleteSearch: false });
    if (target.includes("/upload/") && init.method === "PATCH") {
      stored = JSON.parse(init.body);
      return jsonResponse({ id: "marker-1" });
    }
    throw new Error("unexpected request " + target);
  };
  const adapter = createDriveSessionAdapter({ accessToken: "synthetic-token", folderId: "folder-1", fetchImpl });
  await adapter.read();
  const next = record("new");
  await adapter.write(next);
  assert.deepEqual(stored, next);
});

async function extractMultipartJson(blob) {
  const raw = await blob.text();
  const match = raw.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n([\s\S]*?)\r\n--/);
  if (!match) throw new Error("multipart JSON metadata not found");
  // The first JSON section is metadata; the second is the record.
  const sections = raw.split(/Content-Type: application\/json; charset=UTF-8\r\n\r\n/);
  return sections[2].split(/\r\n--/)[0];
}
