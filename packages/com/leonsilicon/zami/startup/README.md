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
- The record is saved to `localStorage` after each change, so the next launch can show what
  this one did even if it never got as far as the chats: `previousStartup()`.

The splash shows the current step once a launch has taken more than a second, Settings ›
Debug lists this launch and the one before, and the client log export starts with them.
