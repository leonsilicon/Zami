import { describe, expect, test } from "vite-plus/test";
import { CryptoKey, type KeyUsage } from "#key";
import { subtle } from "#subtle";
import { bytes, expectDOMException, expectSameRejection, hex, loose, node } from "./helpers.ts";

const view = (key: {
  type: string;
  extractable: boolean;
  algorithm: unknown;
  usages: unknown;
}) => ({
  type: key.type,
  extractable: key.extractable,
  algorithm: key.algorithm,
  usages: key.usages,
});

describe("importKey and CryptoKey", () => {
  test("imported keys look like Node's", async () => {
    const cases: [number, unknown, boolean, KeyUsage[]][] = [
      [16, "AES-CTR", false, ["encrypt", "decrypt"]],
      [24, "aes-ctr", true, ["decrypt", "encrypt", "decrypt"]],
      [32, { name: "AES-CTR" }, false, ["encrypt"]],
      [32, "AES-CTR", false, ["unwrapKey", "wrapKey", "encrypt"]],
      [16, "AES-GCM", true, ["decrypt"]],
      [32, "AES-GCM", false, ["encrypt", "decrypt"]],
      [32, { name: "HMAC", hash: "SHA-256" }, false, ["verify", "sign"]],
      [100, { name: "hmac", hash: { name: "sha-512" } }, true, ["sign"]],
      [32, "HKDF", false, ["deriveBits", "deriveKey"]],
      [0, "HKDF", false, ["deriveBits"]],
      [10, "PBKDF2", false, ["deriveBits"]],
      [0, "PBKDF2", false, ["deriveKey"]],
    ];
    for (const [length, algorithm, extractable, usages] of cases) {
      const args = ["raw", bytes(length), algorithm, extractable, usages];
      const ours = (await loose(subtle).importKey(...args)) as CryptoKey;
      const theirs = (await loose(node).importKey(...args)) as CryptoKey;
      expect(view(ours)).toEqual(view(theirs));
      expect(ours).toBeInstanceOf(CryptoKey);
    }
  });

  test("takes usages as any iterable", async () => {
    const key = await subtle.importKey(
      "raw",
      bytes(16),
      "AES-CTR",
      false,
      new Set(["encrypt"] as const),
    );
    expect(key.usages).toEqual(["encrypt"]);
  });

  test("keeps a key's secret where nothing can read it", async () => {
    const key = await subtle.importKey("raw", bytes(32), "AES-CTR", true, ["encrypt"]);
    expect(Reflect.ownKeys(key)).toEqual([]);
    expect(JSON.stringify(key)).toBe("{}");
    expect(Object.prototype.toString.call(key)).toBe("[object CryptoKey]");
    const accessors = Object.getOwnPropertyNames(CryptoKey.prototype).filter(
      (name) => name !== "constructor",
    );
    expect(accessors).toEqual(["type", "extractable", "algorithm", "usages"]);
    for (const name of accessors) {
      const descriptor = Object.getOwnPropertyDescriptor(CryptoKey.prototype, name);
      expect(descriptor).toMatchObject({ get: expect.any(Function), set: undefined });
      expect(() => Reflect.get(CryptoKey.prototype, name, {})).toThrow(TypeError);
    }
    expect(Object.isFrozen(key.algorithm)).toBe(true);
    expect(Object.isFrozen(key.usages)).toBe(true);
  });

  test("can't be constructed or copied, as Node's can't", async () => {
    expect(() => new CryptoKey()).toThrow(TypeError);
    const ours = await subtle.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]);
    const nodes = await node.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]);
    const params = { name: "AES-CTR", counter: bytes(16), length: 64 };
    await expectSameRejection(
      loose(subtle).encrypt(params, view(ours), bytes(1)),
      loose(node).encrypt(params, view(nodes), bytes(1)),
    );
    await expectSameRejection(
      subtle.encrypt(params, Object.create(CryptoKey.prototype) as CryptoKey, bytes(1)),
      node.encrypt(
        params,
        Object.create(Object.getPrototypeOf(nodes) as object) as CryptoKey,
        bytes(1),
      ),
    );
    // Neither takes the other's keys.
    await expect(subtle.encrypt(params, nodes, bytes(1))).rejects.toThrow(TypeError);
  });

  test("copies the key data when called", async () => {
    const raw = bytes(16);
    const key = subtle.importKey("raw", raw, "AES-CTR", false, ["encrypt"]);
    raw.fill(0);
    const params = { name: "AES-CTR", counter: bytes(16), length: 64 };
    const nodes = await node.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]);
    expect(hex(await subtle.encrypt(params, await key, bytes(20)))).toBe(
      hex(await node.encrypt(params, nodes, bytes(20))),
    );
  });

  test("rejects, never throws, as Node's does", async () => {
    const cases: unknown[][] = [
      ["bogus", bytes(16), "AES-CTR", false, ["encrypt"]],
      ["raw", bytes(16), "AES-CTR", false, ["bogus"]],
      ["raw", bytes(16), "AES-CTR", false, "encrypt"],
      ["raw", bytes(16), "AES-CTR", false, undefined],
      ["raw", bytes(16), "AES-CTR", false, []],
      ["raw", bytes(16), "AES-CTR", false, ["sign"]],
      ["raw", bytes(16), "AES-GCM", false, ["deriveBits"]],
      ["raw", bytes(0), "AES-CTR", false, ["encrypt"]],
      ["raw", bytes(15), "AES-CTR", false, ["encrypt"]],
      ["raw", bytes(17), "AES-GCM", false, ["encrypt"]],
      ["raw", bytes(64), "AES-GCM", false, ["encrypt"]],
      ["raw", bytes(16), "AES-XYZ", false, ["encrypt"]],
      ["raw", bytes(16), 5, false, ["encrypt"]],
      ["raw", bytes(16), null, false, ["encrypt"]],
      ["raw", bytes(16), {}, false, ["encrypt"]],
      ["raw", "key", "AES-CTR", false, ["encrypt"]],
      ["raw", new Uint8Array(new SharedArrayBuffer(16)), "AES-CTR", false, ["encrypt"]],
      ["spki", bytes(16), "AES-CTR", false, ["encrypt"]],
      ["pkcs8", bytes(16), "HMAC", false, ["sign"]],
      ["jwk", {}, "PBKDF2", false, ["deriveBits"]],
      ["jwk", {}, "HKDF", false, ["deriveBits"]],
    ];
    for (const args of cases) {
      await expectSameRejection(loose(subtle).importKey(...args), loose(node).importKey(...args));
    }
  });

  test("rejects JWK keys, which nothing here imports, as not implemented", async () => {
    // Zam builds an attachment's JWK itself and imports the raw key; see callers.test.ts.
    const jwk = { kty: "oct", alg: "A256CTR", ext: true, key_ops: ["encrypt"], k: "A".repeat(43) };
    await expectDOMException(
      loose(subtle).importKey("jwk", jwk, "AES-CTR", true, ["encrypt"]),
      "NotSupportedError",
    );
  });
});
