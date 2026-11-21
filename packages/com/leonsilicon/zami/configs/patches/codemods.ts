// Zami's changes to code it doesn't own, as jssg codemods (codemods/<name>/codemod.ts, with
// its patch.json): the way Haniverse patches its dependencies. A codemod reads the file as
// it is upstream and returns it changed, so the change is re-applied to each new upstream
// version instead of being a stored diff that stops applying. When a codemod no longer finds
// what it changes (its anchors drifted), it leaves the file as it was, and that fails loudly.
//
// Two kinds of target:
// - a source tree in the repository (upstream Zam's): applied to a copy of it at build time
//   (@-/com.leonsilicon.zami.web), so the tree in the repository stays exactly upstream's;
// - an npm package: turned into a bun patch (npm.ts), as Haniverse does.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parsePatchConfig, type PatchBundle, type PatchConfig } from "#patch-config";

export const CODEMODS_DIR = join(import.meta.dirname, "codemods");

export interface Codemod {
  /** Its directory's name. */
  name: string;
  dir: string;
  codemodPath: string;
  config: PatchConfig;
}

/** Every codemod (a directory with codemod.ts and patch.json), by name. */
export function discoverCodemods(dir = CODEMODS_DIR): Codemod[] {
  if (!existsSync(dir)) return [];
  const codemods: Codemod[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const codemodDir = join(dir, entry.name);
    const configPath = join(codemodDir, "patch.json");
    const codemodPath = join(codemodDir, "codemod.ts");
    if (!existsSync(configPath) || !existsSync(codemodPath)) continue;
    codemods.push({
      name: entry.name,
      dir: codemodDir,
      codemodPath,
      config: parsePatchConfig(readFileSync(configPath, "utf8"), configPath),
    });
  }
  return codemods.toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

/** The codemods for the source tree at `source` (relative to the repository's root). */
export function sourceCodemods(source: string, dir = CODEMODS_DIR): Codemod[] {
  return discoverCodemods(dir).filter(
    (codemod) => codemod.config.target.kind === "source" && codemod.config.target.source === source,
  );
}

/** Changes whenever one of `codemods` does: part of what a patched build is cached by. */
export function codemodsHash(codemods: Codemod[]): string {
  const hash = createHash("sha256");
  for (const codemod of codemods) {
    hash.update(codemod.name).update("\0");
    for (const name of readdirSync(codemod.dir).toSorted()) {
      const path = join(codemod.dir, name);
      if (name.endsWith(".ts") || name.endsWith(".json"))
        hash.update(name).update(readFileSync(path));
    }
  }
  return hash.digest("hex").slice(0, 16);
}

function codemodCli(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("codemod/package.json")), "codemod");
}

/** Runs one codemod on one file, in place. */
export function runCodemod(codemod: Codemod, file: string, language: string): void {
  const result = spawnSync(
    process.execPath,
    [
      codemodCli(),
      "jssg",
      "run",
      "--target",
      file,
      "--language",
      language,
      "--allow-fs",
      "--allow-dirty",
      "--no-interactive",
      "--disable-analytics",
      codemod.codemodPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-30).join("\n");
    throw new Error(`codemod ${codemod.name} failed on ${file}:\n${output}`);
  }
}

/**
 * Applies `codemod` to its bundles under `root` (a copy of its target), and fails when a
 * bundle is missing or comes out unchanged: upstream moved the file, or the codemod's
 * anchors no longer match it.
 */
export function applyCodemod(codemod: Codemod, root: string): void {
  for (const bundle of codemod.config.bundles) applyToBundle(codemod, root, bundle);
}

function applyToBundle(codemod: Codemod, root: string, bundle: PatchBundle): void {
  const file = join(root, bundle.path);
  if (!existsSync(file)) {
    throw new Error(
      `codemod ${codemod.name}: ${bundle.path} isn't there any more. Upstream moved, renamed ` +
        `or removed it: update codemods/${codemod.name}/patch.json, or drop the bundle if the ` +
        `change is no longer needed.`,
    );
  }
  const before = readFileSync(file);
  runCodemod(codemod, file, bundle.language);
  if (readFileSync(file).equals(before)) {
    throw new Error(
      `codemod ${codemod.name} changed nothing in ${bundle.path}: what it looks for has changed ` +
        `upstream. Re-read the file and update codemods/${codemod.name}/codemod.ts.`,
    );
  }
}

/** Applies every codemod for `source` to the copy of that tree at `root`. */
export function applySourceCodemods(source: string, root: string, dir = CODEMODS_DIR): Codemod[] {
  const codemods = sourceCodemods(source, dir);
  for (const codemod of codemods) applyCodemod(codemod, root);
  return codemods;
}
