# @-/com.leonsilicon.zami.plugins

What Zami adds to Zam's plugin host, so that a plugin can change anything in the app.

Zam's plugins fill the slots its host defines (commands, composer buttons, message
actions, panels). In Zami a plugin also gets `zam.zami`: React and React Native, every
module of the app and every library it bundles, patches of any component or function,
stylesheets that reach native views, layers over the whole app, and web pages that run
WebAssembly and Workers. Zam itself has no `zam.zami`, so a plugin written for both checks
for it:

```js
export default {
  onload(zam) {
    const zami = zam.zami;
    if (!zami) return; // Zam on the web or desktop
    // …
  },
};
```

Plugins run with full trust, as in Zam: there's no sandbox, and `zam.zami` doesn't add
one. Everything a plugin adds through it is undone when the plugin is disabled.

## `zam.zami`

`types.ts` is the contract. In short:

|                        |                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `React`, `ReactNative` | The app's own React and React Native (Uniwind's, whose components take `className`).                     |
| `require(specifier)`   | Any app module or bundled library, by the name Zam's code imports it by.                                 |
| `modules`              | `list(prefix?)`, `libraries()`, `has(specifier)`, and a module's top-level names: `names`, `get`, `set`. |
| `stores`               | Zam's stores by name: `stores.rooms` is `$lib/stores/rooms.svelte`.                                      |
| `runes`                | `useRune`, `useDeepRune` for components; `watch(read, onChange)` outside them.                           |
| `components`           | `list()`, `get(name)`, and the patches: `wrap`, `replace`, `props`, `output`.                            |
| `elements`             | `intercept(fn)` sees every element; `find` and `map` walk an element tree.                               |
| `patch`                | `before`, `after`, `instead` on any function of the app or method of an object.                          |
| `ui`                   | `render(el, content)`, `addLayer(Component)`, `toast(message, options)`.                                 |
| `styles`               | `add(css)`, `setVariables({ "--zam-bg": … })`.                                                           |
| `native`               | `modules` (NativeModules), `turbo(name)`, `expo(name)`.                                                  |
| `web`                  | `open(options)` for a web page out of sight, and `Worker`.                                               |
| `app`                  | `early`, `loadEarly(early?)`, `reload()`.                                                                |

`@example/` is a plugin that uses most of it: load that folder in Settings > Plugins.

### Modules

Plugin code is loaded at run time, after Metro has turned every import in the bundle into
a number, so `require` is how it reaches a module. It returns the module the app itself
runs, with its live state:

```js
const { roomsState } = zami.require("$lib/stores/rooms.svelte"); // or zami.stores.rooms
const { getClient } = zami.require("$lib/matrix/client");
const { Svg, Path } = zami.require("react-native-svg");
zami.modules.list("$lib/utils/"); // every module there
zami.modules.libraries(); // "react", "react-native", "matrix-js-sdk", "expo-haptics", …
```

App modules are named as Zam imports them: `$lib/…` without the `.zami.ts`, and
`routes/+page.svelte` for the two routes. Modules load when first asked for, including the
ones the app itself never loads.

Stores are Svelte runes. A component reads them with `runes.useRune(() => …)`, which
re-renders when what the getter read changes; `runes.watch` does the same outside React.
Writing to a store is a plain assignment, and the app reacts to it.

### Components

Every component the app draws can be patched: its own (`components.list()` names them),
React Native's, a library's.

```js
// Wrap: draw something around a component, or instead of it.
zami.components.wrap(
  "RoomHeader",
  (Original) => (props) =>
    h(View, null, h(Original, props), h(Text, { className: "text-zam-textMuted" }, "hi")),
);

// Replace: the replacement gets the same props, plus `Original`.
zami.components.replace("Splash", MySplash);

// Props: change what a component is given (the component isn't remounted).
zami.components.props(zami.ReactNative.TextInput, (props) => ({ ...props, autoCorrect: false }));

// Output: change the elements a function component returns.
zami.components.output("ServerSidebar", (output) =>
  zami.elements.map(output, (element) => (isHomeButton(element) ? null : undefined)),
);
```

A target is a component (whatever an element's type can be) or the name or module of one
of the app's: `"RoomList"`, `"$lib/components/layout/RoomList.svelte"`. Several plugins'
patches of one component compose in the order they were added. A patch that throws while
rendering is dropped, with a toast naming the plugin, and the component draws unpatched.

How it works (`elements.ts`): the app starts by wrapping the JSX runtime's `jsx`/`jsxs` and
`React.createElement`, so every element passes one check on its way to React. An element
whose type has patches is created with that type's slot instead, a component that draws
the patches around the type. A slot stays for the session, so adding and removing patches
re-renders the slots and nothing else.

**Patches reach the elements created after them.** An element already on screen keeps its
type until its parent renders again. So:

- A plugin that patches a component (or intercepts elements) **loads before the app's
  first render** from the next launch on (`early.ts`; the app's root waits for it, up to 4
  seconds). Zam loads plugins once the app shell is up, which is too late for a patch of
  the shell. `app.loadEarly(false)` opts out, `app.loadEarly()` opts in without patching,
  and `app.early` says whether this run loaded the plugin early.
- The first time a component is patched while the app is running (a plugin just enabled),
  Zami says so in a toast with a Reload button; `app.reload()` does the same.
- Code that compares an element's type with a component (`child.type === Foo`) sees the
  slot instead for a patched one.

`elements.intercept(fn)` is the general form: `fn(type, props)` runs for every element
the app creates and may return a `type` or `props` to create it with. It runs thousands of
times per render, so it must decide fast; one that throws is removed.

### Functions and constants

Every name declared at the top level of the app's modules (a function, a class, a
constant, a variable, exported or not) can be read and replaced:

```js
const messages = zami.stores.messages; // or zami.require("$lib/stores/messages.svelte")
// Hide what a muted user sends.
zami.patch.instead(messages, "appendMessage", (args, original) => {
  const [roomId, event] = args;
  if (!muted.has(event.getSender())) return original(roomId, event);
});
zami.patch.after(zam.unsafe.getClient(), "sendMessage", (result, args) => { … });

zami.modules.names("$lib/stores/toasts.svelte"); // ["TOAST_TTL_MS", "showToast", …]
zami.modules.set("$lib/stores/toasts.svelte", "TOAST_TTL_MS", 20_000);
```

`patch.before` may return new arguments, `patch.after` a new result, and `patch.instead`
gets the function it replaces. The object is anything a plugin can reach: a store's
state, the Matrix client, or what `require` returned for an app module. For a module, the
patch replaces the module's own name for the function, so it also applies to the calls
the module makes itself and to functions it doesn't export. `modules.set` does the same
for any value.

How it works: when Metro builds the app, `@-/com.leonsilicon.zami.metro` gives each of
Zam's modules an accessor for its top-level names (and turns a top-level `const` into a
`let`, so that it can be assigned). Nothing runs until a plugin asks. Libraries aren't
compiled this way: `patch` still works on their objects' methods (the Matrix client's),
but not on what they export, which is read-only.

### UI

- `ui.render(el, content)` shows React Native content in any element Zam gave the plugin
  to render into (a popover, a panel, a header button, a link embed), in place of DOM.
- `ui.addLayer(Component)` draws a component over the whole app. It fills the window and
  lets touches through wherever it draws nothing.
- `ui.toast(message, { tone, sticky, action })` shows one of the app's toasts.
  (`zam.ui.notify`, which upstream hasn't wired yet, shows one too.)

Classes (`className`) work where the app itself uses them: its stylesheet is compiled
when the app is built, so `bg-zam-accent` resolves and a utility no file of the app
uses (`pt-16`, say) doesn't. Use classes for the theme's colours and a `style` for the
rest. `require("@-/com.leonsilicon.zami.rn")` has the app's own building blocks (`Html`,
`Image`, `Select`, `Checkbox`, `anchorElement(view)` to anchor a popover to a native
view).

### Stylesheets

`zam.ui.addStyles(css)`, `zam.zami.styles` and the user's Custom CSS all work in the app.

- Custom properties on the root (`:root { --zam-accent-fill-rgb: 232 89 12 }`, or
  under `[data-theme="light"]`) override the theme's variables for as long as the sheet
  exists, over what Zam's own theme code sets.
- A rule for classes (`.bg-zam-backgroundTertiary { background-color: #101010 }`)
  styles every native view with those classes, at once: over its own classes, under its
  inline style, or over both with `!important`.
- Every rule styles the DOM a plugin builds, as in a page, and the `<style>` elements a
  plugin adds count as sheets.

Native views have no ancestors or tags to match (only classes, alone or compounded:
`.a`, `.a.b`), nothing inherits (a `color` on a view doesn't reach its text), and there
are no animations, gradients or filters. `@media` is evaluated; `@keyframes`,
`@font-face` and `@import` are skipped. Class rules hook Uniwind's style resolver
(`css-native.ts`); if a later Uniwind has none, they turn off with a warning and the rest
keeps working.

### Web contexts and Workers

Hermes has no WebAssembly, Workers, canvas or WebGL. A web context is a real web page
(WKWebView / Android WebView) running out of sight that a plugin runs code in:

```js
const page = zami.web.open({ script: "var hits = 0;" });
await page.ready;
const sum = await page.run(
  "const { instance } = await WebAssembly.instantiate(args[0]); return instance.exports.add(2, 3);",
  wasmBytes,
);
page.onMessage((message) => console.log(message)); // the page calls zami.post(message)
page.post({ hello: 1 }); // a `message` event on the page's window
page.dispose();
```

- `open({ html, url, baseUrl, script })`: `html` loads at `baseUrl` (`https://zami.invalid/`
  by default), so the page has an origin; its requests to other sites need CORS. `script`
  runs once the page has loaded, as global code; if it ends in a promise, `ready` waits.
- `run(source, ...args)`: `source` is the body of an async function with one parameter,
  `args`. Arguments and results are copied: JSON values, `undefined`, bigints, Dates,
  Maps, Sets, Errors, ArrayBuffers and typed arrays (megabytes take tens of
  milliseconds). Not functions or Blobs (send `await blob.arrayBuffer()`).
- A context closes when disposed, when the plugin unloads, or when the system ends its
  page's process (`closed`, `onClose`): pending and later `run`s reject.
- The page's `console` output and uncaught errors show in the app's console.

`Worker` (a global in plugin code, and `zami.web.Worker`) is the browser's, each one a
real Web Worker in a page the plugin's workers share:

```js
const worker = new Worker(URL.createObjectURL(new Blob([source])), { type: "module" });
worker.onmessage = (event) => console.log(event.data);
worker.postMessage({ samples: new Float32Array(1024) });
```

The script may be a blob or file URL (`zam.assets.url()`), a `data:` URL or an `http(s):`
URL; the app reads it and the worker runs its text, so import absolute URLs inside it.
Messages are copied both ways (a transfer list is accepted, and copied). A plugin's
workers end when it unloads.

A `<canvas>` in plugin DOM still isn't drawn. To draw, use an `OffscreenCanvas` in a web
context and show the PNG it returns, react-native-svg, or a `WebView` of your own
(`require("react-native-webview")`).

### Native modules

`native.modules`, `native.turbo(name)` and `native.expo(name)` reach the native modules
built into the app. iOS and Android don't load native code at run time, so `zam.native`
(a plugin's own native code, as on Zam's desktop and Android apps) stays unavailable.

### Embedded pages

`zam.frames` works here too (with the `frames` capability): a rule's `script` is injected
into the frames whose URL it names, and its `referrer` becomes the address of the page
that holds the frame. It applies to the YouTube player and to the `<iframe>`s a plugin
builds. On Android a WebView only injects into its top frame, so a script reaches a
plugin's own `<iframe>` there but not the player inside YouTube's page.

## What still can't be done

- A plugin's code runs only while the app is open: iOS and Android run none of the app's
  JavaScript in the background.
- Microphone filters (`zam.audio`) aren't in a call's audio path: calls use LiveKit's
  native audio, and React Native's Web Audio has no AudioWorklet.
- New native code can't be loaded (see Native modules).
- `zam.dom` (Zam's hooks into its own DOM: regions, message elements) finds nothing, as
  the app has no DOM of its own. Patch the component that draws the region instead.

## For the app

- `apps/zami/index.ts` imports `@-/com.leonsilicon.zami.plugins/install` before anything
  renders.
- `apps/zami/root.tsx` awaits `bootEarlyPlugins()` (in `src/lib/plugins/pluginBoot.zami.ts`)
  before it renders Zam's page, wraps the app in `StyleSheetScope`, and renders
  `PluginLayers` and `PluginWebHost` last.
- `@-/com.leonsilicon.zami.metro` compiles the accessors for module names, and resolves
  Uniwind's store for the stylesheets.
- `modules.ts` lists every module of Zam's with `require.context`, so Metro bundles them
  all, including ones the app never loads: each must resolve its imports (`vp run bundle`
  checks). Worker and worklet scripts are left out for that reason.
- Zam's host reaches all of this through `@-/com.leonsilicon.zami.plugins/host`, a module
  with no imports (upstream's tests load the host in jsdom): `hostApi.zami.ts` builds
  `zam.zami` with it, `customCss.zami.ts` sends it stylesheets, `pluginFrames.zami.ts`
  frame rules.
- In development, `__zamiDebug.zami` in the debugger is a `zam.zami`.
