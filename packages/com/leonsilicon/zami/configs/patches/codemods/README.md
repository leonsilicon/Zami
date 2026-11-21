# @-/com.leonsilicon.zami.configs.patches.codemods

Zami's jssg codemods, one package each (`<name>/codemod.ts` and `<name>/patch.json`; see
`@-/com.leonsilicon.zami.configs.patches`), and what they share: `editNodes()`, which makes
exact edits inside the syntax nodes jssg selects, skips the ones already made, and throws
when an anchor isn't found once, so upstream drift fails loudly.
