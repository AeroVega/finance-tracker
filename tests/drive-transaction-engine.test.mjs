import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {GoogleDriveTransactionAdapter} from "../js/drive-transaction-engine.mjs";
const cryptoImpl=globalThis.crypto||webcrypto;
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
