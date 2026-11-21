# @-/com.leonsilicon.zami.configs.patches

Zami's changes to code it doesn't own: upstream Zam (`packages/com/github/az4521/Zam`) and
npm packages. Each change is a [jssg](https://docs.codemod.com/jssg) codemod, the way
Haniverse patches its dependencies, so the change is made again on each new upstream
version instead of being a stored diff that stops applying.

```
codemods/<name>/codemod.ts    the file as upstream has it → the changed file (or null: no change)
codemods/<name>/patch.json    what it patches, and the files it must change ("bundles")
codemods/jssg.ts              editNodes(): exact edits inside syntax nodes jssg selects
```

`patch.json` names one target:

```jsonc
// A source tree in the repository: applied to the copy the web app is built from
// (@-/com.leonsilicon.zami.web). The tree itself stays exactly as upstream has it.
{ "source": "packages/com/github/az4521/Zam", "bundles": ["src/lib/push.ts"] }

// An npm package: turned into a bun patch in patches/ and listed in the root
// package.json's patchedDependencies.
{
  "npmPackage": "react-native-webview",
  "versions": ["14.0.1"],
  "bundles": [{ "path": "apple/RNCWebViewImpl.m", "language": "cpp" }]
}
```

A bundle is a path (its language from its extension) or `{ path, language }` with an
ast-grep language (`cpp` for Objective-C, which tree-sitter-cpp reads as one `ERROR` node).

```sh
vpx _patches check              # every codemod still applies (CI runs this)
vpx _patches generate [<name>]  # regenerate the npm codemods' bun patches
vpx _patches apply <source> <dir>   # apply a source tree's codemods to a copy of it
```

## Writing a codemod

`codemod.ts` default-exports `(root: SgRoot) => string | null`. Prefer `editNodes()` from
`codemods/jssg.ts`: each edit names the node kinds to look in, text the node contains (the
tightest such node is used), the exact text to replace in it, and a marker only the changed
file has. A codemod must be idempotent (an npm package comes back from `bun patch` as last
patched), and must fail loudly when upstream drifts:

- a declared file that's gone, or that a codemod leaves unchanged, fails the build or the
  check, naming the codemod;
- an anchor that isn't found, or is found twice, throws.

Fix the codemod, never Zam's file. Codemods run in `codemod jssg run`'s sandbox: no runtime
imports from the workspace.

## Codemods

- `react-native-webview`: hooks for the shell to serve Zam's web app at an origin of its
  own (iOS: a notification with each web view's configuration, for a URL scheme handler;
  Android: a request interceptor on the WebViewClient).
