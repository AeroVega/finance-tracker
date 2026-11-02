import test from "node:test";
import assert from "node:assert/strict";
import { createStorageDiagnostics } from "../js/storage-diagnostics.mjs";

test("diagnostics retain only bounded allowlisted lifecycle fields", () => {
  const trace = createStorageDiagnostics({ limit: 2, now: () => 0 });
  trace.record({ event: "release-click", isTrusted: true, token: "private-token", fileId: "private-file", message: "private-error", state: "private-state", reason: "private-reason" });
  assert.deepEqual(trace.snapshot(), [{ sequence: 1, time: "1970-01-01T00:00:00.000Z", event: "release-click", isTrusted: true }]);
  trace.record({ event: "pagehide", persisted: true, visibility: "hidden", state: "ready" });
  trace.record({ event: "release-request", reason: "pagehide", state: "releasing" });
  trace.record({ event: "private-event", message: "private" });
  assert.deepEqual(trace.snapshot().map((entry) => entry.sequence), [2, 3]);
  assert.doesNotMatch(trace.format("private-build"), /private/);
  assert.match(trace.format("a".repeat(40)), /Source commit: a{40}/);
  const snapshot = trace.snapshot();
  snapshot[0].event = "modified";
  assert.equal(trace.snapshot()[0].event, "pagehide");
});

test("invalid limits cannot create an unbounded trace", () => {
  for (const limit of [0, 101, Infinity, 1.5]) assert.throws(() => createStorageDiagnostics({ limit }));
});
