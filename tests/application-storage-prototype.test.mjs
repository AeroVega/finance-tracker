import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("prototype hub and lifecycle harness keep their module, controls and synthetic guard wired", async () => {
  const hub = await readFile(new URL("../prototype/index.html", import.meta.url), "utf8");
  const page = await readFile(new URL("../prototype/application-storage-lifecycle-test.html", import.meta.url), "utf8");
  const module = await readFile(new URL("../prototype/application-storage-lifecycle-test.mjs", import.meta.url), "utf8");
  assert.match(hub, /href="\.\/application-storage-lifecycle-test\.html"/);
  assert.match(page, /src="application-storage-lifecycle-test\.mjs"/);
  assert.match(module, /ApplicationStorageLifecycle/);
  assert.match(module, /syntheticOnly:\s*true/);
  assert.match(module, /finance-tracker-database/);
  // Keep the harness-specific recovery and cleanup safeguards. Engine tests do
  // not execute this page's glue code. Avoid pinning its private local names.
  assert.match(module, /lifecycle\.state === "ready"/);
  assert.match(module, /lifecycle\.acceptingWrites === true/);
  assert.match(module, /lifecycle\.coordinator\.canWrite === true/);
  assert.match(module, /lifecycle\.engine\.recoveryRequired === false/);
  assert.match(module, /Recovery did not pass final verification/);
  assert.match(module, /inspection\.status !== "absent" && inspection\.status !== "released"/);
  assert.match(module, /snapshot-object.*journal-event.*commit-record/);
  assert.match(page, /id="simulate-crash"/);
  assert.match(page, /id="handoff-status"/);
  const referencedIds = [...module.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  const pageIds = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...new Set(referencedIds)].filter((id) => !pageIds.has(id)), []);
});
