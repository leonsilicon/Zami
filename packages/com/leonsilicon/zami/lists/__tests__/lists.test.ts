import { describe, expect, test } from "vite-plus/test";
import { createRowCache, sameFields } from "#row-cache";
import { sortInSlices } from "#sort-in-slices";
import { createSortedIndex, type SortedEntry } from "#sorted-index";

/** A clock that advances `cost` per comparison, and turns that run on demand. */
function harness(cost = 1) {
  let clock = 0;
  const turns: (() => void)[] = [];
  let compares = 0;
  const compare = (a: number, b: number) => {
    clock += cost;
    compares++;
    return a - b;
  };
  return {
    compare,
    compares: () => compares,
    options: { sliceMs: 8, now: () => clock, schedule: (run: () => void) => turns.push(run) },
    pendingTurns: () => turns.length,
    async nextTurn() {
      turns.shift()?.();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    async drain() {
      while (turns.length > 0) await this.nextTurn();
    },
  };
}

function shuffled(n: number): number[] {
  // A fixed permutation, so failures reproduce.
  const out = Array.from({ length: n }, (_, i) => i);
  let seed = 7;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("sortInSlices", () => {
  test("sorts like Array.prototype.sort, stably", async () => {
    const items = shuffled(1000).map((n, i) => ({ n: n % 37, i }));
    const h = harness(0);
    const sorted = await sortInSlices(items, (a, b) => a.n - b.n, h.options);
    const expected = [...items].sort((a, b) => a.n - b.n || a.i - b.i);
    expect(sorted).toEqual(expected);
  });

  test("yields between slices and finishes", async () => {
    const h = harness(1);
    const done = sortInSlices(shuffled(500), h.compare, h.options);
    let result: number[] | null | undefined;
    void done.then((r) => (result = r));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(result).toBeUndefined();
    expect(h.pendingTurns()).toBe(1);
    await h.drain();
    expect(result).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  test("stops when cancelled", async () => {
    const h = harness(1);
    let cancelled = false;
    const done = sortInSlices(shuffled(500), h.compare, {
      ...h.options,
      cancelled: () => cancelled,
    });
    cancelled = true;
    await h.drain();
    expect(await done).toBeNull();
  });

  test("handles the small cases", async () => {
    const h = harness(0);
    expect(await sortInSlices([], h.compare, h.options)).toEqual([]);
    expect(await sortInSlices([3], h.compare, h.options)).toEqual([3]);
    expect(await sortInSlices([2, 1], h.compare, h.options)).toEqual([1, 2]);
  });
});

describe("createSortedIndex", () => {
  const entry = (id: string, sortKey = id): SortedEntry<string> => ({
    id,
    sortKey,
    value: id,
  });
  const ids = (index: { entries: readonly SortedEntry<string>[] }) =>
    index.entries.map((e) => e.id);

  test("keeps entries in order through sets and deletes", async () => {
    const index = createSortedIndex<string>({ compare: (a, b) => a.localeCompare(b) });
    await index.replace([entry("m"), entry("c"), entry("x")]);
    expect(ids(index)).toEqual(["c", "m", "x"]);
    index.set("a", "a", "a");
    index.set("p", "p", "p");
    expect(ids(index)).toEqual(["a", "c", "m", "p", "x"]);
    // A rename moves the entry.
    index.set("c", "z", "c");
    expect(ids(index)).toEqual(["a", "m", "p", "x", "c"]);
    index.delete("m");
    index.delete("missing");
    expect(ids(index)).toEqual(["a", "p", "x", "c"]);
  });

  test("replaces the array on each change and counts versions", async () => {
    const index = createSortedIndex<string>({ compare: (a, b) => a.localeCompare(b) });
    await index.replace([entry("a"), entry("b")]);
    const before = index.entries;
    const version = index.version;
    index.set("a", "a", "a2");
    expect(index.entries).not.toBe(before);
    expect(before.map((e) => e.value)).toEqual(["a", "b"]);
    expect(index.entries.map((e) => e.value)).toEqual(["a2", "b"]);
    expect(index.version).toBe(version + 1);
  });

  test("an insert costs a binary search, not a sort", async () => {
    let compares = 0;
    const index = createSortedIndex<string>({
      compare: (a, b) => {
        compares++;
        return a < b ? -1 : a > b ? 1 : 0;
      },
    });
    const all = shuffled(4096).map((n) => entry(`u${String(n).padStart(5, "0")}`));
    await index.replace(all);
    compares = 0;
    index.set("u02000x", "u02000x", "new");
    expect(compares).toBeLessThan(20);
    compares = 0;
    index.delete("u03000");
    expect(compares).toBeLessThan(20);
  });

  test("changes made while a replace sorts land on the new entries", async () => {
    const h = harness(1);
    const index = createSortedIndex<string>({
      compare: (a, b) => {
        h.compare(0, 0);
        return a.localeCompare(b);
      },
      ...h.options,
    });
    const all = shuffled(300).map((n) => entry(`u${String(n).padStart(3, "0")}`));
    const done = index.replace(all);
    expect(index.replacing).toBe(true);
    index.set("u100", "zzz", "u100");
    index.delete("u005");
    index.set("new", "aaa", "new");
    await h.drain();
    expect(await done).toBe(true);
    expect(index.replacing).toBe(false);
    const order = ids(index);
    expect(order[0]).toBe("new");
    expect(order.at(-1)).toBe("u100");
    expect(order).not.toContain("u005");
    expect(order).toHaveLength(300);
  });

  test("replaceNow sorts at once and cancels a sliced replace", async () => {
    const h = harness(1);
    const index = createSortedIndex<string>({
      compare: (a, b) => {
        h.compare(0, 0);
        return a.localeCompare(b);
      },
      ...h.options,
    });
    const sliced = index.replace(shuffled(300).map((n) => entry(`a${n}`)));
    index.replaceNow([entry("c"), entry("b")]);
    expect(ids(index)).toEqual(["b", "c"]);
    expect(index.replacing).toBe(false);
    await h.drain();
    expect(await sliced).toBe(false);
    expect(ids(index)).toEqual(["b", "c"]);
  });

  test("a later replace wins", async () => {
    const h = harness(1);
    const index = createSortedIndex<string>({
      compare: (a, b) => {
        h.compare(0, 0);
        return a.localeCompare(b);
      },
      ...h.options,
    });
    const first = index.replace(shuffled(300).map((n) => entry(`a${n}`)));
    const second = index.replace([entry("b"), entry("a")]);
    await h.drain();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(ids(index)).toEqual(["a", "b"]);
  });
});

describe("createRowCache", () => {
  type Row = { key: string; kind: "a"; n: number } | { key: string; kind: "b"; label: string };

  test("keeps unchanged rows and the array", () => {
    const cache = createRowCache<Row>();
    const first = cache.build((row) => [
      row({ key: "1", kind: "a", n: 1 }),
      row({ key: "2", kind: "b", label: "x" }),
    ]);
    const second = cache.build((row) => [
      row({ key: "1", kind: "a", n: 1 }),
      row({ key: "2", kind: "b", label: "x" }),
    ]);
    expect(second).toBe(first);
    const third = cache.build((row) => [
      row({ key: "1", kind: "a", n: 1 }),
      row({ key: "2", kind: "b", label: "y" }),
    ]);
    expect(third).not.toBe(first);
    expect(third[0]).toBe(first[0]);
    expect(third[1]).not.toBe(first[1]);
  });

  test("compares fields one level deep", () => {
    const room = {};
    expect(sameFields({ a: 1, room }, { a: 1, room })).toBe(true);
    expect(sameFields({ a: 1, room }, { a: 1, room: {} })).toBe(false);
    expect(sameFields({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameFields({ a: Number.NaN }, { a: Number.NaN })).toBe(true);
  });
});
