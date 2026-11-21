// npm packages: a codemod becomes a bun patch (patches/<package>@<version>.patch, listed in
// the root package.json's patchedDependencies), the way Haniverse generates its patches.
// The codemods are the source of truth; regenerate the patches with `vpx _patches generate`
// after changing one or upgrading the package. A codemod must be idempotent (leave a file it
// already changed alone): `bun patch` hands over the package as last patched.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverCodemods, runCodemod, type Codemod } from "#codemods";

export const PATCHES_DIR = "patches";

function run(command: string, args: string[], cwd: string): void {
  console.error(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

export function npmCodemods(): Codemod[] {
  return discoverCodemods().filter((codemod) => codemod.config.target.kind === "npm");
}

function npmTarget(codemod: Codemod): { npmPackage: string; versions: string[] | undefined } {
  const target = codemod.config.target;
  if (target.kind !== "npm") throw new Error(`codemod ${codemod.name} isn't for an npm package`);
  return target;
}

/** The installed (hoisted: bunfig.toml's linker) package's directory and version. */
export function installedPackage(
  root: string,
  npmPackage: string,
): { dir: string; version: string } {
  const dir = join(root, "node_modules", npmPackage);
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) throw new Error(`${npmPackage} isn't installed: run \`vp install\``);
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  return { dir, version };
}

export function patchPath(npmPackage: string, version: string): string {
  return `${PATCHES_DIR}/${npmPackage.replaceAll("/", "%2F")}@${version}.patch`;
}

/** The files a patch changes (the `b/` side of its `diff --git` headers). */
export function patchedFiles(patch: string): Set<string> {
  const files = new Set<string>();
  for (const match of patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    if (match[2] !== undefined) files.add(match[2]);
  }
  return files;
}

/** Problems with the patch for `codemod`'s package as installed; none when it's current. */
export function checkNpmPatch(root: string, codemod: Codemod): string[] {
  const { npmPackage, versions } = npmTarget(codemod);
  const { version } = installedPackage(root, npmPackage);
  if (versions !== undefined && !versions.includes(version)) {
    return [
      `codemod ${codemod.name} is for ${npmPackage} ${versions.join(", ")}, but ${version} is ` +
        `installed: check it still applies, update "versions" in its patch.json and run ` +
        "`vpx _patches generate`",
    ];
  }
  const path = patchPath(npmPackage, version);
  const problems: string[] = [];
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    patchedDependencies?: Record<string, string>;
  };
  if (manifest.patchedDependencies?.[`${npmPackage}@${version}`] !== path) {
    problems.push(`package.json's patchedDependencies doesn't list ${path}`);
  }
  if (!existsSync(join(root, path))) {
    problems.push(`${path} is missing: run \`vpx _patches generate\``);
    return problems;
  }
  const files = patchedFiles(readFileSync(join(root, path), "utf8"));
  for (const bundle of codemod.config.bundles) {
    if (!files.has(bundle.path)) problems.push(`${path} doesn't change ${bundle.path}`);
  }
  return problems;
}

/** Regenerates the bun patch for `codemod`'s package. */
export function generateNpmPatch(root: string, codemod: Codemod): string {
  const { npmPackage } = npmTarget(codemod);
  const { dir, version } = installedPackage(root, npmPackage);
  const relative = join("node_modules", npmPackage);
  // An editable copy of the package, as last patched (or pristine).
  run("bun", ["patch", "--offline", "--ignore-scripts", relative], root);
  for (const bundle of codemod.config.bundles) {
    const file = join(dir, bundle.path);
    if (!existsSync(file)) {
      throw new Error(
        `codemod ${codemod.name}: ${npmPackage}@${version} has no ${bundle.path} (moved or ` +
          `removed upstream): update codemods/${codemod.name}/patch.json`,
      );
    }
    runCodemod(codemod, file, bundle.language);
  }
  run(
    "bun",
    ["patch", "--commit", "--offline", "--ignore-scripts", relative, "--patches-dir", PATCHES_DIR],
    root,
  );
  const problems = checkNpmPatch(root, codemod);
  if (problems.length > 0) {
    throw new Error(
      `codemod ${codemod.name} didn't patch ${npmPackage}@${version} as declared (its anchors ` +
        `may have drifted):\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
  }
  return patchPath(npmPackage, version);
}
