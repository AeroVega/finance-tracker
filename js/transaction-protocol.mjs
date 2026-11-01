const EVENT_TYPES = new Set([
  "transaction-started",
  "object-stage-planned",
  "object-staged",
  "commit-stage-planned",
  "commit-staged",
  "manifest-publication-planned",
  "manifest-published",
  "transaction-committed",
  "transaction-aborted",
  "transaction-outcome-unknown"
]);

const TERMINAL = new Set(["transaction-committed", "transaction-aborted"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TransactionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransactionProtocolError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TransactionProtocolError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
      fail("invalid-unicode", "Canonical JSON cannot contain unpaired UTF-16 surrogates.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid-number", "Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    fail("unsupported-value", "Canonical JSON supports only objects, arrays, strings, finite numbers, booleans, and null.");
  }
  if (seen.has(value)) fail("cyclic-value", "Canonical JSON cannot contain cyclic values.");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = "[" + value.map((item) => canonicalValue(item, seen)).join(",") + "]";
  } else {
    if (!isPlainObject(value)) fail("unsupported-object", "Canonical JSON requires plain objects.");
    const keys = Object.keys(value).sort();
    result = "{" + keys.map((key) => {
      const item = value[key];
      if (item === undefined) fail("unsupported-value", "Canonical JSON cannot contain undefined object values.");
      return JSON.stringify(key) + ":" + canonicalValue(item, seen);
    }).join(",") + "}";
  }
  seen.delete(value);
  return result;
}

/** RFC 8785-style canonical serialization for JSON-compatible plain data. */
export function canonicalizeJcs(value) {
  return canonicalValue(value, new Set());
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    fail("crypto-unavailable", "Web Crypto SHA-256 is unavailable.");
  }
  const bytes = new TextEncoder().encode(String(value));
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createJournalEvent(options) {
  const settings = options || {};
  const transactionId = String(settings.transactionId || "");
  const eventId = String(settings.eventId || "");
  const sequence = settings.sequence;
  const eventType = String(settings.eventType || "");
  const timestamp = String(settings.timestamp || "");
  const previousEventHash = settings.previousEventHash ?? null;
  if (!UUID_V4.test(transactionId) || !UUID_V4.test(eventId)) {
    fail("invalid-id", "Transaction and event IDs must be cryptographically generated UUID v4 values.");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0) fail("invalid-sequence", "Journal sequence must be a non-negative safe integer.");
  if (!EVENT_TYPES.has(eventType)) fail("invalid-event-type", "The journal event type is not supported.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    fail("invalid-timestamp", "Journal timestamps must be explicit UTC ISO 8601 values.");
  }
  if (sequence === 0 && (eventType !== "transaction-started" || previousEventHash !== null)) {
    fail("invalid-first-event", "The first journal event must start the transaction and have no previous hash.");
  }
  if (sequence > 0 && (typeof previousEventHash !== "string" || !/^[0-9a-f]{64}$/.test(previousEventHash))) {
    fail("invalid-previous-hash", "Subsequent journal events require the preceding event's SHA-256 hash.");
  }
  if (!isPlainObject(settings.payload || {})) fail("invalid-payload", "Journal event payload must be a plain object.");
  const unsigned = {
    format: "finance-tracker-transaction-event",
    version: 1,
    transactionId,
    eventId,
    sequence,
    eventType,
    timestamp,
    payload: settings.payload || {},
    previousEventHash
  };
  const eventHash = await sha256Hex(canonicalizeJcs(unsigned), settings.cryptoImpl || globalThis.crypto);
  return Object.freeze({ ...unsigned, eventHash });
}

export async function verifyJournal(events, options = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    fail("empty-journal", "A transaction journal must contain its durable start event.");
  }
  const state = {
    transactionId: null,
    sequence: -1,
    lastEventHash: null,
    status: "invalid",
    stagedObjects: [],
    commit: null,
    publication: null,
    events: 0
  };
  const eventIds = new Set();
  const plannedObjects = new Map();
  let commitPlanned = false;
  let commitStaged = false;
  let publicationPlanned = false;
  let published = false;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.format !== "finance-tracker-transaction-event" || event.version !== 1 ||
        !UUID_V4.test(String(event.transactionId || "")) || !UUID_V4.test(String(event.eventId || "")) ||
        !EVENT_TYPES.has(event.eventType) || !Number.isSafeInteger(event.sequence) ||
        typeof event.timestamp !== "string" || !isPlainObject(event.payload) ||
        !/^[0-9a-f]{64}$/.test(String(event.eventHash || ""))) {
      fail("invalid-event", "A transaction journal event is malformed.");
    }
    if (state.transactionId === null) state.transactionId = event.transactionId;
    if (event.transactionId !== state.transactionId || event.sequence !== index ||
        event.sequence !== state.sequence + 1 || eventIds.has(event.eventId) ||
        event.previousEventHash !== state.lastEventHash) {
      fail("broken-chain", "Transaction journal identity, sequence, event IDs, or hash linkage is inconsistent.");
    }
    const { eventHash, ...unsigned } = event;
    const actualHash = await sha256Hex(canonicalizeJcs(unsigned), options.cryptoImpl || globalThis.crypto);
    if (actualHash !== eventHash) fail("event-hash-mismatch", "A transaction journal event failed its SHA-256 verification.");

    if (index === 0 && event.eventType !== "transaction-started") {
      fail("invalid-transition", "A transaction journal must begin with transaction-started.");
    }
    if (TERMINAL.has(state.status)) fail("event-after-terminal", "A terminal transaction cannot accept additional events.");

    switch (event.eventType) {
      case "transaction-started":
        if (index !== 0) fail("invalid-transition", "transaction-started may appear only once at sequence zero.");
        state.status = "staging";
        break;
      case "object-stage-planned": {
        if (commitPlanned || publicationPlanned) fail("invalid-transition", "Objects cannot be planned after commit preparation.");
        const { logicalPath, fileId, sha256 } = event.payload;
        if (typeof logicalPath !== "string" || !logicalPath || typeof fileId !== "string" || !fileId ||
            !/^[0-9a-f]{64}$/.test(String(sha256 || "")) || plannedObjects.has(fileId)) {
          fail("invalid-object-plan", "An object-stage plan must contain a unique file ID, logical path, and SHA-256.");
        }
        plannedObjects.set(fileId, { logicalPath, fileId, sha256, staged: false });
        state.status = "staging";
        break;
      }
      case "object-staged": {
        const object = plannedObjects.get(event.payload.fileId);
        if (!object || object.staged || event.payload.sha256 !== object.sha256) {
          fail("invalid-object-stage", "An object-staged event must match one outstanding object plan exactly.");
        }
        object.staged = true;
        state.stagedObjects.push({ ...object });
        break;
      }
      case "commit-stage-planned":
        if (commitPlanned || Array.from(plannedObjects.values()).some((item) => !item.staged)) {
          fail("invalid-transition", "Commit planning requires all planned objects to be staged and verified.");
        }
        commitPlanned = true;
        state.status = "commit-staging";
        break;
      case "commit-staged":
        if (!commitPlanned || commitStaged || typeof event.payload.commitId !== "string" ||
            !UUID_V4.test(event.payload.commitId) || !/^[0-9a-f]{64}$/.test(String(event.payload.recordHash || ""))) {
          fail("invalid-commit-stage", "A staged commit must match a prior commit plan and include its ID and hash.");
        }
        commitStaged = true;
        state.commit = { commitId: event.payload.commitId, recordHash: event.payload.recordHash };
        state.status = "ready-to-publish";
        break;
      case "manifest-publication-planned":
        if (!commitStaged || publicationPlanned || typeof event.payload.baseCommitId !== "string" ||
            typeof event.payload.intendedCommitId !== "string" || event.payload.intendedCommitId !== state.commit.commitId) {
          fail("invalid-publication-plan", "Manifest publication requires a verified commit and its exact base/intended IDs.");
        }
        publicationPlanned = true;
        state.publication = { ...event.payload };
        state.status = "publishing";
        break;
      case "manifest-published":
        if (!publicationPlanned || published || event.payload.commitId !== state.commit.commitId) {
          fail("invalid-publication", "Manifest publication must match the planned commit.");
        }
        published = true;
        state.status = "published-unverified";
        break;
      case "transaction-committed":
        if (!published || event.payload.commitId !== state.commit.commitId) {
          fail("invalid-terminal-event", "A transaction can be committed only after its manifest pointer is published.");
        }
        state.status = "committed";
        break;
      case "transaction-aborted":
        if (publicationPlanned || published) fail("invalid-abort", "A transaction cannot be aborted after manifest publication was planned.");
        state.status = "aborted";
        break;
      case "transaction-outcome-unknown":
        if (state.status === "committed" || state.status === "aborted") fail("invalid-transition", "A terminal transaction cannot become outcome-unknown.");
        state.status = "outcome-unknown";
        break;
      default:
        fail("invalid-event-type", "The journal event type is not supported.");
    }

    eventIds.add(event.eventId);
    state.sequence = event.sequence;
    state.lastEventHash = event.eventHash;
    state.events += 1;
  }
  return Object.freeze({
    ...state,
    stagedObjects: Object.freeze(state.stagedObjects.map((item) => Object.freeze(item))),
    events: state.events
  });
}

/**
 * Classify recovery using the authoritative manifest pointer and verified journal.
 * This function never performs writes; callers may automate only the unambiguous
 * actions returned here after revalidating the active session.
 */
export function classifyTransactionRecovery({ journalState, manifest }) {
  if (!journalState || !manifest || typeof manifest.commitId !== "string" ||
      !Number.isSafeInteger(manifest.revision)) {
    return { action: "stop", reason: "missing-or-invalid-evidence" };
  }
  if (journalState.status === "committed" || journalState.status === "aborted") {
    return { action: "already-terminal", outcome: journalState.status };
  }
  const publication = journalState.publication;
  if (publication && manifest.commitId === publication.intendedCommitId &&
      manifest.revision === publication.intendedRevision) {
    return { action: "verify-intended-commit", commitId: publication.intendedCommitId };
  }
  if (publication && manifest.commitId === publication.baseCommitId &&
      manifest.revision === publication.baseRevision) {
    if (journalState.status === "published-unverified") {
      return { action: "stop", reason: "journal-says-published-manifest-still-at-base" };
    }
    if (journalState.commit && (journalState.status === "ready-to-publish" || journalState.status === "publishing")) {
      return { action: "revalidate-and-resume-publication", commitId: journalState.commit.commitId };
    }
    return { action: "abort-after-verification", reason: "publication-not-started" };
  }
  if (!publication && journalState.status === "staging") {
    return { action: "inspect-staging-and-abort-if-unreferenced" };
  }
  return { action: "stop", reason: "manifest-does-not-match-known-base-or-intended-state" };
}

export const TRANSACTION_EVENT_TYPES = Object.freeze(Array.from(EVENT_TYPES));
