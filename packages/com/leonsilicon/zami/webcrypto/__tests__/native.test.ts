// With the native module (#native) there, subtle hands digests, HMAC, AES-CTR and PBKDF2
// to it. Here a stand-in on node:crypto plays the module, computing what CommonCrypto
// would, so the tests check subtle's side: what it passes, and how it splits AES-CTR.
import nodeCrypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import type { NativeCrypto } from "#native";
import { subtle } from "#subtle";
import { bytes, hex, node } from "./helpers.ts";

const NODE_HASH = { "SHA-256": "sha256", "SHA-512": "sha512" } as const;
const calls: string[] = [];

const standIn: NativeCrypto = {
  async digest(hash, data) {
    calls.push(`digest ${hash}`);
    return new Uint8Array(nodeCrypto.createHash(NODE_HASH[hash]).update(data).digest());
  },
  async hmac(hash, key, data) {
    calls.push(`hmac ${hash}`);
    return new Uint8Array(nodeCrypto.createHmac(NODE_HASH[hash], key).update(data).digest());
  },
  async aesCtr(key, counter, data) {
    calls.push(`aesCtr ${data.length}`);
    // CommonCrypto's CTR counts over the whole block, as Node's aes-*-ctr does.
    const cipher = nodeCrypto.createCipheriv(`aes-${key.length * 8}-ctr`, key, counter);
    return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
  },
  async pbkdf2(hash, password, salt, iterations, length) {
    calls.push(`pbkdf2 ${hash} ${iterations}`);
    return new Uint8Array(
      nodeCrypto.pbkdf2Sync(password, salt, iterations, length, NODE_HASH[hash]),
    );
  },
};

const host = globalThis as { expo?: { modules?: Record<string, unknown> } };
beforeAll(() => {
  host.expo = { modules: { ZamiWebCrypto: standIn } };
});
afterAll(() => {
  delete host.expo;
});

function counterNearWrap(length: number, below: number) {
  const counter = bytes(16, 7);
  let value = 0n;
  for (const byte of counter) value = (value << 8n) | BigInt(byte);
  const mask = (1n << BigInt(length)) - 1n;
  value = (value & ~mask) | (mask - BigInt(below));
  for (let i = 15; i >= 0; i--, value >>= 8n) counter[i] = Number(value & 0xffn);
  return counter;
}

describe("with the native module", () => {
  test("digests natively, as Node does", async () => {
    calls.length = 0;
    const data = bytes(100_000, 3);
    for (const hash of ["SHA-256", "SHA-512"] as const) {
      expect(hex(await subtle.digest(hash, data))).toBe(hex(await node.digest(hash, data)));
    }
    expect(calls).toEqual(["digest SHA-256", "digest SHA-512"]);
  });

  test("signs and verifies natively, as Node does", async () => {
    calls.length = 0;
    const raw = bytes(32, 4);
    const data = bytes(5000, 5);
    const params = { name: "HMAC", hash: "SHA-256" };
    const ours = await subtle.importKey("raw", raw, params, false, ["sign", "verify"]);
    const nodes = await node.importKey("raw", raw, params, false, ["sign", "verify"]);
    const signature = await subtle.sign("HMAC", ours, data);
    expect(hex(signature)).toBe(hex(await node.sign("HMAC", nodes, data)));
    expect(await subtle.verify("HMAC", ours, signature, data)).toBe(true);
    expect(await subtle.verify("HMAC", ours, signature, bytes(5000, 6))).toBe(false);
    expect(calls).toEqual(["hmac SHA-256", "hmac SHA-256", "hmac SHA-256"]);
  });

  test("encrypts AES-CTR natively, splitting where the counter wraps", async () => {
    const raw = bytes(32, 8);
    const ours = await subtle.importKey("raw", raw, "AES-CTR", false, ["encrypt", "decrypt"]);
    const nodes = await node.importKey("raw", raw, "AES-CTR", false, ["encrypt", "decrypt"]);
    const data = bytes(16 * 10 + 5, 9);
    for (const [length, below, runs] of [
      [64, 100, 1], // no wrap: one run
      [8, 3, 2], // wraps after 4 blocks: two runs
    ] as const) {
      calls.length = 0;
      const params = { name: "AES-CTR", counter: counterNearWrap(length, below), length };
      const mine = await subtle.encrypt(params, ours, data);
      expect(hex(mine)).toBe(hex(await node.encrypt(params, nodes, data)));
      expect(hex(await subtle.decrypt(params, ours, mine))).toBe(hex(data));
      expect(calls.length).toBe(runs * 2);
    }
  });

  test("derives PBKDF2 bits natively, as Node does", async () => {
    calls.length = 0;
    const raw = new TextEncoder().encode("correct horse");
    const params = { name: "PBKDF2", salt: bytes(16, 10), iterations: 1000, hash: "SHA-512" };
    const ours = await subtle.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
    const nodes = await node.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
    expect(hex(await subtle.deriveBits(params, ours, 512))).toBe(
      hex(await node.deriveBits(params, nodes, 512)),
    );
    expect(calls).toEqual(["pbkdf2 SHA-512 1000"]);
  });

  test("still copies its inputs before it returns", async () => {
    const data = bytes(64, 11);
    const expected = hex(await node.digest("SHA-256", data));
    const pending = subtle.digest("SHA-256", data);
    data.fill(0);
    expect(hex(await pending)).toBe(expected);
  });
});
