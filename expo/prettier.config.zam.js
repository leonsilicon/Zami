// Prettier options for the `.expo.` files in Zam's tree: Zam's own .prettierrc, minus
// its Svelte plugin (no `.svelte` file is formatted here). Using exactly Zam's options
// keeps copied files byte-identical to upstream, so three-way merges stay clean.
import { readFileSync } from "node:fs";

const {
  plugins: _plugins,
  overrides: _overrides,
  ...zam
} = JSON.parse(readFileSync(new URL("../.prettierrc", import.meta.url), "utf8"));

export default zam;
