# @-/com.leonsilicon.zami.maestro

`_maestro` runs the Zami app's [Maestro](https://maestro.dev) end-to-end flows
(`apps/zami/.maestro`) on an iOS simulator or Android emulator. Run it from anywhere in
the repository:

```sh
vpx _maestro                    # the suite in config.yaml, on the zami-maestro iOS simulator
vpx _maestro ios smoke toasts   # only these flows
vpx _maestro android            # the connected Android emulator or device
vpx _maestro --device "iPhone Duo" --port 8092 --build --keep-metro
```

It needs Maestro installed (`brew install mobile-dev-inc/tap/maestro`) and Java 17 or
later. For each run it:

1. **Picks the device.** On iOS that's a simulator named `zami-maestro`, which it creates
   (newest iPhone, newest runtime) and boots headless when needed, so a run never takes
   over the simulator you develop on. A simulator the run booted is shut down at the end,
   so `expo run:ios` without `--device` can't pick it. On Android it's the only connected
   device.
   `--device` names another (a UDID or name on iOS, a serial on Android).
2. **Installs the app.** It installs this checkout's newest debug build (Xcode's DerivedData
   for `apps/zami/ios`, or `apps/zami/android/app/build/outputs/apk/debug/app-debug.apk`).
   With no build, it builds one (`expo run:<platform> --no-bundler`). If the device
   already has a copy, it warns and uses that copy instead, which may come from another
   checkout. `--build` always rebuilds.
3. **Serves the JS** from this checkout's Metro on port 8091, not `vpx _dev`'s 8081.
   It reuses a Metro already running there if it serves this checkout, refuses one serving
   another, and otherwise starts one and stops it at the end (`--keep-metro` leaves it
   running). It then bundles the app once, so a bundling error fails the run up front with
   Metro's message.
4. **Runs each flow** in its own `maestro test`, after putting the app back in its
   just-installed state. On iOS that means emptying its data container; on Android,
   `pm clear`. It passes `METRO_HOST=localhost:<port>`. iOS reads it as the
   `RCT_jsLocation` launch argument (see `subflows/launch-app.yaml`). On Android, the
   runner sets the app's `debug_http_host` preference and `adb reverse`s the port.
   If Maestro fails before running a flow's first command (its iOS driver can crash on
   its first start after a cold boot), the runner retries that flow once. A failure
   inside a flow is never retried.

Each run's Metro log, per-flow Maestro output (logs, screenshots, command JSON) and
`report.json` go to `node_modules/.cache/zami/maestro/<platform>-<time>/`. The command
exits non-zero if any flow fails.

The flow-selection logic is covered by `__tests__/` (`vp run test`).
