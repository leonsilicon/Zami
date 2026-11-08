// The iOS simulator side of a run: picking (or creating) the simulator, installing the app
// and wiping its state between flows.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The simulator runs use unless `--device` names another; created on first use. */
export const SIMULATOR_NAME = "zami-maestro";

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

interface SimRuntime {
  identifier: string;
  platform: string;
  version: string;
  isAvailable: boolean;
  supportedDeviceTypes: { identifier: string; productFamily: string }[];
}

function simctl(args: string[]): string {
  return execFileSync("xcrun", ["simctl", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listDevices(): SimDevice[] {
  const { devices } = JSON.parse(simctl(["list", "devices", "-j"])) as {
    devices: Record<string, SimDevice[]>;
  };
  return Object.values(devices)
    .flat()
    .filter((device) => device.isAvailable);
}

/** Creates a simulator named `name`: the newest iPhone on the newest iOS runtime. */
function createSimulator(name = SIMULATOR_NAME): string {
  const { runtimes } = JSON.parse(simctl(["list", "runtimes", "-j"])) as {
    runtimes: SimRuntime[];
  };
  const runtime = runtimes
    .filter((candidate) => candidate.platform === "iOS" && candidate.isAvailable)
    .toSorted((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .at(-1);
  const deviceType = runtime?.supportedDeviceTypes
    .filter((type) => type.productFamily === "iPhone")
    .at(-1);
  if (runtime === undefined || deviceType === undefined) {
    throw new Error(
      "No iOS simulator runtime with an iPhone is installed (Xcode → Settings → Components).",
    );
  }
  console.log(`Creating the ${name} simulator (${deviceType.identifier}, iOS ${runtime.version})`);
  return simctl(["create", name, deviceType.identifier, runtime.identifier]).trim();
}

export interface Simulator {
  udid: string;
  /** Whether this run booted it (and so shuts it down). */
  booted: boolean;
}

/**
 * The simulator to test on, booted: `device` (a UDID or name) if given, otherwise the
 * `zami-maestro` simulator, so a run never disturbs a simulator in use for development.
 */
export function resolveSimulator(device: string | undefined): Simulator {
  if (device === undefined) return ensureSimulator(SIMULATOR_NAME);
  const matches = listDevices().filter(
    (candidate) => candidate.udid === device || candidate.name === device,
  );
  const match = matches.find((candidate) => candidate.state === "Booted") ?? matches[0];
  if (match === undefined) {
    throw new Error(`No iOS simulator ${device} (see \`xcrun simctl list devices\`)`);
  }
  return boot(match.udid);
}

/** The simulator named `name`, created (see createSimulator) if missing, booted. */
export function ensureSimulator(name: string): Simulator {
  const udid =
    listDevices().find((candidate) => candidate.name === name)?.udid ?? createSimulator(name);
  return boot(udid);
}

function boot(udid: string): Simulator {
  const booted = listDevices().find((candidate) => candidate.udid === udid)?.state !== "Booted";
  if (booted) {
    console.log(`Booting simulator ${udid}`);
    simctl(["boot", udid]);
  }
  simctl(["bootstatus", udid, "-b"]);
  return { udid, booted };
}

/**
 * Shuts down a simulator a run booted, so `expo run:ios` without `--device` never picks
 * it over the one you develop on.
 */
export function shutdown(udid: string): void {
  spawnSync("xcrun", ["simctl", "shutdown", udid]);
}

export function isInstalled(udid: string, bundleId: string): boolean {
  return spawnSync("xcrun", ["simctl", "get_app_container", udid, bundleId]).status === 0;
}

/** This checkout's newest simulator build of the app (Xcode's DerivedData), if any. */
export function findBuiltApp(appDir: string): string | undefined {
  const derivedData = join(homedir(), "Library/Developer/Xcode/DerivedData");
  if (!existsSync(derivedData)) return undefined;
  const workspacePrefix = join(appDir, "ios") + "/";
  const builds: { path: string; mtime: number }[] = [];
  for (const entry of readdirSync(derivedData)) {
    const infoPlist = join(derivedData, entry, "info.plist");
    if (!existsSync(infoPlist)) continue;
    const workspace = spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :WorkspacePath", infoPlist],
      { encoding: "utf8" },
    ).stdout.trim();
    if (!workspace.startsWith(workspacePrefix)) continue;
    const products = join(derivedData, entry, "Build/Products/Debug-iphonesimulator");
    if (!existsSync(products)) continue;
    for (const app of readdirSync(products).filter((name) => name.endsWith(".app"))) {
      const path = join(products, app);
      builds.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  return builds.toSorted((a, b) => b.mtime - a.mtime)[0]?.path;
}

export function install(udid: string, appPath: string): void {
  simctl(["install", udid, appPath]);
}

/**
 * Puts the app back in its just-installed state: stops it and empties its data container
 * (Documents, Library, tmp). Maestro's own `clearState` reinstalls the app on iOS instead.
 */
export function resetApp(udid: string, bundleId: string): void {
  spawnSync("xcrun", ["simctl", "terminate", udid, bundleId]);
  const container = simctl(["get_app_container", udid, bundleId, "data"]).trim();
  for (const dir of ["Documents", "Library", "tmp"]) {
    const path = join(container, dir);
    if (!existsSync(path)) continue;
    for (const entry of readdirSync(path)) {
      rmSync(join(path, entry), { recursive: true, force: true });
    }
  }
}
