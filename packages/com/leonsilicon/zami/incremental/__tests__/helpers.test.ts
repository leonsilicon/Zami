import { describe, expect, test, vi } from "vite-plus/test";
import { debounce } from "#debounce";
import { createKeyedMemo } from "#keyed-memo";
import { lastIndexAtOrBefore } from "#section-at";
import { createSelection } from "#selection";

describe("createKeyedMemo", () => {
  test("computes again only when a key changes", () => {
    const memo = createKeyedMemo<{ n: number }>();
    let runs = 0;
    const compute = () => ({ n: ++runs });
    const room = {};
    const first = memo([room, 1], compute);
    expect(memo([room, 1], compute)).toBe(first);
    const second = memo([room, 2], compute);
    expect(second).not.toBe(first);
    expect(memo([{}, 2], compute)).not.toBe(second);
    expect(runs).toBe(3);
  });

  test("treats NaN as equal to itself and a different length as a change", () => {
    const memo = createKeyedMemo<number>();
    let runs = 0;
    memo([Number.NaN], () => ++runs);
    memo([Number.NaN], () => ++runs);
    memo([Number.NaN, 1], () => ++runs);
    expect(runs).toBe(2);
  });
});

describe("debounce", () => {
  test("runs once with the last arguments, and flushes or cancels", () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const run = debounce((n: number) => calls.push(n), 100);
      run(1);
      run(2);
      vi.advanceTimersByTime(99);
      run(3);
      vi.advanceTimersByTime(100);
      expect(calls).toEqual([3]);
      run(4);
      run.flush();
      expect(calls).toEqual([3, 4]);
      run.flush();
      run(5);
      run.cancel();
      vi.advanceTimersByTime(200);
      expect(calls).toEqual([3, 4]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("lastIndexAtOrBefore", () => {
  test("finds the section a scroll offset is in", () => {
    const offsets = [0, 100, 250, 400];
    expect(lastIndexAtOrBefore(offsets, -1)).toBe(-1);
    expect(lastIndexAtOrBefore(offsets, 0)).toBe(0);
    expect(lastIndexAtOrBefore(offsets, 99)).toBe(0);
    expect(lastIndexAtOrBefore(offsets, 100)).toBe(1);
    expect(lastIndexAtOrBefore(offsets, 399)).toBe(2);
    expect(lastIndexAtOrBefore(offsets, 10_000)).toBe(3);
    expect(lastIndexAtOrBefore([], 5)).toBe(-1);
  });
});

describe("createSelection", () => {
  test("notifies only the key it leaves and the key it lands on", () => {
    const selection = createSelection<string>();
    const heard: string[] = [];
    for (const key of ["a", "b", "c"]) selection.subscribe(key, () => heard.push(key));
    selection.set("a");
    selection.set("b");
    selection.set("b");
    selection.set(null);
    expect(heard).toEqual(["a", "a", "b", "b"]);
    expect(selection.get()).toBe(null);
  });

  test("stops notifying after unsubscribing", () => {
    const selection = createSelection<number>();
    let heard = 0;
    const stop = selection.subscribe(1, () => heard++);
    selection.set(1);
    stop();
    selection.set(2);
    expect(heard).toBe(1);
  });
});
