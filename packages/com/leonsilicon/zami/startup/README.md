# @-/com.leonsilicon.zami.startup

A timeline of each app launch, for finding out where a slow "Restoring session…" spends its
time on a real device.

- `markStartup(step, detail?)` records that a step began; the step before it ends there.
  Zami's versions of Zam's restore path call it (opening the message cache, the encryption
  store, starting sync, showing the chats), and `finishStartup()` once the first live sync
  response is in.
- `setStartupStatsSource()` takes react-native-indexeddb-sqlite's running stats, so each step
  also notes how many records and indexes it loaded from SQLite and how long that took.
- While the launch runs, a 50 ms timer measures the longest stretch the JS thread went
  without running it, and during which step.
- After the launch, a timer five times a second keeps watching for the rest of the session,
  paused while the app is in the background (`setStallWatchActive`). A timer 50 ms or more
  late is a stall: it keeps the ten longest, each with what the app was showing before and
  after it (`setStallContext`, which the app points at the open room, modal, side panel and
  drawer) and the IndexedDB work that ran meanwhile, and counts them all. When nothing
  stalls, that is one timer callback every 200 ms.
- The record is saved to `localStorage` after each step, and a couple of seconds after new
  stalls, so the next launch can show what this one did even if it never got as far as the
  chats, or froze later: `previousStartup()`.

The splash shows the current step once a launch has taken more than a second, Settings ›
Debug lists this launch and the one before (Startup) and their stalls (Stalls), and the
client log export starts with them.
