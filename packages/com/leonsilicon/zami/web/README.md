# @-/com.leonsilicon.zami.web

`_web` builds upstream Zam's web app for the Zami app, which shows it in a WebView
(`@-/com.leonsilicon.zami.shell`). Run it from anywhere in the repository:

```sh
vpx _web build [--force]   # build it into apps/zami/.build/web/zami-web
vpx _web serve [--port n]  # build it and serve it on localhost (4173), for a debug build
                           # started with EXPO_PUBLIC_ZAMI_WEB_URL=http://localhost:4173
vpx _web path              # where the built app is
```

The native builds run `_web build` themselves (the shell's config plugin), so it rarely
needs running by hand.

1. It reads the pinned Zam submodule through `@-/com.github.az4521.zam` and exports it
   to a cache directory (`~/Library/Caches/zami/web/src`), writing only changed files. The
   cache is outside the repository and any node_modules: Node won't run TypeScript from
   under node_modules, which Zam's build scripts import.
2. It applies Zami's codemods for Zam (`@-/com.leonsilicon.zami.configs.patches`) to that
   copy.
3. It installs Zam's dependencies from Zam's own lockfile (`npm ci`), when the lockfile
   changed.
4. It builds with Zam's own Vite config (`vite build`), then packs the emoji images as Zam's
   `build` script does. Zam's other build steps are for other platforms.

A build is cached by Zam's files, the codemods and the settings, so an unchanged build is
instant.

Zam's build-time settings (`VITE_*`) come from the environment. `VITE_PUSH_GATEWAY_URL` is
`EXPO_PUBLIC_PUSH_GATEWAY_URL`, or Zami's own gateway (`zami-push.leonsilicon.com`).
