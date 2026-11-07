import { describe, expect, test } from "vite-plus/test";
import { MemoryBlob, MemoryFile, isMemoryBlob, memoryBytes } from "#memory";
import type { ObjectUrls } from "#object-urls";
import { type BlobHost, type NativeBlob, type NativeFileReader, patchBlobs } from "#patch";

const encoder = new TextEncoder();
const EMPTY = 0;
const LOADING = 1;
const DONE = 2;

/**
 * Stand-ins for React Native's globals, shaped like the real ones: a Blob that refuses
 * bytes and has no read methods, a FileReader with React Native's internals that reads
 * "natively" (later, from the stand-in's private store), an XMLHttpRequest that records
 * what it sends, and Expo's URL with its blob: object URLs.
 */
function reactNative() {
  const nativeStore = new WeakMap<object, Uint8Array>();

  class Blob {
    closed = false;
    readonly #type: string;
    constructor(parts: unknown[] = [], options?: { type?: string }) {
      const chunks = parts.map((part) => {
        if (part instanceof ArrayBuffer || ArrayBuffer.isView(part)) {
          throw new Error(
            "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported",
          );
        }
        return part instanceof Blob
          ? (nativeStore.get(part) ?? new Uint8Array())
          : encoder.encode(String(part));
      });
      const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      nativeStore.set(this, bytes);
      this.#type = options?.type ?? "";
    }
    get size() {
      return nativeStore.get(this)?.length ?? 0;
    }
    get type() {
      return this.#type;
    }
  }

  class File extends Blob {
    readonly name: string;
    constructor(parts: unknown[], name: string, options?: { type?: string }) {
      super(parts, options);
      this.name = name;
    }
  }

  class FileReader implements NativeFileReader {
    _readyState = EMPTY;
    _readId = 0;
    _result: unknown = null;
    _error: unknown = null;
    _aborted = false;
    events: string[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    get result() {
      return this._result;
    }
    get error() {
      return this._error;
    }
    _startRead(method: string) {
      if (this._readyState === LOADING)
        throw new Error(`${method}: The object is already busy reading Blobs.`);
      this._aborted = false;
      this._error = null;
      this._result = null;
      const readId = ++this._readId;
      this._setReadyState(LOADING);
      return readId;
    }
    _setReadyState(state: number) {
      this._readyState = state;
      if (state === LOADING) this.events.push("loadstart");
      if (state !== DONE) return;
      if (this._aborted) this.events.push("abort");
      else if (this._error) {
        this.events.push("error");
        this.onerror?.();
      } else {
        this.events.push("load");
        this.onload?.();
      }
      this.events.push("loadend");
    }
    _toDOMException(error: unknown) {
      return error instanceof Error ? error : new Error(String(error));
    }
    #readNatively(method: string, blob: unknown, as: (bytes: Uint8Array) => unknown) {
      const readId = this._startRead(method);
      setTimeout(() => {
        if (readId !== this._readId) return;
        const bytes = blob instanceof Blob && !blob.closed ? nativeStore.get(blob) : undefined;
        if (bytes) this._result = as(bytes);
        else this._error = new Error("The specified blob is invalid");
        this._setReadyState(DONE);
      }, 1);
    }
    readAsArrayBuffer(blob: unknown) {
      this.#readNatively("readAsArrayBuffer", blob, (bytes) => bytes.slice().buffer);
    }
    readAsDataURL(blob: unknown) {
      this.#readNatively("readAsDataURL", blob, (bytes) => `data:native;${bytes.length}`);
    }
    readAsText(blob: unknown) {
      this.#readNatively("readAsText", blob, (bytes) => new TextDecoder().decode(bytes));
    }
    abort() {
      if (this._readyState !== LOADING) return;
      this._aborted = true;
      this._readId++;
      this._setReadyState(DONE);
    }
  }

  class XMLHttpRequest {
    _headers: Record<string, string> = {};
    sent: unknown[] = [];
    setRequestHeader(name: string, value: string) {
      this._headers[name.toLowerCase()] = value;
    }
    send(body?: unknown) {
      this.sent.push(body);
    }
  }

  const revokedNatively: string[] = [];
  let nativeUrls = 0;
  class URL {
    static createObjectURL(blob: unknown) {
      if (!(blob instanceof Blob))
        throw new TypeError("Cannot read property 'blobId' of undefined");
      return `blob:native-${nativeUrls++}`;
    }
    static revokeObjectURL(url: string) {
      revokedNatively.push(url);
    }
  }

  const created = new Map<string, { bytes: number[]; type: string; name?: string }>();
  const urls: ObjectUrls = {
    create(bytes, type, name) {
      const url = `file:///cache/${created.size}`;
      created.set(url, { bytes: [...bytes], type, name });
      return url;
    },
    revoke: (url) => created.delete(url),
  };

  const native = { Blob, File, FileReader, XMLHttpRequest, URL };
  const host = { ...native } as unknown as BlobHost;
  patchBlobs(host, urls);
  return { host, native, created, revokedNatively, urls };
}

/** A Blob as Zam's code types it, whichever kind it is. */
type AnyBlob = NativeBlob & {
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  slice(start?: number, end?: number): AnyBlob;
  name?: string;
};

function blobs(host: BlobHost) {
  return {
    Blob: host.Blob as unknown as new (parts?: unknown[], options?: { type?: string }) => AnyBlob,
    File: host.File as unknown as new (
      parts: unknown[],
      name: string,
      options?: { type?: string; lastModified?: number },
    ) => AnyBlob,
  };
}

function read(reader: NativeFileReader & { events?: string[] }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error as Error);
  });
}

describe("Blob and File", () => {
  test("build in-memory blobs from bytes, strings and in-memory blobs", async () => {
    const { host } = reactNative();
    const { Blob, File } = blobs(host);
    const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const encrypted = new Blob([ciphertext], { type: "application/octet-stream" });
    expect(isMemoryBlob(encrypted)).toBe(true);
    expect(encrypted.size).toBe(4);
    expect([...(await encrypted.bytes())]).toEqual([...ciphertext]);
    const file = new File([encrypted, "!"], "upload.bin", { type: "application/x" });
    expect(file).toBeInstanceOf(MemoryFile);
    expect(file.name).toBe("upload.bin");
    expect(await file.text()).toBe(new TextDecoder().decode(new Uint8Array([...ciphertext, 33])));
    expect(isMemoryBlob(new Blob())).toBe(true);
    expect(isMemoryBlob(new Blob(["just text"]))).toBe(true);
  });

  test("build React Native's own blob from native blobs and strings", async () => {
    const { host, native } = reactNative();
    const { Blob, File } = blobs(host);
    const response = new native.Blob(["from the network"]);
    const copy = new Blob([response, "!"], { type: "text/plain" });
    expect(copy).toBeInstanceOf(native.Blob);
    expect(await copy.text()).toBe("from the network!");
    const file = new File([response], "response.txt");
    expect(file).toBeInstanceOf(native.File);
    expect(file.name).toBe("response.txt");
  });

  test("refuse a native blob mixed with bytes or in-memory blobs, saying what to do", () => {
    const { host, native } = reactNative();
    const { Blob, File } = blobs(host);
    const response = new native.Blob(["native"]);
    expect(() => new Blob([response, new Uint8Array([1])])).toThrow(/await blob\.arrayBuffer\(\)/);
    expect(() => new Blob([new Blob([new Uint8Array([1])]), response])).toThrow(TypeError);
    expect(() => new File([response, new ArrayBuffer(2)], "mixed")).toThrow(/construct 'File'/);
  });

  test("instanceof and Blob.prototype.isPrototypeOf hold for both kinds", () => {
    const { host, native } = reactNative();
    const { Blob, File } = blobs(host);
    const nativeBlob = new native.Blob(["n"]);
    const nativeFile = new native.File(["n"], "n.txt");
    const memoryBlob = new Blob([new Uint8Array(1)]);
    const memoryFile = new File([new Uint8Array(1)], "m.bin");
    for (const blob of [nativeBlob, nativeFile, memoryBlob, memoryFile]) {
      expect(blob).toBeInstanceOf(Blob);
      expect(Blob.prototype.isPrototypeOf(blob)).toBe(true);
    }
    expect(nativeFile).toBeInstanceOf(File);
    expect(memoryFile).toBeInstanceOf(File);
    expect(nativeBlob).not.toBeInstanceOf(File);
    expect(memoryBlob).not.toBeInstanceOf(File);
    // React Native's own checks (its XMLHttpRequest, its Blob's parts) still see only its blobs.
    expect(memoryBlob).not.toBeInstanceOf(native.Blob);
    expect(nativeBlob).not.toBeInstanceOf(MemoryBlob);
    expect(Object.prototype.toString.call(nativeBlob)).toBe("[object Blob]");
    expect(Object.prototype.toString.call(nativeFile)).toBe("[object File]");
    expect(Object.prototype.toString.call(memoryFile)).toBe("[object File]");
  });

  test("patching again changes nothing", () => {
    const { host, urls } = reactNative();
    const { Blob } = host;
    patchBlobs(host, urls);
    expect(host.Blob).toBe(Blob);
  });
});

describe("React Native's Blob", () => {
  test("reads with arrayBuffer(), bytes() and text(), through its FileReader", async () => {
    const { native } = reactNative();
    const blob = new native.Blob(["héllo"]) as unknown as AnyBlob;
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe("héllo");
    const bytes = await blob.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([...encoder.encode("héllo")]);
    expect(await blob.text()).toBe("héllo");
  });

  test("rejects a read of a released blob with the reader's error", async () => {
    const { native } = reactNative();
    const blob = new native.Blob(["gone"]);
    blob.closed = true;
    await expect((blob as unknown as AnyBlob).arrayBuffer()).rejects.toThrow(
      "The specified blob is invalid",
    );
  });
});

describe("FileReader", () => {
  test("reads an in-memory blob as React Native reads a native one", async () => {
    const { host } = reactNative();
    const { Blob } = blobs(host);
    const blob = new Blob([new Uint8Array([104, 105, 0xff])], { type: "Image/PNG" });

    const buffers = new host.FileReader() as NativeFileReader & { events: string[] };
    const buffer = read(buffers);
    buffers.readAsArrayBuffer(blob);
    expect(buffers.result).toBe(null);
    expect([...new Uint8Array((await buffer) as ArrayBuffer)]).toEqual([104, 105, 0xff]);
    expect(buffers.events).toEqual(["loadstart", "load", "loadend"]);

    const urls = new host.FileReader();
    const url = read(urls);
    urls.readAsDataURL(blob);
    expect(await url).toBe("data:image/png;base64,aGn/");

    const untyped = new host.FileReader();
    const untypedUrl = read(untyped);
    untyped.readAsDataURL(new Blob([new Uint8Array([1])]));
    expect(await untypedUrl).toBe("data:application/octet-stream;base64,AQ==");

    const texts = new host.FileReader();
    const text = read(texts);
    texts.readAsText(new Blob([new Uint8Array([0x68, 0x00, 0x69, 0x00])]), "utf-16le");
    expect(await text).toBe("hi");
  });

  test("still reads native blobs natively", async () => {
    const { host, native } = reactNative();
    const reader = new host.FileReader();
    const result = read(reader);
    reader.readAsText(new native.Blob(["native text"]));
    expect(await result).toBe("native text");
  });

  test("abort() before the result arrives stops it, and a busy reader refuses a second read", async () => {
    const { host } = reactNative();
    const { Blob } = blobs(host);
    const reader = new host.FileReader() as NativeFileReader & { events: string[]; abort(): void };
    let loaded = false;
    reader.onload = () => {
      loaded = true;
    };
    reader.readAsArrayBuffer(new Blob(["x"]));
    expect(() => reader.readAsText(new Blob(["y"]))).toThrow(/busy/);
    reader.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(loaded).toBe(false);
    expect(reader.result).toBe(null);
    expect(reader.events).toEqual(["loadstart", "abort", "loadend"]);
  });

  test("reports a decoding failure as the read's error", async () => {
    const { host } = reactNative();
    const { Blob } = blobs(host);
    const reader = new host.FileReader();
    const result = read(reader);
    reader.readAsText(new Blob(["x"]), "no-such-encoding");
    await expect(result).rejects.toThrow(RangeError);
  });
});

describe("XMLHttpRequest", () => {
  type Request = InstanceType<ReturnType<typeof reactNative>["native"]["XMLHttpRequest"]>;

  test("sends an in-memory blob's bytes, typed by the blob unless a type was set", () => {
    const { host, native } = reactNative();
    const { Blob, File } = blobs(host);
    const typed = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

    const request = new native.XMLHttpRequest() as Request;
    request.send(typed);
    const [body] = request.sent;
    expect(body).toBeInstanceOf(Uint8Array);
    expect([...(body as Uint8Array)]).toEqual([1, 2, 3]);
    expect(body).toBe(memoryBytes(typed));
    expect(request._headers["content-type"]).toBe("image/png");

    // matrix-js-sdk sets the type itself.
    const upload = new native.XMLHttpRequest() as Request;
    upload.setRequestHeader("Content-Type", "application/octet-stream");
    upload.send(typed.slice(1));
    expect([...(upload.sent[0] as Uint8Array)]).toEqual([2, 3]);
    expect(upload._headers["content-type"]).toBe("application/octet-stream");

    const untyped = new native.XMLHttpRequest() as Request;
    untyped.send(new Blob(["x"]));
    expect(untyped._headers["content-type"]).toBe(undefined);
  });

  test("sends anything else as React Native does", () => {
    const { native } = reactNative();
    const request = new native.XMLHttpRequest() as Request;
    const nativeBlob = new native.Blob(["n"]);
    const bytes = new Uint8Array([1]);
    request.send("text");
    request.send(nativeBlob);
    request.send(bytes);
    request.send();
    expect(request.sent).toEqual(["text", nativeBlob, bytes, undefined]);
    expect(request._headers).toEqual({});
  });
});

describe("URL.createObjectURL", () => {
  test("gives an in-memory blob a URL from the object URL store", () => {
    const { host, created } = reactNative();
    const { Blob, File } = blobs(host);
    const image = new Blob([new Uint8Array([9, 8])], { type: "image/webp" });
    const url = host.URL.createObjectURL(image);
    expect(created.get(url)).toEqual({ bytes: [9, 8], type: "image/webp", name: undefined });
    const voice = host.URL.createObjectURL(new File(["ogg"], "voice.ogg"));
    expect(created.get(voice)?.name).toBe("voice.ogg");
    expect(host.URL.createObjectURL(image)).not.toBe(url);
  });

  test("leaves native blobs (and anything else) to the original", () => {
    const { host, native, created } = reactNative();
    expect(host.URL.createObjectURL(new native.Blob(["n"]))).toBe("blob:native-0");
    expect(() => host.URL.createObjectURL({})).toThrow(TypeError);
    expect(created.size).toBe(0);
  });

  test("revokeObjectURL releases its own URLs and passes on the rest", () => {
    const { host, created, revokedNatively } = reactNative();
    const { Blob } = blobs(host);
    const url = host.URL.createObjectURL(new Blob(["x"]));
    host.URL.revokeObjectURL(url);
    expect(created.has(url)).toBe(false);
    expect(revokedNatively).toEqual([]);
    host.URL.revokeObjectURL("blob:native-0");
    expect(revokedNatively).toEqual(["blob:native-0"]);
  });
});
