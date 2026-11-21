import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Upstream Zam, unmodified, relative to the repository's root. */
export const ZAM_PATH = "repos/com/github/az4521/Zam";

/** The Expo app, relative to the repository's root. */
export const APP_PATH = "apps/zami";

/** The root of the repository around `cwd`. */
export function repoRoot(cwd = process.cwd()): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
}

/** Upstream Zam's tree in the repository around `cwd`. */
export function zamDir(cwd = process.cwd()): string {
  return join(repoRoot(cwd), ZAM_PATH);
}

/** The Expo app in the repository around `cwd`. */
export function appDir(cwd = process.cwd()): string {
  return join(repoRoot(cwd), APP_PATH);
}
