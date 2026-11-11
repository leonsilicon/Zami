// IndexedDB for Zam's code (matrix-js-sdk's Rust crypto store, Zam's own stores): React
// Native has none, so this installs fake-indexeddb written through to SQLite. Installing
// it is asynchronous: the root waits for `storageReady` before it starts Zam's code. A
// database then loads the first time it is opened, a few milliseconds at a time, and
// IndexedDB work yields to the event loop every 8 ms (react-native-indexeddb-sqlite, with
// patches/fake-indexeddb@6.2.7.patch).
import {
  setStallContext,
  setStallWatchActive,
  setStartupStatsSource,
} from "@-/com.leonsilicon.zami.startup";
import { openDatabaseSync } from "expo-sqlite";
import { AppState } from "react-native";
import { installPersistentIndexedDB } from "react-native-indexeddb-sqlite";
import { expoSqlite } from "react-native-indexeddb-sqlite/expo";

export const storageReady: Promise<unknown> = installPersistentIndexedDB({
  sqlite: expoSqlite(openDatabaseSync("indexeddb.db")),
}).then((installed) => {
  // The launch timeline notes how much of it each step loads from SQLite, and each stall
  // after the launch how much IndexedDB work ran during it.
  const { stats, scheduler } = installed;
  setStartupStatsSource(() => ({
    hydratedRecords: stats.hydratedRecords,
    hydrateMs: stats.hydrateMs,
    indexBuilds: stats.indexBuilds,
    indexBuildMs: stats.indexBuildMs,
    commits: stats.commits,
    idbTasks: scheduler?.tasks ?? 0,
  }));
  return installed;
});

// The stall watch after the launch (@-/com.leonsilicon.zami.startup) pauses in the
// background, and labels each stall with where the app was. Zam's stores load with the app,
// after this file; they're read once they have.
setStallWatchActive(AppState.currentState !== "background");
AppState.addEventListener("change", (state) => setStallWatchActive(state !== "background"));

let stores:
  | [typeof import("$lib/stores/rooms.svelte"), typeof import("$lib/stores/interface.svelte")]
  | null = null;
void storageReady
  .then(() =>
    Promise.all([import("$lib/stores/rooms.svelte"), import("$lib/stores/interface.svelte")]),
  )
  .then((loaded) => {
    stores = loaded;
  });

setStallContext(() => {
  if (!stores) return "";
  const [{ roomsState }, { interfaceState }] = stores;
  const parts = [roomsState.activeRoomId ? `room ${roomsState.activeRoomId}` : "no room open"];
  if (interfaceState.leftOpen) parts.push("drawer open");
  if (interfaceState.modal) parts.push(`${interfaceState.modal} open`);
  if (interfaceState.sidebar) parts.push(`${interfaceState.sidebar} panel`);
  if (interfaceState.composerPicker) parts.push(`${interfaceState.composerPicker} picker`);
  return parts.join(", ");
});
