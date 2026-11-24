# @-/com.leonsilicon.zami.configs.patches.codemods.zam.keep-sync-cache

Keeps the sync the SDK saved on the device, which a launch reads its rooms from.

Before a room's members are loaded, Zam clears the copy an earlier session stored. The SDK's
IndexedDB store builds the range to delete from the keys it finds, and with none it throws
inside the store's own failure handler, which **deletes the whole saved sync** and keeps the
session in memory. Zam only clears when a copy is stored, but a launch loads the open room's
members twice at once (for the room as it was saved, then as sync delivers it): both see the
copy, the first deletes it, and the second finds nothing. Every launch after one that hit it
then started from a full initial sync, which is what "Reconnecting…" was waiting for.

Here the store clears one room at a time, and only a room that still has a copy.
