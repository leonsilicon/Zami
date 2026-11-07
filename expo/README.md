# zami-development

The Expo workspace for [Zami](../.github/README.md): the app, and the tooling that
keeps its `.expo.` files in sync with upstream Zam. It's a Flatcap workspace (Bun,
Vite+). It lives in `expo/` because the repository root is Zam's (its `package.json` and
`vite.config.ts`), and Zami never edits Zam's files.

Any code Zami writes that isn't the Expo version of a Zam file (shared helpers, native
glue, scripts) goes in a Flatcap package under `packages/com/leonsilicon/zami/`. A
package's `_name.ts` bin scripts run with `vpx _name` from anywhere in the repository.

| Path                                         | What it is                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/zami`                                  | The Expo app (`@-apps/zami`)                                                                                        |
| `packages/com/leonsilicon/zami/ports`        | `_zami`: maps upstream files to Expo versions, syncs, checks                                                        |
| `packages/com/leonsilicon/zami/metro`        | Metro config: resolves only `.expo.` files in Zam's tree; compiles rune modules; handles Vite's build-time features |
| `packages/com/leonsilicon/zami/sveltekit`    | Stand-ins for `$app/environment`, `$app/navigation` and `$app/state`                                                |
| `packages/com/leonsilicon/zami/svelte-react` | `useRune`: React components re-render when Svelte runes change                                                      |
| `packages/com/leonsilicon/zami/dev`          | `_dev`: builds, installs and runs the app with its dev server                                                       |
| `zami-ports.json`                            | Which upstream files must have an Expo version (all of them)                                                        |
| `zami-ports.lock.json`                       | The upstream commit each Expo file was last synced with (written by `_zami`)                                        |
| `patches/`                                   | Uniwind patch: Zam's `[data-theme]` themes and `rgb(var(--x-rgb) / a)` colors                                       |
| `PORTING.md`                                 | How to write and update Expo files                                                                                  |

## Setup

```sh
git remote add upstream https://github.com/az4521/Zam.git   # once per clone
git fetch upstream
cd expo
vp install
```

## Running the app

From anywhere in the repository:

```sh
vpx _dev              # iOS simulator: build if needed, install, launch, serve JS
vpx _dev android      # Android emulator or device
vpx _dev start        # only the dev server, for an app that's already installed
```

## Checks

```sh
vp check              # this workspace: lint, format, types
vp run typecheck
vp run test           # Zami's tooling tests, then upstream Zam's tests against the Expo files
vp run test:zam       # only upstream's tests (vitest.zam.config.ts)
vp run check:zam      # Expo files in Zam's tree: Prettier with Zam's options, oxlint, `_zami check`
vp run bundle         # bundle the app's JS for iOS and Android with Metro
vpx _zami status      # how many files are ported, stale or missing
```

Zami's tooling only touches Zami's files: this workspace and the `.expo.` files. Zam's
own files are never formatted, linted or edited.

## Upstream's tests

Every upstream test has an Expo copy (`foo.test.expo.ts`), and `vp run test:zam` runs
them against Zami's Expo files: every import, and every `require` of a file in Zam's tree,
loads the `.expo.` version (`@-/com.leonsilicon.zami.vite`), in jsdom as Zam does. So
when Zami changes a copy, or the sync bot migrates one, upstream's own tests check it.

- The 18 tests that render Svelte components are left out until they're rewritten for
  React Native (`componentTestFiles` lists them).
- Two copies are changed to inspect the Expo files rather than upstream's
  (`i18n.test.expo.ts`, `heavyDepImports.test.expo.ts`), because they scan the source
  tree, which now holds both.
