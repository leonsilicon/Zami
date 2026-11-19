// How the app's modules are named for plugins: as Zam's own code imports them.

const ZAMI_FILE = /\.zami\.tsx?$/;

/**
 * The specifier Zam's code imports a module by, from its `require.context` key:
 * `./lib/stores/rooms.svelte.zami.ts` → `$lib/stores/rooms.svelte`, and
 * `./routes/+page.svelte.zami.tsx` → `routes/+page.svelte`.
 */
export function specifierForKey(key: string): string {
  const path = key.replace(/^\.\//, "").replace(ZAMI_FILE, "");
  return path.startsWith("lib/") ? `$${path}` : path;
}

/** What a plugin may write for a specifier: with the file's extension, or `.zami`. */
export function normalizeSpecifier(specifier: string): string {
  return specifier.replace(/\.(?:zami\.)?(?:ts|tsx|js)$/, "").replace(/\.zami$/, "");
}

const COMPONENT_KEY = /\/([^/]+)\.svelte\.zami\.tsx$/;

/** The name of the component a key holds (a translated `.svelte` file), or undefined. */
export function componentNameForKey(key: string): string | undefined {
  return COMPONENT_KEY.exec(key)?.[1];
}
