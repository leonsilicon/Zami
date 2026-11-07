// `vpx _maestro`: runs Maestro flows one at a time against the Zami app, each from a fresh
// install state, with the app's JS served by this checkout's Metro.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { runDev } from "@-/com.leonsilicon.zami.dev";
import { Git } from "@-/com.leonsilicon.zami.ports";
import * as android from "#android";
import { resolveFlows, type Flow } from "#flows";
import * as ios from "#ios";
import { Metro } from "#metro";

export const APP_ID = "com.leonsilicon.zami";

export type Platform = "ios" | "android";

export interface MaestroOptions {
  platform: Platform;
  /** Flow names or paths; empty runs the suite in `config.yaml`. */
  flows: string[];
  /** A simulator UDID or name (iOS) or a device serial (Android). */
  device?: string;
  metroPort: number;
  /** Build and install the app before running, even if a build exists. */
  build: boolean;
  /** Leave a Metro this run started running afterwards. */
  keepMetro: boolean;
  cwd: string;
}

interface FlowResult {
  name: string;
  path: string;
  status: "passed" | "failed";
  /** 2 when Maestro's driver failed to start the first time. */
  attempts: number;
  seconds: number;
  output: string;
}

/** Runs the flows; returns the process exit code (0 when every flow passed). */
export async function runMaestro(options: MaestroOptions): Promise<number> {
  const root = new Git(options.cwd).root;
  const appDir = join(root, "apps/zami");
  const suiteDir = join(appDir, ".maestro");
  const flows = resolveFlows(suiteDir, options.flows, options.cwd);
  assertMaestroInstalled();

  const { platform } = options;
  let device: string;
  let bootedSimulator = false;
  if (platform === "ios") {
    const simulator = ios.resolveSimulator(options.device);
    device = simulator.udid;
    bootedSimulator = simulator.booted;
  } else {
    device = android.resolveAndroidDevice(options.device);
  }

  const runDir = join(
    root,
    "node_modules/.cache/zami/maestro",
    `${platform}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
  );
  mkdirSync(runDir, { recursive: true });

  let metro: Metro | undefined;
  const cleanUp = (): void => {
    if (!options.keepMetro) metro?.stop();
    if (bootedSimulator) ios.shutdown(device);
  };
  const onSignal = (): void => {
    cleanUp();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const results: FlowResult[] = [];
  try {
    installApp(platform, device, appDir, options);
    metro = await Metro.ensure(appDir, options.metroPort, join(runDir, "metro.log"));
    console.log(
      metro.owned
        ? `Started Metro on port ${metro.port} (log: ${relative(options.cwd, join(runDir, "metro.log"))})`
        : `Using the Metro already serving this checkout on port ${metro.port}`,
    );
    console.log(`Bundling the app's JS for ${platform}…`);
    await metro.prewarm(platform, APP_ID);

    for (const flow of flows) {
      if (platform === "ios") ios.resetApp(device, APP_ID);
      else android.resetApp(device, APP_ID, metro.port);
      results.push(await runFlow(flow, device, metro.port, runDir));
      writeReport(runDir, platform, device, metro.port, results);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    cleanUp();
  }

  const failed = results.filter((result) => result.status === "failed");
  console.log(
    `\nMaestro on ${platform} (${device}): ${results.length - failed.length} passed, ${failed.length} failed`,
  );
  for (const result of results) {
    const mark = result.status === "passed" ? "✓" : "✗";
    const output = result.status === "failed" ? `  ${relative(options.cwd, result.output)}` : "";
    const retried = result.attempts > 1 ? ", retried" : "";
    console.log(`  ${mark} ${result.name} (${result.seconds}s${retried})${output}`);
  }
  console.log(`Report: ${relative(options.cwd, join(runDir, "report.json"))}`);
  return failed.length === 0 ? 0 : 1;
}

function assertMaestroInstalled(): void {
  const result = spawnSync("maestro", ["--version"], { stdio: "ignore" });
  if (result.error !== undefined) {
    throw new Error(
      "Maestro isn't installed: see https://docs.maestro.dev/getting-started/installing-maestro (e.g. `brew install mobile-dev-inc/tap/maestro`).",
    );
  }
}

/**
 * Installs this checkout's build of the app, building it first with `--build` or when the
 * device has no copy at all. Without a build of its own, a run uses whatever copy is
 * installed, which may come from another checkout.
 */
function installApp(
  platform: Platform,
  device: string,
  appDir: string,
  options: MaestroOptions,
): void {
  const isInstalled = (): boolean =>
    platform === "ios" ? ios.isInstalled(device, APP_ID) : android.isInstalled(device, APP_ID);
  const build = (): void => {
    console.log(`Building and installing the app (expo run:${platform} --no-bundler)`);
    const code = runDev(platform, ["--no-bundler", "--device", device], options.cwd);
    if (code !== 0 || !isInstalled()) throw new Error(`Building the app for ${platform} failed`);
  };

  if (options.build) return build();
  const built = platform === "ios" ? ios.findBuiltApp(appDir) : android.findBuiltApk(appDir);
  if (built !== undefined) {
    console.log(`Installing ${built}`);
    if (platform === "ios") ios.install(device, built);
    else android.install(device, built);
  } else if (isInstalled()) {
    console.warn(
      `warning: this checkout has no ${platform} build of the app, so the run uses the copy already installed on ${device}. Pass --build to build this checkout's.`,
    );
  } else {
    build();
  }
}

async function runFlow(
  flow: Flow,
  device: string,
  metroPort: number,
  runDir: string,
): Promise<FlowResult> {
  // Maestro's debug log (maestro.log), screenshots and command JSON go here too.
  const output = join(runDir, flow.name);
  mkdirSync(output, { recursive: true });
  const log = createWriteStream(join(output, "output.log"));
  const started = Date.now();
  console.log(`\n▶ ${flow.name}`);
  // `-e` only applies when it comes before the flow file.
  const args = [
    "--device",
    device,
    "--no-ansi",
    "test",
    "-e",
    `METRO_HOST=localhost:${metroPort}`,
    `--debug-output=${output}`,
    "--flatten-debug-output",
    `--test-output-dir=${output}`,
    flow.path,
  ];
  let attempts = 1;
  let result = await runMaestroTest(args, log);
  // Maestro prints every command it runs ("Tap on …... COMPLETED"). Failing before the
  // first one means its driver didn't start (it can crash on its first launch on a freshly
  // booted simulator), not that the app failed: that's worth one retry.
  if (result.code !== 0 && !/\.\.\. (?:COMPLETED|FAILED)\s*$/m.test(result.stdout)) {
    console.log(`Maestro failed before running ${flow.name}'s first command; retrying once`);
    attempts = 2;
    result = await runMaestroTest(args, log);
  }
  const { code } = result;
  log.end();
  return {
    name: flow.name,
    path: flow.path,
    status: code === 0 ? "passed" : "failed",
    attempts,
    seconds: Math.round((Date.now() - started) / 1000),
    output,
  };
}

function runMaestroTest(
  args: string[],
  log: NodeJS.WritableStream,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("maestro", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        log.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ code: exitCode ?? 1, stdout }));
  });
}

function writeReport(
  runDir: string,
  platform: Platform,
  device: string,
  metroPort: number,
  flows: FlowResult[],
): void {
  writeFileSync(
    join(runDir, "report.json"),
    `${JSON.stringify({ platform, device, metroPort, flows }, null, 2)}\n`,
  );
}
