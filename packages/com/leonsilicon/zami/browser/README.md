# @-/com.leonsilicon.zami.browser

`window`, `document` and `navigator` for Zam's code in React Native. Metro rewrites those
names (and `location`) in Zam's tree to `globalThis.__ZAMI_WINDOW__` and its siblings,
which `installBrowserGlobals()` defines; the app calls it before Zam's modules load.
Nothing else sees them, so libraries that feature-detect a browser still find React
Native.

- **document:** `visibilityState`, `hidden`, `hasFocus()` and `visibilitychange` follow
  AppState (a backgrounded app is a hidden page). `documentElement.dataset.theme` switches
  the Uniwind theme, and `documentElement.style.setProperty("--x", …)` sets a Uniwind CSS
  variable. Queries find nothing; creating nodes throws where it's called.
- **window:** the global object, plus `focus`/`blur` (AppState) and `resize` events,
  `matchMedia` for width, hover, pointer and preference queries, `open` (the system opens
  the link), and `innerWidth`/`innerHeight`.
- **navigator:** React Native's, plus `language(s)` (expo-localization), `onLine`,
  `clipboard` (expo-clipboard) and `vibrate`. Service workers, media devices, storage,
  locks and geolocation stay undefined, as Zam feature-detects them.
- **location:** `@-/com.leonsilicon.zami.sveltekit`'s.
