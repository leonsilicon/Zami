# @-/com.leonsilicon.zami.event-revision

Lets a rune reader (a `useRune` getter) follow one matrix-js-sdk event, or one event's
reactions, instead of a global tick.

matrix-js-sdk changes a `MatrixEvent` in place: it decrypts, gets an edit applied, changes
send status or swaps its local id for the real one, is redacted. A reader can't see that by
the event's identity, so Zam reads a global counter (`timelineTick`, `reactionTick`) that is
bumped for every such change in every room. Every message row on screen re-reads on every
bump, and a launch that decrypts 10,000 messages in the background re-renders them all for
minutes.

`eventRevision(event)` is a number that moves only when that event changes. Read in an
effect, it listens on the event's own emitter while read, and stops when nothing reads it:

```tsx
const revision = useRune(() => eventRevision(event), [event]);
const content = useMemo(() => event.getContent(), [event, revision]);
```

`relationsRevision(room.relations, event, "m.annotation", ["m.reaction"])` moves when that
event's reactions change (added, removed, redacted, or one of ours finishes sending), so
the reactions under a message re-read without re-rendering the message.

`bumpEventRevision(event)` moves an event's revision by hand, for a change the SDK doesn't
emit on the event.
