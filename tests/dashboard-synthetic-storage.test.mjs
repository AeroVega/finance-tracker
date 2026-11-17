import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyPickerAction, DashboardSyntheticStorage
} from "../js/dashboard-synthetic-storage.mjs";

test("Google Picker load event waits for the user's folder choice instead of treating it as cancellation", () => {
  const actions = { LOADED: "loaded", PICKED: "picked", CANCEL: "cancel" };
  assert.equal(classifyPickerAction(actions.LOADED, actions), "pending");
  assert.equal(classifyPickerAction("unknown-event", actions), "pending");
  assert.equal(classifyPickerAction(actions.PICKED, actions), "picked");
  assert.equal(classifyPickerAction(actions.CANCEL, actions), "cancelled");
});

test("dashboard CSV import path remains local and cannot invoke Drive persistence", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const importStart = app.indexOf("async function importFile(file)");
  const renderStart = app.indexOf("function render()", importStart);
  assert.notEqual(importStart, -1);
  assert.notEqual(renderStart, -1);
  const importFlow = app.slice(importStart, renderStart);
  assert.equal(importFlow.includes("saveSyntheticSnapshot"), false);
  assert.equal(importFlow.includes("clearSyntheticSnapshot"), false);
  assert.match(importFlow, /CSV rows remain local and are never uploaded to Drive/);
});

test("dashboard supplies a synchronous token provider to the Drive session adapter", () => {
  const source = readFileSync(new URL("../js/dashboard-synthetic-storage.mjs", import.meta.url), "utf8");
  assert.match(source, /accessToken: \(\) => this\.token\(\)/);
  assert.doesNotMatch(source, /accessToken: async \(\) => this\.token\(\)/);
});

 test("dashboard refuses obsolete layout selection before authorization",async()=>{const storage=new DashboardSyntheticStorage();await assert.rejects(storage.connect({canonicalLayout:"partitions-v5"}),{code:"unsupported-canonical-layout"});assert.equal(storage.lifecycle,null);});
