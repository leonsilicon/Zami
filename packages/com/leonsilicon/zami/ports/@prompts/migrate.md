# Migrate upstream Zam changes into Zami's Expo files

You're working in Zami: Zam (a SvelteKit Matrix client) plus an Expo version of every
file, kept next to the original. This branch has just merged new upstream Zam
commits, and the mechanical sync already ran:

- `node_modules/.cache/zami/worklist.json` lists the work it couldn't do (the `work` array).
- `node_modules/.cache/zami/summary.md` summarizes what it did.

Read `.github/PORTING.md` first. Every file you write must follow it.

## What to do

Handle every worklist item whose `kind` is `conflict` or `migrate`, and every `port`
item with `"new": true`. Leave other `port` items alone: they're the older porting
backlog, handled separately.

- **conflict:** a three-way merge left `<<<<<<< expo` … `>>>>>>> upstream` markers in a
  copied file. The middle section is upstream as last synced. Resolve each one so the
  file has upstream's new change and still has Zami's deliberate change (usually
  marked `Zami:`). Remove every marker. If the item has `"binary": true`, it's a binary
  file (an image, a font) that both sides changed. Don't try to merge it; list it in
  your report for a person to decide.
- **migrate:** upstream changed a Svelte component whose React Native translation
  exists. Run `vpx _zami diff <expoPath>` to see upstream's diff since the
  commit the file was last synced with. Apply the equivalent change to the translation, and read the
  whole upstream file when the diff alone isn't clear.
- **port:** upstream added a component. Write its Expo version from scratch.

After finishing each file, run `vpx _zami done <expoPath>`, for example
`vpx _zami done src/lib/components/ui/Foo.svelte.expo.tsx`. That records it as
synced in `zami-ports.lock.json`; never edit that file by hand.

## Rules

- Only create or edit `.expo.` files, and Zami's own code under `apps/` and `packages/`. Never change any other
  file; CI rejects the pull request if you do.
- Keep diffs minimal. Don't reformat or reorganize code you aren't changing.
- Format what you changed: `vpx _zami fmt <files>`.
- Run `vpx _zami check`, `vp run typecheck` and `vp run test:zam` at the
  end. `test:zam` runs upstream's own tests against the Expo files, so a failure in a
  test covering a file you changed means the migration is wrong; fix the migration,
  not the test. Fix anything else these report in files you touched.
- Don't commit or push; the workflow does that.

Finish by writing `node_modules/.cache/zami/report.md` for the pull request's reviewers:

- what you migrated, one line per file;
- anything you couldn't migrate or weren't sure about, and why.
