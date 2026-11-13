// Builds the Expo app from Zam's tree without ever loading an upstream file:
// every import that lands in Zam's tree (relative, absolute or `$lib/…`) resolves
// to that file's `.zami.` version, or fails with an error naming the missing file.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { zamiPathFor, isZamiPath, upstreamCandidates } from "#zami-paths";

const require = createRequire(import.meta.url);

// Web-only modules Zam imports, and their React Native stand-ins.
const SHIMS = {
  "$app/environment": "@-/com.leonsilicon.zami.sveltekit/app/environment",
  "$app/navigation": "@-/com.leonsilicon.zami.sveltekit/app/navigation",
  "$app/state": "@-/com.leonsilicon.zami.sveltekit/app/state",
};
const CAPACITOR_SHIM = "packages/com/leonsilicon/zami/capacitor/capacitor.cjs";
// The same, for stand-ins that are a file rather than a package's entrypoint.
const FILE_SHIMS = {
  "lucide-svelte": "packages/com/leonsilicon/zami/icons/lucide-svelte.cjs",
};

// Zam directories the app never imports from; keeping them out of Metro's file map
// keeps startup fast (android/ alone holds Gradle build output).
const UNWATCHED = [
  "android",
  "electron",
  "flatpak",
  "native",
  "scripts",
  "unsubmitted-mscs",
  ".github",
  // Agents' git worktrees (`.claude/worktrees/*`), each a full checkout with node_modules.
  ".claude",
];

// Inline requires: a module imported for its named exports runs when one of them is first
// used, not when the importing module does, so the app's first frame no longer waits for every
// module (matrix-js-sdk, livekit, the emoji tables, every store) to run. A bare `import "x"`, a
// default or namespace import, and a name used at a module's top level still run in order.
// These entry files run before anything else and in order, so none of their imports is
// deferred: the polyfills, the browser globals and storage everything after them relies on.
const EAGER_FILES = [
  "apps/zami/index.ts",
  "apps/zami/polyfills.ts",
  "apps/zami/globals.ts",
  "apps/zami/blob.ts",
  "apps/zami/fonts.ts",
  "apps/zami/media.ts",
  "apps/zami/calls.ts",
  "apps/zami/notifications.ts",
  "apps/zami/storage.ts",
  "src/lib/polyfills.zami.ts",
];
// Never deferred, anywhere: React and React Native (Metro's own list), and Svelte's runtime,
// which rune modules read all the time.
const NON_INLINED_REQUIRES = [
  "React",
  "react",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "react-compiler-runtime",
  "react-native",
  "svelte",
  "svelte/internal/client",
  "svelte/internal/disclose-version",
  "svelte/internal/flags/legacy",
  "svelte/reactivity",
];

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {import("metro-config").MetroConfig} config Expo's default Metro config.
 * @param {{ repoRoot: string }} options
 */
export function withZami(config, { repoRoot }) {
  // Zami's own code (the app, its packages) sits beside Zam's tree at the repository root.
  const zamiRoots = ["apps", "packages", "patches", "node_modules"].map((dir) =>
    path.join(repoRoot, dir),
  );
  const libRoot = path.join(repoRoot, "src", "lib");
  const relative = (filePath) => path.relative(repoRoot, filePath);
  const inZamTree = (filePath) =>
    filePath.startsWith(repoRoot + path.sep) &&
    !zamiRoots.some((root) => filePath.startsWith(root + path.sep)) &&
    !filePath.split(path.sep).includes("node_modules");

  const resolveZamiVersion = (target, moduleName, origin) => {
    if (moduleName.includes("?")) {
      throw new Error(
        `${relative(origin)} imports "${moduleName}": Vite query imports don't exist in Metro; change the Zami version not to use it.`,
      );
    }
    const upstream = upstreamCandidates(target).find(isFile);
    if (upstream === undefined) {
      // A Zami file imported directly (e.g. `./foo.zami`), or a typo.
      const direct = [`${target}.ts`, `${target}.tsx`, `${target}.js`, target].find(isFile);
      if (direct !== undefined && isZamiPath(direct)) return direct;
      throw new Error(
        `${relative(origin)} imports "${moduleName}", which matches no file in Zam's tree.`,
      );
    }
    if (isZamiPath(upstream)) return upstream;
    const zami = zamiPathFor(upstream);
    if (!isFile(zami)) {
      throw new Error(
        `No Zami version of ${relative(upstream)} (imported by ${relative(origin)}). Create ${relative(zami)}; run \`vpx _zami sync\` for copies.`,
      );
    }
    return zami;
  };

  const next = config.resolver.resolveRequest;
  config.watchFolders = [...new Set([...(config.watchFolders ?? []), repoRoot])];
  config.resolver.blockList = [
    ...[config.resolver.blockList ?? []].flat(),
    ...UNWATCHED.map((dir) => new RegExp(`^${escape(path.join(repoRoot, dir))}\\/.*`)),
  ];
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolve = next ?? context.resolveRequest;
    const origin = context.originModulePath;
    if (moduleName in SHIMS) return resolve(context, SHIMS[moduleName], platform);
    if (moduleName in FILE_SHIMS)
      return { type: "sourceFile", filePath: path.join(repoRoot, FILE_SHIMS[moduleName]) };
    // Capacitor (Zam's Android bridge): the app isn't a Capacitor app.
    if (moduleName.startsWith("@capacitor/"))
      return { type: "sourceFile", filePath: path.join(repoRoot, CAPACITOR_SHIM) };

    let target = null;
    if (moduleName === "$lib" || moduleName.startsWith("$lib/")) {
      target = path.join(libRoot, moduleName.slice("$lib".length));
    } else if (/^\.\.?(\/|$)/.test(moduleName)) {
      target = path.resolve(path.dirname(origin), moduleName);
    } else if (path.isAbsolute(moduleName)) {
      target = moduleName;
    }
    if (target !== null && inZamTree(target)) {
      return { type: "sourceFile", filePath: resolveZamiVersion(target, moduleName, origin) };
    }

    if (moduleName === "@matrix-org/matrix-sdk-crypto-wasm") {
      return resolve(context, "react-native-matrix-sdk-crypto-wasm", platform);
    }
    // Svelte's runtime only reacts in its `browser` build; its default build is the server one.
    if (
      /^(svelte|esm-env)(\/|$)/.test(moduleName) ||
      /[\\/]node_modules[\\/](svelte|esm-env)[\\/]/.test(origin)
    ) {
      return resolve(
        { ...context, unstable_conditionNames: [...context.unstable_conditionNames, "browser"] },
        moduleName,
        platform,
      );
    }
    return resolve(context, moduleName, platform);
  };

  // Zam's static files that Zam's code fetches by path (served by the browser stand-in's
  // fetch), bundled as assets: the MIDI SoundFont. And Ruffle's two wasm builds, which
  // Flash's WebView loads from files (@-/com.leonsilicon.zami.flash).
  config.resolver.assetExts = [...new Set([...config.resolver.assetExts, "sf3", "wasm"])];
  config.transformer.babelTransformerPath =
    require.resolve("@-/com.leonsilicon.zami.metro/transformer");
  config.transformer.unstable_allowRequireContext = true;
  // See EAGER_FILES. `ZAMI_INLINE_REQUIRES=0` turns it off, to tell whether a problem is an
  // import that something relied on running early.
  if (process.env.ZAMI_INLINE_REQUIRES !== "0") {
    const eagerFiles = new Set(EAGER_FILES.map((file) => path.join(repoRoot, file)));
    const getTransformOptions = config.transformer.getTransformOptions;
    config.transformer.getTransformOptions = async (...args) => {
      const options = (await getTransformOptions?.(...args)) ?? {};
      return {
        ...options,
        transform: {
          ...options.transform,
          inlineRequires: {
            // Metro asks `file in blockList`, in this process, per file. Besides the entry
            // files, nothing under node_modules is inlined: libraries rely on their own
            // modules running in order (core-js's `inspect-source` must capture
            // `Function.prototype.toString` before `make-built-in` replaces it, or every
            // `toString` recurses until the stack overflows at launch). Our own imports
            // of those libraries are still deferred, which is where the time goes.
            blockList: new Proxy(
              {},
              {
                has: (_, file) =>
                  typeof file === "string" &&
                  (eagerFiles.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)),
              },
            ),
          },
          nonInlinedRequires: NON_INLINED_REQUIRES,
        },
      };
    };
  }
  return config;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
