import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, dashboard, drivePrototype, buildInfo, readme] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../prototype/drive-probe.html", import.meta.url), "utf8"),
  readFile(new URL("../js/build-info.js", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8")
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
  assert.match(workflow, /source_sha.*40/);
  assert.match(workflow, /cat > js\/build-info\.js/);
  assert.match(workflow, /Deploying source commit:/);
  assert.match(buildInfo, /development \(not deployed\)/);
});

test("both deployed pages display the generated source commit", () => {
  assert.match(dashboard, /id="build-sha"/);
  assert.match(dashboard, /src="js\/build-info\.js"/);
  assert.match(drivePrototype, /id="build-sha"/);
  assert.match(drivePrototype, /src="\.\.\/js\/build-info\.js"/);
});

test("README explains shared-URL branch deployment and restoring main", () => {
  assert.match(readme, /single shared deployment/);
  assert.match(readme, /choose the desired branch/);
  assert.match(readme, /restore the stable version/);
});
