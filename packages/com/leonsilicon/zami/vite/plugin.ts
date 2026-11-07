// Vite plugin that loads Zam's code the way the Zami app does: every import that lands in
// Zam's tree resolves to that file's `.expo.` version (never the upstream file), Svelte
// rune modules are compiled with Svelte's compiler, and Zam's Vite `define` is applied.
// It's what lets upstream's own tests (their `.test.expo.ts` copies) run against Zami's
// files. Metro does the same for the app (@-/com.leonsilicon.zami.metro).
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { mapUpstreamPath, upstreamPathForExpoPath } from "@-/com.leonsilicon.zami.ports";
import { transformSync } from "esbuild";
import { compileModule } from "svelte/compiler";
import type { Plugin } from "vite-plus";

export interface ZamiExpoOptions {
  repoRoot: string;
}

const RUNE_MODULE = /\.svelte(\.[^./]+)?\.expo\.(ts|js)$/;
const SVELTEKIT_SHIMS: Record<string, string> = {
  "$app/environment": "@-/com.leonsilicon.zami.sveltekit/app/environment",
  "$app/navigation": "@-/com.leonsilicon.zami.sveltekit/app/navigation",
  "$app/state": "@-/com.leonsilicon.zami.sveltekit/app/state",
};

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function zamiExpo({ repoRoot }: ZamiExpoOptions): Plugin {
  const zamiRoots = ["apps", "packages", "patches", "node_modules"].map((dir) =>
    path.join(repoRoot, dir),
  );
  const libRoot = path.join(repoRoot, "src", "lib");
  const relative = (file: string) => path.relative(repoRoot, file);
  const inZamTree = (file: string) =>
    file.startsWith(repoRoot + path.sep) &&
    !zamiRoots.some((root) => file.startsWith(root + path.sep)) &&
    !file.split(path.sep).includes("node_modules");
  const version = (
    JSON.parse(readFileSync(path.join(repoRoot, "package.expo.json"), "utf8")) as {
      version: string;
    }
  ).version;

  /** The Expo version of the upstream file a Vite specifier points at, the way Vite resolves it. */
  const resolveExpoVersion = (target: string, importer: string): string => {
    const candidates = [target];
    if (/\.m?js$/.test(target)) candidates.push(target.replace(/\.m?js$/, ".ts"));
    candidates.push(
      `${target}.ts`,
      `${target}.js`,
      path.join(target, "index.ts"),
      path.join(target, "index.js"),
    );
    const upstream = candidates.find(isFile);
    if (upstream === undefined) {
      throw new Error(
        `${relative(importer)} imports ${relative(target)}, which matches no file in Zam's tree`,
      );
    }
    if (upstreamPathForExpoPath(relative(upstream)) !== null) return upstream;
    const expo = path.join(repoRoot, mapUpstreamPath(relative(upstream)).expoPath);
    if (!isFile(expo)) {
      throw new Error(
        `No Expo version of ${relative(upstream)} (imported by ${relative(importer)}); create ${relative(expo)}`,
      );
    }
    return expo;
  };

  return {
    name: "zami-expo",
    enforce: "pre",
    config: () => ({
      define: { __APP_VERSION__: JSON.stringify(version) },
      // Zam's own tsconfig.json extends a file only `svelte-kit sync` generates.
      tsconfig: path.join(import.meta.dirname, "tsconfig.zam.json"),
      // Svelte's runtime only reacts in its `browser` build.
      resolve: { conditions: ["browser"] },
      // Don't load Zam's postcss.config.js (Tailwind v3, which Zami doesn't install).
      css: { postcss: {} },
    }),
    async resolveId(source, importer, options) {
      if (importer === undefined) return null;
      if (source in SVELTEKIT_SHIMS)
        return this.resolve(SVELTEKIT_SHIMS[source]!, importer, { ...options, skipSelf: true });
      const [specifier, query] = source.split(/(?=\?)/);
      let target: string | null = null;
      if (specifier === "$lib" || specifier!.startsWith("$lib/"))
        target = path.join(libRoot, specifier!.slice("$lib".length));
      else if (/^\.\.?(\/|$)/.test(specifier!))
        target = path.resolve(path.dirname(importer.split("?")[0]!), specifier!);
      else if (specifier!.startsWith("/@fs/")) target = specifier!.slice("/@fs".length);
      else if (path.isAbsolute(specifier!) && specifier!.startsWith(repoRoot + path.sep))
        target = specifier!;
      // A root-relative URL (`/src/lib/x.ts`), as Vitest's module runner requests runtime imports.
      else if (specifier!.startsWith("/") && !isFile(specifier!))
        target = path.join(repoRoot, specifier!);
      if (target === null || !inZamTree(target)) return null;
      return resolveExpoVersion(target, importer) + (query ?? "");
    },
    transform(code, id) {
      const file = id.split("?")[0]!;
      if (!inZamTree(file)) return null;
      let output = code;
      // `import.meta.glob("./locales/*.ts")` would also match the Expo copies themselves;
      // the matches it keeps resolve to their Expo versions through resolveId.
      output = output.replace(
        /import\.meta\.glob(<[^>()]*>)?\(\s*(["'])([^"']+)\2/g,
        (_match, generic: string | undefined, quote: string, pattern: string) =>
          `import.meta.glob${generic ?? ""}([${quote}${pattern}${quote}, ${quote}!**/*.expo.*${quote}]`,
      );
      if (RUNE_MODULE.test(file)) {
        const js = file.endsWith(".ts")
          ? transformSync(output, {
              loader: "ts",
              format: "esm",
              target: "es2022",
              sourcefile: file,
            }).code
          : output;
        output = compileModule(js, { filename: file, generate: "client", dev: true }).js.code;
      }
      return output === code ? null : { code: output, map: null };
    },
  };
}
