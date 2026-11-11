import { describe, expect, test } from "vite-plus/test";
import {
  Base64FormatError,
  aesCtrInPieces,
  counterAfter,
  decodeBase64Lines,
  encodeBase64Lines,
  encodeUtf8InPieces,
} from "#key-file";

function bytes(n: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const oneShotBase64 = (b: Uint8Array) => {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s);
};

describe("encodeBase64Lines", () => {
  test.each([0, 1, 2, 3, 71, 72, 73, 7199, 7200, 7201, 100_003])(
    "%i bytes: the one-shot base64 in 96-character lines",
    async (n) => {
      const b = bytes(n);
      const text = await encodeBase64Lines(b, 96);
      const lines = text.split("\n");
      expect(lines.pop()).toBe("");
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(96);
      for (const line of lines.slice(0, -1)) expect(line.length).toBe(96);
      expect(lines.join("")).toBe(oneShotBase64(b));
    },
  );
});

describe("decodeBase64Lines", () => {
  test("decodes lines back, with CRLF and text around the range", async () => {
    const b = bytes(300_001, 7);
    const lines = (await encodeBase64Lines(b, 96)).replace(/\n/g, "\r\n");
    const text = `before\n${lines}after`;
    const start = "before\n".length;
    const out = await decodeBase64Lines(text, start, start + lines.length);
    expect(out).toEqual(b);
  });

  test("decodes one long line, and unpadded tails as atob does", async () => {
    const b = bytes(200_000, 3);
    expect(await decodeBase64Lines(oneShotBase64(b))).toEqual(b);
    expect(await decodeBase64Lines("QUJD")).toEqual(new Uint8Array([65, 66, 67]));
    expect(await decodeBase64Lines("QUI=")).toEqual(new Uint8Array([65, 66]));
  });

  test("rejects what atob rejects", async () => {
    await expect(decodeBase64Lines("!!!")).rejects.toBeInstanceOf(Base64FormatError);
    await expect(decodeBase64Lines("QUJDR")).rejects.toBeInstanceOf(Base64FormatError);
    // Padding in the middle of a long text.
    const long = `QUI=${"A".repeat(200_000)}`;
    await expect(decodeBase64Lines(long)).rejects.toBeInstanceOf(Base64FormatError);
  });
});

describe("encodeUtf8InPieces", () => {
  test("encodes as one TextEncoder call, never splitting a surrogate pair", async () => {
    const text = `${"a".repeat(5)}\u{1F510}é${"b".repeat(3)}\u{1F511}`;
    const whole = new TextEncoder().encode(text);
    for (const piece of [2, 3, 5, 6, 7, 1000])
      expect(await encodeUtf8InPieces(text, piece)).toEqual(whole);
    expect(await encodeUtf8InPieces("")).toEqual(new Uint8Array(0));
  });
});

describe("aesCtrInPieces", () => {
  const subtle = globalThis.crypto.subtle;
  async function key() {
    return subtle.importKey("raw", bytes(32, 9), { name: "AES-CTR" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  test("counterAfter adds to the low 64 bits and wraps them alone", () => {
    const iv = new Uint8Array(16).fill(0);
    iv[0] = 0xaa;
    iv[15] = 0xff;
    expect([...counterAfter(iv, 1)].slice(14)).toEqual([1, 0]);
    const top = new Uint8Array(16);
    top[0] = 0x11;
    top.fill(0xff, 8);
    const wrapped = counterAfter(top, 2);
    expect(wrapped[0]).toBe(0x11);
    expect([...wrapped.subarray(8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  test.each([
    ["an ordinary counter", 0x00],
    ["a counter about to wrap", 0xff],
  ])("matches one WebCrypto call for %s", async (_name, fill) => {
    const k = await key();
    const iv = bytes(16, 5);
    iv.fill(fill, 8, 15);
    for (const n of [0, 15, 16, 17, 1000, 70_000]) {
      const data = bytes(n, 11);
      const one = new Uint8Array(
        await subtle.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, k, data),
      );
      const pieces = await aesCtrInPieces(subtle, "encrypt", k, iv, data, 4096);
      expect(pieces).toEqual(one);
      expect(await aesCtrInPieces(subtle, "decrypt", k, iv, pieces, 1024)).toEqual(data);
    }
  });
});
