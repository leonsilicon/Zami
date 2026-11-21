import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { appDir } from "@-/com.leonsilicon.zami.paths";
import { buildWeb } from "@-/com.leonsilicon.zami.web";

export type DevTarget = "ios" | "android" | "start";

const EXPO_COMMANDS: Record<DevTarget, string> = {
  ios: "run:ios",
  android: "run:android",
  start: "start",
};

/**
 * Runs the Expo CLI for the Zami app; returns its exit code. A native run first brings
 * Zam's web app up to date (`vpx _web build`), which the native build copies into the app.
 */
export function runDev(target: DevTarget, args: string[], cwd = process.cwd()): number {
  const app = appDir(cwd);
  if (target !== "start") buildWeb({ log: (line) => console.error(line) });
  const expoCli = createRequire(join(app, "package.json")).resolve("expo/bin/cli");
  const result = spawnSync(process.execPath, [expoCli, EXPO_COMMANDS[target], ...args], {
    cwd: app,
    stdio: "inherit",
  });
  return result.status ?? 1;
}
