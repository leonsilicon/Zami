# @-/com.leonsilicon.zami.capacitor

What the `@capacitor/*` modules Zam imports look like in the Zami app: Metro resolves
every `@capacitor/*` specifier to `capacitor.cjs`. Zam runs on Capacitor only in its
Android build, so here `Capacitor.isNativePlatform()` is false and Zam takes the paths it
takes on the web. Plugins (`App`, `Browser`, `Preferences`, `PushNotifications`, …)
reject every call, except `addListener`, which returns a handle and never fires. Native
features are ported to Expo modules in the translations instead.

(The real `@capacitor/*` packages are installed only for upstream's tests: as app
dependencies Expo would autolink their native code.)
