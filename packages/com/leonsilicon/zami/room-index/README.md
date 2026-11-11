# @-/com.leonsilicon.zami.room-index

Incremental indexes over a Matrix account's rooms, for an account with thousands of them (a
bridge account). Zam derives the room list's unread dots and the spaces a room sits in from
scratch on every read, and reads happen on every sync, for every row and badge on screen.
These keep the answers and change them only when the rooms they came from change.

- `hasUnreadEvents(events, readUpToId, receiptTs, reader)`: Zam's `hasUnreadMessages`,
  reading the timeline backwards from the newest event, as far as the answer needs, without
  copying it first.
- `createRoomMemo({ idOf, fingerprint, compute })`: a value per room, kept until
  `invalidate(roomId)` or until one of the cheap reads in its fingerprint (the timeline, its
  length, its newest event, the read receipts) changes.
- `createUnreadRollups({ flags })`: unread and highlight counts for groups of rooms (a
  space's rooms, Home). `changed(roomId)` marks a room; the next read of any group recounts
  only the marked rooms, and only the groups they are in move.
- `indexParents(spaceIds, childIdsOf)` and `spaceReach(spaceId, childSpaceIdsOf)`: the
  reverse of the spaces' child lists, and everything a space's badge covers.

```ts
const unread = createRoomMemo({
  idOf: (room) => room.roomId,
  fingerprintSize: 2,
  fingerprint(room, out) {
    out[0] = room.getLiveTimeline();
    out[1] = room.getLiveTimeline().getEvents().length;
  },
  compute: (room) => computeUnread(room),
});
client.on(RoomEvent.Receipt, (_event, room) => unread.invalidate(room.roomId));
```

The caller decides when something changed, from the SDK's events. `src/lib/matrix/client.zami.ts`
wires these up for Zami (`getRoomUnreadInfo`, `getSpaceUnreadGroup`, `getHomeUnreadGroup`,
`getSpaces` and the parent-space lookups).
