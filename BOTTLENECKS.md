# Zami performance bottlenecks

Audit of 2026-11-10 on `trunk` at `afeb5506`. Requirement: **the UI must never freeze**. The
JS thread and the main thread must stay responsive at all times: no synchronous stretch
over about 50 ms on the JS thread, and no promise chain that keeps the event loop from
turning.

This file is a work list for whoever fixes these. Status as of 2026-11-10 (evening) is in
the next section; the item descriptions below are the original audit.

## Status (2026-11-10, uncommitted on `trunk`)

Measured on a fresh iOS 27.0 simulator (`zami-perf`, iPhone 18 Pro, dev build) with the
`zami` sim's data copied in, baseline (`afeb5506`) and fixed tree on the same machine,
same data snapshot and same steps. Stalls are gaps of 50 ms or more in a 16 ms timer:

| Scenario | Before (count, longest, total) | After |
| --- | --- | --- |
| Launch → chats on screen | 6.9 s; startup stalls 4.0 s + 2.6 s | 4.1 s; 1.9 s + 1.1 s + 0.5 s |
| Idle after launch (35 s) | 196, 364 ms, 19.2 s (~50% stalled) | 3, 213 ms, 0.4 s |
| Open the drawer | 58, 558 ms, 4.3 s | 1, 253 ms |
| Scroll the room list (5 flings) | 91, 297 ms, 8.3 s | 3, 131 ms, 0.3 s |
| Switch room | 23, 1,846 ms, 4.3 s | 3, 447 ms, 0.7 s |
| Type 42 characters | 106, 529 ms, 7.4 s | 6, 216 ms, 0.6 s |
| Open the emoji picker | 28, 869 ms, 3.9 s | 4, 243 ms, 0.5 s |

"Up to date" moved from 13.3 s to 14.7 s: the saved-sync replay is now sliced so the screen
stays live, which makes it a little longer overall.

Fixed: A1–A15, B1–B7, C2, C3, C6, C7, C9, C10, D1–D5, E1, E2, F1, F3, F5, and the stall
recorder (Settings › Debug › Stalls). D4 was a real bug: every video send hung forever.

Partly fixed (what's left):
- **C1:** the database now loads in 8 ms slices, but the big crypto stores still live in
  memory (serving them from SQLite on demand means replacing fake-indexeddb's in-memory tree).
- **C4:** faster clone, BLOB columns, sound banks as files; commits are still synchronous
  SQLite transactions (async write-behind would break ordering the Rust store relies on).
- **C5:** long crypto calls are split where safe (to-device in batches of 8, key claims 50
  users per request, backup import 50 keys per step). Still single calls: sharing a new room
  key in a big room (~0.5 s at 2,000 members in Node), each keys-query response, full key
  export. The full fix (engine on a worklets runtime, ~3–5 weeks) is designed, not built.
- **C8:** inline requires for Zami's own code (not node_modules: core-js and other polyfills
  depend on evaluation order), heavy screens load on first open, emoji maps on first use.
  Default imports still evaluate at startup. `ZAMI_INLINE_REQUIRES=0` turns it off.
- **D6 MIDI:** sample decode and WAV encoding are sliced; the SoundFont parse is still one
  library call (~30–90 ms on a phone).
- **F2:** the room Emotes tab is one virtualized list; the account-level pack screens sit in
  the settings scroll view and mount rows in batches instead of virtualizing.
- **F4:** CallView tiles are split; RoomSettings re-renders at most twice a second instead of
  being split into memoized tabs.

`react-native-indexeddb-sqlite` 0.2.0 (the storage fixes) is published on npm and Zami uses
it from there; the fake-indexeddb hooks it needs stay in `patches/`.

## How to read this

- **Scale to design for:** 1,000–5,000 rooms (a Beeper bridge account), rooms with
  thousands of members, timelines with thousands of events, 100 MB media.
- **Priority:** P0 = a freeze of a second or more is likely or was measured. P1 = 100 ms
  to 1 s of jank. P2 = small or latent.
- **Evidence:** "Measured" = seen on the simulator (numbers below). "Read" = the full code
  path was read but not timed; costs are estimates. "Suspected" = part of the path is
  inferred, check it first.
- Paths are relative to the repo root. `client` = `src/lib/matrix/client.zami.ts`,
  `layout/` = `src/lib/components/layout/`, `messages/` = `src/lib/components/messages/`,
  `pkg/` = `packages/com/leonsilicon/zami/`. Line numbers are from `afeb5506`.
- Change only the Zami versions and Zami packages (see `.claude/CLAUDE.md`). Two fixes are
  in the user's own packages `react-native-indexeddb-sqlite` and
  `react-native-matrix-sdk-crypto-wasm`, which have their own repos.

## Why the app freezes (the four root mechanisms)

Most findings are instances of these. Fixing the mechanism fixes many findings at once.

1. **Global ticks fan out to everything.** Stores expose coarse counters (`roomsTick`,
   `unreadTick`, `timelineTick`, `reactionTick`, `presenceTick`, `voiceTick`). One bump
   re-runs every `useRune` selector that read it and re-renders every component whose
   selector returns an object. `useSyncExternalStore` renders are synchronous, so the
   whole pass is one block that React cannot slice.
2. **Per-item selectors do whole-account work.** A row's selector scans all rooms, a
   whole timeline, or the whole `m.direct` map. Multiply by mounted rows and by ticks.
3. **Microtask chains never yield.** On React Native (bridgeless) `setImmediate` is
   `queueMicrotask`, and fake-indexeddb schedules with `setImmediate`. Any chain of
   awaited IndexedDB or crypto calls runs to the end without a frame, a timer or a touch.
4. **Whole-payload work on the JS thread.** The Rust crypto (wasm2c over JSI), the
   IndexedDB stand-in (hydrate, `structuredClone`, `JSON.stringify`, synchronous SQLite),
   and media bytes (base64 in JS, several full copies, synchronous file writes) all run
   on the JS thread in single calls whose cost grows with account or file size.

## Measured on the simulator

Setup: iOS simulator `zami`, **dev build** (expect roughly 3× faster in release, but the
shape holds), account `@beep:localhost` with 1,003 encrypted rooms × 10 messages in one
space, classic sync. Stalls are gaps of 50 ms or more in a 16 ms `setInterval`.

| Scenario | Result |
| --- | --- |
| Launch, to chats on screen | 13.9 s. Stalls: 4.8 s in "Opening the encryption store" (3,020 records), 2.1 s in "Starting" (bundle evaluation), 0.7 s in "Loading storage, translations and fonts" |
| Launch, first tap | A tap on the "What's New" dialog about 4 s after it appeared was dropped |
| Idle after launch | Background decryption ran for about 2.5 minutes at about 86 events/s. During it the JS thread was stalled 20–40% of the time (stalls of 50–340 ms), with about 130 React commits and 50,000 component renders per 10 s. All 10 visible `MessageItem`s and all 172 mounted `ChannelRow`s re-rendered repeatedly, and `RoomList` re-rendered in 105–145 ms commits, with the drawer closed |
| Open the drawer | Stalls of 109, 157, 157, 642, 265 ms |
| Scroll the room list (5 flings) | Two stalls of about 50 ms: fine |
| Switch room | Stalls of 987, 180, 445, 120, 174 ms |
| Type 42 characters (with an `@` and a `:` query) | Stalls of 433, 377, 357, 361, 137, 111 ms |
| Open the emoji picker | Stalls of 597, 614, 597, 1,187 ms (some of this is the last keystroke) |

Not measured: Android, a real phone, sliding sync, large rooms (members, long timelines),
media, incoming message bursts, settings screens, calls. The findings for those are from
reading the code.

To repeat: `orb start` (Synapse is the `zami-synapse` container), `vpx _dev start`, launch
on the `zami` simulator, then inject the stall recorder through the Argent debugger:

```js
const s = (globalThis.__st = { label: "x", stalls: [], last: performance.now() });
setInterval(() => {
  const n = performance.now(), gap = n - s.last - 16;
  if (gap >= 50) s.stalls.push([s.label, Math.round(gap)]);
  s.last = n;
}, 16);
```

The launch timeline is in `localStorage["zami:startup"]` (Settings › Debug › Startup).

**Do first: keep a stall recorder running after startup.** `pkg/startup/startup.ts:49-65`
stops watching at "Up to date", so none of the periodic or interaction freezes below are
ever recorded on a real phone. A low-rate sampler that keeps the longest stalls with the
current screen and shows them in Debug would confirm each fix in the field.

## Suggested order

1. A1, A2, B1, B2: small, local, and they remove the measured idle storm and most of the
   per-message cost.
2. A3, A4, A5, B3: the unread and room-list fan-out (drawer open, room switch).
3. C1, C2, C3: launch and periodic persistence freezes.
4. C4, C5: crypto off the JS thread (larger project).
5. D1–D3: native media pipeline.
6. The rest by priority.

---

## A. Store bridge, room list and shell

### A1. `useRune` re-renders on every tick when the selector returns an object — P0, measured
- **Where:** `pkg/svelte-react/subscribe.svelte.ts:17-52`, `use-rune.ts:17-32`.
- **What happens:** only primitive results are compared. An object or array result always
  calls `onChange`, even when it is the same reference. Each `useRune` also owns its own
  `$effect.root`, so N rows calling the same expensive reader compute it N times. The
  selector runs twice on mount (snapshot, then subscribe).
- **Fix:** skip `onChange` when `Object.is` holds and the value is not a `$state` proxy;
  add an optional `isEqual` (shallow) for selectors that build objects; reuse the snapshot
  read to collect dependencies. Let off-screen subscribers (closed drawer, see A6) defer.
- **Check after:** idle commits and `MessageItem`/`ChannelRow` render counts drop to near
  zero while decryption runs.

### A2. Every decrypted event anywhere bumps `timelineTick` — P0, measured
- **Where:** `src/lib/matrix/crypto.zami.ts:530-542` (client-wide `Decrypted` listener).
- **What happens:** each decryption in any room calls `bumpTimelineTick()`. With A1 and B1
  that re-renders every mounted message row. At launch about 10,000 background
  decryptions (1,000 rooms) produce a 2.5-minute render storm.
- **Fix:** bump only for events in the open room (or a per-event revision, see B1), and
  coalesce to one bump per `setTimeout(0)` as `bumpUnreadTick` already does.

### A3. Unread state is recomputed from scratch per caller, per tick — P0, measured in the idle profile
- **Where:** `client:5267-5300` (`getRoomUnreadInfo`), `client:2657-2680`;
  `layout/SpaceSidebar.svelte.zami.tsx:105-189, 1459-1461, 1604-1606, 1692-1694`;
  `layout/RoomList.svelte.zami.tsx:218-261, 1079-1082`.
- **What happens:** for a room with no server count, `getRoomUnreadInfo` maps the whole
  live timeline into new objects before `hasUnreadMessages` (which walks backwards and
  exits early) runs. Callers: every mounted row, every space badge (which walks its whole
  subtree, twice), Home (`getOrphanRooms` + `getDirectRooms`, each a full room scan),
  folders, collapsed categories, the quick switcher. Badge `deps` include `roomsTick` or
  a fresh `item`, so stores are rebuilt each sync.
- **Cost:** about three passes over all rooms × timeline length per tick.
  `getSpaceNotifs → getRoomUnreadInfo` took about 1 s of a 13 s idle profile.
- **Fix:** one incremental `Map<roomId, {unread, highlight, loud}>` updated only for rooms
  whose timeline, receipt or notification changed, plus per-space rollups. Rows and badges
  read a primitive from it. Inside `getRoomUnreadInfo`, scan backwards without `.map`.

### A4. `refreshRooms` rebuilds everything after every sync and always bumps `roomsTick` — P1, read
- **Where:** `layout/AppShell.svelte.zami.tsx:1573-1580, 1736-1781, 2258`;
  `src/lib/stores/rooms.svelte.zami.ts:268-328`; `client:6014-6030, 2691-2738`.
- **What happens:** each `SYNCING` runs a classification pass over all rooms, five
  `sameOrder` comparisons through proxied arrays, `requestHierarchy`,
  `resolveLandingSurface` (sorts Home, DMs and space rooms even when the answer is
  "keep"), then `roomsTick++` unconditionally. That tick drives A3, A5, A7, A9 and many
  settings screens (F2, F6, F7).
- **Fix:** rebuild only when membership, tags, `m.direct`, space children or layout
  changed. Return "keep" before sorting. Split `roomsTick` into narrower ticks (list
  shape, names/avatars, power levels) and bump only what changed.

### A5. `RoomList` re-derives and re-renders the whole list per tick — P1, measured (105–145 ms commits at idle)
- **Where:** `layout/RoomList.svelte.zami.tsx:1678-1706, 2082-2276, 1312-1329, 190-215`,
  FlatList at `:2737-2745`, `renderItem` at `:2343-2442`.
- **What happens:** regroups and sorts rooms, rebuilds every row object, and `reuseRows`
  runs `Object.keys`/`Object.entries` per row. No `windowSize` is set, so the default of
  21 keeps hundreds of rows mounted (172 seen on a short screen), each with two rune
  effects. `renderItem` depends on knock/join state, so typing a knock reason re-renders
  every cell. `keyExtractor` is inline; there is no `getItemLayout`.
- **Fix:** narrower ticks (A4); `windowSize` 5–7; move knock/join state into a small store
  read only by the row that needs it; hoist `keyExtractor`; rows are fixed height, so add
  `getItemLayout`.

### A6. The closed drawer keeps doing all of this — P1, measured
- **Where:** `layout/AppShell.svelte.zami.tsx:3016-3077` (drawer stays mounted, moved off
  screen).
- **What happens:** `SpaceSidebar` and `RoomList` stay subscribed while a chat is open, so
  A3, A5, A7 and A9 run on every tick with nothing visible. Opening the drawer then stalls
  up to 642 ms.
- **Fix:** pause subscriptions while closed (a "paused" context that `useRune` honours, or
  `<Activity mode="hidden">`), and recompute once on open.

### A7. Switching rooms re-runs every mounted row's full selector — P1, measured (987 ms stall)
- **Where:** `layout/RoomList.svelte.zami.tsx:247-261, 765-775, 1079-1082, 1123-1136`.
- **What happens:** the "is active" flag is computed in the same selector as unread, name,
  avatar and preview, so one tap re-runs all of it for every mounted row, in the same
  synchronous flush that mounts the new timeline. The same switch also triggers member
  loading (C7) and `checkRoomIdentities` (C6).
- **Fix:** a separate primitive selector for `isActive`, so only two rows change.

### A8. `AppShell` re-renders its whole subtree on any modal, drawer or sync-state change — P1, read
- **Where:** `layout/AppShell.svelte.zami.tsx:400-421` (23 `useRune`s), `:597-616,
  2924-2940, 3052-3131`.
- **What happens:** `RoomList`, `SpaceSidebar`, `ProfileFooter` and `MessageArea` are not
  memoized and get inline closures. One drawer drag renders up to three times, and
  `useAnimatedReaction` calls into JS every frame of the drag.
- **Fix:** split into memoized drawer, main pane and overlays with stable callbacks; send
  the two drawer booleans to JS only when they flip.

### A9. DM rows scan the whole `m.direct` map per row, per tick — P0 on a bridge account, read
- **Where:** `layout/RoomList.svelte.zami.tsx:157-168, 1122-1138`; `client:10552-10564`
  (`getDMPartnerId`); `src/lib/stores/presence.svelte.zami.ts:176-178`.
- **What happens:** `getDMPartnerId` runs `Object.entries(m.direct)` with `.includes` per
  entry. Each mounted DM row calls it on `unreadTick`, `roomsTick`, `presenceTick`, the
  notifications tick and `activeRoomId`. Presence bumps are not coalesced (three SDK
  events per user).
- **Fix:** a reverse `roomId → userId` map rebuilt once per `m.direct` event; coalesce
  `presenceTick`; split presence and preview from unread in the row selector.

### A10. Space lookups are rebuilt per call and called in loops — P1, read
- **Where:** `client:2521-2523, 2532-2597, 2604-2680, 8227-8267`.
- **What happens:** `getRooms()` is `Object.values(rooms)` (allocates all rooms).
  `getSpaces()` filters it twice. `getSpaceChildIds` joins all child event ids into a
  signature string before checking its cache. `getParentSpaceIds` calls `getSpaces()` at
  every recursion level. Callers include every badge, the emoji picker and send-time
  emoji resolution.
- **Fix:** invalidate from a `RoomStateEvent.Events` listener for `m.space.child` instead
  of a per-call signature; keep `getSpaces()` and a `child → parents` index cached until
  membership or child state changes.

### A11. Large arrays live in deep `$state` proxies — P1, read
- **Where:** `src/lib/stores/rooms.svelte.zami.ts:90-139` (five room buckets,
  `spaceHierarchy`); `src/lib/stores/messages.svelte.zami.ts:16-80`;
  `src/lib/stores/notifications.svelte.zami.ts:38-52`.
- **What happens:** every index read is a Proxy trap (slow on Hermes) and registers a
  dependency. `appendMessage` does `.some(...)` and a spread through the proxy per
  message and creates a new proxied array, rebuilding all sources.
  `isRenderableTimelineEvent` (`client:2924`) reads the `settingsState` proxy once per
  event.
- **Fix:** `$state.raw` for these (they are replaced wholesale already); a `Set` for
  duplicate checks; hoist settings reads out of loops.

### A12. Any read receipt triggers two passes over all rooms — P1, read
- **Where:** `layout/AppShell.svelte.zami.tsx:2410-2456`; `client:3949-3979`.
- **What happens:** coalesced per turn, but each batch still runs `clearReadThreadCounts`
  (`room.getThreads()`) and `clearReadNotifications` for every room, then bumps
  `unreadTick`. On a bridge account other people's receipts arrive in nearly every sync.
- **Fix:** process only the rooms named by the receipt events, and only for your own
  receipts.

### A13. Quick switcher is O(rooms²) on open — P0 where reachable (hardware keyboard), read
- **Where:** `layout/QuickSwitcher.svelte.zami.tsx:59-104, 193-255`; `client:2604-2635`.
- **What happens:** `findSpaceForRoom` per room, each calling `getSpaces()` and
  `getSpaceChildIds(...).includes` per space, plus `getRoomUnreadInfo` per room. Typing
  scores and sorts every entry per keystroke.
- **Fix:** one `child → space` map per open; unread from A3's cache; defer the query.

### A14. Space landing panel renders every room without virtualization — P0 for a 1,000-room space, read
- **Where:** `layout/SpaceLandingPanel.svelte.zami.tsx:47-66, 124-265`.
- **What happens:** `joinedRooms.map` and `joinable.map` inside a `ScrollView`, rebuilt on
  every `roomsTick`, iterating the proxied hierarchy in a tracked effect.
- **Fix:** one `FlatList` with memoized rows; stable array identity; raw hierarchy.

### A15. Smaller shell items — P1/P2, read
- **`MemberList`** (`layout/MemberList.svelte.zami.tsx:70-128, 223-294`): re-sorts all
  members with four collator sorts and re-renders every cell on each `roomsTick` and
  presence event. Re-derive only on this room's member events; memoize rows.
- **`CallRoster` per row** (`layout/RoomList.svelte.zami.tsx:620-653`;
  `client:10627-10712`): every row subscribes to `voiceTick` and asks for the room's RTC
  session (may create one per room; suspected). Publish one `Set` of rooms with calls.
- **"Add existing room to space"** (`layout/SpaceSidebar.svelte.zami.tsx:942-947, 1389,
  2215-2243`): all orphan and DM rooms in a `ScrollView`.
- **JS-driven gestures** (`AppShell:474-492`, `SpaceSidebar:329-337, 409-436`,
  `RoomList:515-531`): per-frame `setState`; use shared values and commit on release.
- **Space rail** (`SpaceSidebar:453-495, 1400-1410`) and the room context menu
  (`RoomList:2455-2468`) recompute per sync.

---

## B. Timeline and composer

### B1. A timeline or reaction tick re-renders every mounted `MessageItem` — P0, measured
- **Where:** `messages/MessageItem.svelte.zami.tsx:792, 912-919, 2000-2006, 2065-2075`.
- **What happens:** `content` returns `event.getContent()` (an object) and reads
  `timelineTick` and `reactionTick`; `threadSummary` reads `roomsTick`. With A1 every bump
  re-renders every mounted row (60–130 with `windowSize={11}`) despite `memo`. Each row
  has 38 `useRune`s.
- **Fix:** A1 first. Then a per-event revision (`WeakMap<MatrixEvent, signal>` bumped on
  that event's decrypt, edit, redaction or echo) instead of global ticks; `Reactions`
  subscribes per target event.

### B2. Each decrypted event in the open room re-reads the whole timeline — P0, read
- **Where:** `layout/MessageArea.svelte.zami.tsx:1735-1752`; `client:3050-3112`.
- **What happens:** `onEventDecrypted` calls `setMessages(roomId,
  getTimelineMessages(room))` per event: about eight O(timeline) passes, which also
  starts unqueued decryption of the whole chain (`decryptForDisplay`). A page of 50–100
  encrypted events in a long room is one unbroken chain. This is the same shape as the
  earlier "Restoring session" freeze.
- **Fix:** mark the room dirty and re-read once per macrotask; skip non-renderable events;
  decrypt only the rendered window unqueued and send the rest through the sliced queue.

### B3. Every timeline change redoes O(N) work and re-invokes `renderItem` for all cells — P1, read
- **Where:** `layout/MessageArea.svelte.zami.tsx:1163, 1175-1186, 1305-1340, 2314-2379,
  3489-3503`; `client:10744`.
- **What happens:** reverse of the list, `highlightedIds`, receipts and `getCallSummaries`
  (on `timelineTick`, `roomsTick` and `voiceTick`, including other rooms' decryptions)
  all recompute. `renderItem` depends on all of them. Image rows opt out of the row memo
  (`sameRowProps`), so they fully re-render on every list change.
- **Fix:** maintain these incrementally; pass `messages`/`index` by ref; precompute
  separator flags; remove the image exemption by reading the list at press time.

### B4. Each read receipt recomputes receipts for the whole live timeline — P1, read
- **Where:** `layout/MessageArea.svelte.zami.tsx:1175-1186, 1806-1813`; `client:6412-6493`.
- **Fix:** coalesce receipt events (about 250 ms); update only affected users; limit to the
  mounted range; resolve names and avatars in the row.

### B5. Typing is slow — P1, measured (stalls of 110–430 ms while typing)
- **Where:** `messages/MessageInput.svelte.zami.tsx:723-736, 1111-1142, 2289-2367,
  2877-2932`; `src/lib/utils/emojiAutocomplete.zami.ts:39-84`; `client:5171`.
- **What happens:** each keystroke sets `text` on the 3.2k-line component, re-tokenises
  the whole draft, and rebuilds the nested `<Text>` runs. An open `@query` filters all
  members per key (`toLowerCase` per member); each unresolved `@token` does another
  member scan. An open `:query` scans all emoji with three `.find`s each and sorts. The
  measured stalls were in a room with two members, so the base cost is the problem.
- **Fix:** move the `TextInput` and decoration into a small memoized child; keep
  autocomplete state out of the main component; prebuilt lowercased member and shortcode
  indexes; defer the query (`useDeferredValue`).

### B6. `MessageItem` mount cost — P1, suspected
- **Where:** `messages/MessageItem.svelte.zami.tsx` (38 `useRune`, each an `$effect.root`),
  FlatList props at `layout/MessageArea.svelte.zami.tsx:2931-2933`.
- **What happens:** a 10-row batch is one synchronous render that creates 380 effect
  roots. Likely part of the 987 ms room-switch stall. Profile before changing.
- **Fix:** merge a row's tick-bound reads into one or two stores returning a compared
  tuple; split rarely used parts into children; lower `maxToRenderPerBatch`.

### B7. Smaller timeline items — P2, read
- **Scroll handler** (`MessageArea:1903-1957, 2190-2206`): `findIndex` through the proxied
  list on every scroll event. Keep a key → index map.
- **`tick()` then scroll** (`MessageArea:3725-3742`): a `setState` on the 3.7k-line
  component per message just to scroll to bottom.
- **Typing events** (`client` ~`:6505-6520`): `room.getMembers().filter` per typing change.
- **`ThreadPanel`** (`layout/ThreadPanel.svelte.zami.tsx:133-139, 430-437`): same row
  problems at smaller N.
- **Plugin hooks** (`src/lib/plugins/pluginBoot.zami.ts:401-446`;
  `MessageItem:1144-1196, 4358`): four rune stores per row and a content clone per
  timeline event even with no plugin subscribed. Return early when there are none.
- **About a dozen client-level Timeline listeners** (`client:1653, 3352, 3832, 5349, 5391,
  5428, 9896, 10052, 10349`) each re-read content for every event, including replay. Use
  one dispatcher that classifies once.

---

## C. Persistence, crypto and startup

### C1. The IndexedDB stand-in loads a whole database synchronously on open — P0, measured (4.8 s stall)
- **Where:** `node_modules/react-native-indexeddb-sqlite/src/index.ts:223-226, 265-299,
  302-351`; opened from `apps/zami/storage.ts:10-12`.
- **What happens:** `hydrate` runs `getAllSync()` per store, then `JSON.parse` per row, in
  one task. 3,020 crypto records took 794 ms inside a 4.8 s stall on the simulator; a
  5,000-room account has one record per Megolm session. Indexes build synchronously on
  first read.
- **Fix:** hydrate in chunks with macrotask yields; better, serve the big stores
  (`inbound_group_sessions`, Olm sessions) from SQLite on demand instead of mirroring
  them in memory. Longer term see C5.

### C2. fake-indexeddb runs on the microtask queue — P0, read (root mechanism 3)
- **Where:** `node_modules/fake-indexeddb/build/esm/lib/scheduling.js` (`queueTask` uses
  `setImmediate`); `node_modules/react-native/Libraries/Core/setUpTimers.js:38-45`.
- **What happens:** every request callback and commit is a microtask, so chains of awaited
  IndexedDB work (saved-sync replay, `/keys/query` processing, backup restore, key
  import) never return to the event loop. The sliced decrypt queue only covers work
  routed through it.
- **Fix:** give fake-indexeddb a macrotask scheduler that drains a batch per turn with a
  budget of about 8 ms (patch `queueTask` or define `scheduler.postTask`). A plain
  `setTimeout` per request would be too slow.

### C3. Whole-account records are rewritten on timers — P0, read
- **SDK sync store, every 5 minutes (classic sync):** `client:661-668, 721`;
  `node_modules/matrix-js-sdk/lib/sync.js:777-779`,
  `store/indexeddb-local-backend.js:353-420`. There is no worker on native, so
  `getJSON(true)` plus a put of one `{nextBatch, roomsData}` record (cloned, walked,
  stringified, written synchronously) all run on the JS thread. At launch the same record
  is parsed, cloned and deep-copied, and the replay awaits per room without yielding.
- **Room-list snapshot, every 2 minutes and on every backgrounding:** `client:1553,
  1729-1733, 2414-2449`; `src/lib/matrix/roomListCache.zami.ts:96-163, 381-410`. About
  five synchronous passes over a snapshot the code's own comment sizes at tens of MB.
  The deferred "rest" record (`client:2348-2390`) is also read as one record.
- **History trim, every 2 minutes:** `src/lib/historyTrim.zami.ts:36-66`;
  `src/lib/utils/historyTrim.zami.ts:37-45`; `client:3121-3152`. Visits every
  never-opened room and filters its chain; the loop never really awaits.
- **Fix:** one record per room, written only when dirty, in slices via
  `createSlicedQueue`; emit plain JSON directly (no stringify/parse round trip); for the
  SDK store, wrap or subclass `IndexedDBStore` and feed saved-sync replay in chunks of
  about 50 rooms with a macrotask between. For the trim, skip short timelines first and
  yield.

### C4. `structuredClone` is a JS polyfill on every IndexedDB read and write — P1, read
- **Where:** `node_modules/expo/src/winter/runtime.native.ts` (@ungap);
  `src/lib/polyfills.zami.ts` (core-js, which may win; not checked);
  `node_modules/react-native-indexeddb-sqlite/src/encoding.ts:15-28`.
- **What happens:** every get, cursor step and put deep-clones in JS. @ungap spreads typed
  arrays into number arrays; binary values are stored as base64 built by string
  concatenation. Custom sound banks (`src/lib/utils/customSoundBank.zami.ts:108`) and
  fonts go through this: tens of MB would freeze for seconds or run out of memory.
- **Fix:** a fast-path clone in the stand-in (JSON round trip for plain JSON, `slice()`
  for buffers); BLOB columns for binary; store big binaries as files with a path in
  IndexedDB. Each read-write commit is also a synchronous SQLite transaction
  (`index.ts:363-420`); move writes to the async API with write-behind.

### C5. The Rust crypto runs on the JS thread — P0, measured in part
- **Where:** `node_modules/react-native-matrix-sdk-crypto-wasm` (`index.js`, `loader.js`,
  `cpp/Wasm2cBridge.h`, bounds-checked wasm2c); init at
  `src/lib/matrix/crypto.zami.ts:458`.
- **What happens:** every call blocks the JS thread. Measured: background decryption
  alone kept the thread busy for 2.5 minutes after launch (with A1/A2 multiplying it).
  Long single calls (read, not timed): `shareRoomKey` for a large room,
  `markRequestAsSent` for a `/keys/query` response, `receiveSyncChanges` with a to-device
  backlog, `exportRoomKeys`, `importBackedUpRoomKeys` (200 keys per call). With C2
  nothing yields between them.
- **Fix:** host the OlmMachine and its store on a second runtime or thread with an async
  RPC surface (a worklets runtime owning the wasm2c instance), or move to native
  matrix-sdk-crypto with a SQLite store. Interim: route key sharing, keys-query
  processing and backup chunks through the sliced queue in smaller chunks.

### C6. Crypto paths that bypass the sliced queue — P1, read
- **Retries:** `src/lib/matrix/keyBackfill.zami.ts` `retryFailed()`/`receive()` and
  `src/lib/matrix/crypto.zami.ts:238-247` call `event.attemptDecryption` directly for all
  rooms × all events, 5 s and 2 min after verification.
- **Key requests:** `keyBackfill.zami.ts` `answer()` runs `machine.exportRoomKeys(predicate)`
  over every session before the cheap refusals and the rate limit. A known device can
  trigger it repeatedly.
- **Room open:** `src/lib/matrix/crypto.zami.ts:670-681` (`checkRoomIdentities`) fires up
  to 200 `getUserVerificationStatus` calls at once on every switch into an encrypted
  room (`AppShell:1556`).
- **Session list:** `src/lib/components/settings/SessionSettings.svelte.zami.tsx:241-309`
  queries trust for every device on every tick.
- **First send in a large room** (suspected): no `prepareToEncrypt` call exists under
  `src/lib`, so key sharing happens inside `sendMessage`.
- **Fix:** export the queue from `sliceDecryption` and use it for all of these, newest
  first, cancellable on room switch; run refusal checks first; cache trust per user until
  `UserTrustStatusChanged`; call `prepareToEncrypt` on room open or first keystroke.

### C7. Opening a large room refetches and rewrites its whole member list — P1, read
- **Where:** `client:5178-5207`; callers `MessageArea:452`, `MessageInput:718`;
  `node_modules/matrix-js-sdk/lib/models/room.js:854-933`.
- **What happens:** clears stored members, fetches `/members`, builds an event per member,
  applies them synchronously, then writes N puts. Those rows are in the sync database,
  which C1 loads whole at every later launch.
- **Fix:** don't load members on open above a few hundred; load on demand for the member
  list and mention search; don't persist out-of-band members (or use a separate lazily
  opened database); slice the application.

### C8. The whole app is evaluated at startup — P1, measured (2.1 s stall in "Starting", dev build)
- **Where:** `apps/zami/metro.config.cjs` (`inlineRequires` is not enabled); `apps/zami/
  index.ts`, `polyfills.ts`, `root.tsx:16-20`; `src/lib/data/emojiShortcodes.zami.ts:30-52`;
  `src/lib/data/emojis.zami.ts:33-47`; `src/lib/stores/settings.svelte.zami.ts`.
- **What happens:** all module bodies run before first render: matrix-js-sdk, the wasm
  glue, livekit-client, linkedom, jsqr, six @formatjs polyfills with locale data,
  core-js, emoji JSON tables. The settings store does 80–150 synchronous `localStorage`
  reads at import.
- **Fix:** `inlineRequires: true` in `pkg/metro` (keep polyfills non-inlined); lazy-load
  settings, calls, Flash, MIDI and QR screens; build emoji maps on first use. Measure on
  a release build first.

### C9. `localStorage` is a synchronous SQLite call each time, with no cache — P1, read
- **Where:** `apps/zami/polyfills.ts:5`; `node_modules/expo-sqlite/src/Storage.ts:144-170`.
- **Hot or large writers:**
  - `src/lib/stores/notifications.svelte.zami.ts:35-37, 51-61`: `JSON.stringify` of the
    whole proxied notification map plus a blocking write **per notifying event**
    (`AppShell:1299`). A catch-up sync with K notifications costs O(K × total). This one
    is P0 on a busy account.
  - `AppShell:1291`: a read of `notifSoundEnabled` per loud event.
  - Sliders (`pkg/rn/range.tsx:104-115`; `VoiceAudioSettings.svelte.zami.tsx:702-713`;
    `settings.svelte.zami.ts:1271-1277, 1440-1456`): a write per step.
  - `src/lib/utils/gifAspect.svelte.zami.ts:39-48`; `keyBackfill.zami.ts:99-100`;
    `pkg/startup/startup.ts:87-96`.
- **Fix:** an in-memory write-through `Map` loaded once at install, with debounced
  asynchronous flushes (flush on background). Keep the notification map outside `$state`
  and debounce its persist.

### C10. Plugins compile on the JS thread at startup — P1, read
- **Where:** `src/lib/plugins/pluginBoot.zami.ts:250-262, 484-553` (from `AppShell:2612`);
  `pkg/rn/es-module.ts:283-317`.
- **What happens:** per enabled plugin: full acorn parse, AST rewrite, `new Function`,
  `onload`, with no cache between launches, during session restore. Plugins also run
  unsandboxed on the main JS thread.
- **Fix:** cache the rewritten body by hash; defer until after first paint with a yield
  between plugins.

---

## D. Media and files

### D1. Encrypted downloads pass through JS as base64 and are written synchronously — P0, read
- **Where:** `src/lib/matrix/media.zami.ts:466-473, 512-547`;
  `src/lib/utils/downloadProgress.zami.ts:59-65`;
  `src/lib/utils/decryptAttachment.zami.ts:66-110`; `pkg/blob/patch.ts:130-138`;
  `pkg/blob/object-urls.ts:19-23, 58-66` (`file.writeSync`);
  `node_modules/react-native/Libraries/Blob/FileReader.js:128-139`.
- **What happens:** no streaming fetch, so `arrayBuffer()` is native `readAsDataURL` plus a
  JS base64 decode, then about seven whole-buffer copies, then a synchronous file write
  in `URL.createObjectURL`. Image rows download the full original, not `thumbnail_file`
  (`MessageItem:1568-1700`), and repeat it after scrolling away (`:1653-1672`).
- **Cost (estimate):** 100–300 ms per few-MB image on iOS; seconds and possible
  out-of-memory for video.
- **Fix:** one native "download → verify SHA-256 → AES-CTR decrypt → cache file" call that
  returns a `file://` URI, keyed by mxc on disk; prefer `info.thumbnail_file`; limit
  concurrency. Stopgap: asynchronous write for payloads over about 1 MB.

### D2. Uploads copy the whole file many times, then base64 it in JS — P0, read
- **Where:** `pkg/rn/picked-file.ts:19-28`; `pkg/blob/memory.ts:108-124, 192-194`;
  `pkg/blob/patch.ts:213-225`; `pkg/webcrypto/bytes.ts:14-20`;
  `src/lib/utils/stripMetadata.zami.ts:738-775`; `src/lib/utils/mp4Faststart.zami.ts:207-216`;
  `src/lib/matrix/media.zami.ts:156-193, 266-277`;
  `node_modules/react-native/Libraries/Network/convertRequestBody.js:38-41`.
- **What happens:** for a 100 MB video about 8–10 full copies and a JS base64 encode to a
  133 MB string, with peak memory near 1 GB (jetsam risk). Unencrypted rooms still pay
  the read, the faststart copy and the base64.
- **Fix:** keep picked files as URI-backed; strip, faststart, encrypt and hash file to file
  natively; upload from the file with a native upload task and progress events.

### D3. Android has no native crypto module — P0 on Android, read
- **Where:** `pkg/webcrypto/expo-module.config.json` (`"platforms": ["apple"]`);
  `pkg/webcrypto/subtle.ts:89, 124-150, 181-189, 316`; `native.ts:1-3`.
- **What happens:** SHA-256, HMAC and AES-CTR run in @noble in single synchronous calls
  (the package README: "a megabyte takes most of a second"). AES-GCM is JS on both
  platforms, used for P2P transfers in 1 MiB blocks
  (`src/lib/utils/fileTransfer.zami.ts:30, 189, 212`).
- **Fix:** a Kotlin module with the same functions, and `aesGcm` in both native modules.

### D4. Video send writes the whole video synchronously, and may never finish — P0, suspected
- **Where:** `src/lib/matrix/media.zami.ts:40-84` (`captureVideoThumbnail`, called at
  `:325`); `pkg/browser/document.ts:155-157`; `pkg/browser/dom.ts`.
- **What happens:** `URL.createObjectURL(file)` writes the full video again although it is
  already at `file.uri`. It then sets `video.src` on a detached linkedom `<video>`;
  nothing was found that fires `onloadedmetadata`/`onseeked`/`onerror`, so the promise may
  never settle. **Check first whether video sends complete.**
- **Fix:** native thumbnail from `file.uri` (expo-video) with a timeout that resolves
  `null`.

### D5. Key export and import handle the whole file in single steps — P0 for a large account, read
- **Where:** `src/lib/matrix/crypto.zami.ts:2922-2951`;
  `src/lib/utils/keyExportFile.zami.ts:81-181`;
  `src/lib/components/settings/KeyExportSettings.svelte.zami.tsx:47, 101`.
- **What happens:** one wasm call for all sessions, `JSON.parse` of the whole export only
  to count it, then base64 by string concatenation, a 76-character line loop, and
  per-byte loops on import.
- **Fix:** count without parsing; native base64; chunk and yield between stages; stream to
  a file.

### D6. CPU-heavy features that run in JS — P1, read
- **Local encrypted search** (`src/lib/matrix/eventIndex.zami.ts:507-552`;
  `src/lib/utils/eventIndex.zami.ts:134-197`): parses all blocks and normalizes every
  body in one task, twice. Store pre-normalized bodies; search block by block with
  yields and a result cap. The crawler (`crawlCandidates`, `crawlStep`) reads state for
  thousands of rooms one transaction at a time.
- **QR scanner** (`src/lib/components/ui/QrScanner.svelte.zami.tsx:31-37, 118-169`;
  `pkg/camera/image-data.ts`): jpeg-js decode plus jsQR per frame, blocking about half
  the time by its own comment. Use native barcode scanning.
- **MIDI** (`src/lib/utils/midiSoundBank.zami.ts:124-190`;
  `src/lib/workers/midiRender.worker.zami.ts:64-122`): the synth loop yields, but bank
  parsing, Opus sample decode and WAV encoding do not.
- **Web Workers** are replaced by a throw (`pkg/metro/vite-babel-plugin.js:9-11`), so
  worker features fail rather than freeze. Anything moved in-thread later must be sliced.

---

## E. Pickers

### E1. Emoji picker open — P1, measured (stalls of about 600 ms; up to 1.2 s)
- **Where:** `src/lib/components/ui/EmojiPicker.svelte.zami.tsx:162-170, 227-261, 421-507`;
  `client:8996-9026, 8227-8267`.
- **What happens:** the grid is virtualized, but `customPacks` reads `roomsTick` and
  returns a fresh array, so each sync rebuilds every pack, `flatItems` (a spread per
  emoji), section offsets and rows. `getParentSpaceIds` rescans spaces (A10). `renderRow`
  depends on `activeIndex`, so a cursor move re-renders all rows. Search lowercases every
  entry per keystroke. The open cost itself was not profiled: do that first.
- **Fix:** memoize packs on pack event ids; pre-lowercase; isolate `activeIndex`.

### E2. Picker scroll handlers — P2, read
- **Where:** `src/lib/components/ui/StickerPicker.svelte.zami.tsx:219-230` (EmojiPicker is
  similar).
- **Fix:** a precomputed header-offset array with binary search; set state only on change.

---

## F. Settings and dialogs

### F1. Room settings › Members re-sorts every member per sync and per keystroke — P0 for large rooms, read
- **Where:** `layout/RoomSettings.svelte.zami.tsx:360, 1120-1157, 2017-2025`;
  `client:5171, 9163-9183, 9462-9469`.
- **What happens:** three member filters plus a sort whose comparator does about ten state
  lookups and a `localeCompare`. `extraData` is a new object each render.
- **Fix:** precompute rank and sort keys once; key the memo on member/power-level changes;
  sort once and only filter on search; debounce; stable `extraData`.

### F2. Image pack editors render every image at once — P0 for large packs, read
- **Where:** `layout/ImagePackEditor.svelte.zami.tsx:144-165, 601, 789`;
  `src/lib/components/settings/CustomPackSettings.svelte.zami.tsx:279`;
  `SharedPackSettings.svelte.zami.tsx:26-35, 275, 332`.
- **What happens:** `.map` over all images (about 15 views each, each starting a request).
  `SharedPackSettings` also rescans every joined room per sync.
- **Fix:** one sectioned `FlatList` with memoized rows; cache packs per room by state
  event id.

### F3. Theme changes notify Uniwind once per variable — P1, read
- **Where:** `src/lib/utils/theme.zami.ts:66-74`; `pkg/browser/document.ts:49-71`;
  `src/lib/components/settings/ThemeColorEditor.svelte.zami.tsx:115-131`;
  `src/lib/stores/settings.svelte.zami.ts:1498-1530`.
- **What happens:** up to about 80 `updateCSSVariables` calls, each re-rendering every
  styled component, applied twice in the editor, with a persist and account-data sync
  per hex keystroke.
- **Fix:** diff and make one call with all changed variables; drop the duplicate apply;
  debounce persist and sync.

### F4. `RoomSettings` and `CallView` re-render in full per tick — P1/P2, read
- **Where:** `layout/RoomSettings.svelte.zami.tsx:360-366`;
  `layout/CallView.svelte.zami.tsx:221-223, 285-288`.
- **Fix:** split tabs and tiles into memoized children that subscribe to primitives.

### F5. Other lists and recomputations — P2, read
- Sessions (`SessionSettings.svelte.zami.tsx:734`) and plugins
  (`PluginsSettings.svelte.zami.tsx:712, 1001-1022, 1124`) are `.map` lists.
- `UserProfileCard` (`src/lib/components/ui/UserProfileCard.svelte.zami.tsx:134, 193-201`)
  recomputes mutual rooms over all rooms per sync.
- Message search "from:" suggestions
  (`layout/MessageSearchPanel.svelte.zami.tsx:288-321`) re-map all members per sync.
- `matchMedia` leaks a `Dimensions` listener per call (`pkg/browser/window.ts:60-80`).

---

## Checked and found fine

- The message timeline and the room list are virtualized `FlatList`s with stable keys;
  room-list scrolling measured clean.
- Emoji, sticker and GIF grids are virtualized with `getItemLayout`.
- Drawer, Lightbox and bottom-sheet gestures run on the UI thread (Reanimated).
- Avatars and unencrypted images load natively through expo-image.
- iOS WebCrypto (digest, HMAC, AES-CTR, PBKDF2) is native and asynchronous.
- HTML bodies are parsed once per string with LRU caches; syntax highlighting is not
  ported.
- Drafts are in memory; typing notifications are throttled; link previews are cached.
- Locales load lazily except `en`. Settings are persisted per key.
- Push, notification and AppState handlers are light; the only heavy background work is
  the snapshot save (C3).
- The navigation shim and `apps/zami/root.tsx` do no heavy work.

## Limits of this audit

- All timings are from a dev build on a simulator with one synthetic account. Re-measure
  on a release build and on the iPhone 13 mini before and after each fix.
- "Read" findings were not timed, and their costs are estimates.
- Not exercised at runtime: Android, sliding sync, large-member rooms, long timelines,
  media, calls, settings, incoming message bursts.
- D4 (video send may hang) and the first-send key sharing in C6 are inferred from code.
