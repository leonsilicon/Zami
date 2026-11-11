export interface UpdateSortedOptions<T> {
  /** A stable identity for an item across updates (a user id). */
  id: (item: T) => string;
  /**
   * Whether `next` sorts exactly where `previous` did: every field `compare` reads is the
   * same. An item that changed is taken out and inserted again.
   */
  sameSortKey: (previous: T, next: T) => boolean;
  /** A total order: break ties (by id) so the result doesn't depend on input order. */
  compare: (a: T, b: T) => number;
  /**
   * Above this share of changed items, sort everything again instead (default 1/8).
   * Inserting one item costs `log n` comparisons; sorting all costs `n log n`.
   */
  resortRatio?: number;
}

/**
 * `next` sorted by `compare`, reusing the order of `previous` (the result of the last
 * call) for the items whose sort key didn't change. A member list of thousands sorted
 * with a locale collator costs tens of milliseconds; a sync that changes a few members
 * then costs a few comparisons each instead of a full sort.
 *
 * The result is a new array of `next`'s items, in the order a full sort would give.
 */
export function updateSorted<T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  options: UpdateSortedOptions<T>,
): T[] {
  const { id, sameSortKey, compare, resortRatio = 1 / 8 } = options;
  if (previous === undefined || previous.length === 0) return [...next].sort(compare);

  const nextById = new Map<string, T>();
  for (const item of next) nextById.set(id(item), item);

  // The previous order, minus what left or changed: still sorted, since none of these
  // items' keys changed. Each takes its new object.
  const kept: T[] = [];
  const keptIds = new Set<string>();
  for (const item of previous) {
    const itemId = id(item);
    const current = nextById.get(itemId);
    if (current === undefined || keptIds.has(itemId) || !sameSortKey(item, current)) continue;
    kept.push(current);
    keptIds.add(itemId);
  }
  const added: T[] = [];
  for (const [itemId, item] of nextById) if (!keptIds.has(itemId)) added.push(item);
  if (added.length === 0) return kept;
  if (added.length > next.length * resortRatio) return [...next].sort(compare);

  added.sort(compare);
  const out: T[] = [];
  let k = 0;
  // `added` is sorted, so each one's place in `kept` is at or after the previous one's.
  let low = 0;
  for (const item of added) {
    let high = kept.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compare(kept[mid], item) <= 0) low = mid + 1;
      else high = mid;
    }
    while (k < low) out.push(kept[k++]);
    out.push(item);
  }
  while (k < kept.length) out.push(kept[k++]);
  return out;
}
