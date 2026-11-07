import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Git, Project } from "@-/com.leonsilicon.zami.ports";

export type DevTarget = "ios" | "android" | "start";

const EXPO_COMMANDS: Record<DevTarget, string> = {
  ios: "run:ios",
  android: "run:android",
  start: "start",
};

/** Warns (without failing) when Expo files lag behind the merged upstream Zam. */
export function warnIfOutOfSync(cwd: string): void {
  try {
    const { ports, orphans, invalid } = new Project(cwd).scan();
    const behind = ports.filter(
      (port) => port.status === "stale" || port.status === "conflict",
    ).length;
    const missingCopies = ports.filter(
      (port) => port.status === "missing" && port.mapping.kind === "copy",
    ).length;
    const problems = behind + missingCopies + orphans.length + invalid.length;
    if (problems > 0) {
      console.warn(
        `warning: ${problems} Expo file(s) out of sync with upstream; run \`vpx _zami check\` for details.`,
      );
    }
  } catch (error) {
    console.warn(
      `warning: couldn't check Expo files against upstream: ${(error as Error).message}`,
    );
  }
}

/** Runs the Expo CLI for the Zami app; returns its exit code. */
export function runDev(target: DevTarget, args: string[], cwd = process.cwd()): number {
  const appDir = join(new Git(cwd).root, "expo/apps/zami");
  const expoCli = createRequire(join(appDir, "package.json")).resolve("expo/bin/cli");
  const result = spawnSync(process.execPath, [expoCli, EXPO_COMMANDS[target], ...args], {
    cwd: appDir,
    stdio: "inherit",
  });
  return result.status ?? 1;
}
