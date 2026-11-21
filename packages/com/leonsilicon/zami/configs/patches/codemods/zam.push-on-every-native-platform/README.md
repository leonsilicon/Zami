# @-/com.leonsilicon.zami.configs.patches.codemods.zam.push-on-every-native-platform

A codemod for upstream Zam's `src/lib/unifiedPush.ts`, applied when its web app is built.

Zam turns push on only when its push status says Firebase is available (`fcmAvailable`),
and only its Android app's UnifiedPush plugin ever says so: on any other platform
`getUnifiedPushStatus()` answers `fcmAvailable: false` without asking, so `initPush()` finds
no push service. In the Zami app, Zam's "fcm" path (the PushNotifications plugin) gets an
Expo push token on iOS as well, so on a native platform that isn't Android the status now
says that path is available. On the web nothing changes.
