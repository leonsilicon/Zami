# Zami

Zami is [Zam](https://github.com/az4521/Zam), the Matrix client, as an Expo app: Zam's own
web app in a native shell. Zam's code (its Svelte UI, its stores, matrix-js-sdk and the Rust
crypto in WebAssembly) runs in a WebView as upstream builds it, changed only by a few
codemods (below). The shell gives it what Zam's Android app gets from Capacitor (sign-in
callbacks, push notifications, native storage), so Zam takes the paths it takes in a native
app.

```
packages/com/github/az4521/Zam/        upstream Zam, as upstream has it (never edited)
packages/com/leonsilicon/zami/
  configs/patches/                     Zami's changes to code it doesn't own, as jssg codemods
  web/                                 builds Zam's web app (`vpx _web`)
  shell/                               the app: the WebView, and Capacitor's native side
  plugins/                             `zam.zami`, what Zami adds to Zam's plugin API
  paths/  dev/  maestro/  push-gateway/
apps/zami/                             the Expo app
apps/push-gateway/                     zami-push.leonsilicon.com, the Matrix push gateway
apps/site/                             zami.leonsilicon.com
```

## How it works

1. **Zam, unmodified.** `packages/com/github/az4521/Zam` is upstream's tree, merged as a
   subtree (below). Nothing in it is ever edited, formatted or linted.
2. **The web app.** `vpx _web build` exports that tree to a cache directory, applies Zami's
   codemods for it, installs Zam's dependencies from its own lockfile (`npm ci`) and builds
   it with its own Vite config. The native builds run it (incrementally) and bundle the
   result as `zami-web/`.
3. **The shell.** The app is one WebView. Its native module serves the bundled web app at an
   origin of its own (`zami://localhost` on iOS, `https://localhost` on Android, like Zam's
   Capacitor app): a secure context with its own storage, with no local server. Before any
   of Zam's code, the page runs the shell's bootstrap, which defines Capacitor's native side
   (`window.Capacitor.PluginHeaders`, `nativePromise`, `fromNative`), so `@capacitor/core`
   reports a native platform. Zam's plugin calls then reach the shell's implementations in
   React Native: App (deep links, the back button), Browser (sign-in sessions), Preferences
   (SQLite) and PushNotifications (expo-notifications, with Expo push tokens).
4. **Push.** Zam registers its pusher with the token the shell hands it, at the gateway its
   build names (`VITE_PUSH_GATEWAY_URL`, Zami's own by default): `apps/push-gateway`, which
   sends pushes through Expo's push service.

## Changing Zam: codemods

Zami never edits Zam's files. A change to Zam's code (or to an npm package) is a jssg
codemod in `packages/com/leonsilicon/zami/configs/patches/codemods/<name>/`, as Haniverse
patches its dependencies: `codemod.ts` turns the file as upstream has it into the changed
one, and `patch.json` names the files it must change. Zam's codemods are applied to the
copy the web app is built from; an npm package's become a bun patch in `patches/`
(`vpx _patches generate`). When upstream changes what a codemod looks for, the build fails
and names the codemod, instead of shipping the file unpatched. See that package's README.

## What Zami changes

Each is a codemod in `configs/patches/codemods/` (its README says why), or Zami's own code:

- **Plugins: `zam.zami`** (`zam.zami-plugins`, `@-/com.leonsilicon.zami.plugins`). Zam's
  plugins get every module of the app and its top-level names, patches of any function or
  Svelte component, Zam's stores with runes, loading before the first render, pages of
  their own, and the app's native side (its Expo modules). See that package's README.
- **Signing in as Zami** (`zam.zami-oauth-client`): an OAuth client named "Zami", at
  https://zami.leonsilicon.com (`apps/site`), returning to `com.leonsilicon.zami:`.
- **Sliding sync off at sign-in** (`zam.sliding-sync-off-at-sign-in`): it breaks signing in
  to Beeper.
- **Push** through Zami's gateway on iOS and Android (`zam.push-on-every-native-platform`,
  `zam.zami-pusher`): the app's own id, "Zami" on "iOS (…)" or "Android (…)", and the alert
  the OS shows.
- **No Zam updates** (`zam.no-zam-updates`): Zam's Android updater would offer Zam's own
  APKs and web bundles; Zami's builds come from the App Store and TestFlight.
- **react-native-webview** (`react-native-webview`, a bun patch): hooks the shell needs to
  serve the bundled web app.

## Setup and running

```sh
git remote add upstream https://github.com/az4521/Zam.git   # once per clone
vp install
vpx _dev              # iOS simulator: build the web app and the app if needed, install, launch, serve JS
vpx _dev android      # Android emulator or device
vpx _dev start        # only the dev server, for an app that's already installed
vpx _web serve        # serve the web app on localhost:4173; a debug build started with
                      # EXPO_PUBLIC_ZAMI_WEB_URL=http://localhost:4173 loads it from there
```

Zam's build-time settings (`VITE_*`) are read from the environment by `vpx _web build`.
`EXPO_PUBLIC_PUSH_GATEWAY_URL` sets Zam's `VITE_PUSH_GATEWAY_URL`; unset, it's Zami's own
gateway, [`apps/push-gateway`](apps/push-gateway/README.md).

## Checks

```sh
vp check              # format, lint and type-check Zami's code
vp run typecheck
vp run test           # Zami's tests
vpx _patches check    # every codemod still applies
vp run bundle         # bundles the app's JS for both platforms with Metro
vpx _maestro          # the Maestro flows (apps/zami/.maestro) on an iOS simulator
```

## Syncing upstream

Upstream Zam is merged into its directory as a subtree:

```sh
git fetch upstream
git merge -X subtree=packages/com/github/az4521/Zam upstream/master
vpx _patches check && vpx _web build
```

The scheduled workflow `.github/workflows/zami-upstream-sync.yml` does this and opens a pull
request. A codemod that no longer applies fails the check; fix the codemod, not Zam's file.

## Releases

`vpx _testflight` builds the app for the App Store and uploads it to TestFlight (see
`packages/com/leonsilicon/zami/dev`); the workflows build `trunk` nightly as "(S) Zami"
(staging) and `production` as "Zami".

## License

GPL-3.0-or-later, as Zam is ([LICENSE](LICENSE)).
