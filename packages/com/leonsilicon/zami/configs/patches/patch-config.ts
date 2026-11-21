// A codemod's patch.json: what it patches (an npm package, or a source tree in the
// repository such as upstream Zam's) and the files it must change there.
import { extname } from "node:path";

export interface PatchBundle {
  /** The file, relative to the package or source tree. */
  path: string;
  /** The ast-grep language jssg parses it as (`cpp` for Objective-C, as in Haniverse). */
  language: string;
}

export type PatchTarget =
  | {
      kind: "npm";
      npmPackage: string;
      /** Installed versions to patch; every installed version when absent. */
      versions: string[] | undefined;
    }
  | {
      kind: "source";
      /** The tree, relative to the repository's root (e.g. repos/com/github/az4521/Zam). */
      source: string;
    };

export interface PatchConfig {
  target: PatchTarget;
  bundles: PatchBundle[];
}

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".m": "cpp",
  ".mm": "cpp",
  ".h": "cpp",
  ".css": "css",
  ".html": "html",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBundle(bundle: unknown, configPath: string): PatchBundle {
  if (typeof bundle === "string") {
    const language = LANGUAGES[extname(bundle).toLowerCase()];
    if (language === undefined) {
      throw new Error(`${configPath}: give ${bundle}'s language ({ "path", "language" })`);
    }
    return { path: bundle, language };
  }
  if (isRecord(bundle) && typeof bundle.path === "string" && typeof bundle.language === "string") {
    return { path: bundle.path, language: bundle.language };
  }
  throw new Error(
    `${configPath}: a bundle is a path or { "path", "language" }, not ${JSON.stringify(bundle)}`,
  );
}

export function parsePatchConfig(raw: string, configPath: string): PatchConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${configPath} isn't JSON`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.bundles) || parsed.bundles.length === 0) {
    throw new Error(`${configPath}: needs "bundles", the files the codemod changes`);
  }
  const bundles = parsed.bundles.map((bundle) => parseBundle(bundle, configPath));
  if (typeof parsed.npmPackage === "string") {
    const versions = parsed.versions;
    if (
      versions !== undefined &&
      !(Array.isArray(versions) && versions.every((v) => typeof v === "string"))
    ) {
      throw new Error(`${configPath}: "versions" is a list of version strings`);
    }
    return {
      target: {
        kind: "npm",
        npmPackage: parsed.npmPackage,
        versions: versions as string[] | undefined,
      },
      bundles,
    };
  }
  if (typeof parsed.source === "string") {
    return { target: { kind: "source", source: parsed.source }, bundles };
  }
  throw new Error(`${configPath}: needs "npmPackage" or "source", what the codemod patches`);
}
