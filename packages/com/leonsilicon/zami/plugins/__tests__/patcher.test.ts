import { describe, expect, it } from "vite-plus/test";
import { patchAfter, patchBefore, patchInstead } from "#patcher";

describe("the patcher", () => {
  it("runs before, instead and after hooks around the method, and restores it", () => {
    const calls: string[] = [];
    const object = {
      base: 10,
      add(n: number) {
        calls.push(`add ${n}`);
        return this.base + n;
      },
    };
    const original: unknown = Reflect.get(object, "add");
    const undoBefore = patchBefore(object, "add", (args) => [(args[0] as number) * 2]);
    const undoInstead = patchInstead(
      object,
      "add",
      (args, call) => (call(...(args as never[])) as number) + 1,
    );
    const undoAfter = patchAfter(object, "add", (result) => `=${String(result)}`);
    expect(object.add(1)).toBe("=13");
    expect(calls).toEqual(["add 2"]);

    undoAfter();
    expect(object.add(1)).toBe(13);
    undoInstead();
    undoBefore();
    expect(Reflect.get(object, "add")).toBe(original);
    expect(object.add(1)).toBe(11);
  });

  it("keeps a result when an after hook returns nothing, and survives a hook that throws", () => {
    const object = { get: () => 1 };
    const seen: unknown[] = [];
    const errors: unknown[] = [];
    const original: typeof console.error = console.error.bind(console);
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      patchAfter(object, "get", (result) => void seen.push(result));
      patchAfter(object, "get", () => {
        throw new Error("boom");
      });
      patchBefore(object, "get", () => {
        throw new Error("boom");
      });
      expect(object.get()).toBe(1);
    } finally {
      console.error = original;
    }
    expect(seen).toEqual([1]);
    expect(errors).toHaveLength(2);
  });

  it("lets an instead hook's error out: it is the method now", () => {
    const object = { run: () => "ran" };
    patchInstead(object, "run", () => {
      throw new Error("blocked");
    });
    expect(() => object.run()).toThrow("blocked");
  });

  it("patches a class as a constructor, statics included", () => {
    class Counter {
      static made = 0;
      constructor(public start: number) {
        Counter.made++;
      }
    }
    const module = { Counter };
    patchBefore(module, "Counter", (args) => [(args[0] as number) + 100]);
    const counter = new module.Counter(1);
    expect(counter.start).toBe(101);
    expect(counter).toBeInstanceOf(Counter);
    expect(module.Counter.made).toBe(1);
  });

  it("says why a read-only export can't be patched", () => {
    const exports = {};
    Object.defineProperty(exports, "live", { enumerable: true, get: () => () => 1 });
    expect(() => patchAfter(exports, "live", () => 2)).toThrow(/read-only/);
    expect(() => patchAfter({ value: 1 }, "value", () => 2)).toThrow(/isn't a function/);
  });
});
