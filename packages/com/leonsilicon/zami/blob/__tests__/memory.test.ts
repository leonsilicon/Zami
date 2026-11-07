import { describe, expect, test } from "vite-plus/test";
import {
  BaseBlob,
  MemoryBlob,
  MemoryFile,
  fromBytes,
  isMemoryBlob,
  isMemoryFile,
  memoryBytes,
  normalizeType,
  sliceRange,
} from "#memory";

// Node's own Blob and File, which ours should match.
const NodeBlob = globalThis.Blob;
const NodeFile = globalThis.File;

async function bytesOf(blob: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

/** Builds the same blob both ways and checks they agree. */
async function expectSameAsNode(parts: unknown[], options?: BlobPropertyBag): Promise<MemoryBlob> {
  const ours = new MemoryBlob(parts, options);
  const theirs = new NodeBlob(parts as BlobPart[], options);
  expect(ours.size).toBe(theirs.size);
  expect(ours.type).toBe(theirs.type);
  expect(await bytesOf(ours)).toEqual(await bytesOf(theirs));
  expect(await ours.text()).toBe(await theirs.text());
  return ours;
}

describe("constructing", () => {
  test("from strings, as UTF-8 (lone surrogates becoming U+FFFD)", async () => {
    await expectSameAsNode([]);
    await expectSameAsNode([""]);
    await expectSameAsNode(["hello"]);
    await expectSameAsNode(["héllo ", "🙂", " 日本"]);
    await expectSameAsNode(["\ud800x", "y\udc00"]);
  });

  test("from ArrayBuffers and views, reading only a view's own bytes", async () => {
    const buffer = Uint8Array.from({ length: 32 }, (_, i) => i * 7).buffer;
    await expectSameAsNode([buffer]);
    await expectSameAsNode([new Uint8Array(buffer, 3, 5)]);
    await expectSameAsNode([new Uint16Array(buffer, 4, 6)]);
    await expectSameAsNode([new DataView(buffer, 9, 11)]);
    await expectSameAsNode([new Float64Array([1.5, -2, Number.NaN])]);
    await expectSameAsNode([new Uint8Array(0)]);
  });

  test("from other blobs and a mix of parts", async () => {
    const inner = new MemoryBlob(["inner", new Uint8Array([0, 255])]);
    const ours = new MemoryBlob(["a", inner, new Uint8Array([1, 2]), "z"]);
    const theirs = new NodeBlob([
      "a",
      new NodeBlob(["inner", new Uint8Array([0, 255])]),
      new Uint8Array([1, 2]),
      "z",
    ]);
    expect(ours.size).toBe(theirs.size);
    expect(await bytesOf(ours)).toEqual(await bytesOf(theirs));
  });

  test("anything else is converted to a string", async () => {
    await expectSameAsNode([123, null, undefined, { toString: () => "custom" }, {}, true]);
  });

  test("normalizes the type: lowercase, or empty with a character outside U+0020–U+007E", async () => {
    for (const type of ["Text/Plain", "image/PNG; charset=X", "", "ü/x", "a\u0019b", "a\u007fb"]) {
      await expectSameAsNode(["x"], { type });
    }
    expect(normalizeType("IMAGE/Webp")).toBe("image/webp");
    expect(normalizeType("tab\there")).toBe("");
  });

  test("converts line endings with endings: native, and rejects unknown endings", async () => {
    await expectSameAsNode(["a\r\nb\rc\nd"], { endings: "native" });
    await expectSameAsNode(["a\r\nb\rc\nd"], { endings: "transparent" });
    const bad = { endings: "unix" } as unknown as BlobPropertyBag;
    expect(() => new MemoryBlob(["x"], bad)).toThrow(TypeError);
    expect(() => new NodeBlob(["x"], bad)).toThrow(TypeError);
  });

  test("rejects parts that aren't a sequence, as Node does", () => {
    for (const parts of ["abc", 5, {}, null]) {
      expect(() => new MemoryBlob(parts)).toThrow(TypeError);
      expect(() => new NodeBlob(parts as BlobPart[])).toThrow(TypeError);
    }
    expect(new MemoryBlob(new Set(["a", "b"])).size).toBe(2);
  });

  test("copies its parts: changing them later changes nothing", async () => {
    const source = new Uint8Array([1, 2, 3]);
    const blob = new MemoryBlob([source]);
    source[0] = 99;
    expect(await bytesOf(blob)).toEqual([1, 2, 3]);
    const view = new MemoryBlob([new Uint8Array([4, 5]), source.subarray(1)]);
    source[1] = 99;
    expect(await bytesOf(view)).toEqual([4, 5, 2, 3]);
  });

  test("shares the bytes of a single blob part instead of copying them", () => {
    const blob = new MemoryBlob([new Uint8Array([1, 2, 3])]);
    expect(memoryBytes(new MemoryFile([blob], "copy"))).toBe(memoryBytes(blob));
    expect(memoryBytes(new MemoryBlob([blob, blob]))).not.toBe(memoryBytes(blob));
  });

  test("keeps size and type on its prototype, as accessors, like a browser's", () => {
    const blob = new MemoryBlob(["abc"], { type: "text/plain" });
    expect(Object.keys(blob)).toEqual([]);
    expect(Object.assign({}, blob)).toEqual({});
    expect(Object.prototype.toString.call(blob)).toBe("[object Blob]");
    expect(blob).toBeInstanceOf(BaseBlob);
  });
});

describe("reading", () => {
  test("arrayBuffer() and bytes() give copies", async () => {
    const blob = new MemoryBlob([new Uint8Array([1, 2, 3])]);
    const buffer = await blob.arrayBuffer();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    new Uint8Array(buffer)[0] = 42;
    const bytes = await blob.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
    bytes[1] = 42;
    expect(await bytesOf(blob)).toEqual([1, 2, 3]);
  });

  test("text() decodes UTF-8 as Node does: BOM dropped, bad bytes replaced", async () => {
    await expectSameAsNode([new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])]);
    await expectSameAsNode([new Uint8Array([0x68, 0xff, 0xc3, 0x69, 0xe2, 0x82])]);
  });

  test("reads of a non-blob reject instead of throwing", async () => {
    const notABlob = {};
    await expect(MemoryBlob.prototype.arrayBuffer.call(notABlob)).rejects.toThrow(TypeError);
    await expect(MemoryBlob.prototype.bytes.call(notABlob)).rejects.toThrow(TypeError);
    await expect(MemoryBlob.prototype.text.call(notABlob)).rejects.toThrow(TypeError);
  });
});

describe("slicing", () => {
  const content = "0123456789";
  const indexes = [
    undefined,
    0,
    1,
    3,
    9,
    10,
    11,
    100,
    -1,
    -3,
    -10,
    -11,
    -100,
    Number.NaN,
    Infinity,
    -Infinity,
  ];

  test("resolves every start and end as Node does", async () => {
    const ours = new MemoryBlob([content]);
    const theirs = new NodeBlob([content]);
    for (const start of indexes) {
      for (const end of indexes) {
        const slice = ours.slice(start, end);
        const expected = theirs.slice(start, end);
        expect([start, end, await slice.text()]).toEqual([start, end, await expected.text()]);
        expect(slice.size).toBe(expected.size);
      }
    }
  });

  test("rounds fractional indexes, ties to even ([Clamp] long long)", () => {
    expect(sliceRange(10, 1.4)).toEqual([1, 10]);
    expect(sliceRange(10, 1.6)).toEqual([2, 10]);
    expect(sliceRange(10, 2.5)).toEqual([2, 10]);
    expect(sliceRange(10, 3.5)).toEqual([4, 10]);
    expect(sliceRange(10, -2.5, 8.5)).toEqual([8, 8]);
  });

  test("gives a Blob (never a File) of the content type, normalized", async () => {
    const file = new MemoryFile([content], "digits.txt", { type: "text/plain" });
    const slice = file.slice(2, 5, "Text/HTML");
    expect(isMemoryFile(slice)).toBe(false);
    expect(isMemoryBlob(slice)).toBe(true);
    expect(slice.type).toBe("text/html");
    expect(file.slice(2, 5).type).toBe("");
    expect(await slice.text()).toBe("234");
    expect(await slice.slice(1).text()).toBe("34");
    expect(await slice.slice(-1).text()).toBe("4");
  });

  test("shares the bytes of the blob it slices", () => {
    const blob = new MemoryBlob([new Uint8Array([1, 2, 3, 4])]);
    expect(memoryBytes(blob.slice(1, 3))?.buffer).toBe(memoryBytes(blob)?.buffer);
  });
});

describe("File", () => {
  test("has a name, a lastModified and a type, as Node's", async () => {
    const ours = new MemoryFile(["abc"], "a/b.txt", { type: "Text/Plain", lastModified: 1234 });
    const theirs = new NodeFile(["abc"], "a/b.txt", { type: "Text/Plain", lastModified: 1234 });
    expect([ours.name, ours.lastModified, ours.type, ours.size]).toEqual([
      theirs.name,
      theirs.lastModified,
      theirs.type,
      theirs.size,
    ]);
    expect(await ours.text()).toBe("abc");
    expect(ours.webkitRelativePath).toBe("");
    expect(Object.prototype.toString.call(ours)).toBe("[object File]");
    expect(ours).toBeInstanceOf(MemoryBlob);
  });

  test("defaults lastModified to now, and converts what it's given", () => {
    const before = Date.now();
    const file = new MemoryFile([], "x", { lastModified: undefined });
    expect(file.lastModified).toBeGreaterThanOrEqual(before);
    expect(file.lastModified).toBeLessThanOrEqual(Date.now());
    // A `long long`, as browsers convert it (Node's File keeps the fraction).
    expect(new MemoryFile([], "x", { lastModified: 12.9 }).lastModified).toBe(12);
    expect(new MemoryFile([], "x", { lastModified: -3.5 }).lastModified).toBe(-3);
    expect(new MemoryFile([], "x", { lastModified: Number.NaN }).lastModified).toBe(0);
    expect(new MemoryFile([], 42).name).toBe("42");
  });

  test("needs a name", () => {
    expect(() => new MemoryFile([], undefined)).toThrow(TypeError);
  });

  test("can be built from bytes, slices and files, as metadata stripping does", async () => {
    const original = new MemoryFile([new Uint8Array([1, 2, 3, 4, 5, 6])], "photo.jpg", {
      type: "image/jpeg",
      lastModified: 7,
    });
    const patched = new MemoryFile(
      [original.slice(0, 2), new Uint8Array([9, 9]), original.slice(4)],
      original.name,
      { type: original.type, lastModified: original.lastModified },
    );
    expect(await bytesOf(patched)).toEqual([1, 2, 9, 9, 5, 6]);
    expect([patched.name, patched.type, patched.lastModified]).toEqual([
      "photo.jpg",
      "image/jpeg",
      7,
    ]);
  });

  test("accepts own properties assigned onto it, as Zami's picked files get", async () => {
    const file = Object.assign(new MemoryFile(["abc"], "a.txt"), {
      uri: "file:///a.txt",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    });
    expect(file.uri).toBe("file:///a.txt");
    expect((await file.arrayBuffer()).byteLength).toBe(1);
    expect(await file.text()).toBe("abc");
  });
});

test("fromBytes keeps the bytes it's given", () => {
  const bytes = new Uint8Array([1, 2]);
  const blob = fromBytes(bytes, "Application/X");
  expect(memoryBytes(blob)).toBe(bytes);
  expect(blob.type).toBe("application/x");
});
