# @-/com.leonsilicon.zami.dev

`_dev` builds, installs and runs the Zami app with its dev server. Run it from anywhere
in the repository:

```sh
vpx _dev              # iOS simulator: build if needed, install, launch, serve JS
vpx _dev android      # Android emulator or device
vpx _dev start        # only the dev server, for an app that's already installed
vpx _dev ios --device "iPhone Duo"   # anything after the target goes to the Expo CLI
```

A native run first brings Zam's web app up to date (`vpx _web build`, which the native
build then copies into the app); `start` doesn't need it.

## TestFlight

`_testflight` builds the app for the App Store and uploads it to TestFlight:

```sh
ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=path/to/AuthKey_….p8 vpx _testflight
vpx _testflight --export-only   # stop after the signed .ipa (apps/zami/.build/testflight)
```

The key can also come as its contents, in `ASC_KEY_P8`, as CI passes it.

1. With the App Store Connect API key, it finds which of the team's distribution
   certificates is in this Mac's keychain, and keeps an App Store provisioning profile
   for the app current (`com.leonsilicon.zami App Store (_testflight)`, covering every
   distribution certificate of the team), installing it where Xcode looks.
2. It runs `expo prebuild` and signs the app target's Release configuration by hand with
   that certificate and profile. Signing by hand needs no Xcode account and no
   development certificate, so it runs the same here and on CI.
3. It stamps the build number as `1.YYYYMMDD.PATCH`, using the current UTC time (`HHMM`)
   as the numeric patch. It archives the Release configuration and exports or uploads it
   with xcodebuild.

The app record (bundle ID `com.leonsilicon.zami`, team `M76P5G9HXK`) must already exist in
App Store Connect; Apple's API can't create one. `app.json` declares the app's encryption
exempt from export documentation (`ios.config.usesNonExemptEncryption`): it uses only
standard algorithms (Matrix's Olm/Megolm through matrix-sdk-crypto, and AES, HMAC, SHA-2
and PBKDF2).

The workflow `.github/workflows/zami-testflight.yml` runs it on every push to `main` (and on
demand) on a GitHub-hosted Mac, with the key and a distribution certificate from the
repository's secrets.

## App Store screenshots

Run from the Zami checkout on macOS with Xcode, iOS simulators, and Argent available.

```sh
vpx _create-screenshots
vpx _create-screenshots ipad --out ~/Desktop/zami-screenshots
vpx _create-screenshots iphone --app /path/to/Release-iphonesimulator/Zami.app
```

With no device arguments, the command captures both an iPhone 18 Pro or 17 Pro and a
13-inch iPad Pro (M5 or M4). Use portrait orientation and an English simulator locale.
Use `--iphone-device` or `--ipad-device` to select a compatible simulator by name or UDID. It builds the release simulator
app if you omit `--app`. It installs a copy as **Zami Screenshots** under its own bundle ID
and deep-link scheme, leaving your regular Zami installation and its accounts alone.

The capture build seeds a synthetic Matrix account and renders the real conversation,
space, and Privacy & Safety screens. The [scene list](../plugins/screenshot-scenes.ts)
defines capture order, deep links, and readiness checks. Edit the
[sample Matrix events](../plugins/screenshot-fixture.ts) to refresh the sample rooms and
conversation.

Each attempt writes a new dated folder under `apps/zami/.build/screenshots` (or under
`--out`) with separate iPhone and iPad folders. Files are opaque JPEGs at native
resolution. iPhone uses 1206 × 2622 pixels and iPad uses 2064 × 2752 pixels.
