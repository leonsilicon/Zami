# @-/com.leonsilicon.zami.configs.patches.codemods.zam.no-zam-updates

A codemod for upstream Zam, applied when its web app is built, that keeps Zam's Android
updater off in the Zami app. Zam's Android app downloads Zam's APK from Zam's GitHub
releases (ApkUpdater) or a new web bundle (WebBundle). The Zami app is native on Android
too, so Zam would offer it Zam's own releases, and a web bundle would replace Zami's (built
with these codemods) with Zam's. Zami's builds come from the App Store, Google Play and
TestFlight.

- `src/lib/androidUpdater.ts`: `isAndroidUpdater()` is false.
- `src/lib/androidWebBundle.ts`: `isAndroidWebBundle()` is false.

The About page's check still says which release of Zam is the latest.
