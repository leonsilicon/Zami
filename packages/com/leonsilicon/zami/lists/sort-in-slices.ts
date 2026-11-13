// A stable sort that runs a few milliseconds per turn of the event loop. Sorting thousands
// of names with `Intl.Collator` costs a native call per comparison on Hermes (tens of
// thousands for a large room's member list): done in one go, that is a visible freeze.

export interface SliceOptions {
  /** How long one turn may run before yielding (ms). Default 8. */
  sliceMs?: number;
  /** Stops the sort at its next yield: the promise then resolves to null. */
  cancelled?: () => boolean;
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. */
  schedule?: (run: () => void) => void;
}

/** Sorted runs are this long before merging; each is sorted in one go. */
const RUN = 16;
/** Items between clock reads inside a merge. */
const CHECK_EVERY = 64;

/**
 * A sorted copy of `items` (stable, like `Array.prototype.sort`), or null when
 * `options.cancelled` turned true. Resolves without yielding when the whole sort fits in
 * one slice.
 */
export async function sortInSlices<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
  options: SliceOptions = {},
): Promise<T[] | null> {
  const sliceMs = options.sliceMs ?? 8;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0));
  const n = items.length;
  let src = items.slice();
  let dst: T[] = Array.from({ length: n });
  let sliceStart = now();
  const overdue = () => now() - sliceStart >= sliceMs;
  const nextTurn = async (): Promise<boolean> => {
    await new Promise<void>((resolve) => schedule(resolve));
    sliceStart = now();
    return !options.cancelled?.();
  };

  // Insertion-sorted runs.
  for (let lo = 0; lo < n; lo += RUN) {
    const hi = Math.min(lo + RUN, n);
    for (let i = lo + 1; i < hi; i++) {
      const item = src[i]!;
      let j = i - 1;
      while (j >= lo && compare(src[j]!, item) > 0) {
        src[j + 1] = src[j]!;
        j--;
      }
      src[j + 1] = item;
    }
    if (overdue() && !(await nextTurn())) return null;
  }

  // Bottom-up merges, each pass from `src` into `dst`.
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      for (let k = lo; k < hi; k++) {
        // `<= 0` takes the left run first on ties: stable.
        if (i < mid && (j >= hi || compare(src[i]!, src[j]!) <= 0)) dst[k] = src[i++]!;
        else dst[k] = src[j++]!;
        if ((k & (CHECK_EVERY - 1)) === 0 && overdue() && !(await nextTurn())) return null;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}
