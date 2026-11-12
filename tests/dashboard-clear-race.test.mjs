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
  const events = new Map();
  const context = { showDiagnostic: diagnosticMessage, clearDiagnostic() {}, Intl, Date, TextEncoder, Set, Promise,
    addEventListener: (name, handler) => events.set(name, handler),
    fetch() { assert.fail('local preview must never use the network'); },
    document: { getElementById: get, createElement: node } };
  vm.createContext(context);
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8")
    .replace(/^import .*app-diagnostics.*;\n/m, '')
    .replace('let pendingImports = 0;', 'globalThis.testState = state; let pendingImports = 0;');
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return { get, state: context.testState, events,
    importFile: (file) => get("csv-file").change({ target: { files: [file] } }) };
}
const descriptions = (state) => Array.from(state.transactions, (row) => row.description);

test("sample loading and clearing are local, repeatable and preserve CSV provenance", async () => {
  const h = await setup();
  await h.importFile(csv("invented.csv", "invented local row"));
  await h.get("load-sample").click(); await h.get("load-sample").click();
  assert.deepEqual(descriptions(h.state), ["invented local row"]);
  assert.equal(h.state.syntheticTransactions.length,4);
  assert.equal(h.state.importedFingerprints.size,1);
  await h.get("clear-data").click(); await h.get("clear-data").click();
  assert.equal(h.state.transactions.length,0);
  assert.equal(h.state.syntheticTransactions.length,0);
  assert.equal(h.state.sourceFiles.length,0);
  assert.equal(h.state.importedFingerprints.size,0);
  assert.equal(h.get("clear-data").disabled,true);
  await h.importFile(csv("invented.csv", "invented local row"));
  assert.deepEqual(descriptions(h.state), ["invented local row"]);
});

test("an import already reading its file survives a clear that completes first", async () => {
  const h = await setup();
  await h.importFile(csv("before.csv", "invented before"));
  const reading = deferred();
  const importing = h.importFile(csv("pending.csv", "", reading.promise));
  await h.get("clear-data").click();
  reading.resolve("Date,Description,Amount\n2026-11-01,invented pending,1\n");
  await importing;
  assert.deepEqual(descriptions(h.state), ["invented pending"]);
  assert.deepEqual(Array.from(h.state.sourceFiles, source=>source.name), ["pending.csv"]);
  assert.equal(h.state.importedFingerprints.size,1);
  await h.importFile(csv("pending.csv", "invented pending"));
  assert.equal(h.state.transactions.length,1);
});

test("failed pending import cannot restore cleared rows or provenance", async () => {
  const h = await setup();
  await h.importFile(csv("before.csv", "invented before"));
  const reading = deferred(), importing = h.importFile(csv("pending.csv", "", reading.promise));
  await h.get("clear-data").click();
  reading.reject(new Error('invented read failure'));
  await importing;
  assert.equal(h.state.transactions.length,0);
  assert.equal(h.state.sourceFiles.length,0);
  assert.equal(h.state.importedFingerprints.size,0);
});

test("pending file reads warn before unload even after loaded rows are cleared", async () => {
  const h = await setup(), reading = deferred();
  const importing = h.importFile(csv("pending.csv", "", reading.promise));
  await h.get("clear-data").click();
  let warned = false;
  h.events.get('beforeunload')({preventDefault(){warned=true;}});
  assert.equal(warned,true);
  reading.reject(new Error('invented read failure')); await importing;
  warned=false; h.events.get('beforeunload')({preventDefault(){warned=true;}});
  assert.equal(warned,false);
});

test("local preview has no persistence controls, storage imports or external scripts", () => {
  const source = readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const html = readFileSync(new URL('../prototype/local-preview.html',import.meta.url),'utf8');
  assert.doesNotMatch(source,/DashboardSyntheticStorage|saveSyntheticSnapshot|clearSyntheticSnapshot|import\(|fetch\(|localStorage|sessionStorage/);
  assert.doesNotMatch(html,/id="(?:save-data|connect-synthetic-storage|release-synthetic-storage|recover-stale-storage)"|<script[^>]+https?:/);
  assert.match(html,/href="\.\.\/index.html#storage"/);
  assert.match(html,/Local preview rows are not transferred/);
});
