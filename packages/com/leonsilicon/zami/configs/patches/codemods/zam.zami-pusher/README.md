# @-/com.leonsilicon.zami.configs.patches.codemods.zam.zami-pusher

A codemod for upstream Zam's `src/lib/push.ts`, applied when its web app is built. Zam's
native pusher is its Android app's: app id `moe.crafty.matrix` (what Zam's Sygnal serves),
"Zam" on "Android (<device id>)", and a `default_payload` its Android service reads to write
the notification itself. In the Zami app the pusher goes to Zami's push gateway
(`apps/push-gateway`), which sends it through Expo's push service, so it's made for that
gateway:

- `app_id` is the app's own id (com.leonsilicon.zami, or com.leonsilicon.zami.staging),
  which the gateway serves (its `APP_IDS`), read from the shell's bootstrap
  (`__zamiShell.appId`);
- it's "Zami", on "iOS (…)" or "Android (…)", which is how a homeserver lists it (Element's
  session list shows it), and how Zam finds its own stale pushers;
- `default_payload.expo` is the alert the OS shows (Expo message fields): Zam's generic
  "New message" with the default sound, since pushes are `event_id_only` and carry no
  message content.
