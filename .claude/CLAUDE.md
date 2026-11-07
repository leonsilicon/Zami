# Zami

Zami is Zam (a SvelteKit Matrix client) plus an Expo version of every upstream file,
kept next to the original (`foo.ts` → `foo.expo.ts`, `Foo.svelte` → `Foo.svelte.expo.tsx`,
`LICENSE` → `LICENSE.expo`). Read `.github/README.md`, then `expo/PORTING.md`, before
changing anything.

- **Never edit, delete, rename or reformat an upstream file.** That's any file that isn't
  an Expo version and isn't under `expo/`, `.github/workflows/zami-*`, `.github/README.md`
  or `.claude/`. `vpx _zami check` (from `expo/`) fails if you do.
- Change behavior in the Expo versions. Prefer handling Vite or SvelteKit features in
  `expo/packages/com/leonsilicon/zami/metro` or `.../sveltekit` over editing copied files.
- Code that isn't the Expo version of a Zam file goes in a Flatcap package under
  `expo/packages/com/leonsilicon/zami/` (see the user's Flatcap conventions).
- Run the app with `vpx _dev` (iOS), `vpx _dev android` or `vpx _dev start`.
- Format Expo files with `vpx _zami fmt` and lint them with `vpx _zami lint`. Never run
  Prettier, oxfmt or oxlint on upstream files.
- After migrating a file to the merged upstream version, run `vpx _zami done <file>`.
  It updates `expo/zami-ports.lock.json`; don't edit that by hand.
