// The calls matrix-js-sdk (lib/) and Zam's logic (src/**/*.zami.ts) make, as they make
// them, with this package's subtle on one side and Node's on the other.
import { describe, expect, test } from "vite-plus/test";
import { subtle, type Subtle } from "#subtle";
import { bytes, expectDOMException, hex, node, utf8 } from "./helpers.ts";

const SIDES = [
  ["ours", subtle],
  ["Node's", node],
] as const;
/** Each way round: one side does the first half, the other the second. */
const PAIRS = [
  [subtle, node],
  [node, subtle],
] as const;

const base64 = (data: Uint8Array) => Buffer.from(data).toString("base64");
const base64url = (data: Uint8Array) => Buffer.from(data).toString("base64url");
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

// matrix-js-sdk: lib/utils/internal/deriveKeys.js
async function deriveKeys(s: Subtle, key: Uint8Array<ArrayBuffer>, name: string) {
  const hkdfkey = await s.importKey("raw", key, { name: "HKDF" }, false, ["deriveBits"]);
  const keybits = await s.deriveBits(
    { name: "HKDF", salt: new Uint8Array(8), info: utf8(name), hash: "SHA-256" },
    hkdfkey,
    512,
  );
  return Promise.all([
    s.importKey("raw", keybits.slice(0, 32), { name: "AES-CTR" }, false, ["encrypt", "decrypt"]),
    s.importKey("raw", keybits.slice(32), { name: "HMAC", hash: { name: "SHA-256" } }, false, [
      "sign",
      "verify",
    ]),
  ]);
}

// matrix-js-sdk: lib/utils/encryptAESSecretStorageItem.js
async function encryptSecret(
  s: Subtle,
  data: string,
  key: Uint8Array<ArrayBuffer>,
  name: string,
  iv: Uint8Array<ArrayBuffer>,
) {
  const [aesKey, hmacKey] = await deriveKeys(s, key, name);
  const ciphertext = await s.encrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    aesKey,
    utf8(data),
  );
  const hmac = await s.sign({ name: "HMAC" }, hmacKey, ciphertext);
  return {
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
    mac: base64(new Uint8Array(hmac)),
  };
}

// matrix-js-sdk: lib/utils/decryptAESSecretStorageItem.js
async function decryptSecret(
  s: Subtle,
  data: { iv: string; ciphertext: string; mac: string },
  key: Uint8Array<ArrayBuffer>,
  name: string,
) {
  const [aesKey, hmacKey] = await deriveKeys(s, key, name);
  const ciphertext = fromBase64(data.ciphertext);
  if (!(await s.verify({ name: "HMAC" }, hmacKey, fromBase64(data.mac), ciphertext))) {
    throw new Error(`Error decrypting secret ${name}: bad MAC`);
  }
  const plaintext = await s.decrypt(
    { name: "AES-CTR", counter: fromBase64(data.iv), length: 64 },
    aesKey,
    ciphertext,
  );
  return new TextDecoder().decode(new Uint8Array(plaintext));
}

// Zam: src/lib/utils/keyExportFile.zami.ts (deriveKeys, then the file's body)
async function keyExportKeys(
  s: Subtle,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  rounds: number,
) {
  const base = await s.importKey("raw", utf8(passphrase), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  const bits = new Uint8Array(
    await s.deriveBits({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-512" }, base, 512),
  );
  return Promise.all([
    s.importKey("raw", bits.slice(0, 32), { name: "AES-CTR" }, false, ["encrypt", "decrypt"]),
    s.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]),
  ]);
}

describe("matrix-js-sdk", () => {
  test("sha256 (lib/digest.js), as OAuth's PKCE uses it: RFC 7636's example", async () => {
    for (const [, s] of SIDES) {
      const digest = await s.digest("SHA-256", utf8("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
      expect(base64url(new Uint8Array(digest))).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
  });

  test("deriveRecoveryKeyFromPassphrase (lib/crypto-api/key-passphrase.js)", async () => {
    const derive = async (s: Subtle, numBits: number) => {
      const key = await s.importKey(
        "raw",
        utf8("correct horse battery staple"),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
      );
      const bits = await s.deriveBits(
        { name: "PBKDF2", salt: utf8("KbGLLxYSsEv0fQmlTYzc"), iterations: 5000, hash: "SHA-512" },
        key,
        numBits,
      );
      return hex(new Uint8Array(bits));
    };
    for (const numBits of [256, 512]) {
      expect(await derive(subtle, numBits)).toBe(await derive(node, numBits));
    }
  });

  test("secret storage items (lib/utils/{en,de}cryptAESSecretStorageItem.js), each way round", async () => {
    const key = bytes(32);
    const iv = bytes(16);
    iv[8]! &= 0x7f;
    const secret = "the cross-signing master key ✓";
    for (const [encrypting, decrypting] of PAIRS) {
      const item = await encryptSecret(encrypting, secret, key, "m.cross_signing.master", iv);
      expect(item).toEqual(await encryptSecret(node, secret, key, "m.cross_signing.master", iv));
      expect(await decryptSecret(decrypting, item, key, "m.cross_signing.master")).toBe(secret);
      // Another secret's name derives other keys, so the MAC doesn't match.
      await expect(decryptSecret(decrypting, item, key, "m.megolm_backup.v1")).rejects.toThrow(
        "bad MAC",
      );
    }
  });
});

describe("Zam", () => {
  test("encryptAttachment and decryptAttachment (src/lib/utils/*Attachment.zami.ts), each way round", async () => {
    const plaintext = bytes(100_003);
    for (const [encrypting, decrypting] of PAIRS) {
      // encryptAttachment
      const keyBytes = bytes(32, 2);
      const iv = new Uint8Array(16);
      iv.set(bytes(8, 3), 0);
      const key = await encrypting.importKey("raw", keyBytes, { name: "AES-CTR" }, false, [
        "encrypt",
      ]);
      const data = await encrypting.encrypt(
        { name: "AES-CTR", counter: iv, length: 64 },
        key,
        plaintext.buffer,
      );
      const digest = await encrypting.digest("SHA-256", data);
      const info = {
        key: {
          kty: "oct",
          alg: "A256CTR",
          ext: true,
          key_ops: ["encrypt", "decrypt"],
          k: base64url(keyBytes),
        },
        iv: base64(iv),
        hashes: { sha256: base64(new Uint8Array(digest)) },
      };

      // decryptAttachment
      expect(base64(new Uint8Array(await decrypting.digest("SHA-256", data)))).toBe(
        info.hashes.sha256,
      );
      const decryptKey = await decrypting.importKey(
        "raw",
        new Uint8Array(Buffer.from(info.key.k, "base64url")),
        { name: "AES-CTR" },
        false,
        ["decrypt"],
      );
      const counter = fromBase64(info.iv);
      const decrypted = await decrypting.decrypt(
        { name: "AES-CTR", counter, length: 64 },
        decryptKey,
        data,
      );
      expect(hex(decrypted)).toBe(hex(plaintext));

      // Other Matrix clients import the JWK itself (Node's can, ours needn't).
      const jwkKey = await globalThis.crypto.subtle.importKey(
        "jwk",
        info.key,
        { name: "AES-CTR" },
        false,
        ["decrypt"],
      );
      expect(
        hex(
          await globalThis.crypto.subtle.decrypt(
            { name: "AES-CTR", counter, length: 64 },
            jwkKey,
            data,
          ),
        ),
      ).toBe(hex(plaintext));
    }
  });

  test("createStreamDecryptor (src/lib/utils/decryptAttachment.zami.ts), across the 64-bit counter's wrap", async () => {
    const keyBytes = bytes(32);
    // Two blocks short of wrapping, so chunks after the first cross it.
    const iv = new Uint8Array(16);
    iv.set(bytes(8), 0);
    new DataView(iv.buffer).setBigUint64(8, 2n ** 64n - 2n);
    const plaintext = bytes(1000);
    const nodeKey = await node.importKey("raw", keyBytes, "AES-CTR", false, ["encrypt"]);
    const ciphertext = new Uint8Array(
      await node.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, nodeKey, plaintext),
    );

    const key = await subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, ["decrypt"]);
    const counterAt = (blockIndex: bigint) => {
      const out = new Uint8Array(iv);
      const view = new DataView(out.buffer);
      view.setBigUint64(8, (view.getBigUint64(8) + blockIndex) & (2n ** 64n - 1n));
      return out;
    };
    const parts: Uint8Array[] = [];
    let carry = new Uint8Array(0);
    let blocks = 0n;
    for (let at = 0; at < ciphertext.length; at += 37) {
      const data = new Uint8Array([...carry, ...ciphertext.subarray(at, at + 37)]);
      const usable = data.length - (data.length % 16);
      carry = data.slice(usable);
      if (usable === 0) continue;
      parts.push(
        new Uint8Array(
          await subtle.decrypt(
            { name: "AES-CTR", counter: counterAt(blocks), length: 64 },
            key,
            data.subarray(0, usable),
          ),
        ),
      );
      blocks += BigInt(usable / 16);
    }
    parts.push(
      new Uint8Array(
        await subtle.decrypt(
          { name: "AES-CTR", counter: counterAt(blocks), length: 64 },
          key,
          carry,
        ),
      ),
    );
    expect(hex(new Uint8Array(parts.flatMap((part) => [...part])))).toBe(hex(plaintext));
    // decryptAttachment's single call wraps too.
    const whole = await subtle.decrypt(
      { name: "AES-CTR", counter: iv, length: 64 },
      key,
      ciphertext,
    );
    expect(hex(whole)).toBe(hex(plaintext));
    expect(hex(await subtle.digest("SHA-256", ciphertext))).toBe(
      hex(await node.digest("SHA-256", ciphertext)),
    );
  });

  test("key export files (src/lib/utils/keyExportFile.zami.ts), each way round", async () => {
    const json = JSON.stringify([{ room_id: "!room:example.org", session_key: "AQID" }]);
    const salt = bytes(16);
    const iv = bytes(16, 2);
    iv[8]! &= 0x7f;
    const rounds = 1000;
    for (const [encrypting, decrypting] of PAIRS) {
      // encryptKeyExportFile
      const [aesKey, hmacKey] = await keyExportKeys(encrypting, "passphrase", salt, rounds);
      const ciphertext = new Uint8Array(
        await encrypting.encrypt({ name: "AES-CTR", counter: iv, length: 64 }, aesKey, utf8(json)),
      );
      const body = new Uint8Array(37 + ciphertext.length + 32);
      body[0] = 1;
      body.set(salt, 1);
      body.set(iv, 17);
      new DataView(body.buffer).setUint32(33, rounds);
      body.set(ciphertext, 37);
      const signed = body.subarray(0, 37 + ciphertext.length);
      body.set(
        new Uint8Array(await encrypting.sign("HMAC", hmacKey, signed)),
        37 + ciphertext.length,
      );

      // decryptKeyExportFile
      const [aes, hmac] = await keyExportKeys(decrypting, "passphrase", body.slice(1, 17), rounds);
      const macStart = body.length - 32;
      expect(
        await decrypting.verify("HMAC", hmac, body.slice(macStart), body.slice(0, macStart)),
      ).toBe(true);
      const plain = await decrypting.decrypt(
        { name: "AES-CTR", counter: body.slice(17, 33), length: 64 },
        aes,
        body.slice(37, macStart),
      );
      expect(new TextDecoder().decode(plain)).toBe(json);

      const [, wrongHmac] = await keyExportKeys(decrypting, "wrong", body.slice(1, 17), rounds);
      expect(
        await decrypting.verify("HMAC", wrongHmac, body.slice(macStart), body.slice(0, macStart)),
      ).toBe(false);
    }
  });

  test("file transfer blocks (src/lib/utils/fileTransfer.zami.ts), each way round", async () => {
    const aad = (index: number) => utf8(`zam-file-v1|transfer|${index}|5000`);
    for (const [sealing, opening] of PAIRS) {
      const raw = bytes(32);
      const sealKey = await sealing.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      const openKey = await opening.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      // sealBlock
      const iv = bytes(12, 7);
      const block = bytes(4096);
      const sealed = await sealing.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(3) },
        sealKey,
        block,
      );
      const out = new Uint8Array(12 + sealed.byteLength);
      out.set(iv);
      out.set(new Uint8Array(sealed), 12);
      // openBlock
      const open = (index: number) =>
        opening.decrypt(
          { name: "AES-GCM", iv: out.subarray(0, 12), additionalData: aad(index) },
          openKey,
          out.subarray(12),
        );
      expect(hex(await open(3))).toBe(hex(block));
      // A block moved to another place in the file doesn't open.
      if (opening === subtle) await expectDOMException(open(4), "OperationError");
      else await expect(open(4)).rejects.toThrow();
      // BlockHashes
      expect(hex(await sealing.digest("SHA-256", block))).toBe(
        hex(await opening.digest("SHA-256", block)),
      );
    }
  });

  test("a call's media key (src/lib/matrix/livekitCall.zami.ts)", async () => {
    const args = ["raw", bytes(16), "HKDF", false, ["deriveBits", "deriveKey"]] as const;
    const ours = await subtle.importKey(...args);
    const theirs = await node.importKey(...args);
    expect({
      algorithm: ours.algorithm,
      usages: ours.usages,
      extractable: ours.extractable,
    }).toEqual({
      algorithm: theirs.algorithm,
      usages: theirs.usages,
      extractable: theirs.extractable,
    });
  });

  test("a plugin file's hash (src/lib/plugins/pluginAssets.zami.ts)", async () => {
    const file = bytes(5000).buffer;
    expect(hex(await subtle.digest("SHA-256", file))).toBe(hex(await node.digest("SHA-256", file)));
  });
});
