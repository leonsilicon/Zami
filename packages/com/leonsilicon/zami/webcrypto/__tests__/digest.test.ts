import { describe, expect, test } from "vite-plus/test";
import { subtle } from "#subtle";
import {
  bytes,
  expectDOMException,
  expectSameRejection,
  hex,
  loose,
  node,
  utf8,
} from "./helpers.ts";

const HASHES = ["SHA-256", "SHA-512"];
// Around SHA-256's and SHA-512's block and padding boundaries.
const LENGTHS = [0, 1, 3, 55, 56, 63, 64, 65, 111, 112, 127, 128, 129, 1000, 65_537];

describe("digest", () => {
  test.each(HASHES)("%s matches Node's for messages of every length", async (hash) => {
    for (const length of LENGTHS) {
      const data = bytes(length, length);
      expect(hex(await subtle.digest(hash, data))).toBe(hex(await node.digest(hash, data)));
    }
  });

  test("matches FIPS 180's examples", async () => {
    expect(hex(await subtle.digest("SHA-256", utf8("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hex(await subtle.digest("SHA-512", utf8("abc")))).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
        "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
    expect(hex(await subtle.digest("SHA-256", new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("takes ArrayBuffers, TypedArrays and DataViews, reading only a view's bytes", async () => {
    const { buffer } = bytes(100);
    const inputs = [
      buffer,
      new Uint8Array(buffer, 10, 50),
      new DataView(buffer, 10, 50),
      new Int32Array(buffer, 12, 10),
      new Float64Array(buffer, 16, 4),
      Buffer.from(buffer, 10, 50),
    ];
    for (const input of inputs) {
      expect(hex(await subtle.digest("SHA-256", input))).toBe(
        hex(await node.digest("SHA-256", input)),
      );
    }
  });

  test("takes names in any case, and Algorithm dictionaries", async () => {
    const data = bytes(10);
    const expected = hex(await node.digest("SHA-512", data));
    expect(hex(await subtle.digest("sha-512", data))).toBe(expected);
    expect(hex(await subtle.digest({ name: "Sha-512" }, data))).toBe(expected);
  });

  test("resolves to an ArrayBuffer holding just the digest", async () => {
    const digest = await subtle.digest("SHA-256", bytes(10));
    expect(digest).toBeInstanceOf(ArrayBuffer);
    expect(digest.byteLength).toBe(32);
  });

  test("copies its input when called", async () => {
    const data = bytes(64);
    const digest = subtle.digest("SHA-256", data);
    data.fill(0);
    expect(hex(await digest)).toBe(hex(await node.digest("SHA-256", bytes(64))));
  });

  test("rejects, never throws, as Node's does", async () => {
    const cases: unknown[][] = [
      ["SHA-3", bytes(1)],
      ["AES-CTR", bytes(1)],
      [{}, bytes(1)],
      [null, bytes(1)],
      ["SHA-256", "abc"],
      ["SHA-256", [1, 2, 3]],
      ["SHA-256", new SharedArrayBuffer(4)],
      ["SHA-256"],
    ];
    for (const args of cases) {
      await expectSameRejection(loose(subtle).digest(...args), loose(node).digest(...args));
    }
  });

  test("rejects hashes nothing here uses with NotSupportedError", async () => {
    await expectDOMException(subtle.digest("SHA-1", bytes(1)), "NotSupportedError");
    await expectDOMException(subtle.digest("SHA-384", bytes(1)), "NotSupportedError");
  });
});
