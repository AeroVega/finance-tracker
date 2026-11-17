import test from "node:test";
import assert from "node:assert/strict";
import { validateGoogleConfig } from "../js/google-config-validation.mjs";
import {DRIVE_FILES_ENDPOINT,DriveFeasibilityError,listFolderChildren} from "../js/drive-feasibility-spike.mjs";

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
      fetchImpl: async () => jsonResponse({ files: [], nextPageToken: "repeat", incompleteSearch: false })
    }),
    (error) => error instanceof DriveFeasibilityError && error.code === "pagination-loop"
  );
});

test("Google configuration accepts a populated numeric project number", () => {
  assert.doesNotThrow(() => validateGoogleConfig({
    clientId: "synthetic-client-id",
    apiKey: "synthetic-picker-key",
    projectNumber: "863907870950"
  }));
});

test("Google configuration rejects a missing project number", () => {
  assert.throws(
    () => validateGoogleConfig({
      clientId: "synthetic-client-id",
      apiKey: "synthetic-picker-key",
      projectNumber: ""
    }),
    /project number is missing or invalid/
  );
});

test("Google configuration rejects a nonnumeric project number", () => {
  assert.throws(
    () => validateGoogleConfig({
      clientId: "synthetic-client-id",
      apiKey: "synthetic-picker-key",
      projectNumber: "8639abc"
    }),
    /project number is missing or invalid/
  );
});
