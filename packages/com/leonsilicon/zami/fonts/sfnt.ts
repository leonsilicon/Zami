// TrueType/OpenType ("sfnt") font files: which kind a file is, and writing one from its
// tables.

export interface SfntTable {
  tag: string;
  data: Uint8Array;
}

export type FontFileFormat = "truetype" | "opentype" | "woff2" | "woff" | "collection";

/**
 * A font file's format, from its signature: TrueType (`.ttf`), OpenType with CFF outlines
 * (`.otf`), WOFF2 or WOFF, a font collection, or null for anything else.
 */
export function fontFileFormat(bytes: Uint8Array): FontFileFormat | null {
  if (bytes.length < 12) return null;
  const signature = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  switch (signature) {
    case 0x00010000:
    case 0x74727565: // "true"
      return "truetype";
    case 0x4f54544f: // "OTTO"
      return "opentype";
    case 0x774f4632: // "wOF2"
      return "woff2";
    case 0x774f4646: // "wOFF"
      return "woff";
    case 0x74746366: // "ttcf"
      return "collection";
    default:
      return null;
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const whole = data.length & ~3;
  for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  if (whole < data.length) {
    let last = 0;
    for (let i = whole; i < whole + 4; i++) last = (last << 8) | (data[i] ?? 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * An sfnt file of `tables` (in any order; the directory is sorted by tag), with their
 * checksums and the head table's checkSumAdjustment computed.
 */
export function writeSfnt(flavor: number, tables: readonly SfntTable[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const numTables = sorted.length;
  const headerSize = 12 + 16 * numTables;
  let size = headerSize;
  for (const table of sorted) size += (table.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = 2 ** entrySelector * 16;
  view.setUint32(0, flavor);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, numTables * 16 - searchRange);

  let offset = headerSize;
  let headOffset = -1;
  sorted.forEach((table, index) => {
    let data = table.data;
    if (table.tag === "head" && data.length >= 12) {
      // checkSumAdjustment is computed over the whole file with it zeroed.
      data = data.slice();
      new DataView(data.buffer).setUint32(8, 0);
      headOffset = offset;
    }
    const record = 12 + 16 * index;
    for (let i = 0; i < 4; i++) out[record + i] = table.tag.charCodeAt(i);
    view.setUint32(record + 4, checksum(data));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, data.length);
    out.set(data, offset);
    offset += (data.length + 3) & ~3;
  });
  if (headOffset >= 0) view.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
