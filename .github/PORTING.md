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
version nobody has changed is byte-identical to upstream, which git stores only once.

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
- **Formatting** (`vpx _zami fmt`) runs Prettier on each Zami file exactly as Zam formats
  its upstream original: Zam's options, the parser for the upstream file name, and Zam's
  ignore files. So an unedited copy stays byte-identical to upstream.

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
  - There's no `currentColor`. Replace `border-current`/`bg-current` with the color the
    text has.
  - Full-viewport sizing (`100vh`/`100dvh`) → `flex-1`.
  - `hover:`, `cursor-*` and `select-*` do nothing. Keep them if harmless.
- **Reactivity.**
  - `$state` → `useState`.
  - `$derived` → a value computed during render (or `useMemo` if it's expensive).
  - `$effect` → `useEffect`.
  - Reading a store's runes → `useRune(() => store.value)` from
    `@-/com.leonsilicon.zami.svelte-react`.
  - Store functions (`showToast(...)`) are called directly.
- **Control flow.**
  - `{#if}` → a conditional.
  - `{#each}` → `.map` with a `key`.
  - `{#snippet}`/`{@render}` → `children` or render-prop props.
- **Imports.** Import other components by their upstream specifier (`./Child.svelte`,
  `$lib/components/ui/ToggleSwitch.svelte`); it resolves to the Zami version. Logic
  imports (`$lib/i18n`, `$lib/stores/…`) stay exactly as upstream wrote them.
- **Can't be ported yet** (DOM measurement, portals, Web Audio, …): render the closest
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
