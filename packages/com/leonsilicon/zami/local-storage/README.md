# @-/com.leonsilicon.zami.local-storage

`localStorage` for Zam's code, served from memory and written to SQLite in batches.

expo-sqlite's own `localStorage` runs a synchronous SQLite query for every call, so code that
writes on every event (the notification inbox, once per notifying message) or on every step of
a slider blocks the JS thread each time. This one reads every item with one query when it is
installed (`apps/zami/polyfills.ts`); after that, `getItem` is a `Map` lookup and `setItem` a
`Map` write. What changed goes to SQLite with expo-sqlite's asynchronous API, on a connection of
its own: one batch a short while (250 ms) after the first change, and right away when the app
leaves the foreground.

- It uses expo-sqlite's database and table (`ExpoSQLiteStorage`, `storage`), so what the app
  stored before is still there.
- A crash or kill loses at most the last quarter second of changes. A batch is one SQLite
  transaction, so the file always holds every change up to some point, in order.
- A failed write is retried, with the changes made since, after a growing delay.
- It is a whole `Storage`: `getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`, and
  property access (`localStorage.foo`, `Object.keys(localStorage)`).

```ts
import { installLocalStorage } from "@-/com.leonsilicon.zami.local-storage";
const storage = installLocalStorage();
await storage.flush(); // write what changed now
```
