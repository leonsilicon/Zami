import { execFile, execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { appDir as zamiAppDir, repoRoot } from "@-/com.leonsilicon.zami.paths";
import {
  SCREENSHOT_APP_ID,
  SCREENSHOT_SCHEME,
  screenshotLink,
  screenshotScenes,
} from "@-/com.leonsilicon.zami.plugins/screenshots";
import { buildWeb } from "@-/com.leonsilicon.zami.web";

export const screenshotTargets = {
  iphone: {
    models: ["iPhone 18 Pro", "iPhone 17 Pro"],
    width: 1206,
    height: 2622,
  },
  ipad: {
    models: ["iPad Pro 13-inch (M5)", "iPad Pro 13-inch (M4)"],
    width: 2064,
    height: 2752,
  },
} as const;
export type ScreenshotTarget = keyof typeof screenshotTargets;

interface Device {
  name: string;
  udid: string;
  platform: string;
  kind?: string;
  state: string;
}

const exec = promisify(execFile);

async function argent<Result>(tool: string, args = {}): Promise<Result> {
  try {
    const { stdout } = await exec(
      "argent",
      ["run", tool, "--args", JSON.stringify(args), "--json"],
      {
        timeout: 90_000,
      },
    );
    const result = JSON.parse(stdout) as Result & { error?: unknown };
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result;
  } catch (error) {
    const detail = error as Error & { stderr?: string; killed?: boolean };
    throw new Error(
      `Argent ${tool} failed: ${detail.killed ? "timed out waiting for the simulator" : detail.stderr?.trim() || detail.message}`,
      {
        cause: error,
      },
    );
  }
}

function run(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function buildSimulatorApp(appDir: string): string {
  const workspace = join(appDir, "ios", "Zami.xcworkspace");
  const iosProject = join(appDir, "ios", "Zami.xcodeproj");
  if (!existsSync(workspace)) {
    if (existsSync(join(appDir, "ios")) && !existsSync(iosProject))
      throw new Error(
        "The generated iOS project is not Zami. Pass --app with a release simulator build.",
      );
    run("vpx", ["expo", "prebuild", "--platform", "ios"], appDir);
  }
  const derivedData = join(appDir, ".build", "screenshot-native");
  run("xcodebuild", [
    "-workspace",
    workspace,
    "-scheme",
    "Zami",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    derivedData,
    "CODE_SIGNING_ALLOWED=NO",
    "-quiet",
    "build",
  ]);
  return join(derivedData, "Build", "Products", "Release-iphonesimulator", "Zami.app");
}

function simulatorCopy(source: string, directory: string, assets: string): string {
  const sourceInfo = join(source, "Info.plist");
  const info = (key: string) =>
    execFileSync("plutil", ["-extract", key, "raw", sourceInfo], { encoding: "utf8" }).trim();
  if (
    !existsSync(join(source, "main.jsbundle")) ||
    info("CFBundleSupportedPlatforms.0") !== "iPhoneSimulator" ||
    !["com.leonsilicon.zami", "com.leonsilicon.zami.staging"].includes(info("CFBundleIdentifier"))
  ) {
    throw new Error("--app must point to a Zami Release build for iOS Simulator");
  }
  const app = join(directory, "Zami Screenshots.app");
  cpSync(source, app, { recursive: true, verbatimSymlinks: true });
  const plist = join(app, "Info.plist");
  const commands = [
    `Set :CFBundleIdentifier ${SCREENSHOT_APP_ID}`,
    "Set :CFBundleDisplayName Zami Screenshots",
    "Delete :CFBundleURLTypes",
    "Add :CFBundleURLTypes array",
    "Add :CFBundleURLTypes:0 dict",
    "Add :CFBundleURLTypes:0:CFBundleURLSchemes array",
    `Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string ${SCREENSHOT_SCHEME}`,
  ];
  run("/usr/libexec/PlistBuddy", [...commands.flatMap((command) => ["-c", command]), plist]);

  const bundled = join(app, "zami-web");
  rmSync(bundled, { recursive: true, force: true });
  cpSync(assets, bundled, { recursive: true });
  run("codesign", ["--force", "--sign", "-", app]);
  return app;
}

function saveScreenshot(image: string, output: string, target: ScreenshotTarget): void {
  const { width, height } = screenshotTargets[target];
  const dimensions = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", image], {
    encoding: "utf8",
  });
  const actualWidth = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]);
  const actualHeight = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
  if (actualWidth !== width || actualHeight !== height)
    throw new Error(
      `Expected a portrait ${width}×${height} capture for ${target}, got ${actualWidth}×${actualHeight}`,
    );
  execFileSync("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "96",
    image,
    "--out",
    output,
  ]);
}

const openPrompt = "Open in “Zami Screenshots”?";
const openButtonFrame = /^  AXButton "Open"[^\n]*\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)$/m;

async function confirmCaptureLink(udid: string): Promise<boolean> {
  // A fresh iOS simulator can ask whether to open the custom scheme. Make
  // sure the prompt belongs to our isolated app before using the AX frame.
  const { description } = await argent<{ description: string }>("describe", { udid });
  if (!description.includes(openPrompt)) return false;
  const frame = description.match(openButtonFrame);
  if (!frame) throw new Error("The Zami Screenshots confirmation has no accessible Open button");
  const [left, top, width, height] = frame.slice(1).map(Number);
  await argent("gesture-tap", { udid, x: left! + width! / 2, y: top! + height! / 2 });
  return true;
}

async function captureOnDevice(
  app: string,
  device: Device,
  target: ScreenshotTarget,
  directory: string,
) {
  const { udid } = device;
  console.log(`Capturing ${target} on ${device.name}`);
  if (device.state !== "Booted") await argent("boot-device", { udid, headless: true });
  console.log(`Installing Zami Screenshots on ${device.name}`);
  await argent("reinstall-app", { udid, bundleId: SCREENSHOT_APP_ID, appPath: app });
  try {
    await argent("launch-app", { udid, bundleId: SCREENSHOT_APP_ID });
    for (const [index, scene] of screenshotScenes.entries()) {
      console.log(`Opening ${scene.id} on ${target}`);
      await argent("open-url", { udid, url: screenshotLink(scene.id) });
      await confirmCaptureLink(udid);
      const waitForScene = (timeoutMs: number) =>
        argent<{ success: boolean; note?: string }>("await-ui-element", {
          udid,
          bundleId: SCREENSHOT_APP_ID,
          condition: "visible",
          selector: scene.ready,
          timeoutMs,
        });
      let ready = await waitForScene(12_000);
      if (!ready.success) {
        await confirmCaptureLink(udid);
        ready = await waitForScene(25_000);
      }
      if (!ready.success)
        throw new Error(
          `Could not open ${scene.id} on ${target}: ${ready.note ?? "screen never appeared"}`,
        );
      const idle = await argent<{ settled: boolean }>("await-screen-idle", {
        udid,
        minStableMs: 500,
        timeoutMs: 6_000,
      });
      if (!idle.settled) throw new Error(`${scene.id} on ${target} did not finish rendering`);
      const { image } = await argent<{ image: string }>("screenshot", {
        udid,
        scale: 1,
        includeImageInContext: false,
      });
      const output = join(directory, `${String(index + 1).padStart(2, "0")}-${scene.id}.jpg`);
      saveScreenshot(image, output, target);
      console.log(output);
    }
  } finally {
    await argent("button", { udid, button: "home" }).catch((error: unknown) => {
      console.warn(`Could not leave the screenshot app on ${device.name}: ${String(error)}`);
    });
  }
}

export async function captureScreenshots(options: {
  targets: ScreenshotTarget[];
  app?: string;
  out?: string;
  devices: Record<ScreenshotTarget, string | undefined>;
}) {
  if (process.platform !== "darwin") throw new Error("Screenshot capture requires macOS and Xcode");
  const root = repoRoot();
  const appDir = zamiAppDir(root);
  const { devices } = await argent<{ devices: Device[] }>("list-devices");
  const selected = options.targets.map((target) => {
    const explicit = options.devices[target];
    const models: readonly string[] = screenshotTargets[target].models;
    const matches = devices.filter(
      (device) =>
        device.platform === "ios" &&
        device.kind !== "device" &&
        (explicit
          ? explicit === device.name || explicit === device.udid
          : models.includes(device.name)),
    );
    const device = matches.find((device) => device.state === "Booted") ?? matches[0];
    if (!device) throw new Error(`No iOS simulator found for ${explicit ?? models.join(" or ")}`);
    return { device, target };
  });

  const source = options.app ?? buildSimulatorApp(appDir);
  const buildDir = join(appDir, ".build", "screenshot-web");
  const out = options.out ?? join(appDir, ".build", "screenshots");
  const prefix = new Date().toISOString().slice(0, 10);
  mkdirSync(out, { recursive: true });
  const output = mkdtempSync(join(out, `${prefix}-`));
  const temp = mkdtempSync(join(tmpdir(), "zami-screenshot-"));
  try {
    const assets = buildWeb({ root, outDir: buildDir, screenshots: true }).dir;
    const app = simulatorCopy(source, temp, assets);
    for (const { target, device } of selected) {
      const targetDir = join(output, target);
      mkdirSync(targetDir);
      await captureOnDevice(app, device, target, targetDir);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`Screenshots saved in ${output}`);
  return output;
}
