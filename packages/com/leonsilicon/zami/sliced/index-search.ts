// The local message index's search (src/lib/utils/eventIndex's resolveEntries, then
// searchEntries), fed a block at a time and run a slice at a time, with the same results.
import { createSlicer, type Slicer } from "#slicer";

/** An indexed message as the event index stores it (its `IndexEntry`), plus `n`. */
export interface IndexedMessage {
  /** Event id. For an edit, the id of the edit event itself. */
  e: string;
  /** Sender. */
  s: string;
  /** origin_server_ts. */
  t: number;
  /** msgtype. */
  m: string;
  /** Body text (the new body, for an edit). */
  b: string;
  /** Voice message. */
  v?: 1;
  /** For an edit: the event it replaces. */
  o?: string;
  /**
   * The body as search compares it (normalized), when that isn't simply the body in lower
   * case: written with the entry (`prepareEntry`), so a search doesn't normalize every
   * message it scans.
   */
  n?: string;
}

/**
 * Gives an entry its search body when it's written: `n` when normalizing the body does
 * more than lower-case it (accents, compatibility forms), none otherwise.
 */
export function prepareEntry(entry: IndexedMessage, normalize: (text: string) => string): void {
  const normalized = normalize(entry.b);
  if (normalized === entry.b.toLowerCase()) delete entry.n;
  else entry.n = normalized;
}

/** An entry's search body: what `normalize(entry.b)` gives, for a prepared entry. */
export function searchBody(entry: IndexedMessage): string {
  return entry.n ?? entry.b.toLowerCase();
}

export interface IndexSearchOptions<E extends IndexedMessage> {
  /** Ids of redacted events. */
  redacted: ReadonlySet<string>;
  /** The search form of a body, for entries written before bodies were prepared. */
  normalize: (text: string) => string;
  /** Whether a resolved entry matches; `body` is its search body. */
  matches: (entry: E, body: string) => boolean;
  /** The most results to give, newest first. Default 500, as searchEntries. */
  limit?: number;
  slicer?: Slicer;
}

export interface IndexSearch<E extends IndexedMessage> {
  /**
   * Takes in a batch of entries: the tail, then the blocks newest first, as
   * searchLocalIndex concatenates them. `prepared` says they were written with
   * `prepareEntry`; others have their bodies normalized here (and get `n`).
   */
  add(entries: readonly E[], prepared: boolean): Promise<void>;
  /**
   * What `searchEntries(resolveEntries(everything added, redacted), parsed, limit)` gives:
   * each original once, with its latest edit's text (or an edit standing in for an original
   * that isn't indexed), redactions dropped, newest first, at most `limit`. Doesn't change
   * what was added, so it can give partial results and be called again after more `add`s
   * (not while one runs).
   */
  results(): Promise<E[]>;
}

interface Ranked<E> {
  entry: E;
  /** Where resolveEntries would put it before sorting: ties in `t` keep this order. */
  order: number;
}

/** Whether `a` sorts after `b`: older, or as old and later in resolveEntries' order. */
function after<E extends IndexedMessage>(a: Ranked<E>, b: Ranked<E>): boolean {
  return a.entry.t !== b.entry.t ? a.entry.t < b.entry.t : a.order > b.order;
}

/** The `limit` first in sort order: a heap with the last of them on top. */
class Newest<E extends IndexedMessage> {
  readonly #heap: Ranked<E>[] = [];
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  add(item: Ranked<E>): void {
    const heap = this.#heap;
    if (heap.length < this.limit) {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!after(heap[i]!, heap[parent]!)) break;
        [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
        i = parent;
      }
      return;
    }
    if (heap.length === 0 || !after(heap[0]!, item)) return;
    heap[0] = item;
    for (let i = 0; ;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let last = i;
      if (left < heap.length && after(heap[left]!, heap[last]!)) last = left;
      if (right < heap.length && after(heap[right]!, heap[last]!)) last = right;
      if (last === i) break;
      [heap[i], heap[last]] = [heap[last]!, heap[i]!];
      i = last;
    }
  }

  sorted(): E[] {
    return [...this.#heap]
      .sort((a, b) => (after(a, b) ? 1 : after(b, a) ? -1 : 0))
      .map(({ entry }) => entry);
  }
}

/** A search over a room's index, fed and run a slice of the event loop at a time. */
export function createIndexSearch<E extends IndexedMessage>(
  options: IndexSearchOptions<E>,
): IndexSearch<E> {
  const { redacted, normalize, matches } = options;
  const limit = options.limit ?? 500;
  const slicer = options.slicer ?? createSlicer();
  // As resolveEntries keeps them: an original by id (the last copy seen, where the first
  // was), and the latest edit of each original.
  const originals = new Map<string, E>();
  const latestEdit = new Map<string, E>();

  return {
    async add(entries, prepared) {
      for (const entry of entries) {
        if (slicer.due) await slicer.pause();
        if (!prepared) entry.n = normalize(entry.b);
        if (redacted.has(entry.e)) continue;
        if (entry.o) {
          if (redacted.has(entry.o)) continue;
          const previous = latestEdit.get(entry.o);
          if (!previous || previous.t < entry.t) latestEdit.set(entry.o, entry);
        } else {
          originals.set(entry.e, entry);
        }
      }
    },

    async results() {
      const newest = new Newest<E>(Math.max(0, limit));
      let order = 0;
      for (const [id, original] of originals) {
        if (slicer.due) await slicer.pause();
        const edit = latestEdit.get(id);
        const entry = edit ? { ...original, b: edit.b, m: edit.m || original.m } : original;
        if (matches(entry, searchBody(edit ?? original))) newest.add({ entry, order });
        order++;
      }
      for (const [target, edit] of latestEdit) {
        if (originals.has(target)) continue;
        if (slicer.due) await slicer.pause();
        const entry = { ...edit, e: target, o: undefined };
        if (matches(entry, searchBody(edit))) newest.add({ entry, order });
        order++;
      }
      return newest.sorted();
    },
  };
}
