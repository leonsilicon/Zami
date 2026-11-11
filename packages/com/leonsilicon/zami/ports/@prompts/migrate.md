# Migrate upstream Zam changes into Zami's versions of its files

You're working in Zami: Zam (a SvelteKit Matrix client) plus a Zami version of every
file, kept next to the original. This branch has just merged new upstream Zam
commits, and the mechanical sync already ran:

- `node_modules/.cache/zami/worklist.json` lists the work it couldn't do (the `work` array).
- `node_modules/.cache/zami/summary.md` summarizes what it did.

Read `.github/PORTING.md` first. Every file you write must follow it.

## What to do

Handle every worklist item whose `kind` is `conflict` or `migrate`, and every `port`
item with `"new": true`. Leave other `port` items alone: they're the older porting
backlog, handled separately.

- **conflict:** a three-way merge left `<<<<<<< zami` … `>>>>>>> upstream` markers in a
  copied file. The middle section is upstream as last synced. Resolve each one so the
  file has upstream's new change and still has Zami's deliberate change (usually
  marked `Zami:`). Remove every marker. If the item has `"binary": true`, it's a binary
  file (an image, a font) that both sides changed. Don't try to merge it; list it in
  your report for a person to decide.
- **migrate:** upstream changed a Svelte component whose React Native translation
  exists. Run `vpx _zami diff <zamiPath>` to see upstream's diff since the
  commit the file was last synced with. Apply the equivalent change to the translation, and read the
  whole upstream file when the diff alone isn't clear.
- **port:** upstream added a component. Write its Zami version from scratch.

After finishing each file, run `vpx _zami done <zamiPath>`, for example
`vpx _zami done src/lib/components/ui/Foo.svelte.zami.tsx`. That records it as
synced in `zami-ports.lock.json`; never edit that file by hand.

## Port the rest of upstream's changes

A text merge isn't a port. The worklist's `review` array has every other file upstream
changed between `since` and `upstreamSha`: copies the sync already merged (they have a
`zamiPath`) and files with no Zami version (`exclude` in `zami-ports.json`, or deleted).
The text reaching a copy doesn't mean the app behaves like upstream now, because the
Expo app doesn't run all of Zam's files. Go through all of them, reading each with
`git diff <since> <upstreamSha> -- <upstreamPath>`. Ask what the change does for someone
using Zam, and whether someone using Zami should get the same.

| Upstream                                           | Where that behavior lives in Zami                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static/sw.js` (push handling, notifications)      | There's no service worker. `src/lib/push.zami.ts`, `apps/zami/notifications.ts`, and the gateway in `packages/com/leonsilicon/zami/push-gateway`.                                     |
| `src/app.css` rules on DOM selectors               | The classes in the translated component the rule styles.                                                                                                                              |
| `package.json` dependencies                        | `package.zami.json` isn't what gets installed. A dependency the app uses is in `apps/zami/package.json` and the root `package.json` catalog; run `vp install` after changing them.    |
| `android/**`, `capacitor.config.ts`                | `apps/zami/app.config.ts`, and the stand-in in `packages/com/leonsilicon/zami/capacitor`. `apps/zami/android` is generated.                                                           |
| `vite.config.ts`, `svelte.config.js`               | `packages/com/leonsilicon/zami/{metro,vite,sveltekit}`.                                                                                                                               |
| Copies the app runs (most of `src/lib`)            | The merged code itself: look for what Hermes or React Native lacks (a new browser API, a Vite query import) and handle it as `.github/PORTING.md` says under "When a copy must differ". |
| `electron/**`, `flatpak/**`, `native/**`, CI       | Usually nothing, but a fix for a bug the mobile app can also have (say, in how updates or media are handled) applies there too.                                                     |

- If Zami should get the change, apply it where Zami implements that behavior, in Zami's
  terms. Add tests beside Zami's own code when the behavior is its own.
- If it can't apply, because the platform feature doesn't exist here, say so in your
  report. Where the app is left missing something a user would notice, also add a
  `// Zami: not ported:` comment at the place it would go.
- You needn't read changes to tests (`vp run test:zam` runs them), locale strings,
  changelogs, docs or lockfiles.
- This branch may hold an earlier attempt, so check the code before adding anything.

The `review` array is empty when the worklist comes from the porting workflow.

## Rules

- Only create or edit `.zami.` files and Zami's own code: `apps/`, `packages/`, the root
  `package.json` and `bun.lock`. Never change any other file; CI rejects the pull request
  if you do.
- Keep diffs minimal. Don't reformat or reorganize code you aren't changing.
- Format what you changed: `vp fmt <files>`.
- Run `vp check`, `vpx _zami check`, `vp run typecheck` and `vp run test:zam` at the
  end. `test:zam` runs upstream's own tests against the Zami files, so a failure in a
  test covering a file you changed means the migration is wrong; fix the migration,
  not the test. Fix anything else these report in files you touched.
- Don't commit or push; the workflow does that.

Finish by writing `node_modules/.cache/zami/report.md` for the pull request's reviewers:

- what you migrated, one line per file;
- each upstream change from `review` you carried over: what it does and where it went;
- the `review` changes you left out, grouped, and why each group doesn't apply;
- anything you couldn't migrate or weren't sure about, and why.
