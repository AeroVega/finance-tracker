import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("prototype hub links to the PR24 application lifecycle harness", async () => {
  const hub = await readFile(new URL("../prototype/index.html", import.meta.url), "utf8");
  const page = await readFile(new URL("../prototype/application-storage-lifecycle-test.html", import.meta.url), "utf8");
  const module = await readFile(new URL("../prototype/application-storage-lifecycle-test.mjs", import.meta.url), "utf8");
  assert.match(hub, /href="\.\/application-storage-lifecycle-test\.html"/);
  assert.match(page, /src="application-storage-lifecycle-test\.mjs"/);
  assert.match(module, /ApplicationStorageLifecycle/);
  assert.match(module, /syntheticOnly:\s*true/);
  assert.match(module, /finance-tracker-database/);
  assert.match(module, /startsWith\("pr24-"\)/);
});
