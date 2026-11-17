import { immutableContentType } from './immutable-content-type.mjs';
import { markRequestPurpose, markRequestEndpoint, markManifestRequest, transferManifestRequest } from './drive-request-metrics.mjs';
import { createDriveResponseLimits, readBoundedDriveBytes, readBoundedDriveJson, discardDriveResponse, assertResponseSize } from "./drive-response-transport.mjs";
import { copyOwnedBytes } from "./byte-ownership.mjs";
import {
  canonicalizeJcs
} from "./transaction-protocol.mjs";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const MIME_JSON = "application/json";
const TAG = "financeTracker";
const FILE_ID_BATCH_SIZE = 16;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DriveTransactionError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause === undefined ? undefined : {cause});
    this.name = "DriveTransactionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details, cause) {
  throw new DriveTransactionError(code, message, details, cause);
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

const nativeReadAdapters=new WeakSet();
const nativeReadDescriptors=new Map();
export function getNativeDriveReadCheck(adapter) {
  if(!nativeReadAdapters.has(adapter))return null;
  const check=()=>{
    if(Object.getPrototypeOf(adapter)!==GoogleDriveTransactionAdapter.prototype||Object.getOwnPropertyDescriptor(adapter,'onRequest')?.value!==null)
      fail('verification-scope-closed','Native read transport changed.');
    for(const [key,descriptor] of nativeReadDescriptors){
      if(Object.hasOwn(adapter,key)||Object.getOwnPropertyDescriptor(GoogleDriveTransactionAdapter.prototype,key)?.value!==descriptor.value)
        fail('verification-scope-closed','Native read control flow changed.');
    }
  };
  try{check();return check;}catch{return null;}
}
export class GoogleDriveTransactionAdapter {
  #captureMutationGuard; #onExpiredMutation; #pendingMutations=new Set(); #mutationScopes=new WeakMap();
  constructor({ accessToken, folderId, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto,
    onRequest = null, afterMutation = null, captureMutationGuard = () => () => {}, onExpiredMutation = () => {}, responseLimits = {}, visibilityAttempts = 8, visibilityDelayMs = 500, visibilityMaxDelayMs = 5000 }) {
    if (typeof accessToken !== "function" || !folderId || typeof fetchImpl !== "function") {
      fail("invalid-adapter-config", "An access-token provider, selected folder, and fetch implementation are required.");
    }
    if(typeof captureMutationGuard!=="function"||typeof onExpiredMutation!=="function")fail("invalid-adapter-config","Mutation lifetime callbacks must be callable.");
    this.#captureMutationGuard=captureMutationGuard;this.#onExpiredMutation=onExpiredMutation;
    this.responseLimits = createDriveResponseLimits(responseLimits);
    this.accessToken = accessToken;
    this.folderId = folderId;
    this.fetch = (...args) => fetchImpl.apply(globalThis, args);
    this.crypto = cryptoImpl;
    this.onRequest = onRequest;
    this.afterMutation = afterMutation;
    if (!Number.isInteger(visibilityAttempts) || visibilityAttempts < 1 ||
        !Number.isFinite(visibilityDelayMs) || visibilityDelayMs < 0 ||
        !Number.isFinite(visibilityMaxDelayMs) || visibilityMaxDelayMs < visibilityDelayMs) {
      fail("invalid-visibility-retry-config", "Drive visibility retry settings must be positive, bounded values.");
    }
    this.visibilityAttempts = visibilityAttempts;
    this.visibilityDelayMs = visibilityDelayMs;
    this.visibilityMaxDelayMs = visibilityMaxDelayMs;
    this.generatedFileIds = [];
    this.seenGeneratedFileIds = new Set();
    this.fileIdRefill = null;
    if(new.target===GoogleDriveTransactionAdapter)nativeReadAdapters.add(this);
  }

  #mutationGuard() {
    const guard=this.#captureMutationGuard();
    if(typeof guard!=="function")fail("invalid-guard","A mutation lifetime guard must be callable.");
    return ()=>{if(guard()!==undefined)fail("invalid-guard","Mutation lifetime guards must return undefined.");};
  }

  assertNoExpiredMutation() {
    for(const guard of this.#pendingMutations){try{guard();}catch(error){this.#onExpiredMutation(error);fail("mutation-in-flight","An expired mutation must settle before this copy can be used.");}}
  }
  assertMutationsSettled() {
    this.assertNoExpiredMutation();
    if(this.#pendingMutations.size)fail("mutation-in-flight","Wait for the issued mutation to settle before recovery.");
  }

  async #mutation(run) {
    const guard=this.#mutationGuard(),token=Object.freeze({}),scope={guard,dispatched:false,active:true};
    this.#mutationScopes.set(token,scope);
    try {
      const result=await run(token);
      guard();return result;
    }catch(error){
      if(scope.dispatched){try{guard();}catch(expired){this.#onExpiredMutation(expired);}}
      throw error;
    }finally{scope.active=false;this.#mutationScopes.delete(token);this.#pendingMutations.delete(guard);}
  }

  async request(url, options = {}, { allowStatuses = [], beforeMutation, mutationScope, endpointClass } = {}) {
    // Capture before token/ownership awaits. This synchronous fence is separate
    // from the async remote ownership check and runs in the fetch call's turn.
    const mutation=!['GET','HEAD'].includes(String(options.method??'GET').toUpperCase());
    const guard=mutation?this.#mutationGuard():null,scope=this.#mutationScopes.get(mutationScope);
    if(mutationScope!==undefined&&!scope)fail("invalid-guard","Mutation scope is not owned by this adapter.");
    const token = await this.accessToken();
    if (!token) fail("authorization-required", "Google Drive authorization is unavailable.");
    await beforeMutation?.();
    const fetch=this.fetch,requestOptions={
      ...options,
      // Verification versions, exact manifests and media must come from Drive,
      // never an HTTP cache in the browser. Private byte reuse is gated above.
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    };
    markRequestEndpoint(requestOptions, endpointClass);
    transferManifestRequest(options,requestOptions);
    if(scope){if(!scope.active)fail("verification-scope-closed","Mutation scope is closed.");scope.guard();}
    guard?.();
    // Only private accounting remains between the final fence and fetch.
    if(scope){scope.dispatched=true;this.#pendingMutations.add(scope.guard);}
    let response;
    try {response=await fetch.call(this,url,requestOptions);}
    catch (cause) {fail("drive-network-error","The Drive request did not return a confirmed response.", {}, cause);}
    if (!response || !Number.isInteger(response.status)) {
      await discardDriveResponse(response);
      fail("invalid-drive-response", "The Drive request returned no valid HTTP response.");
    }
    this.onRequest?.({ method: options.method || "GET", url: String(url), status: response.status });
    if (!response.ok && !allowStatuses.includes(response.status)) {
      await discardDriveResponse(response);
      fail(response.status === 401 || response.status === 403 ? "authorization-required" : "drive-request-failed",
        `Google Drive request failed (HTTP ${response.status}).`, { status: response.status });
    }
    return response;
  }

  async allocateFileId() {
    // Allocate lazily in small batches. These are unused IDs, not cached file
    // evidence. Concurrent callers share the refill and consume distinct IDs.
    while (this.generatedFileIds.length === 0) {
      if (!this.fileIdRefill) {
        this.fileIdRefill = (async () => {
          const response = await this.request(`${API}/files/generateIds?count=${FILE_ID_BATCH_SIZE}&space=drive`, markRequestPurpose({},"id-generation"), {endpointClass:"files.generateIds"});
          const result = await readBoundedDriveJson(response, { kind: "generated-ids", limits: this.responseLimits });
          if (!Array.isArray(result?.ids) || result.ids.length !== FILE_ID_BATCH_SIZE ||
              result.ids.some((id) => typeof id !== "string" || !id.trim() || this.seenGeneratedFileIds.has(id)) ||
              new Set(result.ids).size !== FILE_ID_BATCH_SIZE) {
            fail("invalid-generated-id", "Google Drive did not return a complete batch of distinct new file IDs.");
          }
          for (const id of result.ids) this.seenGeneratedFileIds.add(id);
          this.generatedFileIds.push(...result.ids);
        })().finally(() => { this.fileIdRefill = null; });
      }
      await this.fileIdRefill;
    }
    return this.generatedFileIds.shift();
  }

  async *iterateChildren() {
    const seen = new Set();
    let pageToken = null;
    do {
      const query = new URLSearchParams({
        q: `'${this.folderId}' in parents and trashed = false`,
        pageSize: "1000",
        fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,appProperties,size,version,trashed)"
      });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.request(`${API}/files?${query}`, markRequestPurpose({},"inventory-list"), {endpointClass:"files.list"});
      const page = await readBoundedDriveJson(response, { kind: "list-page", limits: this.responseLimits });
      if (page?.incompleteSearch !== false || !Array.isArray(page.files) || page.files.length > 1000 ||
          (page.nextPageToken != null && typeof page.nextPageToken !== "string")) {
        fail("incomplete-folder-enumeration", "Drive did not confirm complete folder enumeration.");
      }
      for (const file of page.files) yield file;
      pageToken = page.nextPageToken || null;
      if (pageToken && seen.has(pageToken)) fail("pagination-loop", "Drive repeated a folder pagination token.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
  }

  async listChildren() { const all=[]; for await (const file of this.iterateChildren()) all.push(file); return all; }

  /** Fresh complete enumeration; never retain or reuse this metadata snapshot. */
  async readMetadataSnapshot() {
    const metadata = new Map();
    for (const file of await this.listChildren()) {
      if (typeof file?.id !== "string" || !file.id.trim() || metadata.has(file.id)) {
        fail("invalid-metadata-batch", "The complete folder listing has malformed or duplicate file identities.");
      }
      metadata.set(file.id, structuredClone(file));
    }
    return metadata;
  }

  /** Fresh metadata for this verification only; enumeration is not atomic. */
  async readMetadataBatch(fileIds) {
    if (!Array.isArray(fileIds) || fileIds.some((id) => typeof id !== "string" || !id.trim()) ||
        new Set(fileIds).size !== fileIds.length) {
      fail("invalid-metadata-batch", "Batch metadata reads require distinct nonempty file IDs.");
    }
    const metadata = new Map();
    if (!fileIds.length) return metadata;
    const all = await (this.readMetadataSnapshot ? this.readMetadataSnapshot()
      : GoogleDriveTransactionAdapter.prototype.readMetadataSnapshot.call(this));
    for (const id of fileIds) {
      const file = all.get(id);
      if (!file) fail("incomplete-metadata-batch", "The complete folder listing did not contain every retained file.");
      if (file.trashed !== false || !Array.isArray(file.parents) || !file.parents.includes(this.folderId)) {
        fail("object-location-mismatch", "A retained file is trashed or outside the selected database folder.", { fileId: id });
      }
      if (typeof file.version !== "string" || !/^[0-9]+$/.test(file.version)) {
        fail("invalid-metadata-batch", "A retained file has no valid Drive version.", { fileId: id });
      }
      metadata.set(id, file);
    }
    return metadata;
  }

  async readMetadata(fileId, { maxBytes, signal } = {}) {
    const query = new URLSearchParams({ fields: "id,name,mimeType,parents,appProperties,size,version,trashed" });
    const response = await this.request(`${API}/files/${encodeURIComponent(fileId)}?${query}`, markRequestPurpose({ signal },"metadata"), {endpointClass:"files.get"});
    const metadata = await readBoundedDriveJson(response, { kind: "metadata", limits: this.responseLimits, maxBytes });
    if (!metadata || metadata.id !== fileId || metadata.trashed || !Array.isArray(metadata.parents) || !metadata.parents.includes(this.folderId)) {
      fail("object-location-mismatch", "A transaction file is missing, trashed, or outside the selected database folder.", { fileId });
    }
    return metadata;
  }

  async readBytes(fileId, { kind = "stored-object", maxBytes, signal } = {}) {
    const response = await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, markRequestPurpose({ signal },"media"), {endpointClass:"files.get"});
    return readBoundedDriveBytes(response, { kind, limits: this.responseLimits, maxBytes });
  }

  async readJson(fileId, options = {}) {
    const bytes = await this.readBytes(fileId, options);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("invalid-json-object", "A stored transaction record is not valid JSON.", { fileId });
    }
  }

  async waitForMetadata(fileId) {
    let lastError;
    const startedAt = Date.now();
    for (let attempt = 0; attempt < this.visibilityAttempts; attempt += 1) {
      try {
        return await this.readMetadata(fileId);
      } catch (error) {
        lastError = error;
        // Drive may briefly return 404 for a just-created file while its metadata
        // becomes visible. Retry only that precise condition; auth, permission,
        // malformed-response, and location errors must fail immediately.
        if (error.code !== "drive-request-failed" || error.details?.status !== 404) throw error;
        if (attempt + 1 < this.visibilityAttempts) {
          const delay = Math.min(this.visibilityDelayMs * (2 ** attempt), this.visibilityMaxDelayMs);
          if (delay > 0) await sleep(delay);
        }
      }
    }
    const elapsedMs = Date.now() - startedAt;
    const lastStatus = lastError?.details?.status ?? null;
    const cause = lastError?.code || "unknown";
    throw new DriveTransactionError(
      "visibility-timeout",
      `Drive metadata visibility failed for file ID ${fileId}: HTTP ${lastStatus ?? "unknown"} after ${this.visibilityAttempts} checks over ${elapsedMs} ms (cause: ${cause}). The write outcome may be ambiguous; preserve transaction evidence and run recovery before retrying.`,
      {
        fileId,
        attempts: this.visibilityAttempts,
        elapsedMs,
        lastStatus,
        cause,
        causeMessage: lastError?.message || null
      }
    );
  }

  assertContentSize(content, kind) {
    assertResponseSize(bytesOf(content).length, { kind, limits: this.responseLimits });
  }

  async createImmutable({ fileId, name, kind, transactionId, content, expectedSha256, maxBytes, beforeMutation, signal }) {
    return this.#mutation(async mutationScope=>{
    const bytes = copyOwnedBytes(bytesOf(content));
    assertResponseSize(bytes.length, { kind, limits: this.responseLimits });
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || bytes.length > maxBytes)) fail("byte-limit", "Object exceeds its explicit byte budget.");
    const actualHash = await hashBytes(bytes, this.crypto);
    if (actualHash !== expectedSha256) fail("content-hash-mismatch", "The bytes do not match the planned SHA-256.", { name });
    const boundary = `ft-${fileId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const mimeType = immutableContentType(kind);
    const metadata = {
      id: fileId,
      name,
      mimeType,
      parents: [this.folderId],
      appProperties: { [TAG + "Kind"]: kind, [TAG + "Transaction"]: transactionId, [TAG + "Hash"]: actualHash }
    };
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = joinBytes([head, bytes, tail]);
    const url = `${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,parents,appProperties`;
    let ambiguousCreateFailure = null;
    let createResponseSummary = null;
    try {
      const createResponse = await this.request(url, markRequestPurpose({
        signal,
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      },"immutable-create"), {allowStatuses:[409],beforeMutation,mutationScope,endpointClass:"files.create"});
      createResponseSummary = { status: createResponse.status };
      if (createResponse.ok) {
        const returnedMetadata = await readBoundedDriveJson(createResponse, { kind: "metadata", limits: this.responseLimits });
        createResponseSummary.returnedId = returnedMetadata?.id === fileId ? fileId : null;
      } else {
        await discardDriveResponse(createResponse);
      }
    } catch (error) {
      if(!this.#mutationScopes.get(mutationScope).dispatched)throw error;
      // A network failure or server-side 5xx may have happened after Drive committed
      // the create. Resolve those ambiguous outcomes using the same pre-generated ID.
      // Definitive client errors (including 400/404) prove the request was rejected;
      // do not disguise them as a later metadata-visibility timeout.
      const status = error.details?.status;
      const ambiguousHttpFailure = Number.isInteger(status) &&
        (status === 408 || status === 429 || status >= 500);
      const transportFailure = !Number.isInteger(status) && error.code !== "authorization-required";
      if (error.code === "authorization-required" || (!ambiguousHttpFailure && !transportFailure)) {
        throw error;
      }
      ambiguousCreateFailure = {
        code: error.code || error.name || "unknown",
        message: error.message || String(error),
        status: Number.isInteger(status) ? status : createResponseSummary?.status ?? null
      };
    }

    // A 409, an ambiguous transport/server failure, or a successful response all
    // resolve through the same exact-ID read-back path. Never allocate a replacement
    // ID for a retry.
    let metadataAfter;
    try {
      metadataAfter = await this.waitForMetadata(fileId);
    } catch (error) {
      if (error instanceof DriveTransactionError && error.code === "visibility-timeout") {
        const createOutcome = ambiguousCreateFailure || createResponseSummary || { status: null };
        error.details = { ...error.details, createRequest: createOutcome };
        const createStatus = Number.isInteger(createOutcome.status) ? `HTTP ${createOutcome.status}` : "no confirmed HTTP response";
        const returnedId = createOutcome.returnedId ? `; Drive returned ID ${createOutcome.returnedId}` : "";
        const createCause = createOutcome.message ? `; create error: ${createOutcome.message}` : "";
        error.message = `Drive create outcome: ${createStatus}${returnedId}${createCause}. The exact file ID ${fileId} then returned HTTP ${error.details.lastStatus} on all ${error.details.attempts} metadata checks over ${error.details.elapsedMs} ms. The write outcome is ambiguous: preserve transaction evidence and run recovery before retrying.`;
      }
      throw error;
    }
    if (metadataAfter.appProperties?.[TAG + "Kind"] !== kind ||
        metadataAfter.appProperties?.[TAG + "Transaction"] !== transactionId ||
        metadataAfter.appProperties?.[TAG + "Hash"] !== actualHash) {
      fail("immutable-metadata-mismatch", "The pre-generated Drive ID contains unexpected transaction metadata.", { fileId });
    }
    const stored = copyOwnedBytes(await this.readBytes(fileId, { kind, maxBytes, signal }));
    const storedHash = await hashBytes(stored, this.crypto);
    if (storedHash !== actualHash || stored.length !== bytes.length) {
      fail("immutable-readback-mismatch", "The immutable Drive object failed exact byte verification.", { fileId });
    }
    // Optional receipt for callers that also verify immutable writes. These are
    // detached copies of the exact-ID GET results, not the uploaded bytes or
    // create response. Callers must validate the binding and hash themselves.
    const readback = { metadata: structuredClone(metadataAfter), bytes: stored.slice() };
    await this.afterMutation?.({ kind, operation: "create" });
    return { fileId, sha256: actualHash, size: bytes.length, readback };
    });
  }

  async publishManifest(manifestFileId, manifest, { beforeMutation } = {}) {
    return this.#mutation(async mutationScope=>{
    const content = canonicalizeJcs(manifest);
    const bytes = new TextEncoder().encode(content);
    assertResponseSize(bytes.length, { kind: "manifest", limits: this.responseLimits });
    await this.readMetadata(manifestFileId);
    const boundary = `ft-manifest-${manifest.revision}`;
    const metadata = { mimeType: MIME_JSON };
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${MIME_JSON}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const published = await this.request(`${UPLOAD}/files/${encodeURIComponent(manifestFileId)}?uploadType=multipart&fields=id,name,mimeType,parents,appProperties`, markManifestRequest(markRequestPurpose({
      method: "PATCH",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: joinBytes([head, bytes, tail])
    },"manifest-patch")), {beforeMutation,mutationScope,endpointClass:"files.update"});
    await discardDriveResponse(published);
    const visible = await this.readBytes(manifestFileId, { kind: "manifest" });
    if (new TextDecoder().decode(visible) !== content) {
      fail("manifest-readback-mismatch", "The published manifest did not read back exactly.");
    }
    await this.afterMutation?.({ kind: "manifest", operation: "publish" });
    return manifest;
    });
  }
}

// Historical filename retained for the shared, security-tested Drive adapter.
export { canonicalizeJcs };
