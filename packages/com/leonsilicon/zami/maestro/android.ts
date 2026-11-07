// The Android side of a run: picking the device, installing the app, wiping its state
// between flows and pointing it at the run's Metro.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function adb(serial: string, args: string[], input?: string): string {
  return execFileSync("adb", ["-s", serial, ...args], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** `device` (a serial) if given, otherwise the only connected emulator or device. */
export function resolveAndroidDevice(device: string | undefined): string {
  const serials = execFileSync("adb", ["devices"], { encoding: "utf8" })
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial)
    .filter((serial): serial is string => serial !== undefined);
  if (device !== undefined) {
    if (!serials.includes(device)) {
      throw new Error(
        `No connected Android device ${device} (connected: ${serials.join(", ") || "none"})`,
      );
    }
    return device;
  }
  if (serials.length === 1 && serials[0] !== undefined) return serials[0];
  throw new Error(
    serials.length === 0
      ? "No Android emulator or device is connected. Start one (e.g. `emulator -avd <name>`) first."
      : `Several Android devices are connected (${serials.join(", ")}); pass --device <serial>.`,
  );
}

export function isInstalled(serial: string, packageName: string): boolean {
  return adb(serial, ["shell", "pm", "path", packageName]).includes("package:");
}

/** This checkout's debug APK (`expo run:android` output), if built. */
export function findBuiltApk(appDir: string): string | undefined {
  const apk = join(appDir, "android/app/build/outputs/apk/debug/app-debug.apk");
  return existsSync(apk) ? apk : undefined;
}

export function install(serial: string, apkPath: string): void {
  adb(serial, ["install", "-r", apkPath]);
}

/**
 * Puts the app back in its just-installed state (`pm clear`) and points it at Metro on
 * `metroPort`. A debug build loads its JS from the dev server in its `debug_http_host`
 * preference, or the emulator's host on 8081 without one; `adb reverse` lets
 * `localhost:<port>` on the device reach the run's Metro on the host.
 */
export function resetApp(serial: string, packageName: string, metroPort: number): void {
  spawnSync("adb", ["-s", serial, "shell", "am", "force-stop", packageName]);
  adb(serial, ["shell", "pm", "clear", packageName]);
  adb(serial, ["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
  const preferences = [
    "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>",
    "<map>",
    `    <string name="debug_http_host">localhost:${metroPort}</string>`,
    "</map>",
    "",
  ].join("\n");
  adb(
    serial,
    [
      "shell",
      `run-as ${packageName} sh -c 'mkdir -p shared_prefs && cat > shared_prefs/${packageName}_preferences.xml'`,
    ],
    preferences,
  );
}
