# @-/com.leonsilicon.zami.incremental

Doing work only when its inputs change.

Zam's stores expose coarse ticks (`roomsTick` bumps on every sync), and a reader that
depends on one runs again each time. On a large account that means rebuilding emoji
packs, re-sorting thousands of members or rescanning every room once a second, on the
JS thread, while the user is typing. These helpers let a reader keep running on the
tick but redo its real work only when what it reads changed.

```ts
import {
  createKeyedMemo,
  clientRevision,
  roomStateRevision,
} from "@-/com.leonsilicon.zami.incremental";

const packsMemo = createKeyedMemo<Pack[]>();
const PACK_STATE = { stateTypes: ["m.room.image_pack"], rooms: true };
// Rebuilt only when a pack event, a room's name or the set of rooms changed.
const packs = packsMemo([client, clientRevision(client, PACK_STATE), roomId], buildPacks);
```

- `createKeyedMemo()`: one remembered result, recomputed when a key differs
  (`Object.is`). The same object comes back otherwise, so `useRune(…, { isEqual:
  sameObject })` doesn't re-render.
- `roomStateRevision(room)`: a counter that grows on every state change of the room
  (members, power levels, …). `clientRevision(client, watch)`: one that grows when a
  state event of the watched types changes in any room, or watched account data, or
  (with `rooms`) the set of rooms. `membershipRevision(client, userId)`: one that grows
  when that user's membership changes anywhere, or ours. Listeners attach on first read.
- `updateSorted(previous, next, { id, sameSortKey, compare })`: `next` sorted, reusing
  the previous order for unchanged items and inserting the changed ones by binary
  search, so a sync that changes a few of 5,000 members costs a few comparisons.
- `debounce(fn, ms)`: one call per burst, with `flush()` and `cancel()`.
- `createSelection()`: one selected key, with subscriptions per key.
- `lastIndexAtOrBefore(offsets, y)`: binary search for the section a scroll offset is in.

`@-/com.leonsilicon.zami.incremental/react` has the React side: `useSelection` and
`useSelected(selection, key)` (a cursor move re-renders two cells),
`useDebouncedValue`, `useStableCallback` (a callback for memoized rows that calls the
latest closure), `useProgressiveCount` (mount a long list a slice per turn of the
event loop when it can't be virtualized), and `useThrottledRune(read, ms)` (a rune read
for a primitive, such as a tick, that re-renders at most once per `ms`: at once after a
quiet spell, then once at the end of a burst).

The revision counters are also reactive: read inside a Svelte effect (a `useRune`
getter), they subscribe it, so it runs again when they grow, with no tick needed.

```sh
vp run test   # from the repository root
```
