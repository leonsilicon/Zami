// Builds the Expo app from Zam's tree without ever loading an upstream file:
// every import that lands in Zam's tree (relative, absolute or `$lib/…`) resolves
// to that file's `.expo.` version, or fails with an error naming the missing file.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expoPathFor, isExpoPath, upstreamCandidates } from "#expo-paths";

const require = createRequire(import.meta.url);

const SVELTEKIT_SHIMS = {
  "$app/environment": "@-/com.leonsilicon.zami.sveltekit/app/environment",
  "$app/navigation": "@-/com.leonsilicon.zami.sveltekit/app/navigation",
  "$app/state": "@-/com.leonsilicon.zami.sveltekit/app/state",
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

  const resolveExpoVersion = (target, moduleName, origin) => {
    if (moduleName.includes("?")) {
      throw new Error(
        `${relative(origin)} imports "${moduleName}": Vite query imports don't exist in Metro; change the Expo version not to use it.`,
      );
    }
    const upstream = upstreamCandidates(target).find(isFile);
    if (upstream === undefined) {
      // An Expo file imported directly (e.g. `./foo.expo`), or a typo.
      const direct = [`${target}.ts`, `${target}.tsx`, `${target}.js`, target].find(isFile);
      if (direct !== undefined && isExpoPath(direct)) return direct;
      throw new Error(
        `${relative(origin)} imports "${moduleName}", which matches no file in Zam's tree.`,
      );
    }
    if (isExpoPath(upstream)) return upstream;
    const expo = expoPathFor(upstream);
    if (!isFile(expo)) {
      throw new Error(
        `No Expo version of ${relative(upstream)} (imported by ${relative(origin)}). Create ${relative(expo)}; run \`vpx _zami sync\` for copies.`,
      );
    }
    return expo;
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
    if (moduleName in SVELTEKIT_SHIMS)
      return resolve(context, SVELTEKIT_SHIMS[moduleName], platform);

    let target = null;
    if (moduleName === "$lib" || moduleName.startsWith("$lib/")) {
      target = path.join(libRoot, moduleName.slice("$lib".length));
    } else if (/^\.\.?(\/|$)/.test(moduleName)) {
      target = path.resolve(path.dirname(origin), moduleName);
    } else if (path.isAbsolute(moduleName)) {
      target = moduleName;
    }
    if (target !== null && inZamTree(target)) {
      return { type: "sourceFile", filePath: resolveExpoVersion(target, moduleName, origin) };
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

  config.transformer.babelTransformerPath =
    require.resolve("@-/com.leonsilicon.zami.metro/transformer");
  config.transformer.unstable_allowRequireContext = true;
  return config;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
