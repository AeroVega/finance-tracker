import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_FILES_ENDPOINT,
  DRIVE_UPLOAD_ENDPOINT,
  DriveFeasibilityError,
  listFolderChildren,
  createSyntheticObject,
  readRaceTarget,
  attemptConditionalWrite
} from "../js/drive-feasibility-spike.mjs";

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("folder enumeration follows every page and returns only after a complete search", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    const page = new URL(url).searchParams.get("pageToken");
    return page
      ? jsonResponse({ files: [{ id: "child-2", name: "second.txt" }], incompleteSearch: false })
      : jsonResponse({
          files: [{ id: "child-1", name: "first.txt" }],
          nextPageToken: "next-page",
          incompleteSearch: false
        });
  };

  const files = await listFolderChildren({
    accessToken: "synthetic-token",
    folderId: "synthetic-folder",
    fetchImpl
  });

  assert.deepEqual(files.map((file) => file.id), ["child-1", "child-2"]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].searchParams.get("q"), /'synthetic-folder' in parents/);
  assert.equal(calls[0].searchParams.get("pageSize"), "1000");
  assert.equal(calls[1].searchParams.get("pageToken"), "next-page");
});

test("folder enumeration fails closed when Drive marks results incomplete", async () => {
  await assert.rejects(
    listFolderChildren({
      accessToken: "synthetic-token",
      folderId: "synthetic-folder",
      fetchImpl: async () => jsonResponse({ files: [], incompleteSearch: true })
    }),
    (error) => error instanceof DriveFeasibilityError && error.code === "incomplete-search"
  );
});

test("folder enumeration fails closed when completeness metadata is missing", async () => {
  await assert.rejects(
    listFolderChildren({
      accessToken: "synthetic-token",
      folderId: "synthetic-folder",
      fetchImpl: async () => jsonResponse({ files: [] })
    }),
    (error) => error instanceof DriveFeasibilityError && error.code === "incomplete-search"
  );
});

test("folder enumeration detects a repeated page token instead of looping", async () => {
  await assert.rejects(
    listFolderChildren({
      accessToken: "synthetic-token",
      folderId: "synthetic-folder",
      fetchImpl: async () => jsonResponse({ files: [], nextPageToken: "repeat" })
    }),
    (error) => error instanceof DriveFeasibilityError && error.code === "pagination-loop"
  );
});

test("pre-generated ID retry returns 409 and verifies the exact synthetic object", async () => {
  const content = "Synthetic feasibility payload; not financial data.";
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/generateIds")) {
      return jsonResponse({ ids: ["generated-synthetic-id"] });
    }
    if (String(url).startsWith(DRIVE_UPLOAD_ENDPOINT)) {
      return calls.filter((call) => call.url.startsWith(DRIVE_UPLOAD_ENDPOINT)).length === 1
        ? jsonResponse({ id: "generated-synthetic-id" })
        : new Response(null, { status: 409 });
    }
    if (parsed.pathname.endsWith("/generated-synthetic-id") && parsed.searchParams.has("alt")) {
      return new Response(content, { status: 200 });
    }
    if (parsed.pathname.endsWith("/generated-synthetic-id")) {
      return jsonResponse({
        id: "generated-synthetic-id",
        name: "finance-tracker-spike-retry.txt",
        mimeType: "application/octet-stream",
        parents: ["synthetic-folder"],
        appProperties: { financeTrackerSpike: "synthetic-only" }
      });
    }
    throw new Error("Unexpected request: " + url);
  };

  const result = await createSyntheticObject({
    accessToken: "synthetic-token",
    folderId: "synthetic-folder",
    fileName: "finance-tracker-spike-retry.txt",
    content,
    simulateLostResponse: true,
    fetchImpl
  });

  assert.equal(result.fileId, "generated-synthetic-id");
  assert.equal(result.retryReturned409, true);
  assert.equal(result.verified, true);
  assert.equal(calls.filter((call) => call.url.startsWith(DRIVE_UPLOAD_ENDPOINT)).length, 2);
});

test("synthetic object creation rejects filenames outside the dedicated test prefix", async () => {
  await assert.rejects(
    createSyntheticObject({
      accessToken: "synthetic-token",
      folderId: "synthetic-folder",
      fileName: "finance-tracker-manifest.json",
      content: "{}",
      fetchImpl: async () => { throw new Error("Must not make a request"); }
    }),
    (error) => error instanceof DriveFeasibilityError && error.code === "unsafe-name"
  );
});

test("race-target read captures an exposed ETag and server version", async () => {
  const result = await readRaceTarget({
    accessToken: "synthetic-token",
    fileId: "synthetic-race-file",
    fetchImpl: async () => jsonResponse(
      { id: "synthetic-race-file", description: "base", version: "17" },
      200,
      { ETag: '"etag-17"' }
    )
  });
  assert.equal(result.etag, '"etag-17"');
  assert.equal(result.version, "17");
  assert.equal(result.etagVisible, true);
});

test("conditional write sends If-Match and classifies a stale-writer rejection", async () => {
  let captured;
  const result = await attemptConditionalWrite({
    accessToken: "synthetic-token",
    fileId: "synthetic-race-file",
    etag: '"etag-base"',
    writerMarker: "synthetic-writer-a",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(null, { status: 412 });
    }
  });
  assert.equal(captured.options.headers["If-Match"], '"etag-base"');
  assert.equal(captured.options.method, "PATCH");
  assert.equal(result.outcome, "precondition-failed");
  assert.equal(result.status, 412);
});

test("conditional write reports missing ETag as untestable and sends no request", async () => {
  const result = await attemptConditionalWrite({
    accessToken: "synthetic-token",
    fileId: "synthetic-race-file",
    etag: null,
    writerMarker: "synthetic-writer-a",
    fetchImpl: async () => { throw new Error("Must not make a request"); }
  });
  assert.deepEqual(result, { outcome: "etag-unavailable", status: null });
});
