// Vite plugin that compiles the Svelte rune modules in Zami's own packages
// (`packages/**/*.svelte.ts`) for Zami's tooling tests, as Metro does for the app.
import { transformSync } from "esbuild";
import { compileModule } from "svelte/compiler";
import type { Plugin } from "vite-plus";

const RUNE_MODULE = /\/packages\/.*\.svelte\.(ts|js)$/;

export function svelteRunes(): Plugin {
  return {
    name: "zami-svelte-runes",
    enforce: "pre",
    // Svelte's runtime only reacts in its `browser` build. The tooling tests run in Node,
    // where Vitest resolves (and loads external packages) as SSR.
    config: () => ({
      resolve: { conditions: ["browser"] },
      ssr: { resolve: { conditions: ["browser"], externalConditions: ["browser"] } },
    }),
    transform(code, id) {
      const file = id.split("?")[0]!;
      if (!RUNE_MODULE.test(file) || file.includes("/node_modules/")) return null;
      const js = file.endsWith(".ts")
        ? transformSync(code, { loader: "ts", format: "esm", target: "es2022", sourcefile: file })
            .code
        : code;
      return {
        code: compileModule(js, { filename: file, generate: "client", dev: true }).js.code,
        map: null,
      };
    },
  };
}
