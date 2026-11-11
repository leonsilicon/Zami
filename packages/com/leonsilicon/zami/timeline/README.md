# @-/com.leonsilicon.zami.timeline

What keeps an open room (its timeline, composer and member list) from freezing the app on
a large account. React Native draws only between turns of the JS event loop, so each of
these turns one long or repeated stretch of work into short ones:

- `createCoalescer(run, { delayMs })`: many requests, one run. A page of encrypted
  messages decrypts one event at a time; the timeline re-reads once for the page, on the
  next turn or animation frame (whichever comes first), or after `delayMs` (read receipts).
- `forEachSliced(items, fn, { sliceMs })`: a long loop a few milliseconds at a time, with a
  turn of the event loop between slices.
- `loadMembersInSlices(room, { mapEvent })`: matrix-js-sdk's `Room.loadMembersIfNeeded`,
  applying a large room's members in slices and not writing them to the sync store (which
  the next launch would read back whole). It shares the room's `membersPromise`, so the
  SDK's own callers (encryption) wait for it instead of loading again.
- `MemberIndex`: members with their ids and names lowercased once, for mention search and
  for deciding which `@words` in the composer are mentions.
- `createFanout({ facts, attach, detach })`: one listener on an emitter for every
  subscriber, with each event's facts worked out once (lazily) and each classifier run
  once per event, however many subscribers share it. The client's RoomEvent.Timeline
  subscribers go through one, including for the thousands of events a launch replays.
- `movesOthersReceipts(content, ownUserId)`: whether a receipt event changes what the
  timeline's read-receipt avatars show (most are the user's own).
- `createValueStore(value)` and `useValueStore(store, select)`: a value that changes often
  (the composer's text, the timeline's rows) outside React state, so only the components
  that read it re-render, and only when what they read changes.
