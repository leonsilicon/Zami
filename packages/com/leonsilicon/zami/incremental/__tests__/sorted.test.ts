import { describe, expect, test } from "vite-plus/test";
import { updateSorted } from "#sorted";

interface Member {
  id: string;
  rank: number;
  name: string;
}

let comparisons = 0;
const options = {
  id: (m: Member) => m.id,
  sameSortKey: (a: Member, b: Member) => a.rank === b.rank && a.name === b.name,
  compare: (a: Member, b: Member) => {
    comparisons++;
    if (a.rank !== b.rank) return a.rank > b.rank ? -1 : 1;
    return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  },
};

/** A seeded pseudo-random generator, so a failure reproduces. */
function random(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

function members(count: number, next: () => number): Member[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `@u${i}:x`,
    rank: next() < 0.05 ? 100 : next() < 0.1 ? 50 : 0,
    name: `name ${Math.floor(next() * count)}`,
  }));
}

const fullSort = (list: Member[]) => [...list].sort(options.compare);

describe("updateSorted", () => {
  test("sorts from scratch without a previous result", () => {
    const list = members(200, random(1));
    expect(updateSorted(undefined, list, options)).toEqual(fullSort(list));
  });

  test("matches a full sort after joins, leaves, renames and promotions", () => {
    const next = random(2);
    let list = members(1000, next);
    let sorted = updateSorted(undefined, list, options);
    for (let round = 0; round < 50; round++) {
      list = list
        .filter(() => next() > 0.01)
        .map((m) =>
          next() < 0.01
            ? { ...m, name: `renamed ${Math.floor(next() * 1000)}` }
            : next() < 0.005
              ? { ...m, rank: 50 }
              : m,
        );
      for (let i = 0; i < 5; i++) {
        list.push({ id: `@new${round}-${i}:x`, rank: 0, name: `joined ${next()}` });
      }
      sorted = updateSorted(sorted, list, options);
      expect(sorted).toEqual(fullSort(list));
    }
  });

  test("returns the new item objects", () => {
    const list = members(50, random(3));
    const sorted = updateSorted(undefined, list, options);
    const copies = list.map((m) => ({ ...m }));
    const again = updateSorted(sorted, copies, options);
    for (const item of again) expect(copies).toContain(item);
  });

  test("a few changes cost a few comparisons, not a sort", () => {
    const next = random(4);
    const list = members(5000, next);
    const sorted = updateSorted(undefined, list, options);
    const changed = [
      ...list.slice(0, 4990),
      ...members(10, next).map((m, i) => ({ ...m, id: `@j${i}:x` })),
    ];
    comparisons = 0;
    updateSorted(sorted, changed, options);
    expect(comparisons).toBeLessThan(500);
  });
});
