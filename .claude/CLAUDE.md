# Zami

Zami is Zam (a SvelteKit Matrix client) as an Expo app: Zam's own web app, changed only by
codemods, in a WebView, with Capacitor's native side implemented in React Native. Read
`README.md` before changing anything.

- **Upstream Zam lives in the `repos/com/github/az4521/Zam` submodule.** Keep the
  submodule pristine. Import `@-/com.github.az4521.zam` from other workspace packages to
  read the pinned source. The upstream sync workflow verifies and updates the pin.
- **Change Zam's code (or an npm package) with a jssg codemod** in
  `packages/com/leonsilicon/zami/configs/patches/codemods/<name>/` (`codemod.ts` and
  `patch.json`; see that package's README). Zam's codemods are applied to the copy the web
  app is built from; npm ones become bun patches (`vpx _patches generate`, never edit
  `patches/` by hand). A codemod must fail loudly when upstream drifts. When one stops
  applying after a merge, fix the codemod.
- Prefer doing things in the shell (`packages/com/leonsilicon/zami/shell`: the WebView,
  the bootstrap, the Capacitor plugins) over patching Zam. Zam reaches native code only
  through Capacitor: to give it a native feature, implement the plugin it calls.
- Zami's own code is Flatcap packages under `packages/com/leonsilicon/zami/` (see the
  user's Flatcap conventions) and the apps in `apps/`.
- Build Zam's web app with `vpx _web build` (native builds run it themselves). Run the app
  with `vpx _dev` (iOS), `vpx _dev android` or `vpx _dev start`.
- Run the end-to-end flows (`apps/zami/.maestro`) with `vpx _maestro` (iOS) or
  `vpx _maestro android`.
- Check with `vp check`, `vp run typecheck`, `vp run test` and `vpx _patches check`. Format
  and lint with Vite+ (`vp fmt`, `vp lint`), which the root `vite.config.ts` keeps off Zam's
  tree. Never run Prettier, oxfmt or oxlint directly.
