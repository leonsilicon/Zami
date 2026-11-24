# @-/com.leonsilicon.zami.configs.patches.codemods.zam.connect-at-launch

Zami's shell sends a launch's first requests to the homeserver as the page starts, before
any of the app has loaded (`launch-requests.ts` in `@-/com.leonsilicon.zami.shell`), and
hands each answer to the SDK when it asks. The one that matters most is the sync for what
changed since the app last ran, and that needs the token of the sync saved on the device,
which is inside the SDK's store: reading it there means opening the store and loading
everything it holds.

So each time the store saves, its token is written to `localStorage`
(`zami_saved_sync_token`, per account and device), which the shell can read at once. It's
the token of what was saved, taken as the save takes it: the shell's request is only used
when the SDK then asks for a sync from that same token, so a token that fell behind costs
one unused request and nothing else.
