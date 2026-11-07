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
- **Notification** (a `window` member, as Metro points Zam's `Notification` there): the
  Web Notification API on expo-notifications. Constructing one presents a local
  notification at once (one with the same `tag` replaces it), `onclick` fires when it's
  tapped, `onclose` when it's tapped, dismissed or closed, and `close()` takes it down;
  `silent` turns its sound off. `Notification.permission` is the system's permission as
  last read (at startup, on each return to the app, after `requestPermission()`, and
  again when it's read while not granted), with one the system will still ask for as
  `"default"`. The app's notification handler (`apps/zami/notifications.ts`) shows these
  while the app is open.
- **Web Audio** (`AudioContext`, `webkitAudioContext`, `OfflineAudioContext`; `window`
  members too): react-native-audio-api's, plus the web's `decodeAudioData(data, success,
  failure)` and `setSinkId` (one output, the default). `decodeAudioData` also takes WebM
  Opus, which Chromium's MediaRecorder writes: iOS decodes Opus only in Ogg, so #opus
  rewraps it (no re-encoding). There's no MediaStream node (calls have their own audio),
  `createMediaElementSource` or AudioWorklet. react-native-audio-api doesn't manage the
  audio session (`apps/zami/media.ts`): it plays in whichever one expo-audio, the
  recorder or a call has set up.
- **Audio:** an HTMLAudioElement (`src`, `play()`/`pause()`, `currentTime`, `duration`,
  `volume`, `muted`, `loop`, `playbackRate`, `autoplay`, the media events in a browser's
  order) that plays through a react-native-audio-api file source, decoding from disk as
  it plays. Its `src` can be a blob URL (the Blob polyfill's are files), `data:`,
  `http(s):`, or one of Zam's static paths. A source iOS can't decode is a
  `MEDIA_ERR_SRC_NOT_SUPPORTED` error. The elements share one context, suspended while
  none plays.
- **AudioDecoder**, **EncodedAudioChunk**: WebCodecs for Opus only (the bundled
  SoundFont's samples): the packets queue up, and `flush()` decodes them as one Ogg Opus
  stream into one f32-planar AudioData.
- **fetch:** React Native's, except for Zam's static files. On the web, `/sounds/x.mp3`
  is the page origin's `static/sounds/x.mp3`; here a relative URL, or one on
  https://zami.invalid, is the bundled Zami version (`static/sounds/x.zami.mp3`, an
  expo-asset asset from a `require.context` over `static/`), answered as a typed 200
  Response, or a 404. Left out of the bundle: the Twemoji images (iOS draws emoji),
  Ruffle and the Flash sandbox (WebAssembly).
- In development, `__zamiAudioDebug.playing()` and `.contexts()` show what plays.

## Hardware keyboard

Every hardware key press and release (@-/com.leonsilicon.zami.keyboard) becomes a
`keydown`/`keyup` KeyboardEvent-like object (`key`, `code`, the legacy `keyCode`,
modifiers, `repeat`, `preventDefault()`, `stopPropagation()`), sent through a browser's
phases: `window` capture listeners, the focused TextInput's own handlers, the containers
around it, then `document` and `window`. Its `target` is a stand-in `<textarea>` while a
TextInput has focus and `document.body` otherwise, so Zam's "is the user typing?" checks
work. The keys are observed, not intercepted: the TextInput has already taken a key when
its handlers run, so `preventDefault()` only marks the event.

Translations use these in place of `onkeydown` and `addEventListener`:

- `useInputKeys(ref, { onKeydown, onKeyup })`: a TextInput's own handlers, while it has focus.
- `useKeyScope({ onKeydown }, [inputRefs])`: a dialog's or picker's handlers, while focus is
  in one of its inputs or, with none focused, while it's the newest scope mounted.
- `addCaptureKeyListener(type, listener)`: `window.addEventListener(type, listener, true)`.
- `useHardwareKeyboard()` / `hardwareKeyboardInUse()`: whether the user types on a hardware
  keyboard (since its last press, until the on-screen keyboard comes up).
- `isModifierHeld("Shift")`: a modifier held now (Shift+Enter in a submitting TextInput).
- `keepFocus(ref)`: puts focus back after a Tab a handler took moved it on.
