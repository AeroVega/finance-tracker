import { canonicalizeJcs, verifyJournal } from "./transaction-protocol.mjs";
import { encode, hashRaw, readVerified, storageError } from "./catalog-storage.mjs";
import { archiveOriginalImports } from "./drive-original-retention.mjs";
import { verifyCatalogArchive, restoreCatalogArchive } from "./catalog-backup.mjs";

function base64(bytes) { let text = ""; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); }

/** Explicit, synthetic-only conversion into a separate copy; never mutates source. */
export async function convertLegacySyntheticCopy({ sourceAdapter, sourceManifestFileId, withSourceLock, assertSourceWritable,
  targetAdapter, withTargetLock, assertTargetWritable, validateStructure, now = new Date().toISOString() }) {
  if (typeof withSourceLock !== "function" || typeof assertSourceWritable !== "function" || sourceAdapter.folderId === targetAdapter.folderId) {
    throw storageError("invalid-conversion-gates", "Conversion requires a verified source session and a separate fresh destination.");
  }
  return withSourceLock(async () => {
    const manifest = await sourceAdapter.readJson(sourceManifestFileId);
    if (manifest.format !== "finance-tracker-manifest" || manifest.syntheticOnly !== true || manifest.manifestVersion !== "1.0.0" ||
        manifest.role !== "primary" || !manifest.databaseId || !manifest.copyId || !Number.isSafeInteger(manifest.revision) || manifest.revision < 0) {
      throw storageError("legacy-synthetic-copy-required", "Only a recognized legacy synthetic primary can be converted.");
    }
    const files = await sourceAdapter.listChildren();
    const commits = new Map();
    const groups = new Map();
    const objects = new Map();
    const add = async (kind, identity, bytes, extra = {}) => {
      const sha256 = await hashRaw(bytes);
      const key = kind + ":" + identity;
      const prior = objects.get(key);
      if (prior && prior.sha256 !== sha256) throw storageError("ambiguous-legacy-object", "Legacy identities have conflicting bytes.");
      objects.set(key, { kind, identity, sha256, contentBase64: base64(bytes), ...extra });
    };
    for (const file of files.filter((item) => ["commit-record", "journal-event"].includes(item.appProperties?.financeTrackerKind))) {
      const bytes = await readVerified(sourceAdapter, { fileId: file.id, sha256: file.appProperties.financeTrackerHash,
        kind: file.appProperties.financeTrackerKind, transactionId: file.appProperties.financeTrackerTransaction });
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (file.appProperties.financeTrackerKind === "commit-record") {
        if (value.databaseId === manifest.databaseId && value.copyId === manifest.copyId) {
          if (commits.has(value.commitId)) throw storageError("ambiguous-legacy-commit", "Multiple physical records claim a legacy commit identity.");
          commits.set(value.commitId, { value, bytes, file });
        }
      } else {
        if (!groups.has(value.transactionId)) groups.set(value.transactionId, []);
        groups.get(value.transactionId).push({ value, bytes });
      }
    }
    const verifiedJournals = [];
    for (const group of groups.values()) {
      group.sort((a, b) => a.value.sequence - b.value.sequence);
      const state = await verifyJournal(group.map((item) => item.value));
      const start = group[0].value.payload;
      if (start.databaseId === manifest.databaseId && start.copyId === manifest.copyId) {
        if (!["committed", "aborted"].includes(state.status)) throw storageError("legacy-recovery-required", "Complete legacy recovery before converting a copy.");
        verifiedJournals.push({ group, state, start });
        for (const item of group) await add("migration-record", "legacy-journal:" + item.value.eventId, item.bytes);
      }
    }
    let commitId = manifest.commitId;
    let revision = manifest.revision;
    let newCommitHash;
    const seen = new Set();
    while (revision >= 0) {
      if (seen.has(commitId)) throw storageError("legacy-history-cycle", "Legacy history is cyclic.");
      seen.add(commitId);
      const source = commits.get(commitId);
      let logical;
      if (!source) {
        // PR24 bootstrap did not create a genesis record. Recognize ONLY the
        // empty revision-zero seed attested by the first verified journal base,
        // or the selected still-empty bootstrap manifest. Record that exception.
        const emptySeed = revision === 0 && (verifiedJournals.some(({ start }) => start.baseRevision === 0 && start.baseCommitId === commitId) ||
          (manifest.revision === 0 && manifest.commitId === commitId && Object.keys(manifest.snapshot || {}).length === 0));
        if (!emptySeed) throw storageError("missing-legacy-history", "Legacy history is incomplete; it cannot be guessed or repaired automatically.");
        logical = { format: "finance-tracker-commit", version: 2, databaseId: manifest.databaseId, revision: 0, commitId,
          parentCommitId: null, operationType: "explicit-legacy-empty-genesis-conversion", snapshot: {},
          migrationProvenance: { kind: "pr24-empty-bootstrap", legacyManifestHash: await hashRaw(encode(manifest)) } };
      } else {
        const record = source.value;
        if (record.format !== "finance-tracker-commit" || record.version !== 1 || record.revision !== revision || !record.snapshot ||
            typeof record.snapshot !== "object" || Array.isArray(record.snapshot) ||
            !verifiedJournals.some(({ state }) => state.status === "committed" && state.commit.commitId === commitId && state.commit.recordHash === source.file.appProperties.financeTrackerHash)) {
          throw storageError("invalid-legacy-commit", "Legacy commit identity, revision, or terminal journal evidence is invalid.");
        }
        if (revision === manifest.revision && (source.file.id !== manifest.commitRecordFileId || source.file.appProperties.financeTrackerHash !== manifest.commitRecordHash)) {
          throw storageError("legacy-manifest-mismatch", "The legacy manifest does not identify the verified head record.");
        }
        const snapshot = {};
        for (const [path, reference] of Object.entries(record.snapshot)) {
          if (!path.trim() || ["__proto__", "prototype", "constructor"].includes(path) || !reference?.fileId || !/^[a-f0-9]{64}$/.test(reference.sha256 || "")) {
            throw storageError("invalid-legacy-reference", "Legacy snapshot references are malformed.");
          }
          const bytes = await readVerified(sourceAdapter, { fileId: reference.fileId, sha256: reference.sha256, kind: "snapshot-object" });
          await add("data-object", reference.sha256, bytes);
          snapshot[path] = reference.sha256;
        }
        const { copyId, ...history } = record;
        logical = { ...history, version: 2, snapshot,
          migrationProvenance: { legacyCommitHash: source.file.appProperties.financeTrackerHash } };
        await add("migration-record", "legacy-commit:" + commitId, source.bytes);
      }
      await add("commit-record", commitId, encode(logical));
      if (revision === manifest.revision) newCommitHash = await hashRaw(encode(logical));
      commitId = logical.parentCommitId;
      revision -= 1;
    }
    if (commitId !== null) throw storageError("legacy-history-mismatch", "The legacy ancestry does not terminate at genesis.");
    await add("migration-record", "legacy-selected-manifest", encode(manifest));
    const convertedHead = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(objects.get("commit-record:" + manifest.commitId).contentBase64), (part) => part.charCodeAt(0))));
    const archive = { format: "finance-tracker-portable-backup", version: 2, sourceCopyId: manifest.copyId, exportedAt: now,
      manifest: { format: "finance-tracker-manifest", manifestVersion: "2.0.0", schemaVersion: manifest.schemaVersion || 1,
        syntheticOnly: true, databaseId: manifest.databaseId, copyId: manifest.copyId, role: "primary", lifecycleStatus: "active",
        revision: manifest.revision, commitId: manifest.commitId, parentCommitId: convertedHead.parentCommitId,
        snapshot: convertedHead.snapshot, commitRecordHash: newCommitHash, catalogFinalizationPending: null,
        storageBinding: { provider: "portable-archive", folderId: null } }, objects: [...objects.values()],
      originalImports: await archiveOriginalImports(sourceAdapter, now) };
    archive.archiveSha256 = await hashRaw(encode(archive));
    await verifyCatalogArchive(archive, { validateStructure });
    const result = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock, assertTargetWritable, validateStructure,
      beforePublish: async () => {
        await assertSourceWritable();
        if (canonicalizeJcs(await sourceAdapter.readJson(sourceManifestFileId)) !== canonicalizeJcs(manifest)) throw storageError("legacy-source-changed", "The legacy source changed during conversion.");
      } });
    return { ...result, conversionArchive: archive };
  });
}
