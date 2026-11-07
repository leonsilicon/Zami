import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { toSfnt } from "#convert";
import { fontFileFormat, writeSfnt } from "#sfnt";
import { isWoff2, woff2ToSfnt, Woff2Error } from "#woff2";

// Atkinson Hyperlegible Regular (SIL OFL, fixtures/AtkinsonHyperlegible-OFL.txt): as
// fontTools decodes Zam's WOFF2 (atkinson-400.ttf), and re-encoded by fontTools with the
// hmtx transform as well as glyf/loca's (atkinson-400.hmtx.woff2). Zam's own file
// (static/fonts) has glyf/loca transformed; it has composite glyphs and instructions.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, "fixtures", name)));
const repoRoot = path.resolve(import.meta.dirname, "../../../../../..");
const reference = fixture("atkinson-400.ttf");
const zamWoff2 = new Uint8Array(
  readFileSync(path.join(repoRoot, "static/fonts/atkinson-400.zami.woff2")),
);

function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
}

function tables(font: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + 16 * i;
    const tag = String.fromCharCode(...font.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    out.set(tag, font.subarray(offset, offset + view.getUint32(record + 12)));
  }
  return out;
}

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array((data.length + 3) & ~3);
  padded.set(data);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + u32(padded, i)) >>> 0;
  return sum;
}

interface Glyph {
  contours: number;
  bbox: number[];
  endPoints?: number[];
  points?: [x: number, y: number, onCurve: boolean][];
  instructions: number[];
  components?: number[];
}

/** Each glyph's outline, decoded from glyf/loca, so encodings that differ compare equal. */
function glyphs(font: Uint8Array): Glyph[] {
  const t = tables(font);
  const glyf = t.get("glyf")!;
  const loca = t.get("loca")!;
  const head = new DataView(t.get("head")!.buffer, t.get("head")!.byteOffset);
  const numGlyphs = new DataView(t.get("maxp")!.buffer, t.get("maxp")!.byteOffset).getUint16(4);
  const long = head.getInt16(50) === 1;
  const locaView = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const view = new DataView(glyf.buffer, glyf.byteOffset, glyf.byteLength);
  const offsetOf = (i: number) =>
    long ? locaView.getUint32(i * 4) : locaView.getUint16(i * 2) * 2;
  const out: Glyph[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    const start = offsetOf(i);
    if (offsetOf(i + 1) === start) {
      out.push({ contours: 0, bbox: [], instructions: [] });
      continue;
    }
    let at = start;
    const i16 = () => ((at += 2), view.getInt16(at - 2));
    const u16 = () => ((at += 2), view.getUint16(at - 2));
    const u8 = () => glyf[at++]!;
    const contours = i16();
    const bbox = [i16(), i16(), i16(), i16()];
    if (contours < 0) {
      const componentsStart = at;
      let flags: number;
      let instructions = false;
      do {
        flags = u16();
        u16();
        instructions ||= (flags & 0x100) !== 0;
        at += (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      } while (flags & 0x20);
      const components = [...glyf.subarray(componentsStart, at)];
      const program = instructions ? [...glyf.subarray(at + 2, at + 2 + view.getUint16(at))] : [];
      out.push({ contours, bbox, components, instructions: program });
      continue;
    }
    const endPoints = Array.from({ length: contours }, u16);
    const instructionLength = u16();
    const instructions = [...glyf.subarray(at, at + instructionLength)];
    at += instructionLength;
    const count = contours === 0 ? 0 : endPoints[contours - 1]! + 1;
    const flags: number[] = [];
    while (flags.length < count) {
      const flag = u8();
      flags.push(flag);
      if (flag & 8) for (let repeat = u8(); repeat > 0; repeat--) flags.push(flag);
    }
    const coordinate = (short: number, same: number) => {
      let value = 0;
      return flags.map((flag) => {
        if (flag & short) value += flag & same ? u8() : -u8();
        else if (!(flag & same)) value += i16();
        return value;
      });
    };
    const xs = coordinate(2, 0x10);
    const ys = coordinate(4, 0x20);
    const points = flags.map((flag, p): [number, number, boolean] => [
      xs[p]!,
      ys[p]!,
      (flag & 1) === 1,
    ]);
    out.push({ contours, bbox, endPoints, points, instructions });
  }
  return out;
}

describe("woff2ToSfnt", () => {
  for (const [name, woff2] of [
    ["Zam's file (glyf/loca transformed)", zamWoff2],
    ["with hmtx transformed too", fixture("atkinson-400.hmtx.woff2")],
  ] as const) {
    test(`decodes ${name} to the font fontTools decodes`, () => {
      expect(isWoff2(woff2)).toBe(true);
      const font = woff2ToSfnt(woff2);
      expect(fontFileFormat(font)).toBe("truetype");
      const mine = tables(font);
      const theirs = tables(reference);
      expect([...mine.keys()].sort()).toEqual([...theirs.keys()].sort());
      for (const [tag, data] of theirs) {
        if (tag === "glyf" || tag === "loca") continue;
        const expected = tag === "head" ? data.slice() : data;
        // checkSumAdjustment depends on the whole file, and fontTools' save updated the
        // modified date.
        if (tag === "head") {
          expected.set(mine.get("head")!.subarray(8, 12), 8);
          expected.set(mine.get("head")!.subarray(28, 36), 28);
        }
        expect([tag, [...mine.get(tag)!]]).toEqual([tag, [...expected]]);
      }
      expect(glyphs(font)).toEqual(glyphs(reference));
    });
  }

  test("writes valid checksums", () => {
    const font = woff2ToSfnt(zamWoff2);
    const view = new DataView(font.buffer);
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + 16 * i;
      const tag = String.fromCharCode(...font.subarray(record, record + 4));
      let data = font.subarray(
        view.getUint32(record + 8),
        view.getUint32(record + 8) + view.getUint32(record + 12),
      );
      if (tag === "head") (data = data.slice()).fill(0, 8, 12);
      expect([tag, checksum(data)]).toEqual([tag, view.getUint32(record + 4)]);
    }
    expect(checksum(font)).toBe(0xb1b0afba);
  });

  test("rejects what isn't WOFF2", () => {
    expect(isWoff2(reference)).toBe(false);
    expect(() => woff2ToSfnt(reference)).toThrow(Woff2Error);
    expect(() => woff2ToSfnt(zamWoff2.subarray(0, 100))).toThrow();
  });
});

describe("toSfnt", () => {
  test("passes TrueType and OpenType through and decodes WOFF2", () => {
    expect(toSfnt(reference)).toEqual({ data: reference, extension: "ttf" });
    const otf = writeSfnt(0x4f54544f, [{ tag: "name", data: new Uint8Array(6) }]);
    expect(toSfnt(otf)).toEqual({ data: otf, extension: "otf" });
    expect(toSfnt(zamWoff2).extension).toBe("ttf");
    expect(() => toSfnt(new TextEncoder().encode("not a font file"))).toThrow(/Unsupported/);
  });
});

describe("writeSfnt", () => {
  test("sorts the directory and fills in the search fields", () => {
    const font = writeSfnt(0x00010000, [
      { tag: "name", data: new Uint8Array([1, 2, 3]) },
      { tag: "cmap", data: new Uint8Array([4]) },
      { tag: "OS/2", data: new Uint8Array(0) },
    ]);
    const view = new DataView(font.buffer);
    expect([view.getUint16(4), view.getUint16(6), view.getUint16(8), view.getUint16(10)]).toEqual([
      3, 32, 1, 16,
    ]);
    expect([...tables(font).keys()]).toEqual(["OS/2", "cmap", "name"]);
    expect(font.length).toBe(12 + 3 * 16 + 4 + 4);
  });
});
