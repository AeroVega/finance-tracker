// Buffer.slice() aliases its input, unlike Uint8Array.slice(). Copy through the
// typed-array constructor so byte ownership never depends on a subtype method.
// Capture resizable buffers before any await, size admission, or hashing.
const typedArrayBuffer = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "buffer").get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;

export function copyOwnedBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Byte content must be a Uint8Array.");
  // Inspect internal backing storage, not an overridable .buffer property or a
  // realm-specific SharedArrayBuffer constructor. The ArrayBuffer getter rejects
  // shared buffers even when that constructor is unavailable in this realm.
  try { arrayBufferByteLength.call(typedArrayBuffer.call(bytes)); }
  catch {
    throw new TypeError("Shared byte buffers are not supported.");
  }
  return new Uint8Array(bytes);
}
