// A cache of answers from the crypto engine (a user's identity status, a device's trust)
// that a change event invalidates, and that a lookup already in flight when the event came
// can't fill with the old answer.

/** What `begin` hands out and `set` checks: the key's version when the lookup started. */
export interface CacheTicket {
  readonly epoch: number;
  readonly version: number;
}

export interface VersionedCache<K, V> {
  has(key: K): boolean;
  get(key: K): V | undefined;
  /** Call before looking a value up; pass the ticket to `set` and `isCurrent`. */
  begin(key: K): CacheTicket;
  /** Whether nothing invalidated `key` since `ticket` was taken. */
  isCurrent(key: K, ticket: CacheTicket): boolean;
  /** Store a looked-up value, unless the key was invalidated meanwhile. True if stored. */
  set(key: K, value: V, ticket: CacheTicket): boolean;
  /** Forget `key`, and refuse values looked up before now. */
  invalidate(key: K): void;
  /** Forget every key `match` accepts. */
  invalidateWhere(match: (key: K) => boolean): void;
  /** Forget everything. */
  clear(): void;
  readonly size: number;
}

export function createVersionedCache<K, V>(): VersionedCache<K, V> {
  const values = new Map<K, V>();
  const versions = new Map<K, number>();
  let epoch = 0;

  const ticketOf = (key: K): CacheTicket => {
    // Recorded, so `invalidateWhere` sees a key whose first lookup is still in flight.
    if (!versions.has(key)) versions.set(key, 0);
    return { epoch, version: versions.get(key)! };
  };
  const isCurrent = (key: K, ticket: CacheTicket) =>
    ticket.epoch === epoch && ticket.version === (versions.get(key) ?? 0);
  const invalidate = (key: K) => {
    values.delete(key);
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };

  return {
    has: (key) => values.has(key),
    get: (key) => values.get(key),
    begin: ticketOf,
    isCurrent,
    set(key, value, ticket) {
      if (!isCurrent(key, ticket)) return false;
      values.set(key, value);
      return true;
    },
    invalidate,
    invalidateWhere(match) {
      // Every key with a value or a lookup started has a version. Invalidating sets an
      // existing key, which doesn't disturb the iteration.
      for (const key of versions.keys()) if (match(key)) invalidate(key);
    },
    clear() {
      values.clear();
      versions.clear();
      epoch++;
    },
    get size() {
      return values.size;
    },
  };
}
