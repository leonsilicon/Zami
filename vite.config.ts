// Zami's Vite+ config: formatting, linting and tests for Zami's own code. Upstream Zam's
// tree (repos/com/github/az4521/Zam) is never formatted or linted: it stays exactly as
// upstream has it, and Zami changes it only through codemods
// (packages/com/leonsilicon/zami/configs/patches).
import flatcap from "eslint-plugin-flatcap";
import { defineConfig } from "vite-plus";

const upstream = ["repos/**"];

// Generated: native projects (Expo prebuild), Expo's cache, the web app's build, the bun
// patches the codemods generate, and Wrangler's types (`wrangler types`) and local state.
const generated = [
  "apps/zami/ios/**",
  "apps/zami/android/**",
  "apps/zami/.expo/**",
  "apps/zami/.build/**",
  "patches/**",
  "apps/push-gateway/worker-configuration.d.ts",
  "apps/upstream-sync/worker-configuration.d.ts",
  "apps/*/.wrangler/**",
];

export default defineConfig({
  lint: {
    ...flatcap.configs.oxlint,
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [...upstream, ...generated],
    overrides: [
      {
        // Root manifest validation requires exact path casing for package names.
        // The Zam workspace preserves the upstream directory name and uses lowercase in npm.
        files: ["vite.config.ts"],
        rules: { "flatcap/package-manifest": "off" },
      },
      {
        files: ["packages/com/github/az4521/Zam/**/*.ts"],
        rules: {
          "flatcap/package-manifest": "off",
          "flatcap/package-name-matches-path": "off",
        },
      },
      {
        // node:test-style top-level tests register through promises the runner manages.
        files: ["**/__tests__/**"],
        rules: { "typescript/no-floating-promises": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: [...upstream, ...generated, ".claude/settings.local.json"],
  },
  test: {
    include: [
      "packages/com/github/az4521/Zam/__tests__/*.test.ts",
      "packages/com/leonsilicon/**/__tests__/*.test.ts",
      "apps/*/__tests__/*.test.ts",
    ],
    environment: "node",
  },
  run: {
    tasks: {
      test: { cache: false, command: "vp test run" },
      typecheck: {
        command:
          "tsc -p packages && tsc -p packages/com/leonsilicon/zami/shell && tsc -p packages/com/leonsilicon/zami/configs/patches && tsc -p packages/com/leonsilicon/zami/plugins && tsc -p apps/zami && tsc -p apps/push-gateway && tsc -p apps/upstream-sync",
      },
      // Every codemod still applies: Zam's to its tree, the npm ones as current bun patches.
      patches: { cache: false, command: "_patches check" },
      // Bundles the app's JS for both platforms with Metro (no native build).
      bundle: {
        cache: false,
        command:
          "cd apps/zami && expo export --platform ios --platform android --dev --output-dir ../../node_modules/.cache/zami/bundle",
      },
    },
  },
});
