// Which flows a run executes: the names given on the command line, or the suite in
// `config.yaml`. Filesystem-only (no device), so it's what the unit tests cover.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface Flow {
  /** The flow's path in the suite, without `.yaml`: `smoke`, `subflows/launch-app`. */
  name: string;
  path: string;
}

/**
 * The flows listed under `flows:` in the suite's `config.yaml`, in order. Entries are file
 * names relative to the suite (Maestro also accepts globs there; this runner doesn't).
 */
export function readConfigFlows(suiteDir: string): string[] {
  const configPath = join(suiteDir, "config.yaml");
  const flows: string[] = [];
  let inFlows = false;
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    if (/^flows:\s*(?:#.*)?$/.test(line)) {
      inFlows = true;
      continue;
    }
    // Another top-level key ends the list; a comment at column 0 doesn't.
    if (/^[^\s#-]/.test(line)) inFlows = false;
    const item = inFlows ? /^\s*-\s*(["']?)([^"'#\s]+)\1\s*(?:#.*)?$/.exec(line) : null;
    if (item?.[2] !== undefined) flows.push(item[2]);
  }
  if (flows.length === 0) throw new Error(`No flows are listed under \`flows:\` in ${configPath}`);
  return flows;
}

/**
 * Resolves flow arguments to files. An argument is a name in the suite (`smoke`,
 * `subflows/launch-app`), the same with `.yaml`, or a path from the current directory.
 * With no arguments, it's the suite in `config.yaml`.
 */
export function resolveFlows(
  suiteDir: string,
  args: readonly string[],
  cwd = process.cwd(),
): Flow[] {
  const entries = args.length > 0 ? args : readConfigFlows(suiteDir);
  return entries.map((entry) => {
    const file = /\.ya?ml$/.test(entry) ? entry : `${entry}.yaml`;
    const path = [join(suiteDir, file), resolve(cwd, file)].find((candidate) =>
      existsSync(candidate),
    );
    if (path === undefined) {
      throw new Error(`No Maestro flow ${entry}: ${join(suiteDir, file)} doesn't exist`);
    }
    return { name: relative(suiteDir, path).replace(/\.ya?ml$/, ""), path };
  });
}
