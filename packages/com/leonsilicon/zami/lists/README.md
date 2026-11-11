# @-/com.leonsilicon.zami.lists

Keeps long lists cheap to update, for the app's `FlatList`s of rooms and members.

**Rows that keep their objects.** A list rebuilt from live state (on every sync) makes new
row objects each time, and a new row is a re-rendered cell even when nothing in it changed.
`createRowCache` hands back the previous build's row of the same key when its fields are the
same (one level deep, `Object.is`), and the previous array when every row is, so a rebuild
that changes nothing re-renders nothing.

```ts
const cache = createRowCache<Row>();
const rows = cache.build((row) => rooms.map((room) => row({ key: room.roomId, room })));
```

**A sorted index.** `createSortedIndex` keeps entries in order of a string sort key: one
change (a member joins, leaves or is renamed) costs a binary search, O(log n) comparisons,
instead of a re-sort. `replace` rebuilds it with `sortInSlices`, a stable merge sort that
runs a few milliseconds per turn of the event loop: on Hermes each `Intl.Collator`
comparison is a native call, and sorting a large room's members in one go froze the app.
Changes made while it sorts apply to the old entries at once and to the new ones when they
land.

```ts
const index = createSortedIndex<RoomMember>({ compare: collator.compare });
await index.replace(members.map((m) => ({ id: m.userId, sortKey: m.name, value: m })));
index.set(member.userId, member.name, member);
```
