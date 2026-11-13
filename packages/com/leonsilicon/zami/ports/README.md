# @-/com.leonsilicon.zami.ports

`_zami`, the CLI that keeps the `.zami.` version of every upstream Zam file in step
with upstream. It maps upstream files to their Zami versions, creates and three-way
merges copies, lists the work left for people or the Claude bot, and checks the
invariants CI enforces. See [`.github/PORTING.md`](../../../../../.github/PORTING.md).

```sh
vpx _zami status | sync | diff <file> | done <file>... | remap | check | backlog | editor
```

`@prompts/migrate.md` is the prompt the sync and port workflows give Claude, and
`@prompts/resolve-trunk.md` the sync workflow's, when trunk conflicts with its branch.
