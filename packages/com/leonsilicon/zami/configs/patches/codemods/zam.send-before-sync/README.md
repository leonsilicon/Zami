# @-/com.leonsilicon.zami.configs.patches.codemods.zam.send-before-sync

At launch Zam shows rooms from its saved room list before sync has delivered them. Upstream
shows a note in place of the composer for such a room, because the SDK sends to a room it
doesn't have without encrypting. Here the composer is there from the first frame:

- A text message sent from a cached room goes to Zam's outbox, which shows it above the
  composer and sends it once the room is live.
- The outbox is kept in `localStorage` per account, so a message survives the page being
  reloaded or the web process being killed before it was sent. An item's id is its
  transaction id, so a send that reached the server but wasn't acknowledged isn't repeated.
- Every other event for a cached room (a file, a sticker, a command) waits in
  `client.sendEvent` until sync has delivered the room, and fails after a minute.
