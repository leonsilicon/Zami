# @-/com.leonsilicon.zami.persist

Saves and restores the app's large caches a room at a time, a few milliseconds per turn of the
event loop, so neither a save nor a launch freezes the app.

React Native draws a frame only between tasks of the JS event loop, and there's no worker to
hand persistence to: a save that serialises a whole account, or a launch that reads one back in
a single call, holds the screen for as long as it takes. With thousands of rooms that was
seconds, every few minutes.

- `SlicedIndexedDBStore`: matrix-js-sdk's `IndexedDBStore` with its /sync data (the
  `SyncAccumulator`'s) stored as one record per room. A save writes only the rooms that
  changed since the last one, a batch per transaction, and returns at once so the sync loop
  never waits for it. The rooms are read back only when the SDK asks for the saved sync, in
  batches. A store saved by the SDK's own backend (one `{ nextBatch, roomsData }` record) is
  read once and rewritten; an older build reading the new layout finds no saved sync and does
  an initial sync rather than misreading it. The token is written after the rooms, so it's
  never ahead of them.
- `createRecordSet`: records (the saved room list's rooms) kept across two IndexedDB
  databases, a small one read at launch and the rest read later, written incrementally by
  fingerprint.
- `createYielder`: `if (turn.due) await turn.next()` between steps of a long loop gives the
  event loop a turn (`setTimeout(0)`) once a slice's time is used up.
- `readRangeSliced`, `writeSliced`: IndexedDB reads and writes spread over many small
  transactions.
- `hashString`: a fast 53-bit string hash for fingerprints.

`patches/matrix-js-sdk@*.patch` does the same for the SDK's processing of a /sync response
(and of the saved one at launch): rooms are created and processed a few at a time, with turns
of the event loop between. `__tests__/sync-patch.test.ts` checks it.
