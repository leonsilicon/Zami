// Upstream Zam's tests, run from their `.test.expo.ts` copies against Zami's Expo files,
// in the environment Zam uses (jsdom). Tests that render Svelte components are left out
// until they're rewritten for React Native. Loaded as a project by vite.config.ts.
import path from "node:path";
import { componentTestFiles, zamiExpo } from "@-/com.leonsilicon.zami.vite";
import { defineConfig } from "vite-plus";

const repoRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: repoRoot,
  plugins: [zamiExpo({ repoRoot })],
  test: {
    name: "zam",
    environment: "jsdom",
    setupFiles: ["@-/com.leonsilicon.zami.vite/zam-test-setup"],
    include: ["src/**/*.{test,spec}.expo.{js,ts}"],
    exclude: componentTestFiles(repoRoot),
  },
});
