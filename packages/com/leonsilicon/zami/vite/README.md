# @-/com.leonsilicon.zami.vite

A Vite plugin that loads Zam's code the way the Zami app does: every import that lands in
Zam's tree resolves to that file's `.expo.` version, never the upstream file. On top of
that:

- Svelte rune modules (`*.svelte.expo.ts`) are compiled with Svelte's compiler;
- `$app/*` maps to `@-/com.leonsilicon.zami.sveltekit`;
- Zam's Vite `define` (`__APP_VERSION__`) is applied.

The workspace's `vp test` uses it to run upstream's tests (their `.test.expo.ts` copies)
against Zami's files.

```ts
plugins: [zamiExpo({ repoRoot })];
```
