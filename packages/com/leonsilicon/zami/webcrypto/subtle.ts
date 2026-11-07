// WebCrypto's SubtleCrypto, for what Zam and matrix-js-sdk use (see README.md). Every
// method is async, so a bad argument rejects rather than throws, and copies its byte
// inputs before it returns. Results are ArrayBuffers.
import { ctr, gcm } from "@noble/ciphers/aes.js";
import { equalBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import {
  HASHES,
  normalizeCipher,
  normalizeDerive,
  normalizeHash,
  normalizeImport,
  normalizeSign,
  unsignedLong,
  type AesCtrParams,
  type AesGcmParams,
  type AlgorithmIdentifier,
  type CipherAlgorithm,
  type HkdfParams,
  type HmacImportParams,
  type Pbkdf2Params,
} from "#algorithms";
import { copyBytes, toArrayBuffer, type BufferSource } from "#bytes";
import { cryptoError } from "#errors";
import {
  createKey,
  KEY_USAGES,
  keySlots,
  useKey,
  type CryptoKey,
  type KeyAlgorithm,
  type KeyUsage,
} from "#key";

const KEY_FORMATS: readonly string[] = ["raw", "spki", "pkcs8", "jwk"];

/** The usages each algorithm's keys may have. */
const ALLOWED_USAGES: Record<KeyAlgorithm["name"], readonly KeyUsage[]> = {
  "AES-CTR": ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  "AES-GCM": ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  HMAC: ["sign", "verify"],
  HKDF: ["deriveKey", "deriveBits"],
  PBKDF2: ["deriveKey", "deriveBits"],
};

const AES_BLOCK = 16;
const AES_KEY_BYTES: readonly number[] = [16, 24, 32];
const GCM_TAG_BITS: readonly number[] = [32, 64, 96, 104, 112, 120, 128];

function isKeyUsage(value: string): value is KeyUsage {
  return (KEY_USAGES as readonly string[]).includes(value);
}

/** A sequence<KeyUsage>: anything iterable but a string, holding only KeyUsages. */
function keyUsages(value: unknown): KeyUsage[] {
  if (typeof value !== "object" || value === null || !(Symbol.iterator in value)) {
    throw new TypeError("keyUsages is not a sequence");
  }
  return Array.from(value as Iterable<unknown>, (item) => {
    const usage = String(item);
    if (!isKeyUsage(usage)) throw new TypeError(`${usage} is not a KeyUsage`);
    return usage;
  });
}

function toBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function fromBigInt(value: bigint, length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let i = length - 1, rest = value; i >= 0; i--, rest >>= 8n) bytes[i] = Number(rest & 0xffn);
  return bytes;
}

function aesCtr(
  secret: Uint8Array,
  { counter, length }: Extract<CipherAlgorithm, { name: "AES-CTR" }>,
  data: Uint8Array,
): Uint8Array {
  if (counter.length !== AES_BLOCK) {
    throw cryptoError("OperationError", "AesCtrParams.counter must be 16 bytes");
  }
  if (length === 0 || length > 128) {
    throw cryptoError("OperationError", "AesCtrParams.length must be between 1 and 128");
  }
  // The counter block's low `length` bits count blocks, and wrap without carrying into
  // the rest (NIST SP 800-38A, appendix B.1). Noble's counter is the whole block, so a
  // message whose count wraps is two runs: up to the wrap, then from a count of 0.
  const blocks = BigInt(Math.ceil(data.length / AES_BLOCK));
  const mask = (1n << BigInt(length)) - 1n;
  const start = toBigInt(counter);
  if (blocks > mask + 1n) {
    throw cryptoError(
      "OperationError",
      "The data is too long for AesCtrParams.length: counters would repeat",
    );
  }
  const beforeWrap = mask - (start & mask) + 1n;
  if (blocks <= beforeWrap) return ctr(secret, counter).encrypt(data);
  const split = Number(beforeWrap) * AES_BLOCK;
  const out = new Uint8Array(data.length);
  out.set(ctr(secret, counter).encrypt(data.subarray(0, split)));
  out.set(ctr(secret, fromBigInt(start & ~mask, AES_BLOCK)).encrypt(data.subarray(split)), split);
  return out;
}

function aesGcm(
  operation: "encrypt" | "decrypt",
  secret: Uint8Array,
  { iv, additionalData, tagLength = 128 }: Extract<CipherAlgorithm, { name: "AES-GCM" }>,
  data: Uint8Array,
): Uint8Array {
  if (!GCM_TAG_BITS.includes(tagLength)) {
    throw cryptoError("OperationError", `${tagLength} is not a valid AES-GCM tag length`);
  }
  if (tagLength !== 128) {
    throw cryptoError("NotSupportedError", "AES-GCM tags shorter than 128 bits aren't implemented");
  }
  if (iv.length === 0) throw cryptoError("OperationError", "AesGcmParams.iv can't be empty");
  if (iv.length < 8) {
    throw cryptoError("NotSupportedError", "AES-GCM ivs shorter than 8 bytes aren't implemented");
  }
  const cipher = gcm(secret, iv, additionalData);
  if (operation === "encrypt") return cipher.encrypt(data);
  if (data.length < tagLength / 8) {
    throw cryptoError("OperationError", "The data is shorter than an AES-GCM tag");
  }
  try {
    return cipher.decrypt(data);
  } catch {
    throw cryptoError("OperationError", "The data, key, iv or additional data is wrong");
  }
}

function crypt(
  operation: "encrypt" | "decrypt",
  algorithm: unknown,
  key: unknown,
  data: unknown,
): ArrayBuffer {
  const slots = keySlots(key, "key");
  const bytes = copyBytes(data, "data");
  const normalized = normalizeCipher(algorithm, operation);
  const { secret } = useKey(slots, normalized.name, operation);
  return toArrayBuffer(
    normalized.name === "AES-CTR"
      ? aesCtr(secret, normalized, bytes)
      : aesGcm(operation, secret, normalized, bytes),
  );
}

function mac(key: CryptoKey, usage: "sign" | "verify", algorithm: unknown, data: unknown) {
  const slots = keySlots(key, "key");
  const bytes = copyBytes(data, "data");
  const name = normalizeSign(algorithm, usage);
  const { algorithm: keyAlgorithm, secret } = useKey(slots, name, usage);
  return hmac(HASHES[keyAlgorithm.hash.name], secret, bytes);
}

async function digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
  const bytes = copyBytes(data, "data");
  return toArrayBuffer(HASHES[normalizeHash(algorithm)](bytes));
}

/** Imports raw secret keys: the only format Zam and matrix-js-sdk import. */
async function importKey(
  format: "raw",
  keyData: BufferSource,
  algorithm: AlgorithmIdentifier | HmacImportParams,
  extractable: boolean,
  usages: Iterable<KeyUsage>,
): Promise<CryptoKey> {
  const keyFormat = String(format);
  if (!KEY_FORMATS.includes(keyFormat)) throw new TypeError(`${keyFormat} is not a KeyFormat`);
  const requested = keyUsages(usages);
  const normalized = normalizeImport(algorithm);
  if (keyFormat !== "raw") {
    throw cryptoError(
      "NotSupportedError",
      `Importing ${keyFormat} keys isn't implemented: only raw ${normalized.name} keys are`,
    );
  }
  const secret = copyBytes(keyData, "keyData");
  const unusable = requested.find((usage) => !ALLOWED_USAGES[normalized.name].includes(usage));
  if (unusable !== undefined) {
    throw cryptoError("SyntaxError", `${normalized.name} keys can't have the ${unusable} usage`);
  }
  let keyAlgorithm: KeyAlgorithm;
  switch (normalized.name) {
    case "AES-CTR":
    case "AES-GCM": {
      if (!AES_KEY_BYTES.includes(secret.length)) {
        throw cryptoError("DataError", "AES keys are 128, 192 or 256 bits long");
      }
      keyAlgorithm = { name: normalized.name, length: secret.length * 8 };
      break;
    }
    case "HMAC": {
      const bits = secret.length * 8;
      if (bits === 0) throw cryptoError("DataError", "HMAC keys can't be empty");
      const length = normalized.length ?? bits;
      if (length > bits || length <= bits - 8) {
        throw cryptoError("DataError", "HmacImportParams.length doesn't match the key");
      }
      if (length !== bits) {
        throw cryptoError("NotSupportedError", "HMAC keys of a part of a byte aren't implemented");
      }
      keyAlgorithm = { name: normalized.name, length, hash: { name: normalized.hash } };
      break;
    }
    case "HKDF":
    case "PBKDF2": {
      if (extractable) {
        throw cryptoError("SyntaxError", `${normalized.name} keys can't be extractable`);
      }
      keyAlgorithm = { name: normalized.name };
      break;
    }
  }
  if (requested.length === 0) throw cryptoError("SyntaxError", "A secret key needs a usage");
  return createKey(keyAlgorithm, Boolean(extractable), requested, secret);
}

async function encrypt(
  algorithm: AesCtrParams | AesGcmParams,
  key: CryptoKey,
  data: BufferSource,
): Promise<ArrayBuffer> {
  return crypt("encrypt", algorithm, key, data);
}

async function decrypt(
  algorithm: AesCtrParams | AesGcmParams,
  key: CryptoKey,
  data: BufferSource,
): Promise<ArrayBuffer> {
  return crypt("decrypt", algorithm, key, data);
}

async function sign(
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  data: BufferSource,
): Promise<ArrayBuffer> {
  return toArrayBuffer(mac(key, "sign", algorithm, data));
}

async function verify(
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  signature: BufferSource,
  data: BufferSource,
): Promise<boolean> {
  keySlots(key, "key");
  const expected = copyBytes(signature, "signature");
  return equalBytes(mac(key, "verify", algorithm, data), expected);
}

async function deriveBits(
  algorithm: HkdfParams | Pbkdf2Params,
  baseKey: CryptoKey,
  length?: number | null,
): Promise<ArrayBuffer> {
  const slots = keySlots(baseKey, "baseKey");
  const bits = length === undefined || length === null ? null : unsignedLong(length, "length");
  const normalized = normalizeDerive(algorithm);
  const { secret } = useKey(slots, normalized.name, "deriveBits");
  if (bits === null) throw cryptoError("OperationError", "deriveBits needs a length");
  if (bits % 8 !== 0) throw cryptoError("OperationError", "The length must be a multiple of 8");
  const bytes = bits / 8;
  const hash = HASHES[normalized.hash];
  if (normalized.name === "HKDF") {
    if (bytes > 255 * hash.outputLen) {
      throw cryptoError("OperationError", "HKDF can't derive that many bits with this hash");
    }
    return toArrayBuffer(hkdf(hash, secret, normalized.salt, normalized.info, bytes));
  }
  if (normalized.iterations === 0) {
    throw cryptoError("OperationError", "Pbkdf2Params.iterations can't be 0");
  }
  if (bytes === 0) return new ArrayBuffer(0);
  // The async version yields to the event loop as it goes: Matrix's passphrases take
  // hundreds of thousands of iterations.
  const options = { c: normalized.iterations, dkLen: bytes };
  return toArrayBuffer(await pbkdf2Async(hash, secret, normalized.salt, options));
}

/**
 * The part of WebCrypto's `crypto.subtle` that Zam and matrix-js-sdk use. Its methods
 * don't need `this`, so they can be called detached.
 */
export const subtle = { digest, importKey, encrypt, decrypt, sign, verify, deriveBits };
export type Subtle = typeof subtle;
