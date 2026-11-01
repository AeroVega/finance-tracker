import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../prototype/session-coordination-test.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../prototype/session-coordination-test.mjs", import.meta.url), "utf8");

test("session test page loads the real coordinator and Drive marker adapter", () => {
  assert.match(html, /session-coordination-test\.mjs/);
  assert.match(source, /from "\.\.\/js\/session-coordination\.mjs"/);
  assert.match(source, /from "\.\.\/js\/drive-session-adapter\.mjs"/);
  assert.match(source, /new SessionCoordinator\(\{ adapter: state\.adapter \}\)/);
  assert.match(source, /createDriveSessionAdapter\(/);
});

test("session test page reuses the configured Google OAuth and Picker flow", () => {
  assert.match(source, /GOOGLE_CONFIG/);
  assert.match(source, /validateGoogleConfig\(GOOGLE_CONFIG\)/);
  assert.match(source, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.match(source, /google\.accounts\.oauth2\.initTokenClient/);
  assert.match(source, /google\.picker\.PickerBuilder/);
});

test("session test page blocks the canonical database folder and requires synthetic-folder confirmation", () => {
  assert.match(source, /PRODUCTION_FOLDER_NAME = "finance-tracker-database"/);
  assert.match(source, /The production database folder is blocked/);
  assert.match(source, /dedicated synthetic test folder containing no personal financial data/);
  assert.match(html, /No ledger, manifest, CSV, or transaction files are read or changed/);
});

test("session test page exposes acquisition, write gating, heartbeat, recovery, and release", () => {
  for (const id of ["inspect-session", "acquire-session", "guarded-write", "heartbeat-once",
    "heartbeat-start", "resume-session", "recover-session", "release-session"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(source, /coordinator\.withWrite\(/);
  assert.match(source, /coordinator\.startHeartbeat\(/);
  assert.match(source, /coordinator\.recoverStale\(\{ confirm: true \}\)/);
  assert.match(source, /coordinator\.release\(\)/);
});

test("session test page includes the two-device and browser-crash rehearsal", () => {
  assert.match(html, /On device A/);
  assert.match(html, /On device B/);
  assert.match(html, /simulate a browser crash/i);
  assert.match(source, /addEventListener\("offline"/);
  assert.match(source, /online: navigator\.onLine/);
});

test("a pending or superseded inspection cannot present an older marker as current", () => {
  assert.match(source, /inspectionSequence: 0/);
  assert.match(source, /const sequence = ++state\.inspectionSequence/);
  assert.match(source, /setText\("marker-state", "Inspecting…"/);
  assert.match(source, /state\.lastInspection = null/);
  assert.match(source, /sequence !== state\.inspectionSequence/);
  assert.match(source, /state\.inspectionSequence \+= 1/);
});
