import { copyGuideMessages as labels } from '../js/app-diagnostic-messages.mjs';
import { clearDiagnostic, showDiagnostic, createDiagnostic } from "../js/app-diagnostics.mjs";
import { startCopyProgress } from "./pr25-copy-progress.mjs";
import { createElapsedTimer, formatElapsed } from "./pr28-testing-timing.mjs";


// This is the page's actual event-handler controller, also exercised with
// controlled Drive/file boundaries by Node tests. It stores no report or data.
export function mountCopyGuide({ document, window, driver, progressFactory = startCopyProgress, now = () => globalThis.performance?.now?.() }) {
  const $ = id => document.getElementById(id);
  const write = (id, text, kind = "pending", diagnostic = false) => { if (!diagnostic) clearDiagnostic($(id)); $(id).textContent = text; $(id).dataset.result = kind; };
  const states = { source: false, backup: false, export: false, archive: false, restore: false };
  let busy = false, configured = false, interrupted = false, stale = false, releaseStale = false, releaseBlocked = false, held = false;
  const buttons = ["guide-source", "guide-backup", "guide-export", "guide-restore", "guide-release", "guide-recover"];
  function refresh() {
    const stopped = busy || !configured || interrupted;
    $("guide-source").disabled = stopped || held;
    $("guide-backup").disabled = stopped || releaseBlocked || !states.source || states.backup || states.export;
    $("guide-export").disabled = stopped || releaseBlocked || !states.backup || states.archive || states.restore;
    $("guide-export").textContent = states.export ? "Request the same download again" : "Verify, release source and download";
    $("guide-archive").disabled = stopped || releaseBlocked || !states.export || states.restore;
    $("guide-restore").disabled = stopped || releaseBlocked || !states.archive || states.restore;
    $("guide-release").disabled = busy || !configured || interrupted || !held;
    $("guide-recover").hidden = !stale;
    $("guide-recover").disabled = stopped || !stale;
    $("guide-recover-release").hidden = !releaseStale;
    $("guide-recover-release").disabled = stopped || !releaseStale;
    $("guide-advanced").hidden = held || busy;
    for (const id of ["guide-return", "prototype-tools"]) $(id).ariaDisabled = String(held || busy);
    const next = interrupted ? labels["page-interrupted"] : busy ? "Keep this tab open and the device awake. Wait for verification and session release, even when all objects have copied." :
      releaseBlocked ? "Next: resolve session release below. No further backup, export or restore is allowed until release is confirmed." :
      states.restore ? "Copy checks passed for this run. Backup and restored copy were independently reopened after release, compared with your source, and released again. Return to the acceptance suite for the other device checks." :
      !states.source ? "Next: choose your existing completed canonical synthetic source. You do not need to run the 25 live checks again." :
      !states.backup ? "Next: choose a new empty BACKUP folder. Its content checks, independent reopen and session release run automatically." :
      !states.export ? "Next: request the portable archive download. The source session is released automatically before this step finishes." :
      !states.archive ? "Next: save the download in Files, then select that exact saved JSON file below. A download request alone does not verify that it was saved." :
      "Next: choose another new empty RESTORED COPY folder. Restore, independent reopen, exact comparison and release run automatically.";
    write("guide-next", next, states.restore ? "pass" : "pending");
  }
  function showError(status, error) {
    const code = createDiagnostic(error).code;
    stale = code === "stale-session";
    releaseStale = code === "release-stale-session";
    if (["release-unconfirmed", "operation-and-release-unconfirmed", "release-stale-session", "ownership-lost"].includes(code)) releaseBlocked = true;
    write(status, showDiagnostic(error, { surface: "copy-guide", target: $(status), document }), code === "selection-cancelled" ? "pending" : "error", true);
  }
  async function run(status, work) {
    if (busy || interrupted || !configured) return;
    busy = true; write(status, "Working. This step has not passed."); refresh();
    $(status).after($("guide-progress"));
    const timer = createElapsedTimer(now);
    const progress = progressFactory({ region: $("guide-progress"), phase: $("guide-phase"), count: $("guide-count"), elapsed: $("guide-elapsed") });
    let passed = false;
    try { passed = await work(progress) !== false && !interrupted; }
    catch (error) { showError(status, error); }
    finally {
      if (interrupted) write(status, labels["page-interrupted"], "error");
      if (interrupted && driver.hasSessions()) write("guide-release-result", "Release after interruption was not confirmed. Preserve all folders. Reopen this guide on the same device and resolve the session before switching devices.", "error");
      progress.finish(passed);
      const shared = ["guide-backup-result", "guide-restore-result"].includes(status) ? "Copy and independent reopen share this operation time: " : "Operation time: ";
      write(status.replace("-result", "-time"), shared + formatElapsed(timer.stop()) + ". Includes folder selection and browser wait when applicable.");
      held = driver.hasSessions(); busy = false; refresh();
    }
  }
  const click = (id, status, work) => $(id).addEventListener("click", () => { if (!$(id).disabled) return run(status, work); });
  for (const id of ["guide-return", "prototype-tools"]) $(id).addEventListener("click", event => {
    if (!held && !busy) return;
    event.preventDefault();
    write("guide-navigation-result", busy ? "Wait for the current operation to finish. Release sessions before leaving this guide." :
      "Release sessions before leaving this guide. Use Release sessions and stop this run above, then follow this link again.", "error");
  });
  const sourcePassed = summary => {
    states.source = true; stale = false;
    write("guide-source-result", `Verified the selected folder's canonical content and all retained history. ${summary.counts.accounts} accounts, ${summary.counts.imports} imports, ${summary.counts.activities} activities and ${summary.counts.events} audit events. Revision ${summary.revision}; ${summary.objects} retained objects. Check that this is the source you intended. These counts do not prove that the 25-check recipe ran.`, "pass");
  };
  click("guide-source", "guide-source-result", async progress => {
    for (const key of Object.keys(states)) states[key] = false;
    for (const id of ["backup", "backup-reopen", "export", "archive", "restore", "restore-reopen", "release"]) write("guide-" + id + "-result", "Not run for this source.");
    for (const id of ["source", "backup", "export", "archive", "restore", "release"]) write("guide-" + id + "-time", "");
    held = true;
    sourcePassed(await driver.chooseSource(progress));
  });
  click("guide-recover", "guide-source-result", async progress => {
    if (!window.confirm("Confirm every previous tab/device using the selected SOURCE folder has stopped. Recover its stale session?")) {
      write("guide-source-result", "Recovery cancelled. Source verification has not passed."); return false;
    }
    sourcePassed(await driver.recoverSource(progress));
  });
  click("guide-backup", "guide-backup-result", async progress => {
    let copied = false;
    write("guide-backup-reopen-result", "Waiting for copy verification and release.");
    try { await driver.backup(progress, () => {
      copied = true;
      write("guide-backup-result", "Backup written, verified and released. Independent reopen is still running.", "pass");
      write("guide-backup-reopen-result", "Reopening through a new session and comparing all retained bytes with the source.");
    }); } catch (error) {
      showError(copied ? "guide-backup-reopen-result" : "guide-backup-result", error); return false;
    }
    states.backup = true;
    write("guide-backup-result", "PASS: backup written, verified and released.", "pass");
    write("guide-backup-reopen-result", "PASS: independently reopened through a new session, exact source history matched, then released again.", "pass");
  });
  click("guide-export", "guide-export-result", async progress => {
    states.export = states.archive = states.restore = false;
    driver.clearLocalArchive(); $("guide-archive").value = "";
    write("guide-archive-result", "Not verified. Select the saved file after the download.");
    write("guide-restore-result", "Not run for this download."); write("guide-restore-reopen-result", "Not run for this download.");
    await driver.exportArchive(progress);
    states.export = true; held = false;
    write("guide-export-result", "Archive integrity and source history verified. Download requested. Saving the file is still unverified.", "pass");
    write("guide-release-result", "PASS: source session released. Backup and restored destinations are released within their own steps.", "pass");
  });
  $("guide-archive").addEventListener("change", () => {
    if (busy || interrupted || $("guide-archive").disabled || !states.export) return;
    states.archive = states.restore = false; driver.clearLocalArchive();
    write("guide-restore-result", "Not run for this file."); write("guide-restore-reopen-result", "Not run for this file.");
    const file = $("guide-archive").files[0];
    if (!file) { write("guide-archive-result", "No file selected. The saved-file check has not passed."); refresh(); return; }
    return run("guide-archive-result", async progress => {
      await driver.loadArchive(file, progress); states.archive = true;
      write("guide-archive-result", "PASS: selected local file verified and exactly matched this run's exported archive and source history.", "pass");
    });
  });
  click("guide-restore", "guide-restore-result", async progress => {
    let copied = false;
    held = true;
    write("guide-restore-reopen-result", "Waiting for restore verification and release.");
    try { await driver.restore(progress, () => {
      copied = true;
      write("guide-restore-result", "Restore written, verified and released. Independent reopen is still running.", "pass");
      write("guide-restore-reopen-result", "Reopening through a new session and comparing all retained bytes with the selected archive.");
    }); } catch (error) {
      showError(copied ? "guide-restore-reopen-result" : "guide-restore-result", error); return false;
    }
    states.restore = true; held = false;
    write("guide-restore-result", "PASS: restored into a distinct copy, verified and released.", "pass");
    write("guide-restore-reopen-result", "PASS: independently reopened through a new session, exact archive/source history matched, then released again.", "pass");
  });
  // Explicit cleanup is also offered after cancellations and uncertain outcomes.
  $("guide-release").addEventListener("click", async () => {
    if ($("guide-release").disabled) return;
    if (interrupted) { write("guide-release-result", labels["page-interrupted"], "error"); return; }
    return run("guide-release-result", async progress => {
      await driver.releaseAll(progress); held = false; stale = releaseStale = releaseBlocked = false;
      for (const key of Object.keys(states)) states[key] = false;
      write("guide-release-result", "PASS: tracked sessions released. Choose the source again before continuing this guide.", "pass");
    });
  });
  click("guide-recover-release", "guide-release-result", async progress => {
    if (!window.confirm("Confirm every other tab/device using this run's SOURCE, BACKUP and RESTORED COPY folders has stopped. Recover only this page's matching stale sessions and release them?")) {
      write("guide-release-result", "Recovery and release cancelled. Release remains unconfirmed."); return false;
    }
    await driver.releaseAll(progress, { recoverStale: true }); held = false; stale = releaseStale = releaseBlocked = false;
    for (const key of Object.keys(states)) states[key] = false;
    write("guide-release-result", "PASS: matching stale sessions were recovered with your confirmation, then released. Choose the source again to restart the guide.", "pass");
  });
  window.addEventListener("pagehide", () => {
    interrupted = true;
    for (const id of buttons) $(id).disabled = true;
    $("guide-archive").disabled = true;
    $("guide-recover-release").disabled = true;
    write("guide-next", labels["page-interrupted"], "error");
    void driver.interrupt().catch(() => write("guide-release-result", "Release after interruption was not confirmed. Preserve all folders. Reconnect on this device and resolve the session before switching devices.", "error"));
  });
  refresh();
  return { ready() { configured = true; refresh(); }, unavailable() { write("guide-source-result", "Google services or deployment configuration are unavailable. No Drive operations were attempted.", "error"); } };
}
