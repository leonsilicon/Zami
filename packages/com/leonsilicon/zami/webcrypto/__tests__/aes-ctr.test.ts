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
} from "./helpers.ts";

async function keyPair(raw: Uint8Array<ArrayBuffer>, usages: KeyUsage[] = ["encrypt", "decrypt"]) {
  return {
    ours: await subtle.importKey("raw", raw, "AES-CTR", false, usages),
    nodes: await node.importKey("raw", raw, "AES-CTR", false, usages),
  };
}

/** Ours and Node's encrypt alike, and each decrypts the other's. */
async function expectInterop(
  raw: Uint8Array<ArrayBuffer>,
  counter: Uint8Array<ArrayBuffer>,
  length: number,
  data: Uint8Array<ArrayBuffer>,
) {
  const { ours, nodes } = await keyPair(raw);
  const params = { name: "AES-CTR", counter, length };
  const mine = await subtle.encrypt(params, ours, data);
  const theirs = await node.encrypt(params, nodes, data);
  expect(hex(mine)).toBe(hex(theirs));
  expect(hex(await node.decrypt(params, nodes, mine))).toBe(hex(data));
  expect(hex(await subtle.decrypt(params, ours, theirs))).toBe(hex(data));
}

/** A counter block whose low `length` bits are `below` short of wrapping. */
function counterNearWrap(length: number, below: number, seed: number) {
  const counter = bytes(16, seed);
  let value = 0n;
  for (const byte of counter) value = (value << 8n) | BigInt(byte);
  const mask = (1n << BigInt(length)) - 1n;
  value = (value & ~mask) | (mask - BigInt(below));
  for (let i = 15; i >= 0; i--, value >>= 8n) counter[i] = Number(value & 0xffn);
  return counter;
}

describe("AES-CTR", () => {
  test("matches NIST SP 800-38A's examples (F.5.1, F.5.5)", async () => {
    const counter = fromHex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    const plaintext = fromHex(`
      6bc1bee22e409f96e93d7e117393172a ae2d8a571e03ac9c9eb76fac45af8e51
      30c81c46a35ce411e5fbc1191a0a52ef f69f2445df4f9b17ad2b417be66c3710`);
    const examples = [
      [
        "2b7e151628aed2a6abf7158809cf4f3c",
        `874d6191b620e3261bef6864990db6ce 9806f66b7970fdff8617187bb9fffdff
         5ae4df3edbd5d35e5b4f09020db03eab 1e031dda2fbe03d1792170a0f3009cee`,
      ],
      [
        "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4",
        `601ec313775789a5b7a7f504bbf3d228 f443e3ca4d62b59aca84e990cacaf5c5
         2b0930daa23de94ce87017ba2d84988d dfc9c58db67aada613c2dd08457941a6`,
      ],
    ];
    for (const [key, ciphertext] of examples) {
      const { ours } = await keyPair(fromHex(key!));
      for (const length of [64, 128]) {
        const params = { name: "AES-CTR", counter, length };
        expect(hex(await subtle.encrypt(params, ours, plaintext))).toBe(hex(fromHex(ciphertext!)));
        expect(hex(await subtle.decrypt(params, ours, fromHex(ciphertext!)))).toBe(hex(plaintext));
      }
    }
  });

  test("interoperates with Node's in both directions", async () => {
    let seed = 1;
    for (const keyBytes of [16, 24, 32]) {
      for (const length of [1, 8, 32, 64, 128]) {
        for (const dataBytes of [0, 1, 15, 16, 17, 32, 100, 4099]) {
          if (Math.ceil(dataBytes / 16) > 2 ** length) continue;
          seed++;
          await expectInterop(
            bytes(keyBytes, seed),
            bytes(16, seed + 1000),
            length,
            bytes(dataBytes, seed),
          );
        }
      }
    }
  });

  test("wraps the counter's low `length` bits without carrying, as Node's does", async () => {
    let seed = 1;
    for (const length of [1, 2, 7, 8, 16, 31, 32, 33, 53, 64, 65, 127, 128]) {
      for (const below of [0, 1, 2]) {
        const room = 2 ** length;
        if (below >= room) continue;
        for (const dataBytes of [16, 17, 48, 80, 100]) {
          if (Math.ceil(dataBytes / 16) > room) continue;
          seed++;
          await expectInterop(
            bytes(32, seed),
            counterNearWrap(length, below, seed),
            length,
            bytes(dataBytes, seed),
          );
        }
      }
    }
  });

  test("rejects data the counter would repeat on, as Node's does", async () => {
    const { ours, nodes } = await keyPair(bytes(16));
    for (const [length, blocks] of [
      [1, 3],
      [8, 257],
    ]) {
      const params = { name: "AES-CTR", counter: bytes(16), length };
      const data = bytes(blocks! * 16 - 5);
      await expectSameRejection(
        subtle.encrypt(params, ours, data),
        node.encrypt(params, nodes, data),
      );
    }
    // As many blocks as it can count is fine.
    await expectInterop(bytes(16), bytes(16), 8, bytes(256 * 16));
  });

  test("converts `length` as WebIDL does", async () => {
    for (const length of ["64", 64.9, 8.5]) {
      const { ours, nodes } = await keyPair(bytes(16));
      const params = { name: "AES-CTR", counter: bytes(16), length };
      const mine = (await loose(subtle).encrypt(params, ours, bytes(40))) as ArrayBuffer;
      const theirs = (await loose(node).encrypt(params, nodes, bytes(40))) as ArrayBuffer;
      expect(hex(mine)).toBe(hex(theirs));
    }
  });

  test("copies its parameters and data when called", async () => {
    const { ours, nodes } = await keyPair(bytes(16));
    const counter = bytes(16);
    const data = bytes(40);
    const encrypted = subtle.encrypt({ name: "AES-CTR", counter, length: 64 }, ours, data);
    counter.fill(0);
    data.fill(0);
    expect(hex(await encrypted)).toBe(
      hex(
        await node.encrypt({ name: "AES-CTR", counter: bytes(16), length: 64 }, nodes, bytes(40)),
      ),
    );
  });

  test("rejects bad parameters, keys and data as Node's does", async () => {
    const { ours, nodes } = await keyPair(bytes(16), ["encrypt"]);
    const gcm = {
      ours: await subtle.importKey("raw", bytes(16), "AES-GCM", false, ["encrypt", "decrypt"]),
      nodes: await node.importKey("raw", bytes(16), "AES-GCM", false, ["encrypt", "decrypt"]),
    };
    const counter = bytes(16);
    const cases: [string, unknown, "ours" | "gcm" | "none", unknown][] = [
      ["encrypt", { name: "AES-CTR", counter: bytes(15), length: 64 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter: bytes(17), length: 64 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: 0 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: 129 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: 256 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: -1 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: Number.NaN }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", length: 64 }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter }, "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter: "0123456789abcdef", length: 64 }, "ours", bytes(4)],
      ["encrypt", "AES-CTR", "ours", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: 64 }, "ours", "data"],
      ["encrypt", { name: "AES-CTR", counter, length: 64 }, "none", bytes(4)],
      ["encrypt", { name: "AES-CTR", counter, length: 64 }, "gcm", bytes(4)],
      ["encrypt", { name: "HMAC" }, "ours", bytes(4)],
      ["decrypt", { name: "AES-CTR", counter, length: 64 }, "ours", bytes(4)],
    ];
    for (const [method, params, which, data] of cases) {
      const key = (side: "ours" | "nodes") =>
        which === "none" ? {} : which === "gcm" ? gcm[side] : side === "ours" ? ours : nodes;
      await expectSameRejection(
        loose(subtle)[method as "encrypt"](params, key("ours"), data),
        loose(node)[method as "encrypt"](params, key("nodes"), data),
      );
    }
    await expectDOMException(
      subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, ours, bytes(4)),
      "InvalidAccessError",
    );
  });

  test("rejects ciphers nothing here uses with NotSupportedError", async () => {
    const { ours } = await keyPair(bytes(16));
    await expectDOMException(
      subtle.encrypt({ name: "AES-CBC", iv: bytes(16) } as never, ours, bytes(4)),
      "NotSupportedError",
    );
  });
});
