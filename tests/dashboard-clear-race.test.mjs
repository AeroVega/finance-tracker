import { diagnosticMessage } from '../js/app-diagnostics.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function csv(name, description, textPromise) {
  return { name, type: "text/csv", text: () => textPromise || Promise.resolve(`Date,Description,Amount\n2026-11-01,${description},1\n`) };
}
async function setup() {
  const nodes = new Map();
  const node = () => ({ textContent: "", dataset: {}, style: {}, disabled: false,
    addEventListener(event, callback) { this[event] = callback; }, replaceChildren() {}, append() {}, appendChild() {} });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const clearing = deferred(), saving = deferred();
  const calls = { clear: 0, save: 0, savedSnapshots: [] };
  let storageInstance;
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = { state: "ready" }; storageInstance = this; }
    async prepare() {}
    async clearSyntheticSnapshot() { calls.clear++; await clearing.promise; this.options.onSnapshot([]); }
    async saveSyntheticSnapshot(rows) { calls.save++; calls.savedSnapshots.push(structuredClone(rows)); await saving.promise; this.options.onSnapshot(rows); }
  }
  const context = { showDiagnostic: diagnosticMessage, clearDiagnostic() {}, Intl, Date, TextEncoder, Set, Promise,
    document: { getElementById: get, createElement: node },
    fakeStorage: { DashboardSyntheticStorage: Storage, createDashboardReleaseHandler: () => () => {} },
    fakeDiagnostic: { createStorageDiagnostics: () => ({ record() {}, format() { return ""; } }) } };
  vm.createContext(context);
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8")
    .replace(/^import .*app-diagnostics.*;\n/m, '')
    .replace("let syntheticStorage = null;", "globalThis.testState = state; let syntheticStorage = null;")
    .replace('import("./dashboard-synthetic-storage.mjs")', "Promise.resolve(fakeStorage)")
    .replace('import("./storage-diagnostics.mjs")', "Promise.resolve(fakeDiagnostic)");
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return { get, state: context.testState, storage: () => storageInstance, clearing, saving, calls,
    importFile: (file) => get("csv-file").change({ target: { files: [file] } }) };
}
const descriptions = (state) => Array.from(state.transactions, (row) => row.description);

test("explicit Save persists only the current synthetic snapshot and verifies read-back", async () => {
  const h = await setup();
  await h.importFile(csv("private.csv", "local-only CSV row"));
  const loading = h.get("load-sample").click();
  assert.equal(h.get("save-data").disabled, true);
  h.saving.resolve();
  await loading;
  assert.equal(h.get("save-data").disabled, false);
  const saving = h.get("save-data").click();
  await saving;
  assert.equal(h.calls.save, 2);
  assert.equal(h.calls.savedSnapshots[1].length, 4);
  assert.equal(h.calls.savedSnapshots[1].every((row) => row.syntheticOnly === true), true);
  assert.deepEqual(descriptions(h.state), ["local-only CSV row"]);
  assert.equal(h.state.syntheticTransactions.length, 4);
  assert.equal(h.get("save-data").disabled, false);
});

test("Clear and Save are disabled while an existing storage session is not ready", async () => {
  const h = await setup();
  await h.importFile(csv("local.csv", "local row"));
  h.storage().lifecycle.state = "ownership-unknown";
  await h.importFile(csv("newer.csv", "newer local row"));
  assert.equal(h.get("clear-data").disabled, true);
  assert.equal(h.get("save-data").disabled, true);
  assert.equal(h.get("csv-file").disabled, false);
  await h.get("clear-data").click();
  assert.deepEqual(descriptions(h.state), ["local row", "newer local row"]);
});

test("lifecycle state changes immediately refresh Save and Clear availability", async () => {
  const h = await setup();
  await h.importFile(csv("local.csv", "local row"));
  h.storage().lifecycle.state = "ownership-unknown";
  h.storage().options.onStatus({ state: "ownership-unknown", message: "Ownership uncertain", kind: "error" });
  assert.equal(h.get("clear-data").disabled, true);
  assert.equal(h.get("save-data").disabled, true);
  assert.equal(h.get("csv-file").disabled, false);
  h.storage().lifecycle.state = "ready";
  h.storage().options.onStatus({ state: "ready", message: "Ready", kind: "success" });
  assert.equal(h.get("clear-data").disabled, false);
  assert.equal(h.get("save-data").disabled, false);
});

test("failed remote clear preserves both prior and newer CSV imports and provenance", async () => {
  const h = await setup();
  await h.importFile(csv("before.csv", "invented before"));
  const clearing = h.get("clear-data").click();
  assert.equal(h.get("clear-data").disabled, true);
  assert.equal(h.get("load-sample").disabled, true);
  assert.equal(h.get("release-synthetic-storage").disabled, true);
  assert.equal(h.get("csv-file").disabled, false);
  await h.importFile(csv("during.csv", "invented during"));
  h.clearing.reject(new Error("invented remote failure"));
  await clearing;
  assert.deepEqual(descriptions(h.state), ["invented before", "invented during"]);
  assert.deepEqual(Array.from(h.state.sourceFiles, (source) => source.name), ["before.csv", "during.csv"]);
  assert.equal(h.state.importedFingerprints.size, 2);
  await h.importFile(csv("during.csv", "invented during"));
  assert.equal(h.state.transactions.length, 2);
});

test("successful remote clear removes only its original selection, retaining newer imports", async () => {
  const h = await setup();
  await h.importFile(csv("before.csv", "invented before"));
  const clearing = h.get("clear-data").click();
  await h.importFile(csv("during.csv", "invented during"));
  h.clearing.resolve();
  await clearing;
  assert.deepEqual(descriptions(h.state), ["invented during"]);
  assert.deepEqual(Array.from(h.state.sourceFiles, (source) => source.name), ["during.csv"]);
  assert.equal(h.state.importedFingerprints.size, 1);
  await h.importFile(csv("before.csv", "invented before"));
  assert.deepEqual(descriptions(h.state), ["invented during", "invented before"]);
});

test("an import already reading its file survives a clear that completes first", async () => {
  const h = await setup();
  await h.importFile(csv("before.csv", "invented before"));
  const reading = deferred();
  const importing = h.importFile(csv("pending.csv", "", reading.promise));
  const clearing = h.get("clear-data").click();
  h.clearing.resolve();
  await clearing;
  reading.resolve("Date,Description,Amount\n2026-11-01,invented pending,1\n");
  await importing;
  assert.deepEqual(descriptions(h.state), ["invented pending"]);
  assert.equal(h.state.sourceFiles.length, 1);
  assert.equal(h.state.importedFingerprints.size, 1);
});

test("pending clear rejects repeated clear/sample handlers without blocking CSV", async () => {
  const h = await setup();
  await h.importFile(csv("before.csv", "invented before"));
  const clearing = h.get("clear-data").click();
  await h.get("clear-data").click();
  await h.get("load-sample").click();
  assert.equal(h.calls.clear, 1);
  assert.equal(h.calls.save, 0);
  h.clearing.resolve();
  await clearing;
  assert.equal(h.get("load-sample").disabled, false);
});

test("pending sample save blocks duplicate save and clear while CSV still imports", async () => {
  const h = await setup();
  const saving = h.get("load-sample").click();
  assert.equal(h.get("release-synthetic-storage").disabled, true);
  await h.get("load-sample").click();
  await h.get("clear-data").click();
  await h.importFile(csv("during.csv", "invented during"));
  assert.equal(h.calls.clear, 0);
  assert.equal(h.calls.save, 1);
  h.saving.resolve();
  await saving;
  assert.deepEqual(descriptions(h.state), ["invented during"]);
  assert.equal(h.state.syntheticTransactions.length, 4);
  assert.equal(h.get("load-sample").disabled, false);
});
