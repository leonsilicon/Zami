# @-/com.leonsilicon.zami.plugins

`zam.zami`: what the Zami app adds to Zam's plugin API.

The app runs Zam's own web app, so a Zam plugin already has the whole browser: the DOM, CSS,
WebAssembly, Workers, canvas, iframes, and Zam's own `zam` API (`zam.dom`, `zam.ui`,
`zam.audio`, …). `zam.zami` adds what Zam doesn't give a plugin:

- every module of the app, and the names each one declares at its top level;
- patches of any of the app's functions or Svelte components, which reach the module's own
  code too;
- Zam's stores, followed with Svelte's runes;
- loading before the app's first render, so a patch reaches everything drawn;
- the app's native side (its Expo modules, and some of React Native's APIs).

Zam itself has no `zam.zami`, so a plugin written for both checks for it:

```js
export default {
  async onload(zam) {
    const zami = zam.zami;
    if (!zami) return; // Zam on the web, the desktop or Android
    // …
  },
};
```

Plugins run with full trust, as in Zam. Everything a plugin adds through `zam.zami` comes off
when the plugin unloads. `@example/` uses most of it: load that folder in Settings > Plugins.

## `zam.zami`

|              |                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `platform`   | `"ios"` or `"android"`.                                                                             |
| `require`    | One of the app's modules that has loaded: `require("$lib/stores/rooms.svelte")`.                    |
| `import`     | One of the app's modules, loaded if it hasn't been (a promise).                                     |
| `modules`    | `list(prefix?)`, `has`, `isLoaded`, and a module's top-level names: `names`, `get`, `set`.          |
| `stores`     | Zam's stores by name: `stores.rooms` is `$lib/stores/rooms.svelte`.                                 |
| `runes`      | `watch(read, onChange)`: calls back whenever what `read` read of a store changes.                   |
| `patch`      | `before`, `after`, `instead` on a function of a module or a method of any object.                   |
| `components` | `list()`, `modules()`, `get`, and the patches: `wrap`, `replace`, `props`, `around`; `dom(render)`. |
| `ui`         | `toast(message, options)`, `addLayer(render)`, `render(target, Component, props)`.                  |
| `styles`     | `add(css)`, `setVariables({ "--zam-accent-fill-rgb": "232 89 12" })`.                               |
| `native`     | `available()`, `modules()`, `call(module, method, ...args)`, `reactNative(api, method, ...args)`.   |
| `web`        | `open(options)`, a page of the plugin's own; `Worker`.                                              |
| `app`        | `early`, `loadEarly(early?)`, `reload()`, and the page the app opens on: `home`.                    |
| `svelte`     | The app's own Svelte: `mount`, `unmount`, `flushSync`, `tick`, `untrack`.                           |

### Modules

Modules are named as Zam's code imports them: `$lib/…` without `.ts`
(`$lib/stores/rooms.svelte` for `src/lib/stores/rooms.svelte.ts`), `$lib/…/X.svelte` for a
component, and `routes/+page.svelte`. Every module Zam's build includes is there, the ones
the app never loads itself too. `require` returns a module the app has already loaded (most
of them, once it has started); `await zami.import(id)` loads it first.

What `require` returns reads the module's live state: its exports, and the names it
doesn't export as well. Setting one (`modules.set`, or a patch) assigns the module's own
binding, so the module's own code sees the new value, and so does every module that imports
it:

```js
const messages = await zami.import("$lib/stores/messages.svelte");
zami.patch.instead(messages, "appendMessage", (args, original) => {
  const [roomId, event] = args;
  if (!muted.has(event.getSender())) return original(roomId, event);
});
zami.modules.names("$lib/stores/toasts.svelte"); // ["TOAST_TTL_MS", "showToast", …]
zami.modules.set("$lib/stores/toasts.svelte", "TOAST_TTL_MS", 20_000);
zami.patch.after(zam.unsafe.getClient(), "sendMessage", (result, args) => { … });
```

`patch.before` may return new arguments, `patch.after` a new result, and `patch.instead`
gets the function it replaces. Several patches of one function compose in the order they
were added, and come off in any order. A hook that throws is logged and skipped.

How it works: when the web app is built, the Vite plugin here (`vite-plugin.ts`) gives each
module under Zam's `src/` an accessor for its top-level names (`instrument.ts`), registered
as the module evaluates; a top-level `const` becomes a `let` so it can be assigned. ES module
bindings are live, and Rollup keeps them so, which is why an assignment reaches importers.

### Components

Zam's components are Svelte 5 components: functions of an anchor node and their props. A
component patch replaces the component module's default export, so every parent that draws
the component from then on draws the patch:

```js
// DOM before or after it.
zami.components.around("ProfileFooter", { after: (el, props) => el.append(myLine) });
// Different props (read as the component reads each one).
zami.components.props("RoomList", (props) => ({ compact: true }));
// Something else in its place: it gets the same props, plus `Original`.
zami.components.replace(
  "Splash",
  zami.components.dom((el) => (el.textContent = "Hi")),
);
// Anything: `wrap(target, (Original) => Component)`.
```

`components.dom(render)` makes a component of a DOM `render(el, props)` (it runs again when a
prop it read changes; return a cleanup). `ui.render(target, Component, props)` draws one of
the app's components (`await components.get("Avatar")`) into a plugin's own DOM.

**A component patch reaches what's drawn after it.** One already on screen keeps what it
was drawn with until its parent draws it again. So a plugin that patches a component
**loads before the app's first render** from the next launch on: it's loaded in Zam's
`init` hook, which SvelteKit awaits before starting the app (`early.ts`, wired in by the
`zam.zami-plugins` codemod). The first time it patches one while the app is running, a
toast offers to reload. `app.loadEarly(false)` opts out, `app.loadEarly()` opts in, and
`app.early` says whether this run loaded the plugin early.

### Home and the launch page

The app doesn't open on Zam's "Restoring session…" splash. It opens on the **launch page**:
the app as it last looked, drawn before the session has started and taken off once the real
shell has drawn the same thing underneath. The composer in it takes typing, and what was
typed is in the real composer when it comes up. Nothing else in it does anything yet.

By default the launch page is where the app was left. A plugin can register a **home**
instead, and from the next launch on the app opens on that room: the launch page shows it,
and Zam lands in it.

```js
// The room this account opens on, until midnight.
zami.app.home.set({ roomId, until: midnight.getTime() });
zami.app.home.get(); // { roomId, spaceId, until, pluginId } or null
zami.app.home.clear();
```

`set` takes `roomId`, `spaceId` (the space to show it in; Zam's own Home when left out) and
`until` (ms since the epoch, after which it stops being the home: without it, a room for one
day would greet the next day's launch). It's per account, and one plugin's at a time: the
last to register. It goes when the plugin clears it or is turned off. A home is where the
app _opens_; taking the user there while the app runs is the plugin's own doing.

The launch page of a home is saved while the app shows that room (when the app is left, and
shortly after it changes), and kept while the user is elsewhere. A launch with no page to
show (the first after signing in, after an update, or after the home changed) shows a
spinner with no text until the shell is up.

How it works (`launch.ts`, `launch-page.ts`): the page is a copy of the app's DOM kept in
IndexedDB (`zami-launch`), with images as data: URLs and everything that wasn't drawn left
out. Zam's regions in it are named `data-zami-launch-region`, so a plugin looking for
`[data-zam-region="app"]` finds the app's own, not the copy. `<html>`'s `data-` attributes
and the page's `<style>` elements are saved with it, so a plugin's styles apply to the copy
before the plugin has loaded. A home is written where Zam keeps the last place it was, which
its rooms store reads as it starts. An account that signs out leaves no page behind.
`performance.getEntriesByType("mark")` has `zami-launch:drawn`, `:shell` and `:dismissed`
next to Zam's own `zam-boot:` marks, and `localStorage.zami_launch_hold = "5000"` keeps the
launch page up that much longer, to look at it.

### Stores and runes

Zam's stores are Svelte 5 runes. Read and assign them as the app does
(`zami.stores.rooms.roomsState.activeRoomId`); `runes.watch(read, onChange)` calls back now
and whenever what `read` read changes.

### Native

`native.call(module, method, ...args)` calls a function of one of the Expo modules built into
the app (`native.modules()` lists them with their functions), through the shell's Zami
plugin (`@-/com.leonsilicon.zami.shell`). `native.reactNative(api, method, ...args)` calls
`Linking`, `Share` or `Vibration`. Arguments and results cross as JSON. iOS and Android don't
load native code at run time, so a plugin can't bring its own (Zam's `zam.native`).

### Web contexts

`web.open({ html, script })` opens a page of the plugin's own, out of sight (an iframe):
`run(source, ...args)` runs the body of an async function of `args` there, `post` and
`onMessage` (the page calls `zami.post(message)`) carry messages, `dispose()` closes it.
Arguments and results are structured clones. The page's code runs from blob: URLs, which
Zam's CSP allows; it allows no inline scripts or `eval`, in the page or in a context.

## For the app

- `@-/com.leonsilicon.zami.web` builds Zam's web app with `zamiPluginsVite()` added to Zam's
  own Vite config: the accessors, `svelte` resolved to Zam's own copy, and
  `@-/com.leonsilicon.zami.plugins/web` resolved to the runtime here.
- The `zam.zami-plugins` codemod (`@-/com.leonsilicon.zami.configs.patches`) imports the
  runtime into Zam's `src/hooks.client.ts`, calls `zamiInit()` in its `init` hook, and has
  Zam's plugin host build `zam.zami` from `globalThis.__zamiHost`.
- `zamiInit()` draws the launch page first, then patches Zam's `Splash`, `LoginView` and
  `AppShell` (to take the text off the splash, and to know which of the three the root page
  drew), then loads the early plugins.
- `__tests__/instrument.test.ts` runs instrumented modules as real ES modules.
