// Teaches a React Native global scope in-memory Blobs, and React Native's own Blob to be
// read. It takes the classes it patches from `host` (React Native's globals in the app,
// stand-ins in the tests), so nothing here imports React Native.
import { encodeBase64 } from "#base64";
import {
  BaseBlob,
  MemoryBlob,
  MemoryFile,
  isBufferSource,
  isMemoryBlob,
  isMemoryFile,
  memoryBytes,
  partList,
} from "#memory";
import type { ObjectUrls } from "#object-urls";

/** React Native's Blob: a handle to bytes its native modules hold. */
export interface NativeBlob {
  readonly size: number;
  readonly type: string;
}

export type NativeBlobClass = new (parts?: unknown[], options?: unknown) => NativeBlob;
export type NativeFileClass = new (parts: unknown[], name: string, options?: unknown) => NativeBlob;

/**
 * React Native's FileReader (Libraries/Blob/FileReader.js), with the internals its read
 * methods share: an in-memory blob is read as a native one is, minus the native call.
 */
export interface NativeFileReader {
  readonly result: unknown;
  readonly error: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsArrayBuffer: (this: NativeFileReader, blob: unknown) => void;
  readAsDataURL: (this: NativeFileReader, blob: unknown) => void;
  readAsText: (this: NativeFileReader, blob: unknown, encoding?: string) => void;
  _readId: number;
  _result: unknown;
  _error: unknown;
  _startRead: (this: NativeFileReader, method: string) => number;
  _setReadyState: (this: NativeFileReader, state: number) => void;
  _toDOMException: (this: NativeFileReader, error: unknown) => unknown;
}

/** React Native's XMLHttpRequest, which keeps its request headers in `_headers`. */
export interface NativeXMLHttpRequest {
  _headers?: Record<string, string>;
  send: (this: NativeXMLHttpRequest, body?: unknown) => void;
  setRequestHeader: (this: NativeXMLHttpRequest, name: string, value: string) => void;
}

/** The globals this patches: React Native's (and Expo's `URL`) in the app. */
export interface BlobHost {
  Blob: NativeBlobClass;
  File: NativeFileClass;
  FileReader: { prototype: NativeFileReader; new (): NativeFileReader };
  XMLHttpRequest: { prototype: NativeXMLHttpRequest };
  URL: {
    createObjectURL: (object: unknown) => string;
    revokeObjectURL: (url: string) => void;
  };
}

const DONE = 2;
const decoder = new TextDecoder();
const patched = new WeakSet<object>();

function mixedParts(constructor: string): TypeError {
  return new TypeError(
    `Failed to construct '${constructor}': React Native's native Blobs (from its XMLHttpRequest, WebSocket or fetch) can't be combined with bytes or in-memory Blobs, since their bytes can only be read asynchronously. Read the native Blob first: new ${constructor}([await blob.arrayBuffer(), …]).`,
  );
}

function defineMethod(target: object, name: PropertyKey, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

/**
 * Makes `host`'s Blob and File build in-memory blobs from bytes, and every Blob readable
 * (`arrayBuffer()`, `bytes()`, `text()`), uploadable (XMLHttpRequest, and so fetch) and
 * loadable (`URL.createObjectURL`, through `urls`). Patching a host twice does nothing.
 */
export function patchBlobs(host: BlobHost, urls: ObjectUrls): void {
  if (patched.has(host)) return;
  patched.add(host);
  const { Blob: NativeBlob, File: NativeFile, FileReader } = host;

  /** Whether `parts` make a native blob: some are, and the rest are strings. */
  function isNativeBuild(parts: readonly unknown[], constructor: string): boolean {
    let native = false;
    let memory = false;
    for (const part of parts) {
      if (part instanceof NativeBlob) native = true;
      else if (isMemoryBlob(part) || isBufferSource(part)) memory = true;
    }
    if (native && memory) throw mixedParts(constructor);
    return native;
  }

  // Plain functions, since one can return either kind. `Blob.prototype` is what both
  // kinds' prototypes inherit from, so `instanceof Blob` and `Blob.prototype.isPrototypeOf`
  // (whatwg-fetch's check) hold for both.
  function Blob(parts?: unknown, options?: unknown): object {
    const list = partList(parts, "Blob");
    return isNativeBuild(list, "Blob")
      ? new NativeBlob(list, options)
      : new MemoryBlob(list, options);
  }
  Blob.prototype = BaseBlob.prototype;
  Object.setPrototypeOf(NativeBlob.prototype, BaseBlob.prototype);

  function File(parts: unknown, name: unknown, options?: unknown): object {
    const list = partList(parts, "File");
    return isNativeBuild(list, "File")
      ? new NativeFile(list, String(name), options)
      : new MemoryFile(list, name, options);
  }
  File.prototype = MemoryFile.prototype;
  Object.defineProperty(File, Symbol.hasInstance, {
    value: (value: unknown) => isMemoryFile(value) || value instanceof NativeFile,
  });
  if (!Object.hasOwn(NativeFile.prototype, Symbol.toStringTag)) {
    Object.defineProperty(NativeFile.prototype, Symbol.toStringTag, {
      get: () => "File",
      configurable: true,
    });
  }

  // React Native's Blob has no read methods; its FileReader reads one (through base64).
  function readNative(blob: NativeBlob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read the Blob"));
      reader.readAsArrayBuffer(blob);
    });
  }
  const nativeReads: Record<string, (this: NativeBlob) => Promise<unknown>> = {
    arrayBuffer() {
      return readNative(this);
    },
    async bytes() {
      return new Uint8Array(await readNative(this));
    },
    async text() {
      return decoder.decode(await readNative(this));
    },
  };
  for (const [name, read] of Object.entries(nativeReads)) {
    if (typeof (NativeBlob.prototype as Record<string, unknown>)[name] !== "function") {
      defineMethod(NativeBlob.prototype, name, read);
    }
  }

  patchFileReader(FileReader.prototype);
  patchXMLHttpRequest(host.XMLHttpRequest.prototype);
  patchObjectUrls(host.URL, urls);

  for (const [name, value] of [
    ["Blob", Blob],
    ["File", File],
  ] as const) {
    Object.defineProperty(host, name, { value, writable: true, configurable: true });
  }
}

/** FileReader's reads of an in-memory blob: React Native's, with the bytes at hand. */
function patchFileReader(proto: NativeFileReader): void {
  const { readAsArrayBuffer, readAsDataURL, readAsText } = proto;

  function readMemory(
    reader: NativeFileReader,
    method: string,
    bytes: Uint8Array<ArrayBuffer>,
    as: (bytes: Uint8Array<ArrayBuffer>) => unknown,
  ): void {
    const readId = reader._startRead(method);
    // Like React Native's native read, the result arrives after this returns.
    void Promise.resolve().then(() => {
      // Aborted, or another read started since.
      if (readId !== reader._readId) return;
      try {
        reader._result = as(bytes);
      } catch (error) {
        reader._error = reader._toDOMException(error);
      }
      reader._setReadyState(DONE);
    });
  }

  proto.readAsArrayBuffer = function (blob) {
    const bytes = memoryBytes(blob);
    if (!bytes) return readAsArrayBuffer.call(this, blob);
    readMemory(this, "readAsArrayBuffer", bytes, (held) => held.slice().buffer);
  };
  proto.readAsDataURL = function (blob) {
    const bytes = memoryBytes(blob);
    if (!bytes) return readAsDataURL.call(this, blob);
    const type = (blob as MemoryBlob).type || "application/octet-stream";
    readMemory(this, "readAsDataURL", bytes, (held) => `data:${type};base64,${encodeBase64(held)}`);
  };
  proto.readAsText = function (blob, encoding) {
    const bytes = memoryBytes(blob);
    if (!bytes) return readAsText.call(this, blob, encoding);
    readMemory(this, "readAsText", bytes, (held) => new TextDecoder(encoding).decode(held));
  };
}

/**
 * XMLHttpRequest sends an in-memory blob's bytes (React Native's sends a typed array as
 * base64). matrix-js-sdk uploads through it, and fetch (whatwg-fetch) sends through it.
 */
function patchXMLHttpRequest(proto: NativeXMLHttpRequest): void {
  const { send } = proto;
  proto.send = function (body) {
    const bytes = memoryBytes(body);
    if (!bytes) return send.call(this, body);
    // As a browser does: a blob's type is the Content-Type unless one was set.
    const { type } = body as MemoryBlob;
    if (type && this._headers && this._headers["content-type"] === undefined) {
      this.setRequestHeader("Content-Type", type);
    }
    return send.call(this, bytes);
  };
}

/** `URL.createObjectURL` of an in-memory blob gives `urls`' URL; native blobs keep theirs. */
function patchObjectUrls(url: BlobHost["URL"], urls: ObjectUrls): void {
  const { createObjectURL, revokeObjectURL } = url;
  url.createObjectURL = (object) => {
    const bytes = memoryBytes(object);
    if (!bytes) return createObjectURL.call(url, object);
    const { type } = object as MemoryBlob;
    return urls.create(bytes, type, isMemoryFile(object) ? object.name : undefined);
  };
  url.revokeObjectURL = (objectUrl) => {
    if (!urls.revoke(String(objectUrl))) revokeObjectURL.call(url, objectUrl);
  };
}
