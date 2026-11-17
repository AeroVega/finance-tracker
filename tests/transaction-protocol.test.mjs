import test from "node:test";
import assert from "node:assert/strict";
import {canonicalizeJcs,TransactionProtocolError} from "../js/transaction-protocol.mjs";
test("canonicalizes object keys recursively and preserves array order", () => {
  assert.equal(
    canonicalizeJcs({ z: 1, a: { y: true, x: null }, list: [2, 1] }),
    '{"a":{"x":null,"y":true},"list":[2,1],"z":1}'
  );
});

test("rejects values that cannot be represented in canonical JSON", () => {
  assert.throws(() => canonicalizeJcs({ amount: Number.NaN }), (error) =>
    error instanceof TransactionProtocolError && error.code === "invalid-number");
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJcs(cyclic), (error) =>
    error instanceof TransactionProtocolError && error.code === "cyclic-value");
  assert.throws(() => canonicalizeJcs({ absent: undefined }), (error) =>
    error instanceof TransactionProtocolError && error.code === "unsupported-value");
});
