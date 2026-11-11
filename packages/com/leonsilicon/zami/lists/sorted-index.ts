// Entries kept in order of a sort key, so one change costs a binary search (O(log n)
// comparisons) instead of a re-sort, and a full rebuild sorts in slices.

import { sortInSlices, type SliceOptions } from "#sort-in-slices";

export interface SortedEntry<T> {
  id: string;
  /** What the entry sorts by, as it was when the entry was set. */
  sortKey: string;
  value: T;
}

export interface SortedIndexOptions extends Omit<SliceOptions, "cancelled"> {
  compare: (a: string, b: string) => number;
}

export interface SortedIndex<T> {
  /** The entries in order. Replaced, never mutated, on each change. */
  readonly entries: readonly SortedEntry<T>[];
  /** Counts changes, so a reader can tell whether `entries` moved on. */
  readonly version: number;
  /** Whether a `replace` is still sorting. */
  readonly replacing: boolean;
  get(id: string): SortedEntry<T> | undefined;
  /** Adds or moves an entry. */
  set(id: string, sortKey: string, value: T): void;
  delete(id: string): void;
  /**
   * Replaces every entry, sorting them in slices. Changes made with `set` and `delete`
   * meanwhile apply to the old entries at once and to the new ones when they land, so
   * `next` should be the entries as they are now. Resolves to false when a later
   * `replace` (or `clear`) took over.
   */
  replace(entries: readonly SortedEntry<T>[]): Promise<boolean>;
  /** `replace` in one go, for a list small enough to sort within a frame. */
  replaceNow(entries: readonly SortedEntry<T>[]): void;
  clear(): void;
}

export function createSortedIndex<T>(options: SortedIndexOptions): SortedIndex<T> {
  const { compare } = options;
  let entries: SortedEntry<T>[] = [];
  let byId = new Map<string, SortedEntry<T>>();
  let version = 0;
  let generation = 0;
  /** `set`/`delete` calls made while a `replace` sorts (null: deleted). */
  let replayed: Map<string, SortedEntry<T> | null> | null = null;

  /** The first index whose key sorts after `sortKey` (after equal keys). */
  const upperBound = (list: readonly SortedEntry<T>[], sortKey: string): number => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(list[mid]!.sortKey, sortKey) <= 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** Where `entry` sits in `list`, or -1. */
  const indexOf = (list: readonly SortedEntry<T>[], entry: SortedEntry<T>): number => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(list[mid]!.sortKey, entry.sortKey) < 0) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length; i++) {
      if (list[i] === entry) return i;
      if (compare(list[i]!.sortKey, entry.sortKey) !== 0) break;
    }
    // A comparator that isn't consistent (a locale change mid-session): search it all.
    return list.indexOf(entry);
  };

  const apply = (id: string, entry: SortedEntry<T> | null): void => {
    const old = byId.get(id);
    const next = entries.slice();
    if (old) {
      const at = indexOf(next, old);
      if (at !== -1) next.splice(at, 1);
      byId.delete(id);
    }
    if (entry) {
      next.splice(upperBound(next, entry.sortKey), 0, entry);
      byId.set(id, entry);
    }
    entries = next;
    version++;
  };

  return {
    get entries() {
      return entries;
    },
    get version() {
      return version;
    },
    get replacing() {
      return replayed !== null;
    },
    get: (id) => byId.get(id),
    set(id, sortKey, value) {
      const entry = { id, sortKey, value };
      replayed?.set(id, entry);
      const old = byId.get(id);
      if (old?.sortKey === sortKey) {
        // Same place: swap the entry in.
        const at = indexOf(entries, old);
        if (at !== -1) {
          const next = entries.slice();
          next[at] = entry;
          entries = next;
          byId.set(id, entry);
          version++;
          return;
        }
      }
      apply(id, entry);
    },
    delete(id) {
      if (replayed) replayed.set(id, null);
      if (byId.has(id)) apply(id, null);
    },
    async replace(next) {
      const mine = ++generation;
      // Changes from before this call are in `next`; only later ones need replaying.
      replayed = new Map();
      const sorted = await sortInSlices(next, (a, b) => compare(a.sortKey, b.sortKey), {
        ...options,
        cancelled: () => generation !== mine,
      });
      if (sorted === null || generation !== mine) return false;
      const changes = replayed ?? new Map<string, SortedEntry<T> | null>();
      replayed = null;
      entries = sorted;
      byId = new Map(sorted.map((entry) => [entry.id, entry]));
      version++;
      for (const [id, entry] of changes) apply(id, entry);
      return true;
    },
    replaceNow(next) {
      generation++;
      replayed = null;
      // Stable (ES2019), like the sliced sort.
      entries = next.slice().sort((a, b) => compare(a.sortKey, b.sortKey));
      byId = new Map(entries.map((entry) => [entry.id, entry]));
      version++;
    },
    clear() {
      generation++;
      replayed = null;
      entries = [];
      byId = new Map();
      version++;
    },
  };
}
