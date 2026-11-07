// IndexedDB for Zam's code (matrix-js-sdk's Rust crypto store, Zam's own stores): React
// Native has none, so this installs fake-indexeddb written through to SQLite. Installing
// it loads the databases, which is asynchronous: the root waits for `storageReady` before
// it starts Zam's code.
import { openDatabaseSync } from "expo-sqlite";
import { installPersistentIndexedDB } from "react-native-indexeddb-sqlite";
import { expoSqlite } from "react-native-indexeddb-sqlite/expo";

export const storageReady: Promise<unknown> = installPersistentIndexedDB({
  sqlite: expoSqlite(openDatabaseSync("indexeddb.db")),
});
