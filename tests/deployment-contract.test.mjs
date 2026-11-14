import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, dashboard, acceptanceCenter, buildInfo] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../prototype/acceptance.html", import.meta.url), "utf8"),
  readFile(new URL("../js/build-info.js", import.meta.url), "utf8")
]);

test("Pages deploys main on push and supports manual branch deployments", () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ref:\s*\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
});

test("deployment stamps the checked-out source commit into the artifact", () => {
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /\[0-9a-f\]\{40\}/);
  assert.match(workflow, /cat > js\/build-info\.js/);
  assert.match(workflow, /Deploying source commit:/);
  assert.match(buildInfo, /development \(not deployed\)/);
});

test("workspace and acceptance center display the generated source commit", () => {
  assert.match(dashboard, /id="build-sha"/);
  assert.match(dashboard, /src="js\/build-info\.js"/);
  assert.match(acceptanceCenter, /id="build-sha"/);
  assert.match(acceptanceCenter, /src="\.\.\/js\/build-info\.js"/);
});
