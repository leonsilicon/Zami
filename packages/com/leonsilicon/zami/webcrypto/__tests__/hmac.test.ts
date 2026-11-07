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

async function keyPair(raw: Uint8Array<ArrayBuffer>, hash: unknown = "SHA-256") {
  const algorithm = { name: "HMAC", hash } as { name: "HMAC"; hash: string };
  return {
    ours: await subtle.importKey("raw", raw, algorithm, false, ["sign", "verify"]),
    nodes: await node.importKey("raw", raw, algorithm, false, ["sign", "verify"]),
  };
}

describe("HMAC", () => {
  test("matches RFC 4231's test case 2", async () => {
    const data = utf8("what do ya want for nothing?");
    const expected = {
      "SHA-256": "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
      "SHA-512":
        "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554" +
        "9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
    };
    for (const [hash, mac] of Object.entries(expected)) {
      const { ours } = await keyPair(utf8("Jefe"), hash);
      expect(hex(await subtle.sign("HMAC", ours, data))).toBe(mac);
      expect(await subtle.verify("HMAC", ours, Buffer.from(mac, "hex"), data)).toBe(true);
    }
  });

  test("signs as Node's does, with keys shorter and longer than a block", async () => {
    let seed = 1;
    for (const hash of ["SHA-256", "SHA-512"]) {
      for (const keyBytes of [1, 32, 64, 65, 128, 129, 200]) {
        for (const dataBytes of [0, 1, 64, 1000]) {
          seed++;
          const { ours, nodes } = await keyPair(bytes(keyBytes, seed), hash);
          const data = bytes(dataBytes, seed);
          expect(hex(await subtle.sign({ name: "HMAC" }, ours, data))).toBe(
            hex(await node.sign({ name: "HMAC" }, nodes, data)),
          );
        }
      }
    }
  });

  test("verifies Node's signatures, and Node verifies its own", async () => {
    for (const hash of ["SHA-256", "SHA-512"]) {
      const { ours, nodes } = await keyPair(bytes(32), hash);
      const data = bytes(100);
      const mine = new Uint8Array(await subtle.sign("HMAC", ours, data));
      const theirs = new Uint8Array(await node.sign("HMAC", nodes, data));
      expect(await subtle.verify("HMAC", ours, theirs, data)).toBe(true);
      expect(await node.verify("HMAC", nodes, mine, data)).toBe(true);
      const flipped = mine.slice();
      flipped[5]! ^= 0x80;
      const wrong = [
        flipped,
        mine.subarray(0, -1),
        new Uint8Array([...mine, 0]),
        new Uint8Array(0),
        new Uint8Array(mine.length),
      ];
      for (const signature of wrong) {
        expect(await subtle.verify("HMAC", ours, signature, data)).toBe(false);
        expect(await node.verify("HMAC", nodes, signature, data)).toBe(false);
      }
      expect(await subtle.verify("HMAC", ours, mine, bytes(100, 2))).toBe(false);
    }
  });

  test("takes the hash as a name in any case or as an Algorithm", async () => {
    const data = bytes(20);
    const expected = hex(await node.sign("HMAC", (await keyPair(bytes(32))).nodes, data));
    for (const hash of ["sha-256", { name: "SHA-256" }]) {
      const { ours } = await keyPair(bytes(32), hash);
      expect(ours.algorithm).toEqual({ name: "HMAC", length: 256, hash: { name: "SHA-256" } });
      expect(hex(await subtle.sign("hmac", ours, data))).toBe(expected);
    }
  });

  test("takes a length that matches the key's", async () => {
    const algorithm = { name: "HMAC", hash: "SHA-256", length: 256 };
    const ours = await subtle.importKey("raw", bytes(32), algorithm, false, ["sign"]);
    const nodes = await node.importKey("raw", bytes(32), algorithm, false, ["sign"]);
    expect(ours.algorithm).toEqual(nodes.algorithm);
    expect(hex(await subtle.sign("HMAC", ours, bytes(3)))).toBe(
      hex(await node.sign("HMAC", nodes, bytes(3))),
    );
  });

  test("rejects bad parameters, keys and data as Node's does", async () => {
    const importCases: unknown[][] = [
      [bytes(32), { name: "HMAC" }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: "SHA-3" }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: "AES-CTR" }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: {} }, ["sign"]],
      [new Uint8Array(0), { name: "HMAC", hash: "SHA-256" }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: "SHA-256", length: 0 }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: "SHA-256", length: 248 }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: "SHA-256", length: 257 }, ["sign"]],
      [bytes(32), { name: "HMAC", hash: "SHA-256" }, ["encrypt"]],
      [bytes(32), { name: "HMAC", hash: "SHA-256" }, []],
    ];
    for (const [data, algorithm, usages] of importCases) {
      await expectSameRejection(
        loose(subtle).importKey("raw", data, algorithm, false, usages),
        loose(node).importKey("raw", data, algorithm, false, usages),
      );
    }

    const signOnly = {
      ours: await subtle.importKey("raw", bytes(32), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
      ]),
      nodes: await node.importKey("raw", bytes(32), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
      ]),
    };
    const verifyOnly = {
      ours: await subtle.importKey("raw", bytes(32), { name: "HMAC", hash: "SHA-256" }, false, [
        "verify",
      ]),
      nodes: await node.importKey("raw", bytes(32), { name: "HMAC", hash: "SHA-256" }, false, [
        "verify",
      ]),
    };
    const aes = {
      ours: await subtle.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]),
      nodes: await node.importKey("raw", bytes(16), "AES-CTR", false, ["encrypt"]),
    };
    const useCases: [string, unknown, { ours: unknown; nodes: unknown }, unknown[]][] = [
      ["sign", "HMAC", verifyOnly, [bytes(1)]],
      ["verify", "HMAC", signOnly, [bytes(32), bytes(1)]],
      ["sign", "HMAC", aes, [bytes(1)]],
      ["sign", "AES-CTR", signOnly, [bytes(1)]],
      ["sign", "HMAC", { ours: "key", nodes: "key" }, [bytes(1)]],
      ["sign", "HMAC", signOnly, ["data"]],
      ["verify", "HMAC", verifyOnly, [undefined, bytes(1)]],
      ["verify", "HMAC", verifyOnly, [bytes(32)]],
    ];
    for (const [method, algorithm, keys, rest] of useCases) {
      await expectSameRejection(
        loose(subtle)[method as "sign"](algorithm, keys.ours, ...rest),
        loose(node)[method as "sign"](algorithm, keys.nodes, ...rest),
      );
    }
  });

  test("rejects lengths of part of a byte as not implemented", async () => {
    await expectDOMException(
      subtle.importKey("raw", bytes(32), { name: "HMAC", hash: "SHA-256", length: 255 }, false, [
        "sign",
      ]),
      "NotSupportedError",
    );
  });
});
