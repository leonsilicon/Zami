// qrPayload reads the data codewords the native modules hand over. Here qrcode encodes a
// symbol, its data codewords are built as qrcode builds them (createData, from its own
// segment writers), and the payload qrPayload reads from them must be what jsQR reads
// from the symbol's picture: jsQR is what the scanner used before, and still uses where
// the app lacks the native module.
import { createRequire } from "node:module";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { describe, expect, test } from "vite-plus/test";
import { qrPayload, qrPayloads } from "#qr-payload";

const require = createRequire(import.meta.url);

interface BitBuffer {
  buffer: number[];
  put(value: number, bits: number): void;
  putBit(bit: boolean | number): void;
  getLengthInBits(): number;
}
interface Segment {
  mode: { bit: number };
  getLength(): number;
  write(buffer: BitBuffer): void;
}
const BitBuffer = require("qrcode/lib/core/bit-buffer") as new () => BitBuffer;
const Mode = require("qrcode/lib/core/mode") as {
  getCharCountIndicator(mode: unknown, version: number): number;
};
const Utils = require("qrcode/lib/core/utils") as {
  getSymbolTotalCodewords(version: number): number;
};
const ECCode = require("qrcode/lib/core/error-correction-code") as {
  getTotalCodewordsCount(version: number, level: unknown): number;
};

type Input = Parameters<typeof QRCode.create>[0];

/** A symbol: its picture's modules, and its data codewords as qrcode's createData makes them. */
function symbol(input: Input, errorCorrectionLevel: "L" | "M" | "Q" | "H" = "M") {
  const qr = QRCode.create(input, { errorCorrectionLevel }) as unknown as {
    version: number;
    errorCorrectionLevel: unknown;
    segments: Segment[];
    modules: { size: number; get(row: number, col: number): number | boolean };
  };
  const buffer = new BitBuffer();
  for (const segment of qr.segments) {
    buffer.put(segment.mode.bit, 4);
    buffer.put(segment.getLength(), Mode.getCharCountIndicator(segment.mode, qr.version));
    segment.write(buffer);
  }
  const dataBits =
    (Utils.getSymbolTotalCodewords(qr.version) -
      ECCode.getTotalCodewordsCount(qr.version, qr.errorCorrectionLevel)) *
    8;
  if (buffer.getLengthInBits() + 4 <= dataBits) buffer.put(0, 4);
  while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(0);
  for (let i = 0; buffer.getLengthInBits() < dataBits; i++) buffer.put(i % 2 ? 0x11 : 0xec, 8);
  return { version: qr.version, codewords: buffer.buffer, modules: qr.modules };
}

/** What jsQR reads from the symbol drawn plainly, `scale` pixels a module. */
function jsQRPayload(modules: ReturnType<typeof symbol>["modules"], scale = 3): number[] | null {
  const quiet = 4;
  const side = (modules.size + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / scale) - quiet;
      const col = Math.floor(x / scale) - quiet;
      if (row < 0 || col < 0 || row >= modules.size || col >= modules.size) continue;
      if (!modules.get(row, col)) continue;
      const at = (y * side + x) * 4;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = 0;
    }
  }
  return jsQR(rgba, side, side, { inversionAttempts: "dontInvert" })?.binaryData ?? null;
}

/** A Matrix verification payload: "MATRIX", version, mode, transaction, two keys, a secret. */
function verificationPayload(): Uint8Array {
  const transaction = new TextEncoder().encode("txn-0123456789");
  const head = [0x4d, 0x41, 0x54, 0x52, 0x49, 0x58, 0x02, 0x00, 0x00, transaction.length];
  const binary = Array.from({ length: 32 + 32 + 16 }, (_, i) => (i * 73 + 0xf1) % 256);
  return Uint8Array.from([...head, ...transaction, ...binary]);
}

/** Builds a bitstream by hand: [value, bits] pairs, then zero bits to a whole byte. */
function bitstream(fields: [number, number][]): number[] {
  const buffer = new BitBuffer();
  for (const [value, bits] of fields) buffer.put(value, bits);
  while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(0);
  return buffer.buffer;
}

describe("qrPayload", () => {
  test("reads a binary Matrix verification code's exact bytes, as jsQR does", () => {
    const payload = verificationPayload();
    const { version, codewords, modules } = symbol([{ data: payload, mode: "byte" }]);
    expect(Array.from(qrPayload(codewords, version)!)).toEqual(Array.from(payload));
    expect(jsQRPayload(modules)).toEqual(Array.from(payload));
  });

  test("reads every mode and mix of segments as jsQR does", () => {
    for (const input of [
      "0123456789012",
      "HELLO WORLD $%*+-./: 42",
      "https://matrix.to/#/@someone:example.org",
      "MATRIX 123 and some lower case text 4567890123 AND MORE",
      [
        { data: "12345678", mode: "numeric" },
        { data: "ABC DEF", mode: "alphanumeric" },
        { data: new Uint8Array([0, 255, 128, 7]), mode: "byte" },
      ],
    ] as Input[]) {
      for (const level of ["L", "H"] as const) {
        const { version, codewords, modules } = symbol(input, level);
        const read = qrPayload(codewords, version);
        expect(read).not.toBeNull();
        expect(Array.from(read!)).toEqual(jsQRPayload(modules));
      }
    }
  });

  test("reads the longer character counts of versions 10 and up, and 27 and up", () => {
    for (const length of [300, 1500]) {
      const payload = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) % 256);
      const { version, codewords, modules } = symbol([{ data: payload, mode: "byte" }], "L");
      expect(version).toBeGreaterThanOrEqual(length === 300 ? 10 : 27);
      expect(Array.from(qrPayload(codewords, version)!)).toEqual(Array.from(payload));
      expect(jsQRPayload(modules, 2)).toEqual(Array.from(payload));
    }
  });

  test("reads kanji as Shift JIS bytes", () => {
    // 点 is 0x935F and 茗 0xE4AA in Shift JIS (ISO/IEC 18004's examples).
    const packed = (code: number) => {
      const base = code >= 0xe040 ? code - 0xc140 : code - 0x8140;
      return (base >> 8) * 0xc0 + (base & 0xff);
    };
    const codewords = bitstream([
      [0b1000, 4],
      [2, 8],
      [packed(0x935f), 13],
      [packed(0xe4aa), 13],
      [0, 4],
    ]);
    expect(Array.from(qrPayload(codewords, 1)!)).toEqual([0x93, 0x5f, 0xe4, 0xaa]);
  });

  test("skips ECI, structured append and FNC1 headers, keeping the bytes", () => {
    const codewords = bitstream([
      [0b0011, 4],
      [0x1234, 16], // structured append: symbol 2 of 3, parity
      [0b0111, 4],
      [26, 8], // ECI 26 (UTF-8), one byte
      [0b0101, 4], // FNC1, first position
      [0b0100, 4],
      [2, 8],
      [0xc3, 8],
      [0xa9, 8],
      [0, 4],
    ]);
    expect(Array.from(qrPayload(codewords, 1)!)).toEqual([0xc3, 0xa9]);
  });

  test("ends where the data does, with a terminator or without room for one", () => {
    // Exactly full: a byte segment and no terminator.
    expect(
      Array.from(
        qrPayload(
          bitstream([
            [0b0100, 4],
            [1, 8],
            [0x41, 8],
            [0, 4],
          ]),
          1,
        )!,
      ),
    ).toEqual([0x41]);
    expect(
      Array.from(qrPayload([0x40, 0x14, 0x10], 1)!), // 0100 00000001 01000001 0000
    ).toEqual([0x41]);
  });

  test("rejects malformed bitstreams and versions", () => {
    // Cut short: a byte segment that claims more bytes than there are.
    expect(
      qrPayload(
        bitstream([
          [0b0100, 4],
          [9, 8],
          [0x41, 8],
        ]),
        1,
      ),
    ).toBeNull();
    // An unknown mode.
    expect(
      qrPayload(
        bitstream([
          [0b1111, 4],
          [0, 12],
        ]),
        1,
      ),
    ).toBeNull();
    // A numeric group over 999.
    expect(
      qrPayload(
        bitstream([
          [0b0001, 4],
          [3, 10],
          [1000, 10],
          [0, 4],
        ]),
        1,
      ),
    ).toBeNull();
    // Stray bits after the last segment that don't make a mode.
    expect(qrPayload([0x40, 0x14, 0x13], 1)).toBeNull();
    expect(qrPayload([0x40, 0x14, 0x10], 0)).toBeNull();
    expect(qrPayload([0x40, 0x14, 0x10], 41)).toBeNull();
  });
});

describe("qrPayloads", () => {
  test("parses each code the native module found, skipping unreadable ones", () => {
    const payload = verificationPayload();
    const { version, codewords } = symbol([{ data: payload, mode: "byte" }]);
    const found = qrPayloads([
      { version, codewords: [0xff, 0xff] },
      { version, codewords },
    ]);
    expect(found.map((bytes) => Array.from(bytes))).toEqual([Array.from(payload)]);
  });
});
