// Zam's web app, built from upstream Zam's tree (packages/com/github/az4521/Zam) with Zam's
// own dependencies (its package-lock.json) and its own Vite config, plus Zami's codemods for
// it (@-/com.leonsilicon.zami.configs.patches). The Zami app shows it in a WebView
// (@-/com.leonsilicon.zami.shell).
//
// The tree is exported, as git's index has it, to a cache directory outside the repository
// and outside any node_modules, where the codemods change it: the tree in the repository
// stays exactly upstream's. (Node won't run TypeScript from under node_modules, which Zam's
// build scripts import, and Vite treats such paths as dependencies.) Each step reruns only
// when its inputs change.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  applySourceCodemods,
  codemodsHash,
  sourceCodemods,
} from "@-/com.leonsilicon.zami.configs.patches";
import { repoRoot, ZAM_PATH } from "@-/com.leonsilicon.zami.paths";

/** The directory the native apps copy into their bundles, inside the output directory. */
export const WEB_DIR_NAME = "zami-web";

/**
 * Bump to rebuild every cached web build: anything here that changes what a build contains
 * without changing its inputs.
 */
const BUILD_FORMAT = 1;

/** `zam.zami` (@-/com.leonsilicon.zami.plugins), whose Vite plugin the build adds. */
const PLUGINS_DIR = join(import.meta.dirname, "../plugins");

/** Zam's own Vite config, plus what builds `zam.zami` into the app. */
function viteConfig(): string {
  return `// Written by @-/com.leonsilicon.zami.web: Zam's Vite config, plus zam.zami.
import { defineConfig, mergeConfig } from "vite";
import zam from "./vite.config.ts";
import { zamiPluginsVite } from ${JSON.stringify(join(PLUGINS_DIR, "vite-plugin.ts"))};

export default defineConfig(async (env) =>
  mergeConfig(typeof zam === "function" ? await zam(env) : zam, { plugins: [zamiPluginsVite()] }),
);
`;
}

/** The files of a directory (not its tests or node_modules), for what a build depends on. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else files.push(path);
  }
  return files.toSorted();
}

/** Where the homeserver sends this device's pushes: Zami's own gateway. */
export const DEFAULT_PUSH_GATEWAY_URL = "https://zami-push.leonsilicon.com/_matrix/push/v1/notify";

export function cacheDir(): string {
  return (
    process.env.ZAMI_WEB_CACHE ??
    (process.platform === "darwin"
      ? join(homedir(), "Library/Caches/zami/web")
      : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "zami/web"))
  );
}

/** Where `buildWeb` puts the app by default: the directory the native projects read. */
export function defaultOutDir(root: string): string {
  return join(root, "apps/zami/.build/web");
}

interface TreeEntry {
  mode: string;
  sha: string;
  /** The path in Zam's tree. */
  path: string;
}

/** Zam's files as git's index has them, by their path in Zam's tree. */
export function zamTree(root: string): TreeEntry[] {
  const out = execFileSync("git", ["ls-files", "-s", "-z", "--", ZAM_PATH], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  }).toString("utf8");
  const prefix = `${ZAM_PATH}/`;
  const entries: TreeEntry[] = [];
  for (const record of out.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const [mode, sha] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (mode === undefined || sha === undefined || mode === "160000" || !path.startsWith(prefix))
      continue;
    entries.push({ mode, sha, path: path.slice(prefix.length) });
  }
  if (!entries.some((entry) => entry.path === "package.json")) {
    throw new Error(`${ZAM_PATH} has no package.json: is upstream Zam there?`);
  }
  return entries.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Zam's files that differ from the index in the working tree (they aren't built). */
function unstagedZamChanges(root: string): string[] {
  return execFileSync("git", ["diff", "--name-only", "--", ZAM_PATH], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** The contents of blobs, read with one `git cat-file --batch`. */
function readBlobs(root: string, shas: string[]): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  const unique = [...new Set(shas)];
  // In batches, so no single answer has to hold the whole tree.
  for (let start = 0; start < unique.length; start += 2000) {
    const batch = unique.slice(start, start + 2000);
    const out = execFileSync("git", ["cat-file", "--batch"], {
      cwd: root,
      input: `${batch.join("\n")}\n`,
      maxBuffer: 2 * 1024 * 1024 * 1024,
    });
    let offset = 0;
    for (const sha of batch) {
      const newline = out.indexOf(10, offset);
      const [, , size] = out.subarray(offset, newline).toString("utf8").split(" ");
      const length = Number(size);
      if (!Number.isFinite(length)) throw new Error(`git cat-file: no blob ${sha}`);
      blobs.set(sha, out.subarray(newline + 1, newline + 1 + length));
      offset = newline + 1 + length + 1;
    }
  }
  return blobs;
}

const MANIFEST = ".zami-web-export.json";

/**
 * Brings `dir` to exactly the files of `entries`: writes what changed since the last export,
 * and every one of `rewrite` (the files codemods change), and deletes what's gone. Leaves
 * node_modules and build output alone.
 */
export function exportTree(
  root: string,
  entries: TreeEntry[],
  dir: string,
  rewrite: ReadonlySet<string> = new Set(),
): number {
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, MANIFEST);
  const previous = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>)
    : {};
  const next: Record<string, string> = {};
  const changed: TreeEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.mode}:${entry.sha}`;
    next[entry.path] = key;
    if (
      previous[entry.path] !== key ||
      rewrite.has(entry.path) ||
      !existsSync(join(dir, entry.path))
    ) {
      changed.push(entry);
    }
  }
  for (const path of Object.keys(previous)) {
    if (!(path in next)) rmSync(join(dir, path), { force: true });
  }
  const blobs = readBlobs(
    root,
    changed.map((entry) => entry.sha),
  );
  for (const entry of changed) {
    const target = join(dir, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    const content = blobs.get(entry.sha);
    if (content === undefined) throw new Error(`git cat-file: no blob for ${entry.path}`);
    if (existsSync(target) || isDanglingLink(target)) rmSync(target, { force: true });
    if (entry.mode === "120000") symlinkSync(content.toString("utf8"), target);
    else writeFileSync(target, content, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  }
  writeFileSync(manifestPath, JSON.stringify(next));
  return changed.length;
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function hash(...parts: (string | Buffer)[]): string {
  const sha = createHash("sha256");
  for (const part of parts) sha.update(part).update("\0");
  return sha.digest("hex").slice(0, 16);
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): void {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-60).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}:\n${output}`);
  }
}

/** The build-time settings (Vite's `VITE_*`), from Zami's environment. */
export function buildEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const settings: Record<string, string> = {
    VITE_PUSH_GATEWAY_URL: env.EXPO_PUBLIC_PUSH_GATEWAY_URL || DEFAULT_PUSH_GATEWAY_URL,
  };
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("VITE_") && value !== undefined) settings[name] = value;
  }
  return settings;
}

export interface BuildWebOptions {
  /** The repository; defaults to the one around the working directory. */
  root?: string;
  /** Where to put the app (in `<outDir>/zami-web`); defaults to apps/zami/.build/web. */
  outDir?: string;
  /** Rebuild even if nothing changed. */
  force?: boolean;
  log?: (line: string) => void;
}

export interface BuildWebResult {
  /** The directory holding the app (`index.html`, `_app/`, …). */
  dir: string;
  /** Changes whenever the app does: the native projects' build phases compare it. */
  version: string;
  built: boolean;
}

const BUILT_MARKER = ".zami-web-build";

/** Builds Zam's web app (each step only when its inputs changed) and copies it to `outDir`. */
export function buildWeb(options: BuildWebOptions = {}): BuildWebResult {
  const root = options.root ?? repoRoot();
  const log = options.log ?? ((line: string) => console.error(line));
  const outDir = options.outDir ?? defaultOutDir(root);
  const target = join(outDir, WEB_DIR_NAME);
  const entries = zamTree(root);
  const unstaged = unstagedZamChanges(root);
  if (unstaged.length > 0) {
    log(
      `warning: building ${ZAM_PATH} as git's index has it; ${unstaged.length} file(s) differ in ` +
        `the working tree (Zam stays as upstream has it: change it with a codemod).`,
    );
  }
  const codemods = sourceCodemods(ZAM_PATH);
  const settings = buildEnv();
  const version = hash(
    String(BUILD_FORMAT),
    JSON.stringify(settings),
    codemodsHash(codemods),
    viteConfig(),
    ...sourceFiles(PLUGINS_DIR).map(
      (file) => `${relative(PLUGINS_DIR, file)}:${hash(readFileSync(file))}`,
    ),
    ...entries.map((entry) => `${entry.path}:${entry.mode}:${entry.sha}`),
  );

  const targetMarker = join(target, BUILT_MARKER);
  if (
    !options.force &&
    existsSync(targetMarker) &&
    readFileSync(targetMarker, "utf8").trim() === version
  ) {
    return { dir: target, version, built: false };
  }

  const src = join(cacheDir(), "src");
  const patched = new Set(
    codemods.flatMap((codemod) => codemod.config.bundles.map((bundle) => bundle.path)),
  );
  const changed = exportTree(root, entries, src, patched);
  log(`Exported upstream Zam to ${src} (${changed} files written)`);
  if (codemods.length > 0) {
    applySourceCodemods(ZAM_PATH, src);
    log(`Applied Zami's codemods to it: ${codemods.map((codemod) => codemod.name).join(", ")}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...settings,
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    CI: "1",
    NODE_ENV: "production",
  };
  const lockHash = hash(
    readFileSync(join(src, "package.json")),
    readFileSync(join(src, "package-lock.json")),
  );
  const installedMarker = join(src, "node_modules/.zami-web");
  if (!existsSync(installedMarker) || readFileSync(installedMarker, "utf8") !== lockHash) {
    log("Installing Zam's dependencies (npm ci)");
    // npm ci's devDependencies are the build's: NODE_ENV=production would leave them out.
    run(
      "npm",
      ["ci", "--no-audit", "--no-fund", "--loglevel=error", "--include=dev"],
      src,
      { ...env, NODE_ENV: "development" },
      log,
    );
    writeFileSync(installedMarker, lockHash);
  }

  const buildMarker = join(src, "build", BUILT_MARKER);
  if (
    options.force ||
    !existsSync(buildMarker) ||
    readFileSync(buildMarker, "utf8").trim() !== version
  ) {
    log("Building Zam's web app (vite build)");
    writeFileSync(join(src, "vite.zami.config.ts"), viteConfig());
    run(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "build", "--config", "vite.zami.config.ts"],
      src,
      env,
      log,
    );
    // Zam's `build` script packs the emoji images after Vite. Its other steps are for
    // other platforms (Android's push decryption) or need a service worker, which
    // WKWebView doesn't run for an app's own scheme.
    run(process.execPath, ["scripts/pack-twemoji.mjs"], src, env, log);
    writeFileSync(buildMarker, version);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(src, "build"), target, { recursive: true });
  writeFileSync(targetMarker, version);
  log(`Zam's web app is in ${target}`);
  return { dir: target, version, built: true };
}
