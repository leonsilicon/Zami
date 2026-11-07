import type { HashName } from "#algorithms";
import { cryptoError } from "#errors";

export type KeyUsage =
  | "encrypt"
  | "decrypt"
  | "sign"
  | "verify"
  | "deriveKey"
  | "deriveBits"
  | "wrapKey"
  | "unwrapKey";

/** Every KeyUsage, in the order WebCrypto lists a key's usages. */
export const KEY_USAGES: readonly KeyUsage[] = [
  "encrypt",
  "decrypt",
  "sign",
  "verify",
  "deriveKey",
  "deriveBits",
  "wrapKey",
  "unwrapKey",
];

export type KeyAlgorithm =
  | { readonly name: "AES-CTR"; readonly length: number }
  | { readonly name: "AES-GCM"; readonly length: number }
  | { readonly name: "HMAC"; readonly length: number; readonly hash: { readonly name: HashName } }
  | { readonly name: "HKDF" }
  | { readonly name: "PBKDF2" };

export interface KeySlots {
  readonly algorithm: KeyAlgorithm;
  readonly extractable: boolean;
  readonly usages: readonly KeyUsage[];
  readonly secret: Uint8Array<ArrayBuffer>;
}

// A key's internal slots. The secret lives here rather than on the key, so nothing
// outside this package can read it.
const slots = new WeakMap<object, KeySlots>();

/** A key's internal slots; a TypeError if it isn't one of this package's keys. */
export function keySlots(key: unknown, what: string): KeySlots {
  const found = typeof key === "object" && key !== null ? slots.get(key) : undefined;
  if (found === undefined) throw new TypeError(`${what} is not a CryptoKey`);
  return found;
}

/**
 * A key's algorithm and secret for an operation, once WebCrypto's checks pass: the
 * operation's algorithm is the key's, and the key was imported for this use.
 */
export function useKey<const Name extends KeyAlgorithm["name"]>(
  key: KeySlots,
  name: Name,
  usage: KeyUsage,
): { algorithm: Extract<KeyAlgorithm, { name: Name }>; secret: Uint8Array<ArrayBuffer> } {
  if (key.algorithm.name !== name)
    throw cryptoError("InvalidAccessError", "Key algorithm mismatch");
  if (!key.usages.includes(usage)) {
    throw cryptoError("InvalidAccessError", `The key's usages don't include ${usage}`);
  }
  return { algorithm: key.algorithm as Extract<KeyAlgorithm, { name: Name }>, secret: key.secret };
}

/**
 * WebCrypto's CryptoKey, for the secret keys this package imports. Like WebCrypto's, it
 * can't be constructed, and its properties are read-only accessors on the prototype.
 */
export class CryptoKey {
  constructor() {
    throw new TypeError("Illegal constructor");
  }

  get type(): "secret" {
    keySlots(this, "this");
    return "secret";
  }

  get extractable(): boolean {
    return keySlots(this, "this").extractable;
  }

  get algorithm(): KeyAlgorithm {
    return keySlots(this, "this").algorithm;
  }

  get usages(): readonly KeyUsage[] {
    return keySlots(this, "this").usages;
  }
}
Object.defineProperty(CryptoKey.prototype, Symbol.toStringTag, {
  value: "CryptoKey",
  configurable: true,
});

/**
 * A new key. Its algorithm and usages are frozen, so what it reports is what it's used
 * as; its usages are listed once each, in WebCrypto's order.
 */
export function createKey(
  algorithm: KeyAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
  secret: Uint8Array<ArrayBuffer>,
): CryptoKey {
  const key = Object.create(CryptoKey.prototype) as CryptoKey;
  slots.set(key, {
    algorithm: Object.freeze(
      "hash" in algorithm
        ? { ...algorithm, hash: Object.freeze({ ...algorithm.hash }) }
        : { ...algorithm },
    ),
    extractable,
    usages: Object.freeze(KEY_USAGES.filter((usage) => usages.includes(usage))),
    secret,
  });
  return key;
}
