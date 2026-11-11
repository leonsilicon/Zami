// IndexedDB reads and writes spread over turns of the event loop: many small transactions
// instead of one big one, so no single commit (a synchronous SQLite write in Zami's
// IndexedDB) or clone holds the JS thread for long.
import type { Yielder } from "#yielder";

export function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
  });
}

export interface SlicedOptions {
  yielder: Yielder;
  /** At most this many records per transaction. */
  maxBatch?: number;
}

/**
 * Reads the records in `range` a batch per transaction, handing each batch to `onBatch`
 * (values with their primary keys) and yielding between batches once the slice is used up.
 * `onBatch` may return `false` to stop. Records written meanwhile may or may not be seen.
 */
export async function readRangeSliced<T>(
  db: IDBDatabase,
  storeName: string,
  range: IDBKeyRange | null,
  onBatch: (values: T[], keys: IDBValidKey[]) => boolean | void,
  { yielder, maxBatch = 25 }: SlicedOptions,
): Promise<void> {
  const keys = await requestDone(
    db.transaction(storeName, "readonly").objectStore(storeName).getAllKeys(range),
  );
  for (let i = 0; i < keys.length; i += maxBatch) {
    if (yielder.due) await yielder.next();
    const batchKeys = keys.slice(i, i + maxBatch);
    const store = db.transaction(storeName, "readonly").objectStore(storeName);
    const bound = IDBKeyRange.bound(batchKeys[0], batchKeys.at(-1));
    const [values, actualKeys] = await Promise.all([
      requestDone(store.getAll(bound) as IDBRequest<T[]>),
      requestDone(store.getAllKeys(bound)),
    ]);
    if (onBatch(values, actualKeys) === false) return;
  }
}

/**
 * Calls `write(store, item)` for each item inside readwrite transactions, ending a
 * transaction after `maxBatch` items or once the slice is used up, and yielding between them.
 * Each transaction commits before the next starts; a failed one rejects.
 */
export async function writeSliced<T>(
  db: IDBDatabase,
  storeName: string,
  items: readonly T[],
  write: (store: IDBObjectStore, item: T) => void,
  { yielder, maxBatch = 50 }: SlicedOptions,
): Promise<void> {
  let next = 0;
  while (next < items.length) {
    if (yielder.due) await yielder.next();
    const transaction = db.transaction(storeName, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(storeName);
    let count = 0;
    try {
      do {
        write(store, items[next++]!);
        count++;
      } while (next < items.length && count < maxBatch && !yielder.due);
    } catch (error) {
      transaction.abort();
      void done.catch(() => {});
      throw error;
    }
    await done;
  }
}
