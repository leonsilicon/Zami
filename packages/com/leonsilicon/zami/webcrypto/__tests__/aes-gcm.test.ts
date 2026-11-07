import { describe, expect, test } from "vite-plus/test";
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

async function keyPair(raw: Uint8Array<ArrayBuffer>) {
  return {
    ours: await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
    nodes: await node.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
  };
}

describe("AES-GCM", () => {
  test("matches the GCM specification's test cases 4 and 16", async () => {
    const iv = fromHex("cafebabefacedbaddecaf888");
    const additionalData = fromHex("feedfacedeadbeeffeedfacedeadbeefabaddad2");
    const plaintext = fromHex(`
      d9313225f88406e5a55909c5aff5269a 86a7a9531534f7da2e4c303d8a318a72
      1c3c0c95956809532fcf0e2449a6b525 b16aedf5aa0de657ba637b39`);
    const cases = [
      [
        "feffe9928665731c6d6a8f9467308308",
        `42831ec2217774244b7221b784d0d49c e3aa212f2c02a4e035c17e2329aca12e
         21d514b25466931c7d8f6a5aac84aa05 1ba30b396a0aac973d58e091
         5bc94fbc3221a5db94fae95ae7121a47`,
      ],
      [
        "feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308",
        `522dc1f099567d07f47f37a32a84427d 643a8cdcbfe5c0c97598a2bd2555d1aa
         8cb08e48590dbb3da7b08b1056828838 c5f61e6393ba7a0abcc9f662
         76fc6ece0f4e1768cddf8853bb2d551b`,
      ],
    ];
    for (const [key, sealed] of cases) {
      const { ours } = await keyPair(fromHex(key!));
      const params = { name: "AES-GCM", iv, additionalData };
      expect(hex(await subtle.encrypt(params, ours, plaintext))).toBe(hex(fromHex(sealed!)));
      expect(hex(await subtle.decrypt(params, ours, fromHex(sealed!)))).toBe(hex(plaintext));
    }
  });

  test("interoperates with Node's in both directions", async () => {
    let seed = 1;
    for (const keyBytes of [16, 24, 32]) {
      for (const ivBytes of [12, 8, 16, 60]) {
        for (const additionalData of [undefined, new Uint8Array(0), bytes(13, seed)]) {
          for (const dataBytes of [0, 1, 16, 17, 1000]) {
            seed++;
            const { ours, nodes } = await keyPair(bytes(keyBytes, seed));
            const params = {
              name: "AES-GCM",
              iv: bytes(ivBytes, seed),
              additionalData,
              tagLength: 128,
            };
            const data = bytes(dataBytes, seed);
            const mine = await subtle.encrypt(params, ours, data);
            const theirs = await node.encrypt(params, nodes, data);
            expect(hex(mine)).toBe(hex(theirs));
            expect(hex(await node.decrypt(params, nodes, mine))).toBe(hex(data));
            expect(hex(await subtle.decrypt(params, ours, theirs))).toBe(hex(data));
          }
        }
      }
    }
  });

  test("rejects what doesn't authenticate with OperationError, as Node's does", async () => {
    const { ours, nodes } = await keyPair(bytes(32));
    const other = await keyPair(bytes(32, 2));
    const params = { name: "AES-GCM", iv: bytes(12), additionalData: bytes(5) };
    const sealed = new Uint8Array(await node.encrypt(params, nodes, bytes(40)));
    const tampered = (index: number) => {
      const copy = sealed.slice();
      copy[index]! ^= 1;
      return copy;
    };
    const cases: [typeof params, typeof ours, typeof nodes, Uint8Array<ArrayBuffer>][] = [
      [params, ours, nodes, tampered(0)],
      [params, ours, nodes, tampered(sealed.length - 1)],
      [params, ours, nodes, sealed.slice(0, -1)],
      [params, ours, nodes, sealed.slice(0, 15)],
      [params, ours, nodes, new Uint8Array(0)],
      [{ ...params, iv: bytes(12, 2) }, ours, nodes, sealed],
      [{ ...params, additionalData: bytes(5, 2) }, ours, nodes, sealed],
      [{ name: "AES-GCM", iv: bytes(12) } as typeof params, ours, nodes, sealed],
      [params, other.ours, other.nodes, sealed],
    ];
    for (const [caseParams, mine, theirs, data] of cases) {
      await expectSameRejection(
        subtle.decrypt(caseParams, mine, data),
        node.decrypt(caseParams, theirs, data),
      );
      await expectDOMException(subtle.decrypt(caseParams, mine, data), "OperationError");
    }
  });

  test("rejects bad parameters, keys and data as Node's does", async () => {
    const { ours, nodes } = await keyPair(bytes(16));
    const ctr = {
      ours: await subtle.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]),
      nodes: await node.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]),
    };
    const encryptOnly = {
      ours: await subtle.importKey("raw", bytes(16), "AES-GCM", false, ["encrypt"]),
      nodes: await node.importKey("raw", bytes(16), "AES-GCM", false, ["encrypt"]),
    };
    const iv = bytes(12);
    const cases: [string, unknown, { ours: unknown; nodes: unknown }, unknown][] = [
      ["encrypt", { name: "AES-GCM", iv: new Uint8Array(0) }, { ours, nodes }, bytes(4)],
      ["encrypt", { name: "AES-GCM" }, { ours, nodes }, bytes(4)],
      ["encrypt", { name: "AES-GCM", iv, tagLength: 100 }, { ours, nodes }, bytes(4)],
      ["encrypt", { name: "AES-GCM", iv, tagLength: 0 }, { ours, nodes }, bytes(4)],
      ["encrypt", { name: "AES-GCM", iv, tagLength: 256 }, { ours, nodes }, bytes(4)],
      ["encrypt", { name: "AES-GCM", iv, additionalData: "x" }, { ours, nodes }, bytes(4)],
      ["encrypt", { name: "AES-GCM", iv }, { ours, nodes }, 42],
      ["encrypt", { name: "AES-GCM", iv }, ctr, bytes(4)],
      ["encrypt", { name: "AES-GCM", iv }, { ours: null, nodes: null }, bytes(4)],
      ["decrypt", { name: "AES-GCM", iv }, encryptOnly, bytes(20)],
    ];
    for (const [method, params, keys, data] of cases) {
      await expectSameRejection(
        loose(subtle)[method as "encrypt"](params, keys.ours, data),
        loose(node)[method as "encrypt"](params, keys.nodes, data),
      );
    }
  });

  test("rejects tags shorter than 128 bits and ivs shorter than 8 bytes as not implemented", async () => {
    const { ours } = await keyPair(bytes(16));
    await expectDOMException(
      subtle.encrypt({ name: "AES-GCM", iv: bytes(12), tagLength: 96 }, ours, bytes(4)),
      "NotSupportedError",
    );
    await expectDOMException(
      subtle.encrypt({ name: "AES-GCM", iv: bytes(4) }, ours, bytes(4)),
      "NotSupportedError",
    );
  });
});
