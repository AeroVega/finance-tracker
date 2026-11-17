// Shared canonical JSON/hash primitives; obsolete journal storage protocol removed.
export class TransactionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransactionProtocolError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TransactionProtocolError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
      fail("invalid-unicode", "Canonical JSON cannot contain unpaired UTF-16 surrogates.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid-number", "Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    fail("unsupported-value", "Canonical JSON supports only objects, arrays, strings, finite numbers, booleans, and null.");
  }
  if (seen.has(value)) fail("cyclic-value", "Canonical JSON cannot contain cyclic values.");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = "[" + value.map((item) => canonicalValue(item, seen)).join(",") + "]";
  } else {
    if (!isPlainObject(value)) fail("unsupported-object", "Canonical JSON requires plain objects.");
    const keys = Object.keys(value).sort();
    result = "{" + keys.map((key) => {
      const item = value[key];
      if (item === undefined) fail("unsupported-value", "Canonical JSON cannot contain undefined object values.");
      return JSON.stringify(key) + ":" + canonicalValue(item, seen);
    }).join(",") + "}";
  }
  seen.delete(value);
  return result;
}

/** RFC 8785-style canonical serialization for JSON-compatible plain data. */
export function canonicalizeJcs(value) {
  return canonicalValue(value, new Set());
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    fail("crypto-unavailable", "Web Crypto SHA-256 is unavailable.");
  }
  const bytes = new TextEncoder().encode(String(value));
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
