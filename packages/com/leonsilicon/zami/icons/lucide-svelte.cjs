// `lucide-svelte` for the Zami app: Metro resolves the specifier to this file. It serves
// each lucide-react-native icon (the version Zam pins) wrapped by `withClassName`.
//
// CommonJS, so the module can serve every icon name without listing them: translations
// import icons by name (`import { X } from "lucide-svelte"`), which Babel compiles to a
// property read on this module.
const lucide = require("lucide-react-native");
const { withClassName } = require("#icon");

const cache = new Map();

function icon(name) {
  let wrapped = cache.get(name);
  if (wrapped === undefined) {
    const Icon = lucide[name];
    if (Icon === undefined) return undefined;
    wrapped = withClassName(name, Icon);
    cache.set(name, wrapped);
  }
  return wrapped;
}

module.exports = new Proxy(
  {},
  {
    get: (_target, name) =>
      name === "__esModule" ? true : typeof name === "string" ? icon(name) : undefined,
    has: (_target, name) => typeof name === "string" && name in lucide,
  },
);
