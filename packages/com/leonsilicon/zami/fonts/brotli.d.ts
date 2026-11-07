// brotli's pure-JavaScript decoder (CommonJS, untyped).
declare module "brotli/decompress.js" {
  /** Decompresses a Brotli stream, computing the output size if it isn't given. */
  export default function decompress(buffer: Uint8Array, outSize?: number): Uint8Array;
}
