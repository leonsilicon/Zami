import { describe, expect, test } from "vite-plus/test";
import { forEachSliced } from "#sliced";

function harness(cost: number) {
  let clock = 0;
  const turns: (() => void)[] = [];
  return {
    options: {
      sliceMs: 8,
      now: () => clock,
      schedule: (run: () => void) => turns.push(run),
    },
    work: () => (clock += cost),
    turns,
    nextTurn: () => turns.shift()?.(),
  };
}

describe("forEachSliced", () => {
  test("runs a slice now and the rest in later turns, in order", async () => {
    const h = harness(3);
    const seen: number[] = [];
    let done: boolean | undefined;
    void forEachSliced(
      [1, 2, 3, 4, 5, 6, 7],
      (n) => {
        h.work();
        seen.push(n);
      },
      h.options,
    ).then((r) => (done = r));
    // 3 ms each: three fit in an 8 ms slice.
    expect(seen).toEqual([1, 2, 3]);
    expect(h.turns.length).toBe(1);
    h.nextTurn();
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    h.nextTurn();
    await Promise.resolve();
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(done).toBe(true);
  });

  test("an item slower than a slice still runs, one per turn", () => {
    const h = harness(20);
    const seen: number[] = [];
    void forEachSliced(
      [1, 2],
      (n) => {
        h.work();
        seen.push(n);
      },
      h.options,
    );
    expect(seen).toEqual([1]);
    h.nextTurn();
    expect(seen).toEqual([1, 2]);
  });

  test("stops when cancelled", async () => {
    const h = harness(5);
    let stop = false;
    const seen: number[] = [];
    const result = forEachSliced(
      [1, 2, 3, 4],
      (n) => {
        h.work();
        seen.push(n);
      },
      { ...h.options, cancelled: () => stop },
    );
    expect(seen).toEqual([1, 2]);
    stop = true;
    h.nextTurn();
    expect(await result).toBe(false);
    expect(seen).toEqual([1, 2]);
  });

  test("an empty list resolves at once", async () => {
    expect(await forEachSliced([], () => {}, { sliceMs: 8 })).toBe(true);
  });

  test("an error rejects", async () => {
    const h = harness(1);
    await expect(
      forEachSliced(
        [1],
        () => {
          throw new Error("boom");
        },
        h.options,
      ),
    ).rejects.toThrow("boom");
  });
});
