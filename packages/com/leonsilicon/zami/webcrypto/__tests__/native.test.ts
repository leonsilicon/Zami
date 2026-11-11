// With the native module (#native) there, subtle hands digests, HMAC, AES-CTR, AES-GCM and
// PBKDF2 to it. Here a stand-in on node:crypto plays the module, computing what CommonCrypto,
// CryptoKit and javax.crypto would, so the tests check subtle's side: what it passes, how it
// splits AES-CTR, and that it falls back to @noble where the module can't help.
import nodeCrypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import type { NativeCrypto } from "#native";
import { subtle } from "#subtle";
import { bytes, expectDOMException, hex, node } from "./helpers.ts";

const NODE_HASH = { "SHA-256": "sha256", "SHA-512": "sha512" } as const;
const GCM_TAG_BYTES = 16;
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
  async aesGcm(encrypt, key, iv, additionalData, data) {
    calls.push(`aesGcm ${encrypt ? "encrypt" : "decrypt"} ${data.length}`);
    const algorithm = `aes-${key.length * 8}-gcm` as nodeCrypto.CipherGCMTypes;
    if (encrypt) {
      const cipher = nodeCrypto.createCipheriv(algorithm, key, iv);
      cipher.setAAD(additionalData);
      return new Uint8Array(
        Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]),
      );
    }
    const split = data.length - GCM_TAG_BYTES;
    const decipher = nodeCrypto.createDecipheriv(algorithm, key, iv);
    decipher.setAAD(additionalData);
    decipher.setAuthTag(data.subarray(split));
    try {
      return new Uint8Array(
        Buffer.concat([decipher.update(data.subarray(0, split)), decipher.final()]),
      );
    } catch {
      return null;
    }
  },
  async pbkdf2(hash, password, salt, iterations, length) {
    calls.push(`pbkdf2 ${hash} ${iterations}`);
    return new Uint8Array(
      nodeCrypto.pbkdf2Sync(password, salt, iterations, length, NODE_HASH[hash]),
    );
  },
};

const host = globalThis as { expo?: { modules?: Record<string, unknown> } };
function useModule(module: Partial<NativeCrypto>): void {
  host.expo = { modules: { ZamiWebCrypto: module } };
}
beforeAll(() => useModule(standIn));
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

async function gcmKeys(raw: Uint8Array<ArrayBuffer>) {
  return {
    ours: await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
    nodes: await node.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
  };
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

  test("seals and opens AES-GCM natively with a 12-byte iv, as Node does", async () => {
    calls.length = 0;
    const { ours, nodes } = await gcmKeys(bytes(32, 12));
    // A file transfer's block.
    const data = bytes(1 << 20, 13);
    for (const additionalData of [undefined, bytes(40, 14)]) {
      const params = { name: "AES-GCM", iv: bytes(12, 15), additionalData };
      const sealed = await subtle.encrypt(params, ours, data);
      expect(hex(sealed)).toBe(hex(await node.encrypt(params, nodes, data)));
      expect(hex(await subtle.decrypt(params, ours, sealed))).toBe(hex(data));
      const tampered = new Uint8Array(sealed);
      tampered[5] = tampered[5]! ^ 1;
      await expectDOMException(subtle.decrypt(params, ours, tampered), "OperationError");
    }
    const sealedLength = data.length + GCM_TAG_BYTES;
    expect(calls).toEqual([
      `aesGcm encrypt ${data.length}`,
      `aesGcm decrypt ${sealedLength}`,
      `aesGcm decrypt ${sealedLength}`,
      `aesGcm encrypt ${data.length}`,
      `aesGcm decrypt ${sealedLength}`,
      `aesGcm decrypt ${sealedLength}`,
    ]);
  });

  test("seals AES-GCM with other ivs on @noble", async () => {
    calls.length = 0;
    const { ours, nodes } = await gcmKeys(bytes(16, 16));
    const params = { name: "AES-GCM", iv: bytes(16, 17) };
    const data = bytes(100, 18);
    const sealed = await subtle.encrypt(params, ours, data);
    expect(hex(sealed)).toBe(hex(await node.encrypt(params, nodes, data)));
    expect(hex(await subtle.decrypt(params, ours, sealed))).toBe(hex(data));
    expect(calls).toEqual([]);
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

describe("with a native module that can't help", () => {
  afterAll(() => useModule(standIn));

  test("an app built before AES-GCM was native seals it on @noble", async () => {
    const older: Partial<NativeCrypto> = { ...standIn };
    delete older.aesGcm;
    useModule(older);
    calls.length = 0;
    const { ours, nodes } = await gcmKeys(bytes(32, 19));
    const params = { name: "AES-GCM", iv: bytes(12, 20) };
    const data = bytes(1000, 21);
    const sealed = await subtle.encrypt(params, ours, data);
    expect(hex(sealed)).toBe(hex(await node.encrypt(params, nodes, data)));
    expect(hex(await subtle.decrypt(params, ours, sealed))).toBe(hex(data));
    expect(calls).toEqual([]);
  });

  test("a native call that fails is computed on @noble instead", async () => {
    const failing = async (): Promise<never> => {
      throw new Error("unsupported here");
    };
    useModule({
      digest: failing,
      hmac: failing,
      aesCtr: failing,
      aesGcm: failing,
      pbkdf2: failing,
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const data = bytes(5000, 22);
      expect(hex(await subtle.digest("SHA-256", data))).toBe(
        hex(await node.digest("SHA-256", data)),
      );
      // A 192-bit key, which Android's AES-GCM refuses.
      const raw = bytes(24, 23);
      for (const name of ["AES-CTR", "AES-GCM"] as const) {
        const ours = await subtle.importKey("raw", raw, name, false, ["encrypt", "decrypt"]);
        const nodes = await node.importKey("raw", raw, name, false, ["encrypt", "decrypt"]);
        const params =
          name === "AES-CTR"
            ? { name, counter: bytes(16, 24), length: 64 }
            : { name, iv: bytes(12, 24) };
        const sealed = await subtle.encrypt(params, ours, data);
        expect(hex(sealed)).toBe(hex(await node.encrypt(params, nodes, data)));
        expect(hex(await subtle.decrypt(params, ours, sealed))).toBe(hex(data));
      }
      const hmacParams = { name: "HMAC", hash: "SHA-512" };
      const ours = await subtle.importKey("raw", raw, hmacParams, false, ["sign"]);
      const nodes = await node.importKey("raw", raw, hmacParams, false, ["sign"]);
      expect(hex(await subtle.sign("HMAC", ours, data))).toBe(
        hex(await node.sign("HMAC", nodes, data)),
      );
      const password = await subtle.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
      const nodePassword = await node.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
      const params = { name: "PBKDF2", salt: bytes(16, 25), iterations: 10, hash: "SHA-256" };
      expect(hex(await subtle.deriveBits(params, password, 256))).toBe(
        hex(await node.deriveBits(params, nodePassword, 256)),
      );
    } finally {
      console.warn = warn;
    }
  });
});
