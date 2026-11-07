const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CODES = Uint8Array.from(ALPHABET, (char) => char.charCodeAt(0));
const PAD = "=".charCodeAt(0);
// Base64 is ASCII, which UTF-8 decodes as it is: one native call instead of a string per byte.
const ascii = new TextDecoder();

/** `bytes` in base64, padded, as `FileReader.readAsDataURL` writes it. */
export function encodeBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let at = 0;
  let i = 0;
  const code = (sextet: number) => CODES[sextet & 63] ?? PAD;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out[at++] = code(triple >> 18);
    out[at++] = code(triple >> 12);
    out[at++] = code(triple >> 6);
    out[at++] = code(triple);
  }
  const rest = bytes.length - i;
  if (rest > 0) {
    const triple = ((bytes[i] ?? 0) << 16) | (rest === 2 ? (bytes[i + 1] ?? 0) << 8 : 0);
    out[at++] = code(triple >> 18);
    out[at++] = code(triple >> 12);
    out[at++] = rest === 2 ? code(triple >> 6) : PAD;
    out[at++] = PAD;
  }
  return ascii.decode(out);
}
