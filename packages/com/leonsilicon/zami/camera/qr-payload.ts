// A QR code's payload from its data codewords: the bitstream ISO/IEC 18004 §7.4 describes,
// as the native modules hand it over (iOS's `CIQRCodeDescriptor.errorCorrectedPayload`,
// ZXing's raw bytes on Android), after error correction and before the segments are read.

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** The mode indicators (4 bits) that start each segment. */
const Mode = {
  Terminator: 0b0000,
  Numeric: 0b0001,
  Alphanumeric: 0b0010,
  StructuredAppend: 0b0011,
  Byte: 0b0100,
  Fnc1First: 0b0101,
  Eci: 0b0111,
  Kanji: 0b1000,
  Fnc1Second: 0b1001,
} as const;

/** Bits of a segment's character count, by mode, for versions 1–9, 10–26 and 27–40. */
const COUNT_BITS: Partial<Record<number, readonly [number, number, number]>> = {
  [Mode.Numeric]: [10, 12, 14],
  [Mode.Alphanumeric]: [9, 11, 13],
  [Mode.Byte]: [8, 16, 16],
  [Mode.Kanji]: [8, 10, 12],
};

class Bits {
  #at = 0;
  constructor(private readonly bytes: ArrayLike<number>) {}

  get available(): number {
    return this.bytes.length * 8 - this.#at;
  }

  /** The next `count` bits (at most 24) as a number; throws past the end. */
  read(count: number): number {
    if (count > this.available) throw new RangeError("The QR bitstream ended early");
    let value = 0;
    for (let i = 0; i < count; i++, this.#at++) {
      const byte = this.bytes[this.#at >> 3]! & 0xff;
      value = (value << 1) | ((byte >> (7 - (this.#at & 7))) & 1);
    }
    return value;
  }
}

function decodeSegments(bits: Bits, version: number, out: number[]): void {
  const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  while (bits.available >= 4) {
    const mode = bits.read(4);
    if (mode === Mode.Terminator) return;
    if (mode === Mode.Eci) {
      // An assignment number of 1, 2 or 3 bytes (as many leading 1 bits before a 0, then
      // 7, 14 or 21 bits); the payload's bytes stay as they are.
      for (let bytes = 1; bytes <= 3; bytes++) {
        if (bits.read(1) === 0) {
          bits.read(7 * bytes);
          break;
        }
      }
      continue;
    }
    if (mode === Mode.StructuredAppend) {
      bits.read(16); // the symbol's place in its sequence, and the sequence's parity
      continue;
    }
    if (mode === Mode.Fnc1First) continue;
    if (mode === Mode.Fnc1Second) {
      bits.read(8); // the application indicator
      continue;
    }
    const countBits = COUNT_BITS[mode];
    if (!countBits) throw new RangeError(`Unknown QR segment mode ${mode}`);
    let count = bits.read(countBits[size]);
    switch (mode) {
      case Mode.Numeric: {
        for (; count >= 3; count -= 3) {
          const group = bits.read(10);
          if (group >= 1000) throw new RangeError("Invalid numeric QR segment");
          out.push(
            48 + Math.floor(group / 100),
            48 + (Math.floor(group / 10) % 10),
            48 + (group % 10),
          );
        }
        if (count === 2) {
          const group = bits.read(7);
          if (group >= 100) throw new RangeError("Invalid numeric QR segment");
          out.push(48 + Math.floor(group / 10), 48 + (group % 10));
        } else if (count === 1) {
          const digit = bits.read(4);
          if (digit >= 10) throw new RangeError("Invalid numeric QR segment");
          out.push(48 + digit);
        }
        break;
      }
      case Mode.Alphanumeric: {
        const char = (index: number) => {
          if (index >= ALPHANUMERIC.length) throw new RangeError("Invalid alphanumeric QR segment");
          return ALPHANUMERIC.charCodeAt(index);
        };
        for (; count >= 2; count -= 2) {
          const pair = bits.read(11);
          out.push(char(Math.floor(pair / 45)), char(pair % 45));
        }
        if (count === 1) out.push(char(bits.read(6)));
        break;
      }
      case Mode.Byte: {
        for (; count > 0; count--) out.push(bits.read(8));
        break;
      }
      case Mode.Kanji: {
        // Shift JIS, 13 bits a character.
        for (; count > 0; count--) {
          const packed = bits.read(13);
          let code = (Math.floor(packed / 0xc0) << 8) | (packed % 0xc0);
          code += code < 0x1f00 ? 0x8140 : 0xc140;
          out.push(code >> 8, code & 0xff);
        }
        break;
      }
    }
  }
  // Bits left over that don't make a mode indicator must be zero: a short terminator.
  if (bits.available > 0 && bits.read(bits.available) !== 0) {
    throw new RangeError("The QR bitstream has stray bits after its last segment");
  }
}

/**
 * A QR code's payload, from its data codewords and version, as jsQR's `binaryData` gives
 * it: a byte segment's bytes as they are, and numeric, alphanumeric and kanji segments'
 * characters as their ASCII or Shift JIS bytes, in order. Null when the codewords don't
 * hold a well-formed bitstream.
 */
export function qrPayload(codewords: ArrayLike<number>, version: number): Uint8Array | null {
  if (!Number.isInteger(version) || version < 1 || version > 40) return null;
  const out: number[] = [];
  try {
    decodeSegments(new Bits(codewords), version, out);
  } catch {
    return null;
  }
  return Uint8Array.from(out);
}

/** A QR code as the native modules report it: its data codewords and version. */
export interface QrCodewords {
  version: number;
  codewords: ArrayLike<number>;
}

/** The payloads of the codes the native module found, skipping any it can't read. */
export function qrPayloads(codes: readonly QrCodewords[]): Uint8Array[] {
  const payloads: Uint8Array[] = [];
  for (const code of codes) {
    const payload = qrPayload(code.codewords, code.version);
    if (payload) payloads.push(payload);
  }
  return payloads;
}
