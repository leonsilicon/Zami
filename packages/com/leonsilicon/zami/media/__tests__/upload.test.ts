import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  type FileIo,
  PartsFile,
  fileFromUri,
  isFileSegment,
  setFileIo,
  wholeFileUri,
} from "@-/com.leonsilicon.zami.blob/files";
import {
  cachedEncryptedMedia,
  downloadEncryptedMedia,
  downloadPlainMedia,
  encryptForUpload,
  videoThumbnailFor,
} from "#app";
import { encryptBlob, stripJpeg, type TempFiles, videoThumbnail } from "#upload";
import { fakeNative, settle } from "./helpers.ts";

let fake: ReturnType<typeof fakeNative>;

/** Bytes held in JS, as Zam's code makes them (a blob of bytes, not of a file). */
const bytesBlob = (bytes: number[]) =>
  new PartsFile([new Uint8Array(bytes)], "b") as unknown as Blob;
let temps = 0;
const temp: TempFiles = {
  next: (extension = "") => `file:///tmp/t${temps++}${extension}`,
  remove: (uri) => void fake.files.delete(uri),
};

beforeEach(() => {
  fake = fakeNative();
  fake.files.set(
    "file:///picked/clip.mp4",
    Uint8Array.from({ length: 32 }, (_, i) => i),
  );
  let written = 0;
  const io: FileIo = {
    read: async (uri, offset, length) => fake.native.readRange(uri, offset, length),
    readSync: (uri, offset, length) =>
      (fake.files.get(uri) ?? new Uint8Array()).slice(offset, offset + length),
    size: (uri) => fake.files.get(uri)?.length ?? null,
    async write(segments) {
      const uri = `file:///blob-temp/${written++}`;
      const parts = segments.map((segment) =>
        isFileSegment(segment)
          ? (fake.files.get(segment.uri) ?? new Uint8Array()).slice(
              segment.offset,
              segment.offset + segment.length,
            )
          : segment.bytes,
      );
      fake.files.set(uri, Uint8Array.from(parts.flatMap((part) => [...part])));
      return uri;
    },
    remove: (uri) => void fake.files.delete(uri),
  };
  setFileIo(io);
});

afterEach(() => {
  setFileIo(null);
  delete (globalThis as { expo?: unknown }).expo;
});

describe("encryptBlob", () => {
  test("encrypts a rebuilt picked file from its ranges, with bytes in memory written out first", async () => {
    const picked = fileFromUri("file:///picked/clip.mp4", { type: "video/mp4" });
    // As faststart leaves it: the index moved ahead, rewritten, the media as it was.
    const rebuilt = new PartsFile(
      [picked.slice(0, 4), new Uint8Array([0xee, 0xff]), picked.slice(6)],
      "clip.mp4",
      { type: "video/mp4" },
    );
    const upload = await encryptBlob(fake.native, temp, rebuilt as unknown as Blob);
    expect(upload).not.toBeNull();
    const [call] = fake.encrypted;
    expect(call?.ranges).toEqual([
      { uri: "file:///picked/clip.mp4", offset: 0, length: 4 },
      { uri: "file:///blob-temp/0", offset: 0, length: 2 },
      { uri: "file:///picked/clip.mp4", offset: 6, length: 26 },
    ]);
    // The bytes written out for it are gone once it's encrypted.
    expect(fake.files.has("file:///blob-temp/0")).toBe(false);
    expect(upload?.info).toEqual({
      v: "v2",
      key: {
        kty: "oct",
        alg: "A256CTR",
        ext: true,
        key_ops: ["encrypt", "decrypt"],
        k: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      },
      iv: "AgICAgICAgIAAAAAAAAAAA",
      hashes: { sha256: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM" },
    });
    expect(upload?.ciphertext.type).toBe("application/octet-stream");
    expect(upload?.ciphertext.size).toBe(32);
    expect(wholeFileUri(upload?.ciphertext)).toBe(call?.dest);
    upload?.release();
    expect(fake.files.has(call?.dest ?? "")).toBe(false);
  });

  test("encrypts an in-memory blob through a temporary file", async () => {
    const upload = await encryptBlob(fake.native, temp, bytesBlob([7, 8]));
    expect(fake.encrypted[0]?.ranges).toEqual([
      { uri: "file:///blob-temp/0", offset: 0, length: 2 },
    ]);
    expect(upload?.ciphertext.size).toBe(2);
  });

  test("can't reach React Native's own blobs", async () => {
    expect(await encryptBlob(fake.native, temp, {} as Blob)).toBeNull();
  });
});

describe("videoThumbnail", () => {
  const options = { maxEdge: 800, quality: 0.85, timeoutMs: 50 };

  test("reads the picked file itself and gives a file-backed JPEG", async () => {
    let source = "";
    fake.setThumbnail(async (uri) => {
      source = uri;
    });
    const picked = fileFromUri("file:///picked/clip.mp4", { type: "video/mp4" });
    const thumb = await videoThumbnail(fake.native, temp, picked, options);
    expect(source).toBe("file:///picked/clip.mp4");
    expect(thumb).toMatchObject({ w: 1920, h: 1080, thumbW: 800, thumbH: 450 });
    expect(thumb?.file.type).toBe("image/jpeg");
    expect(thumb?.file.name).toBe("thumbnail.jpg");
    expect(thumb?.file.size).toBe(7);
  });

  test("gives up after the timeout instead of holding the send", async () => {
    fake.setThumbnail(() => new Promise(() => {}));
    const picked = fileFromUri("file:///picked/clip.mp4", { type: "video/mp4" });
    expect(await videoThumbnail(fake.native, temp, picked, options)).toBeNull();
  });

  test("is null for a video it can't read", async () => {
    fake.setThumbnail(async () => {
      throw new Error("No video track");
    });
    const picked = fileFromUri("file:///picked/clip.mp4", { type: "video/mp4" });
    expect(await videoThumbnail(fake.native, temp, picked, options)).toBeNull();
  });
});

describe("stripJpeg", () => {
  test("strips a picked JPEG file to file, keeping its name, type and date", async () => {
    fake.files.set("file:///picked/photo.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 9, 9]));
    const picked = fileFromUri("file:///picked/photo.jpg", {
      type: "image/jpeg",
      lastModified: 7,
    });
    const out = await stripJpeg(fake.native, temp, picked);
    expect(out).not.toBe(picked);
    expect(out?.name).toBe("photo.jpg");
    expect(out?.type).toBe("image/jpeg");
    expect(out?.lastModified).toBe(7);
    expect(out?.size).toBe(3);
    expect(wholeFileUri(out)).toMatch(/^file:\/\/\/tmp\/t\d+\.jpg$/);
  });

  test("gives the file back when the JPEG is left as it is", async () => {
    fake.files.set("file:///picked/plain.jpg", new Uint8Array([0xff, 0xd8, 0, 1]));
    const picked = fileFromUri("file:///picked/plain.jpg", { type: "image/jpeg" });
    expect(await stripJpeg(fake.native, temp, picked)).toBe(picked);
  });

  test("leaves anything but a JPEG to Zam's code, reading only its signature", async () => {
    const picked = fileFromUri("file:///picked/clip.mp4", { type: "video/mp4" });
    let called = false;
    const native = {
      ...fake.native,
      stripJpeg: async () => {
        called = true;
        return "notJpeg" as const;
      },
    };
    expect(await stripJpeg(native, temp, picked)).toBeNull();
    expect(called).toBe(false);
  });
});

describe("without the native module", () => {
  test("every entry point says so, so Zam's JS path runs", () => {
    const file = {
      url: "mxc://s/m",
      key: { k: "A".repeat(43) },
      iv: "A".repeat(22),
      hashes: { sha256: "A".repeat(43) },
    };
    const download = {
      account: "@a:s",
      url: "https://s/x",
      headers: {},
      httpError: () => new Error(),
    };
    expect(downloadEncryptedMedia(file, ".jpg", download)).toBeNull();
    expect(downloadPlainMedia({ ...download, extension: () => "" })).toBeNull();
    expect(cachedEncryptedMedia("@a:s", file)).toBeNull();
    expect(encryptForUpload(bytesBlob([]))).toBeNull();
    expect(videoThumbnailFor(bytesBlob([]))).toBeNull();
  });

  test("with it, a cached download comes back at once by its event's file", async () => {
    (globalThis as { expo?: unknown }).expo = { modules: { ZamiMedia: fake.native } };
    const file = {
      url: "mxc://s/m",
      key: { k: "A".repeat(43) },
      iv: "A".repeat(22),
      hashes: { sha256: "A".repeat(43) },
    };
    const download = {
      account: "@a:s",
      url: "https://s/_matrix/client/v1/media/download/s/m",
      headers: {},
      httpError: () => new Error(),
    };
    const result = downloadEncryptedMedia(file, ".png", download);
    await settle();
    expect(fake.pending[0]?.request).toMatchObject({
      key: `${"A".repeat(43)}=`,
      iv: `${"A".repeat(22)}==`,
      sha256: `${"A".repeat(43)}=`,
    });
    fake.pending[0]?.finish();
    const uri = await result;
    expect(uri).toMatch(/^file:\/\/\/cache\/media\/[0-9a-f]{16}\/e[0-9a-f]{32}\.png$/);
    expect(cachedEncryptedMedia("@a:s", file)).toBe(uri);
    // Another account's cache is its own.
    expect(cachedEncryptedMedia("@b:s", file)).toBeNull();
  });
});
