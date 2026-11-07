# @-/com.leonsilicon.zami.ports

`_zami`, the CLI that keeps the `.expo.` version of every upstream Zam file in step
with upstream. It maps upstream files to their Expo versions, creates and three-way
merges copies, lists the work left for people or the Claude bot, and checks the
invariants CI enforces. See [`expo/PORTING.md`](../../../../../PORTING.md).

```sh
vpx _zami status | sync | diff <file> | done <file>... | check | backlog | fmt | lint
```

`@prompts/migrate.md` is the prompt the sync and port workflows give Claude.
