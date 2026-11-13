// `localStorage` served from memory and written behind to a backend (SQLite in the app).
//
// expo-sqlite's own `localStorage` runs a synchronous SQLite query for every call, so a
// store that writes on every event (the notification inbox) or every slider step blocks the
// JS thread each time. This one reads every item once, at install; after that `getItem` is a
// Map lookup and `setItem` a Map write plus a note of what changed. The changes go to the
// backend in batches: one write a short while after the first change, and right away when
// the app goes to the background (`flush`).
//
// The guarantee: what a crash or a kill loses is at most the changes of the last
// `flushDelayMs` (plus a write in flight); a batch is applied in one transaction, so what is
// on disk is always every change up to some point, in order.

/** The changes since the last write: `clear` first, then the removals, then the sets. */
export interface StorageBatch {
  clear: boolean;
  remove: Set<string>;
  set: Map<string, string>;
}

export interface StorageBackend {
  /** Every stored item, read once when the storage is created. */
  load(): Iterable<readonly [string, string]>;
  /** Applies a batch in one transaction. */
  write(batch: StorageBatch): Promise<void>;
}

export interface CachedStorageOptions {
  /** How long after the first change the batch is written. Default 250 ms. */
  flushDelayMs?: number;
  /** Called when a write fails (it is retried with the changes made since). */
  onError?: (error: unknown) => void;
  setTimeout?: (task: () => void, ms: number) => unknown;
}

export interface CachedStorage extends Storage {
  /** Writes what changed now, and resolves once it (and any write before it) is done. */
  flush(): Promise<void>;
}

function emptyBatch(): StorageBatch {
  return { clear: false, remove: new Set(), set: new Map() };
}

function isEmpty(batch: StorageBatch): boolean {
  return !batch.clear && batch.remove.size === 0 && batch.set.size === 0;
}

/** `older` followed by `newer`, as one batch. */
function merge(older: StorageBatch, newer: StorageBatch): StorageBatch {
  if (newer.clear) return newer;
  const merged: StorageBatch = {
    clear: older.clear,
    remove: new Set(older.remove),
    set: new Map(older.set),
  };
  for (const key of newer.remove) {
    merged.set.delete(key);
    merged.remove.add(key);
  }
  for (const [key, value] of newer.set) {
    merged.remove.delete(key);
    merged.set.set(key, value);
  }
  return merged;
}

/** The Storage methods; every other property name reads and writes an item, as on the web. */
const METHODS = new Set<PropertyKey>([
  "getItem",
  "setItem",
  "removeItem",
  "clear",
  "key",
  "length",
  "flush",
  "toString",
  "constructor",
  Symbol.toStringTag,
]);

export function createCachedStorage(
  backend: StorageBackend,
  options: CachedStorageOptions = {},
): CachedStorage {
  const delay = options.flushDelayMs ?? 250;
  const later = options.setTimeout ?? ((task: () => void, ms: number) => setTimeout(task, ms));
  const onError =
    options.onError ?? ((error: unknown) => console.warn("localStorage: write failed", error));
  const items = new Map<string, string>();
  for (const [key, value] of backend.load()) items.set(key, value);
  let keys: string[] | null = null;
  let pending = emptyBatch();
  let timer = false;
  let writing: Promise<void> = Promise.resolve();
  let failures = 0;

  function schedule(ms = delay): void {
    if (timer) return;
    timer = true;
    later(() => {
      timer = false;
      void flush();
    }, ms);
  }

  function flush(): Promise<void> {
    if (isEmpty(pending)) return writing;
    const batch = pending;
    pending = emptyBatch();
    writing = writing.then(async () => {
      try {
        await backend.write(batch);
        failures = 0;
      } catch (error) {
        onError(error);
        // Keep the changes, under any made since, and try again later.
        pending = merge(batch, pending);
        failures++;
        schedule(Math.min(delay * 2 ** failures, 30_000));
      }
    });
    return writing;
  }

  const storage: CachedStorage = {
    get length(): number {
      return items.size;
    },
    key(index: number): string | null {
      keys ??= [...items.keys()];
      return keys[Number(index)] ?? null;
    },
    getItem(key: string): string | null {
      return items.get(String(key)) ?? null;
    },
    setItem(key: string, value: string): void {
      const k = String(key);
      const v = String(value);
      if (items.get(k) === v) return;
      if (!items.has(k)) keys = null;
      items.set(k, v);
      pending.remove.delete(k);
      pending.set.set(k, v);
      schedule();
    },
    removeItem(key: string): void {
      const k = String(key);
      if (!items.delete(k)) return;
      keys = null;
      pending.set.delete(k);
      pending.remove.add(k);
      schedule();
    },
    clear(): void {
      if (items.size === 0) return;
      items.clear();
      keys = null;
      pending = { clear: true, remove: new Set(), set: new Map() };
      schedule();
    },
    flush,
  };
  Object.defineProperty(storage, Symbol.toStringTag, { value: "Storage", configurable: true });

  // `localStorage.foo`, `localStorage.foo = "x"`, `delete localStorage.foo`, `"foo" in
  // localStorage` and `Object.keys(localStorage)` reach the items, as on the web.
  return new Proxy(storage, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || METHODS.has(prop)) return Reflect.get(target, prop, receiver);
      return items.get(prop);
    },
    set(target, prop, value, receiver) {
      if (typeof prop !== "string" || METHODS.has(prop)) {
        return Reflect.set(target, prop, value, receiver);
      }
      target.setItem(prop, String(value));
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop !== "string" || METHODS.has(prop))
        return Reflect.deleteProperty(target, prop);
      target.removeItem(prop);
      return true;
    },
    has(target, prop) {
      if (typeof prop !== "string" || METHODS.has(prop)) return Reflect.has(target, prop);
      return items.has(prop);
    },
    ownKeys() {
      return [...items.keys()];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && items.has(prop)) {
        return { value: items.get(prop), writable: true, enumerable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
}
