import assert from 'node:assert/strict';
import { setImmediate, setTimeout } from 'node:timers/promises';

export const HTTP_CATEGORIES = Object.freeze(['list', 'generate-id', 'metadata', 'media', 'create', 'update']);

const copy = value => structuredClone(value);
const response = (value, status = 200) => {
  const bytes = value instanceof Uint8Array ? value.slice() : new TextEncoder().encode(JSON.stringify(value));
  return new Response(bytes,{status,headers:{'Content-Type':'application/json','Content-Length':String(bytes.length)}});
};
const fileKind = metadata => metadata?.appProperties?.financeTrackerKind ||
  (metadata?.appProperties?.financeTrackerSession ? 'session-marker' : 'unknown');

// Only the exact Drive operations used by the production adapters are modeled.
// No fallback to global fetch, real credentials, fixture exports or network I/O.
export class HttpCatalogDrive {
  constructor({ folderId = 'invented-synthetic-http-folder', idPrefix = 'invented-http-file-', latencyMs = 0 } = {}) {
    assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0);
    this.folderId = folderId;
    this.idPrefix = idPrefix;
    this.latencyMs = latencyMs;
    this.files = new Map();
    this.requests = [];
    this.phase = 'bootstrap';
    this.nextId = 0;
    this.active = 0;
    this.activeMutations = 0;
    this.peakConcurrency = 0;
    this.peakMutations = 0;
    this.mutations = 0;
    this.stopAfterMutation = Infinity;
    this.stopped = false;
    this.beforeResponse = null;
    this.pageSize = Infinity;
    this.transformListing = null;
    this.transformListingPage = null;
    this.fetch = this.fetch.bind(this);
  }

  check() {
    if (this.stopped) throw Object.assign(new Error('Invented interrupted connection'), { code: 'synthetic-interruption' });
  }

  reboot() { this.stopped = false; this.stopAfterMutation = Infinity; }

  mutate() {
    this.mutations++;
    if (this.mutations === this.stopAfterMutation) {
      this.stopped = true;
      this.check(); // The mutation happened, but its response was lost.
    }
  }

  json(fileId) { return JSON.parse(new TextDecoder().decode(this.files.get(fileId).bytes)); }

  summary(phase) {
    const rows = this.requests.filter(row => !phase || row.phase === phase);
    return {
      requests: rows.length,
      requestBytes: rows.reduce((sum,row)=>sum+(row.requestBytes||0),0),
      responseBytes: rows.reduce((sum,row)=>sum+(row.responseBytes||0),0),
      peakConcurrency: Math.max(0, ...rows.map(row => row.concurrency)),
      peakMutations: Math.max(0, ...rows.map(row => row.concurrentMutations)),
      categories: Object.fromEntries(HTTP_CATEGORIES.map(category => [category, rows.filter(row => row.category === category).length])),
      byKind: rows.reduce((counts, row) => { counts[row.kind] = (counts[row.kind] || 0) + 1; return counts; }, {}),
      mutations: rows.filter(row => row.method === 'POST' || row.method === 'PATCH').length
    };
  }

  async multipart(options) {
    const type = new Headers(options.headers).get('Content-Type');
    const boundary = type?.match(/^multipart\/related; boundary=([^;]+)$/)?.[1];
    assert.ok(boundary, 'multipart upload must have an explicit boundary');
    const body = Buffer.from(options.body instanceof Blob ? await options.body.arrayBuffer() : options.body);
    const divider = Buffer.from('\r\n\r\n');
    const metadataStart = body.indexOf(divider) + divider.length;
    const secondPart = body.indexOf(Buffer.from('\r\n--' + boundary + '\r\n'), metadataStart);
    const contentStart = body.indexOf(divider, secondPart) + divider.length;
    const contentEnd = body.lastIndexOf(Buffer.from('\r\n--' + boundary + '--'));
    assert.ok(metadataStart >= divider.length && secondPart > metadataStart && contentStart > secondPart && contentEnd >= contentStart);
    return { metadata: JSON.parse(body.subarray(metadataStart, secondPart).toString('utf8')),
      bytes: new Uint8Array(body.subarray(contentStart, contentEnd)) };
  }

  async fetch(url, options = {}) {
    const target = new URL(url), method = options.method || 'GET';
    assert.equal(target.origin, 'https://www.googleapis.com', 'unexpected HTTP destination');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer invented-test-token');
    const id = decodeURIComponent(target.pathname.split('/').at(-1));
    let category;
    if (method === 'GET' && target.pathname === '/drive/v3/files/generateIds') category = 'generate-id';
    else if (method === 'GET' && target.pathname === '/drive/v3/files') category = 'list';
    else if (method === 'GET' && target.pathname.startsWith('/drive/v3/files/')) category = target.searchParams.get('alt') === 'media' ? 'media' : 'metadata';
    else if (method === 'POST' && target.pathname === '/upload/drive/v3/files') category = 'create';
    else if (method === 'PATCH' && target.pathname.startsWith('/upload/drive/v3/files/')) category = 'update';
    else assert.fail('Unmodeled Drive operation: ' + method + ' ' + target.pathname);
    const mutation = category === 'create' || category === 'update';
    const row = { phase: this.phase, fileId:id, category, method, kind: fileKind(this.files.get(id)?.metadata), status: null };
    row.requestBytes = typeof options.body === "string" ? new TextEncoder().encode(options.body).length : options.body?.byteLength || options.body?.size || 0;
    this.requests.push(row);
    this.peakConcurrency = Math.max(this.peakConcurrency, ++this.active);
    if (mutation) this.peakMutations = Math.max(this.peakMutations, ++this.activeMutations);
    row.concurrency = this.active;
    row.concurrentMutations = this.activeMutations;
    try {
      // Give concurrent requests a deterministic opportunity to overlap. This is
      // not a Drive latency model and no elapsed-time assertion depends on it.
      await (this.latencyMs ? setTimeout(this.latencyMs) : setImmediate());
      this.check();
      await this.beforeResponse?.({ category, method, fileId: id, row });
      const result = await this.respond(target, options, category, id, row);
      row.status = result.status;
      row.responseBytes = Number(result.headers.get("Content-Length")) || 0;
      return result;
    } finally {
      this.active--;
      if (mutation) this.activeMutations--;
    }
  }

  async respond(target, options, category, id, row) {
    if (category === 'generate-id') {
      const count = Number(target.searchParams.get('count'));
      assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 1000);
      assert.equal(target.searchParams.get('space'), 'drive');
      return response({ ids: Array.from({ length: count }, () => this.idPrefix + ++this.nextId) });
    }
    if (category === 'list') {
      const folderQuery = `'${this.folderId}' in parents and trashed = false`;
      const markerQuery = folderQuery + " and (name = 'finance-tracker-active-session.json' or appProperties has { key='financeTrackerSession' and value='v1' })";
      const query = target.searchParams.get('q');
      assert.ok(query === folderQuery || query === markerQuery, 'unexpected listing query');
      const fields = target.searchParams.get('fields')?.match(/files\(([^)]+)\)/)?.[1].split(',');
      assert.ok(fields?.includes('id'), 'folder listings must request file identities');
      let files = [...this.files.values()]
        .filter(file => !file.metadata.trashed && file.metadata.parents.includes(this.folderId))
        .map(file => copy(Object.fromEntries(fields.filter(field => Object.hasOwn(file.metadata, field))
          .map(field => [field, file.metadata[field]]))));
      if (query === markerQuery) files = files.filter(file => file.name === 'finance-tracker-active-session.json' || file.appProperties?.financeTrackerSession === 'v1');
      if (this.transformListing) files = this.transformListing(files);
      const token = target.searchParams.get('pageToken');
      assert.ok(!token || /^invented-page-\d+$/.test(token), 'unexpected pagination token');
      const start = token ? Number(token.slice('invented-page-'.length)) : 0;
      const size = Math.min(this.pageSize, Number(target.searchParams.get('pageSize')));
      assert.ok(size > 0 && start >= 0 && start <= files.length);
      const page = { incompleteSearch: false, files: files.slice(start, start + size) };
      if (start + size < files.length) page.nextPageToken = 'invented-page-' + (start + size);
      return response(this.transformListingPage ? this.transformListingPage(page) : page);
    }
    if (category === 'metadata' || category === 'media') {
      const file = this.files.get(id);
      return file ? response(category === 'media' ? file.bytes : copy(file.metadata)) : response({}, 404);
    }
    if (category === 'create') {
      assert.equal(target.searchParams.get('uploadType'), 'multipart');
      const { metadata, bytes } = await this.multipart(options);
      row.kind = fileKind(metadata); row.fileId=metadata.id;
      assert.ok(metadata.id?.startsWith(this.idPrefix));
      assert.deepEqual(metadata.parents, [this.folderId]);
      if (this.files.has(metadata.id)) return response({}, 409);
      const stored = { ...metadata, trashed: false, version: '1', size: String(bytes.length) };
      this.files.set(metadata.id, { metadata: copy(stored), bytes });
      this.mutate();
      return response(stored);
    }
    const file = this.files.get(id);
    if (!file) return response({}, 404);
    if (target.searchParams.get('uploadType') === 'multipart') {
      const { metadata, bytes } = await this.multipart(options);
      assert.ok(['dashboard-synthetic-manifest', 'paged-canonical-manifest', 'copy-preparation'].includes(fileKind(file.metadata)), 'only the manifest or copy preparation may be replaced');
      Object.assign(file.metadata, metadata);
      file.bytes = bytes;
    } else {
      assert.equal(target.searchParams.get('uploadType'), 'media');
      assert.equal(fileKind(file.metadata), 'session-marker', 'only the session marker may use media updates');
      file.bytes = new TextEncoder().encode(options.body);
    }
    file.metadata.version = String(Number(file.metadata.version) + 1);
    file.metadata.size = String(file.bytes.length);
    this.mutate();
    return response(copy(file.metadata));
  }
}
