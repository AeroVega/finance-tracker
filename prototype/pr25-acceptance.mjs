import { DashboardSyntheticStorage } from "../js/dashboard-synthetic-storage.mjs";
import { validateSyntheticApplicationSnapshot } from "../js/synthetic-application-structure.mjs";
import { GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";
import { createDriveSessionAdapter } from "../js/drive-session-adapter.mjs";
import { verifyCatalogHistory, storageError } from "../js/catalog-storage.mjs";
import { backupCatalogCopy, exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from "../js/catalog-backup.mjs";
import { chooseSyntheticFolder } from "../js/synthetic-folder-picker.mjs";
import { ORIGINAL_RETENTION_MS } from "../js/original-retention-policy.mjs";
import { startCopyProgress } from "./pr25-copy-progress.mjs";

import { inspectPagedCanonicalCopy } from "../js/paged-application-storage.mjs";
import { canonicalPartitionVerificationPlans } from "../js/canonical-paged-storage.mjs";
import { backupPagedCanonicalCopy, exportPagedCanonicalArchive, restorePagedCanonicalArchive, migrateLegacyCanonicalCopy, verifyCanonicalMigrationEvidence } from "../js/paged-canonical-backup.mjs";
import { authorizeCopyGuide } from "./pr25-copy-guide-driver.mjs";

import { createCopyGuideDriver } from "./pr25-copy-guide-driver.mjs";
import { mountCopyGuide } from "./pr25-copy-guide.mjs";

if (globalThis.location?.search?.split(/[?&]/).includes("guide=v4")) {
  mountV4CopyTools();
} else if (globalThis.location?.search?.split(/[?&]/).includes("guide=pr28")) {
  document.getElementById("legacy-tools").hidden = true;
  document.getElementById("copy-guide").hidden = false;
  document.title = "PR28 guided backup and restore · Finance Tracker";
  const guideStorage = new DashboardSyntheticStorage();
  const guide = mountCopyGuide({ document, window, driver: createCopyGuideDriver({ storage: guideStorage }) });
  guideStorage.prepare().then(() => guide.ready()).catch(() => guide.unavailable());
} else {
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

async function folderSession(folder, operation, progress) {
  if (folder.id === storage.folderId) throw storageError("same-copy-folder", "Choose a folder distinct from the connected primary.");
  progress?.setPhase("opening-destination");
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
    if (coordinator.canWrite) { progress?.setPhase("releasing-destination"); await coordinator.release(); }
    stop?.();
    ownedDestinations.delete(coordinator);
  }
}

async function runAction(status, operation) {
  if (busy) return;
  busy = true; refresh();
  const progress = status === "copy-result" ? startCopyProgress({ region: $("copy-progress"),
    phase: $("copy-phase"), count: $("copy-count"), elapsed: $("copy-elapsed") }) : undefined;
  if (progress) result(status, "Working. Completion has not been verified.", "pending");
  let succeeded = false;
  try { succeeded = (await operation(progress)) !== false; }
  catch (error) {
    // Stable codes only; provider bodies and private folder/file IDs stay out
    // of page diagnostics, downloads and public acceptance evidence.
    result(status, "Action did not complete: " + (error.code || "unexpected-error") + ". Reconnect or inspect the preserved synthetic evidence before retrying.", "error");
  } finally { progress?.finish(succeeded); busy = false; refresh(); }
}
function action(id, status, operation) {
  $(id).addEventListener("click", () => runAction(status, operation));
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
action("backup", "copy-result", async (progress) => {
  progress.setPhase("choosing-destination");
  const folder = await pick("Choose a fresh synthetic backup destination");
  const copied = await folderSession(folder, (target) => backupCatalogCopy({ ...sourceOptions(), ...target, onProgress: progress.onProgress }), progress);
  result("copy-result", "PASS: separate Drive backup created, reopened, and verified. " + copied.objectCount + " immutable objects; logical commit history preserved.");
});
action("quarantine", "copy-result", async (progress) => {
  progress.setPhase("choosing-destination");
  const folder = await pick("Choose a fresh disposable synthetic quarantine destination");
  const source = sourceOptions();
  const archive = await exportCatalogArchive({ adapter: source.sourceAdapter, manifestFileId: source.sourceManifestFileId,
    withSourceLock: source.withSourceLock, validateStructure, onProgress: progress.onProgress });
  let observed = false;
  await folderSession(folder, async (target) => {
    try { await restoreCatalogArchive({ archive, ...target, validateStructure, onProgress: progress.onProgress,
      beforePublish: async () => { throw storageError("intentional-synthetic-failure", "Intentional quarantine rehearsal"); } }); }
    catch (error) {
      if (error.code !== "copy-quarantined" || !error.quarantineConfirmed) throw error;
      const candidates = (await target.targetAdapter.listChildren()).filter((file) => file.appProperties?.financeTrackerKind === "copy-preparation");
      observed = candidates.length === 1 && (await target.targetAdapter.readJson(candidates[0].id)).state === "quarantined";
    }
  }, progress);
  if (!observed) throw storageError("quarantine-unverified", "Quarantine was not verified.");
  result("copy-result", "PASS: intentional copy failure left a durable quarantine marker and no usable destination manifest. Retry requires a fresh destination.");
});
action("export", "copy-result", async (progress) => {
  const source = sourceOptions();
  loadedArchive = await exportCatalogArchive({ adapter: source.sourceAdapter, manifestFileId: source.sourceManifestFileId,
    withSourceLock: source.withSourceLock, validateStructure, onProgress: progress.onProgress });
  await verifyCatalogArchive(loadedArchive, { validateStructure, onProgress: progress.onProgress });
  const url = URL.createObjectURL(new Blob([JSON.stringify(loadedArchive)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "finance-tracker-synthetic-backup.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  result("copy-result", "PASS: portable archive verified and downloaded. Move it outside Drive and reopen it here for independent verification. Keep it private; it includes synthetic recovery locators.");
});
$("archive").addEventListener("change", async () => {
  if (busy) return;
  loadedArchive = null;
  const file = $("archive").files[0];
  if (!file) { result("copy-result", "No archive selected.", "pending"); $("copy-progress").hidden = true; refresh(); return; }
  await runAction("copy-result", async (progress) => {
    progress.setPhase("loading-archive");
    try {
      const archive = JSON.parse(await file.text());
      await verifyCatalogArchive(archive, { validateStructure, onProgress: progress.onProgress });
      loadedArchive = archive;
      result("copy-result", "PASS: local archive independently verified.");
    } catch {
      // Retain the existing fixed rejection text, without JSON/parser details.
      result("copy-result", "Archive rejected. Use a verified version-2 synthetic application archive.", "error");
      return false;
    }
  });
});
action("verify-archive", "copy-result", async (progress) => { await verifyCatalogArchive(loadedArchive, { validateStructure, onProgress: progress.onProgress }); result("copy-result", "PASS: loaded archive integrity, history, and application structure verified."); });
action("restore", "copy-result", async (progress) => {
  progress.setPhase("choosing-destination");
  const folder = await pick("Choose a fresh synthetic restore destination");
  const restored = await folderSession(folder, (target) => restoreCatalogArchive({ archive: loadedArchive, ...target, validateStructure, onProgress: progress.onProgress }), progress);
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

}


function mountV4CopyTools() {
  const $=id=>document.getElementById(id);
  $("legacy-tools").hidden=true;$("v4-copy-tools").hidden=false;
  let busy=false,configured=false;
  const storage=new DashboardSyntheticStorage({onStatus:status=>{$("v4-result").textContent=status.message;refresh();}});
  const plans=()=>canonicalPartitionVerificationPlans({verifyMigrationEvidence:verifyCanonicalMigrationEvidence});
  const say=text=>{$("v4-result").textContent=text;};
  function refresh(){
    const ready=storage.lifecycle?.state==='ready'&&storage.lifecycle.acceptingWrites,paged=storage.lifecycle?.pagedCanonical;
    $("v4-connect").disabled=busy||!configured||ready;
    $("v4-release").disabled=busy||!storage.lifecycle?.coordinator?.canWrite;
    for(const name of ['backup','export']) $("v4-"+name).disabled=busy||!ready||!paged;
    $("v4-migrate").disabled=busy||!ready||paged;
    $("v4-restore").disabled=busy||!configured||!$("v4-archive").files[0];
    $("v4-restore-backup").disabled=busy||!configured;
    $("v4-archive").disabled=busy;
  }
  const source=()=>({sourceAdapter:storage.lifecycle.transactionAdapter,sourceManifestFileId:storage.lifecycle.manifestFileId,
    withSourceLock:fn=>storage.lifecycle.coordinator.withWrite(fn),assertSourceWritable:async()=>{await storage.lifecycle.coordinator.assertCanWrite({online:navigator.onLine!==false});},verificationPlans:plans()});
  async function destination(operation){
    try{storage.token();}catch{await authorizeCopyGuide(storage);}
    const folder=await chooseSyntheticFolder({config:storage.config,token:()=>storage.token(),title:'Choose a new empty synthetic destination'});
    if(folder.id===storage.folderId) throw storageError('same-copy-folder','Select a different folder.');
    const coordinator=new SessionCoordinator({adapter:createDriveSessionAdapter({folderId:folder.id,accessToken:()=>storage.token()})});
    let stop;
    try{
      await coordinator.start();stop=coordinator.startHeartbeat();
      return await operation({targetAdapter:new GoogleDriveTransactionAdapter({folderId:folder.id,accessToken:()=>storage.token()}),
        withTargetLock:fn=>coordinator.withWrite(fn),assertTargetWritable:async()=>{await coordinator.assertCanWrite({online:navigator.onLine!==false});},verificationPlans:plans()});
    }finally{if(coordinator.canWrite)await coordinator.release();stop?.();}
  }
  function action(id,work){$(id).addEventListener('click',async()=>{
    if(busy)return;busy=true;refresh();say('Working. Keep this page open until verification finishes.');
    try{await work();}catch(error){
      if(error.code==='unsupported-derived-projection') say('This legacy copy has a linked refund whose original activity has no category. Keep the source, add and save an explicit category correction to that original activity, then retry migration to a fresh folder. No source evidence was changed.');
      else if(['external-original-retention-not-supported','retained-original-migration-not-supported'].includes(error.code)) say('This copy has separate original-retention metadata or files. V4 backup/migration cannot preserve their deletion schedule yet. Keep the source unchanged and use the legacy archive2 backup tools where applicable; no originals were deleted.');
      else say('Not completed: '+(error.code||'unexpected-error')+'. Preserve any interrupted destination and choose a new empty folder.');
    }
    finally{busy=false;refresh();}
  });}
  action('v4-connect',async()=>{await storage.connect({requireExisting:true});if(storage.lifecycle?.state!=='ready'||!storage.lifecycle.acceptingWrites){say('Source is not verified and ready. Release this session when available, then use workspace recovery for the same folder before copying.');return;}say(storage.lifecycle.pagedCanonical?'Verified paged canonical source connected.':'Verified legacy source connected. Migration is explicit and creates a new copy.');});
  action('v4-release',async()=>{await storage.release();say('Source released. File restore can still run without reading the source.');});
  action('v4-backup',async()=>{const result=await destination(target=>backupPagedCanonicalCopy({...source(),...target}));say('Verified paged backup created with separate physical locators. '+result.objectCount+' immutable objects.');});
  action('v4-export',async()=>{
    if(typeof window.showSaveFilePicker==='function'){
      const handle=await window.showSaveFilePicker({suggestedName:'finance-tracker-synthetic-paged.ftbs'});
      await exportPagedCanonicalArchive({...source(),sink:await handle.createWritable()});
      say('Framed archive written and closed. Select the saved file to test an independent restore.');
    }else{
      const chunks=[];await exportPagedCanonicalArchive({...source(),sink:{write:async chunk=>chunks.push(chunk)}});
      const url=URL.createObjectURL(new Blob(chunks,{type:'application/octet-stream'}));
      const link=document.createElement('a');link.href=url;link.download='finance-tracker-synthetic-paged.ftbs';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      say('Download requested using the memory-buffered browser fallback. Saving is not confirmed; select the actual saved file to restore.');
    }
  });
  action('v4-migrate',async()=>{
    if(!confirm('Create a new v5 copy while preserving the original and complete legacy history evidence? The legacy source must contain only invented data.'))return;
    await destination(target=>migrateLegacyCanonicalCopy({...source(),...target}));
    say('Fresh v5 migration independently verified, including exact latest ledger and complete retained legacy history. Original source unchanged.');
  });
  action('v4-restore-backup',async()=>{
    try{storage.token();}catch{await authorizeCopyGuide(storage);}
    const folder=await chooseSyntheticFolder({config:storage.config,token:()=>storage.token(),title:'Choose the existing read-only synthetic backup'});
    if(folder.id===storage.folderId&&storage.lifecycle?.state==='ready') throw storageError('source-already-connected','Release the connected source first.');
    const adapter=new GoogleDriveTransactionAdapter({folderId:folder.id,accessToken:()=>storage.token()});
    const selected=await inspectPagedCanonicalCopy(adapter);
    if(!selected||selected.manifest.role!=='backup') throw storageError('backup-copy-required','Select a completed paged backup.');
    const coordinator=new SessionCoordinator({adapter:createDriveSessionAdapter({folderId:folder.id,accessToken:()=>storage.token()})});let stop;
    try{
      await coordinator.start();stop=coordinator.startHeartbeat();
      await destination(target=>backupPagedCanonicalCopy({...target,sourceAdapter:adapter,sourceManifestFileId:selected.manifestFileId,
        withSourceLock:fn=>coordinator.withWrite(fn),assertSourceWritable:async()=>{await coordinator.assertCanWrite({online:navigator.onLine!==false});},role:'primary'}));
      say('Read-only backup restored to a separately verified primary copy. Neither the backup nor original source was changed.');
    }finally{if(coordinator.canWrite)await coordinator.release();stop?.();}
  });
  action('v4-restore',async()=>{const file=$("v4-archive").files[0];await destination(target=>restorePagedCanonicalArchive({...target,source:file.stream()}));say('Saved framed file independently restored and verified. No source bytes were read.');});
  $("v4-archive").addEventListener('change',refresh);
  storage.prepare().then(()=>{configured=true;say('Ready. Choose an existing source or a saved framed file.');refresh();}).catch(()=>say('Google setup unavailable. No storage operation started.'));
}
