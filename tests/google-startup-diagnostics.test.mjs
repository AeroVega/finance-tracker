import test from "node:test";
import assert from "node:assert/strict";
import { googleStartupError, googleStartupMessage } from "../js/google-startup-diagnostics.mjs";

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
