// WOFF2 → TrueType/OpenType (https://www.w3.org/TR/WOFF2/). Zam ships its fonts as WOFF2
// and accepts it for uploads; the app loads TrueType and OpenType (Android's Typeface has
// no WOFF2), so they're decoded to the sfnt they were made from: the tables are
// Brotli-decompressed, and the transformed `glyf`/`loca` and `hmtx` tables rebuilt.
// brotli is untyped; the app type-checks this file without this package's tsconfig.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./brotli.d.ts" />
import brotliDecompress from "brotli/decompress.js";
import { writeSfnt, type SfntTable } from "#sfnt";

/** WOFF2's 63 known table tags, by the index a table directory entry may give instead. */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf",
  "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
  "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT",
  "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar",
  "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd",
  "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
]; // prettier-ignore

const WOFF2_SIGNATURE = 0x774f4632; // "wOF2"
const TTC_FLAVOR = 0x74746366; // "ttcf"

export class Woff2Error extends Error {
  override name = "Woff2Error";
}

function fail(message: string): never {
  throw new Woff2Error(message);
}

/** A cursor over big-endian font data. */
class Reader {
  offset = 0;
  readonly bytes: Uint8Array;
  readonly view: DataView;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private take(length: number): number {
    const at = this.offset;
    if (at + length > this.bytes.length) fail("truncated font data");
    this.offset += length;
    return at;
  }
  u8(): number {
    return this.bytes[this.take(1)]!;
  }
  u16(): number {
    return this.view.getUint16(this.take(2));
  }
  i16(): number {
    return this.view.getInt16(this.take(2));
  }
  u32(): number {
    return this.view.getUint32(this.take(4));
  }
  slice(length: number): Uint8Array {
    const at = this.take(length);
    return this.bytes.subarray(at, at + length);
  }
  /** UIntBase128: up to five bytes of seven bits, most significant first. */
  base128(): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      if (i === 0 && byte === 0x80) fail("UIntBase128 with a leading zero");
      if (value > 0x1ffffff) fail("UIntBase128 overflows 32 bits");
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    return fail("UIntBase128 longer than five bytes");
  }
  /** 255UInt16. */
  u16Of255(): number {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return this.u8() + 253;
    if (code === 254) return this.u8() + 253 * 2;
    return code;
  }
}

interface DirectoryEntry {
  tag: string;
  origLength: number;
  /** The table's length in the decompressed stream. */
  length: number;
  transformed: boolean;
}

/** Whether `bytes` is a WOFF2 file. */
export function isWoff2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) === WOFF2_SIGNATURE
  );
}

/** Decodes a WOFF2 file to the TrueType or OpenType (CFF) font it holds. */
export function woff2ToSfnt(bytes: Uint8Array): Uint8Array {
  const reader = new Reader(bytes);
  if (reader.u32() !== WOFF2_SIGNATURE) fail("not a WOFF2 file");
  const flavor = reader.u32();
  if (flavor === TTC_FLAVOR) fail("WOFF2 font collections aren't supported");
  reader.u32(); // length
  const numTables = reader.u16();
  reader.u16(); // reserved
  reader.u32(); // totalSfntSize
  const totalCompressedSize = reader.u32();
  reader.offset += 4 + 12 + 8; // version, metadata, private data
  if (numTables === 0) fail("WOFF2 file with no tables");

  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = reader.u8();
    const tagIndex = flags & 0x3f;
    const tag = tagIndex === 63 ? tagName(reader.u32()) : KNOWN_TAGS[tagIndex]!;
    const version = flags >> 6;
    // glyf and loca are transformed by default (version 0; 3 is none); the others only
    // when asked (version 1 of hmtx).
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const origLength = reader.base128();
    const length = transformed ? reader.base128() : origLength;
    if (transformed && tag !== "glyf" && tag !== "loca" && tag !== "hmtx") {
      fail(`unknown transform of the ${tag} table`);
    }
    entries.push({ tag, origLength, length, transformed });
  }

  const stream = brotliDecompress(reader.slice(totalCompressedSize));
  const data = new Map<string, Uint8Array>();
  let offset = 0;
  for (const entry of entries) {
    if (offset + entry.length > stream.length) fail(`the ${entry.tag} table is truncated`);
    data.set(entry.tag, stream.subarray(offset, offset + entry.length));
    offset += entry.length;
  }

  const tables = new Map<string, Uint8Array>();
  for (const entry of entries) tables.set(entry.tag, data.get(entry.tag)!);

  let glyphXMins: Int16Array | undefined;
  const glyf = entries.find((entry) => entry.tag === "glyf");
  const loca = entries.find((entry) => entry.tag === "loca");
  if (glyf?.transformed !== loca?.transformed) fail("glyf and loca must be transformed together");
  if (glyf?.transformed) {
    const rebuilt = reconstructGlyf(data.get("glyf")!);
    if (rebuilt.loca.length !== loca!.origLength) fail("the rebuilt loca table has the wrong size");
    tables.set("glyf", rebuilt.glyf);
    tables.set("loca", rebuilt.loca);
    glyphXMins = rebuilt.xMins;
  }
  const hmtx = entries.find((entry) => entry.tag === "hmtx");
  if (hmtx?.transformed) {
    tables.set(
      "hmtx",
      reconstructHmtx(data.get("hmtx")!, tables, glyphXMins ?? glyphXMinsOf(tables)),
    );
  }

  const out: SfntTable[] = entries.map((entry) => ({
    tag: entry.tag,
    data: tables.get(entry.tag)!,
  }));
  return writeSfnt(flavor, out);
}

function tagName(value: number): string {
  return String.fromCharCode(
    value >>> 24,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

// ---- glyf / loca (WOFF2 §5.1) ----

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
const OVERLAP_SIMPLE = 0x40;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

/** A growable big-endian byte buffer. */
class Writer {
  bytes = new Uint8Array(1024);
  length = 0;
  private reserve(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }
  u8(value: number): void {
    this.reserve(1);
    this.bytes[this.length++] = value;
  }
  u16(value: number): void {
    this.reserve(2);
    this.bytes[this.length++] = (value >> 8) & 0xff;
    this.bytes[this.length++] = value & 0xff;
  }
  u32(value: number): void {
    this.u16(value >>> 16);
    this.u16(value & 0xffff);
  }
  append(data: Uint8Array): void {
    this.reserve(data.length);
    this.bytes.set(data, this.length);
    this.length += data.length;
  }
  pad4(): void {
    while (this.length % 4 !== 0) this.u8(0);
  }
  done(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

function withSign(flag: number, value: number): number {
  return flag & 1 ? value : -value;
}

function reconstructGlyf(table: Uint8Array): {
  glyf: Uint8Array;
  loca: Uint8Array;
  xMins: Int16Array;
} {
  const header = new Reader(table);
  header.u16(); // reserved
  const optionFlags = header.u16();
  const numGlyphs = header.u16();
  const indexFormat = header.u16();
  const sizes = Array.from({ length: 7 }, () => header.u32());
  const streams = sizes.map((size) => new Reader(header.slice(size)));
  const [
    nContourStream,
    nPointsStream,
    flagStream,
    glyphStream,
    compositeStream,
    bboxStream,
    instructionStream,
  ] = streams as [Reader, Reader, Reader, Reader, Reader, Reader, Reader];
  const overlapBitmap = optionFlags & 1 ? header.slice((numGlyphs + 7) >> 3) : undefined;
  const bboxBitmap = bboxStream.slice(4 * ((numGlyphs + 31) >> 5));

  const glyf = new Writer();
  const offsets = new Uint32Array(numGlyphs + 1);
  const xMins = new Int16Array(numGlyphs);

  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    offsets[glyph] = glyf.length;
    const hasBbox = (bboxBitmap[glyph >> 3]! & (0x80 >> (glyph & 7))) !== 0;
    const nContours = nContourStream.i16();

    if (nContours === 0) {
      if (hasBbox) fail(`empty glyph ${glyph} has a bounding box`);
      continue;
    }

    if (nContours === -1) {
      // Composite: its components as they are, its bounding box, and its instructions.
      if (!hasBbox) fail(`composite glyph ${glyph} has no bounding box`);
      const start = compositeStream.offset;
      let haveInstructions = false;
      let flags: number;
      do {
        flags = compositeStream.u16();
        compositeStream.u16(); // glyphIndex
        haveInstructions ||= (flags & WE_HAVE_INSTRUCTIONS) !== 0;
        let size = flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2;
        if (flags & WE_HAVE_A_SCALE) size += 2;
        else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) size += 4;
        else if (flags & WE_HAVE_A_TWO_BY_TWO) size += 8;
        compositeStream.slice(size);
      } while (flags & MORE_COMPONENTS);
      const components = compositeStream.bytes.subarray(start, compositeStream.offset);
      const bbox = [bboxStream.i16(), bboxStream.i16(), bboxStream.i16(), bboxStream.i16()];
      xMins[glyph] = bbox[0]!;
      glyf.u16(0xffff);
      for (const value of bbox) glyf.u16(value & 0xffff);
      glyf.append(components);
      if (haveInstructions) {
        const instructionLength = glyphStream.u16Of255();
        glyf.u16(instructionLength);
        glyf.append(instructionStream.slice(instructionLength));
      }
      glyf.pad4();
      continue;
    }

    if (nContours < -1) fail(`glyph ${glyph} has ${nContours} contours`);

    // Simple: contour ends, then each point's flag and coordinates (triplet-encoded).
    const endPoints: number[] = [];
    let nPoints = 0;
    for (let contour = 0; contour < nContours; contour++) {
      nPoints += nPointsStream.u16Of255();
      endPoints.push(nPoints - 1);
    }
    const onCurve = new Uint8Array(nPoints);
    const xs = new Int32Array(nPoints);
    const ys = new Int32Array(nPoints);
    let x = 0;
    let y = 0;
    for (let point = 0; point < nPoints; point++) {
      const byte = flagStream.u8();
      onCurve[point] = byte >> 7 ? 0 : 1;
      const flag = byte & 0x7f;
      let dx: number;
      let dy: number;
      if (flag < 10) {
        dx = 0;
        dy = withSign(flag, ((flag & 14) << 7) + glyphStream.u8());
      } else if (flag < 20) {
        dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphStream.u8());
        dy = 0;
      } else if (flag < 84) {
        const b0 = flag - 20;
        const b1 = glyphStream.u8();
        dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4));
        dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
      } else if (flag < 120) {
        const b0 = flag - 84;
        dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + glyphStream.u8());
        dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphStream.u8());
      } else if (flag < 124) {
        const b1 = glyphStream.u8();
        const b2 = glyphStream.u8();
        const b3 = glyphStream.u8();
        dx = withSign(flag, (b1 << 4) + (b2 >> 4));
        dy = withSign(flag >> 1, ((b2 & 0x0f) << 8) + b3);
      } else {
        const b1 = glyphStream.u8();
        const b2 = glyphStream.u8();
        const b3 = glyphStream.u8();
        const b4 = glyphStream.u8();
        dx = withSign(flag, (b1 << 8) + b2);
        dy = withSign(flag >> 1, (b3 << 8) + b4);
      }
      x += dx;
      y += dy;
      xs[point] = x;
      ys[point] = y;
    }
    const instructionLength = glyphStream.u16Of255();
    const instructions = instructionStream.slice(instructionLength);

    let bbox: number[];
    if (hasBbox) {
      bbox = [bboxStream.i16(), bboxStream.i16(), bboxStream.i16(), bboxStream.i16()];
    } else if (nPoints === 0) {
      bbox = [0, 0, 0, 0];
    } else {
      bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    xMins[glyph] = bbox[0]!;

    glyf.u16(nContours);
    for (const value of bbox) glyf.u16(value & 0xffff);
    for (const end of endPoints) glyf.u16(end);
    glyf.u16(instructionLength);
    glyf.append(instructions);
    const overlap =
      overlapBitmap !== undefined && (overlapBitmap[glyph >> 3]! & (0x80 >> (glyph & 7))) !== 0;
    writeSimpleGlyphPoints(glyf, onCurve, xs, ys, overlap);
    glyf.pad4();
  }
  offsets[numGlyphs] = glyf.length;

  const loca = new Writer();
  for (const offset of offsets) {
    if (indexFormat === 0) loca.u16(offset >> 1);
    else loca.u32(offset);
  }
  return { glyf: glyf.done(), loca: loca.done(), xMins };
}

/** A simple glyph's flags (run-length encoded) and its x and y coordinate deltas. */
function writeSimpleGlyphPoints(
  out: Writer,
  onCurve: Uint8Array,
  xs: Int32Array,
  ys: Int32Array,
  overlap: boolean,
): void {
  const flags: number[] = [];
  const xBytes = new Writer();
  const yBytes = new Writer();
  let lastX = 0;
  let lastY = 0;
  for (let point = 0; point < onCurve.length; point++) {
    let flag = onCurve[point] ? ON_CURVE : 0;
    if (point === 0 && overlap) flag |= OVERLAP_SIMPLE;
    const dx = xs[point]! - lastX;
    const dy = ys[point]! - lastY;
    lastX = xs[point]!;
    lastY = ys[point]!;
    if (dx === 0) flag |= X_SAME_OR_POSITIVE;
    else if (dx > -256 && dx < 256) {
      flag |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0);
      xBytes.u8(Math.abs(dx));
    } else xBytes.u16(dx & 0xffff);
    if (dy === 0) flag |= Y_SAME_OR_POSITIVE;
    else if (dy > -256 && dy < 256) {
      flag |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0);
      yBytes.u8(Math.abs(dy));
    } else yBytes.u16(dy & 0xffff);
    flags.push(flag);
  }
  for (let i = 0; i < flags.length;) {
    const flag = flags[i]!;
    let repeat = 0;
    while (repeat < 255 && i + 1 + repeat < flags.length && flags[i + 1 + repeat] === flag)
      repeat++;
    if (repeat > 0) {
      out.u8(flag | REPEAT);
      out.u8(repeat);
    } else out.u8(flag);
    i += 1 + repeat;
  }
  out.append(xBytes.done());
  out.append(yBytes.done());
}

// ---- hmtx (WOFF2 §5.4) ----

function reconstructHmtx(
  table: Uint8Array,
  tables: Map<string, Uint8Array>,
  xMins: Int16Array,
): Uint8Array {
  const hhea = tables.get("hhea") ?? fail("a transformed hmtx table needs hhea");
  const maxp = tables.get("maxp") ?? fail("a transformed hmtx table needs maxp");
  const numHMetrics = new Reader(hhea).view.getUint16(34);
  const numGlyphs = new Reader(maxp).view.getUint16(4);
  const reader = new Reader(table);
  const flags = reader.u8();
  if ((flags & 3) === 0 || numHMetrics < 1 || numHMetrics > numGlyphs)
    fail("invalid transformed hmtx table");
  const advances = Array.from({ length: numHMetrics }, () => reader.u16());
  const lsbs: number[] = [];
  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    const proportional = glyph < numHMetrics;
    const omitted = proportional ? flags & 1 : flags & 2;
    lsbs.push(omitted ? (xMins[glyph] ?? 0) : reader.i16());
  }
  const out = new Writer();
  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    if (glyph < numHMetrics) out.u16(advances[glyph]!);
    out.u16(lsbs[glyph]! & 0xffff);
  }
  return out.done();
}

/** The glyphs' xMin from an untransformed glyf/loca, for an hmtx transform without them. */
function glyphXMinsOf(tables: Map<string, Uint8Array>): Int16Array {
  const glyf = tables.get("glyf");
  const loca = tables.get("loca");
  const head = tables.get("head");
  const maxp = tables.get("maxp");
  if (!glyf || !loca || !head || !maxp) fail("a transformed hmtx table needs glyf");
  const numGlyphs = new Reader(maxp).view.getUint16(4);
  const longLoca = new Reader(head).view.getInt16(50) === 1;
  const locaView = new Reader(loca).view;
  const glyfView = new Reader(glyf).view;
  const xMins = new Int16Array(numGlyphs);
  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    const start = longLoca ? locaView.getUint32(glyph * 4) : locaView.getUint16(glyph * 2) * 2;
    const end = longLoca
      ? locaView.getUint32(glyph * 4 + 4)
      : locaView.getUint16(glyph * 2 + 2) * 2;
    if (end > start) xMins[glyph] = glyfView.getInt16(start + 2);
  }
  return xMins;
}
