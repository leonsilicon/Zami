# @-/com.leonsilicon.zami.browser

`window`, `document` and `navigator` for Zam's code in React Native. Metro rewrites those
names (and `location`) in Zam's tree to `globalThis.__ZAMI_WINDOW__` and its siblings,
which `installBrowserGlobals()` defines; the app calls it before Zam's modules load.
Nothing else sees them, so libraries that feature-detect a browser still find React
Native.

- **document:** `visibilityState`, `hidden`, `hasFocus()` and `visibilitychange` follow
  AppState (a backgrounded app is a hidden page). `documentElement.dataset.theme` switches
  the Uniwind theme, and `documentElement.style.setProperty("--x", …)` sets a Uniwind CSS
  variable. Building, parsing and querying nodes happen in a detached DOM (linkedom),
  which Zam uses for string-level HTML work (twemoji, code highlighting, reply
  fallbacks); nothing in it is displayed. An `<a>`'s click opens its link, or with
  `download` set, offers the file through the share sheet (iOS has no Downloads folder
  for apps).
- **window:** the global object, plus `focus`/`blur` (AppState) and `resize` events, the
  detached DOM's classes (`DOMParser`, `Node`, `HTMLElement`, …; Metro points those names
  here too),
  `matchMedia` for width, hover, pointer and preference queries, `open` (the system opens
  the link), and `innerWidth`/`innerHeight`.
- **navigator:** React Native's, plus `language(s)` (expo-localization), `onLine`,
  `clipboard` (expo-clipboard), `vibrate` and `geolocation` (expo-location). Service
  workers, media devices, storage and locks stay undefined, as Zam feature-detects them.
- **location:** `@-/com.leonsilicon.zami.sveltekit`'s.
