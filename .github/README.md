# Zami

Zami is [Zam](https://github.com/az4521/Zam), the Matrix client, ported to Expo and
React Native.

It isn't a GitHub fork. It's Zam's full history, merged from an `upstream` remote, plus
files Zami adds. Every upstream file (code, tests, styles, docs, configs and assets) has
an Expo version next to it, and Zami develops there; the Expo app only loads those.

```
src/lib/stores/toasts.svelte.ts                    upstream
src/lib/stores/toasts.svelte.expo.ts               Zami: a copy, kept in sync by three-way merges
src/lib/components/layout/Splash.svelte            upstream
src/lib/components/layout/Splash.svelte.expo.tsx   Zami: the React Native translation
static/favicon.png, static/favicon.expo.png        upstream, and Zami's copy
apps/zami/                                         Zami: the Expo app
packages/com/leonsilicon/zami/                     Zami: its own code (Flatcap packages)
```

**Zami never edits Zam's files, with two exceptions:** the root `package.json` and
`vite.config.ts` are Zami's, so the repository root is a Flatcap workspace (Bun, Vite+).
Zam's versions keep syncing as `package.expo.json` and `vite.config.expo.ts`, and
`.gitattributes` keeps Zami's two files on every upstream merge. So merging upstream never
conflicts, and a scheduled workflow does the rest:

1. It merges upstream.
2. It merges upstream's changes into the copied Expo files.
3. Claude (Opus 5.5) migrates upstream's changes to the translated components and
   resolves conflicts, checking its work against upstream's own tests.
4. It opens a pull request for review.

## Setup and running

```sh
git remote add upstream https://github.com/az4521/Zam.git   # once per clone
git fetch upstream
vp install
vpx _dev              # iOS simulator: build if needed, install, launch, serve JS
vpx _dev android      # Android emulator or device
vpx _dev start        # only the dev server, for an app that's already installed
```

## Layout

Any code Zami writes that isn't the Expo version of a Zam file goes in a Flatcap package
under `packages/com/leonsilicon/zami/`. A package's `_name.ts` scripts run as
`vpx _name` from anywhere in the repository.

| Path | What it is |
| --- | --- |
| `apps/zami` | The Expo app (`@-apps/zami`) |
| `packages/com/leonsilicon/zami/ports` | `_zami`: maps upstream files to Expo versions, syncs, checks, formats and lints them |
| `packages/com/leonsilicon/zami/metro` | Metro config: resolves only `.expo.` files in Zam's tree; compiles rune modules; handles Vite's build-time features |
| `packages/com/leonsilicon/zami/vite` | The same for Vite, so upstream's tests run against the Expo files |
| `packages/com/leonsilicon/zami/sveltekit` | Stand-ins for `$app/environment`, `$app/navigation` and `$app/state` |
| `packages/com/leonsilicon/zami/svelte-react` | `useRune`: React components re-render when Svelte runes change |
| `packages/com/leonsilicon/zami/dev` | `_dev`: builds, installs and runs the app with its dev server |
| `zami-ports.json` | Which upstream files must have an Expo version (all of them), and the two overrides |
| `zami-ports.lock.json` | The upstream commit each Expo file was last synced with (written by `_zami`) |
| `patches/` | Uniwind patch: Zam's `[data-theme]` themes and `rgb(var(--x-rgb) / a)` colors |
| [`.github/PORTING.md`](./PORTING.md) | How to write and update Expo files |
| [`.github/workflows/zami-upstream-sync.yml`](./workflows/zami-upstream-sync.yml) | The sync bot |

## Checks

```sh
vp check              # Zami's own code: lint, format, types
vp run typecheck
vp run test           # Zami's tooling tests, then upstream Zam's tests against the Expo files
vp run test:zam       # only upstream's tests
vp run check:zam      # Expo files: Prettier with Zam's options, oxlint, `_zami check`
vp run bundle         # bundle the app's JS for iOS and Android with Metro
vpx _zami status      # how many files are ported, stale or missing
```

Vite+ only covers `apps/` and `packages/`. Every other top-level path is Zam's; its
`.expo.` files are formatted and linted by `_zami fmt` and `_zami lint`, which use Zam's
own options so unchanged copies stay byte-identical to upstream. At the root, use
`vp run test` rather than a bare `vp test`, which would pick up Zam's `vitest.config.ts`.

## Upstream's tests

Every upstream test has an Expo copy (`foo.test.expo.ts`), and `vp run test:zam` runs them
against Zami's Expo files: every import, and every `require` of a file in Zam's tree, loads
the `.expo.` version (`@-/com.leonsilicon.zami.vite`), in jsdom as Zam does. So when Zami
changes a copy, or the sync bot migrates one, upstream's own tests check it.

- The 18 tests that render Svelte components are left out until they're rewritten for
  React Native (`componentTestFiles` lists them).
- Two copies are changed to inspect the Expo files rather than upstream's
  (`i18n.test.expo.ts`, `heavyDepImports.test.expo.ts`), because they scan the source
  tree, which now holds both.

Zami is GPL-3.0-or-later, like Zam ([`LICENSE`](../LICENSE)).
