# Porting Zam files to Expo

This is the guide for writing and updating the `.zami.` versions of Zam's files, for
people and for the Claude migration bot alike.

## The rules

- **Never change an upstream file.** Zami is Zam's tree plus files Zami adds. The one
  exception is the root `package.json`, which is Zami's workspace manifest (Bun reads no
  other name; Zam's version keeps syncing as `package.zami.json`). `vpx _zami check` fails
  CI if any other upstream file is modified, deleted or renamed.
- **Every upstream file has a Zami version next to it**: code, tests, styles, docs and
  assets alike, even when it's identical or differs only in formatting. That's what lets
  Zami develop alongside upstream: change the Zami version, never the original. The
  exception is what the Expo app doesn't use: configuration for tooling Zami replaced
  (SvelteKit, Vite, PostCSS, npm's lockfile, Zam's CI and editor settings) and the other
  platforms Expo replaces (Capacitor and its `android/` project, Electron, Flatpak, the
  Windows audio helper in `native/`), along with upstream's tests of Electron's code.
  `exclude` in [`zami-ports.json`](../zami-ports.json) lists them; they get no Zami
  version, and the editor settings hide them.
- **The Expo app only loads Zami versions.** Metro refuses to resolve anything else in
  Zam's tree, and fails with an error naming the missing Zami file.
- **Zami's tooling only touches Zami files** (and Zami's own `apps/` and `packages/`). Zam's own files
  are never formatted, linted or edited.
- **New code that isn't a Zami version of a Zam file** (helpers shared by translations,
  native glue, scripts) goes in a Flatcap package under
  `packages/com/leonsilicon/zami/`, never as a loose file in Zam's tree.

| Upstream file                     | Zami version                                | Kind        |
| --------------------------------- | ------------------------------------------- | ----------- |
| `src/lib/foo.ts`                  | `src/lib/foo.zami.ts`                       | copy        |
| `src/lib/stores/x.svelte.ts`      | `src/lib/stores/x.svelte.zami.ts`           | copy        |
| `src/app.d.ts`                    | `src/app.zami.d.ts`                         | copy        |
| `static/favicon.png`, `README.md` | `static/favicon.zami.png`, `README.zami.md` | copy        |
| `LICENSE`, `.gitignore`           | `LICENSE.zami`, `.gitignore.zami`           | copy        |
| `src/lib/Foo.svelte`              | `src/lib/Foo.svelte.zami.tsx`               | translation |

[`zami-ports.lock.json`](../zami-ports.lock.json) records, for each Zami file, the upstream
commit it was last synced with. Don't edit it by hand: `vpx _zami done <file>` updates it
once a file reflects upstream as merged. Keeping that out of the files means a Zami
version nobody has changed is usually byte-identical to upstream, which git stores only once.

Copies of `.github/workflows/*.yml` are real workflow files to GitHub; Zami disables every
workflow whose name doesn't start with `zami-`.

## Copies

A copy starts as upstream's file. `vpx _zami sync` creates new ones and three-way merges
upstream changes into existing ones, so Zami's edits survive as long as upstream doesn't
change the same lines. Binary files can't be merged: one Zami never changed follows
upstream, and one both sides changed is flagged as a conflict.

- **Prefer not editing copies.** Most of Zam's logic runs unchanged, and Vite and
  SvelteKit features are handled at build time instead:
  - `import.meta.env`, `__APP_VERSION__` and `import.meta.glob` are rewritten by the
    Metro transformer (`@-/com.leonsilicon.zami.metro`).
  - `$app/*` maps to `@-/com.leonsilicon.zami.sveltekit`.
  - `.svelte.zami.ts` rune modules are compiled with Svelte's compiler.
  - `@matrix-org/matrix-sdk-crypto-wasm` maps to `react-native-matrix-sdk-crypto-wasm`.
  - Browser APIs Hermes lacks are polyfilled in `apps/zami/polyfills.ts`.
- **When a copy must differ** (a browser-only API, a Vite query import such as `?url`),
  keep the change small and local, and mark it with a `Zami:` comment saying why. Small
  edits merge cleanly; reformatting or reordering doesn't. The six lines at the top of
  `src/app.zami.css`, which switch the stylesheet to Uniwind, are the example.
- **Formatting:** run `vp fmt` (or `vp check --fix`). Zami files in Zam's tree are
  formatted with Zam's own Prettier options and skip what its `.prettierignore` skips, so
  most unedited copies stay byte-identical to upstream. Oxfmt formats a few constructs
  (some long unions, for one) differently from Prettier, so a few dozen copies differ
  from upstream only there. After a sync, `vp fmt` reformats any new upstream code like
  that.

## Translations (Svelte → React Native)

Write the component so a later upstream diff to the `.svelte` file maps onto it easily:
same order, same names, same branches.

- **Shape.** Default-export a function component named after the file. Props are the
  `$props()` destructuring, with the same names, defaults and types (reuse the `Props`
  interface).
- **Elements.**
  - `div`/`section` → `View`.
  - Any text → `Text`. React Native renders no bare strings.
  - `button` and clickable elements → `Pressable`. `onclick` → `onPress`.
  - `input`/`textarea` → `TextInput`.
  - `img` → `Image`.
- **Accessibility.**
  - `role="switch"` → `accessibilityRole="switch"`.
  - `aria-checked` → `accessibilityState={{ checked }}`.
  - `aria-label` → `accessibilityLabel`.
  - `title` has no equivalent; drop it.
- **Styling.** Keep Zam's Tailwind class strings in `className`. Uniwind compiles Zam's
  own stylesheet (`src/app.zami.css`) and Tailwind config, so Zam's theme colors and
  utilities resolve; `[data-theme="light"]` and `[data-theme="amoled"]` are Uniwind
  themes. React Native differs from the web:
  - A `View` lays out as a column. Where the web element is `flex` (a row), add
    `flex-row`.
  - Text styles don't inherit. Move `text-*`, `font-*` and colors from containers onto
    the `Text` inside.
    A `Text` with no size class is 16px, as unsized text is on the web (React Native's
    own default is 14), and draws in Zam's font (`@-/com.leonsilicon.zami.fonts`).
  - A `ScrollView` grows to fill its parent by default (`flexGrow: 1`), where an
    `overflow-y-auto` element doesn't. Give a sized one (`w-*`, `h-*`, `max-h-*`) without
    `flex-1` the class `grow-0`.
  - There's no `currentColor`. Replace `border-current`/`bg-current` with the color the
    text has.
  - Full-viewport sizing (`100vh`/`100dvh`) → `flex-1`.
  - `hover:`, `cursor-*` and `select-*` do nothing. Keep them if harmless.
  - Uniwind has no `space-x-*`/`space-y-*` (child selectors): use the same `gap-*`. Nor
    does it have `text-start`/`text-end`: `text-start` is a `Text`'s default, so drop it,
    and `text-end` → `text-right`.
  - `grid`/`grid-cols-*` → flex rows (`flex-row`, with `flex-1` or widths on the
    cells), or a column that becomes a row at the breakpoint (`sm:flex-row`).
- **Reactivity.**
  - `$state` → `useState`.
  - `$derived` → a value computed during render (or `useMemo` if it's expensive).
  - `$effect` → `useEffect`.
  - Reading a store's runes → `useRune(() => store.value)` from
    `@-/com.leonsilicon.zami.svelte-react`. It re-renders when what the getter read
    changes, and only that: read down to the values you render
    (`useRune(() => messagesState.byRoom[roomId], [roomId])`, not `messagesState.byRoom`).
    For a `$state` tree Zam mutates in place (`.push`, `obj[key] = …`), use
    `useDeepRune`, which also tracks everything inside the plain objects and arrays it
    returns. Pass the getter's props and state as `deps`.
  - Store functions (`showToast(...)`) are called directly.
- **Bindings.** A child's `$bindable` prop bound by its parent (`bind:open={x}`) becomes
  `open` plus `onOpenChange`; the parent passes both. `bind:this` used to call a child's
  methods becomes a `ref` typed with the child's exported `…Handle` (the child uses
  `useImperativeHandle`). An element a dialog names with `labelledBy` gets that id as
  its `nativeID`.
- **Control flow.**
  - `{#if}` → a conditional.
  - `{#each}` → `.map` with a `key`.
  - `{#snippet}`/`{@render}` → `children` or render-prop props.
- **Imports.** Import other components by their upstream specifier (`./Child.svelte`,
  `$lib/components/ui/ToggleSwitch.svelte`); it resolves to the Zami version. Logic
  imports (`$lib/i18n`, `$lib/stores/…`) stay exactly as upstream wrote them.
- **Icons.** Import them from `lucide-svelte` as upstream does; Metro resolves it to
  `@-/com.leonsilicon.zami.icons`. Icons take `size` and `className`. On the web an icon
  is its parent's text color; here nothing inherits, so give it that color:
  `<X size={16} className="text-discord-textMuted" />`. `fill="currentColor"` fills it in
  that color, as upstream writes it.
- **Overlays.** `Portal` → `Portal` from `@-/com.leonsilicon.zami.rn` (the app root
  renders its `PortalHost`). Use the translated `ModalDialog` and `BottomSheet` as
  upstream does. A backdrop that closes on click → a `Pressable` filling the layer.
- **Animations.** `animate-spin` and `animate-pulse` → `Spin` and `Pulse` from
  `@-/com.leonsilicon.zami.rn` (Uniwind has no keyframe animations): the element's other
  classes go on them, or they wrap the icon that spins.
- **Transitions.** `transition:`/`in:`/`out:` → react-native-reanimated's
  `Animated.View` with `entering`/`exiting` (`fade` → `FadeIn`/`FadeOut`, `scale` →
  `ZoomIn`/`ZoomOut`, `fly` → `SlideInDown`/`SlideOutDown` and the like), keeping
  upstream's duration. Reanimated honors the system's reduced-motion setting, as
  `motionOK()` does.
- **HTML.** `{@html …}` of message or topic HTML → `<Html html={…} />` from
  `@-/com.leonsilicon.zami.rn`, which renders the Matrix spec's allowed tags and drops
  the rest. Keep upstream's calls that build the string (`sanitize(…)`, `withTwemoji(…)`).
  `{@html renderPlainTextWithTwemoji(x)}` and other emoji-only helpers → `<Text>{x}</Text>`:
  iOS draws emoji itself.
- **Images.** `<img src={url}>` → `<Image source={mediaSource(url)} />`, both from
  `@-/com.leonsilicon.zami.rn` (expo-image, with the account's token for authenticated
  Matrix media). Give it an explicit size: React Native images have none of their own.
- **Lists and scrolling.** `overflow-y-auto` containers → `ScrollView`; long lists (the
  timeline, the room list, member lists) → `FlatList`. `bind:this` plus DOM measurement
  or scrolling → a ref, `onLayout`, and the list's `scrollToIndex`/`scrollToOffset`.
- **Inputs.** `bind:value` → state with `value`/`onChangeText`. `onkeydown` for Enter →
  `onSubmitEditing`. Keyboard shortcuts and other desktop-only key handling: leave them
  out with a `// Zami: not ported:` comment.
- **Form controls.** Use these from `@-/com.leonsilicon.zami.rn` (its README lists
  their props) rather than hand-rolling them: `<select>` → `Select`,
  `<input type="checkbox">` (with its `<label>`) → `Checkbox`, `<input type="radio">`
  (with its `<label>`) → `Radio`, `<input type="range">` → `Range`,
  `<details>`/`<summary>` → `Details`, `<video>` → `Video` (`use:rememberVolume` →
  `use={rememberVolume}`; upstream's `videoFrameUrl` → `videoFrameThumbnail`), an inline
  `<svg>` icon (`fill="currentColor"`, or `fill="none" stroke="currentColor"`) →
  `SvgIcon`, `<input type="file">` → `expo-image-picker` or `expo-document-picker` with
  `pickedFile(asset)` for the `File`, `Notification.permission`/`requestPermission()` →
  `notificationPermission()`/`requestNotificationPermission()`, and `confirm()` →
  `await confirmAlert(…)`.
- **DOM-only actions.** `use:focusTrap`, `use:clickOutside`, `use:tooltip` and the like
  have no React Native equivalent: drop them, keeping what they do for touch (a backdrop
  `Pressable` for click-outside).
- **Platform services.** Use Expo modules where Zam uses web APIs: `expo-clipboard`
  (`navigator.clipboard`), `expo-haptics` (`navigator.vibrate`), `expo-image-picker` and
  `expo-document-picker` (`<input type="file">`), `expo-sharing`, `expo-linking`/
  `expo-web-browser` (opening links), `expo-camera`, `expo-location`, `expo-audio`,
  `expo-video` and `react-native-maps`.
- **Layout.** Zam has a mobile layout: `interfaceState.isMobile` and
  `interfaceState.isTouchscreen` choose it. Keep both branches as upstream has them; the
  app sets those flags from the window size (a phone is mobile and a touchscreen). Where
  Zam pads for the safe area (`pb-safe`, `env(safe-area-inset-*)`), use
  `useSafeAreaInsets()` from react-native-safe-area-context.
- **Can't be ported yet** (Web Audio, WebRTC screen sharing, …): render the closest
  React Native equivalent. Leave a short `// Zami: not ported:` comment naming what's
  missing, so the gap is greppable.

## Syncing with upstream

```sh
git fetch upstream && git merge upstream/master   # never conflicts: Zami never edits upstream files
vpx _zami sync --since <previous upstream commit> # copies and merges; lists the rest
vpx _zami diff <zami file>                         # what upstream changed since the file was last synced
vpx _zami done <zami file>...                      # after migrating by hand
vpx _zami check                                    # CI's invariants
```

[`workflows/zami-upstream-sync.yml`](./workflows/zami-upstream-sync.yml) does this on a schedule. It opens a pull
request, and Claude (Opus 5.5) migrates whatever `sync` couldn't: conflicts in copies,
upstream changes to translated components, and components upstream added.

The components that were never ported are a separate backlog. `vpx _zami backlog` lists
the ones ready to port (their child components are done), and
`.github/workflows/zami-port.yml` ports them on request.
