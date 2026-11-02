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
  const calls = { clear: 0, save: 0 };
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = { state: "ready" }; }
    async prepare() {}
    async clearSyntheticSnapshot() { calls.clear++; await clearing.promise; this.options.onSnapshot([]); }
    async saveSyntheticSnapshot(rows) { calls.save++; await saving.promise; this.options.onSnapshot(rows); }
  }
  const context = { Intl, Date, TextEncoder, Set, Promise,
    document: { getElementById: get, createElement: node },
    fakeStorage: { DashboardSyntheticStorage: Storage, createDashboardReleaseHandler: () => () => {} },
    fakeDiagnostic: { createStorageDiagnostics: () => ({ record() {}, format() { return ""; } }) } };
  vm.createContext(context);
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8")
    .replace("let syntheticStorage = null;", "globalThis.testState = state; let syntheticStorage = null;")
    .replace('import("./dashboard-synthetic-storage.mjs")', "Promise.resolve(fakeStorage)")
    .replace('import("./storage-diagnostics.mjs")', "Promise.resolve(fakeDiagnostic)");
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return { get, state: context.testState, clearing, saving, calls,
    importFile: (file) => get("csv-file").change({ target: { files: [file] } }) };
}
const descriptions = (state) => Array.from(state.transactions, (row) => row.description);

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
  assert.deepEqual(h.calls, { clear: 1, save: 0 });
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
  assert.deepEqual(h.calls, { clear: 0, save: 1 });
  h.saving.resolve();
  await saving;
  assert.deepEqual(descriptions(h.state), ["invented during"]);
  assert.equal(h.state.syntheticTransactions.length, 4);
  assert.equal(h.get("load-sample").disabled, false);
});
