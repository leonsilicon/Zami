/** What WebCrypto takes bytes as. */
export type BufferSource = ArrayBuffer | ArrayBufferView;

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

/**
 * A copy of the bytes in a BufferSource. WebCrypto copies its inputs when it's called, so
 * changing them before its promise settles doesn't change the result.
 */
export function copyBytes(value: unknown, what: string): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(value)) {
    if (!isArrayBuffer(value.buffer)) throw new TypeError(`${what} is a view of shared memory`);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (isArrayBuffer(value)) return new Uint8Array(value.slice(0));
  throw new TypeError(`${what} is not an ArrayBuffer, a TypedArray or a DataView`);
}

/** WebCrypto's results are ArrayBuffers that hold exactly the result. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  return isArrayBuffer(buffer) && byteOffset === 0 && byteLength === buffer.byteLength
    ? buffer
    : bytes.slice().buffer;
}
