import { describe, expect, test } from "vite-plus/test";
import { createYielder, forEachSliced } from "#yield";

describe("createYielder", () => {
  test("gives a turn only once the budget is spent", async () => {
    let clock = 0;
    let turns = 0;
    const maybeYield = createYielder(8, {
      now: () => clock,
      wait: async () => {
        turns++;
      },
    });
    clock = 5;
    expect(maybeYield()).toBeUndefined();
    clock = 9;
    await maybeYield();
    expect(turns).toBe(1);
    // The budget starts again after a turn.
    clock = 12;
    expect(maybeYield()).toBeUndefined();
    clock = 17;
    await maybeYield();
    expect(turns).toBe(2);
  });
});

describe("forEachSliced", () => {
  test("visits every item in order, with turns between runs", async () => {
    let clock = 0;
    let turns = 0;
    const seen: number[] = [];
    await forEachSliced(
      [1, 2, 3, 4, 5, 6],
      (n) => {
        seen.push(n);
        clock += 3;
      },
      8,
      {
        now: () => clock,
        wait: async () => {
          turns++;
        },
      },
    );
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(turns).toBe(2);
  });
});
