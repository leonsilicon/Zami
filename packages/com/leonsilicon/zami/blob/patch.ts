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
import {
  PartsBlob,
  PartsFile,
  fileIo,
  isPartsBlob,
  isPartsFile,
  partsSegments,
  readSegments,
  readSegmentsSync,
  wholeFileUri,
  type FileIo,
  type Segment,
} from "#parts";

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
  addEventListener?: (this: NativeXMLHttpRequest, type: string, listener: () => void) => void;
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
/** The object URL store of the last patched host, for `createObjectURLAsync`. */
let installedUrls: ObjectUrls | null = null;
/** In-memory blobs from this size are written off the JS thread by `createObjectURLAsync`. */
export const ASYNC_OBJECT_URL_MIN_BYTES = 1024 * 1024;

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
  installedUrls = urls;
  const { Blob: NativeBlob, File: NativeFile, FileReader } = host;

  /** What `parts` make: a native blob (some are, the rest are strings), a file-backed
   *  one (some are), or else an in-memory one. */
  function buildKind(
    parts: readonly unknown[],
    constructor: string,
  ): "native" | "parts" | "memory" {
    let native = false;
    let memory = false;
    let files = false;
    for (const part of parts) {
      if (part instanceof NativeBlob) native = true;
      else if (isPartsBlob(part)) files = true;
      else if (isMemoryBlob(part) || isBufferSource(part)) memory = true;
    }
    if (native && (memory || files)) throw mixedParts(constructor);
    if (native) return "native";
    return files ? "parts" : "memory";
  }

  // Plain functions, since one can return either kind. `Blob.prototype` is what both
  // kinds' prototypes inherit from, so `instanceof Blob` and `Blob.prototype.isPrototypeOf`
  // (whatwg-fetch's check) hold for both.
  function Blob(parts?: unknown, options?: unknown): object {
    const list = partList(parts, "Blob");
    const kind = buildKind(list, "Blob");
    if (kind === "native") return new NativeBlob(list, options);
    return kind === "parts" ? new PartsBlob(list, options) : new MemoryBlob(list, options);
  }
  Blob.prototype = BaseBlob.prototype;
  Object.setPrototypeOf(NativeBlob.prototype, BaseBlob.prototype);

  function File(parts: unknown, name: unknown, options?: unknown): object {
    const list = partList(parts, "File");
    const kind = buildKind(list, "File");
    if (kind === "native") return new NativeFile(list, String(name), options);
    return kind === "parts"
      ? new PartsFile(list, name, options)
      : new MemoryFile(list, name, options);
  }
  File.prototype = MemoryFile.prototype;
  Object.defineProperty(File, Symbol.hasInstance, {
    value: (value: unknown) =>
      isMemoryFile(value) || isPartsFile(value) || value instanceof NativeFile,
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

/**
 * `URL.createObjectURL(blob)`, but a big in-memory blob's file is written off the JS
 * thread, and the URL comes once it's there. Revoke it with `URL.revokeObjectURL`.
 */
export async function createObjectURLAsync(blob: Blob): Promise<string> {
  const bytes = memoryBytes(blob);
  if (!bytes || bytes.byteLength < ASYNC_OBJECT_URL_MIN_BYTES || !installedUrls?.createAsync) {
    return URL.createObjectURL(blob);
  }
  const named = isMemoryFile(blob) ? blob.name : undefined;
  return installedUrls.createAsync(bytes, blob.type, named);
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

  // A file-backed blob's bytes arrive from its files, after this returns.
  function readParts(
    reader: NativeFileReader,
    method: string,
    segments: readonly Segment[],
    as: (bytes: Uint8Array<ArrayBuffer>) => unknown,
  ): void {
    const readId = reader._startRead(method);
    const settle = (fill: () => void) => {
      // Aborted, or another read started since.
      if (readId !== reader._readId) return;
      try {
        fill();
      } catch (error) {
        reader._error = reader._toDOMException(error);
      }
      reader._setReadyState(DONE);
    };
    readSegments(segments).then(
      (bytes) =>
        settle(() => {
          reader._result = as(bytes);
        }),
      (error: unknown) =>
        settle(() => {
          throw error;
        }),
    );
  }

  /** Reads an in-memory or file-backed blob; false for anything else. */
  function readOwn(
    reader: NativeFileReader,
    method: string,
    blob: unknown,
    as: (bytes: Uint8Array<ArrayBuffer>) => unknown,
  ): boolean {
    const bytes = memoryBytes(blob);
    if (bytes) {
      readMemory(reader, method, bytes, as);
      return true;
    }
    const segments = partsSegments(blob);
    if (!segments) return false;
    readParts(reader, method, segments, as);
    return true;
  }

  proto.readAsArrayBuffer = function (blob) {
    if (!readOwn(this, "readAsArrayBuffer", blob, (held) => held.slice().buffer)) {
      readAsArrayBuffer.call(this, blob);
    }
  };
  proto.readAsDataURL = function (blob) {
    const own = isMemoryBlob(blob) || isPartsBlob(blob);
    const type = (own && blob.type) || "application/octet-stream";
    const asUrl = (held: Uint8Array) => `data:${type};base64,${encodeBase64(held)}`;
    if (!readOwn(this, "readAsDataURL", blob, asUrl)) readAsDataURL.call(this, blob);
  };
  proto.readAsText = function (blob, encoding) {
    const asText = (held: Uint8Array) => new TextDecoder(encoding).decode(held);
    if (!readOwn(this, "readAsText", blob, asText)) readAsText.call(this, blob, encoding);
  };
}

/** In-memory bodies from this size go through a file: React Native base64-encodes bytes in JS. */
export const FILE_BODY_MIN_BYTES = 256 * 1024;

/**
 * XMLHttpRequest sends an in-memory blob's bytes (React Native's sends a typed array as
 * base64), and a file-backed blob that is all of one file from that file (`{ uri }`,
 * which React Native's networking reads natively). matrix-js-sdk uploads through it, and
 * fetch (whatwg-fetch) sends through it. A rebuilt file-backed blob, or a big in-memory
 * one, is written to a temporary file off the JS thread first, and the request goes out
 * once it's there.
 */
function patchXMLHttpRequest(proto: NativeXMLHttpRequest): void {
  const { send } = proto;
  proto.send = function (body) {
    const bytes = memoryBytes(body);
    const segments = partsSegments(body);
    if (!bytes && !segments) return send.call(this, body);
    // As a browser does: a blob's type is the Content-Type unless one was set.
    const { type } = body as MemoryBlob | PartsBlob;
    if (type && this._headers && this._headers["content-type"] === undefined) {
      this.setRequestHeader("Content-Type", type);
    }
    const uri = wholeFileUri(body);
    if (uri !== undefined) return send.call(this, { uri });
    const files = bodyFiles(bytes);
    if (!files) return send.call(this, bytes ?? readSegmentsSync(segments ?? []));
    sendThroughFile(this, send, files, segments ?? [{ bytes: bytes! }]);
  };
}

/** The file access to send a body through a temporary file, or null to send its bytes. */
function bodyFiles(bytes: Uint8Array | undefined): FileIo | null {
  if (bytes && bytes.byteLength < FILE_BODY_MIN_BYTES) return null;
  try {
    return fileIo();
  } catch {
    return null;
  }
}

function sendThroughFile(
  request: NativeXMLHttpRequest,
  send: NativeXMLHttpRequest["send"],
  files: FileIo,
  segments: readonly Segment[],
): void {
  // React Native's own send runs once the file is there. An abort() before then leaves
  // the request unopened, so that send throws and nothing goes out.
  const sendNow = (body: unknown, cleanup?: () => void) => {
    try {
      send.call(request, body);
    } catch {
      cleanup?.();
    }
  };
  files.write(segments).then(
    (temp) => {
      const remove = () => files.remove(temp);
      request.addEventListener?.("loadend", remove);
      sendNow({ uri: temp }, remove);
    },
    // No file: send the bytes, as before.
    () => void readSegments(segments).then((held) => sendNow(held)),
  );
}

/**
 * `URL.createObjectURL` of an in-memory blob gives `urls`' URL; native blobs keep theirs.
 * A file-backed blob that is all of one file (a picked file) gives that file's URI, with
 * nothing copied (revoking it does nothing); a rebuilt one is read and written out.
 */
function patchObjectUrls(url: BlobHost["URL"], urls: ObjectUrls): void {
  const { createObjectURL, revokeObjectURL } = url;
  url.createObjectURL = (object) => {
    const whole = wholeFileUri(object);
    if (whole !== undefined) return whole;
    const segments = partsSegments(object);
    const bytes = memoryBytes(object) ?? (segments && readSegmentsSync(segments));
    if (!bytes) return createObjectURL.call(url, object);
    const { type } = object as MemoryBlob;
    const named = isMemoryFile(object) || isPartsFile(object);
    return urls.create(bytes, type, named ? object.name : undefined);
  };
  url.revokeObjectURL = (objectUrl) => {
    if (!urls.revoke(String(objectUrl))) revokeObjectURL.call(url, objectUrl);
  };
}
