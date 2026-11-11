import { describe, expect, test } from "vite-plus/test";
import { hashString } from "#hash";
import { createYielder } from "#yielder";

describe("createYielder", () => {
  test("is due once a slice's time is used up, and starts a new slice on the next turn", async () => {
    let clock = 0;
    const turns: (() => void)[] = [];
    const yielder = createYielder({
      sliceMs: 8,
      now: () => clock,
      schedule: (run) => turns.push(run),
    });
    expect(yielder.due).toBe(false);
    clock = 8;
    expect(yielder.due).toBe(true);
    let resumed = 0;
    // Callers waiting at once share one turn.
    void yielder.next().then(() => resumed++);
    void yielder.next().then(() => resumed++);
    expect(turns).toHaveLength(1);
    clock = 20;
    turns.shift()!();
    await Promise.resolve();
    expect(resumed).toBe(2);
    expect(yielder.due).toBe(false);
  });

  test("waits for a macrotask by default", async () => {
    const yielder = createYielder({ sliceMs: 0 });
    let order = "";
    const waited = yielder.next().then(() => (order += "yield "));
    void Promise.resolve().then(() => (order += "microtask "));
    setTimeout(() => (order += "timer "), 0);
    await waited;
    expect(order.startsWith("microtask ")).toBe(true);
  });
});

describe("hashString", () => {
  test("is stable and tells nearby strings apart", () => {
    expect(hashString("$event1,$event2")).toBe(hashString("$event1,$event2"));
    expect(hashString("$event1,$event2")).not.toBe(hashString("$event1,$event3"));
    expect(Number.isSafeInteger(hashString("x".repeat(10_000)))).toBe(true);
  });
});
