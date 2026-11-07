// Zami's Vite+ config. Vite+ (like Vite) looks for vite.config.js before vite.config.ts,
// so this file takes precedence over Zam's own vite.config.ts, which stays untouched.
// (Vitest prefers vite.config.ts, and Zam's vitest.config.ts above both, so the test
// tasks below pass `-c vite.config.js`.)
//
// The root is Zam's tree plus Zami's files. Vite+ (`vp fmt`, `vp lint`, `vp check`) covers
// Zami's own code (apps/, packages/) and the `.zami.` versions in Zam's tree, and never
// Zam's own files: every top-level entry that isn't Zami's is ignored except for the
// `.zami.` files in it, whatever upstream adds later.
import { readdirSync, readFileSync } from "node:fs";
import { isZamiPath, mapUpstreamPath } from "@-/com.leonsilicon.zami.ports";
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
// Zam's top-level entries. Gitignore-style: a directory's files are ignored but its
// subdirectories aren't, so the `.zami.` files in them can be re-included.
const zamFiles = readdirSync(import.meta.dirname, { withFileTypes: true })
  .filter((entry) => !ZAMI_OWNED.has(entry.name) && !isZamiPath(entry.name))
  .flatMap((entry) =>
    entry.isDirectory()
      ? [`/${entry.name}/**`, `!/${entry.name}/**/`, `!/${entry.name}/**/*.zami.*`]
      : [`/${entry.name}`],
  );
// What Zam itself never formats (its .prettierignore: vendored code in static/, docs,
// build output), and the Zami versions of the files it lists. Directories are spelled out
// as their contents: oxlint and oxfmt let a file's negated pattern above outrank its
// excluded directory.
const zamUnformatted = readFileSync(new URL(".prettierignore", import.meta.url), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .flatMap((pattern) => {
    if (pattern.includes("*")) return [pattern];
    if (!pattern.endsWith("/")) return [pattern, mapUpstreamPath(pattern).zamiPath];
    const dir = pattern.slice(0, -1);
    return [dir.includes("/") ? `/${dir.replace(/^\//, "")}/**` : `**/${dir}/**`];
  });
const zamIgnored = [...zamFiles, ...zamUnformatted];
// The Zami versions in Zam's tree.
const zamiFiles = ["**/*.zami.*"];

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
    // Type-aware rules read Zam's tree through Zam's tsconfig.json, which extends
    // `.svelte-kit/tsconfig.json`. Zami's postinstall writes that file in place of
    // `svelte-kit sync` (@-/com.leonsilicon.zami.sveltekit/tsconfig.svelte-kit.json):
    // type information, but no type-checking of Zam's code.
    options: { typeAware: true, typeCheck: true },
    // This file's nearest tsconfig.json is Zam's, which only covers the `.zami.` files.
    ignorePatterns: [...zamIgnored, ...generated, "vite.config.js"],
    overrides: [
      {
        // node:test-style top-level tests register through promises the runner manages.
        files: ["**/__tests__/**"],
        rules: { "typescript/no-floating-promises": "off" },
      },
      {
        // Zam's code, as copied: no Flatcap conventions, and none of the rules upstream's
        // code doesn't follow.
        files: zamiFiles,
        rules: {
          ...Object.fromEntries(
            Object.keys(flatcap.configs.oxlint.rules).map((rule) => [rule, "off"]),
          ),
          "no-unused-vars": "off",
          "no-unused-expressions": "off",
          "no-useless-escape": "off",
          "no-control-regex": "off",
          "no-unsafe-optional-chaining": "off",
          "unicorn/no-useless-spread": "off",
          "unicorn/no-useless-fallback-in-spread": "off",
          "unicorn/no-new-array": "off",
          "unicorn/prefer-string-starts-ends-with": "off",
          "unicorn/no-thenable": "off",
          "typescript/no-useless-empty-export": "off",
          "oxc/only-used-in-recursion": "off",
          "typescript/no-floating-promises": "off",
          "typescript/unbound-method": "off",
          "typescript/no-redundant-type-constituents": "off",
          "typescript/no-misused-spread": "off",
          "typescript/no-base-to-string": "off",
          "typescript/no-meaningless-void-operator": "off",
          "typescript/no-implied-eval": "off",
          "typescript/restrict-template-expressions": "off",
          "typescript/require-array-sort-compare": "off",
          "typescript/no-duplicate-type-constituents": "off",
          "typescript/no-useless-default-assignment": "off",
        },
      },
      {
        // Zami's React Native translations of Zam's Svelte components.
        files: ["**/*.svelte.zami.tsx"],
        plugins: ["typescript", "unicorn", "oxc", "react"],
        rules: {
          "no-unused-vars": "error",
          "no-unused-expressions": "error",
          "no-unsafe-optional-chaining": "error",
          "react/jsx-key": "error",
          "react/rules-of-hooks": "error",
        },
      },
    ],
  },
  fmt: {
    // Zam's copy of its own package.json: Prettier formats package.json files the way
    // JSON.stringify does, which oxfmt can't, so it keeps upstream's formatting.
    ignorePatterns: [
      ...zamIgnored,
      "package.zami.json",
      ...generated,
      "**/@prompts/**",
      ".zed/**",
      "zami.code-workspace",
    ],
    overrides: [
      {
        // Zam's own Prettier options (its .prettierrc), so a copy stays as close to
        // upstream as oxfmt can format it.
        files: zamiFiles,
        options: { printWidth: 80, tabWidth: 4, useTabs: false },
      },
    ],
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
    },
  },
});
