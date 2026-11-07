import { describe, expect, test } from "vite-plus/test";
import type { KeyUsage } from "#key";
import { subtle } from "#subtle";
import {
  bytes,
  expectDOMException,
  expectSameRejection,
  fromHex,
  hex,
  loose,
  node,
  utf8,
} from "./helpers.ts";

async function keyPair(
  name: "HKDF" | "PBKDF2",
  raw: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[] = ["deriveBits"],
) {
  return {
    ours: await subtle.importKey("raw", raw, name, false, usages),
    nodes: await node.importKey("raw", raw, name, false, usages),
  };
}

/** The rejections both give for deriveBits with these arguments, on these keys. */
async function expectSameDeriveRejections(
  keys: { ours: unknown; nodes: unknown },
  cases: [unknown, unknown][],
) {
  for (const [algorithm, length] of cases) {
    await expectSameRejection(
      loose(subtle).deriveBits(algorithm, keys.ours, length),
      loose(node).deriveBits(algorithm, keys.nodes, length),
    );
  }
}

describe("HKDF", () => {
  test("matches RFC 5869's test case 1", async () => {
    const { ours } = await keyPair("HKDF", new Uint8Array(22).fill(0x0b));
    const params = {
      name: "HKDF",
      hash: "SHA-256",
      salt: fromHex("000102030405060708090a0b0c"),
      info: fromHex("f0f1f2f3f4f5f6f7f8f9"),
    };
    expect(hex(await subtle.deriveBits(params, ours, 42 * 8))).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });

  test("derives what Node's does", async () => {
    let seed = 1;
    for (const [hash, max] of [
      ["SHA-256", 255 * 256],
      ["SHA-512", 255 * 512],
    ] as const) {
      for (const keyBytes of [0, 1, 32, 200]) {
        for (const salt of [new Uint8Array(0), new Uint8Array(8), bytes(32, seed)]) {
          for (const info of [new Uint8Array(0), utf8("m.cross_signing.master")]) {
            for (const length of [0, 8, 256, 512, 520, max]) {
              seed++;
              const { ours, nodes } = await keyPair("HKDF", bytes(keyBytes, seed));
              const params = { name: "HKDF", hash, salt, info };
              const derived = await subtle.deriveBits(params, ours, length);
              expect(derived).toBeInstanceOf(ArrayBuffer);
              expect(hex(derived)).toBe(hex(await node.deriveBits(params, nodes, length)));
            }
          }
        }
      }
    }
  });

  test("rejects bad parameters, lengths and keys as Node's does", async () => {
    const keys = await keyPair("HKDF", bytes(32));
    const params = { name: "HKDF", hash: "SHA-256", salt: bytes(8), info: bytes(8) };
    await expectSameDeriveRejections(keys, [
      [params, undefined],
      [params, null],
      [params, 7],
      [params, -8],
      [params, 255 * 256 + 8],
      [{ ...params, info: undefined }, 256],
      [{ ...params, salt: undefined }, 256],
      [{ ...params, salt: "salt" }, 256],
      [{ ...params, hash: undefined }, 256],
      [{ ...params, hash: "SHA-3" }, 256],
      [{ name: "PBKDF2", hash: "SHA-256", salt: bytes(8), iterations: 1 }, 256],
      [{ name: "AES-CTR" }, 256],
    ]);
    await expectSameDeriveRejections(await keyPair("HKDF", bytes(32), ["deriveKey"]), [
      [params, 256],
    ]);
    await expectSameDeriveRejections({ ours: {}, nodes: {} }, [[params, 256]]);
    for (const [extractable, usages] of [
      [true, ["deriveBits"]],
      [false, ["encrypt"]],
      [false, []],
    ] as const) {
      await expectSameRejection(
        loose(subtle).importKey("raw", bytes(32), "HKDF", extractable, usages),
        loose(node).importKey("raw", bytes(32), "HKDF", extractable, usages),
      );
    }
  });
});

describe("PBKDF2", () => {
  test("matches known PBKDF2-HMAC-SHA256 values", async () => {
    const { ours } = await keyPair("PBKDF2", utf8("password"));
    const expected = {
      1: "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
      2: "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
      4096: "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
    };
    for (const [iterations, key] of Object.entries(expected)) {
      const params = {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: utf8("salt"),
        iterations: Number(iterations),
      };
      expect(hex(await subtle.deriveBits(params, ours, 256))).toBe(key);
    }
  });

  test("derives what Node's does", async () => {
    let seed = 1;
    for (const hash of ["SHA-256", "SHA-512"]) {
      for (const keyBytes of [0, 8, 200]) {
        for (const saltBytes of [0, 16]) {
          for (const iterations of [1, 2, 1000]) {
            for (const length of [0, 8, 256, 512, 520, 2048]) {
              seed++;
              const { ours, nodes } = await keyPair("PBKDF2", bytes(keyBytes, seed));
              const params = { name: "PBKDF2", hash, salt: bytes(saltBytes, seed), iterations };
              expect(hex(await subtle.deriveBits(params, ours, length))).toBe(
                hex(await node.deriveBits(params, nodes, length)),
              );
            }
          }
        }
      }
    }
  });

  test("yields to the event loop while it works", async () => {
    const { ours } = await keyPair("PBKDF2", utf8("passphrase"));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const params = { name: "PBKDF2", hash: "SHA-512", salt: utf8("salt"), iterations: 20_000 };
    await subtle.deriveBits(params, ours, 512);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });

  test("rejects bad parameters, lengths and keys as Node's does", async () => {
    const keys = await keyPair("PBKDF2", bytes(32));
    const params = { name: "PBKDF2", hash: "SHA-512", salt: bytes(8), iterations: 1 };
    await expectSameDeriveRejections(keys, [
      [params, undefined],
      [params, null],
      [params, 7],
      [{ ...params, iterations: 0 }, 256],
      [{ ...params, iterations: -1 }, 256],
      [{ ...params, iterations: undefined }, 256],
      [{ ...params, salt: undefined }, 256],
      [{ ...params, hash: undefined }, 256],
      [{ ...params, hash: "MD5" }, 256],
      [{ name: "HKDF", hash: "SHA-256", salt: bytes(8), info: bytes(8) }, 256],
    ]);
    await expectSameDeriveRejections(await keyPair("PBKDF2", bytes(32), ["deriveKey"]), [
      [params, 256],
    ]);
    for (const [extractable, usages] of [
      [true, ["deriveBits"]],
      [false, ["sign"]],
    ] as const) {
      await expectSameRejection(
        loose(subtle).importKey("raw", bytes(32), "PBKDF2", extractable, usages),
        loose(node).importKey("raw", bytes(32), "PBKDF2", extractable, usages),
      );
    }
    await expectDOMException(
      subtle.deriveBits({ ...params, hash: "SHA-1" }, keys.ours, 256),
      "NotSupportedError",
    );
  });
});
