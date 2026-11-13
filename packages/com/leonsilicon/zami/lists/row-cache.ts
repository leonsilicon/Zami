// Rows for a FlatList that keep their objects (and the list its array) while nothing in
// them changed, so a rebuild that changes nothing re-renders no cell.

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

/** Whether two rows have the same own fields with `Object.is`-equal values. */
export function sameFields(a: object, b: object): boolean {
  if (a === b) return true;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  let count = 0;
  for (const key in a) {
    if (!hasOwn(a, key)) continue;
    count++;
    if (!hasOwn(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      return false;
  }
  for (const key in b) if (hasOwn(b, key)) count--;
  return count === 0;
}

export interface RowCache<R extends { key: string }> {
  /**
   * Builds the list: `build` makes each row with `row(...)`, which hands back the
   * previous build's row of the same key when its fields are the same. Returns the
   * previous build's array when every row is.
   */
  build(build: (row: <T extends R>(row: T) => T) => R[]): readonly R[];
  /** The last build's rows. */
  readonly rows: readonly R[];
}

export function createRowCache<R extends { key: string }>(): RowCache<R> {
  let byKey = new Map<string, R>();
  let rows: readonly R[] = [];
  return {
    build(build) {
      const next = new Map<string, R>();
      const row = <T extends R>(candidate: T): T => {
        const old = byKey.get(candidate.key);
        const kept = old !== undefined && sameFields(old, candidate) ? (old as T) : candidate;
        next.set(candidate.key, kept);
        return kept;
      };
      const list = build(row);
      byKey = next;
      if (list.length !== rows.length || list.some((r, i) => r !== rows[i])) rows = list;
      return rows;
    },
    get rows() {
      return rows;
    },
  };
}
