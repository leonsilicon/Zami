# @-/com.leonsilicon.zami.metro

The Metro config that builds Zami from Zam's tree:

- Every import that lands in Zam's tree resolves to that file's `.expo.` version, or
  fails with an error naming the missing file.
- `$lib` and `$app/*` resolve to Zam's code and to `@-/com.leonsilicon.zami.sveltekit`.
- `.svelte.expo.ts` rune modules are compiled with Svelte's compiler.
- `import.meta.env`, `__APP_VERSION__` and `import.meta.glob` are rewritten at build
  time, so the copied files don't have to change.

```js
module.exports = withZami(getDefaultConfig(__dirname), { repoRoot });
```
