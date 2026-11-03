import { encode, hashRaw, initializeCatalogCopy } from "../../js/catalog-storage.mjs";
import { CatalogTransactionEngine } from "../../js/catalog-transaction-engine.mjs";

export class MemoryCatalogDrive {
  constructor(folderId = "invented-synthetic-folder") {
    this.folderId = folderId;
    this.files = new Map();
    this.nextId = 0;
    this.mutations = 0;
    this.stopAfter = Infinity;
    this.stopped = false;
  }
  check() { if (this.stopped) throw Object.assign(new Error("Simulated page termination"), { code: "page-terminated" }); }
  mutate() { if (++this.mutations === this.stopAfter) { this.stopped = true; this.check(); } }
  reboot() { this.stopped = false; this.stopAfter = Infinity; }
  async allocateFileId() { this.check(); return this.folderId + "-" + ++this.nextId; }
  async readBytes(id) { this.check(); if (!this.files.has(id)) throw Object.assign(new Error("Missing"), { details: { status: 404 } }); return this.files.get(id).bytes.slice(); }
  async readJson(id) { return JSON.parse(new TextDecoder().decode(await this.readBytes(id))); }
  async readMetadata(id) { this.check(); if (!this.files.has(id)) throw Object.assign(new Error("Missing"), { details: { status: 404 } }); return structuredClone(this.files.get(id).metadata); }
  async listChildren() { this.check(); return [...this.files.values()].map((file) => structuredClone(file.metadata)); }
  async createImmutable({ fileId, content, name, kind, transactionId, expectedSha256 }) {
    this.check();
    if (this.files.has(fileId)) throw new Error("Conflict");
    const bytes = content instanceof Uint8Array ? content : encode(content);
    if (await hashRaw(bytes) !== expectedSha256) throw new Error("Bad planned hash");
    this.files.set(fileId, { bytes, metadata: { id: fileId, name, parents: [this.folderId], trashed: false,
      appProperties: { financeTrackerKind: kind, financeTrackerTransaction: transactionId, financeTrackerHash: expectedSha256 } } });
    this.mutate();
    return { fileId };
  }
  async publishManifest(id, manifest, { beforeMutation } = {}) {
    this.check(); await beforeMutation?.(); this.files.get(id).bytes = encode(manifest); this.mutate(); return manifest;
  }
  async appendJournal(event, fileId) {
    return this.createImmutable({ fileId, content: encode(event), name: "ft-journal-" + event.eventId + ".json",
      kind: "journal-event", transactionId: event.transactionId, expectedSha256: await hashRaw(encode(event)) });
  }
}

export async function setupCatalog() {
  const adapter = new MemoryCatalogDrive();
  const { manifest, manifestFileId } = await initializeCatalogCopy({ adapter, guard: async () => {} });
  const engine = new CatalogTransactionEngine({ adapter, assertWritable: async () => {}, isOnline: () => true });
  const transaction = { manifestFileId, expectedBase: manifest,
    objects: [{ logicalPath: "synthetic/ledger.json", content: '{"syntheticOnly":true,"value":1}' }],
    commitRecord: { operationType: "synthetic-test" } };
  adapter.mutations = 0;
  return { adapter, engine, manifest, manifestFileId, transaction };
}
