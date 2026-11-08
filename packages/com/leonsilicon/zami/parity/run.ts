// `vpx _parity`: renders each view of the catalog (views.ts) in upstream Zam's web build and
// in the Zami app, side by side on two identical iOS simulators, and compares them.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { runDev } from "@-/com.leonsilicon.zami.dev";
import {
  ensureSimulator,
  findBuiltApp,
  install,
  Metro,
  resetApp,
  shutdown,
} from "@-/com.leonsilicon.zami.maestro";
import { Git } from "@-/com.leonsilicon.zami.ports";
import { LAUNCH_ARGS, type Dump, type SeedData, type Side, type ViewInfo } from "#protocol";
import { judge, readBaseline, writeBaseline, type ViewResult } from "#baseline";
import { compareNodes, comparePixels, samePixels } from "#compare";
import { buildReference, cacheDir, referenceCommit, serveReference } from "#reference";
import { writeReport } from "#report";
import { seedHomeserver, signIn } from "#seed";
import { AgentServer, type Hello } from "#server";
import { startSynapse, stopSynapse } from "#synapse";

export const APP_ID = "com.leonsilicon.zami";
export const SIMULATORS: Record<Side, string> = {
  zam: "zami-parity-zam",
  zami: "zami-parity-zami",
};
const SIDES: Side[] = ["zam", "zami"];

export interface ParityOptions {
  /** View names (or prefixes ending in `*`) to run; empty runs them all. */
  views: string[];
  metroPort: number;
  runnerPort: number;
  referencePort: number;
  homeserverPort: number;
  build: boolean;
  /** An app build to install instead of this checkout's newest. */
  app?: string;
  updateBaseline: boolean;
  /** Fail on any difference, not only on what's worse than the baseline. */
  strict: boolean;
  keep: boolean;
  cwd: string;
}

function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

function simctl(args: string[]): string {
  return execFileSync("xcrun", ["simctl", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The newest simulator build of the app in any checkout, for when this one has none. */
function anyBuiltApp(): string | undefined {
  const derivedData = join(homedir(), "Library/Developer/Xcode/DerivedData");
  if (!existsSync(derivedData)) return undefined;
  const apps: { path: string; mtime: number }[] = [];
  for (const entry of readdirSync(derivedData)) {
    const products = join(derivedData, entry, "Build/Products/Debug-iphonesimulator");
    if (!existsSync(products)) continue;
    for (const name of readdirSync(products)) {
      if (!name.endsWith(".app")) continue;
      const path = join(products, name);
      const plist = spawnSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleIdentifier", join(path, "Info.plist")],
        {
          encoding: "utf8",
        },
      ).stdout.trim();
      if (plist === APP_ID) apps.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  return apps.toSorted((a, b) => b.mtime - a.mtime)[0]?.path;
}

function screenshot(udid: string): Buffer {
  const file = join(tmpdir(), `zami-parity-${udid}-${process.pid}.png`);
  simctl(["io", udid, "screenshot", "--type=png", "--mask=black", file]);
  return readFileSync(file);
}

/** Both screens, once each has stopped changing (or after a few tries). */
async function stableScreenshots(udids: Record<Side, string>): Promise<Record<Side, Buffer>> {
  let previous = { zam: screenshot(udids.zam), zami: screenshot(udids.zami) };
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(400);
    const current = { zam: screenshot(udids.zam), zami: screenshot(udids.zami) };
    const settled =
      samePixels(previous.zam, current.zam) && samePixels(previous.zami, current.zami);
    previous = current;
    if (settled) break;
  }
  return previous;
}

function launch(udid: string, side: Side, options: ParityOptions): void {
  simctl([
    "launch",
    "--terminate-running-process",
    udid,
    APP_ID,
    "-RCT_jsLocation",
    `localhost:${options.metroPort}`,
    `-${LAUNCH_ARGS.mode}`,
    side === "zam" ? "reference" : "native",
    `-${LAUNCH_ARGS.runner}`,
    `ws://localhost:${options.runnerPort}`,
    `-${LAUNCH_ARGS.referenceUrl}`,
    `http://localhost:${options.referencePort}/`,
  ]);
}

function selectViews(catalog: ViewInfo[], patterns: string[]): ViewInfo[] {
  if (patterns.length === 0) return catalog;
  const selected = catalog.filter(({ name }) =>
    patterns.some((pattern) =>
      pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
    ),
  );
  const unknown = patterns.filter(
    (pattern) => !pattern.endsWith("*") && !catalog.some(({ name }) => name === pattern),
  );
  if (unknown.length > 0) throw new Error(`No view named ${unknown.join(", ")} (see views.ts)`);
  return selected;
}

/** The translated components (`Foo.svelte.zami.tsx` → `Foo`), for coverage. */
function translatedComponents(root: string): string[] {
  const names: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".svelte.zami.tsx")) {
        names.push(entry.name.slice(0, -".svelte.zami.tsx".length));
      }
    }
  };
  visit(join(root, "src"));
  return names.toSorted();
}

/** Runs the views; returns the process exit code. */
export async function runParity(options: ParityOptions): Promise<number> {
  const root = new Git(options.cwd).root;
  const appDir = join(root, "apps/zami");
  const runDir = join(
    root,
    "node_modules/.cache/zami/parity",
    new Date().toISOString().replaceAll(/[:.]/g, "-"),
  );
  mkdirSync(runDir, { recursive: true });

  const cleanups: (() => void)[] = [];
  const cleanUp = (): void => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      try {
        cleanup();
      } catch {
        // Keep cleaning up.
      }
    }
  };
  const onSignal = (): void => {
    cleanUp();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    // 1. The reference build, served for the WebView.
    const { commit, behind } = referenceCommit(root);
    log(
      `Reference: upstream Zam ${commit.slice(0, 12)}${behind > 0 ? ` (${behind} Zami files were last synced with other commits)` : ""}`,
    );
    const buildDir = buildReference(root, commit, log);
    const reference: Server = await serveReference(buildDir, options.referencePort);
    cleanups.push(() => reference.close());

    // 2. A fresh homeserver with the seeded content.
    log("Starting the parity homeserver");
    const homeserver = await startSynapse(options.homeserverPort, join(cacheDir(), "synapse"));
    if (!options.keep) cleanups.push(stopSynapse);
    const seed: SeedData = await seedHomeserver(homeserver);

    // 3. This checkout's JS, from its own Metro.
    log(`Starting Metro on port ${options.metroPort}`);
    const metro = await Metro.ensure(appDir, options.metroPort, join(runDir, "metro.log"));
    if (!options.keep) cleanups.push(() => metro.stop());
    await metro.prewarm("ios", APP_ID);

    // 4. Two identical simulators with the app, its data wiped.
    const udids = {} as Record<Side, string>;
    for (const side of SIDES) {
      const simulator = ensureSimulator(SIMULATORS[side]);
      udids[side] = simulator.udid;
      if (simulator.booted && !options.keep) cleanups.push(() => shutdown(simulator.udid));
    }
    if (options.build) {
      log("Building the app (expo run:ios --no-bundler)");
      const code = runDev("ios", ["--no-bundler", "--device", udids.zami], options.cwd);
      if (code !== 0) throw new Error(`Building the app failed (exit code ${code})`);
    }
    const app = options.app ?? findBuiltApp(appDir) ?? anyBuiltApp();
    if (app === undefined) throw new Error("No simulator build of the app: pass --build");
    if (!app.startsWith(appDir))
      log(`Using the app built at ${app} (pass --build to build this checkout's)`);
    for (const side of SIDES) {
      install(udids[side], app);
      resetApp(udids[side], APP_ID);
      simctl(["ui", udids[side], "appearance", "dark"]);
      // No permission prompt over a screenshot: grant what Zam's views ask for. (iOS has
      // no way to answer the notification prompt ahead; the agent stops the app asking.)
      for (const service of ["microphone", "photos", "location", "media-library"]) {
        simctl(["privacy", udids[side], "grant", service, APP_ID]);
      }
      simctl([
        "status_bar",
        udids[side],
        "override",
        "--time",
        "9:41",
        "--dataNetwork",
        "wifi",
        "--wifiMode",
        "active",
        "--wifiBars",
        "3",
        "--cellularMode",
        "active",
        "--cellularBars",
        "4",
        "--batteryState",
        "charged",
        "--batteryLevel",
        "100",
      ]);
    }

    // 5. The apps, each connected to the runner.
    const server = await AgentServer.listen(options.runnerPort);
    cleanups.push(() => server.close());
    log("Launching the apps");
    for (const side of SIDES) launch(udids[side], side, options);
    const hellos = {} as Record<Side, Hello>;
    for (const side of SIDES) {
      hellos[side] = await server.connected(side, 0, 180_000);
      for (const note of hellos[side].notes) log(`${side}: ${note}`);
    }
    const catalog = hellos.zami.views;
    if (JSON.stringify(catalog) !== JSON.stringify(hellos.zam.views)) {
      throw new Error("The two apps list different views: the reference build is out of date");
    }
    const views = selectViews(catalog, options.views);

    const both = <T>(
      run: (side: Side) => Promise<T>,
    ): Promise<Record<Side, PromiseSettledResult<T>>> =>
      Promise.allSettled(SIDES.map(run)).then(([zam, zami]) => ({ zam: zam!, zami: zami! }));

    // Before each view: Zam reloads its page, and Zami relaunches. Reloading React Native's
    // JS in place (DevSettings.reload) can crash Fabric, when a view command is dispatched
    // to a surface being torn down; a new process costs about the same.
    const restart = async (): Promise<void> => {
      const generations = { zam: server.generationOf("zam"), zami: server.generationOf("zami") };
      const reloaded = await server.request("zam", { cmd: "reload" }).then(
        () => true,
        () => false,
      );
      if (!reloaded) launch(udids.zam, "zam", options);
      await server.request("zami", { cmd: "forget" }, 10_000).catch(() => {});
      launch(udids.zami, "zami", options);
      for (const side of SIDES) {
        hellos[side] = await server.connected(side, generations[side], 120_000);
      }
    };

    // The safe area, where Zam lays out: only it is compared.
    const frame = hellos.zam.frame;
    const scale = hellos.zam.window.scale;
    const region = {
      x: frame.x * scale,
      y: frame.y * scale,
      width: frame.width * scale,
      height: frame.height * scale,
    };

    const showView = async (view: ViewInfo): Promise<ViewResult> => {
      const started = Date.now();
      const errors: ViewResult["errors"] = {};
      await restart();
      const ready = await both((side) =>
        server.request(side, { cmd: "ready", signedIn: view.signedIn, timeoutMs: 60_000 }, 70_000),
      );
      for (const side of SIDES) {
        const result = ready[side];
        if (result.status === "rejected") {
          errors[side] = `Not ready: ${(result.reason as Error).message}`;
        }
      }
      for (let step = 0; step < view.steps && Object.keys(errors).length === 0; step++) {
        const outcome = await both((side) =>
          server.request(side, { cmd: "step", view: view.name, step, data: seed }),
        );
        for (const side of SIDES) {
          const result = outcome[side];
          if (result.status === "rejected") {
            errors[side] = `Step ${step + 1}: ${(result.reason as Error).message}`;
          }
        }
        // Let what the step opened finish animating before the next one looks for targets.
        await sleep(400);
        await both((side) =>
          server.request(side, { cmd: "settle", quietMs: 300, timeoutMs: 5000 }),
        );
      }
      await both((side) =>
        server.request(side, { cmd: "settle", quietMs: 600, timeoutMs: 15_000 }),
      );
      const shots = await stableScreenshots(udids);
      const dumps = await both((side) => server.request<Dump>(side, { cmd: "dump" }));
      const dump = (side: Side): Dump => {
        const result = dumps[side];
        if (result.status === "fulfilled") return result.value;
        errors[side] ??= `Measuring: ${(result.reason as Error).message}`;
        return { nodes: [] };
      };

      const viewDir = join(runDir, view.name);
      mkdirSync(viewDir, { recursive: true });
      const pixels = comparePixels(shots.zam, shots.zami, region);
      const issues = compareNodes(dump("zam").nodes, dump("zami").nodes, frame);
      writeFileSync(join(viewDir, "zam.png"), shots.zam);
      writeFileSync(join(viewDir, "zami.png"), shots.zami);
      writeFileSync(join(viewDir, "diff.png"), pixels.image);
      writeFileSync(
        join(viewDir, "nodes.json"),
        JSON.stringify({ zam: dump("zam"), zami: dump("zami") }, null, 2),
      );
      return {
        name: view.name,
        pixels: pixels.ratio,
        issues,
        errors,
        components: dump("zami").components ?? [],
        seconds: Math.round((Date.now() - started) / 100) / 10,
      };
    };

    const results: ViewResult[] = [];
    let signedIn = false;
    for (const view of views.toSorted((a, b) => Number(a.signedIn) - Number(b.signedIn))) {
      if (view.signedIn && !signedIn) {
        log("Signing both apps in as alice");
        for (const side of SIDES) {
          const session = await signIn(seed, side === "zam" ? "PARITYZAM" : "PARITYZAMI");
          await server.request(side, { cmd: "session", session });
        }
        signedIn = true;
      }
      log(`View ${view.name}`);
      let result: ViewResult;
      try {
        result = await showView(view);
      } catch (error) {
        // An app that crashed or hung: record the view as failed and start both afresh.
        result = {
          name: view.name,
          pixels: 1,
          issues: [],
          errors: { runner: (error as Error).message },
          components: [],
          seconds: 0,
        };
        for (const side of SIDES) launch(udids[side], side, options);
      }
      results.push(result);
      const errorText =
        Object.keys(result.errors).length > 0 ? `, errors: ${JSON.stringify(result.errors)}` : "";
      log(
        `  ${(result.pixels * 100).toFixed(2)}% of pixels differ, ${result.issues.length} issue(s)${errorText}`,
      );
    }

    const baselinePath = join(import.meta.dirname, "baseline.json");
    const baseline = readBaseline(baselinePath);
    const verdicts = results.map((result) =>
      judge(result, baseline.views[result.name], options.strict),
    );
    if (options.updateBaseline) {
      writeBaseline(baselinePath, commit, results, baseline);
      log(`Updated ${relative(options.cwd, baselinePath)}`);
    }
    const report = writeReport(runDir, {
      commit,
      results,
      verdicts,
      components: translatedComponents(root),
    });
    writeFileSync(
      join(runDir, "report.json"),
      JSON.stringify({ commit, results, verdicts }, null, 2),
    );
    const failed = verdicts.filter((verdict) => verdict.failed);
    log(`Report: ${report}`);
    log(
      failed.length === 0
        ? `All ${results.length} views pass${options.strict ? "" : " (against the baseline)"}`
        : `${failed.length} of ${results.length} views failed: ${failed.map((verdict) => verdict.name).join(", ")}`,
    );
    return failed.length === 0 || options.updateBaseline ? 0 : 1;
  } finally {
    cleanUp();
  }
}
