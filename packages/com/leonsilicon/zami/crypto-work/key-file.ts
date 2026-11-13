// The steps of a key export file (Matrix "key exports": base64 armour around an AES-CTR
// ciphertext) done a piece at a time, for files of tens of MB. Each piece is a native call
// (btoa, atob, WebCrypto) or a short loop, with a turn of the event loop once 8 ms have gone.
import { createYielder } from "#yield";

const BUDGET_MS = 8;

/**
 * `bytes` in base64, broken into lines of `lineLength` characters (a multiple of 4), each
 * line ending in "\n". The bytes are encoded a few thousand at a time with the native `btoa`,
 * never as one string of the whole file.
 */
export async function encodeBase64Lines(bytes: Uint8Array, lineLength: number): Promise<string> {
  if (lineLength <= 0 || lineLength % 4 !== 0) throw new RangeError("line length must be 4n");
  const lineBytes = (lineLength / 4) * 3;
  // 100 lines per call: a whole number of lines, and of 3-byte groups, so only the last
  // piece can end in padding.
  const pieceBytes = lineBytes * 100;
  const maybeYield = createYielder(BUDGET_MS);
  const pieces: string[] = [];
  for (let at = 0; at < bytes.length; at += pieceBytes) {
    const b64 = btoa(String.fromCharCode(...bytes.subarray(at, at + pieceBytes)));
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += lineLength) lines.push(b64.slice(i, i + lineLength));
    pieces.push(`${lines.join("\n")}\n`);
    const turn = maybeYield();
    if (turn) await turn;
  }
  return pieces.join("");
}

/**
 * `new TextEncoder().encode(text)`, a quarter of a million characters per call. Hermes took
 * 59 ms to encode an 11 MB key list in one call, and under 4 ms per piece. A piece never
 * ends between the two halves of a surrogate pair, which would encode as two U+FFFD.
 */
export async function encodeUtf8InPieces(
  text: string,
  pieceChars = 256 * 1024,
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const maybeYield = createYielder(BUDGET_MS);
  const pieces: Uint8Array[] = [];
  let length = 0;
  for (let at = 0; at < text.length;) {
    let cut = Math.min(text.length, at + pieceChars);
    const before = text.charCodeAt(cut - 1);
    if (cut < text.length && cut - 1 > at && before >= 0xd800 && before <= 0xdbff) cut--;
    const piece = encoder.encode(text.slice(at, cut));
    pieces.push(piece);
    length += piece.length;
    at = cut;
    const turn = maybeYield();
    if (turn) await turn;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out;
}

/** Text that isn't valid base64. */
export class Base64FormatError extends Error {
  constructor() {
    super("not valid base64");
    this.name = "Base64FormatError";
  }
}

/**
 * Decode the base64 in `text` between `start` and `end`, ignoring whitespace (line breaks
 * included), as `atob(text.slice(start, end).replace(/\s+/g, ""))` would, a piece at a time.
 * Throws Base64FormatError where that would throw.
 */
export async function decodeBase64Lines(
  text: string,
  start = 0,
  end = text.length,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(Math.floor(((end - start) * 3) / 4) + 3);
  let length = 0;
  let carry = "";
  const maybeYield = createYielder(BUDGET_MS);
  const PIECE = 64 * 1024;
  for (let at = start; at < end;) {
    // Cut at a line break, so a piece rarely leaves base64 over for the next.
    let cut = Math.min(end, at + PIECE);
    if (cut < end) {
      const newline = text.indexOf("\n", cut);
      cut = newline < 0 || newline >= end ? end : newline + 1;
    }
    const last = cut >= end;
    let b64 = carry + text.slice(at, cut).replace(/\s+/g, "");
    at = cut;
    if (!last) {
      // Padding only ever ends the whole text.
      if (b64.includes("=")) throw new Base64FormatError();
      const whole = b64.length - (b64.length % 4);
      carry = b64.slice(whole);
      b64 = b64.slice(0, whole);
    }
    let binary: string;
    try {
      binary = atob(b64);
    } catch {
      throw new Base64FormatError();
    }
    for (let i = 0; i < binary.length; i++) out[length++] = binary.charCodeAt(i);
    const turn = maybeYield();
    if (turn) await turn;
  }
  return out.slice(0, length);
}

/**
 * The 16-byte counter block `blocks` blocks after `counter`, counting as WebCrypto's AES-CTR
 * with `length: 64` does: the low 64 bits wrap around, the high 64 bits stay.
 */
export function counterAfter(counter: Uint8Array, blocks: number): Uint8Array<ArrayBuffer> {
  const next = new Uint8Array(16);
  next.set(counter.subarray(0, 16));
  let add = blocks;
  let carry = 0;
  for (let i = 15; i >= 8; i--) {
    const sum = next[i]! + (add % 256) + carry;
    next[i] = sum & 0xff;
    carry = sum >> 8;
    add = Math.floor(add / 256);
  }
  return next;
}

/**
 * AES-CTR over `data` (counter block `counter`, `length: 64`) in pieces of `pieceBytes`, a
 * multiple of 16, with a turn of the event loop between them once 8 ms have gone. The result
 * is the same as one `subtle.encrypt`/`decrypt` call over all of `data`.
 */
export async function aesCtrInPieces(
  subtle: SubtleCrypto,
  direction: "encrypt" | "decrypt",
  key: CryptoKey,
  counter: Uint8Array,
  data: Uint8Array<ArrayBuffer>,
  // Small enough for the pure-JS fallback (Android until it has native WebCrypto); a
  // native call per piece costs little.
  pieceBytes = 64 * 1024,
): Promise<Uint8Array<ArrayBuffer>> {
  if (pieceBytes <= 0 || pieceBytes % 16 !== 0) throw new RangeError("piece size must be 16n");
  const out = new Uint8Array(data.length);
  const maybeYield = createYielder(BUDGET_MS);
  for (let at = 0; at < data.length || at === 0; at += pieceBytes) {
    const algorithm = { name: "AES-CTR", counter: counterAfter(counter, at / 16), length: 64 };
    const piece = data.subarray(at, at + pieceBytes);
    const result =
      direction === "encrypt"
        ? await subtle.encrypt(algorithm, key, piece)
        : await subtle.decrypt(algorithm, key, piece);
    out.set(new Uint8Array(result), at);
    if (at + pieceBytes >= data.length) break;
    const turn = maybeYield();
    if (turn) await turn;
  }
  return out;
}
