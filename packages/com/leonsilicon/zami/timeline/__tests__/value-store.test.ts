import { describe, expect, test } from "vite-plus/test";
import { createValueStore } from "#value-store";

describe("createValueStore", () => {
  test("tells subscribers about a change, not about the same value", () => {
    const store = createValueStore("a");
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set("a");
    expect(calls).toBe(0);
    store.set("b");
    expect(store.get()).toBe("b");
    expect(calls).toBe(1);
    off();
    store.set("c");
    expect(calls).toBe(1);
  });
});
