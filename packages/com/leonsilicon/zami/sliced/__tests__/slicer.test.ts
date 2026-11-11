import { describe, expect, test } from "vite-plus/test";
import { createSlicer, nextTurn } from "#slicer";

describe("createSlicer", () => {
  test("is due once its slice has run its time, and starts a new one after a pause", async () => {
    let clock = 0;
    const scheduled: (() => void)[] = [];
    const slicer = createSlicer({
      sliceMs: 8,
      now: () => clock,
      schedule: (run) => scheduled.push(run),
    });
    expect(slicer.due).toBe(false);
    clock = 7;
    expect(slicer.due).toBe(false);
    clock = 8;
    expect(slicer.due).toBe(true);
    let resumed = false;
    const paused = slicer.pause().then(() => (resumed = true));
    await Promise.resolve();
    expect(resumed).toBe(false);
    expect(scheduled).toHaveLength(1);
    clock = 20;
    scheduled.shift()!();
    await paused;
    expect(resumed).toBe(true);
    expect(slicer.due).toBe(false);
    clock = 28;
    expect(slicer.due).toBe(true);
  });

  test("pauses until a timer, not a microtask", async () => {
    const order: string[] = [];
    const slicer = createSlicer({ sliceMs: 0 });
    const paused = slicer.pause().then(() => order.push("resumed"));
    void Promise.resolve().then(() => order.push("microtask"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await paused;
    expect(order).toEqual(["microtask", "resumed"]);
    await nextTurn();
  });
});
