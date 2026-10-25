import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVE_FILES_ENDPOINT,
  DRIVE_UPLOAD_ENDPOINT,
  createSyntheticProbePayload,
  runSyntheticDriveProbe
} from "../js/drive-probe-core.mjs";

function fakeResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload
  };
}

const fixed = {
  accessToken: "synthetic-token",
  folderId: "synthetic-folder-id",
  runId: "run-123",
  createdAt: "2026-10-21T12:00:00.000Z",
  confirmDelete: async () => true
};

test("writes, reads back, verifies, then asks and deletes only its synthetic file", async () => {
  const calls = [];
  const payload = createSyntheticProbePayload(fixed.runId, fixed.createdAt);
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(DRIVE_UPLOAD_ENDPOINT)) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer synthetic-token");
      assert.match(init.body, /"parents":\["synthetic-folder-id"\]/);
      assert.match(init.body, /Synthetic test transaction/);
      return fakeResponse(200, { id: "temporary-file-id", name: "synthetic.json" });
    }
    if (String(url).startsWith(DRIVE_FILES_ENDPOINT + "/temporary-file-id?alt=media")) {
      assert.equal(init.method, "GET");
      return fakeResponse(200, payload);
    }
    if (String(url) === DRIVE_FILES_ENDPOINT + "/temporary-file-id") {
      assert.equal(init.method, "DELETE");
      return fakeResponse(204, null);
    }
    throw new Error("Unexpected Drive request: " + String(url));
  };
  let confirmed = false;
  const result = await runSyntheticDriveProbe(Object.assign({}, fixed, {
    fetchImpl,
    confirmDelete: async (info) => {
      confirmed = info.fileName.startsWith("finance-tracker-drive-probe-");
      assert.equal(info.roundTripVerified, true);
      return confirmed;
    }
  }));

  assert.equal(result.roundTripVerified, true);
  assert.equal(result.cleanedUp, true);
  assert.equal(result.cleanupSkipped, false);
  assert.equal(confirmed, true);
  assert.equal(calls.length, 3);
});

test("asks before deletion and leaves the probe file when confirmation is declined", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(DRIVE_UPLOAD_ENDPOINT)) return fakeResponse(200, { id: "leftover-id" });
    if (String(url).includes("?alt=media")) {
      return fakeResponse(200, createSyntheticProbePayload(fixed.runId, fixed.createdAt));
    }
    throw new Error("Delete must not run without confirmation.");
  };
  const result = await runSyntheticDriveProbe(Object.assign({}, fixed, {
    fetchImpl,
    confirmDelete: async () => false
  }));

  assert.equal(result.roundTripVerified, true);
  assert.equal(result.cleanedUp, false);
  assert.equal(result.cleanupSkipped, true);
  assert.equal(calls.length, 2);
});

test("deletes its own temporary file after mismatched read-back when confirmed", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(DRIVE_UPLOAD_ENDPOINT)) return fakeResponse(200, { id: "mismatch-id" });
    if (String(url).includes("?alt=media")) return fakeResponse(200, { kind: "unexpected" });
    if (String(url) === DRIVE_FILES_ENDPOINT + "/mismatch-id") return fakeResponse(204, null);
    throw new Error("Unexpected Drive request: " + String(url));
  };

  await assert.rejects(
    runSyntheticDriveProbe(Object.assign({}, fixed, { fetchImpl })),
    /read-back did not match/
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.method, "DELETE");
});

test("reports cleanup failure while preserving verified read/write result", async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith(DRIVE_UPLOAD_ENDPOINT)) return fakeResponse(200, { id: "cleanup-failed-id" });
    if (String(url).includes("?alt=media")) {
      return fakeResponse(200, createSyntheticProbePayload(fixed.runId, fixed.createdAt));
    }
    if (String(url) === DRIVE_FILES_ENDPOINT + "/cleanup-failed-id") return fakeResponse(403, {});
    throw new Error("Unexpected Drive request: " + String(url));
  };
  const result = await runSyntheticDriveProbe(Object.assign({}, fixed, { fetchImpl }));

  assert.equal(result.roundTripVerified, true);
  assert.equal(result.cleanedUp, false);
  assert.equal(result.cleanupSkipped, false);
  assert.equal(result.leftoverFileId, "cleanup-failed-id");
});
