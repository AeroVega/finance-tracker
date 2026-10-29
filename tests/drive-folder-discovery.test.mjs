import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_FILES_ENDPOINT,
  FOLDER_MIME_TYPE,
  discoverFoldersByExactName
} from "../js/drive-folder-discovery.mjs";

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload
  };
}

const base = {
  accessToken: "synthetic-access-token",
  folderName: "finance-tracker-database"
};

test("finds one exact folder match and returns its metadata for comparison", async () => {
  let request;
  const result = await discoverFoldersByExactName({
    ...base,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return response(200, {
        files: [{
          id: "synthetic-folder-id",
          name: base.folderName,
          mimeType: FOLDER_MIME_TYPE
        }]
      });
    }
  });

  const parsed = new URL(request.url);
  assert.equal(parsed.origin + parsed.pathname, DRIVE_FILES_ENDPOINT);
  assert.match(parsed.searchParams.get("q"), /trashed = false/);
  assert.match(parsed.searchParams.get("q"), /mimeType = /);
  assert.equal(parsed.searchParams.get("fields"), "nextPageToken,files(id,name,mimeType)");
  assert.equal(request.init.headers.Authorization, "Bearer synthetic-access-token");
  assert.equal(result.matchCount, 1);
  assert.equal(result.match.id, "synthetic-folder-id");
});

test("returns zero matches without guessing", async () => {
  const result = await discoverFoldersByExactName({
    ...base,
    fetchImpl: async () => response(200, { files: [] })
  });
  assert.equal(result.matchCount, 0);
  assert.equal(result.match, null);
});

test("reports multiple exact matches as ambiguous instead of choosing one", async () => {
  const result = await discoverFoldersByExactName({
    ...base,
    fetchImpl: async () => response(200, {
      files: [
        { id: "folder-a", name: base.folderName, mimeType: FOLDER_MIME_TYPE },
        { id: "folder-b", name: base.folderName, mimeType: FOLDER_MIME_TYPE }
      ]
    })
  });
  assert.equal(result.matchCount, 2);
  assert.equal(result.match, null);
});

test("follows pagination before deciding whether the name is unique", async () => {
  const urls = [];
  const result = await discoverFoldersByExactName({
    ...base,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return response(200, {
          nextPageToken: "synthetic-next-page",
          files: [{ id: "folder-a", name: base.folderName, mimeType: FOLDER_MIME_TYPE }]
        });
      }
      return response(200, {
        files: [{ id: "folder-b", name: base.folderName, mimeType: FOLDER_MIME_TYPE }]
      });
    }
  });
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("pageToken"), "synthetic-next-page");
  assert.equal(result.matchCount, 2);
  assert.equal(result.match, null);
});

test("rejects malformed response shapes", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => response(200, {}) }),
    /unexpected response/
  );
});

test("surfaces HTTP errors without leaking request credentials", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => response(403, {}) }),
    /HTTP 403/
  );
});

test("requires token and exact folder name", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ folderName: base.folderName, fetchImpl: async () => response(200, { files: [] }) }),
    /access token is required/
  );
  await assert.rejects(
    discoverFoldersByExactName({ accessToken: "synthetic-access-token", fetchImpl: async () => response(200, { files: [] }) }),
    /exact folder name/
  );
});
