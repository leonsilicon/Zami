// WebCrypto's algorithm normalization, for the algorithms this package implements: a
// name matches ignoring ASCII case, a missing required member is a TypeError, a name the
// operation doesn't support is a NotSupportedError, and byte members are copied.
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { copyBytes, type BufferSource } from "#bytes";
import { cryptoError } from "#errors";

/** The hash functions, by WebCrypto name. */
export const HASHES = { "SHA-256": sha256, "SHA-512": sha512 } as const;
export type HashName = keyof typeof HASHES;
const HASH_NAMES = Object.keys(HASHES) as HashName[];

export interface Algorithm {
  name: string;
}
export type AlgorithmIdentifier = string | Algorithm;
export interface AesCtrParams extends Algorithm {
  counter: BufferSource;
  length: number;
}
export interface AesGcmParams extends Algorithm {
  iv: BufferSource;
  additionalData?: BufferSource;
  tagLength?: number;
}
export interface HmacImportParams extends Algorithm {
  hash: AlgorithmIdentifier;
  length?: number;
}
export interface HkdfParams extends Algorithm {
  hash: AlgorithmIdentifier;
  salt: BufferSource;
  info: BufferSource;
}
export interface Pbkdf2Params extends Algorithm {
  hash: AlgorithmIdentifier;
  salt: BufferSource;
  iterations: number;
}

export type ImportAlgorithm =
  | { name: "AES-CTR" | "AES-GCM" }
  | { name: "HMAC"; hash: HashName; length: number | undefined }
  | { name: "HKDF" | "PBKDF2" };
export type CipherAlgorithm =
  | { name: "AES-CTR"; counter: Uint8Array<ArrayBuffer>; length: number }
  | {
      name: "AES-GCM";
      iv: Uint8Array<ArrayBuffer>;
      additionalData: Uint8Array<ArrayBuffer> | undefined;
      tagLength: number | undefined;
    };
export type DeriveAlgorithm =
  | {
      name: "HKDF";
      hash: HashName;
      salt: Uint8Array<ArrayBuffer>;
      info: Uint8Array<ArrayBuffer>;
    }
  | { name: "PBKDF2"; hash: HashName; salt: Uint8Array<ArrayBuffer>; iterations: number };

type Dictionary = Record<string, unknown>;

const OCTET = 0xff;
const UNSIGNED_LONG = 0xffff_ffff;

/** An AlgorithmIdentifier as a dictionary: a string names one with no other members. */
function dictionary(algorithm: unknown): Dictionary {
  if ((typeof algorithm !== "object" || algorithm === null) && typeof algorithm !== "function") {
    return { name: String(algorithm) };
  }
  const dict = algorithm as Dictionary;
  if (dict.name === undefined) throw new TypeError("The algorithm has no name");
  return dict;
}

function recognize<const Name extends string>(
  dict: Dictionary,
  names: readonly Name[],
  operation: string,
): Name {
  const name = String(dict.name);
  const upperCase = name.replace(/[a-z]+/g, (letters) => letters.toUpperCase());
  const found = names.find((candidate) => candidate === upperCase);
  if (found === undefined) {
    throw cryptoError("NotSupportedError", `Unrecognized algorithm name for ${operation}: ${name}`);
  }
  return found;
}

function member(dict: Dictionary, key: string, params: string): unknown {
  const value = dict[key];
  if (value === undefined) throw new TypeError(`${params}.${key} is required`);
  return value;
}

/** A WebIDL integer with [EnforceRange]: one that's not finite or is out of range is a TypeError. */
function integer(value: unknown, max: number, what: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${what} is not a finite number`);
  const truncated = Math.trunc(number) || 0;
  if (truncated < 0 || truncated > max) {
    throw new TypeError(`${what} is outside the range 0 to ${max}`);
  }
  return truncated;
}

export function unsignedLong(value: unknown, what: string): number {
  return integer(value, UNSIGNED_LONG, what);
}

export function normalizeHash(algorithm: unknown): HashName {
  return recognize(dictionary(algorithm), HASH_NAMES, "digest");
}

export function normalizeImport(algorithm: unknown): ImportAlgorithm {
  const dict = dictionary(algorithm);
  const name = recognize(dict, ["AES-CTR", "AES-GCM", "HMAC", "HKDF", "PBKDF2"], "importKey");
  if (name !== "HMAC") return { name };
  return {
    name,
    hash: normalizeHash(member(dict, "hash", "HmacImportParams")),
    length:
      dict.length === undefined ? undefined : unsignedLong(dict.length, "HmacImportParams.length"),
  };
}

export function normalizeCipher(
  algorithm: unknown,
  operation: "encrypt" | "decrypt",
): CipherAlgorithm {
  const dict = dictionary(algorithm);
  const name = recognize(dict, ["AES-CTR", "AES-GCM"], operation);
  if (name === "AES-CTR") {
    return {
      name,
      counter: copyBytes(member(dict, "counter", "AesCtrParams"), "AesCtrParams.counter"),
      length: integer(member(dict, "length", "AesCtrParams"), OCTET, "AesCtrParams.length"),
    };
  }
  return {
    name,
    iv: copyBytes(member(dict, "iv", "AesGcmParams"), "AesGcmParams.iv"),
    additionalData:
      dict.additionalData === undefined
        ? undefined
        : copyBytes(dict.additionalData, "AesGcmParams.additionalData"),
    tagLength:
      dict.tagLength === undefined
        ? undefined
        : integer(dict.tagLength, OCTET, "AesGcmParams.tagLength"),
  };
}

export function normalizeSign(algorithm: unknown, operation: "sign" | "verify"): "HMAC" {
  return recognize(dictionary(algorithm), ["HMAC"], operation);
}

export function normalizeDerive(algorithm: unknown): DeriveAlgorithm {
  const dict = dictionary(algorithm);
  const name = recognize(dict, ["HKDF", "PBKDF2"], "deriveBits");
  const params = name === "HKDF" ? "HkdfParams" : "Pbkdf2Params";
  const hash = normalizeHash(member(dict, "hash", params));
  const salt = copyBytes(member(dict, "salt", params), `${params}.salt`);
  if (name === "HKDF") {
    return { name, hash, salt, info: copyBytes(member(dict, "info", params), `${params}.info`) };
  }
  return {
    name,
    hash,
    salt,
    iterations: unsignedLong(member(dict, "iterations", params), `${params}.iterations`),
  };
}
