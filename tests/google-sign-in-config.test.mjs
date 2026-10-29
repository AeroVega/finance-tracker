import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, page, script, config, setupDocs] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  readFile(new URL("../prototype/drive-probe.html", import.meta.url), "utf8"),
  readFile(new URL("../prototype/drive-probe.mjs", import.meta.url), "utf8"),
  readFile(new URL("../js/google-config.js", import.meta.url), "utf8"),
  readFile(new URL("../docs/GOOGLE_CLOUD_SETUP.md", import.meta.url), "utf8")
]);

test("deployment injects public Google configuration without printing its values", () => {
  assert.match(workflow, /GOOGLE_OAUTH_CLIENT_ID:\s*\$\{\{ vars\.GOOGLE_OAUTH_CLIENT_ID \}\}/);
  assert.match(workflow, /GOOGLE_PICKER_API_KEY:\s*\$\{\{ vars\.GOOGLE_PICKER_API_KEY \}\}/);
  assert.match(workflow, /js\/google-config\.js/);
  assert.match(workflow, /clientId: process\.env\.GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(workflow, /apiKey: process\.env\.GOOGLE_PICKER_API_KEY/);
  assert.match(workflow, /console\.log\("Google configuration present:"/);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*config\.clientId/);
  assert.match(config, /projectNumber: "863907870950"/);
});

test("Drive prototype uses deployment configuration rather than credential input fields", () => {
  assert.match(page, /id="connect-google"/);
  assert.match(page, /Continue with Google/);
  assert.doesNotMatch(page, /id="oauth-client-id"/);
  assert.doesNotMatch(page, /id="picker-api-key"/);
  assert.doesNotMatch(page, /id="cloud-project-number"/);
  assert.match(script, /import \{ GOOGLE_CONFIG \} from "\.\.\/js\/google-config\.js"/);
  assert.match(script, /tokenClient\.requestAccessToken\(\{ prompt: "select_account" \}\)/);
  assert.match(script, /\.setDeveloperKey\(config\.apiKey\)/);
  assert.match(script, /\.setAppId\(config\.projectNumber\)/);
  assert.match(script, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
});

test("setup documentation explains the one-time repository-variable configuration", () => {
  assert.match(setupDocs, /GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(setupDocs, /GOOGLE_PICKER_API_KEY/);
  assert.match(setupDocs, /public browser configuration values, not secrets/);
  assert.match(setupDocs, /select the branch you intend to test/);
});
