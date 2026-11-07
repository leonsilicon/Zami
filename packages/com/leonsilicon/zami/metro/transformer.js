// Metro babel transformer for Zami. Before Expo's own transformer runs, it:
//  - compiles Svelte rune modules (`*.svelte.zami.ts`, and `*.svelte.ts` in Zami's own
//    packages) with Svelte's compiler, so Zam's stores run unmodified;
//  - rewrites the Vite build-time features Zam's code uses (see #vite-babel-plugin);
//  - turns Ruffle's scripts (`static/ruffle/*.zami.js`) into their text, for Flash's WebView.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import esbuild from "esbuild";
import { compileModule } from "svelte/compiler";
import { appVersion, zamiVitePlugin } from "#vite-babel-plugin";

const require = createRequire(import.meta.url);
// Expo's own babel transformer (CommonJS).
const upstream = require("@expo/metro-config/babel-transformer");

const RUNE_MODULE = /\.svelte(\.zami)?\.(ts|js)$/;
// Ruffle's scripts run in Flash's WebView, not in the app: the app gets their text, to
// write beside the page. (Metro can't make them assets: their extension is `.zami.js`.)
const RUFFLE_SCRIPT = /[\\/]static[\\/]ruffle[\\/][^\\/]+\.zami\.js$/;

function compileRunes(src, filename, dev) {
  const js = filename.endsWith(".ts")
    ? esbuild.transformSync(src, {
        loader: "ts",
        format: "esm",
        target: "es2022",
        sourcefile: filename,
      }).code
    : src;
  return compileModule(js, { filename, generate: "client", dev }).js.code;
}

export function transform(params) {
  const { filename, options } = params;
  let { src } = params;
  if (RUFFLE_SCRIPT.test(filename)) src = `module.exports = ${JSON.stringify(src)};`;
  else if (RUNE_MODULE.test(filename) && !filename.split(path.sep).includes("node_modules")) {
    src = compileRunes(src, filename, options.dev);
  }
  return upstream.transform({
    ...params,
    src,
    plugins: [...(params.plugins ?? []), zamiVitePlugin],
  });
}

export function getCacheKey(...args) {
  const hash = crypto.createHash("sha1");
  hash.update(upstream.getCacheKey?.(...args) ?? "");
  for (const file of ["transformer.js", "vite-babel-plugin.js", "zami-paths.js", "with-zami.js"]) {
    hash.update(fs.readFileSync(path.join(import.meta.dirname, file)));
  }
  hash.update(require("svelte/package.json").version);
  hash.update(appVersion());
  return hash.digest("hex");
}
