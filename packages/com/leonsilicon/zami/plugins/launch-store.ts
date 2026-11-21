// Where launch pages are kept: one per account, in an IndexedDB database of their own
// (they're too large for localStorage, and Zam's own databases are Zam's).
import type { LaunchPage } from "#launch-page";

const DATABASE = "zami-launch";
const STORE = "pages";

function request<T>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.addEventListener("success", () => resolve(pending.result));
    pending.addEventListener("error", () =>
      reject(pending.error ?? new Error("IndexedDB request failed")),
    );
  });
}

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (!database) {
    const pending = indexedDB.open(DATABASE, 1);
    pending.addEventListener("upgradeneeded", () => {
      pending.result.createObjectStore(STORE, { keyPath: "userId" });
    });
    database = request(pending);
    database.catch(() => {
      database = undefined;
    });
  }
  return database;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(STORE, mode).objectStore(STORE);
}

export async function readLaunchPage(userId: string): Promise<LaunchPage | null> {
  const page = await request<LaunchPage | undefined>((await store("readonly")).get(userId));
  return page ?? null;
}

export async function writeLaunchPage(page: LaunchPage): Promise<void> {
  await request((await store("readwrite")).put(page));
}

/** Deletes the pages of every account but `userIds`: a signed-out account leaves none. */
export async function keepLaunchPages(userIds: readonly string[]): Promise<void> {
  const pages = await store("readwrite");
  for (const key of await request(pages.getAllKeys())) {
    if (typeof key !== "string" || !userIds.includes(key)) pages.delete(key);
  }
}
