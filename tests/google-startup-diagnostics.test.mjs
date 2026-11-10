import test from "node:test";
import assert from "node:assert/strict";
import { googleStartupError, googleStartupMessage } from "../js/google-startup-diagnostics.mjs";
import { DashboardSyntheticStorage } from "../js/dashboard-synthetic-storage.mjs";

const validConfig = {clientId:"invented.apps.googleusercontent.com",apiKey:"invented-test-key",projectNumber:"123456789"};

async function withGoogleEnvironment({fetchImpl, windowImpl, now}, operation) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDateNow = Date.now;
  globalThis.fetch = fetchImpl;
  globalThis.window = windowImpl;
  if (now) Date.now = now;
  try { await operation(); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    Date.now = originalDateNow;
  }
}

test("configuration fetch failure is identified as a deployment configuration problem", () => {
  const message = googleStartupMessage(googleStartupError("google-config-network", "private network detail"));
  assert.match(message, /deployment configuration request failed/i);
  assert.doesNotMatch(message, /Google browser libraries/i);
  assert.match(message, /Local preview still works/);
});

test("configuration HTTP status is reported without exposing response content", () => {
  const message = googleStartupMessage(googleStartupError("google-config-http", "private response body", {status: 404}));
  assert.match(message, /HTTP 404/);
  assert.doesNotMatch(message, /private response body/i);
});

test("malformed and incomplete configuration have distinct safe diagnoses", () => {
  assert.match(googleStartupMessage(googleStartupError("google-config-json", "private body")), /not valid JSON/i);
  assert.match(googleStartupMessage(googleStartupError("google-config-invalid", "missing OAuth client id")), /incomplete or invalid/i);
  assert.doesNotMatch(googleStartupMessage(googleStartupError("google-config-invalid", "secret-value")), /secret-value/);
});

test("Google Identity Services and API client failures are identified as library failures", () => {
  const message = googleStartupMessage(googleStartupError("google-libraries-unavailable", "private detail", {
    components: ["Google Identity Services", "Google API client"]
  }));
  assert.match(message, /browser libraries did not load/i);
  assert.match(message, /Google Identity Services, Google API client/);
  assert.match(message, /not a missing deployment configuration/i);
  assert.doesNotMatch(message, /private detail/i);
});

test("Picker initialization failure is distinguished from configuration and base library loading", () => {
  const message = googleStartupMessage(googleStartupError("google-picker-unavailable", "private detail"));
  assert.match(message, /Picker could not initialize/i);
  assert.match(message, /configuration was loaded/i);
  assert.doesNotMatch(message, /private detail/i);
});

test("unknown startup errors fail closed with a generic safe diagnosis", () => {
  const message = googleStartupMessage(new Error("sensitive provider body"));
  assert.match(message, /startup could not be completed/i);
  assert.doesNotMatch(message, /sensitive provider body/i);
});


test("prepare reports a missing deployed config before attempting Google library loading", async () => {
  await withGoogleEnvironment({
    fetchImpl: async () => ({ok:false,status:404}),
    windowImpl: {}
  }, async () => {
    const storage = new DashboardSyntheticStorage();
    await assert.rejects(storage.prepare(), error => error.code === "google-config-http" && error.status === 404);
  });
});

test("prepare reports unavailable Google scripts only after valid deployment config loads", async () => {
  let clockCalls = 0;
  await withGoogleEnvironment({
    fetchImpl: async () => ({ok:true,json:async () => validConfig}),
    windowImpl: {
      setInterval(callback) { const id = {}; queueMicrotask(callback); return id; },
      clearInterval() {}
    },
    now: () => (++clockCalls <= 2 ? 0 : 16001)
  }, async () => {
    const storage = new DashboardSyntheticStorage();
    await assert.rejects(storage.prepare(), error =>
      error.code === "google-libraries-unavailable" &&
      error.components.includes("Google Identity Services") &&
      error.components.includes("Google API client"));
  });
});

test("prepare distinguishes Picker initialization failure after config and base libraries load", async () => {
  await withGoogleEnvironment({
    fetchImpl: async () => ({ok:true,json:async () => validConfig}),
    windowImpl: {
      google: {accounts:{oauth2:{}}},
      gapi: {load(_name, options) { options.onerror(); }},
      setInterval(callback) { const id = {}; queueMicrotask(callback); return id; },
      clearInterval() {}
    }
  }, async () => {
    const storage = new DashboardSyntheticStorage();
    await assert.rejects(storage.prepare(), error => error.code === "google-picker-unavailable");
  });
});
