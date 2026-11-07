# Zami

Zami is Zam (a SvelteKit Matrix client) plus a Zami version of every upstream file,
kept next to the original (`foo.ts` → `foo.zami.ts`, `Foo.svelte` → `Foo.svelte.zami.tsx`,
`LICENSE` → `LICENSE.zami`). Read `.github/README.md`, then `.github/PORTING.md`, before
changing anything.

- **Never edit, delete, rename or reformat an upstream file.** That's any file that isn't
  a Zami version and isn't under `apps/`, `packages/`, `patches/`, `.claude/`,
  `.github/workflows/zami-*` or `.github/{README,PORTING}.md`, nor one of Zami's root files
  (`package.json`, which Zami overrides; `vite.config.js`, `bun.lock`, `bunfig.toml`,
  `.gitattributes`, `zami-ports.json`, `zami-ports.lock.json`, and the generated editor
  settings `zami.code-workspace` and `.zed/settings.json`). `vpx _zami check` fails if
  you do.
- Change behavior in the Zami versions. Prefer handling Vite or SvelteKit features in
  `packages/com/leonsilicon/zami/metro` or `.../sveltekit` over editing copied files.
- Code that isn't the Zami version of a Zam file goes in a Flatcap package under
  `packages/com/leonsilicon/zami/` (see the user's Flatcap conventions).
- Run the app with `vpx _dev` (iOS), `vpx _dev android` or `vpx _dev start`.
- Test with `vp run test`: it includes upstream's own tests, run against the
  Zami files. A failing upstream test means the Zami file is wrong, not the test.
- Format Zami files with `vpx _zami fmt` and lint them with `vpx _zami lint`. Never run
  Prettier, oxfmt or oxlint on upstream files.
- After migrating a file to the merged upstream version, run `vpx _zami done <file>`.
  It updates `zami-ports.lock.json`; don't edit that by hand.
