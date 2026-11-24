# @-/com.leonsilicon.zami.shell

The Zami app: upstream Zam's web app (`@-/com.leonsilicon.zami.web`) in one WebView, and
Capacitor's native side behind it, so Zam's code runs as it does in a native app.

```tsx
<SafeAreaProvider>
  <ZamiShell />
</SafeAreaProvider>
```

## Serving the web app

The config plugin (`withZamiShell` from `@-/com.leonsilicon.zami.shell/config-plugin`, which
`apps/zami/app.config.ts` adds) has each native build run `vpx _web build` and copy
the result into the app as `zami-web/`. The native module (`ios/`, `android/`) serves it at
an origin of its own, through hooks the `react-native-webview` codemod adds:

- **iOS:** `zami://localhost`, a WKURLSchemeHandler. WebKit treats a custom scheme as a
  secure context with its own storage (WebCrypto, IndexedDB, localStorage), which a
  `file://` URL isn't.
- **Android:** `https://localhost`, the origin Zam's own Capacitor app uses, from the
  WebViewClient's request interceptor.

Paths that aren't files get `index.html` (SvelteKit's static adapter), byte ranges work for
media, and each HTML page loads `/__zami/start.js`, the bootstrap, before its own scripts:
Zam's CSP allows same-origin scripts but not inline ones. In a debug build,
`EXPO_PUBLIC_ZAMI_WEB_URL` loads the web app from elsewhere (`vpx _web serve`), with the
bootstrap as a document-start script instead.

## The launch frame

The first thing a launch paints is the app as it last looked, with a composer that takes
typing, before any of the web app's code has loaded:

1. As the app is left (and a moment after it changes), the page sends a copy of its DOM,
   the launch page (`launch.ts` in `@-/com.leonsilicon.zami.plugins`).
2. The shell keeps it natively (`launch-store.ts`, expo-sqlite's key-value store), reads it
   as it starts, and puts it in the script every page runs first, after the bootstrap
   (`launch-frame.ts`).
3. That script draws the page as soon as the document has a body, if this launch opens on
   what it shows: the same account, build and width, with the same home registered. It
   tells the shell once it has painted, and the shell shows the web view then, without
   waiting for the page to finish loading.
4. The app takes the frame off once its own shell shows a composer underneath. What was
   typed goes to the real composer, with the keyboard, and is sent if the frame's send
   button was pressed.

The launch page is the last screen as it was shown, so it holds what was on it (names,
and messages if a conversation was open) outside Zam's own storage, in the app's sandbox.
It's replaced as the app is used and deleted when the account signs out.

## Capacitor's native side

Zam reaches native code only through Capacitor. The bootstrap (`bootstrap.ts`) defines
what `@capacitor/core` looks for from the native side: `Capacitor.PluginHeaders` (the
plugins implemented here), `nativePromise` / `nativeCallback` (calls, sent as
react-native-webview messages) and `fromNative` (results and events), and
`CapacitorCustomPlatform` with the OS as the platform. The bridge (`bridge.ts`) runs the
calls on the plugins and sends back results and listener events, keeping an event no one
listens to yet when asked (a notification tap that launched the app).

| Plugin            | What Zam uses it for                                                               | Here                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| App               | sign-in callbacks (`appUrlOpen`, `getLaunchUrl`), the back button, `exitApp`       | Linking, AppState, BackHandler                                                    |
| Browser           | sign-in pages, which redirect to `com.leonsilicon.zami:`                           | an authentication session (expo-web-browser), whose redirect becomes `appUrlOpen` |
| Preferences       | its native session mirror and flags                                                | expo-sqlite's key-value store, under Capacitor's key names                        |
| PushNotifications | permission, the token its pusher registers, taps, clearing delivered notifications | expo-notifications; the token is an Expo push token for `apps/push-gateway`       |

On Android only, a UnifiedPush plugin answers Zam's question of whether push can go through
Firebase (yes: PushNotifications' Expo token), which Zam asks before it turns push on.

`Capacitor.getPlatform()` answers `ios` or `android`. Zam's other Android-only plugins
(CallService, FileTransfer, MediaSaver, PushDecrypt, …) aren't implemented, so on Android
Zam's calls to them reject as unimplemented, and it falls back where it has a fallback.

In a debug build, `globalThis.__zamiShell.evaluate(code)` (from React Native's debugger)
runs `code` in the page and puts what it returns in `__zamiShell.results[id]`. Safari's Web
Inspector (iOS) and Chrome's DevTools (Android, `chrome://inspect`) attach to the page in
debug builds and in the staging app, so a launch or a stall on a real account can be
profiled from a TestFlight build; the production app isn't inspectable.

The bootstrap also gives the page `window.__zamiShell`: the platform, the plugins, and the
app's id (`appId`: com.leonsilicon.zami, or .staging), which the `zam.zami-pusher` codemod
registers Zam's pusher under.

The WebView sits in the safe area (Zam's layout doesn't pad for a notch) with the page's
`theme-color` around it, and its bottom edge follows the keyboard, so Zam's layout shrinks
instead of scrolling away. Links to other sites open in their apps.

## Tests

`__tests__/bridge.test.ts` runs the bootstrap in a sandboxed `window` with the real
`@capacitor/core` and the bridge carrying its messages. `__tests__/launch-frame.test.ts`
runs the launch frame the same way: which launches it draws the saved page on.
