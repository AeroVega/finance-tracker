import { inspectPr25Folder } from "../js/dashboard-synthetic-storage.mjs";
import { GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";
import { createDriveSessionAdapter } from "../js/drive-session-adapter.mjs";
import { chooseSyntheticFolder } from "../js/synthetic-folder-picker.mjs";
import { backupCatalogCopy, exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from "../js/catalog-backup.mjs";
import { validateSyntheticApplicationSnapshot } from "../js/synthetic-application-structure.mjs";
import { CANONICAL_INDEX } from "../js/canonical-ledger-storage.mjs";
import { canonicalizeJcs } from "../js/transaction-protocol.mjs";
import { storageError } from "../js/catalog-storage.mjs";

const validateStructure = validateSyntheticApplicationSnapshot;
const fail = code => { throw storageError(code, code); };

// Physical copy identities and locators differ. Every logical object, its
// metadata and exact bytes must match the selected source, including corrections.
export function logicalArchiveGraph(archive) {
  const keys = ["databaseId", "schemaVersion", "revision", "commitId", "parentCommitId", "commitRecordHash", "snapshot"];
  return canonicalizeJcs({ manifest: Object.fromEntries(keys.map(key => [key, archive.manifest[key]])),
    objects: [...archive.objects].sort((a, b) => (a.kind + ":" + a.identity).localeCompare(b.kind + ":" + b.identity)) });
}

export function authorizeCopyGuide(storage) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({ client_id: storage.config.clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: response => {
        if (response?.error || !response?.access_token) return reject(storageError("authorization-required", "authorization-required"));
        storage.accessToken = response.access_token;
        const seconds = Number(response.expires_in);
        storage.tokenExpiresAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
        resolve();
      }, error_callback: () => reject(storageError("authorization-cancelled", "authorization-cancelled")) });
    client.requestAccessToken();
  });
}

// Composition of the existing catalog and session APIs. No initialization,
// ledger writes, retention changes, saved folder IDs or new recovery protocol.
export function createCopyGuideDriver({ storage, authorize = () => authorizeCopyGuide(storage),
  pick = title => chooseSyntheticFolder({ config: storage.config, token: () => storage.token(), title }),
  makeAdapter = folder => new GoogleDriveTransactionAdapter({ folderId: folder.id, accessToken: () => storage.token() }),
  makeCoordinator = folder => new SessionCoordinator({ adapter: createDriveSessionAdapter({ folderId: folder.id, accessToken: () => storage.token() }) }),
  download = archive => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "finance-tracker-synthetic-backup.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
} = {}) {
  let source = null, baseline = null, exported = null, localArchive = null, interrupted = false;
  const sessions = new Set(), used = new Set();
  const active = () => { if (interrupted) fail("page-interrupted"); };
  const guard = session => { active(); return session.coordinator.assertCanWrite({ online: globalThis.navigator?.onLine !== false }); };
  const sessionFor = folder => {
    const session = { folder, adapter: makeAdapter(folder), coordinator: makeCoordinator(folder), stop: null };
    sessions.add(session); return session;
  };
  const start = async session => {
    active(); await session.coordinator.start(); session.stop = session.coordinator.startHeartbeat();
    // pagehide may happen while the claim is awaiting read-back. Do not leave
    // a late successful source claim alive behind a permanently stopped UI.
    if (interrupted) await release(session);
    active();
  };
  const releaseOnce = async (session, progress) => {
    progress?.setPhase(session === source ? "releasing-source" : "releasing-destination");
    if (session.coordinator.session === null && !session.coordinator.canWrite) { sessions.delete(session); return; }
    let released;
    try { released = await session.coordinator.release(); } catch { fail("release-unconfirmed"); }
    if (released?.released !== true) fail("release-unconfirmed");
    session.stop?.(); sessions.delete(session);
  };
  const release = (session, progress) => {
    if (!session.releasePromise) session.releasePromise = releaseOnce(session, progress).finally(() => { session.releasePromise = null; });
    return session.releasePromise;
  };
  const useAndRelease = async (session, operation, progress) => {
    let output, failure;
    try { output = await operation(); } catch (error) { failure = error; }
    try { await release(session, progress); }
    catch (error) { if (failure) throw Object.assign(storageError("operation-and-release-unconfirmed", "operation-and-release-unconfirmed"), { cause: failure }); throw error; }
    if (failure) throw failure;
    return output;
  };
  const targetOptions = session => ({ targetAdapter: session.adapter,
    withTargetLock: work => session.coordinator.withWrite(work), assertTargetWritable: () => guard(session) });
  const archiveFrom = (session, manifestFileId, progress) => exportCatalogArchive({ adapter: session.adapter, manifestFileId,
    withSourceLock: work => session.coordinator.withWrite(async () => { await guard(session); return work(); }),
    validateStructure, onProgress: event => progress?.onProgress({ ...event,
      phase: session !== source && event.phase === "source-verification" ? "destination-verification" : event.phase }) });
  const match = archive => { if (!baseline || archive.originalImports.length || logicalArchiveGraph(archive) !== logicalArchiveGraph(baseline)) fail("source-graph-mismatch"); };
  const verifySource = async progress => {
    const archive = await archiveFrom(source, source.manifestFileId, progress);
    if (!archive.manifest.snapshot[CANONICAL_INDEX] || archive.manifest.revision < 1) fail("canonical-source-required");
    if (archive.originalImports.length) fail("retained-originals-unsupported");
    const verified = await verifyCatalogArchive(archive, { validateStructure, onProgress: progress?.onProgress });
    const index = JSON.parse(new TextDecoder().decode(verified.objects.get("data-object:" + archive.manifest.snapshot[CANONICAL_INDEX])));
    baseline = archive;
    return { revision: archive.manifest.revision, objects: archive.objects.length,
      counts: Object.fromEntries(["accounts", "imports", "activities", "events"].map(name => [name, index.collections[name].length])) };
  };
  const checkSource = async () => {
    if (!source || !baseline || !sessions.has(source)) fail("source-not-connected");
    await source.coordinator.withWrite(async () => {
      await guard(source);
      if (canonicalizeJcs(await source.adapter.readJson(source.manifestFileId)) !== source.manifestText) fail("source-changed");
    });
  };
  async function independentReopen(folder, copied, progress) {
    active(); progress?.setPhase("final-verification");
    const reopened = sessionFor(folder);
    await useAndRelease(reopened, async () => {
      await start(reopened);
      const inspected = await inspectPr25Folder(reopened.adapter);
      if (inspected.manifestFileId !== copied.manifestFileId || inspected.manifest?.copyId !== copied.manifest.copyId ||
          inspected.manifest.copyId === baseline.sourceCopyId || canonicalizeJcs(inspected.manifest) !== canonicalizeJcs(copied.manifest)) fail("copy-identity-mismatch");
      const archive = await archiveFrom(reopened, inspected.manifestFileId, progress);
      match(archive);
    }, progress);
    active();
  }
  async function copy(kind, progress, observe = () => {}) {
    active();
    if (kind === "backup") await checkSource();
    else if (!localArchive || !exported || localArchive.archiveSha256 !== exported.archiveSha256) fail("local-archive-required");
    progress?.setPhase("choosing-destination");
    const folder = await pick(kind === "backup" ? "BACKUP: choose a new empty synthetic folder, not your source" : "RESTORED COPY: choose another new empty synthetic folder");
    active();
    if (folder.id === source?.folder.id || used.has(folder.id)) fail("fresh-destination-required");
    // Read before creating a session marker. The core repeats this preflight
    // under its destination gate before writing any copy objects.
    if ((await makeAdapter(folder).listChildren()).length) fail("fresh-destination-required");
    used.add(folder.id);
    progress?.setPhase("opening-destination");
    const target = sessionFor(folder);
    const copied = await useAndRelease(target, async () => {
      await start(target);
      if (kind === "backup") return backupCatalogCopy({ sourceAdapter: source.adapter,
        sourceManifestFileId: source.manifestFileId, withSourceLock: work => source.coordinator.withWrite(work),
        assertSourceWritable: () => guard(source), ...targetOptions(target), validateStructure, onProgress: progress?.onProgress });
      return restoreCatalogArchive({ archive: localArchive, ...targetOptions(target), validateStructure, onProgress: progress?.onProgress });
    }, progress);
    active(); observe("copied");
    await independentReopen(folder, copied, progress);
    return { objects: copied.objectCount, revision: copied.manifest.revision };
  }
  return Object.freeze({
    hasSessions: () => sessions.size > 0,
    async chooseSource(progress) {
      active();
      if (sessions.size) fail("release-required");
      baseline = exported = localArchive = null; source = null;
      // Invoke OAuth before an await so Safari retains the user's activation.
      await authorize(); active(); progress?.setPhase("choosing-source");
      const folder = await pick("SOURCE: choose your completed PR28 synthetic folder, not an empty destination");
      active();
      if (used.has(folder.id)) fail("original-source-required");
      const inspected = await inspectPr25Folder(makeAdapter(folder));
      if (!inspected.manifestFileId || !inspected.manifest?.snapshot?.[CANONICAL_INDEX] || inspected.manifest.role !== "primary") fail("canonical-source-required");
      source = sessionFor(folder); source.manifestFileId = inspected.manifestFileId;
      source.manifestText = canonicalizeJcs(inspected.manifest);
      await start(source);
      return verifySource(progress);
    },
    async recoverSource(progress) {
      active(); if (!source || baseline) fail("source-not-connected");
      await authorize(); active();
      await source.coordinator.recoverStale({ confirm: true });
      source.stop = source.coordinator.startHeartbeat();
      if (interrupted) await release(source, progress);
      active();
      return verifySource(progress);
    },
    backup: (progress, observe) => copy("backup", progress, observe),
    async exportArchive(progress) {
      active(); localArchive = null;
      if (!exported) {
        await checkSource();
        const archive = await archiveFrom(source, source.manifestFileId, progress); match(archive);
        await verifyCatalogArchive(archive, { validateStructure, onProgress: progress?.onProgress });
        exported = archive;
      }
      // A failed release blocks the step and the local-file/restore actions.
      if (sessions.has(source)) await release(source, progress);
      active(); download(exported);
    },
    clearLocalArchive() { localArchive = null; },
    async loadArchive(file, progress) {
      active(); localArchive = null;
      if (!exported || sessions.has(source)) fail("export-required");
      if (!file) fail("selection-cancelled");
      progress?.setPhase("loading-archive");
      let archive;
      try { archive = JSON.parse(await file.text()); } catch { fail("archive-rejected"); }
      await verifyCatalogArchive(archive, { validateStructure, onProgress: progress?.onProgress });
      active(); match(archive);
      if (archive.archiveSha256 !== exported.archiveSha256) fail("different-export-selected");
      localArchive = archive;
    },
    restore: (progress, observe) => copy("restore", progress, observe),
    async releaseAll(progress, { recoverStale = false } = {}) {
      // Provider revocation may leave an unexpired token in this tab. Always
      // invoke explicit OAuth here while the Release button activation is live.
      await authorize();
      for (const session of sessions) {
        if (session.coordinator.session) {
          try { await session.coordinator.resume(); }
          catch (error) {
            if (error.code === "session-released") { session.stop?.(); sessions.delete(session); continue; }
            if (error.code !== "stale-session") throw error;
            if (!recoverStale) fail("release-stale-session");
            const current = await session.coordinator.inspect();
            if (current.status !== "stale" || current.record.sessionId !== session.coordinator.session.sessionId) fail("ownership-lost");
            await session.coordinator.recoverStale({ confirm: true });
          }
        }
        await release(session, progress);
      }
    },
    async interrupt() {
      interrupted = true;
      for (const session of sessions) {
        if (session.coordinator.canWrite) await release(session);
      }
    }
  });
}
