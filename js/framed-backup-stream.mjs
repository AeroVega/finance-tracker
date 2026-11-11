import { canonicalizeJcs } from "./transaction-protocol.mjs";

// An isolated transport, not the v2 archive reader or a publication protocol.
export const FRAMED_BACKUP_VERSION = 3;
export const FRAMED_BACKUP_LIMITS = Object.freeze({ maxHeaderBytes: 16 * 1024, maxObjectBytes: 1024 * 1024 });
const MAGIC = Uint8Array.of(70, 84, 66, 83, 13, 10, 3, 0);
const ROOT = 1, OBJECT = 2, END = 255;
const encoder = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const nativeByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const ordinaryBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const DOMAIN = Object.fromEntries(["start", "frame", "chain", "end"].map(name =>
  [name, encoder.encode("finance-tracker-framed-backup:v3:" + name + "\0")]));

export class FramedBackupError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FramedBackupError";
    this.code = code;
  }
}
const fail = (code, message) => { throw new FramedBackupError(code, message); };
const checkAbort = signal => {
  if (signal?.aborted) throw new DOMException("Framed backup cancelled.", "AbortError");
};
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const encode = value => encoder.encode(canonicalizeJcs(value));

function limitsFor(input = {}) {
  fields(input, [], ["maxHeaderBytes", "maxObjectBytes"]);
  const limits = { ...FRAMED_BACKUP_LIMITS, ...input };
  if (!Number.isSafeInteger(limits.maxHeaderBytes) || limits.maxHeaderBytes < 128 || limits.maxHeaderBytes > 65536 ||
      !Number.isSafeInteger(limits.maxObjectBytes) || limits.maxObjectBytes < 1 || limits.maxObjectBytes > 16 * 1024 * 1024) {
    fail("invalid-limits", "Headers require 128..65536 bytes and objects require 1..16777216 bytes.");
  }
  return Object.freeze(limits);
}

function fields(value, required, optional = []) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("invalid-header", "Expected a plain object with the specified fields.");
  }
  for (const key in value) if (Object.hasOwn(value, key)) {
    if (!required.includes(key) && !optional.includes(key)) fail("invalid-header", "Unknown header field.");
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) fail("invalid-header", "Accessors are not supported.");
  }
  if (Object.getOwnPropertySymbols(value).length || required.some(key => !Object.hasOwn(value, key)) ||
      Object.getOwnPropertyNames(value).some(key => !required.includes(key) && !optional.includes(key))) {
    fail("invalid-header", "Unexpected header fields.");
  }
  for (const key of [...required, ...optional]) if (Object.hasOwn(value, key) &&
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) fail("invalid-header", "Accessors are not supported.");
}

function identifier(value) {
  if (typeof value !== "string" || !HASH.test(value)) fail("invalid-object-id", "Object IDs must be lowercase SHA-256 hashes.");
  return value;
}

function exactCount(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) fail("invalid-count", "Counters must be unsigned canonical decimal strings.");
  return BigInt(value);
}

function snapshotRoot(value, limits) {
  fields(value, ["databaseId", "sourceCopyId", "revision", "canonical", "catalog", "protocol"], ["profile", "sourceEvidence"]);
  // A distinct descriptor, rather than reinterpreting the existing protocol-3
  // descriptor. Old readers reject the additional field before staging.
  const physical = Object.hasOwn(value, "profile");
  if (physical && !["canonical4-physical4", "canonical5-physical4"].includes(value.profile)) fail("unsupported-root-profile", "Unsupported framed root profile.");
  const canonicalVersion = physical && value.profile === "canonical5-physical4" ? 5 : 4;
  for (const key of ["databaseId", "sourceCopyId", "revision"]) {
    if (typeof value[key] !== "string" || !value[key].length || value[key].length > limits.maxHeaderBytes) {
      fail("invalid-root", "Root identities and revision must be bounded strings.");
    }
  }
  exactCount(value.revision);
  const result = { databaseId: value.databaseId, sourceCopyId: value.sourceCopyId, revision: value.revision };
  if (physical) {
    result.profile = value.profile;
    if (!Object.hasOwn(value,"sourceEvidence")) fail("invalid-root", "Physical archives require an explicit source evidence descriptor.");
    if (value.sourceEvidence === null) result.sourceEvidence = null;
    else {
      fields(value.sourceEvidence,["version","sha256"]);
      if(value.sourceEvidence.version !== 1) fail("unsupported-root-version", "Unsupported physical source evidence.");
      result.sourceEvidence = Object.freeze({version:1,sha256:identifier(value.sourceEvidence.sha256)});
    }
  } else if (Object.hasOwn(value,"sourceEvidence")) fail("invalid-root", "Source evidence requires the physical profile.");
  for (const [name, version] of [["canonical", canonicalVersion], ["catalog", 3], ["protocol", physical ? 4 : 3]]) {
    const descriptor = value[name];
    if (descriptor === null) result[name] = null;
    else {
      fields(descriptor, ["version", "sha256"]);
      if (descriptor.version !== version) fail("unsupported-root-version", "Unsupported root descriptor version.");
      result[name] = Object.freeze({ version, sha256: identifier(descriptor.sha256) });
    }
  }
  if (physical && (!result.canonical || !result.protocol || result.catalog !== null)) fail("invalid-root", "Physical portable archives require canonical and protocol roots, without copy-local catalogs.");
  if (!result.canonical && !result.catalog && !result.protocol) fail("invalid-root", "At least one root descriptor is required.");
  const bytes = encode(result);
  if (bytes.length > limits.maxHeaderBytes) fail("header-byte-limit", "Root metadata exceeds the header byte limit.");
  return { root: Object.freeze(result), bytes };
}

function byteView(value) {
  if (!(value instanceof Uint8Array)) {
    fail("invalid-bytes", "Expected unshared Uint8Array bytes.");
  }
  // Buffer/subclass properties and methods can be overridden. Read intrinsic
  // sizes and construct a plain view without virtual length/slice/subarray.
  const buffer = nativeBuffer.call(value);
  try { ordinaryBufferLength.call(buffer); }
  catch { fail("invalid-bytes", "Shared buffers are not supported."); }
  return new Uint8Array(buffer, nativeByteOffset.call(value), nativeByteLength.call(value));
}
function copyBytes(value, limit) {
  const view = byteView(value);
  if (view.length > limit) fail("object-byte-limit", "Object bytes exceed the configured per-object limit.");
  return new Uint8Array(view);
}

function prefix(type, length) {
  const result = new Uint8Array(5);
  result[0] = type;
  new DataView(result.buffer).setUint32(1, length, false);
  return result;
}

function digestor(cryptoImpl) {
  if (typeof cryptoImpl?.subtle?.digest !== "function") fail("crypto-unavailable", "Web Crypto SHA-256 is required.");
  return async (...pieces) => {
    // Only a bounded object or bounded header is supplied, never the archive.
    const bytes = pieces.length === 1 ? pieces[0] : new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0));
    if (pieces.length > 1) {
      let offset = 0;
      for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
    }
    return new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
  };
}

async function advance(digest, chain, framePrefix, header, bodyDigest) {
  return digest(DOMAIN.chain, chain, await digest(DOMAIN.frame, framePrefix, header, bodyDigest));
}

function sourceReader(source, signal) {
  const streamReader = typeof source?.getReader === "function" ? source.getReader() : null;
  const iterator = streamReader ? null : source?.[Symbol.asyncIterator]?.() ?? source?.[Symbol.iterator]?.();
  if (!streamReader && !iterator?.next) fail("invalid-source", "An iterable or ReadableStream is required.");
  let done = false, closed = false, stopping;
  function stop(reason) {
    if (!stopping) stopping = Promise.resolve().then(() => streamReader ? streamReader.cancel(reason) : iterator.return?.());
    // An abort handler cannot leave an unobserved rejected cancellation promise.
    stopping.catch(() => {});
    return stopping;
  }
  const onAbort = () => { if (!done) stop(signal.reason); };
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    async next() {
      checkAbort(signal);
      const result = await (streamReader ? streamReader.read() : iterator.next());
      checkAbort(signal);
      if (!result || typeof result !== "object") fail("invalid-source", "The source returned an invalid iterator result.");
      if (result.done) done = true;
      return result;
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      try { if (!done) await stop(reason); else if (stopping) await stopping; }
      finally { streamReader?.releaseLock(); }
    }
  };
}

// One upstream chunk reference and one requested block. A huge upstream chunk
// is neither concatenated nor copied wholesale. Sources own their chunk sizes.
class ByteReader {
  constructor(source, signal) {
    this.source = sourceReader(source, signal);
    this.chunk = null;
    this.offset = 0;
    this.maxReadBytes = 0;
  }
  async available() {
    while (!this.chunk || this.offset === this.chunk.length) {
      this.chunk = null;
      this.offset = 0;
      const next = await this.source.next();
      if (next.done) return false;
      try { this.chunk = byteView(next.value); }
      catch { fail("invalid-chunk", "Stream chunks must be unshared Uint8Arrays."); }
    }
    return true;
  }
  async read(length) {
    this.maxReadBytes = Math.max(this.maxReadBytes, length);
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      if (!await this.available()) fail("truncated-stream", "The framed backup ended before its terminal commitment.");
      const count = Math.min(length - offset, this.chunk.length - this.offset);
      result.set(this.chunk.subarray(this.offset, this.offset + count), offset);
      this.offset += count;
      offset += count;
      if (this.offset === this.chunk.length) { this.chunk = null; this.offset = 0; }
    }
    return result;
  }
  async close(reason) {
    this.chunk = null;
    await this.source.close(reason);
  }
}

function parseHeader(bytes) {
  let result;
  try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { fail("invalid-header", "Frame headers must be valid UTF-8 JSON."); }
  // Validate shape before canonicalization, so hostile nesting never enters the
  // general recursive serializer. Duplicate keys and alternative encodings fail.
  return result;
}
function canonicalHeader(value, bytes) {
  if (!equal(encode(value), bytes)) fail("noncanonical-header", "Frame headers must use exact canonical JSON bytes.");
}
function portableDescriptor(value) {
  const journal = value?.kind === "journal-event";
  fields(value, ["kind", "identity", ...(journal ? ["transactionId", "sequence"] : [])]);
  if (!["data-object", "commit-record", "journal-event", "migration-record", "protocol-object"].includes(value.kind)) fail("invalid-descriptor", "Unsupported portable object kind.");
  for (const key of journal ? ["identity", "transactionId"] : ["identity"]) {
    if (typeof value[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value[key])) fail("invalid-descriptor", "Invalid portable identity.");
  }
  if (journal && (!Number.isSafeInteger(value.sequence) || value.sequence < 0)) fail("invalid-descriptor", "Invalid journal sequence.");
  return Object.freeze({ ...value });
}
function objectHeader(value, limits, physical = false) {
  fields(value, ["hash", "byteLength", ...(physical ? ["descriptor"] : [])]);
  if (physical) {
    portableDescriptor(value.descriptor);
    if (["data-object", "commit-record"].includes(value.descriptor.kind) && value.descriptor.identity !== value.hash) fail("invalid-descriptor", "Data identity must equal its hash.");
  }
  identifier(value.hash);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > limits.maxObjectBytes) {
    fail("object-byte-limit", "Object length exceeds the configured per-object limit.");
  }
}
function boundedHeader(value, limits) {
  const bytes = encode(value);
  if (bytes.length > limits.maxHeaderBytes) fail("header-byte-limit", "Frame header exceeds the configured byte limit.");
  return bytes;
}

/** Yield bounded chunks without retaining prior objects. Input items are
 * {hash, bytes}. Repeated hashes are intentional, individually committed frames.
 * beforeSeal must recheck a pinned source under the integration's session gate.
 */
export async function* encodeFramedBackup({ root, objects, limits: inputLimits, signal,
  beforeSeal, cryptoImpl = globalThis.crypto } = {}) {
  const limits = limitsFor(inputLimits);
  const metadata = snapshotRoot(root, limits);
  if (beforeSeal !== undefined && typeof beforeSeal !== "function") fail("invalid-source-check", "beforeSeal must be a function.");
  const digest = digestor(cryptoImpl);
  const source = sourceReader(objects, signal);
  let failure;
  try {
    checkAbort(signal);
    let chain = await digest(DOMAIN.start, MAGIC);
    const rootPrefix = prefix(ROOT, metadata.bytes.length);
    chain = await advance(digest, chain, rootPrefix, metadata.bytes, await digest(new Uint8Array()));
    checkAbort(signal);
    yield new Uint8Array(MAGIC);
    checkAbort(signal);
    yield rootPrefix;
    checkAbort(signal);
    yield metadata.bytes;
    let count = 0n, total = 0n;
    while (true) {
      checkAbort(signal);
      const next = await source.next();
      if (next.done) break;
      const physical = Object.hasOwn(metadata.root, "profile");
      fields(next.value, ["hash", "bytes", ...(physical ? ["descriptor"] : [])]);
      const hash = identifier(next.value.hash);
      let body = copyBytes(next.value.bytes, limits.maxObjectBytes);
      const bodyDigest = await digest(body);
      if (hex(bodyDigest) !== hash) fail("object-hash-mismatch", "A supplied object ID does not match its exact bytes.");
      const object = { hash, byteLength: body.length, ...(physical ? { descriptor: portableDescriptor(next.value.descriptor) } : {}) };
      objectHeader(object, limits, physical);
      const header = boundedHeader(object, limits);
      const framePrefix = prefix(OBJECT, header.length);
      chain = await advance(digest, chain, framePrefix, header, bodyDigest);
      count += 1n;
      total += BigInt(body.length);
      checkAbort(signal);
      yield framePrefix;
      checkAbort(signal);
      yield header;
      checkAbort(signal);
      yield body;
      body = null;
    }
    if (beforeSeal) await beforeSeal(Object.freeze({ root: metadata.root, objectCount: String(count), totalObjectBytes: String(total), signal }));
    checkAbort(signal);
    const header = boundedHeader({ objectCount: String(count), totalObjectBytes: String(total) }, limits);
    const framePrefix = prefix(END, header.length);
    const commitment = await digest(DOMAIN.end, chain, framePrefix, header);
    checkAbort(signal);
    yield framePrefix;
    checkAbort(signal);
    yield header;
    checkAbort(signal);
    yield commitment;
  } catch (error) { failure = error; throw error; }
  finally { try { await source.close(failure); } catch (error) { if (!failure) throw error; } }
}

/** Zero queued chunks. Cancellation propagates to the object source. */
export function createFramedBackupReadableStream(options) {
  const cancellation = new AbortController();
  const parent = options?.signal;
  const abort = () => cancellation.abort(parent.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const iterator = encodeFramedBackup({ ...options, signal: cancellation.signal });
  const cleanup = () => parent?.removeEventListener("abort", abort);
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) { cleanup(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { cleanup(); controller.error(error); }
    },
    async cancel(reason) {
      cancellation.abort(reason);
      try { await iterator.return(); } finally { cleanup(); }
    }
  }, { highWaterMark: 0 });
}

/** Sequential sink writes. An admitted write settles before abort/return. */
export async function writeFramedBackup({ sink, ...options } = {}) {
  const writer = typeof sink?.getWriter === "function" ? sink.getWriter() : sink;
  if (typeof writer?.write !== "function") fail("invalid-sink", "A WritableStream or asynchronous write sink is required.");
  try {
    for await (const chunk of encodeFramedBackup(options)) {
      checkAbort(options.signal);
      await writer.write(chunk);
      checkAbort(options.signal);
    }
    if (typeof writer.close === "function") await writer.close();
  } catch (error) {
    try { if (typeof writer.abort === "function") await writer.abort(error); } catch { /* preserve original failure */ }
    throw error;
  } finally { if (writer !== sink) writer.releaseLock(); }
}

/** Restore into a NEW, exclusively owned quarantine namespace.
 * begin({state, root}) must durably mark it incomplete and refuse reused storage.
 * write(bytes, {signal}) -> hash is immutable/idempotent. read(hash, {signal,
 * maxBytes}) must bound transport before allocation. No deletion or publication
 * method is called, including on success. verifyStructure must independently
 * verify the required application/history graph with bounded traversal state.
 */
export async function restoreFramedBackup({ source, staging, verifyStructure, limits: inputLimits,
  signal, cryptoImpl = globalThis.crypto } = {}) {
  const limits = limitsFor(inputLimits);
  if (typeof verifyStructure !== "function") fail("structural-verifier-required", "A bounded structural/application verifier is required.");
  if (!["begin", "read", "write"].every(method => typeof staging?.[method] === "function")) {
    fail("invalid-staging-store", "An incomplete-marker and immutable read/write staging store is required.");
  }
  const begin = staging.begin.bind(staging), readStore = staging.read.bind(staging), writeStore = staging.write.bind(staging);
  const digest = digestor(cryptoImpl);
  const reader = new ByteReader(source, signal);
  let failure, root, count = 0n, total = 0n, phase = "framing", began = false, readActive = false;
  let verificationRead = null, verificationFailure = null, verificationOpen = true;
  const readVerified = (hash, options = {}) => {
    // Refuse rather than queue unbounded verifier work. Capture every admitted
    // read, even if a buggy verifier forgets to await it or catches its error.
    if (!verificationOpen) return Promise.reject(new FramedBackupError("verification-closed", "The verification read scope is closed."));
    if (readActive) {
      const error = new FramedBackupError("concurrent-verification-read", "The verifier must await each bounded read.");
      verificationFailure ??= error;
      return Promise.reject(error);
    }
    readActive = true;
    verificationRead = (async () => {
      checkAbort(signal);
      checkAbort(options.signal);
      identifier(hash);
      const maxBytes = options.maxBytes ?? limits.maxObjectBytes;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail("invalid-read-limit", "Verification reads require a finite byte limit.");
      const bound = Math.min(maxBytes, limits.maxObjectBytes);
      const bytes = copyBytes(await readStore(hash, { signal, maxBytes: bound }), bound);
      checkAbort(signal);
      checkAbort(options.signal);
      if (hex(await digest(bytes)) !== hash) fail("staged-object-hash-mismatch", "Staged bytes do not match their content ID.");
      return bytes;
    })().catch(error => { verificationFailure ??= error; throw error; }).finally(() => { readActive = false; });
    verificationRead.catch(() => {});
    return verificationRead;
  };
  try {
    checkAbort(signal);
    if (!equal(await reader.read(MAGIC.length), MAGIC)) fail("unsupported-stream-version", "Not a supported version-3 framed backup.");
    let chain = await digest(DOMAIN.start, MAGIC);
    while (true) {
      checkAbort(signal);
      const framePrefix = await reader.read(5);
      const type = framePrefix[0], length = new DataView(framePrefix.buffer).getUint32(1, false);
      if (length === 0 || length > limits.maxHeaderBytes) fail("header-byte-limit", "Frame header exceeds the configured byte limit.");
      if ((!root && type !== ROOT) || (root && type !== OBJECT && type !== END)) fail("invalid-frame-order", "Expected root, object frames, and exactly one terminal frame.");
      const bytes = await reader.read(length);
      const header = parseHeader(bytes);
      if (type === ROOT) {
        const metadata = snapshotRoot(header, limits);
        canonicalHeader(metadata.root, bytes);
        root = metadata.root;
        chain = await advance(digest, chain, framePrefix, bytes, await digest(new Uint8Array()));
        checkAbort(signal);
        began = true; // begin may have persisted its marker before rejecting.
        await begin(Object.freeze({ state: "incomplete", formatVersion: FRAMED_BACKUP_VERSION, root, signal }));
        checkAbort(signal);
      } else if (type === OBJECT) {
        objectHeader(header, limits, Object.hasOwn(root, "profile"));
        canonicalHeader(header, bytes);
        let body = await reader.read(header.byteLength);
        const bodyDigest = await digest(body);
        if (hex(bodyDigest) !== header.hash) fail("object-hash-mismatch", "An object frame failed exact-byte SHA-256 verification.");
        chain = await advance(digest, chain, framePrefix, bytes, bodyDigest);
        checkAbort(signal);
        // Drain one admitted write before checking cancellation or proceeding.
        const written = await writeStore(body, { signal, ...(header.descriptor ? { descriptor: portableDescriptor(header.descriptor) } : {}) });
        checkAbort(signal);
        if (written !== header.hash) fail("staged-object-id-mismatch", "The staging store returned a different content ID.");
        body = null;
        await readVerified(header.hash);
        count += 1n;
        total += BigInt(header.byteLength);
      } else {
        fields(header, ["objectCount", "totalObjectBytes"]);
        const declaredCount = exactCount(header.objectCount), declaredBytes = exactCount(header.totalObjectBytes);
        canonicalHeader(header, bytes);
        const supplied = await reader.read(32);
        if (declaredCount !== count || declaredBytes !== total) fail("terminal-count-mismatch", "Terminal counts do not match exact frame totals.");
        if (!equal(supplied, await digest(DOMAIN.end, chain, framePrefix, bytes))) fail("terminal-commitment-mismatch", "The terminal commitment does not match the framed stream.");
        if (await reader.available()) fail("trailing-bytes", "Bytes follow the terminal commitment.");
        checkAbort(signal);
        // Hash checks establish byte integrity only. Root dependencies and all
        // application semantics remain the verifier's separate responsibility.
        phase = "structure";
        for (const name of ["canonical", "catalog", "protocol", "sourceEvidence"]) if (root[name]) await readVerified(root[name].sha256);
        const result = await verifyStructure(Object.freeze({ root,
          store: Object.freeze({ read: readVerified }), signal, limits,
          objectCount: String(count), totalObjectBytes: String(total) }));
        verificationOpen = false;
        if (verificationRead) await verificationRead;
        if (verificationFailure) throw verificationFailure;
        if (result !== true) fail("structural-verification-failed", "The structural/application verifier did not approve the restored graph.");
        checkAbort(signal);
        return Object.freeze({ state: "verified-quarantined", formatVersion: FRAMED_BACKUP_VERSION,
          formatVerified: true, structureVerification: "callback-completed", root,
          objectCount: String(count), totalObjectBytes: String(total),
          maxParserBlockBytes: reader.maxReadBytes });
      }
    }
  } catch (error) {
    failure = new FramedBackupError("restore-incomplete", "Restore is incomplete; preserve the quarantined staging namespace.", error);
    failure.incomplete = true;
    failure.phase = phase;
    failure.stagingBegan = began;
    failure.objectCount = String(count);
    throw failure;
  } finally {
    verificationOpen = false;
    // A verifier may throw while one of its reads is still pending.
    if (verificationRead) try { await verificationRead; } catch { /* already incomplete */ }
    try { await reader.close(failure); } catch (error) { if (!failure) throw error; }
  }
}
