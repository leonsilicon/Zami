// Setup for upstream Zam's tests, run against Zami's Expo files:
//  - they read files relative to the repository root (e.g. `static/sw.js`), as they would
//    from Zam's own checkout, so tests run from there;
//  - some load code with Node's `require` (Electron's main-process modules), which Vite
//    doesn't see, so `require` of a file in Zam's tree loads its Expo version too.
import { existsSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { mapUpstreamPath, upstreamPathForExpoPath } from "@-/com.leonsilicon.zami.ports";

/** The repository root, which upstream's tests run from. */
export const repoRoot = path.resolve(import.meta.dirname, "../../../../../..");
const expoRoot = path.join(repoRoot, "expo");
process.chdir(repoRoot);

type ResolveFilename = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
) => string;
const moduleInternals = Module as unknown as { _resolveFilename: ResolveFilename };
const resolveFilename = moduleInternals._resolveFilename;
moduleInternals._resolveFilename = function resolveToExpoVersion(request, parent, isMain, options) {
  const resolved = resolveFilename.call(this, request, parent, isMain, options);
  if (!resolved.startsWith(repoRoot + path.sep) || resolved.startsWith(expoRoot + path.sep))
    return resolved;
  if (resolved.split(path.sep).includes("node_modules")) return resolved;
  const relative = path.relative(repoRoot, resolved);
  if (upstreamPathForExpoPath(relative) !== null) return resolved;
  const expo = path.join(repoRoot, mapUpstreamPath(relative).expoPath);
  return existsSync(expo) ? expo : resolved;
};
