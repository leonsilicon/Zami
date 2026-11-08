# @-/com.leonsilicon.zami.parity

`_parity` checks that the Zami app looks like upstream Zam, view by view. It renders
each view in Zam's own web build and in the Zami app on two identical iOS simulators,
then compares them. Run it from anywhere in the repository:

```sh
vpx _parity                        # every view in views.ts
vpx _parity room settings-*        # only these (a trailing * matches a prefix)
vpx _parity --update-baseline      # record the current differences as known
vpx _parity --strict               # fail on any difference at all
```

It needs Docker (for the homeserver), Xcode with an iOS simulator runtime, and a debug
simulator build of the app (`--build` makes one from this checkout; without one it uses
the newest build of any checkout, or `--app <path>`).

## How a run works

1. **The reference.** It exports upstream Zam at the commit `zami-ports.lock.json` says
   the Zami files reflect, installs its dependencies with `npm ci` and builds it with its
   own Vite config, plus one module: the web agent (`web.ts`), imported from Zam's
   `src/hooks.client.ts`. That's a copy outside the repository
   (`~/Library/Caches/zami/parity`), so no upstream file is touched. Each step reruns only
   when its inputs change.
2. **The homeserver.** A fresh Synapse in Docker (`zami-parity-synapse`, port 8018), seeded
   by `seed.ts` with the same people, rooms and messages every time: a space with two
   rooms, a room outside it with a pinned message, a direct chat, an unanswered invite,
   and a timeline with formatting, a reply, an edit, reactions, an image, an emote and a
   thread. Alice is the one signed in; presence and URL previews are off, so nothing on
   screen depends on timing.
3. **The apps.** Two simulators, `zami-parity-zam` and `zami-parity-zami`, get the app with
   its data wiped, the same status bar and dark mode. The app's JS comes from this
   checkout's own Metro (port 8092). The launch argument `-ZamiParity` decides what it
   shows (`native.tsx`, debug builds only):
   - `reference`: a WebView with Zam's web build in the safe area, the way Zam lays out on
     a phone, and nothing of Zami's.
   - `native`: the Zami app, with an agent that reads React's tree.
4. **The views.** Both agents connect to the runner (port 8093) and run the same recipes
   (`views.ts`) step by step, in lockstep. Before each view both apps reload and forget
   the room they'd reopen; signed-in views first get a session the runner made for each
   app (both are Alice, each on its own device). Recipes press by visible text or
   accessibility label, the way a person would, or change Zam's stores (`scope.ts`) where
   that's steadier, such as opening a room: both apps run the same store code, so it's
   the same navigation in both.
5. **The comparison.** Once both screens stop changing, the runner takes a screenshot of
   each and asks each agent what it shows (`compare.ts`), inside the safe area:
   - **Nodes:** every text block, every element with an accessibility label (`aria-label`
     / `accessibilityLabel`) and every text field, paired by key and reading order. A
     text that's missing, extra, moved, cut off, wrapped differently, or in another
     color, size or weight is an issue; so is a control that moved or changed size. The
     tolerance is 3 points.
   - **Pixels:** the share of pixels that differ (`pixelmatch`, anti-aliasing ignored).
     The two screens are rendered by the same device, and WebKit draws text with the
     same Core Text Zami's Text does, so matching views come out nearly identical.

   A view **matches** with no issues and at most 0.2% of its pixels different.

## The baseline

`baseline.json` lists each view's known differences: its issues and its share of
differing pixels. A run fails when a view gets worse than that: a new issue, more than
0.3% more pixels differing, a view that can't be shown, or a view the baseline doesn't
know. Fixes show up as `improved`; record them (and accepted changes) with
`--update-baseline`. `--strict` fails on every difference, for when parity is the goal.

## Output

Screenshots, the differences image, both agents' measurements (`nodes.json`) and
`report.html` go to `node_modules/.cache/zami/parity/<time>/`. The report also lists the
translated components no view shows, so the catalog can grow until it covers them all.

## Adding a view

Add a recipe to `views.ts`. Steps run in both apps; `app` (`protocol.ts`'s `Driver`)
presses, long-presses, fills and waits for targets (`{ text }`, `{ label }` or
`{ placeholder }`), and `scope` has Zam's stores. Use `scope.t(…)` for any text Zam
translates, so a recipe follows upstream's wording. If a step works in one app and not
the other, that's a parity bug: the report shows the error for that side.
