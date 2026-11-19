# Resolve conflicts from merging trunk into the upstream sync branch

You're working in Zami: Zam (a SvelteKit Matrix client) plus a Zami version of every
file, kept next to the original. This is the `zami/upstream-sync` branch, where earlier
runs migrated upstream Zam's changes into the Zami files. The workflow has just merged
`origin/trunk` into it, and some files conflict: trunk changed the same Zami code since
this branch started. The merge isn't committed yet. The conflicted files are listed in
the file the task names.

Read `.github/PORTING.md` first. Every file you write must follow it.

## What to do

In each conflicted file, the section after `<<<<<<< HEAD` is this branch: upstream's
changes, migrated. The section before `>>>>>>> origin/trunk` is trunk's version. Trunk's
changes are deliberate Zami work (performance, fixes, features). Upstream's are features
and fixes Zami has to keep up with. **Keep both.** Write each section so it has
upstream's behavior in trunk's structure. Don't pick one side wholesale.

- Read the history of each side to see what it was for: `git log --oneline
  MERGE_HEAD -- <file>` and `git log --oneline HEAD -- <file>`, and `git show <commit>`
  for a commit whose purpose isn't clear from the conflict.
- Where trunk restructured code that upstream then changed (say, trunk moved a setting
  read into a shared row state, and upstream added a condition to it), apply upstream's
  change to trunk's new structure.
- Code outside the markers can depend on either side: a new helper, an import, a hook's
  dependency list. Check that the merged section's names exist and its imports are
  there, and that nothing the other side removed is still used.
- Remove every marker (`<<<<<<<`, `=======`, `>>>>>>>`).
- `bun.lock`: keep trunk's (the section before `>>>>>>> origin/trunk`); the workflow's
  install brings it up to date.

## Rules

- Only edit the conflicted files, unless a resolution needs a matching change somewhere
  else in Zami's own code (`.zami.` files, `apps/`, `packages/`). Never edit any other
  file.
- Keep diffs minimal. Don't reformat or reorganize code you aren't changing.
- Dependencies aren't installed yet, so don't run `vp`, `vpx` or `bun`. The workflow's
  later steps type-check and test the result.
- Don't stage, commit, push or abort the merge; the workflow does that.

Finish with a short summary of each conflict and how you combined the two sides.
