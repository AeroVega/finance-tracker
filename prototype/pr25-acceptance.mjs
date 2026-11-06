import { DashboardSyntheticStorage } from "../js/dashboard-synthetic-storage.mjs";
import { validateSyntheticApplicationSnapshot } from "../js/synthetic-application-structure.mjs";
import { GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";
import { createDriveSessionAdapter } from "../js/drive-session-adapter.mjs";
import { verifyCatalogHistory, storageError } from "../js/catalog-storage.mjs";
import { backupCatalogCopy, exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from "../js/catalog-backup.mjs";
import { chooseSyntheticFolder } from "../js/synthetic-folder-picker.mjs";
import { ORIGINAL_RETENTION_MS } from "../js/original-retention-policy.mjs";

const $ = (id) => document.getElementById(id);
let busy = false;
let configured = false;
let loadedArchive = null;
let stopBoundary = 0;
let boundary = 0;
let retainedAt = null;
const ownedDestinations = new Set();
const readyActions = ["save", "verify-source", "backup", "quarantine", "export", "restore", "retain", "before-expiry", "expiry", "pause-save", "expire"];
function result(id, message, kind = "pass") { $(id).textContent = message; $(id).dataset.result = kind; }
function refresh() {
  const lifecycle = storage.lifecycle;
  const ready = lifecycle?.state === "ready" && lifecycle.acceptingWrites;
  for (const id of readyActions) $(id).disabled = busy || !ready || (id === "restore" && !loadedArchive) || (["before-expiry", "expiry"].includes(id) && !retainedAt);
  $("connect").disabled = busy || !configured;
  $("release").disabled = busy || !lifecycle?.coordinator?.canWrite;
  $("stale").disabled = busy || lifecycle?.state !== "stale-session";
  $("recover").disabled = busy || lifecycle?.state !== "recovery-required" || !lifecycle?.coordinator?.canWrite;
  $("verify-archive").disabled = busy || !loadedArchive;
  $("archive").disabled = busy;
}
const storage = new DashboardSyntheticStorage({
  onStatus: (status) => { result("connection", status.message, status.kind === "error" ? "error" : "pass"); refresh(); },
  afterMutation: async ({ kind }) => {
    if (!stopBoundary) return;
    boundary += 1;
    result("fault-result", "Durable write " + boundary + ": " + kind + ".");
    if (boundary === stopBoundary) {
      result("fault-result", "PAUSED after durable write " + boundary + ". Fully close this tab now. Reopen and reconnect to the same source folder, explicitly recover its stale session, then verify all retained history.");
      // Deliberately never resolves: no next transaction write may begin.
      await new Promise(() => {});
    }
  }
});

const validateStructure = validateSyntheticApplicationSnapshot;
function sourceOptions() {
  const lifecycle = storage.lifecycle;
  return { sourceAdapter: lifecycle.transactionAdapter, sourceManifestFileId: lifecycle.manifestFileId,
    withSourceLock: (operation) => lifecycle.coordinator.withWrite(operation),
    assertSourceWritable: () => lifecycle.coordinator.assertCanWrite({ online: navigator.onLine !== false }), validateStructure };
}
function pick(title) { return chooseSyntheticFolder({ config: storage.config, token: () => storage.token(), title }); }

async function folderSession(folder, operation) {
  if (folder.id === storage.folderId) throw storageError("same-copy-folder", "Choose a folder distinct from the connected primary.");
  const coordinator = new SessionCoordinator({ adapter: createDriveSessionAdapter({ folderId: folder.id, accessToken: () => storage.token() }) });
  let stop;
  try {
    await coordinator.start();
    ownedDestinations.add(coordinator);
    stop = coordinator.startHeartbeat();
    const adapter = new GoogleDriveTransactionAdapter({ folderId: folder.id, accessToken: () => storage.token() });
    return await operation({ targetAdapter: adapter, withTargetLock: (work) => coordinator.withWrite(work),
      assertTargetWritable: () => coordinator.assertCanWrite({ online: navigator.onLine !== false }) });
  } finally {
    if (coordinator.canWrite) await coordinator.release();
    stop?.();
    ownedDestinations.delete(coordinator);
  }
}

function action(id, status, operation) {
  $(id).addEventListener("click", async () => {
    if (busy) return;
    busy = true; refresh();
    try { await operation(); }
    catch (error) {
      // Stable codes only; provider bodies and private folder/file IDs stay out
      // of page diagnostics, downloads and public acceptance evidence.
      result(status, "Action did not complete: " + (error.code || "unexpected-error") + ". Reconnect or inspect the preserved synthetic evidence before retrying.", "error");
    } finally { busy = false; refresh(); }
  });
}

action("connect", "connection", () => storage.connect());
action("stale", "connection", async () => { if (confirm("Confirm all previous tabs/devices using this synthetic folder are stopped.")) await storage.recoverStaleSession(); });
action("recover", "connection", () => storage.lifecycle.recover());
action("release", "connection", () => storage.release());
function inventedRows() { return [{ id: "invented-" + crypto.randomUUID(), date: "2026-11-03", description: "Invented acceptance fixture", amount: 1, syntheticOnly: true }]; }
action("save", "source-result", async () => { await storage.saveSyntheticSnapshot(inventedRows()); result("source-result", "PASS: invented snapshot committed and reopened through the catalog."); });
action("verify-source", "source-result", async () => {
  const options = sourceOptions();
  const verified = await options.withSourceLock(async () => verifyCatalogHistory(options.sourceAdapter, await options.sourceAdapter.readJson(options.sourceManifestFileId)));
  result("source-result", "PASS: all retained bytes and commit ancestry verified. Revision " + verified.record.revision + ".");
});
action("backup", "copy-result", async () => {
  const folder = await pick("Choose a fresh synthetic backup destination");
  const copied = await folderSession(folder, (target) => backupCatalogCopy({ ...sourceOptions(), ...target }));
  result("copy-result", "PASS: separate Drive backup created, reopened, and verified. " + copied.objectCount + " immutable objects; logical commit history preserved.");
});
action("quarantine", "copy-result", async () => {
  const folder = await pick("Choose a fresh disposable synthetic quarantine destination");
  const source = sourceOptions();
  const archive = await exportCatalogArchive({ adapter: source.sourceAdapter, manifestFileId: source.sourceManifestFileId,
    withSourceLock: source.withSourceLock, validateStructure });
  let observed = false;
  await folderSession(folder, async (target) => {
    try { await restoreCatalogArchive({ archive, ...target, validateStructure,
      beforePublish: async () => { throw storageError("intentional-synthetic-failure", "Intentional quarantine rehearsal"); } }); }
    catch (error) {
      if (error.code !== "copy-quarantined" || !error.quarantineConfirmed) throw error;
      const candidates = (await target.targetAdapter.listChildren()).filter((file) => file.appProperties?.financeTrackerKind === "copy-preparation");
      observed = candidates.length === 1 && (await target.targetAdapter.readJson(candidates[0].id)).state === "quarantined";
    }
  });
  if (!observed) throw storageError("quarantine-unverified", "Quarantine was not verified.");
  result("copy-result", "PASS: intentional copy failure left a durable quarantine marker and no usable destination manifest. Retry requires a fresh destination.");
});
action("export", "copy-result", async () => {
  const source = sourceOptions();
  loadedArchive = await exportCatalogArchive({ adapter: source.sourceAdapter, manifestFileId: source.sourceManifestFileId,
    withSourceLock: source.withSourceLock, validateStructure });
  await verifyCatalogArchive(loadedArchive, { validateStructure });
  const url = URL.createObjectURL(new Blob([JSON.stringify(loadedArchive)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "finance-tracker-synthetic-backup.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  result("copy-result", "PASS: portable archive verified and downloaded. Move it outside Drive and reopen it here for independent verification. Keep it private; it includes synthetic recovery locators.");
});
$("archive").addEventListener("change", async () => {
  loadedArchive = null; refresh();
  try { const file = $("archive").files[0]; if (file) { const archive = JSON.parse(await file.text()); await verifyCatalogArchive(archive, { validateStructure }); loadedArchive = archive; result("copy-result", "PASS: local archive independently verified."); } }
  catch { result("copy-result", "Archive rejected. Use a verified version-2 synthetic application archive.", "error"); }
  refresh();
});
action("verify-archive", "copy-result", async () => { await verifyCatalogArchive(loadedArchive, { validateStructure }); result("copy-result", "PASS: loaded archive integrity, history, and application structure verified."); });
action("restore", "copy-result", async () => {
  const folder = await pick("Choose a fresh synthetic restore destination");
  const restored = await folderSession(folder, (target) => restoreCatalogArchive({ archive: loadedArchive, ...target, validateStructure }));
  result("copy-result", "PASS: restored into a separate Drive folder with a new physical copy identity. Revision " + restored.manifest.revision + "; exact logical history verified.");
});
action("retain", "retention-result", async () => { const item = await storage.originals.retainFixture(); retainedAt = item.sourceFileRetainedAt; result("retention-result", "PASS: invented original uploaded, hash-verified, and linked to a completed synthetic import with its 540-day clock."); });
action("before-expiry", "retention-result", async () => {
  const outcomes = await storage.originals.process({ now: new Date(Date.parse(retainedAt) + ORIGINAL_RETENTION_MS - 1).toISOString() });
  if (outcomes.at(-1)?.outcome !== "not-eligible") throw storageError("retention-boundary-failed", "Fixture was eligible too early.");
  result("retention-result", "PASS: the latest fixture remains ineligible one millisecond before day 540.");
});
action("expiry", "retention-result", async () => {
  if (!confirm("Permanently delete only the expired invented source fixtures in this synthetic folder?")) return;
  const outcomes = await storage.originals.process({ now: new Date(Date.parse(retainedAt) + ORIGINAL_RETENTION_MS).toISOString() });
  if (outcomes.at(-1)?.outcome !== "deleted") throw storageError("deletion-not-confirmed", "Provider absence was not confirmed; locator preserved for inspection.");
  result("retention-result", "PASS: expired invented originals deleted and absence verified through Drive. Completed import status and original timing preserved.");
});
action("pause-save", "fault-result", async () => {
  const chosen = Number($("boundary").value);
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 14) throw storageError("invalid-boundary", "Choose boundary 1 through 14.");
  boundary = 0; stopBoundary = chosen;
  await storage.saveSyntheticSnapshot(inventedRows());
  stopBoundary = 0;
});
action("expire", "oauth-result", async () => {
  storage.tokenExpiresAt = 0;
  await storage.lifecycle.handleOnline();
  if (storage.lifecycle.state === "ready" || storage.lifecycle.acceptingWrites) throw storageError("expiry-not-blocked", "Authorization loss did not disable writes.");
  result("oauth-result", "PASS: simulated local expiry disabled writes. Reconnect Google to test interactive reauthorization. Live expiry/revocation and denied-permission tests are still required.");
});
window.addEventListener("pagehide", () => { for (const coordinator of ownedDestinations) void coordinator.release().catch(() => {}); });
storage.prepare().then(() => { configured = true; result("connection", "Google services ready. Connect to a dedicated synthetic primary."); refresh(); })
  .catch(() => { result("connection", "Google services or deployment configuration are unavailable. Use the documented branch deployment after CI and review; no Drive operations were attempted.", "error"); refresh(); });
refresh();
