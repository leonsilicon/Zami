# @-/com.leonsilicon.zami.configs.patches.codemods.zam.quiet-sync-replay

A launch replays the sync saved on the device before it can take anything new from the
server, and the app was drawn over the saved room list by then. Zam ran its per-event
handlers for every message and receipt in that replay, and each one bumped the unread
counter that every row of the room list re-derives from: the work grew with rooms × events
(0.6 s for 300 rooms, 10 s for 1,500), all of it on the main thread, with "Reconnecting…"
on screen until it ended.

- Until the first sync is in (`initialSyncComplete`, which Zam already keeps to hold back
  notifications for this backlog), `onTimelineEvent` and `onAnyReceiptEvent` don't call
  their subscribers. The receipt subscribers are called once when it's in; the room lists
  and the open room are rebuilt then anyway. `onDecryptedTimelineEvent` doesn't follow the
  saved sync's encrypted messages either: they're never announced, so its subscribers had
  nothing to do when each one decrypted.
- `bumpUnreadTick` bumps once for a burst of calls rather than once per event, so a large
  catch-up (or a room's worth of messages decrypting) doesn't re-derive the list per event.
