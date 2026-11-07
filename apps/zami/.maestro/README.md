# Maestro flows

End-to-end UI flows for the Zami app, run on a real iOS simulator or Android emulator by
[Maestro](https://maestro.dev). They catch what upstream's jsdom tests can't: code that
crashes on Hermes or React Native, a native module that doesn't link, a screen that never
renders.

## Running

```sh
vpx _maestro                    # the suite (config.yaml) on the zami-maestro iOS simulator
vpx _maestro ios toasts         # one flow
vpx _maestro android            # the connected Android emulator or device
```

The runner (`packages/com/leonsilicon/zami/maestro`, see its README) installs this
checkout's build of the app and serves its JS from this checkout's Metro on port 8091. It
resets the app before every flow, so each flow starts from a fresh install and launches
the app itself. Flow and JS changes need no rebuild; a native change needs a new build
(`vpx _maestro --build`).

CI runs the suite on an Android emulator (`.github/workflows/zami-maestro.yml`) for
every pull request and push to `main`. It uploads each run's logs and failure screenshots
as the `maestro-android` artifact. To run chosen flows there, start the workflow by hand
and list them in its `flows` input.

Bare Maestro works too, against `vpx _dev`'s Metro on 8081, but without the reset:
`maestro test apps/zami/.maestro` (the suite) or `maestro test apps/zami/.maestro/smoke.yaml`.

## Suite

`config.yaml` lists the flows `vpx _maestro` runs by default. For now they cover the
preview root (`apps/zami/root.tsx`). It checks each layer the port depends on, until
Zam's routes replace it:

| flow              | proves                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| `smoke.yaml`      | the bundle loads on Hermes, Zam's i18n resolves strings, Splash renders     |
| `encryption.yaml` | matrix-sdk-crypto-wasm initializes on its wasm2c build and reports versions |
| `toggle.yaml`     | Zam's ToggleSwitch toggles and reports its checked state to accessibility   |
| `toasts.yaml`     | a Svelte rune store drives React; a cold relaunch starts with it empty      |

When the root changes, update the first-screen gate in `subflows/launch-app.yaml`, and
retarget or retire these flows. Flows for Zam's real screens that sign in will need a
Matrix homeserver the runner owns, seeded per flow, like Haniverse's seed server.

Subflows:

- `subflows/launch-app.yaml`: (re)launch the app against the run's Metro and wait for the
  first screen; fails fast on an error screen.
- `subflows/assert-no-error-screen.yaml`: no red box, LogBox error or "can't reach Metro"
  screen.

## Rules that keep flows honest

These come from Haniverse's suite, where they were learned the hard way.

- **A wait must recognize every legitimate state.** Most failures turn out to be a healthy
  app on a screen the wait didn't list. Read the failure screenshot before you touch a
  timeout.
- **Select by `testID` or accessibility label, never by coordinates.** Use visible text
  for labels the user reads.
- **Maestro matches text as a full-string regex.** Escape regex characters, and use `.*`
  where an element's text has more than the part you match.
- **Don't sleep to synchronize.** Wait on the destination with `extendedWaitUntil`.
- **`runFlow` with `when` checks its condition instantly, and a skipped flow reports
  COMPLETED.** Prove that the element exists before branching on it.
- **Set `retryTapIfNoChange: false` on taps that navigate, toggle or count.** Maestro's
  retry taps again when the screen hasn't changed yet, which on a debug build can be
  mid-transition.
- **Put `-e` before the flow file** when running Maestro by hand: after it, the value is
  ignored. A flow's own `env:` block overrides `-e`, so defaults go in a script expression
  (see `launch-app.yaml`).
