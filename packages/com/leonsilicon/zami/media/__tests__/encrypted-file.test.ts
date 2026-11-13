import { expect, test } from "vite-plus/test";
// The Zami version of Zam's own encryptAttachment, which the native module's output must
// match field for field.
// oxlint-disable-next-line flatcap/no-workspace-import-bypass
import { encryptAttachment } from "../../../../../../src/lib/utils/encryptAttachment.zami.ts";
import { encryptedFileJson, nativeCipher, paddedBase64 } from "#encrypted-file";

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

test("writes the EncryptedFile exactly as Zam's encryptAttachment does", async () => {
  // The same key and IV for both: what encryptAttachment draws, and what the native
  // module would return for them (standard, padded base64).
  const draws = [
    Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 250) & 0xff),
    Uint8Array.from({ length: 8 }, (_, i) => 0xf8 + i),
  ];
  let draw = 0;
  const plaintext = new TextEncoder().encode("a picture, as far as anyone can tell");
  const { data, info } = await encryptAttachment(plaintext.buffer, crypto.subtle, (array) => {
    array.set(draws[draw++] ?? []);
    return array;
  });
  const iv = new Uint8Array(16);
  iv.set(draws[1] ?? []);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));

  const native = encryptedFileJson({
    key: base64(draws[0] ?? new Uint8Array()),
    iv: base64(iv),
    sha256: base64(hash),
  });
  expect(native).toEqual(info);
  // Field order too: the event content is serialized as it is built.
  expect(JSON.stringify(native)).toBe(JSON.stringify(info));
  expect(native.key.k).not.toMatch(/[+/=]/);
  expect(native.iv).not.toMatch(/=/);
  expect(native.hashes.sha256).not.toMatch(/=/);
});

test("reads a received EncryptedFile into the native module's form", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
  const iv = Uint8Array.from({ length: 16 }, (_, i) => (i < 8 ? 0xfb + i : 0));
  const hash = Uint8Array.from({ length: 32 }, (_, i) => i * 8);
  const file = {
    url: "mxc://example.org/abc",
    ...encryptedFileJson({ key: base64(key), iv: base64(iv), sha256: base64(hash) }),
  };
  expect(nativeCipher(file)).toEqual({
    key: base64(key),
    iv: base64(iv),
    sha256: base64(hash),
  });
  // Padded or URL-safe input reads the same.
  expect(paddedBase64(`${file.iv}==`, 16, "IV")).toBe(base64(iv));
});

test("refuses a key, IV or hash that is missing or the wrong size", () => {
  const ok = {
    url: "mxc://s/m",
    key: { k: "A".repeat(43) },
    iv: "A".repeat(22),
    hashes: { sha256: "A".repeat(43) },
  };
  expect(() => nativeCipher({ ...ok, key: { k: "" } })).toThrow(/missing its key/);
  expect(() => nativeCipher({ ...ok, iv: "" })).toThrow(/missing its IV/);
  expect(() => nativeCipher({ ...ok, hashes: { sha256: "" } })).toThrow(/integrity hash/);
  expect(() => nativeCipher({ ...ok, key: { k: "A".repeat(22) } })).toThrow(/key is not 32 bytes/);
  expect(() => nativeCipher({ ...ok, iv: "A".repeat(43) })).toThrow(/IV is not 16 bytes/);
  expect(() => nativeCipher({ ...ok, iv: "!".repeat(22) })).toThrow(/not base64/);
});
