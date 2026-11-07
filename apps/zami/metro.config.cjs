const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const { withZami } = require("@-/com.leonsilicon.zami.metro");

const repoRoot = path.resolve(__dirname, "../..");

module.exports = withUniwindConfig(withZami(getDefaultConfig(__dirname), { repoRoot }), {
  // The Zami version of Zam's stylesheet; it loads Zam's Tailwind config with `@config`.
  // Uniwind resolves this against the working directory, so it must be relative.
  cssEntryFile: path.relative(process.cwd(), path.join(repoRoot, "src/app.zami.css")),
  dtsFile: path.join(__dirname, "uniwind-types.d.ts"),
  // Zam's stylesheet scopes themes as `:root[data-theme="light" | "amoled"]`; patches/uniwind
  // maps those to Uniwind themes. Its unscoped `:root` is the dark theme.
  extraThemes: ["amoled"],
});
