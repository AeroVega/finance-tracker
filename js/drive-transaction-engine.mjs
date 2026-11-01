import {
  canonicalizeJcs,
  createJournalEvent,
  verifyJournal,
  classifyTransactionRecovery
} from "./transaction-protocol.mjs";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const MIME_JSON = "application/json";
const TAG = "financeTracker";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DriveTransactionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DriveTransactionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new DriveTransactionError(code, message, details);
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  fail("invalid-content", "Transaction content must be text or bytes.");
}

async function hashBytes(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) fail("crypto-unavailable", "Web Crypto SHA-256 is unavailable.");
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

function joinBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export class GoogleDriveTransactionAdapter {
  constructor({ accessToken, folderId, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto,
    onRequest = null, visibilityAttempts = 5, visibilityDelayMs = 250 }) {
    if (typeof accessToken !== "function" || !folderId || typeof fetchImpl !== "function") {
      fail("invalid-adapter-config", "An access-token provider, selected folder, and fetch implementation are required.");
    }
    this.accessToken = accessToken;
    this.folderId = folderId;
    this.fetch = fetchImpl;
    this.crypto = cryptoImpl;
    this.onRequest = onRequest;
    this.visibilityAttempts = visibilityAttempts;
    this.visibilityDelayMs = visibilityDelayMs;
  }

  async request(url, options = {}, { allowStatuses = [] } = {}) {
    const token = await this.accessToken();
    if (!token) fail("authorization-required", "Google Drive authorization is unavailable.");
    const response = await this.fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    this.onRequest?.({ method: options.method || "GET", url: String(url), status: response.status });
    if (!response.ok && !allowStatuses.includes(response.status)) {
      const body = await response.text().catch(() => "");
      fail(response.status === 401 || response.status === 403 ? "authorization-required" : "drive-request-failed",
        `Google Drive request failed (HTTP ${response.status}).`, { status: response.status, body: body.slice(0, 500) });
    }
    return response;
  }

  async allocateFileId() {
    const response = await this.request(`${API}/files/generateIds?count=1&space=drive`);
    const result = await response.json();
    if (!Array.isArray(result.ids) || result.ids.length !== 1 || typeof result.ids[0] !== "string") {
      fail("invalid-generated-id", "Google Drive did not return exactly one pre-generated file ID.");
    }
    return result.ids[0];
  }

  async listChildren() {
    const all = [];
    const seen = new Set();
    let pageToken = null;
    do {
      const query = new URLSearchParams({
        q: `'${this.folderId}' in parents and trashed = false`,
        pageSize: "1000",
        fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,appProperties,version)"
      });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.request(`${API}/files?${query}`);
      const page = await response.json();
      if (page.incompleteSearch !== false || !Array.isArray(page.files)) {
        fail("incomplete-folder-enumeration", "Drive did not confirm complete folder enumeration.");
      }
      all.push(...page.files);
      pageToken = page.nextPageToken || null;
      if (pageToken && seen.has(pageToken)) fail("pagination-loop", "Drive repeated a folder pagination token.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return all;
  }

  async readMetadata(fileId) {
    const query = new URLSearchParams({ fields: "id,name,mimeType,parents,appProperties,size,version,trashed" });
    const response = await this.request(`${API}/files/${encodeURIComponent(fileId)}?${query}`);
    const metadata = await response.json();
    if (metadata.id !== fileId || metadata.trashed || !metadata.parents?.includes(this.folderId)) {
      fail("object-location-mismatch", "A transaction file is missing, trashed, or outside the selected database folder.", { fileId });
    }
    return metadata;
  }

  async readBytes(fileId) {
    const response = await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async readJson(fileId) {
    const bytes = await this.readBytes(fileId);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      fail("invalid-json-object", "A stored transaction record is not valid JSON.", { fileId });
    }
  }

  async waitForMetadata(fileId) {
    let lastError;
    for (let attempt = 0; attempt < this.visibilityAttempts; attempt += 1) {
      try {
        return await this.readMetadata(fileId);
      } catch (error) {
        lastError = error;
        if (error.code !== "drive-request-failed" || error.details?.status !== 404) throw error;
        if (attempt + 1 < this.visibilityAttempts) await sleep(this.visibilityDelayMs * (2 ** attempt));
      }
    }
    throw new DriveTransactionError("visibility-timeout", "A newly written Drive file did not become visible in time.", {
      fileId, cause: lastError?.code
    });
  }

  async createImmutable({ fileId, name, kind, transactionId, content, expectedSha256 }) {
    const bytes = bytesOf(content);
    const actualHash = await hashBytes(bytes, this.crypto);
    if (actualHash !== expectedSha256) fail("content-hash-mismatch", "The bytes do not match the planned SHA-256.", { name });
    const boundary = `ft-${fileId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const metadata = {
      id: fileId,
      name,
      mimeType: "application/json",
      parents: [this.folderId],
      appProperties: { [TAG + "Kind"]: kind, [TAG + "Transaction"]: transactionId, [TAG + "Hash"]: actualHash }
    };
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${MIME_JSON}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = joinBytes([head, bytes, tail]);
    const url = `${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,parents,appProperties`;
    const response = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    }, { allowStatuses: [409] });

    // A 409, a lost response, or a successful response all resolve through the same
    // exact-ID read-back path. Never allocate a replacement ID for a retry.
    const metadataAfter = await this.waitForMetadata(fileId);
    if (metadataAfter.appProperties?.[TAG + "Kind"] !== kind ||
        metadataAfter.appProperties?.[TAG + "Transaction"] !== transactionId ||
        metadataAfter.appProperties?.[TAG + "Hash"] !== actualHash) {
      fail("immutable-metadata-mismatch", "The pre-generated Drive ID contains unexpected transaction metadata.", { fileId });
    }
    const stored = await this.readBytes(fileId);
    const storedHash = await hashBytes(stored, this.crypto);
    if (storedHash !== actualHash || stored.length !== bytes.length) {
      fail("immutable-readback-mismatch", "The immutable Drive object failed exact byte verification.", { fileId });
    }
    return { fileId, sha256: actualHash, size: bytes.length };
  }

  async appendJournal(event, fileId) {
    const content = canonicalizeJcs(event);
    const sha256 = await hashBytes(new TextEncoder().encode(content), this.crypto);
    return this.createImmutable({
      fileId, name: `ft-journal-${event.transactionId}-${String(event.sequence).padStart(6, "0")}.json`,
      kind: "journal-event", transactionId: event.transactionId, content, expectedSha256: sha256
    });
  }

  async publishManifest(manifestFileId, manifest) {
    const content = canonicalizeJcs(manifest);
    const bytes = new TextEncoder().encode(content);
    const boundary = `ft-manifest-${manifest.revision}`;
    const metadata = { mimeType: MIME_JSON };
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${MIME_JSON}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    await this.request(`${UPLOAD}/files/${encodeURIComponent(manifestFileId)}?uploadType=multipart&fields=id,name,mimeType,parents,appProperties`, {
      method: "PATCH",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: joinBytes([head, bytes, tail])
    });
    const visible = await this.readBytes(manifestFileId);
    if (new TextDecoder().decode(visible) !== content) {
      fail("manifest-readback-mismatch", "The published manifest did not read back exactly.");
    }
    return manifest;
  }
}

export class DriveTransactionEngine {
  constructor({ adapter, assertWritable, isOnline = () => globalThis.navigator?.onLine !== false,
    cryptoImpl = globalThis.crypto, now = () => new Date().toISOString() }) {
    if (!adapter || typeof assertWritable !== "function") {
      fail("invalid-engine-config", "A Drive adapter and session-ownership verifier are required.");
    }
    this.adapter = adapter;
    this.assertWritable = assertWritable;
    this.isOnline = isOnline;
    this.crypto = cryptoImpl;
    this.now = now;
    this.queue = Promise.resolve();
    this.recoveryRequired = false;
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => {});
    return run;
  }

  async guard() {
    if (!this.isOnline()) fail("offline", "Drive transactions are unavailable while offline.");
    if (this.recoveryRequired) fail("recovery-required", "An unresolved transaction blocks further writes.");
    await this.assertWritable();
  }

  async transact({ manifestFileId, expectedBase, objects, commitRecord, makeManifest, transactionId = this.crypto.randomUUID() }) {
    return this.enqueue(async () => {
      await this.guard();
      if (!Array.isArray(objects) || !objects.length || typeof makeManifest !== "function") {
        fail("invalid-transaction", "A transaction requires changed objects and a manifest builder.");
      }
      const current = await this.adapter.readJson(manifestFileId);
      if (current.revision !== expectedBase.revision || current.commitId !== expectedBase.commitId ||
          current.databaseId !== expectedBase.databaseId || current.copyId !== expectedBase.copyId) {
        fail("base-conflict", "The database manifest no longer matches the expected base revision and commit.");
      }
      const planned = [];
      for (const object of objects) {
        const bytes = bytesOf(object.content);
        planned.push({
          ...object,
          bytes,
          sha256: await hashBytes(bytes, this.crypto),
          fileId: await this.adapter.allocateFileId()
        });
      }
      const commitId = this.crypto.randomUUID();
      const commitFileId = await this.adapter.allocateFileId();
      const events = [];
      let previousEventHash = null;
      const eventFileIds = [];
      const addEvent = async (eventType, payload) => {
        const event = await createJournalEvent({
          transactionId, eventId: this.crypto.randomUUID(), sequence: events.length,
          eventType, timestamp: this.now(), payload, previousEventHash, cryptoImpl: this.crypto
        });
        const eventFileId = await this.adapter.allocateFileId();
        await this.adapter.appendJournal(event, eventFileId);
        events.push(event);
        eventFileIds.push(eventFileId);
        previousEventHash = event.eventHash;
        return event;
      };

      try {
        await addEvent("transaction-started", {
          operationType: commitRecord.operationType || "update",
          baseRevision: current.revision, baseCommitId: current.commitId,
          intendedRevision: current.revision + 1, intendedCommitId: commitId
        });
        for (const item of planned) {
          await addEvent("object-stage-planned", {
            logicalPath: item.logicalPath, fileId: item.fileId, sha256: item.sha256
          });
          await this.guard();
          await this.adapter.createImmutable({
            fileId: item.fileId, name: `ft-object-${item.sha256}.bin`,
            kind: "snapshot-object", transactionId, content: item.bytes, expectedSha256: item.sha256
          });
          await addEvent("object-staged", { fileId: item.fileId, sha256: item.sha256 });
        }
        const snapshot = { ...(commitRecord.snapshot || {}) };
        for (const item of planned) snapshot[item.logicalPath] = { fileId: item.fileId, sha256: item.sha256 };
        const record = {
          ...commitRecord,
          format: "finance-tracker-commit",
          version: 1,
          databaseId: current.databaseId,
          copyId: current.copyId,
          commitId,
          parentCommitId: current.commitId,
          revision: current.revision + 1,
          transactionId,
          committedAt: this.now(),
          snapshot
        };
        const recordText = canonicalizeJcs(record);
        const recordHash = await hashBytes(new TextEncoder().encode(recordText), this.crypto);
        await addEvent("commit-stage-planned", { commitId });
        await this.guard();
        await this.adapter.createImmutable({
          fileId: commitFileId, name: `ft-commit-${commitId}.json`,
          kind: "commit-record", transactionId, content: recordText, expectedSha256: recordHash
        });
        await addEvent("commit-staged", { commitId, recordHash });
        const nextManifest = await makeManifest({
          current, record, commitFileId, commitHash: recordHash, snapshot
        });
        await addEvent("manifest-publication-planned", {
          baseRevision: current.revision, baseCommitId: current.commitId,
          intendedRevision: nextManifest.revision, intendedCommitId: commitId
        });
        await this.guard();
        const latest = await this.adapter.readJson(manifestFileId);
        if (latest.revision !== current.revision || latest.commitId !== current.commitId) {
          fail("base-conflict", "The manifest changed before publication.");
        }
        await this.adapter.publishManifest(manifestFileId, nextManifest);
        await addEvent("manifest-published", { commitId });
        await addEvent("transaction-committed", { commitId });
        return { transactionId, commitId, revision: nextManifest.revision, manifest: nextManifest };
      } catch (error) {
        this.recoveryRequired = true;
        throw new DriveTransactionError("transaction-unresolved",
          "The transaction did not reach a fully verified terminal state. Preserve its files and run recovery before another write.",
          { transactionId, cause: error.code || error.name || "unknown", journalEventCount: events.length });
      }
    });
  }

  async recover({ manifestFileId }) {
    return this.enqueue(async () => {
      if (!this.isOnline()) fail("offline", "Recovery requires an online Drive connection.");
      await this.assertWritable();
      const manifest = await this.adapter.readJson(manifestFileId);
      const files = await this.adapter.listChildren();
      const journalFiles = files.filter((file) => file.appProperties?.[TAG + "Kind"] === "journal-event");
      const groups = new Map();
      for (const file of journalFiles) {
        const event = await this.adapter.readJson(file.id);
        if (!groups.has(event.transactionId)) groups.set(event.transactionId, []);
        groups.get(event.transactionId).push(event);
      }
      const outcomes = [];
      for (const [transactionId, events] of groups) {
        events.sort((a, b) => a.sequence - b.sequence);
        const state = await verifyJournal(events, { cryptoImpl: this.crypto });
        if (state.transactionId !== transactionId) fail("journal-identity-mismatch", "A journal group contains inconsistent transaction IDs.");
        const decision = classifyTransactionRecovery({ journalState: state, manifest });
        if (decision.action === "already-terminal") {
          outcomes.push({ transactionId, ...decision });
          continue;
        }
        // This first engine iteration deliberately does not auto-publish or discard
        // an incomplete transaction during recovery. It verifies evidence and fails
        // closed until the complete commit/object resolver can prove the outcome.
        if (decision.action === "verify-intended-commit") {
          const commitFile = files.find((file) =>
            file.appProperties?.[TAG + "Kind"] === "commit-record" &&
            file.appProperties?.[TAG + "Transaction"] === transactionId);
          if (!commitFile) fail("missing-commit-record", "The manifest points to a transaction whose immutable commit record is missing.");
          const record = await this.adapter.readJson(commitFile.id);
          const expected = state.commit?.recordHash;
          const actual = await hashBytes(new TextEncoder().encode(canonicalizeJcs(record)), this.crypto);
          if (actual !== expected || record.commitId !== manifest.commitId) {
            fail("commit-verification-failed", "The published commit record failed verification.");
          }
          for (const reference of Object.values(record.snapshot || {})) {
            const bytes = await this.adapter.readBytes(reference.fileId);
            if (await hashBytes(bytes, this.crypto) !== reference.sha256) {
              fail("snapshot-object-verification-failed", "A committed snapshot object failed verification.");
            }
          }
          outcomes.push({ transactionId, action: "verified-committed", commitId: manifest.commitId });
          continue;
        }
        outcomes.push({ transactionId, ...decision });
        this.recoveryRequired = true;
        fail("recovery-needs-intervention", "Recovery found an incomplete or ambiguous transaction. No files were changed.", { transactionId, decision });
      }
      this.recoveryRequired = false;
      return { manifest, transactions: outcomes };
    });
  }
}

export { canonicalizeJcs };
