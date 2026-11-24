# Zami

Zami is [Zam](https://github.com/az4521/Zam), the Matrix client, as an Expo app: Zam's own
web app in a native shell. Zam's code (its Svelte UI, its stores, matrix-js-sdk and the Rust
crypto in WebAssembly) runs in a WebView as upstream builds it, changed only by a few
codemods (below). The shell gives it what Zam's Android app gets from Capacitor (sign-in
callbacks, push notifications, native storage), so Zam takes the paths it takes in a native
app.

Zami's source lives in `apps/` and `packages/` and uses ordinary filenames.

```
repos/com/github/az4521/Zam/           pristine upstream Zam submodule
packages/com/github/az4521/Zam/        importable workspace package for pinned Zam source
packages/com/leonsilicon/zami/
  configs/patches/                     Zami's changes to code it doesn't own, as jssg codemods
  web/                                 builds Zam's web app (`vpx _web`)
  shell/                               the app: the WebView, and Capacitor's native side
  plugins/                             `zam.zami`, what Zami adds to Zam's plugin API
  paths/  dev/  maestro/  push-gateway/
apps/zami/                             the Expo app
apps/push-gateway/                     zami-push.leonsilicon.com, the Matrix push gateway
apps/upstream-sync/                    relays Zam fork pushes to the upstream sync workflow
apps/site/                             zami.leonsilicon.com
```

## How it works

1. **Zam's source.** `repos/com/github/az4521/Zam` is a submodule pinned to an upstream
   commit. Zami tooling imports `@-/com.github.az4521.zam` to read that commit. The submodule
   stays pristine.
2. **The web app.** `vpx _web build` exports that tree to a cache directory, applies Zami's
   codemods and installs Zam's dependencies from its lockfile (`npm ci`). It builds with
   `vite.webview.config.ts`, a generated config that adds Zami's plugin to Zam's Vite
   config. Native builds run this incrementally and bundle the result as `zami-web/`.
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

Zami Paper is the default theme. Its Linear-inspired design pairs a compact workspace sidebar
with a framed conversation pane on desktop and full-width views on phones. It uses neutral
light, dark, and AMOLED palettes with an indigo accent. The iOS release keeps Paper enabled
and runs only built-in plugins. See the [App Store review notes](docs/app-store-review.md).

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
- **Starting at once**: a launch paints the app as it last looked, with a composer that
  takes typing, before the web app has loaded (the shell's launch frame). The app then shows
  the rooms saved on the device while Matrix reconnects (`zam.warm-room-startup`), and a
  message sent before sync has delivered its room waits in the outbox, which survives a
  restart (`zam.send-before-sync`). The web app's startup code is a few chunks, not hundreds.
- **No Zam updates** (`zam.no-zam-updates`): Zam's Android updater would offer Zam's own
  APKs and web bundles; Zami's builds come from the App Store and TestFlight.
- **react-native-webview** (`react-native-webview`, a bun patch): hooks the shell needs to
  serve the bundled web app.

## Setup and running

```sh
git submodule update --init --recursive
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

[Forkkeeper](https://github.com/bocklabs/forkkeeper) syncs `master` on
[`leonsilicon/Zam`](https://github.com/leonsilicon/Zam) with upstream. A signed push webhook
from that fork starts the `Zami upstream sync` workflow through the
[webhook Worker](apps/upstream-sync/README.md). You can also run it from the Actions tab.
The workflow checks the official Zam remote, validates Zami's codemods and builds the web
app before updating the submodule pin on `trunk`. If a codemod stops applying, the workflow
log identifies it and the pin stays on the last buildable revision.

To try the latest upstream commit locally, stage its pin before running the checks:

```sh
git submodule update --init --remote --checkout -- repos/com/github/az4521/Zam
git add -- repos/com/github/az4521/Zam
vpx _patches check && vpx _web build
```

## Releases

Capture App Store images with `vpx _create-screenshots`. The command runs scripted scenes
in a simulator with sample Matrix data. See the [screenshot setup](packages/com/leonsilicon/zami/dev/README.md#app-store-screenshots).

`vpx _testflight` builds the app for the App Store and uploads it to TestFlight (see
`packages/com/leonsilicon/zami/dev`); the workflows build `trunk` nightly as "(S) Zami"
(staging) and `production` as "Zami".

Set the release version in `apps/zami/app.json` and `apps/zami/package.json` to
`1.YYYYMMDD.PATCH` using the UTC release date. Start at patch `0` and increment it
for another release on the same date. Run `bun install` to update the lockfile.

## License

GPL-3.0-or-later, as Zam is ([LICENSE](LICENSE)).
