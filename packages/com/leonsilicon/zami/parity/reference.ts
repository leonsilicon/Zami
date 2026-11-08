// The reference: upstream Zam's own web build, at the upstream commit the Zami files were
// last synced with, plus the parity agent (web.ts). It's built outside the repository
// and outside any node_modules: Node won't run TypeScript from under node_modules (Zam's
// build scripts import .ts), and Vite treats such paths as dependencies.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const PACKAGE_DIR = import.meta.dirname;

export function cacheDir(): string {
  return (
    process.env.ZAMI_PARITY_CACHE ??
    (process.platform === "darwin"
      ? join(homedir(), "Library/Caches/zami/parity")
      : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "zami/parity"))
  );
}

/**
 * The upstream commit the Zami files reflect: the one `zami-ports.lock.json` records for
 * most of them (they're all the same right after a sync).
 */
export function referenceCommit(root: string): { commit: string; behind: number } {
  const lock = JSON.parse(readFileSync(join(root, "zami-ports.lock.json"), "utf8")) as Record<
    string,
    string
  >;
  const counts = new Map<string, number>();
  for (const commit of Object.values(lock)) counts.set(commit, (counts.get(commit) ?? 0) + 1);
  const [commit, count] = [...counts].toSorted((a, b) => b[1] - a[1])[0] ?? [];
  if (commit === undefined || count === undefined) {
    throw new Error("zami-ports.lock.json lists no files");
  }
  return { commit, behind: Object.keys(lock).length - count };
}

function hashFiles(paths: string[]): string {
  const hash = createHash("sha256");
  for (const path of paths.toSorted()) hash.update(path).update(readFileSync(path));
  return hash.digest("hex").slice(0, 16);
}

/** The agent's sources: a change to any of them rebuilds the reference. */
function agentSources(): string[] {
  return ["web.ts", "agent.ts", "protocol.ts", "views.ts", "scope.ts", "fixtures.ts"].map((name) =>
    join(PACKAGE_DIR, name),
  );
}

function run(command: string, args: string[], cwd: string, log: (line: string) => void): void {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: "1", CI: "1" },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-40).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}:\n${output}`);
  }
}

/** A Vite config that builds Zam's own config with the agent imported by its client hooks. */
function viteConfig(agent: string, root: string): string {
  return `// Written by @-/com.leonsilicon.zami.parity: Zam's Vite config plus the parity agent.
import { defineConfig, mergeConfig } from "vite";
import zam from "./vite.config.ts";

const agent = ${JSON.stringify(agent)};

export default defineConfig(async (env) => {
  const base = typeof zam === "function" ? await zam(env) : zam;
  return mergeConfig(base, {
    plugins: [
      {
        name: "zami-parity-agent",
        enforce: "pre",
        transform(code, id) {
          if (id.endsWith("/src/hooks.client.ts")) {
            return code + "\\nimport " + JSON.stringify(agent) + ";\\n";
          }
        },
      },
    ],
    server: { fs: { allow: [${JSON.stringify(root)}] } },
  });
});
`;
}

/** Exports, installs and builds Zam at `commit` (each step only when its inputs changed). */
export function buildReference(root: string, commit: string, log: (line: string) => void): string {
  const dir = join(cacheDir(), `zam-${commit.slice(0, 12)}`);
  if (!existsSync(join(dir, "package.json"))) {
    log(`Exporting upstream Zam ${commit.slice(0, 12)} to ${dir}`);
    mkdirSync(dir, { recursive: true });
    const archive = execFileSync("git", ["archive", "--format=tar", commit], {
      cwd: root,
      maxBuffer: 1024 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
  }

  const lockHash = hashFiles([join(dir, "package-lock.json")]);
  const installedMarker = join(dir, "node_modules/.zami-parity");
  if (!existsSync(installedMarker) || readFileSync(installedMarker, "utf8") !== lockHash) {
    log("Installing Zam's dependencies (npm ci)");
    run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], dir, log);
    writeFileSync(installedMarker, lockHash);
  }

  const agent = join(PACKAGE_DIR, "web.ts");
  const buildHash = `${commit}:${lockHash}:${hashFiles(agentSources())}`;
  const builtMarker = join(dir, "build/.zami-parity");
  if (!existsSync(builtMarker) || readFileSync(builtMarker, "utf8") !== buildHash) {
    log("Building Zam with the parity agent");
    writeFileSync(join(dir, "vite.parity.config.ts"), viteConfig(agent, root));
    run("npx", ["vite", "build", "--config", "vite.parity.config.ts"], dir, log);
    // Zam's build script packs the emoji images after Vite; the rest of it (the service
    // worker, push decryption, checks) doesn't change what the app shows.
    run("node", ["scripts/pack-twemoji.mjs"], dir, log);
    writeFileSync(builtMarker, buildHash);
  }
  return join(dir, "build");
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".sf2": "application/octet-stream",
  ".sf3": "application/octet-stream",
};

/** Serves the build as Zam's static host would: files, else the SPA's index.html. */
export function serveReference(buildDir: string, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let file = resolve(buildDir, `.${normalize(path)}`);
    if (!file.startsWith(buildDir) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(buildDir, "index.html");
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolvePromise(server));
  });
}
