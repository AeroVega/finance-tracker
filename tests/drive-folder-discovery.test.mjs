import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_FILES_ENDPOINT,
  FOLDER_MIME_TYPE,
  DriveFolderDiscoveryError,
  classifyFolderDiscoveryResult,
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

test("finds one exact folder match but leaves identity verification to the caller", async () => {
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

  const decision = classifyFolderDiscoveryResult(result);
  assert.equal(decision.status, "candidate-found");
  assert.equal(decision.requiresIdentityVerification, true);
  assert.equal(decision.candidate.id, "synthetic-folder-id");
});

test("zero matches are not-found and explicitly permit Picker fallback", () => {
  const decision = classifyFolderDiscoveryResult({ matchCount: 0, match: null });
  assert.equal(decision.status, "not-found");
  assert.equal(decision.mayUsePicker, true);
  assert.equal(decision.candidate, null);
});

test("multiple matches are ambiguous and explicitly permit Picker fallback", () => {
  const decision = classifyFolderDiscoveryResult({ matchCount: 2, match: null });
  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.mayUsePicker, true);
  assert.equal(decision.candidate, null);
});

test("invalid single-match results are never accepted as a candidate", () => {
  const decision = classifyFolderDiscoveryResult({ matchCount: 1, match: null });
  assert.equal(decision.status, "invalid-result");
  assert.equal(decision.mayUsePicker, true);
  assert.equal(decision.candidate, null);
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
  assert.equal(classifyFolderDiscoveryResult(result).status, "ambiguous");
});

test("rejects malformed response shapes with a safe typed error", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => response(200, {}) }),
    (error) => error instanceof DriveFolderDiscoveryError && error.code === "invalid-response"
  );
});

test("classifies expired authorization separately", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => response(401, {}) }),
    (error) => error.code === "authorization-required" && error.status === 401 && /Reconnect with Google/.test(error.message)
  );
});

test("classifies permission denial separately and does not leak credentials", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => response(403, {}) }),
    (error) => error.code === "permission-denied" && error.status === 403 &&
      !error.message.includes(base.accessToken)
  );
});

test("classifies other HTTP errors without selecting a folder", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => response(500, {}) }),
    (error) => error.code === "http-error" && error.status === 500
  );
});

test("classifies network failures without exposing the request", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ ...base, fetchImpl: async () => { throw new Error("secret transport detail"); } }),
    (error) => error.code === "network-error" && !error.message.includes("secret transport detail")
  );
});

test("requires token and exact folder name", async () => {
  await assert.rejects(
    discoverFoldersByExactName({ folderName: base.folderName, fetchImpl: async () => response(200, { files: [] }) }),
    (error) => error.code === "missing-token"
  );
  await assert.rejects(
    discoverFoldersByExactName({ accessToken: base.accessToken, fetchImpl: async () => response(200, { files: [] }) }),
    (error) => error.code === "missing-folder-name"
  );
});
