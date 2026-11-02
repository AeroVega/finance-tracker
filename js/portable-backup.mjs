import { canonicalizeJcs } from "./transaction-protocol.mjs";

export class PortableBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortableBackupError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PortableBackupError(code, message);
}

async function sha256(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) fail("crypto-unavailable", "Web Crypto SHA-256 is unavailable.");
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  fail("invalid-object-bytes", "Portable backup objects must be text or bytes.");
}

function toBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail("invalid-base64", "A portable backup object contains invalid base64 data.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validateManifest(manifest) {
  const required = ["databaseId", "copyId", "commitId", "revision", "role", "storageBinding"];
  if (!manifest || required.some((key) => manifest[key] === undefined || manifest[key] === null)) {
    fail("invalid-manifest", "The backup manifest is missing required identity or revision fields.");
  }
  if (manifest.role !== "backup" || manifest.lifecycleStatus === "quarantined") {
    fail("not-restorable-backup", "Only a verified, non-quarantined backup copy can be exported or restored.");
  }
  if (!Number.isSafeInteger(manifest.revision) || manifest.revision < 0) fail("invalid-revision", "The backup revision is invalid.");
}

function validateCommit(manifest, commitRecord) {
  if (!commitRecord || commitRecord.format !== "finance-tracker-commit" || commitRecord.version !== 1 ||
      commitRecord.databaseId !== manifest.databaseId ||
      commitRecord.commitId !== manifest.commitId || commitRecord.revision !== manifest.revision ||
      !commitRecord.snapshot || typeof commitRecord.snapshot !== "object" || Array.isArray(commitRecord.snapshot)) {
    fail("commit-identity-mismatch", "The commit record does not match the backup manifest identity and revision.");
  }
}

export async function createPortableBackup({ manifest, commitRecord, objects, exportedAt = new Date().toISOString(), cryptoImpl = globalThis.crypto }) {
  validateManifest(manifest);
  validateCommit(manifest, commitRecord);
  if (!Array.isArray(objects)) fail("invalid-object-list", "Portable backup objects must be an array.");
  const expectedPaths = Object.keys(commitRecord.snapshot).sort();
  const supplied = new Map();
  for (const item of objects) {
    if (!item || typeof item.logicalPath !== "string" || !item.logicalPath || supplied.has(item.logicalPath)) {
      fail("invalid-logical-path", "Portable backup object paths must be unique and non-empty.");
    }
    supplied.set(item.logicalPath, toBytes(item.bytes));
  }
  if (expectedPaths.length !== supplied.size || expectedPaths.some((path) => !supplied.has(path))) {
    fail("snapshot-object-set-mismatch", "The portable backup must contain exactly the objects referenced by the committed snapshot.");
  }
  const archivedObjects = [];
  for (const logicalPath of expectedPaths) {
    const reference = commitRecord.snapshot[logicalPath];
    const bytes = supplied.get(logicalPath);
    const actualHash = await sha256(bytes, cryptoImpl);
    if (!reference || actualHash !== reference.sha256) fail("object-hash-mismatch", `Snapshot object verification failed for ${logicalPath}.`);
    archivedObjects.push({ logicalPath, sha256: actualHash, contentBase64: toBase64(bytes) });
  }
  const archive = {
    format: "finance-tracker-portable-backup",
    version: 1,
    exportedAt,
    databaseId: manifest.databaseId,
    sourceCopyId: manifest.copyId,
    revision: manifest.revision,
    commitId: manifest.commitId,
    manifest,
    commitRecord,
    objects: archivedObjects
  };
  archive.archiveSha256 = await sha256(new TextEncoder().encode(canonicalizeJcs(archive)), cryptoImpl);
  return archive;
}

export async function verifyPortableBackup(archive, { cryptoImpl = globalThis.crypto, validateStructure = async () => true } = {}) {
  if (!archive || archive.format !== "finance-tracker-portable-backup" || archive.version !== 1) {
    fail("unsupported-archive", "The portable backup format or version is unsupported.");
  }
  const { archiveSha256, ...unsigned } = archive;
  const actualArchiveHash = await sha256(new TextEncoder().encode(canonicalizeJcs(unsigned)), cryptoImpl);
  if (actualArchiveHash !== archiveSha256) fail("archive-hash-mismatch", "The portable backup envelope failed integrity verification.");
  validateManifest(archive.manifest);
  validateCommit(archive.manifest, archive.commitRecord);
  if (archive.databaseId !== archive.manifest.databaseId || archive.sourceCopyId !== archive.manifest.copyId ||
      archive.revision !== archive.manifest.revision || archive.commitId !== archive.manifest.commitId) {
    fail("archive-identity-mismatch", "The portable backup envelope does not match its embedded manifest.");
  }
  if (!Array.isArray(archive.objects)) fail("invalid-object-list", "The portable backup object list is invalid.");
  const expectedPaths = Object.keys(archive.commitRecord.snapshot).sort();
  const restoredObjects = {};
  for (const item of archive.objects) {
    if (!item || typeof item.logicalPath !== "string" || Object.hasOwn(restoredObjects, item.logicalPath)) {
      fail("invalid-logical-path", "The portable backup contains duplicate or invalid object paths.");
    }
    const bytes = fromBase64(item.contentBase64);
    const actualHash = await sha256(bytes, cryptoImpl);
    const reference = archive.commitRecord.snapshot[item.logicalPath];
    if (!reference || reference.sha256 !== item.sha256 || actualHash !== item.sha256) {
      fail("object-hash-mismatch", `Portable object verification failed for ${item.logicalPath}.`);
    }
    restoredObjects[item.logicalPath] = bytes;
  }
  if (expectedPaths.length !== Object.keys(restoredObjects).length || expectedPaths.some((path) => !Object.hasOwn(restoredObjects, path))) {
    fail("snapshot-object-set-mismatch", "The archive is missing or adds objects outside the committed snapshot.");
  }
  const structuralResult = await validateStructure({ manifest: archive.manifest, commitRecord: archive.commitRecord, objects: restoredObjects });
  if (structuralResult !== true) fail("structural-validation-failed", "The portable backup failed structural validation.");
  return {
    valid: true,
    databaseId: archive.databaseId,
    sourceCopyId: archive.sourceCopyId,
    revision: archive.revision,
    commitId: archive.commitId,
    objectCount: Object.keys(restoredObjects).length,
    objects: restoredObjects
  };
}

/** A restore plan is deliberately inert: persistence requires a separate, explicit adapter operation. */
export async function planPortableRestore(archive, { newCopyId, newStorageBinding, now = new Date().toISOString(), cryptoImpl = globalThis.crypto, validateStructure } = {}) {
  if (typeof newCopyId !== "string" || !newCopyId.trim() || newCopyId === archive?.sourceCopyId) {
    fail("invalid-restore-copy-id", "Restore requires a new physical copy ID distinct from the source backup.");
  }
  if (typeof newStorageBinding !== "string" || !newStorageBinding.trim()) fail("invalid-storage-binding", "Restore requires an explicit destination storage binding.");
  const verified = await verifyPortableBackup(archive, { cryptoImpl, validateStructure });
  const manifest = {
    ...archive.manifest,
    copyId: newCopyId,
    role: "primary",
    lifecycleStatus: "active",
    storageBinding: newStorageBinding,
    restoredAt: now,
    restoredFromCopyId: archive.sourceCopyId
  };
  return { verified, manifest };
}


/**
 * Create a verified immutable snapshot in a separately prepared destination folder.
 * Adapters must be scoped to their respective folders. The manifest is written last;
 * failures are quarantined through the supplied callback and never clean up evidence.
 */
export async function createVerifiedSnapshotBackup({
  sourceAdapter, targetAdapter, sourceManifestFileId, newCopyId, newStorageBinding,
  transactionId = globalThis.crypto?.randomUUID?.(), now = new Date().toISOString(),
  validateStructure = async () => true, quarantine = async () => {}, cryptoImpl = globalThis.crypto
}) {
  if (!sourceAdapter || !targetAdapter || typeof sourceManifestFileId !== "string" ||
      typeof newCopyId !== "string" || !newCopyId.trim() || typeof newStorageBinding !== "string" ||
      !newStorageBinding.trim() || typeof transactionId !== "string" || !transactionId.trim()) {
    fail("invalid-backup-config", "Source and destination adapters, source manifest, new copy identity, storage binding, and transaction ID are required.");
  }
  let manifestWritten = false;
  try {
    const sourceManifest = await sourceAdapter.readJson(sourceManifestFileId);
    if (!sourceManifest || sourceManifest.role !== "primary" || sourceManifest.lifecycleStatus !== "active" ||
        !sourceManifest.databaseId || !sourceManifest.copyId || !sourceManifest.commitRecordFileId ||
        !/^[0-9a-f]{64}$/.test(String(sourceManifest.commitRecordHash || ""))) {
      fail("invalid-backup-source", "Backup requires an active primary with a verifiable committed manifest.");
    }
    if (newCopyId === sourceManifest.copyId) fail("invalid-backup-copy-id", "A backup must have a new physical copy ID.");
    const sourceCommit = await sourceAdapter.readJson(sourceManifest.commitRecordFileId);
    const sourceCommitText = canonicalizeJcs(sourceCommit);
    const sourceCommitHash = await sha256(new TextEncoder().encode(sourceCommitText), cryptoImpl);
    if (sourceCommitHash !== sourceManifest.commitRecordHash ||
        sourceCommit.databaseId !== sourceManifest.databaseId ||
        sourceCommit.commitId !== sourceManifest.commitId ||
        sourceCommit.revision !== sourceManifest.revision ||
        !sourceCommit.snapshot || typeof sourceCommit.snapshot !== "object" || Array.isArray(sourceCommit.snapshot)) {
      fail("source-commit-invalid", "The primary commit record does not match its manifest or hash.");
    }

    const copiedSnapshot = {};
    for (const logicalPath of Object.keys(sourceCommit.snapshot).sort()) {
      const reference = sourceCommit.snapshot[logicalPath];
      if (!reference?.fileId || !/^[0-9a-f]{64}$/.test(String(reference.sha256 || ""))) {
        fail("invalid-snapshot-reference", `The primary snapshot reference is invalid for ${logicalPath}.`);
      }
      const bytes = toBytes(await sourceAdapter.readBytes(reference.fileId));
      if (await sha256(bytes, cryptoImpl) !== reference.sha256) {
        fail("source-object-hash-mismatch", `The primary snapshot object failed verification for ${logicalPath}.`);
      }
      const fileId = await targetAdapter.allocateFileId();
      await targetAdapter.createImmutable({
        fileId, name: `ft-object-${reference.sha256}.bin`, kind: "snapshot-object",
        transactionId, content: bytes, expectedSha256: reference.sha256
      });
      const readBack = toBytes(await targetAdapter.readBytes(fileId));
      if (await sha256(readBack, cryptoImpl) !== reference.sha256) {
        fail("backup-object-readback-failed", `The backup object failed read-back verification for ${logicalPath}.`);
      }
      copiedSnapshot[logicalPath] = { fileId, sha256: reference.sha256 };
    }

    // Ensure the source remained on the exact committed state while its objects were copied.
    const sourceManifestAfter = await sourceAdapter.readJson(sourceManifestFileId);
    if (canonicalizeJcs(sourceManifestAfter) !== canonicalizeJcs(sourceManifest)) {
      fail("source-changed-during-backup", "The primary manifest changed during backup; the partial copy is not a valid snapshot.");
    }

    const backupCommit = {
      ...sourceCommit,
      snapshot: copiedSnapshot
    };
    const backupCommitText = canonicalizeJcs(backupCommit);
    const backupCommitHash = await sha256(new TextEncoder().encode(backupCommitText), cryptoImpl);
    const backupCommitFileId = await targetAdapter.allocateFileId();
    await targetAdapter.createImmutable({
      fileId: backupCommitFileId, name: `ft-commit-${sourceManifest.commitId}.json`,
      kind: "commit-record", transactionId, content: backupCommitText, expectedSha256: backupCommitHash
    });
    const backupCommitReadBack = await targetAdapter.readJson(backupCommitFileId);
    if (canonicalizeJcs(backupCommitReadBack) !== backupCommitText) {
      fail("backup-commit-readback-failed", "The backup commit record did not read back exactly.");
    }

    const backupManifest = {
      ...sourceManifest,
      copyId: newCopyId,
      role: "backup",
      lifecycleStatus: "active",
      storageBinding: newStorageBinding,
      copyCreatedAt: now,
      commitRecordFileId: backupCommitFileId,
      commitRecordHash: backupCommitHash
    };
    const structuralResult = await validateStructure({
      manifest: backupManifest, commitRecord: backupCommitReadBack,
      readObject: async (logicalPath) => {
        const reference = copiedSnapshot[logicalPath];
        return reference ? targetAdapter.readBytes(reference.fileId) : null;
      }
    });
    if (structuralResult !== true) fail("backup-structure-invalid", "The copied snapshot failed structural validation.");

    const manifestFileId = await targetAdapter.allocateFileId();
    const manifestText = canonicalizeJcs(backupManifest);
    const manifestHash = await sha256(new TextEncoder().encode(manifestText), cryptoImpl);
    await targetAdapter.createImmutable({
      fileId: manifestFileId, name: "finance-tracker-manifest.json",
      kind: "database-manifest", transactionId, content: manifestText, expectedSha256: manifestHash
    });
    manifestWritten = true;
    if (canonicalizeJcs(await targetAdapter.readJson(manifestFileId)) !== manifestText) {
      fail("backup-manifest-readback-failed", "The backup manifest did not read back exactly.");
    }
    return {
      verified: true, databaseId: sourceManifest.databaseId, sourceCopyId: sourceManifest.copyId,
      backupCopyId: newCopyId, revision: sourceManifest.revision, commitId: sourceManifest.commitId,
      manifestFileId, objectCount: Object.keys(copiedSnapshot).length, commitRecordFileId: backupCommitFileId
    };
  } catch (error) {
    let quarantined = false;
    try {
      await quarantine({ errorCode: error.code || "unknown", manifestWritten, transactionId, newCopyId });
      quarantined = true;
    } catch { /* retain the original failure; the destination remains unusable */ }
    throw new PortableBackupError(
      "backup-quarantined",
      `Backup did not complete and must not be used. Original cause: ${error.code || error.name || "unknown"}. Quarantine recorded: ${quarantined}.`
    );
  }
}
