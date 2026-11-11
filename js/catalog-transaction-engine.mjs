import { DriveTransactionEngine, DriveTransactionError } from "./drive-transaction-engine.mjs";
import { canonicalizeJcs, createJournalEvent, verifyJournal } from "./transaction-protocol.mjs";
import { createLocatorCatalog, createCatalogResolver } from "./drive-locator-catalog.mjs";
import { encode, hashRaw, writeVerified, readVerified, mapImmutableReads, writeCatalog, createCatalogHistoryVerifier, validateLogicalCommit, storageError } from "./catalog-storage.mjs";

const equal = (a, b) => canonicalizeJcs(a) === canonicalizeJcs(b);

/** Version-2 synthetic engine. Legacy history is never rewritten implicitly. */
export class CatalogTransactionEngine extends DriveTransactionEngine {
  #historyVerifier = createCatalogHistoryVerifier();

  invalidateHistory() { this.#historyVerifier.clear(); }
  async verifyHistory(manifest) {
    return this.#historyVerifier.verify(this.adapter, manifest, this.crypto);
  }
  enqueue(operation) {
    return super.enqueue(async () => {
      try { return await operation(); }
      catch (error) { this.invalidateHistory(); throw error; }
    });
  }
  async recoveryGuard() {
    if (!this.isOnline()) throw storageError("offline", "Storage maintenance requires an online session.");
    await this.assertWritable();
  }
  async publishExact(manifestFileId, base, next) {
    await this.assertWritable();
    if (!this.isOnline()) throw storageError("offline", "Manifest publication requires an online session.");
    if (!equal(await this.adapter.readJson(manifestFileId, { kind: "manifest" }), base)) throw storageError("base-conflict", "The exact base manifest changed before publication.");
    await this.adapter.publishManifest(manifestFileId, next, { beforeMutation: async () => {
      if (!this.isOnline()) throw storageError("offline", "Publication stopped while offline.");
      await this.assertWritable();
    } });
    if (!equal(await this.adapter.readJson(manifestFileId, { kind: "manifest" }), next)) throw storageError("manifest-readback-mismatch", "The exact intended manifest did not read back.");
  }

  async journal(eventType, payload, events, additions, transactionId) {
    const event = await createJournalEvent({ transactionId, eventId: this.crypto.randomUUID(), sequence: events.length,
      eventType, timestamp: this.now(), payload, previousEventHash: events.at(-1)?.eventHash || null, cryptoImpl: this.crypto });
    const location = await writeVerified(this.adapter, { content: event, kind: "journal-event", transactionId,
      name: "ft-journal-" + event.eventId + ".json" }, async () => {
      if (!this.isOnline()) throw storageError("offline", "Journal writes require an online session.");
      await this.assertWritable();
    }, this.crypto);
    events.push(event);
    additions.push({ kind: "journal-event", identity: event.eventId, transactionId, sequence: event.sequence, ...location });
    return event;
  }

  async transact({ manifestFileId, expectedBase, objects, commitRecord = {}, transactionId = this.crypto.randomUUID() }) {
    return this.enqueue(async () => {
      await this.guard();
      // Folder enumeration catches even a start event created by a prior page
      // which died before publishing any new catalog pointer.
      const recovered = await this.recoverInternal({ manifestFileId });
      const current = await this.adapter.readJson(manifestFileId, { kind: "manifest" });
      if (!equal(current, expectedBase) || !equal(current, recovered.manifest)) throw storageError("base-conflict", "The transaction requires the exact verified base manifest.");
      if (current.role !== "primary") throw storageError("read-only-copy", "Backup copies cannot accept transactions.");
      // Recovery just verified this complete history after all repair writes.
      // Reuse it only inside this operation and after the exact manifest check.
      const { catalog } = recovered.verified;
      if (!Array.isArray(objects) || !objects.length) throw storageError("invalid-transaction", "Changed objects are required.");
      const paths = new Set();
      const planned = [];
      for (const object of objects) {
        if (typeof object.logicalPath !== "string" || !object.logicalPath.trim() || paths.has(object.logicalPath) ||
            ["__proto__", "prototype", "constructor"].includes(object.logicalPath)) throw storageError("invalid-logical-path", "Changed object paths must be unique and valid.");
        paths.add(object.logicalPath);
        const bytes = object.content instanceof Uint8Array ? object.content : encode(object.content);
        // Reject data that this adapter could not reopen before starting a
        // durable journal. Physical and logical tags share one byte budget.
        this.adapter.assertContentSize?.(bytes, "data-object");
        planned.push({ logicalPath: object.logicalPath, bytes, sha256: await hashRaw(bytes, this.crypto) });
      }
      const files = await this.adapter.listChildren();
      if (files.some((file) => file.appProperties?.financeTrackerTransaction === transactionId)) throw storageError("transaction-already-exists", "This transaction identity already has durable evidence.");
      const additions = [];
      const events = [];
      const add = (type, payload) => this.journal(type, payload, events, additions, transactionId);
      const commitId = this.crypto.randomUUID();
      try {
        await add("transaction-started", { databaseId: current.databaseId, copyId: current.copyId,
          baseRevision: current.revision, baseCommitId: current.commitId, baseManifestHash: await hashRaw(encode(current), this.crypto),
          intendedRevision: current.revision + 1, intendedCommitId: commitId });
        const snapshot = { ...current.snapshot };
        for (const item of planned) {
          const existing = catalog.entries["data-object:" + item.sha256] || additions.find((entry) => entry.kind === "data-object" && entry.identity === item.sha256);
          if (!existing) {
            const fileId = await this.adapter.allocateFileId();
            await add("object-stage-planned", { logicalPath: item.logicalPath, fileId, sha256: item.sha256 });
            const location = await writeVerified(this.adapter, { fileId, content: item.bytes, kind: "snapshot-object", transactionId,
              name: "ft-object-" + item.sha256 + ".bin" }, () => this.guard(), this.crypto);
            additions.push({ kind: "data-object", identity: item.sha256, ...location });
            await add("object-staged", { fileId, sha256: item.sha256 });
          }
          snapshot[item.logicalPath] = item.sha256;
        }
        const record = { format: "finance-tracker-commit", version: 2, databaseId: current.databaseId,
          revision: current.revision + 1, commitId, parentCommitId: current.commitId, transactionId,
          committedAt: this.now(), operationType: commitRecord.operationType || "synthetic-update",
          schemaVersion: commitRecord.schemaVersion || 1, snapshot };
        const commitFileId = await this.adapter.allocateFileId();
        await add("commit-stage-planned", { commitId, fileId: commitFileId });
        const commit = await writeVerified(this.adapter, { fileId: commitFileId, content: record, kind: "commit-record", transactionId,
          name: "ft-commit-" + commitId + ".json" }, () => this.guard(), this.crypto);
        additions.push({ kind: "commit-record", identity: commitId, ...commit });
        await add("commit-staged", { commitId, recordHash: commit.sha256 });
        const next = { ...current, revision: record.revision, commitId, parentCommitId: current.commitId,
          commitRecordHash: commit.sha256, snapshot, catalogFinalizationPending: transactionId };
        const staged = await writeCatalog(this.adapter, { manifest: next, previousCatalog: catalog, additions }, () => this.guard(), this.crypto);
        next.locatorCatalog = staged.pointer;
        await this.verifyHistory(next);
        // This event cannot index itself. It and the terminal events are added
        // by the second, catalog-only publication after the financial commit.
        await add("manifest-publication-planned", { baseRevision: current.revision, baseCommitId: current.commitId,
          intendedRevision: next.revision, intendedCommitId: commitId, nextManifest: next });
        await this.publishExact(manifestFileId, current, next);
        await add("manifest-published", { commitId });
        await add("transaction-committed", { commitId });
        const manifest = await this.finalize(manifestFileId, next, staged.catalog, additions);
        this.recoveryRequired = false;
        return { transactionId, commitId, revision: manifest.revision, manifest };
      } catch (error) {
        this.recoveryRequired = true;
        throw new DriveTransactionError("transaction-unresolved", "Preserve the synthetic transaction evidence and reconnect for recovery.",
          { transactionId, cause: error.code || error.name });
      }
    });
  }

  async finalize(manifestFileId, manifest, catalog, additions) {
    createLocatorCatalog({ databaseId: manifest.databaseId, copyId: manifest.copyId,
      previousCatalog: catalog, previousCatalogHash: manifest.locatorCatalog.sha256, additions });
    const missing = additions.filter((entry) => !catalog.entries[entry.kind + ":" + entry.identity]);
    if (!missing.length && manifest.catalogFinalizationPending === null) return manifest;
    const staged = await writeCatalog(this.adapter, { manifest, previousCatalog: catalog, additions }, () => this.recoveryGuard(), this.crypto);
    const next = { ...manifest, locatorCatalog: staged.pointer, catalogFinalizationPending: null };
    await this.verifyHistory(next);
    await this.publishExact(manifestFileId, manifest, next);
    return next;
  }

  async recover(options) {
    return this.enqueue(() => {
      // Explicit reconnect/recovery starts from remotely fetched bytes.
      this.invalidateHistory();
      return this.recoverInternal(options);
    });
  }

  async recoverInternal({ manifestFileId }) {
    this.recoveryRequired = true;
    if (!this.isOnline()) throw storageError("offline", "Recovery requires an online connection.");
    let manifest = await this.adapter.readJson(manifestFileId, { kind: "manifest" });
    let verified = await this.verifyHistory(manifest);
    let resolver = createCatalogResolver(verified.catalog);
    const files = await this.adapter.listChildren();
    const groups = new Map();
    const additions = [];
    const indexedJournals = new Map(Object.entries(verified.catalog.entries)
      .filter(([, entry]) => entry.kind === "journal-event").map(([key, entry]) => [entry.fileId, { key, entry }]));
    const journals = await mapImmutableReads(files.filter((item) => item.appProperties?.financeTrackerKind === "journal-event"), async (file) => {
      const indexed = indexedJournals.get(file.id);
      // Enumeration remains mandatory to find unindexed crash evidence. Only
      // the identical binding can reuse bytes from this recovery's full scan.
      const reusable = indexed && indexed.entry.sha256 === file.appProperties.financeTrackerHash &&
        indexed.entry.transactionId === file.appProperties.financeTrackerTransaction &&
        (!verified.versions || verified.versions.get(file.id) === file.version) &&
        file.trashed !== true && file.parents?.includes(this.adapter.folderId);
      const bytes = reusable ? verified.objects.get(indexed.key) : await readVerified(this.adapter,
        { fileId: file.id, sha256: file.appProperties.financeTrackerHash, kind: "journal-event",
          transactionId: file.appProperties.financeTrackerTransaction }, this.crypto);
      const event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (event.transactionId !== file.appProperties.financeTrackerTransaction ||
          (reusable && (event.eventId !== indexed.entry.identity || event.sequence !== indexed.entry.sequence))) {
        throw storageError("journal-identity-mismatch", "Journal identity does not match Drive metadata or its retained locator.");
      }
      return { file, event };
    });
    for (const { file, event } of journals) {
      if (!groups.has(event.transactionId)) groups.set(event.transactionId, []);
      groups.get(event.transactionId).push({ event, location: { kind: "journal-event", identity: event.eventId,
        transactionId: event.transactionId, sequence: event.sequence, fileId: file.id, sha256: file.appProperties.financeTrackerHash } });
    }
    // Preflight all groups before performing recovery mutations.
    const scoped = [];
    for (const [transactionId, group] of groups) {
      group.sort((a, b) => a.event.sequence - b.event.sequence);
      const events = group.map((item) => item.event);
      const state = await verifyJournal(events, { cryptoImpl: this.crypto });
      const base = events[0].payload;
      if (!base.databaseId || !base.copyId) throw storageError("journal-identity-mismatch", "Journal start has no database and copy binding.");
      if (base.copyId === manifest.copyId && base.databaseId !== manifest.databaseId) throw storageError("journal-identity-mismatch", "Copy identity is associated with another database.");
      if (base.databaseId === manifest.databaseId && base.copyId === manifest.copyId) {
        scoped.push({ transactionId, events, state, base });
        additions.push(...group.map((item) => item.location));
      }
    }
    const incomplete = scoped.filter((group) => !["committed", "aborted"].includes(group.state.status));
    if (incomplete.length > 1) throw storageError("ambiguous-transactions", "Multiple incomplete transactions require inspection.");
    if (manifest.catalogFinalizationPending && !scoped.some((group) => group.transactionId === manifest.catalogFinalizationPending)) {
      throw storageError("missing-pending-journal", "The manifest's pending transaction has no complete journal evidence.");
    }
    const outcomes = [];
    for (const group of scoped) {
      const { transactionId, events, base } = group;
      let { state } = group;
      if (state.status === "aborted") {
        if (manifest.catalogFinalizationPending === transactionId) throw storageError("pending-aborted-transaction", "A published financial commit cannot belong to an aborted transaction.");
        outcomes.push({ transactionId, outcome: "aborted" }); continue;
      }
      let intended = events.find((event) => event.eventType === "manifest-publication-planned")?.payload.nextManifest;
      if (state.status === "committed") {
        const entry = resolver.resolve({ kind: "commit-record", identity: state.commit.commitId });
        if (entry.sha256 !== state.commit.recordHash) throw storageError("journal-commit-mismatch", "Terminal journal does not match retained commit history.");
        if (manifest.catalogFinalizationPending === transactionId && (!intended || manifest.commitId !== intended.commitId ||
            !equal(manifest, intended))) throw storageError("pending-manifest-mismatch", "Pending publication does not match the journal's exact intent.");
        outcomes.push({ transactionId, outcome: "committed" });
        continue;
      }
      if (!intended) {
        if (await hashRaw(encode(manifest), this.crypto) !== base.baseManifestHash || manifest.catalogFinalizationPending !== null) {
          throw storageError("recovery-base-mismatch", "An unpublished transaction no longer matches its exact base.");
        }
        const stagedObjects = [];
        const visibleOrAbsent = async (fileId) => {
          try { return await (this.adapter.waitForMetadata ? this.adapter.waitForMetadata(fileId) : this.adapter.readMetadata(fileId)); }
          catch (error) {
            if (error.details?.status === 404 || (error.code === "visibility-timeout" && error.details?.lastStatus === 404)) return null;
            throw error;
          }
        };
        for (const planned of events.filter((event) => event.eventType === "object-stage-planned")) {
          const reference = planned.payload;
          if (await visibleOrAbsent(reference.fileId)) {
            await readVerified(this.adapter, { ...reference, kind: "snapshot-object", transactionId }, this.crypto);
            stagedObjects.push({ kind: "data-object", identity: reference.sha256, sha256: reference.sha256, fileId: reference.fileId });
          } else if (state.status !== "staging") throw storageError("missing-staged-object", "A committed-stage object is unavailable; preserve evidence.");
        }
        const commitPlan = events.find((event) => event.eventType === "commit-stage-planned");
        const metadata = commitPlan ? await visibleOrAbsent(commitPlan.payload.fileId) : null;
        if (!metadata) {
          if (state.status === "ready-to-publish") throw storageError("missing-staged-commit", "A previously verified commit is unavailable; preserve evidence.");
          await this.journal("transaction-aborted", { reason: "no-complete-commit-at-verified-base" }, events, additions, transactionId);
          outcomes.push({ transactionId, outcome: "aborted" });
          continue;
        }
        const location = { fileId: commitPlan.payload.fileId, sha256: metadata.appProperties?.financeTrackerHash };
        const bytes = await readVerified(this.adapter, { ...location, kind: "commit-record", transactionId }, this.crypto);
        const record = JSON.parse(new TextDecoder().decode(bytes));
        validateLogicalCommit(record, manifest.databaseId);
        if (record.transactionId !== transactionId || record.commitId !== base.intendedCommitId || record.commitId !== commitPlan.payload.commitId ||
            record.revision !== base.baseRevision + 1 || record.parentCommitId !== base.baseCommitId ||
            (state.commit && state.commit.recordHash !== location.sha256)) throw storageError("staged-commit-mismatch", "The staged commit does not match its transaction plan.");
        additions.push(...stagedObjects, { kind: "commit-record", identity: record.commitId, ...location });
        if (state.status === "commit-staging") await this.journal("commit-staged", { commitId: record.commitId, recordHash: location.sha256 }, events, additions, transactionId);
        intended = { ...manifest, revision: record.revision, commitId: record.commitId, parentCommitId: manifest.commitId,
          commitRecordHash: location.sha256, snapshot: record.snapshot, catalogFinalizationPending: transactionId };
        const staged = await writeCatalog(this.adapter, { manifest: intended, previousCatalog: verified.catalog, additions }, () => this.recoveryGuard(), this.crypto);
        intended.locatorCatalog = staged.pointer;
        await this.verifyHistory(intended);
        await this.journal("manifest-publication-planned", { baseRevision: manifest.revision, baseCommitId: manifest.commitId,
          intendedRevision: intended.revision, intendedCommitId: intended.commitId, nextManifest: intended }, events, additions, transactionId);
        state = await verifyJournal(events, { cryptoImpl: this.crypto });
      }
      if (intended.databaseId !== base.databaseId || intended.copyId !== base.copyId || intended.revision !== base.baseRevision + 1 ||
          intended.commitId !== base.intendedCommitId || intended.parentCommitId !== base.baseCommitId ||
          intended.catalogFinalizationPending !== transactionId || intended.role !== "primary") {
        throw storageError("invalid-publication-intent", "Publication intent does not match transaction identity and lineage.");
      }
      const target = await this.verifyHistory(intended);
      if (target.record.transactionId !== transactionId || intended.commitRecordHash !== state.commit?.recordHash) {
        throw storageError("journal-commit-mismatch", "Publication intent does not match its staged commit.");
      }
      if (!equal(manifest, intended)) {
        if (state.status === "published-unverified" || await hashRaw(encode(manifest), this.crypto) !== base.baseManifestHash) {
          throw storageError("recovery-base-mismatch", "The manifest matches neither the exact base nor the intended publication.");
        }
        await this.publishExact(manifestFileId, manifest, intended);
        manifest = intended;
        verified = target;
        resolver = createCatalogResolver(verified.catalog);
      }
      if (state.status === "publishing") await this.journal("manifest-published", { commitId: intended.commitId }, events, additions, transactionId);
      await this.journal("transaction-committed", { commitId: intended.commitId }, events, additions, transactionId);
      outcomes.push({ transactionId, outcome: "committed" });
    }
    // Existing identities must also agree in file ID, hash and journal binding;
    // createLocatorCatalog rejects a duplicate/rebound enumeration result.
    manifest = await this.finalize(manifestFileId, manifest, verified.catalog, additions);
    verified = await this.verifyHistory(manifest);
    if (!equal(await this.adapter.readJson(manifestFileId, { kind: "manifest" }), manifest)) {
      throw storageError("base-conflict", "The manifest changed while recovery verified retained history.");
    }
    this.recoveryRequired = false;
    return { manifest, transactions: outcomes, verified };
  }
}
