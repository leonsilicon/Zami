// The native half (ios/ZamiWebCryptoModule.swift): CommonCrypto, off the JS thread, for
// what's slow in pure JS on Hermes. It isn't there in Node (the tests) or on Android yet,
// where everything runs on @noble.
import type { HashName } from "#algorithms";

/** The native module's functions. Their arguments are already checked; they only compute. */
export interface NativeCrypto {
  digest(hash: HashName, data: Uint8Array): Promise<Uint8Array>;
  hmac(hash: HashName, key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  /** CTR over the whole 16-byte counter block, counting big-endian, as noble's `ctr`. */
  aesCtr(key: Uint8Array, counter: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  pbkdf2(
    hash: HashName,
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    length: number,
  ): Promise<Uint8Array>;
}

/**
 * The native module, if the app has it. It's looked up on each call, where Expo puts
 * native modules (`globalThis.expo.modules`), so it needs no React Native import.
 */
export function nativeCrypto(): NativeCrypto | null {
  const host = globalThis as { expo?: { modules?: { ZamiWebCrypto?: NativeCrypto } } };
  return host.expo?.modules?.ZamiWebCrypto ?? null;
}
