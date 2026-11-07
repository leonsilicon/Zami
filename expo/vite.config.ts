import { defineConfig } from "vite-plus";
import flatcap from "eslint-plugin-flatcap";

// `vp check` (lint, format, types) covers this workspace. The `.expo.` files in Zam's
// tree are handled by `_zami fmt` and `_zami lint`, which use Zam's own Prettier options
// so copied files stay byte-identical to upstream; Zam's own files are never touched.
// Generated: native projects (Expo prebuild), scratch output, and the class-name types
// Uniwind rewrites on every Metro start.
const generated = [
  "apps/zami/ios/**",
  "apps/zami/android/**",
  ".zami/**",
  "apps/zami/uniwind-types.d.ts",
];

export default defineConfig({
  lint: {
    ...flatcap.configs.oxlint,
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: generated,
    overrides: [
      {
        // node:test registers top-level tests through promises its runner manages.
        files: ["**/__tests__/**"],
        rules: { "typescript/no-floating-promises": "off" },
      },
    ],
  },
  fmt: {
    ignorePatterns: [...generated, "**/@prompts/**"],
  },
  // `vp test`: Zami's own tooling. Upstream Zam's tests (their `.test.expo.ts` copies,
  // against Zami's Expo files) have their own config, vitest.zam.config.ts, because they
  // run from the repository root; `vp run test` runs both.
  test: {
    include: ["packages/**/__tests__/*.test.ts"],
    environment: "node",
  },
  run: {
    tasks: {
      test: { cache: false, command: "vp test run && vp test run -c vitest.zam.config.ts" },
      "test:zam": { cache: false, command: "vp test run -c vitest.zam.config.ts" },
      typecheck: { command: "tsc -p . && tsc -p apps/zami" },
      // Bundles the app's JS for both platforms with Metro (no native build): proves every
      // import resolves to an Expo file and every file transforms.
      bundle: {
        cache: false,
        command:
          "cd apps/zami && expo export --platform ios --platform android --dev --output-dir ../../.zami/bundle",
      },
      "fmt:zam": { cache: false, command: "_zami fmt" },
      "check:zam": { cache: false, command: "_zami fmt --check && _zami lint && _zami check" },
    },
  },
});
