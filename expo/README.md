# zami-development

The Expo workspace for [Zami](../.github/README.md): the app, and the tooling that
keeps its `.expo.` files in sync with upstream Zam. It's a Flatcap workspace (Bun,
Vite+). It lives in `expo/` because the repository root is Zam's, and Zami never edits
Zam's files.

| Path                                         | What it is                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/zami`                                  | The Expo app (`@-apps/zami`)                                                                                        |
| `packages/com/leonsilicon/zami/ports`        | `_zami`: maps upstream files to Expo versions, syncs, checks                                                        |
| `packages/com/leonsilicon/zami/metro`        | Metro config: resolves only `.expo.` files in Zam's tree; compiles rune modules; handles Vite's build-time features |
| `packages/com/leonsilicon/zami/sveltekit`    | Stand-ins for `$app/environment`, `$app/navigation` and `$app/state`                                                |
| `packages/com/leonsilicon/zami/svelte-react` | `useRune`: React components re-render when Svelte runes change                                                      |
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

```sh
cd expo/apps/zami
vpx expo run:ios        # or: vpx expo run:android
```

## Checks

```sh
vp check              # this workspace: lint, format, types
vp run typecheck
vp run test
vp run check:zam      # Expo files in Zam's tree: Prettier with Zam's options, oxlint, `_zami check`
vpx _zami status      # how many files are ported, stale or missing
```

Zami's tooling only touches Zami's files: this workspace and the `.expo.` files. Zam's
own files are never formatted, linted or edited.
