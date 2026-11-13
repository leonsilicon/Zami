// Matrix's EncryptedFile (`content.file`), as matrix-js-sdk and Zam's encryptAttachment
// write it, from the native module's padded base64, and back.
import type { NativeCipher } from "#native";

/** The EncryptedFile metadata of an upload, without `url` (the caller adds it). */
export interface EncryptedFileJson {
  v: "v2";
  key: {
    kty: "oct";
    alg: "A256CTR";
    ext: true;
    key_ops: ["encrypt", "decrypt"];
    k: string;
  };
  iv: string;
  hashes: { sha256: string };
}

/** What a received EncryptedFile needs to have for its attachment to be decrypted. */
export interface EncryptedFileRef {
  url: string;
  key: { k: string };
  iv: string;
  hashes: { sha256: string };
}

/** Standard base64 without its padding, as the spec writes `iv` and `hashes`. */
function unpadded(base64: string): string {
  return base64.replace(/=+$/, "");
}

/** URL-safe base64 without padding, as a JWK's `k`. */
function urlSafe(base64: string): string {
  return unpadded(base64).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * The EncryptedFile for a native encryption: field for field what encryptAttachment
 * builds (v2, a JWK `oct`/`A256CTR` key, unpadded base64 IV and ciphertext hash).
 */
export function encryptedFileJson(cipher: NativeCipher): EncryptedFileJson {
  return {
    v: "v2",
    key: {
      kty: "oct",
      alg: "A256CTR",
      ext: true,
      key_ops: ["encrypt", "decrypt"],
      k: urlSafe(cipher.key),
    },
    iv: unpadded(cipher.iv),
    hashes: {
      sha256: unpadded(cipher.sha256),
    },
  };
}

/** Standard, padded base64 of `input` (standard or URL-safe, padded or not), checked to hold `bytes` bytes. */
export function paddedBase64(input: string, bytes: number, what: string): string {
  const standard = input.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(standard) || standard.length % 4 === 1) {
    throw new Error(`Encrypted file ${what} is not base64`);
  }
  const length = Math.floor((standard.length * 3) / 4);
  if (length !== bytes) throw new Error(`Encrypted file ${what} is not ${bytes} bytes`);
  return standard + "=".repeat((4 - (standard.length % 4)) % 4);
}

/**
 * A received EncryptedFile's key, IV and hash in the native module's form. Throws, as
 * decryptAttachment does, when one is missing or the wrong size.
 */
export function nativeCipher(file: EncryptedFileRef): NativeCipher {
  if (!file?.key?.k) throw new Error("Encrypted file is missing its key");
  if (!file.iv) throw new Error("Encrypted file is missing its IV");
  if (!file.hashes?.sha256) throw new Error("Encrypted file is missing its integrity hash");
  return {
    key: paddedBase64(file.key.k, 32, "key"),
    iv: paddedBase64(file.iv, 16, "IV"),
    sha256: paddedBase64(file.hashes.sha256, 32, "hash"),
  };
}
