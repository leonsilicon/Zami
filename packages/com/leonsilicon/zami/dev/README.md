# @-/com.leonsilicon.zami.dev

`_dev` builds, installs and runs the Zami app with its dev server. Run it from anywhere
in the repository:

```sh
vpx _dev              # iOS simulator: build if needed, install, launch, serve JS
vpx _dev android      # Android emulator or device
vpx _dev start        # only the dev server, for an app that's already installed
vpx _dev ios --device "iPhone Duo"   # anything after the target goes to the Expo CLI
```

It first warns if any Zami file is out of sync with upstream Zam (see `vpx _zami check`).

## TestFlight

`_testflight` builds the app for the App Store and uploads it to TestFlight:

```sh
ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=path/to/AuthKey_….p8 vpx _testflight
vpx _testflight --export-only   # stop after the signed .ipa (apps/zami/.build/testflight)
```

It runs `expo prebuild`, stamps the build number with the time (`YYYYMMDD.HHMM`, UTC, so
each upload is newer), archives the Release configuration and exports it with
xcodebuild. Signing is automatic: with the App Store Connect API key, xcodebuild creates
the provisioning profiles it needs, using team `M76P5G9HXK`'s distribution certificate,
which must be in this Mac's keychain. The app record (bundle ID `com.leonsilicon.zami`)
must already exist in App Store Connect; Apple's API can't create one.

`app.json` declares the app's encryption exempt from export documentation
(`ios.config.usesNonExemptEncryption`): it uses only standard algorithms (Matrix's
Olm/Megolm through matrix-sdk-crypto, and AES, HMAC, SHA-2 and PBKDF2).
