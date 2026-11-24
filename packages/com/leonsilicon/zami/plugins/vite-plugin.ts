// The Vite plugin that builds `zam.zami` into Zam's web app (@-/com.leonsilicon.zami.web adds
// it to Zam's own Vite config):
// - every module under Zam's `src/` gets an accessor for its top-level names (instrument.ts);
// - `@-/com.leonsilicon.zami.plugins/web`, which the `zam.zami-plugins` codemod imports
//   into Zam's code, resolves to this package's runtime;
// - `svelte` and the encryption module resolve to Zam's own copies for this package's code
//   too, so there is one of each;
// - the modules the app loads as it starts are built into a few chunks (chunks.ts), not one
//   each, which the accessors' `import()` of every module would otherwise make them.
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { manualStartupChunks } from "#chunks";
import { instrument, moduleIdForPath, type EstreeNode } from "#instrument";

// (Not import.meta.dirname: Vite bundles this into its config, and keeps only import.meta.url.)
const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The parts of a Vite plugin this one uses (Vite isn't a dependency of this package). */
export interface ZamiVitePlugin {
  name: string;
  enforce: "post";
  config(): Record<string, unknown>;
  configResolved(config: { root: string }): void;
  transform(
    this: { parse(code: string): unknown },
    code: string,
    id: string,
  ): { code: string; map: null } | null;
}

export function zamiPluginsVite(): ZamiVitePlugin {
  let srcDir = "";
  return {
    name: "zami:plugins",
    // After Svelte and TypeScript have become JavaScript.
    enforce: "post",
    config() {
      return {
        resolve: {
          dedupe: ["svelte", "@matrix-org/matrix-sdk-crypto-wasm"],
          alias: [
            {
              find: /^@-\/com\.leonsilicon\.zami\.plugins\/web$/,
              replacement: join(PACKAGE_DIR, "+web.ts"),
            },
          ],
        },
        server: { fs: { allow: [PACKAGE_DIR] } },
        build: { rollupOptions: { output: { manualChunks: manualStartupChunks() } } },
      };
    },
    configResolved(config) {
      srcDir = join(config.root, "src");
    },
    transform(code, id) {
      if (id.includes("?") || id.startsWith("\0") || !id.startsWith(`${srcDir}/`)) return null;
      const moduleId = moduleIdForPath(relative(srcDir, id));
      if (moduleId === null) return null;
      const out = instrument(code, this.parse(code) as EstreeNode, moduleId);
      return out === null ? null : { code: out, map: null };
    },
  };
}
