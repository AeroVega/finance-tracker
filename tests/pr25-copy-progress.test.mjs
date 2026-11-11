import { showDiagnostic, clearDiagnostic } from '../js/app-diagnostics.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { copyProgressText, startCopyProgress } from "../prototype/pr25-copy-progress.mjs";

const source = await readFile(new URL("../prototype/pr25-acceptance.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../prototype/pr25-acceptance.html", import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const failure = (code) => Object.assign(new Error("Private provider details must not be displayed"), { code });
function node() {
  let text = "";
  return { children: [], attributes: {},
    append(...items) { this.children.push(...items); }, setAttribute(key, value) { this.attributes[key] = value; },
    insertAdjacentElement(position, item) { this.diagnosticPanel = item; }, remove() {}, focus() {}, select() {},
    dataset: {}, hidden: false, disabled: false, writes: 0, events: new Map(), files: [],
    get textContent() { return text; }, set textContent(value) { text = value; this.writes++; },
    addEventListener(type, callback) { this.events.set(type, callback); },
    emit(type) { return this.events.get(type)?.(); } };
}

test("copy labels allow only fixed phases and valid aggregate copy counts", () => {
  for (const phase of ["source-verification", "archive-verification", "destination-preparation", "destination-verification", "source-recheck", "publishing-manifest", "final-verification"]) {
    const label = copyProgressText({ phase, completed: 99, total: 99, fileId: "private-id", message: "private detail" });
    assert.equal(label.count, ""); assert.doesNotMatch(label.phase, /private|PASS|finished/);
  }
  for (const phase of ["complete", "private-folder-name", "__proto__", "toString", undefined,
    { toString: () => "copying-objects" }, { toString() { throw new Error("must not coerce"); } }]) assert.equal(copyProgressText({ phase }), null);
  assert.equal(copyProgressText(null), null);
  assert.match(copyProgressText({ phase: "copying-objects", completed: 4, total: 4 }).count, /4 of 4\. Final verification still required/);
  assert.match(copyProgressText({ phase: "copying-objects", completed: 0, total: 0 }).count, /0 of 0/);
  for (const [completed, total] of [[null, null], [-1, 2], [2, 1], ["1", 2], [1, Infinity], [1.5, 2], [1, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.equal(copyProgressText({ phase: "copying-objects", completed, total }).count, "");
  }
});

test("progress updates only changed text and stops its clock and observer when settled", () => {
  const nodes = { region: node(), phase: node(), count: node(), elapsed: node() };
  let now = 10, timerTick, cancelled;
  const progress = startCopyProgress({ ...nodes, now: () => now, schedule: (fn) => { timerTick = fn; return 7; }, cancel: (id) => { cancelled = id; } });
  progress.onProgress({ phase: "copying-objects", completed: 3, total: 3 });
  const phaseWrites = nodes.phase.writes, countWrites = nodes.count.writes;
  progress.onProgress({ phase: "copying-objects", completed: 3, total: 3 });
  timerTick(); assert.equal(nodes.phase.writes, phaseWrites); assert.equal(nodes.count.writes, countWrites);
  now = 12010; timerTick(); assert.equal(nodes.elapsed.textContent, "Elapsed: 12 seconds.");
  progress.onProgress({ phase: "complete" }); assert.match(nodes.phase.textContent, /Copying/);
  progress.finish(false); assert.equal(cancelled, 7);
  assert.equal(nodes.elapsed.textContent, "Total time: 12 seconds."); assert.match(nodes.phase.textContent, /did not complete/);
  now = 90000; timerTick(); progress.onProgress({ phase: "final-verification" }); progress.finish(true);
  assert.equal(nodes.elapsed.textContent, "Total time: 12 seconds."); assert.match(nodes.phase.textContent, /did not complete/);
});

test("broken clocks, timers, and display nodes never throw or invent measured time", () => {
  for (const now of [() => undefined, () => NaN, () => { throw new Error("clock"); }]) {
    const elapsed = node();
    const progress = startCopyProgress({ elapsed, now, schedule: () => { throw new Error("timer"); }, cancel: () => { throw new Error("timer"); } });
    progress.onProgress({ get phase() { throw new Error("observer input"); } });
    progress.finish(true); assert.equal(elapsed.textContent, "Total time: unmeasured.");
  }
  const broken = { get textContent() { throw new Error("display"); } };
  assert.doesNotThrow(() => startCopyProgress({ phase: broken, count: broken, elapsed: broken, schedule: () => 1 }).finish(false));
});

// Execute the actual page handlers. All storage/session/picker boundaries are
// controlled fakes; no browser authorization, network call, or Drive write runs.
async function page() {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], node()]));
  const get = (id) => elements.get(id);
  const state = { calls: [], now: 0, timers: new Map(), timerId: 0, downloads: 0, sessions: 0, stops: 0,
    pick: async () => ({ id: "invented-destination", name: "Invented private label" }),
    backup: async ({ onProgress }) => { onProgress({ phase: "copying-objects", completed: 2, total: 2 }); return { objectCount: 2 }; },
    export: async ({ onProgress }) => { onProgress({ phase: "source-verification" }); return { invented: true }; },
    verify: async (_archive, { onProgress }) => { onProgress({ phase: "archive-verification" }); },
    restore: async ({ onProgress }) => { onProgress({ phase: "final-verification" }); return { manifest: { revision: 2 } }; },
    release: async () => {}, quarantine: true };
  let storage;
  class Storage {
    constructor() { storage = this; this.config = {}; this.folderId = "invented-primary"; }
    async prepare() {}
    async connect() { this.lifecycle = { state: "ready", acceptingWrites: true, transactionAdapter: {}, manifestFileId: "invented-manifest",
      coordinator: { canWrite: true, withWrite: (work) => work(), assertCanWrite() {} } }; }
    token() { return "invented-token"; }
  }
  class Coordinator {
    constructor() { state.sessions++; }
    async start() { this.canWrite = true; }
    startHeartbeat() { return () => state.stops++; }
    async release() { await state.release(); this.canWrite = false; }
    withWrite(work) { return work(); }
    assertCanWrite() {}
  }
  class Adapter {
    async listChildren() { return state.quarantine ? [{ id: "invented-marker", appProperties: { financeTrackerKind: "copy-preparation" } }] : []; }
    async readJson() { return { state: "quarantined" }; }
  }
  const context = { DashboardSyntheticStorage: Storage, SessionCoordinator: Coordinator, GoogleDriveTransactionAdapter: Adapter,
    validateSyntheticApplicationSnapshot() {}, createDriveSessionAdapter() {}, verifyCatalogHistory() {}, storageError: (code) => failure(code), ORIGINAL_RETENTION_MS: 1,
    backupCatalogCopy: (options) => { state.calls.push(["backup", options]); return state.backup(options); },
    exportCatalogArchive: (options) => { state.calls.push(["export", options]); return state.export(options); },
    verifyCatalogArchive: (archive, options) => { state.calls.push(["verify", options]); return state.verify(archive, options); },
    restoreCatalogArchive: (options) => { state.calls.push(["restore", options]); return state.restore(options); },
    chooseSyntheticFolder: () => { state.calls.push(["pick"]); return state.pick(); },
    startCopyProgress: (options) => startCopyProgress({ ...options, now: () => state.now,
      schedule: (callback) => { state.timers.set(++state.timerId, callback); return state.timerId; }, cancel: (id) => state.timers.delete(id) }),
    document: { getElementById: get, createElement: tag => ({ ...node(), click() { if (tag === "a") state.downloads++; } }) },
    window: { addEventListener() {} }, navigator: { onLine: true }, crypto, Blob, confirm: () => true,
    URL: { createObjectURL: () => "blob:invented", revokeObjectURL() {} }, setTimeout: () => 0 };
  context.clearDiagnostic = clearDiagnostic;
  context.showDiagnostic = (error, options) => showDiagnostic(error, { ...options, document: context.document, navigator: context.navigator });
  vm.runInNewContext(source.replace(/^import .*;$/gm, ""), context);
  await tick();
  const callsBeforeConnect = state.calls.length;
  await get("connect").emit("click");
  return { state, get, storage, callsBeforeConnect, click: (id) => get(id).emit("click"),
    load: (file) => { get("archive").files = file ? [file] : []; return get("archive").emit("change"); },
    text: () => [...elements.values()].map((element) => element.textContent).join("\n") };
}

test("backup remains pending through full object count, final checks, and destination release", async () => {
  const h = await page(), copyGate = deferred(), releaseGate = deferred();
  let observer;
  assert.equal(h.callsBeforeConnect, 0);
  h.state.backup = async ({ onProgress }) => { observer = onProgress; onProgress({ phase: "copying-objects", completed: 2, total: 2 }); await copyGate.promise; return { objectCount: 2 }; };
  h.state.release = () => releaseGate.promise;
  const pending = h.click("backup"); await tick();
  assert.equal(h.get("backup").disabled, true); assert.equal(h.get("archive").disabled, true);
  assert.equal(h.get("copy-result").dataset.result, "pending"); assert.doesNotMatch(h.text(), /PASS/);
  assert.match(h.get("copy-count").textContent, /2 of 2\. Final verification still required/);
  const writes = h.get("copy-phase").writes;
  h.state.now = 12000; for (const timer of h.state.timers.values()) timer();
  assert.equal(h.get("copy-phase").writes, writes); assert.match(h.get("copy-elapsed").textContent, /12 seconds/);
  await h.click("backup"); await h.click("export");
  assert.equal(h.state.calls.filter(([name]) => name === "backup").length, 1); assert.equal(h.state.calls.some(([name]) => name === "export"), false);
  observer({ phase: "complete" }); assert.doesNotMatch(h.text(), /PASS/);
  observer({ phase: "final-verification" }); assert.equal(h.get("copy-count").hidden, true);
  copyGate.resolve(); await tick(); assert.match(h.get("copy-phase").textContent, /Releasing/); assert.doesNotMatch(h.text(), /PASS/);
  releaseGate.resolve(); await pending;
  assert.match(h.get("copy-result").textContent, /^PASS/); assert.equal(h.get("copy-elapsed").textContent, "Total time: 12 seconds.");
  assert.equal(h.get("backup").disabled, false); assert.equal(h.state.timers.size, 0); assert.equal(h.state.stops, 1);
  const finished = h.get("copy-phase").textContent; observer({ phase: "source-verification" }); assert.equal(h.get("copy-phase").textContent, finished);
  assert.doesNotMatch(h.text(), /invented-destination|Invented private label|invented-token/);
});

test("copy or release failure stays failed even after the last object or an unknown completion event", async () => {
  for (const failRelease of [false, true]) {
    const h = await page();
    h.state.backup = async ({ onProgress }) => { onProgress({ phase: "copying-objects", completed: 2, total: 2 }); onProgress({ phase: "complete" }); if (!failRelease) throw failure("copy-quarantined"); return { objectCount: 2 }; };
    if (failRelease) h.state.release = async () => { throw failure("release-unconfirmed"); };
    await h.click("backup");
    assert.equal(h.get("copy-result").dataset.result, "error"); assert.match(h.get("copy-phase").textContent, /did not complete/);
    assert.doesNotMatch(h.text(), /PASS|Private provider/); assert.equal(h.state.timers.size, 0); assert.equal(h.get("backup").disabled, false);
  }
});

test("cancelled selection and same-folder selection never start a copy", async () => {
  for (const pick of [async () => { throw failure("selection-cancelled"); }, async () => ({ id: "invented-primary" })]) {
    const h = await page(); h.state.pick = pick; await h.click("backup");
    assert.equal(h.state.sessions, 0); assert.deepEqual(h.state.calls.map(([name]) => name), ["pick"]);
    assert.equal(h.get("copy-result").dataset.result, "error"); assert.match(h.get("copy-phase").textContent, /did not complete/);
    assert.doesNotMatch(h.text(), /PASS/); assert.equal(h.state.timers.size, 0);
  }
});

test("archive loading uses the busy guard and rejects overlap without overwriting its selected archive", async () => {
  const h = await page(), read = deferred(); let otherReads = 0, verified;
  h.state.verify = async (archive, { onProgress }) => { verified = archive; onProgress({ phase: "archive-verification" }); };
  const pending = h.load({ name: "private-file-name.json", text: () => read.promise });
  assert.equal(h.get("backup").disabled, true); assert.match(h.get("copy-phase").textContent, /Reading/);
  await h.click("backup"); await h.load({ text: async () => { otherReads++; return "{}"; } });
  assert.equal(otherReads, 0); assert.equal(h.state.calls.length, 0);
  read.resolve('{"invented":1}'); await pending;
  assert.equal(verified.invented, 1); assert.match(h.get("copy-result").textContent, /^PASS/);
  assert.equal(h.get("restore").disabled, false); assert.equal(h.get("verify-archive").disabled, false); assert.doesNotMatch(h.text(), /private-file-name/);
  await h.click("verify-archive"); assert.match(h.get("copy-result").textContent, /loaded archive integrity/);
  assert.equal(h.state.calls.filter(([name]) => name === "verify").length, 2);
});

test("failed and empty archive selections never leave a loaded archive or a passing progress state", async () => {
  const h = await page(); await h.load({ text: async () => "{}" });
  assert.equal(h.get("restore").disabled, false);
  await h.load({ text: async () => "private invalid JSON" });
  assert.equal(h.get("restore").disabled, true); assert.equal(h.get("verify-archive").disabled, true);
  assert.match(h.get("copy-result").textContent, /Error code: unknown/); assert.match(h.get("copy-phase").textContent, /did not complete/);
  assert.doesNotMatch(h.text(), /private invalid|PASS/);
  h.state.verify = async () => { throw failure("invalid-archive"); };
  await h.load({ text: async () => "{}" }); assert.equal(h.get("restore").disabled, true); assert.match(h.get("copy-phase").textContent, /did not complete/);
  await h.load(null); assert.equal(h.get("copy-progress").hidden, true); assert.equal(h.get("copy-result").textContent, "No archive selected.");
  assert.equal(h.state.timers.size, 0);
});

test("export waits for independent archive verification before download and success", async () => {
  const h = await page(), verification = deferred();
  h.state.verify = async (_archive, { onProgress }) => { onProgress({ phase: "archive-verification" }); await verification.promise; };
  const pending = h.click("export"); await tick();
  assert.match(h.get("copy-phase").textContent, /Verifying archive/); assert.doesNotMatch(h.text(), /PASS/); assert.equal(h.state.downloads, 0);
  verification.resolve(); await pending;
  assert.equal(h.state.downloads, 1); assert.match(h.get("copy-result").textContent, /^PASS/);
  assert.deepEqual(h.state.calls.map(([name]) => name), ["export", "verify"]);
});

test("restore receives its observer and preserves final verification failures", async () => {
  const h = await page(); await h.load({ text: async () => "{}" });
  h.state.restore = async ({ onProgress }) => { onProgress({ phase: "final-verification" }); throw failure("copy-quarantined"); };
  await h.click("restore"); assert.equal(h.get("copy-result").dataset.result, "error"); assert.doesNotMatch(h.text(), /PASS/);
  assert.deepEqual(h.state.calls.map(([name]) => name), ["verify", "pick", "restore"]);
});

test("quarantine rehearsal passes only with the durable quarantine evidence", async () => {
  for (const confirmed of [true, false]) {
    const h = await page(); h.state.quarantine = confirmed;
    h.state.restore = async ({ onProgress, beforePublish }) => {
      onProgress({ phase: "destination-verification" });
      await assert.rejects(beforePublish(), (error) => error.code === "intentional-synthetic-failure");
      throw Object.assign(failure("copy-quarantined"), { quarantineConfirmed: true });
    };
    await h.click("quarantine");
    assert.equal(h.get("copy-result").dataset.result, confirmed ? "pass" : "error");
    assert.deepEqual(h.state.calls.map(([name]) => name), ["pick", "export", "restore"]);
    assert.equal(h.state.timers.size, 0);
  }
});

test("a missing clock does not change the backup outcome", async () => {
  const h = await page(); h.state.now = undefined; await h.click("backup");
  assert.match(h.get("copy-result").textContent, /^PASS/); assert.equal(h.get("copy-elapsed").textContent, "Total time: unmeasured.");
});

test("only phase transitions use the live region, never copy counts or elapsed ticks", () => {
  assert.match(html, /id="copy-phase" role="status" aria-live="polite"/);
  assert.match(html, /id="copy-count" aria-live="off"/);
  assert.match(html, /id="copy-elapsed" aria-live="off"/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|console\./);
});
