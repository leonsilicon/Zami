// A physical iPhone as the parity run's stage. Everything goes through Argent, since `simctl`
// only reaches simulators. The app is the "parity" variant, under its own bundle ID: a run
// wipes and signs in its app, and that mustn't be the real Zami on someone's phone.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { cacheDir } from "#reference";

export const DEVICE_APP_ID = "com.leonsilicon.zami.parity";
/** What `expo prebuild` names the project for the variant's app name, "(P) Zami". */
const PROJECT = "PZami";

export interface Phone {
  udid: string;
  name: string;
}

function argent(tool: string, payload: Record<string, unknown>, extra: string[] = []): string {
  return execFileSync("argent", ["run", tool, "--args", JSON.stringify(payload), ...extra], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The cabled iPhone with this name or UDID. */
export function findPhone(nameOrUdid: string): Phone {
  const { devices } = JSON.parse(argent("list-devices", {}, ["--json"])) as {
    devices: { platform: string; kind?: string; udid?: string; name?: string; state: string }[];
  };
  const phones = devices.filter(({ platform, kind }) => platform === "ios" && kind === "device");
  const phone = phones.find(({ udid, name }) => udid === nameOrUdid || name === nameOrUdid);
  if (phone?.udid === undefined || phone.name === undefined) {
    const known = phones.map(({ name }) => name).join(", ") || "none";
    throw new Error(`No iPhone named ${nameOrUdid} (cabled and paired: ${known})`);
  }
  if (phone.state !== "connected") {
    throw new Error(`${phone.name} is ${phone.state}: cable and unlock it`);
  }
  return { udid: phone.udid, name: phone.name };
}

/** This Mac's address on the local network, which the phone reaches the run's servers at. */
export function lanAddress(): string {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!name.startsWith("en")) continue;
    for (const { address, family, internal } of addresses ?? []) {
      if (family === "IPv4" && !internal && !address.startsWith("169.254.")) return address;
    }
  }
  throw new Error("This Mac has no local network address: pass --host");
}

function deviceAppPath(): string {
  return join(cacheDir(), "device", `${PROJECT}.app`);
}

/** The build `--build` made earlier, if there is one. */
export function builtDeviceApp(): string | undefined {
  return existsSync(deviceAppPath()) ? deviceAppPath() : undefined;
}

/**
 * Builds the parity variant for the phone. The native project goes away afterwards, because
 * `apps/zami/ios` belongs to the simulator build, which would otherwise pick up this variant.
 */
export function buildDeviceApp(appDir: string, phone: Phone, log: (line: string) => void): string {
  const expoCli = createRequire(join(appDir, "package.json")).resolve("expo/bin/cli");
  const env = { ...process.env, ZAMI_VARIANT: "parity", CI: "1" };
  const run = (command: string, args: string[]): void => {
    const { status } = spawnSync(command, args, { cwd: appDir, env, stdio: "inherit" });
    if (status !== 0) throw new Error(`${command} ${args[0]} failed (exit code ${status})`);
  };
  log(`Building the parity app for ${phone.name}`);
  run(process.execPath, [expoCli, "prebuild", "--platform", "ios", "--clean"]);
  run("xcodebuild", [
    "-workspace",
    `ios/${PROJECT}.xcworkspace`,
    "-scheme",
    PROJECT,
    "-configuration",
    "Debug",
    "-destination",
    `id=${phone.udid}`,
    "-derivedDataPath",
    "ios/build",
    "-allowProvisioningUpdates",
    "-allowProvisioningDeviceRegistration",
    "build",
  ]);
  const destination = deviceAppPath();
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(join(cacheDir(), "device"), { recursive: true });
  cpSync(join(appDir, `ios/build/Build/Products/Debug-iphoneos/${PROJECT}.app`), destination, {
    recursive: true,
    verbatimSymlinks: true,
  });
  rmSync(join(appDir, "ios"), { recursive: true, force: true });
  return destination;
}

/** Installs the app from nothing, which also wipes what an earlier run left behind. */
export function reinstallOnPhone(phone: Phone, appPath: string): void {
  argent("reinstall-app", { udid: phone.udid, bundleId: DEVICE_APP_ID, appPath });
}

export function launchOnPhone(phone: Phone, launchArgs: string[]): void {
  // `devicectl` sometimes loses track of an app whose old process it has just replaced.
  for (let attempt = 1; ; attempt++) {
    try {
      argent("launch-app", { udid: phone.udid, bundleId: DEVICE_APP_ID, launchArgs });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      execFileSync("sleep", ["2"]);
    }
  }
}

export function phoneScreenshot(phone: Phone): Buffer {
  const file = join(tmpdir(), `zami-parity-${phone.udid}-${process.pid}.png`);
  argent("screenshot", { udid: phone.udid, scale: 1, includeImageInContext: false }, [
    "--out",
    file,
  ]);
  return readFileSync(file);
}
