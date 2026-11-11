// The backend in the app: the same SQLite database and table expo-sqlite's `localStorage`
// used (`ExpoSQLiteStorage`, `storage`), so what it stored is still there. Items are read
// with one query at install; batches are written with the asynchronous API, on a connection
// of their own, so a write never holds the JS thread while SQLite works.
import { AppState } from "react-native";
import { openDatabaseSync, type SQLiteDatabase, type SQLiteStatement } from "expo-sqlite";
import {
  createCachedStorage,
  type CachedStorage,
  type CachedStorageOptions,
  type StorageBackend,
  type StorageBatch,
} from "#local-storage";

const DATABASE = "ExpoSQLiteStorage";

export function expoStorageBackend(name = DATABASE): StorageBackend {
  const db: SQLiteDatabase = openDatabaseSync(name, { useNewConnection: true });
  // expo-sqlite's migration: the table, and the version it marks the file with.
  db.execSync("CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT)");
  if ((db.getFirstSync<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0) < 1) {
    db.execSync("PRAGMA user_version = 1");
  }
  let statements: Promise<{ set: SQLiteStatement; remove: SQLiteStatement }> | null = null;
  const prepare = () =>
    (statements ??= (async () => ({
      set: await db.prepareAsync(
        "INSERT INTO storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ),
      remove: await db.prepareAsync("DELETE FROM storage WHERE key = ?"),
    }))());
  return {
    *load() {
      for (const row of db.getAllSync<{ key: string; value: string | null }>(
        "SELECT key, value FROM storage",
      )) {
        yield [row.key, row.value ?? ""] as const;
      }
    },
    async write(batch: StorageBatch) {
      const { set, remove } = await prepare();
      // Only this module uses this connection, one batch at a time, so nothing else's
      // statements can land inside the transaction.
      await db.withTransactionAsync(async () => {
        if (batch.clear) await db.execAsync("DELETE FROM storage");
        for (const key of batch.remove) await remove.executeAsync([key]);
        for (const [key, value] of batch.set) await set.executeAsync([key, value]);
      });
    },
  };
}

/**
 * Defines `localStorage` on `globalThis`: items in memory, written to expo-sqlite in batches,
 * and right away whenever the app leaves the foreground.
 */
export function installLocalStorage(options?: CachedStorageOptions): CachedStorage {
  const storage = createCachedStorage(expoStorageBackend(), options);
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  AppState.addEventListener("change", (state) => {
    // After this event's other listeners, which may still write (they run synchronously).
    if (state !== "active") setTimeout(() => void storage.flush(), 0);
  });
  return storage;
}
