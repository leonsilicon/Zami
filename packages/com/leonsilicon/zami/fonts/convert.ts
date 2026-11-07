// Any font file Zam accepts (TrueType, OpenType or WOFF2) as the TrueType or OpenType file
// React Native's platforms load.
import { fontFileFormat } from "#sfnt";
import { woff2ToSfnt } from "#woff2";

export interface SfntFont {
  data: Uint8Array;
  /** The file extension the platforms expect for it. */
  extension: "ttf" | "otf";
}

/** `bytes` as an sfnt font file, decoding WOFF2. Throws for anything it can't load. */
export function toSfnt(bytes: Uint8Array): SfntFont {
  const format = fontFileFormat(bytes);
  switch (format) {
    case "truetype":
      return { data: bytes, extension: "ttf" };
    case "opentype":
      return { data: bytes, extension: "otf" };
    case "woff2": {
      const data = woff2ToSfnt(bytes);
      return { data, extension: fontFileFormat(data) === "opentype" ? "otf" : "ttf" };
    }
    default:
      throw new Error(`Unsupported font file (${format ?? "unknown format"})`);
  }
}
