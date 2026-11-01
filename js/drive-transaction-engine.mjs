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
    this.fetch = (...args) => fetchImpl.apply(globalThis, args);
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
      mimeType: "application/octet-stream",
      parents: [this.folderId],
      appProperties: { [TAG + "Kind"]: kind, [TAG + "Transaction"]: transactionId, [TAG + "Hash"]: actualHash }
    };
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = joinBytes([head, bytes, tail]);
    const url = `${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,parents,appProperties`;
    try {
      await this.request(url, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      }, { allowStatuses: [409] });
    } catch (error) {
      // A transport failure may mean Drive committed the create but the response was lost.
      // Resolve only by inspecting the same pre-generated ID and exact expected bytes.
      if (error.code === "authorization-required") throw error;
    }

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

  async publishManifest(manifestFileId, manifest, { beforeMutation } = {}) {
    await this.readMetadata(manifestFileId);
    await beforeMutation?.();
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
      const existingFiles = await this.adapter.listChildren();
      if (existingFiles.some((file) => file.appProperties?.[TAG + "Kind"] === "journal-event" &&
          file.appProperties?.[TAG + "Transaction"] === transactionId)) {
        fail("transaction-already-exists", "This transaction ID already has durable journal evidence. Recover it before attempting another write.", { transactionId });
      }
      const current = await this.adapter.readJson(manifestFileId);
      if (current.revision !== expectedBase.revision || current.commitId !== expectedBase.commitId ||
          current.databaseId !== expectedBase.databaseId || current.copyId !== expectedBase.copyId) {
        fail("base-conflict", "The database manifest no longer matches the expected base revision and commit.");
      }
      const planned = [];
      const logicalPaths = new Set();
      for (const object of objects) {
        if (!object || typeof object.logicalPath !== "string" || !object.logicalPath || logicalPaths.has(object.logicalPath)) {
          fail("invalid-logical-path", "Changed objects require unique, non-empty logical paths.");
        }
        logicalPaths.add(object.logicalPath);
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
        await this.guard();
        await this.adapter.appendJournal(event, eventFileId);
        events.push(event);
        eventFileIds.push(eventFileId);
        previousEventHash = event.eventHash;
        return event;
      };

      try {
        await addEvent("transaction-started", {
          operationType: commitRecord.operationType || "update",
          databaseId: current.databaseId, copyId: current.copyId,
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
        if (!commitRecord.snapshot || typeof commitRecord.snapshot !== "object" || Array.isArray(commitRecord.snapshot)) {
          fail("incomplete-snapshot", "The commit record must provide the complete resulting logical snapshot map.");
        }
        const snapshot = { ...commitRecord.snapshot };
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
        await addEvent("commit-stage-planned", { commitId, fileId: commitFileId });
        await this.guard();
        await this.adapter.createImmutable({
          fileId: commitFileId, name: `ft-commit-${commitId}.json`,
          kind: "commit-record", transactionId, content: recordText, expectedSha256: recordHash
        });
        await addEvent("commit-staged", { commitId, recordHash });
        const nextManifest = await makeManifest({
          current, record, commitFileId, commitHash: recordHash, snapshot
        });
        if (nextManifest.databaseId !== current.databaseId || nextManifest.copyId !== current.copyId ||
            nextManifest.revision !== current.revision + 1 || nextManifest.commitId !== commitId ||
            nextManifest.parentCommitId !== current.commitId) {
          fail("invalid-next-manifest", "The manifest builder returned an identity, revision, or lineage that does not match the staged commit.");
        }
        await addEvent("manifest-publication-planned", {
          baseRevision: current.revision, baseCommitId: current.commitId,
          intendedRevision: nextManifest.revision, intendedCommitId: commitId
        });
        await this.guard();
        const latest = await this.adapter.readJson(manifestFileId);
        if (latest.databaseId !== current.databaseId || latest.copyId !== current.copyId ||
            latest.revision !== current.revision || latest.commitId !== current.commitId) {
          fail("base-conflict", "The manifest changed before publication.");
        }
        await this.guard();
        await this.adapter.publishManifest(manifestFileId, nextManifest, { beforeMutation: () => this.guard() });
        await addEvent("manifest-published", { commitId });
        await addEvent("transaction-committed", { commitId });
        return { transactionId, commitId, revision: nextManifest.revision, manifest: nextManifest };
      } catch (error) {
        this.recoveryRequired = true;
        throw new DriveTransactionError("transaction-unresolved",
          "The transaction did not reach a fully verified terminal state. Preserve its files and run recovery before another write.",
          {
            transactionId,
            cause: error.code || error.name || "unknown",
            causeMessage: error.message || String(error),
            causeDetails: error.details && typeof error.details === "object" ? error.details : {},
            journalEventCount: events.length
          });
      }
    });
  }

  async recover({ manifestFileId, makeManifest }) {
    return this.enqueue(async () => {
      if (!this.isOnline()) fail("offline", "Recovery requires an online Drive connection.");
      this.recoveryRequired = true;
      const manifest = await this.adapter.readJson(manifestFileId);
      const files = await this.adapter.listChildren();
      const journalFiles = files.filter((file) => file.appProperties?.[TAG + "Kind"] === "journal-event");
      const groups = new Map();
      for (const file of journalFiles) {
        const event = await this.adapter.readJson(file.id);
        if (!groups.has(event.transactionId)) groups.set(event.transactionId, []);
        groups.get(event.transactionId).push(event);
      }

      const appendRecoveryEvent = async (transactionId, state, eventType, payload) => {
        if (!this.isOnline()) fail("offline", "Recovery cannot write journal events while offline.");
        await this.assertWritable();
        const event = await createJournalEvent({
          transactionId,
          eventId: this.crypto.randomUUID(),
          sequence: state.sequence + 1,
          eventType,
          timestamp: this.now(),
          payload,
          previousEventHash: state.lastEventHash,
          cryptoImpl: this.crypto
        });
        const fileId = await this.adapter.allocateFileId();
        await this.assertWritable();
        await this.adapter.appendJournal(event, fileId);
        return {
          ...state,
          sequence: event.sequence,
          lastEventHash: event.eventHash,
          status: eventType === "manifest-published" ? "published-unverified" :
            eventType === "transaction-committed" ? "committed" :
            eventType === "transaction-aborted" ? "aborted" :
            eventType === "commit-staged" ? "ready-to-publish" : state.status
        };
      };

      const findCommitFile = async (transactionId, transactionEvents) => {
        const planned = transactionEvents.find((event) => event.eventType === "commit-stage-planned");
        const fileId = planned?.payload?.fileId;
        if (typeof fileId !== "string" || !fileId) {
          fail("missing-commit-file-id", "The journal does not identify the pre-generated commit-record file ID.", { transactionId });
        }
        const metadata = await this.adapter.waitForMetadata(fileId);
        if (metadata.appProperties?.[TAG + "Kind"] !== "commit-record" ||
            metadata.appProperties?.[TAG + "Transaction"] !== transactionId) {
          fail("commit-record-metadata-mismatch", "The planned commit-record ID contains unexpected metadata.", { transactionId, fileId });
        }
        return { id: fileId, appProperties: metadata.appProperties };
      };

      const verifyCommit = async (transactionId, state, expectedCommitId, transactionEvents) => {
        const commitFile = await findCommitFile(transactionId, transactionEvents);
        const record = await this.adapter.readJson(commitFile.id);
        const actualHash = await hashBytes(new TextEncoder().encode(canonicalizeJcs(record)), this.crypto);
        const metadataHash = commitFile.appProperties?.[TAG + "Hash"];
        const transactionBase = transactionEvents[0]?.payload || {};
        if (!expectedCommitId || record.format !== "finance-tracker-commit" || record.version !== 1 ||
            !record.snapshot || typeof record.snapshot !== "object" || Array.isArray(record.snapshot) ||
            record.commitId !== expectedCommitId || record.transactionId !== transactionId ||
            record.databaseId !== transactionBase.databaseId || record.copyId !== transactionBase.copyId ||
            record.revision !== transactionBase.baseRevision + 1 ||
            record.parentCommitId !== transactionBase.baseCommitId || metadataHash !== actualHash ||
            (state.commit?.recordHash && state.commit.recordHash !== actualHash)) {
          fail("commit-verification-failed", "The immutable commit record failed identity or hash verification.", { transactionId });
        }
        for (const reference of Object.values(record.snapshot || {})) {
          if (!reference?.fileId || !/^[0-9a-f]{64}$/.test(String(reference.sha256 || ""))) {
            fail("invalid-snapshot-reference", "A commit record contains an invalid object reference.", { transactionId });
          }
          const metadata = await this.adapter.readMetadata(reference.fileId);
          if (metadata.appProperties?.[TAG + "Hash"] !== reference.sha256) {
            fail("snapshot-object-metadata-mismatch", "A committed object has unexpected hash metadata.", { fileId: reference.fileId });
          }
          const bytes = await this.adapter.readBytes(reference.fileId);
          if (await hashBytes(bytes, this.crypto) !== reference.sha256) {
            fail("snapshot-object-verification-failed", "A committed snapshot object failed exact hash verification.", { fileId: reference.fileId });
          }
        }
        return { record, commitFile, recordHash: actualHash };
      };

      const outcomes = [];
      for (const [transactionId, events] of groups) {
        events.sort((a, b) => a.sequence - b.sequence);
        let state = await verifyJournal(events, { cryptoImpl: this.crypto });
        if (state.transactionId !== transactionId) fail("journal-identity-mismatch", "A journal group contains inconsistent transaction IDs.");
        const startEvent = events[0];
        const base = startEvent.payload || {};
        const manifestAtBase = manifest.databaseId === base.databaseId &&
          manifest.copyId === base.copyId &&
          manifest.revision === base.baseRevision &&
          manifest.commitId === base.baseCommitId;
        const decision = classifyTransactionRecovery({ journalState: state, manifest });

        if (decision.action === "already-terminal") {
          if (decision.outcome === "committed") {
            const verified = await verifyCommit(transactionId, state, state.commit?.commitId, events);
            if (manifest.commitId === verified.record.commitId &&
                (manifest.commitRecordFileId !== verified.commitFile.id ||
                 manifest.commitRecordHash !== verified.recordHash)) {
              fail("manifest-commit-pointer-mismatch", "The authoritative manifest does not reference the verified immutable commit record.", { transactionId });
            }
            outcomes.push({ transactionId, action: "verified-committed", outcome: "committed", commitId: verified.record.commitId });
          } else {
            outcomes.push({ transactionId, ...decision });
          }
          continue;
        }

        const intendedIsPublished = state.publication &&
          manifest.databaseId === base.databaseId && manifest.copyId === base.copyId &&
          manifest.commitId === state.publication.intendedCommitId &&
          manifest.revision === state.publication.intendedRevision;

        if (intendedIsPublished) {
          const verified = await verifyCommit(transactionId, state, state.publication.intendedCommitId, events);
          if (manifest.commitRecordFileId !== verified.commitFile.id ||
              manifest.commitRecordHash !== verified.recordHash) {
            fail("manifest-commit-pointer-mismatch", "The published manifest does not reference the verified immutable commit record.", { transactionId });
          }
          if (state.status === "publishing") {
            state = await appendRecoveryEvent(transactionId, state, "manifest-published", {
              commitId: verified.record.commitId
            });
          }
          if (state.status === "published-unverified") {
            state = await appendRecoveryEvent(transactionId, state, "transaction-committed", {
              commitId: verified.record.commitId
            });
          }
          outcomes.push({ transactionId, action: "verified-committed", outcome: "committed", commitId: verified.record.commitId });
          continue;
        }

        if (!manifestAtBase) {
          this.recoveryRequired = true;
          fail("recovery-needs-intervention", "The manifest matches neither the transaction's verified base nor its intended commit. No files were changed.", {
            transactionId, decision
          });
        }

        if (!state.publication && state.status === "staging") {
          const plannedObjects = events.filter((event) => event.eventType === "object-stage-planned");
          for (const planned of plannedObjects) {
            const { fileId, sha256 } = planned.payload;
            const metadata = await this.adapter.waitForMetadata(fileId);
            if (metadata.appProperties?.[TAG + "Kind"] !== "snapshot-object" ||
                metadata.appProperties?.[TAG + "Transaction"] !== transactionId ||
                metadata.appProperties?.[TAG + "Hash"] !== sha256) {
              fail("staged-object-metadata-mismatch", "A planned staging object has unexpected metadata.", { transactionId, fileId });
            }
            const bytes = await this.adapter.readBytes(fileId);
            if (await hashBytes(bytes, this.crypto) !== sha256) {
              fail("staged-object-verification-failed", "A planned staging object failed exact hash verification.", { transactionId, fileId });
            }
          }
          state = await appendRecoveryEvent(transactionId, state, "transaction-aborted", {
            reason: "recovery-confirmed-manifest-remains-at-original-base-before-commit-record-planning"
          });
          outcomes.push({ transactionId, action: "aborted-at-base", outcome: "aborted", preservedEvidence: true });
          continue;
        }

        if (!state.publication && state.status === "commit-staging") {
          const plannedCommit = events.find((event) => event.eventType === "commit-stage-planned")?.payload?.commitId;
          const verified = await verifyCommit(transactionId, state, plannedCommit, events);
          state = await appendRecoveryEvent(transactionId, state, "commit-staged", {
            commitId: verified.record.commitId,
            recordHash: verified.recordHash
          });
          state.commit = { commitId: verified.record.commitId, recordHash: verified.recordHash };
        }

        if (!state.publication && state.status === "ready-to-publish") {
          // A crash can occur after the immutable commit record is durable but before
          // the publication-intent event. The complete record and snapshot are verified
          // before recovery creates that missing intent.
          const verified = await verifyCommit(transactionId, state, state.commit?.commitId, events);
          if (typeof makeManifest !== "function") {
            fail("recovery-manifest-builder-required", "Safe publication recovery requires the application's manifest builder.", { transactionId });
          }
          const nextManifest = await makeManifest({
            current: manifest,
            record: verified.record,
            commitFileId: verified.commitFile.id,
            commitHash: verified.recordHash,
            snapshot: verified.record.snapshot
          });
          if (nextManifest.databaseId !== manifest.databaseId || nextManifest.copyId !== manifest.copyId ||
              nextManifest.revision !== verified.record.revision || nextManifest.commitId !== verified.record.commitId ||
              nextManifest.parentCommitId !== manifest.commitId) {
            fail("recovery-manifest-mismatch", "The reconstructed manifest does not preserve database identity and commit lineage.", { transactionId });
          }
          state = await appendRecoveryEvent(transactionId, state, "manifest-publication-planned", {
            baseRevision: manifest.revision,
            baseCommitId: manifest.commitId,
            intendedRevision: nextManifest.revision,
            intendedCommitId: verified.record.commitId
          });
          state.status = "publishing";
          state.publication = {
            baseRevision: manifest.revision,
            baseCommitId: manifest.commitId,
            intendedRevision: nextManifest.revision,
            intendedCommitId: verified.record.commitId
          };
        }

        if (state.publication && manifestAtBase &&
            (decision.action === "revalidate-and-resume-publication" || state.status === "publishing")) {
          const verified = await verifyCommit(transactionId, state, state.publication.intendedCommitId, events);
          if (typeof makeManifest !== "function") {
            fail("recovery-manifest-builder-required", "Safe publication recovery requires the application's manifest builder.", { transactionId });
          }
          const nextManifest = await makeManifest({
            current: manifest,
            record: verified.record,
            commitFileId: verified.commitFile.id,
            commitHash: verified.recordHash,
            snapshot: verified.record.snapshot
          });
          if (nextManifest.databaseId !== base.databaseId || nextManifest.copyId !== base.copyId ||
              nextManifest.revision !== state.publication.intendedRevision ||
              nextManifest.commitId !== state.publication.intendedCommitId ||
              nextManifest.parentCommitId !== base.baseCommitId) {
            fail("recovery-manifest-mismatch", "The reconstructed manifest does not match the journal's intended commit.", { transactionId });
          }
          await this.assertWritable();
          const latest = await this.adapter.readJson(manifestFileId);
          if (latest.databaseId !== base.databaseId || latest.copyId !== base.copyId ||
              latest.revision !== base.baseRevision || latest.commitId !== base.baseCommitId) {
            fail("recovery-base-changed", "The manifest base changed before recovery publication.", { transactionId });
          }
          await this.assertWritable();
          await this.adapter.publishManifest(manifestFileId, nextManifest, { beforeMutation: () => this.assertWritable() });
          const readBack = await this.adapter.readJson(manifestFileId);
          if (readBack.revision !== nextManifest.revision || readBack.commitId !== nextManifest.commitId) {
            fail("recovery-publication-unverified", "The recovered manifest did not read back with the intended revision and commit.", { transactionId });
          }
          state = await appendRecoveryEvent(transactionId, state, "manifest-published", {
            commitId: verified.record.commitId
          });
          state = await appendRecoveryEvent(transactionId, state, "transaction-committed", {
            commitId: verified.record.commitId
          });
          outcomes.push({ transactionId, action: "resumed-and-verified", outcome: "committed", commitId: verified.record.commitId });
          continue;
        }

        this.recoveryRequired = true;
        fail("recovery-needs-intervention", "Recovery found an incomplete or ambiguous transaction. No destructive cleanup was performed.", {
          transactionId, decision, state: state.status
        });
      }
      this.recoveryRequired = false;
      return { manifest: await this.adapter.readJson(manifestFileId), transactions: outcomes };
    });
  }
}

export { canonicalizeJcs };
