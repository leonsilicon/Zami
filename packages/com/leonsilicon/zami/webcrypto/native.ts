// The native half, off the JS thread, for what's slow in pure JS on Hermes:
// ios/ZamiWebCryptoModule.swift (CommonCrypto, CryptoKit) and
// android/…/ZamiWebCryptoModule.kt (javax.crypto). It isn't there in Node (the tests),
// where everything runs on @noble.
import type { HashName } from "#algorithms";

/** The native module's functions. Their arguments are already checked; they only compute. */
export interface NativeCrypto {
  digest(hash: HashName, data: Uint8Array): Promise<Uint8Array>;
  hmac(hash: HashName, key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  /** CTR over the whole 16-byte counter block, counting big-endian, as noble's `ctr`. */
  aesCtr(key: Uint8Array, counter: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  /**
   * AES-GCM with a 128-bit tag and a 12-byte iv. Encrypting resolves to the ciphertext
   * then the tag, as WebCrypto's; decrypting takes them that way, and resolves null when
   * the data doesn't authenticate. A build of the app from before it was added lacks it.
   */
  aesGcm?(
    encrypt: boolean,
    key: Uint8Array,
    iv: Uint8Array,
    additionalData: Uint8Array,
    data: Uint8Array,
  ): Promise<Uint8Array | null>;
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

let warned = false;

/**
 * Runs `native` when the module is there, and `fallback` (@noble) when it isn't or when
 * the native call fails for a reason of its own (a key size the platform's provider
 * doesn't take, say): the result is the same either way, only slower in JS.
 */
export async function preferNative<T>(
  native: ((module: NativeCrypto) => Promise<T>) | null,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const module = native ? nativeCrypto() : null;
  if (!module || !native) return fallback();
  try {
    return await native(module);
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn("[webcrypto] the native module failed; computing in JS instead", error);
    }
    return fallback();
  }
}
