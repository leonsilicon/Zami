# @-/com.leonsilicon.zami.configs.patches.codemods.zam.defer-replay-crypto

A launch replays the sync saved on the device before it takes anything new from the server.
For an account whose rooms are encrypted (every bridged room, on Beeper), that replay was
most of the wait behind "Reconnecting…": measured with 300 encrypted rooms of 20 messages,
26 s on a desktop before this, and 11 s with only the other launch fixes.

For each encrypted room in the saved sync, the SDK waited for the crypto store to take the
room's settings again, one room after the other (they have been there since the room's
encryption event first arrived). And it queued every saved message for decryption on the
way, thousands of calls into the same store, which the replay and then the first new sync
waited behind.

While the saved sync replays, neither is done:

- A room's settings are applied after the replay: the open room's at once, the others in
  the background, and at once for a room that's about to be sent to (`encryptEvent` waits
  for its room's).
- Of the saved messages, only what shows without opening a room is decrypted: the open
  room's, each room's unread ones (their text decides counts and highlights), its newest
  for the preview, and each thread's newest. The rest decrypt as they are shown
  (`decryptForDisplay`), which is how Zam already works with sliding sync.
- The open room's are decrypted as the replay ends. The other rooms' follow the first new
  sync, a few at a time and the newest first, so they don't hold up that sync in the crypto
  store or the app on the main thread.

Anything the app itself asks to decrypt meanwhile (a saved room's messages, say) is decrypted
as soon as the replay ends, and state events are decrypted as they come, since the replay
waits for those. A first sync with nothing saved, and every sync after the replay, are as
upstream has them.
