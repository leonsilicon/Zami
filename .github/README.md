# Zami

Zami is [Zam](https://github.com/az4521/Zam), the Matrix client, ported to Expo and
React Native.

It isn't a GitHub fork. It is Zam's full history, merged from an `upstream` remote,
plus files Zami adds. **No upstream file is ever edited.** Every upstream file (code,
tests, styles, docs, configs and assets) has an Expo version next to it, and Zami
develops there. The Expo app only loads those:

```
src/lib/stores/toasts.svelte.ts                    upstream
src/lib/stores/toasts.svelte.expo.ts               Zami: a copy, kept in sync by three-way merges
src/lib/components/layout/Splash.svelte            upstream
src/lib/components/layout/Splash.svelte.expo.tsx   Zami: the React Native translation
static/favicon.png, static/favicon.expo.png        upstream, and Zami's copy
expo/                                              Zami: the Expo app and its tooling
```

Because Zami only adds files, merging upstream never conflicts. A scheduled workflow
does the rest:

1. It merges upstream.
2. It merges upstream's changes into the copied Expo files.
3. Claude (Opus 5.5) migrates upstream's changes to the translated components and
   resolves conflicts.
4. It opens a pull request for review.

- [`expo/README.md`](../expo/README.md): the Expo workspace, and how to run the app.
- [`expo/PORTING.md`](../expo/PORTING.md): the conventions for Expo files, and how
  syncing works.
- [`workflows/zami-upstream-sync.yml`](./workflows/zami-upstream-sync.yml): the sync
  bot.

Zami is GPL-3.0-or-later, like Zam ([`LICENSE`](../LICENSE)).
