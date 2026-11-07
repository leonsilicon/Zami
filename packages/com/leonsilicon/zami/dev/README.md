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
