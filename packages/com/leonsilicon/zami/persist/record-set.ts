// A set of records (one per room, say) saved incrementally in IndexedDB, split between two
// databases: a small "first" one that is read at launch, and the "rest", read later a batch at
// a time. Each save writes only the records whose fingerprint or part changed, a slice at a
// time, deletes the ones that are gone, and then a head record listing what's saved.
//
// Two databases because Zami's IndexedDB loads a whole database the first time it's opened:
// the first part must stay small for the launch to be quick.
import { hashString } from "#hash";
import { readRangeSliced, requestDone, transactionDone, writeSliced } from "#idb";
import { createYielder, type Yielder } from "#yielder";

/** The head's format. */
export const RECORD_SET_VERSION = 2;

export interface RecordSetOptions {
  /** The databases of the first part and of the rest. */
  dbNames: readonly [first: string, rest: string];
  /** Their object store (out-of-line keys), created if missing. */
  storeName: string;
}

export interface RecordEntry<T> {
  id: string;
  /** Changes whenever the record would (see hashString). */
  fingerprint: number;
  /** Whether it belongs to the first part. */
  first: boolean;
  /** The record, plain JSON; only called when it has to be written. */
  build: () => T;
}

/** What's saved of each record: its fingerprint, and 0 (first part) or 1 (the rest). */
type Index = Record<string, [fingerprint: number, part: 0 | 1]>;

/** The head record (at the set's key in the first database). */
export interface RecordSetHead<H> {
  v: typeof RECORD_SET_VERSION;
  savedAt: number;
  index: Index;
  /** hashString of `data`'s JSON. */
  dataHash: number;
  data: H;
}

export interface SaveOptions {
  yielder?: Yielder;
  /** Checked between slices: a save stops (leaving the old head) once it returns false. */
  isCurrent?: () => boolean;
}

export interface RecordSet<H, T> {
  /** Writes what changed since the last save. Resolves whether it finished. */
  save(
    key: string,
    data: H,
    entries: readonly RecordEntry<T>[],
    options?: SaveOptions,
  ): Promise<boolean>;
  /** The head as stored (any version, or undefined) and the first part's records. */
  loadFirst(key: string): Promise<{ head: unknown; records: T[] }>;
  /** The rest's records, read a batch at a time. */
  loadRest(key: string, options?: { yielder?: Yielder }): Promise<T[]>;
  /** Deletes the head and every record. */
  delete(key: string): Promise<void>;
}

function openDb(name: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const recordKey = (key: string, id: string) => `${key}|${id}`;
const recordRange = (key: string) => IDBKeyRange.bound(`${key}|`, `${key}|\uffff`);

export function createRecordSet<H, T>({ dbNames, storeName }: RecordSetOptions): RecordSet<H, T> {
  /** What the last save or load found saved, per key. */
  const known = new Map<string, RecordSetHead<H>>();
  let queue: Promise<unknown> = Promise.resolve();

  const withDbs = async <R>(run: (dbs: [IDBDatabase, IDBDatabase]) => Promise<R>): Promise<R> => {
    const dbs = await Promise.all(dbNames.map((name) => openDb(name, storeName)));
    try {
      return await run(dbs as [IDBDatabase, IDBDatabase]);
    } finally {
      for (const db of dbs) db.close();
    }
  };

  const readHead = async (db: IDBDatabase, key: string): Promise<unknown> =>
    requestDone(db.transaction(storeName, "readonly").objectStore(storeName).get(key));

  async function save(
    key: string,
    data: H,
    entries: readonly RecordEntry<T>[],
    { yielder = createYielder(), isCurrent = () => true }: SaveOptions,
  ): Promise<boolean> {
    return withDbs(async (dbs) => {
      let head = known.get(key);
      if (!head) {
        const stored = (await readHead(dbs[0], key)) as RecordSetHead<H> | undefined;
        if (stored?.v === RECORD_SET_VERSION) head = stored;
      }
      const dataJson = JSON.stringify(data) ?? "null";
      const dataHash = hashString(dataJson);
      const index: Index = {};
      const writes: [RecordEntry<T>[], RecordEntry<T>[]] = [[], []];
      const deletes: [string[], string[]] = [[], []];
      for (const entry of entries) {
        const part = entry.first ? 0 : 1;
        index[entry.id] = [entry.fingerprint, part];
        const saved = head?.index[entry.id];
        if (!saved || saved[0] !== entry.fingerprint || saved[1] !== part) writes[part].push(entry);
        if (saved && saved[1] !== part) deletes[saved[1]].push(entry.id);
      }
      if (head) {
        for (const id in head.index) if (!(id in index)) deletes[head.index[id]![1]].push(id);
      } else {
        // Nothing known about what's stored (a first save, or an older format): anything
        // stored that isn't written now goes, and so does an older format's record.
        for (const part of [0, 1] as const) {
          const keys = await requestDone(
            dbs[part]
              .transaction(storeName, "readonly")
              .objectStore(storeName)
              .getAllKeys(recordRange(key)),
          );
          for (const stored of keys) {
            const id = (stored as string).slice(key.length + 1);
            if (index[id]?.[1] !== part) deletes[part].push(id);
          }
        }
      }
      const changed =
        writes[0].length + writes[1].length + deletes[0].length + deletes[1].length > 0;
      if (head && !changed && head.dataHash === dataHash) return true;

      for (const part of [0, 1] as const) {
        if (!isCurrent()) return false;
        await writeSliced(
          dbs[part],
          storeName,
          writes[part],
          (store, entry) => store.put(entry.build(), recordKey(key, entry.id)),
          { yielder, maxBatch: 20 },
        );
        if (!isCurrent()) return false;
        await writeSliced(
          dbs[part],
          storeName,
          deletes[part],
          (store, id) => store.delete(recordKey(key, id)),
          { yielder, maxBatch: 100 },
        );
      }
      if (yielder.due) await yielder.next();
      if (!isCurrent()) return false;
      const next: RecordSetHead<H> = {
        v: RECORD_SET_VERSION,
        savedAt: Date.now(),
        index,
        dataHash,
        data: JSON.parse(dataJson) as H,
      };
      const transaction = dbs[0].transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(next, key);
      await transactionDone(transaction);
      if (!head) {
        // An older format kept the rest under the key itself.
        const rest = dbs[1].transaction(storeName, "readwrite");
        rest.objectStore(storeName).delete(key);
        await transactionDone(rest);
      }
      known.set(key, next);
      return true;
    });
  }

  return {
    save(key, data, entries, options = {}) {
      const run = queue.then(() => save(key, data, entries, options));
      queue = run.catch(() => {});
      return run;
    },

    async loadFirst(key) {
      const db = await openDb(dbNames[0], storeName);
      try {
        const store = db.transaction(storeName, "readonly").objectStore(storeName);
        const [head, records] = await Promise.all([
          requestDone(store.get(key)),
          requestDone(store.getAll(recordRange(key)) as IDBRequest<T[]>),
        ]);
        const typed = head as RecordSetHead<H> | undefined;
        if (typed?.v === RECORD_SET_VERSION) known.set(key, typed);
        else known.delete(key);
        return { head, records };
      } finally {
        db.close();
      }
    },

    async loadRest(key, { yielder = createYielder() } = {}) {
      const db = await openDb(dbNames[1], storeName);
      try {
        const records: T[] = [];
        await readRangeSliced<T>(
          db,
          storeName,
          recordRange(key),
          (batch) => void records.push(...batch),
          {
            yielder,
          },
        );
        return records;
      } finally {
        db.close();
      }
    },

    async delete(key) {
      known.delete(key);
      await withDbs(async (dbs) => {
        for (const db of dbs) {
          const transaction = db.transaction(storeName, "readwrite");
          const store = transaction.objectStore(storeName);
          store.delete(key);
          store.delete(recordRange(key));
          await transactionDone(transaction);
        }
      });
    },
  };
}
