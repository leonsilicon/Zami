import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { MemoryBlob } from "#memory";
import type { ObjectUrls } from "#object-urls";
import {
  type FileIo,
  PartsBlob,
  PartsFile,
  blobSegments,
  fileFromUri,
  fileSegments,
  isFileSegment,
  isPartsBlob,
  partsSegments,
  setFileIo,
  wholeFileUri,
} from "#parts";
import { type BlobHost, FILE_BODY_MIN_BYTES, patchBlobs } from "#patch";

/** A file system in a map, counting what is read from it. */
function fakeDisk(files: Record<string, Uint8Array>) {
  const disk = new Map<string, Uint8Array>(Object.entries(files));
  const reads: { uri: string; offset: number; length: number }[] = [];
  let temps = 0;
  const io: FileIo = {
    async read(uri, offset, length) {
      return io.readSync(uri, offset, length);
    },
    readSync(uri, offset, length) {
      const bytes = disk.get(uri);
      if (!bytes) throw new Error(`No such file: ${uri}`);
      reads.push({ uri, offset, length });
      return bytes.slice(offset, offset + length);
    },
    size: (uri) => disk.get(uri)?.length ?? null,
    async write(segments) {
      const uri = `file:///tmp/${temps++}`;
      const parts = await Promise.all(
        segments.map((segment) =>
          isFileSegment(segment)
            ? io.read(segment.uri, segment.offset, segment.length)
            : Promise.resolve(segment.bytes),
        ),
      );
      disk.set(uri, Uint8Array.from(parts.flatMap((part) => [...part])));
      return uri;
    },
    remove: (uri) => void disk.delete(uri),
  };
  return { disk, reads, io, bytesRead: () => reads.reduce((sum, read) => sum + read.length, 0) };
}

const range = (length: number, from = 0) => Uint8Array.from({ length }, (_, i) => (from + i) % 256);

/** React Native's globals as far as these tests need them, patched. */
function host() {
  class NativeBlob {
    size = 0;
    type = "";
  }
  class NativeFile extends NativeBlob {}
  class XMLHttpRequest {
    _headers: Record<string, string> = {};
    sent: unknown[] = [];
    listeners: Record<string, (() => void)[]> = {};
    setRequestHeader(name: string, value: string) {
      this._headers[name.toLowerCase()] = value;
    }
    send(body?: unknown) {
      this.sent.push(body);
    }
    addEventListener(type: string, listener: () => void) {
      (this.listeners[type] ??= []).push(listener);
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
  const patched = {
    Blob: NativeBlob,
    File: NativeFile,
    FileReader: class {},
    XMLHttpRequest,
    URL: { createObjectURL: () => "blob:native", revokeObjectURL: () => {} },
  } as unknown as BlobHost & { XMLHttpRequest: typeof XMLHttpRequest };
  patchBlobs(patched, urls);
  return {
    host: patched,
    created,
    Blob: patched.Blob as unknown as new (parts?: unknown[], options?: BlobPropertyBag) => Blob,
    File: patched.File as unknown as new (
      parts: unknown[],
      name: string,
      options?: FilePropertyBag,
    ) => File,
    XMLHttpRequest,
    NativeBlob,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let disk: ReturnType<typeof fakeDisk>;

beforeEach(() => {
  disk = fakeDisk({ "file:///picked/clip.mp4": range(64), "file:///picked/b.bin": range(8, 200) });
  setFileIo(disk.io);
});

afterEach(() => setFileIo(null));

describe("fileFromUri", () => {
  test("is a File of the whole file, read from disk only when asked", async () => {
    const { File, Blob } = host();
    const file = fileFromUri("file:///picked/clip.mp4", { type: "Video/MP4", lastModified: 5 });
    expect(file).toBeInstanceOf(File);
    expect(file).toBeInstanceOf(Blob);
    expect(file).toBeInstanceOf(PartsFile);
    expect(file.name).toBe("clip.mp4");
    expect(file.type).toBe("video/mp4");
    expect(file.lastModified).toBe(5);
    expect(file.size).toBe(64);
    expect(file.uri).toBe("file:///picked/clip.mp4");
    expect(Object.prototype.toString.call(file)).toBe("[object File]");
    expect(disk.reads).toEqual([]);
    expect([...(await file.bytes())]).toEqual([...range(64)]);
    expect(await new PartsBlob([file.slice(0, 3)]).text()).toBe("\u0000\u0001\u0002");
  });

  test("takes the size from the file over the picker's, and refuses a missing file", () => {
    expect(fileFromUri("file:///picked/b.bin", { size: 999 }).size).toBe(8);
    expect(() => fileFromUri("file:///nowhere")).toThrow(/Can't read the file/);
    setFileIo(null);
    expect(fileFromUri("file:///elsewhere/x.bin", { size: 3 }).size).toBe(3);
  });
});

describe("slicing and rebuilding", () => {
  test("slices and rebuilds read only the ranges they cover", async () => {
    const { File } = host();
    const file = fileFromUri("file:///picked/clip.mp4");
    const head = file.slice(0, 16);
    expect([...new Uint8Array(await head.arrayBuffer())]).toEqual([...range(16)]);
    expect(disk.bytesRead()).toBe(16);

    // As Zam's faststart rewrites an MP4: the index moved ahead of the media.
    const patchedIndex = new Uint8Array([0xaa, 0xbb]);
    const out = new File([file.slice(0, 8), patchedIndex, file.slice(8, 62)], "clip.mp4", {
      type: "video/mp4",
    });
    expect(isPartsBlob(out)).toBe(true);
    expect(out.size).toBe(64);
    expect(wholeFileUri(out)).toBeUndefined();
    expect([...(await out.bytes())]).toEqual([...range(8), 0xaa, 0xbb, ...range(54, 8)]);

    // Renaming keeps the file itself.
    const renamed = new File([file], "renamed.mp4", { type: file.type });
    expect(renamed.name).toBe("renamed.mp4");
    expect(wholeFileUri(renamed)).toBe("file:///picked/clip.mp4");
    // Adjacent ranges of one file join up again.
    expect(partsSegments(new File([file.slice(0, 10), file.slice(10)], "x"))).toHaveLength(1);
    expect(wholeFileUri(new File([file.slice(0, 10), file.slice(10)], "x"))).toBe(
      "file:///picked/clip.mp4",
    );
  });

  test("strings join in, and a native blob can't be mixed in", () => {
    const { Blob, NativeBlob } = host();
    const file = fileFromUri("file:///picked/b.bin");
    expect(new Blob([file, "!"]).size).toBe(9);
    expect(() => new Blob([file, new NativeBlob()])).toThrow(TypeError);
  });

  test("blobSegments covers both kinds", () => {
    const file = fileFromUri("file:///picked/b.bin");
    expect(blobSegments(file)).toEqual([
      { uri: "file:///picked/b.bin", offset: 0, length: 8, fileSize: 8 },
    ]);
    const memory = new MemoryBlob([new Uint8Array([1, 2])]);
    expect(blobSegments(memory)).toEqual([{ bytes: new Uint8Array([1, 2]) }]);
    expect(blobSegments({})).toBeUndefined();
  });

  test("fileSegments writes in-memory segments to temporary files and releases them", async () => {
    const { File } = host();
    const file = fileFromUri("file:///picked/b.bin");
    const rebuilt = new File([file.slice(0, 2), new Uint8Array([9]), file.slice(6)], "r");
    const written = await fileSegments(partsSegments(rebuilt) ?? []);
    expect(written.segments.map((segment) => segment.uri)).toEqual([
      "file:///picked/b.bin",
      "file:///tmp/0",
      "file:///picked/b.bin",
    ]);
    expect(disk.disk.has("file:///tmp/0")).toBe(true);
    written.release();
    expect(disk.disk.has("file:///tmp/0")).toBe(false);
  });
});

describe("Zam's MP4 rewrite on a picked file", () => {
  /** A box: a 32-bit size, a type, and a body. */
  const box = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    return out;
  };
  const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

  test("reads the headers and the index, never the media", async () => {
    const { File, Blob } = host();
    const media = new Uint8Array(1_000_000).fill(7);
    const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\0"));
    const mdat = box("mdat", media);
    // One chunk, at the start of the media: an stco inside moov/trak/mdia/minf/stbl.
    const stco = box("stco", join(new Uint8Array(4), new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0])));
    new DataView(stco.buffer).setUint32(16, ftyp.length + 8);
    const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", stco)))));
    disk.disk.set("file:///picked/slow.mp4", join(ftyp, mdat, moov));

    const realFile = globalThis.File;
    const realBlob = globalThis.Blob;
    globalThis.File = File as unknown as typeof globalThis.File;
    globalThis.Blob = Blob as unknown as typeof globalThis.Blob;
    try {
      // The Zami version of Zam's own MP4 rewrite, run as the app runs it.
      // oxlint-disable-next-line flatcap/no-workspace-import-bypass
      const { faststartMp4 } = await import("../../../../../../src/lib/utils/mp4Faststart.zami");
      const picked = fileFromUri("file:///picked/slow.mp4", { type: "video/mp4" });
      const out = await faststartMp4(picked);
      expect(out).not.toBe(picked);
      expect(out.size).toBe(picked.size);
      // Box headers and the index: a few hundred bytes of a megabyte.
      expect(disk.bytesRead()).toBeLessThan(1000);
      const bytes = await out.bytes();
      expect(new TextDecoder().decode(bytes.subarray(ftyp.length + 4, ftyp.length + 8))).toBe(
        "moov",
      );
    } finally {
      globalThis.File = realFile;
      globalThis.Blob = realBlob;
    }
  });
});

describe("with React Native's globals", () => {
  type Request = InstanceType<ReturnType<typeof host>["XMLHttpRequest"]>;

  test("URL.createObjectURL gives a picked file's own URI, and writes a rebuilt one out", () => {
    const { host: patched, created, File } = host();
    const file = fileFromUri("file:///picked/b.bin", { type: "image/png" });
    expect(patched.URL.createObjectURL(file)).toBe("file:///picked/b.bin");
    expect(created.size).toBe(0);
    patched.URL.revokeObjectURL("file:///picked/b.bin");
    expect(disk.disk.has("file:///picked/b.bin")).toBe(true);

    const rebuilt = new File([file.slice(0, 2), "!"], "r.png", { type: "image/png" });
    const url = patched.URL.createObjectURL(rebuilt);
    expect(created.get(url)).toEqual({ bytes: [200, 201, 33], type: "image/png", name: "r.png" });
  });

  test("XMLHttpRequest sends a picked file from its file, typed by it", () => {
    const { XMLHttpRequest } = host();
    const request = new XMLHttpRequest() as Request;
    request.send(fileFromUri("file:///picked/clip.mp4", { type: "video/mp4" }));
    expect(request.sent).toEqual([{ uri: "file:///picked/clip.mp4" }]);
    expect(request._headers["content-type"]).toBe("video/mp4");
    expect(disk.reads).toEqual([]);
  });

  test("XMLHttpRequest sends a rebuilt or big in-memory blob through a temporary file", async () => {
    const { XMLHttpRequest, File, Blob } = host();
    const file = fileFromUri("file:///picked/clip.mp4");
    const rebuilt = new XMLHttpRequest() as Request;
    rebuilt.setRequestHeader("Content-Type", "application/octet-stream");
    rebuilt.send(new File([file.slice(0, 4), new Uint8Array([1])], "x"));
    expect(rebuilt.sent).toEqual([]);
    await flush();
    expect(rebuilt.sent).toEqual([{ uri: "file:///tmp/0" }]);
    expect([...(disk.disk.get("file:///tmp/0") ?? [])]).toEqual([0, 1, 2, 3, 1]);
    for (const listener of rebuilt.listeners.loadend ?? []) listener();
    expect(disk.disk.has("file:///tmp/0")).toBe(false);

    const big = new XMLHttpRequest() as Request;
    big.send(new Blob([new Uint8Array(FILE_BODY_MIN_BYTES)]));
    await flush();
    expect(big.sent).toEqual([{ uri: "file:///tmp/1" }]);

    const small = new XMLHttpRequest() as Request;
    small.send(new Blob([new Uint8Array(3)]));
    expect(small.sent[0]).toBeInstanceOf(Uint8Array);
  });
});
