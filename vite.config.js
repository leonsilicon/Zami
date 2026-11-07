// Zami's Vite+ config. Vite+ (like Vite) looks for vite.config.js before vite.config.ts,
// so this file takes precedence over Zam's own vite.config.ts, which stays untouched.
// (Vitest prefers vite.config.ts, and Zam's vitest.config.ts above both, so the test
// tasks below pass `-c vite.config.js`.)
//
// The root is Zam's tree plus Zami's own code. Vite+ (lint, format, types, tests) covers
// only Zami's own code: apps/ and packages/. Every other top-level entry is Zam's, or its
// `.zami.` versions, which `_zami fmt` and `_zami lint` handle with Zam's own options; it's
// ignored here, whatever upstream adds later.
import { readdirSync } from "node:fs";
import flatcap from "eslint-plugin-flatcap";
import { defineConfig } from "vite-plus";

const ZAMI_OWNED = new Set([
  ".git",
  "apps",
  "packages",
  "patches",
  "node_modules",
  "package.json",
  "vite.config.js",
  "bun.lock",
  "bunfig.toml",
  "zami-ports.json",
  "zami-ports.lock.json",
  "zami.code-workspace",
  ".zed",
]);
const zamTree = readdirSync(import.meta.dirname)
  .filter((name) => !ZAMI_OWNED.has(name))
  .flatMap((name) => [name, `${name}/**`]);

// Generated: native projects (Expo prebuild), Expo's cache, and the class-name types
// Uniwind rewrites on every Metro start.
const generated = [
  "apps/zami/ios/**",
  "apps/zami/android/**",
  "apps/zami/.expo/**",
  "apps/zami/uniwind-types.d.ts",
];

const ZAM_TESTS = "packages/com/leonsilicon/zami/vite/vitest.zam.config.ts";

export default defineConfig({
  lint: {
    ...flatcap.configs.oxlint,
    options: { typeAware: true, typeCheck: true },
    // This file's nearest tsconfig.json is Zam's, which extends a file only `svelte-kit sync` makes.
    ignorePatterns: [...zamTree, ...generated, "vite.config.js"],
    overrides: [
      {
        // node:test-style top-level tests register through promises the runner manages.
        files: ["**/__tests__/**"],
        rules: { "typescript/no-floating-promises": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: [...zamTree, ...generated, "**/@prompts/**", ".zed/**", "zami.code-workspace"],
  },
  // Zami's own tooling tests. Run them with `vp run test`: at the root, a bare `vp test`
  // picks up Zam's vitest.config.ts first.
  test: {
    include: ["packages/**/__tests__/*.test.ts"],
    environment: "node",
  },
  run: {
    tasks: {
      // Zami's tooling tests, then upstream Zam's tests (their `.test.zami.ts` copies)
      // against Zami's files.
      test: {
        cache: false,
        command: `vp test run -c vite.config.js && vp test run -c ${ZAM_TESTS}`,
      },
      "test:zam": { cache: false, command: `vp test run -c ${ZAM_TESTS}` },
      typecheck: {
        command:
          "tsc -p packages && tsc -p apps/zami && tsc -p packages/com/leonsilicon/zami/sveltekit && tsc -p packages/com/leonsilicon/zami/svelte-react",
      },
      // Bundles the app's JS for both platforms with Metro (no native build): proves every
      // import resolves to a Zami file and every file transforms.
      bundle: {
        cache: false,
        command:
          "cd apps/zami && expo export --platform ios --platform android --dev --output-dir ../../node_modules/.cache/zami/bundle",
      },
      "fmt:zam": { cache: false, command: "_zami fmt" },
      "check:zam": { cache: false, command: "_zami fmt --check && _zami lint && _zami check" },
    },
  },
});
