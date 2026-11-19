/// <reference types="node" />
import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { codec, CODEC_SOURCE, type Codec } from "#web-codec";

/**
 * The codec as another engine runs it, in a realm of its own with the base64 that engine
 * has: the typed arrays' own methods (current WebKit and V8), `btoa` and `atob` (Hermes),
 * or neither.
 */
function codecIn(base64: "methods" | "btoa" | "none" = "btoa"): Codec {
  const realm = vm.createContext(base64 === "btoa" ? { btoa, atob } : {});
  if (base64 !== "methods") {
    vm.runInContext("delete Uint8Array.prototype.toBase64; delete Uint8Array.fromBase64;", realm);
  }
  return vm.runInContext(CODEC_SOURCE, realm) as Codec;
}

/** The trip a value makes: encoded on one side, sent as JSON text, decoded on the other. */
function send(value: unknown, from: Codec = codec(), to: Codec = codecIn()): unknown {
  return to.decode(JSON.parse(JSON.stringify(from.encode(value))));
}

const tag = (value: unknown): string => Object.prototype.toString.call(value);

describe("the copy codec", () => {
  test("JSON values arrive as they are", () => {
    const value = { a: 1, b: "two", c: [true, false, null, 1.5, -3], d: { e: {} }, f: [] };
    expect(JSON.parse(JSON.stringify(send(value)))).toEqual(value);
    expect(send("text")).toBe("text");
    expect(send(null)).toBe(null);
    expect(send(0)).toBe(0);
  });

  test("what JSON drops or mangles arrives too", () => {
    const result = send({
      none: undefined,
      nan: NaN,
      up: Infinity,
      down: -Infinity,
      minus: -0,
      big: 12345678901234567890n,
      list: [undefined, 1],
    }) as Record<string, unknown>;
    expect("none" in result).toBe(true);
    expect(result.none).toBe(undefined);
    expect(result.nan).toBeNaN();
    expect(result.up).toBe(Infinity);
    expect(result.down).toBe(-Infinity);
    expect(Object.is(result.minus, -0)).toBe(true);
    expect(result.big).toBe(12345678901234567890n);
    expect((result.list as unknown[])[0]).toBe(undefined);
    expect(send(undefined)).toBe(undefined);
  });

  test("dates, patterns, maps, sets and errors arrive as themselves", () => {
    const date = send(new Date(1_700_000_000_000)) as Date;
    expect(tag(date)).toBe("[object Date]");
    expect(date.getTime()).toBe(1_700_000_000_000);
    expect((send(new Date(NaN)) as Date).getTime()).toBeNaN();

    const pattern = send(/a+b/gi) as RegExp;
    expect(tag(pattern)).toBe("[object RegExp]");
    expect([pattern.source, pattern.flags]).toEqual(["a+b", "gi"]);

    const map = send(
      new Map<unknown, unknown>([
        ["k", { v: 1 }],
        [2, new Set([3])],
      ]),
    ) as Map<unknown, unknown>;
    expect(tag(map)).toBe("[object Map]");
    expect((map.get("k") as { v: number }).v).toBe(1);
    expect([...(map.get(2) as Set<number>)]).toEqual([3]);

    const error = send(new RangeError("too far")) as Error;
    expect(tag(error)).toBe("[object Error]");
    expect([error.name, error.message]).toEqual(["RangeError", "too far"]);
    expect(error.stack).toContain("too far");
  });

  test("buffers and views arrive with their bytes and their kind", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256);
    const buffer = send(bytes.buffer) as ArrayBuffer;
    expect(tag(buffer)).toBe("[object ArrayBuffer]");
    expect([...new Uint8Array(buffer)]).toEqual([...bytes]);

    const floats = send(new Float64Array([1.5, -2.25, Math.PI])) as Float64Array;
    expect(tag(floats)).toBe("[object Float64Array]");
    expect([...floats]).toEqual([1.5, -2.25, Math.PI]);

    const longs = send(new BigInt64Array([1n, -2n])) as BigInt64Array;
    expect(tag(longs)).toBe("[object BigInt64Array]");
    expect([...longs]).toEqual([1n, -2n]);

    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, 0xdeadbeef);
    const copied = send(view) as DataView;
    expect(tag(copied)).toBe("[object DataView]");
    expect(copied.getUint32(0)).toBe(0xdeadbeef);

    expect((send(new ArrayBuffer(0)) as ArrayBuffer).byteLength).toBe(0);
    expect((send(new Uint16Array(0)) as Uint16Array).length).toBe(0);
  });

  test("a view sends only the bytes it views, and arrives over its own buffer", () => {
    const memory = new Uint8Array(1 << 16).fill(9);
    memory.set([1, 2, 3, 4], 1000);
    const encoded = JSON.stringify(codec().encode(memory.subarray(1000, 1004)));
    expect(encoded.length).toBeLessThan(100);
    const part = codecIn().decode(JSON.parse(encoded)) as Uint8Array;
    expect([...part]).toEqual([1, 2, 3, 4]);
    expect(part.buffer.byteLength).toBe(4);
    expect(part.byteOffset).toBe(0);
  });

  test("every length of bytes survives, by every base64 on either side", () => {
    const engines = [codecIn("methods"), codecIn("btoa"), codecIn("none")];
    for (const length of [0, 1, 2, 3, 4, 5, 255, 256, 257, 0x8000, 0x8001, 100_000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + length) % 256);
      for (const from of engines) {
        for (const to of engines) {
          const copied = send(bytes, from, to) as Uint8Array;
          expect(copied.length).toBe(length);
          expect(Buffer.from(copied).equals(Buffer.from(bytes))).toBe(true);
        }
      }
    }
    for (const engine of engines) {
      expect((engine.encode(new Uint8Array([1, 2, 3, 4])) as { v: string }).v).toBe("AQIDBA==");
      expect((engine.encode(new Uint8Array([255, 254])) as { v: string }).v).toBe("//4=");
      expect((engine.encode(new Uint8Array([251])) as { v: string }).v).toBe("+w==");
    }
  });

  test("an object met twice arrives once, and a cycle arrives as a cycle", () => {
    const shared = { n: 1 };
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const twice = send({ a: shared, b: [shared, buffer], c: buffer }) as {
      a: object;
      b: [object, ArrayBuffer];
      c: ArrayBuffer;
    };
    expect(twice.b[0]).toBe(twice.a);
    expect(twice.c).toBe(twice.b[1]);

    const loop: { self?: unknown; items: unknown[]; map: Map<string, unknown> } = {
      items: [],
      map: new Map(),
    };
    loop.self = loop;
    loop.items.push(loop.items, loop);
    loop.map.set("me", loop.map);
    const copied = send(loop) as typeof loop;
    expect(copied.self).toBe(copied);
    expect(copied.items[0]).toBe(copied.items);
    expect(copied.items[1]).toBe(copied);
    expect(copied.map.get("me")).toBe(copied.map);
  });

  test("keys that would be taken for the codec's own, or for the prototype, are data", () => {
    const tricky = JSON.parse(
      '{"$":"u","v":1,"inner":{"$":"r","v":0},"__proto__":{"x":1}}',
    ) as object;
    const copied = send(tricky) as Record<string, unknown>;
    expect(copied.$).toBe("u");
    expect(copied.v).toBe(1);
    expect((copied.inner as Record<string, unknown>).$).toBe("r");
    expect(Object.keys(copied)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(copied, "__proto__")?.value).toEqual({ x: 1 });
    expect((copied as { x?: number }).x).toBe(undefined);
    // References still count the wrapped objects.
    const shared = { $: 1 };
    const pair = send([shared, shared, { after: true }]) as object[];
    expect(pair[0]).toBe(pair[1]);
    expect(pair[2]).toEqual({ after: true });
  });

  test("a class instance arrives as a plain object of its own properties", () => {
    class Point {
      x = 1;
      y = 2;
      get sum() {
        return this.x + this.y;
      }
    }
    const copied = send(new Point()) as object;
    expect(JSON.parse(JSON.stringify(copied))).toEqual({ x: 1, y: 2 });
  });

  test("what can't be copied throws a DataCloneError, as postMessage does", () => {
    for (const value of [() => {}, Symbol("s"), { deep: [new WeakMap()] }, Promise.resolve()]) {
      let thrown: unknown;
      try {
        codec().encode(value);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as Error | undefined)?.name).toBe("DataCloneError");
    }
  });

  test("decode names the buffers it made, for a transfer list", () => {
    const buffers: ArrayBuffer[] = [];
    const shared = new Uint8Array([1]).buffer;
    const decoded = codec().decode(
      JSON.parse(
        JSON.stringify(codec().encode({ a: shared, b: shared, c: new Uint16Array([7, 8]) })),
      ),
      buffers,
    ) as { a: ArrayBuffer; c: Uint16Array };
    expect(buffers).toHaveLength(2);
    expect(buffers).toContain(decoded.a);
    expect(buffers).toContain(decoded.c.buffer);
  });
});
