# @-/com.leonsilicon.zami.metro

The Metro config that builds Zami from Zam's tree:

- Every import that lands in Zam's tree resolves to that file's `.zami.` version, or
  fails with an error naming the missing file.
- `$lib` and `$app/*` resolve to Zam's code and to `@-/com.leonsilicon.zami.sveltekit`.
- `.svelte.zami.ts` rune modules are compiled with Svelte's compiler.
- `import.meta.env`, `__APP_VERSION__` and `import.meta.glob` are rewritten at build
  time, so the copied files don't have to change.
- Each of Zam's modules registers an accessor for the names it declares at its top level
  (`bindings-babel-plugin.js`; a top-level `const` becomes a `let`), which is how a plugin
  replaces any function or constant of the app (`@-/com.leonsilicon.zami.plugins`).
- `uniwind/src/core/native/store`, which Uniwind doesn't export and the plugins'
  stylesheets hook, resolves to its file.

```js
module.exports = withZami(getDefaultConfig(__dirname), { repoRoot });
```
