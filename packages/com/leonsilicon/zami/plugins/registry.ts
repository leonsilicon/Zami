// Zam's modules at run time: each one Zam's build includes (an `import.meta.glob` over
// `src/`, so modules the app never loads itself are there too), loaded on request, and the
// accessors instrument.ts gave them for their top-level names.

export interface ModuleAccessor {
  readonly names: readonly string[];
  /** Exported name → local name. */
  readonly exports: Readonly<Record<string, string>>;
  get(name: string): unknown;
  set(name: string, value: unknown): boolean;
}

declare global {
  var __zamiModules: Map<string, ModuleAccessor> | undefined;
}

interface GlobImport {
  glob(patterns: string[]): Record<string, () => Promise<Record<string, unknown>>>;
}

// Literal patterns: Vite expands them when it builds the app.
const loaders = (import.meta as unknown as GlobImport).glob([
  "/src/**/*.ts",
  "/src/**/*.js",
  "/src/**/*.svelte",
  "!/src/**/*.test.ts",
  "!/src/**/*.spec.ts",
  "!/src/**/__tests__/**",
  "!/src/**/*.d.ts",
  "!/src/**/*.worker.ts",
  "!/src/**/*.worker.js",
  "!/src/**/*.worklet.ts",
  "!/src/**/*.worklet.js",
  "!/src/service-worker.ts",
  "!/src/service-worker.js",
  "!/src/**/*.server.ts",
  "!/src/hooks.server.ts",
]);

/** The id of the module at a glob key (`/src/lib/a.svelte.ts` → `$lib/a.svelte`). */
export function idForPath(path: string): string {
  const id = path.replace(/^\/src\//, "").replace(/\.(ts|js)$/, "");
  return id.startsWith("lib/") ? `$${id}` : id;
}

const paths = new Map<string, string>();
for (const key of Object.keys(loaders)) paths.set(idForPath(key), key);

const namespaces = new Map<string, Record<string, unknown>>();

function accessors(): Map<string, ModuleAccessor> {
  return (globalThis.__zamiModules ??= new Map());
}

/** A module's id from the ways a plugin may name it: as Zam imports it, or by its path. */
export function normalizeId(specifier: string): string {
  let id = specifier
    .trim()
    .replace(/^\/+/, "")
    .replace(/^src\//, "");
  if (id.startsWith("lib/")) id = `$${id}`;
  return id.replace(/\.(ts|js)$/, "");
}

export function moduleIds(prefix = ""): string[] {
  return [...paths.keys()].filter((id) => id.startsWith(prefix)).toSorted();
}

export function hasModule(specifier: string): boolean {
  return paths.has(normalizeId(specifier));
}

export function accessorFor(specifier: string): ModuleAccessor | undefined {
  return accessors().get(normalizeId(specifier));
}

export function isLoaded(specifier: string): boolean {
  const id = normalizeId(specifier);
  return accessors().has(id) || namespaces.has(id);
}

const MODULE = Symbol.for("zami.module");

/** The id of the module a `require`/`import` result stands for, if it is one. */
export function moduleIdOf(value: unknown): string | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null)
    return undefined;
  const id = (value as Record<symbol, unknown>)[MODULE];
  return typeof id === "string" ? id : undefined;
}

/** The local name behind `name` in a module: an export's, or a top-level name. */
export function localName(id: string, name: string): string | undefined {
  const accessor = accessors().get(id);
  if (!accessor) return undefined;
  if (Object.hasOwn(accessor.exports, name)) return accessor.exports[name];
  return accessor.names.includes(name) ? name : undefined;
}

export function readName(id: string, name: string): unknown {
  const namespace = namespaces.get(id);
  if (namespace && Object.hasOwn(namespace, name)) return namespace[name];
  const local = localName(id, name);
  return local === undefined ? undefined : accessors().get(id)?.get(local);
}

export function writeName(id: string, name: string, value: unknown): void {
  const local = localName(id, name);
  if (local === undefined || !accessors().get(id)?.set(local, value)) {
    throw new Error(`${id} has no top-level name "${name}" to set`);
  }
}

function proxyFor(id: string): Record<string, unknown> {
  const keys = (): string[] => {
    const accessor = accessors().get(id);
    return [
      ...new Set([
        ...Object.keys(accessor?.exports ?? {}),
        ...(accessor?.names ?? []),
        ...Object.keys(namespaces.get(id) ?? {}),
      ]),
    ];
  };
  return new Proxy(Object.create(null) as Record<string | symbol, unknown>, {
    get(_, key) {
      if (key === MODULE) return id;
      return typeof key === "string" ? readName(id, key) : undefined;
    },
    set(_, key, value) {
      if (typeof key !== "string") return false;
      writeName(id, key, value);
      return true;
    },
    has: (_, key) => typeof key === "string" && keys().includes(key),
    ownKeys: () => keys(),
    getOwnPropertyDescriptor: (_, key) =>
      typeof key === "string" && keys().includes(key)
        ? { configurable: true, enumerable: true, writable: true, value: readName(id, key) }
        : undefined,
  });
}

/** One of Zam's modules, loaded if it isn't yet. */
export async function importModule(specifier: string): Promise<Record<string, unknown>> {
  const id = normalizeId(specifier);
  const path = paths.get(id);
  if (path === undefined) throw new Error(`Zam has no module ${id}`);
  // An instrumented module can already be running while its ES module namespace is still
  // missing here. The namespace supplies re-exports the accessor doesn't declare locally.
  if (!namespaces.has(id)) {
    const load = loaders[path];
    if (load) namespaces.set(id, await load());
  }
  return proxyFor(id);
}

/** One of Zam's modules that has already loaded (the app loads most of them as it starts). */
export function requireModule(specifier: string): Record<string, unknown> {
  const id = normalizeId(specifier);
  if (!paths.has(id)) throw new Error(`Zam has no module ${id}`);
  if (!isLoaded(id)) {
    throw new Error(
      `${id} hasn't loaded yet: use \`await zam.zami.import(${JSON.stringify(id)})\``,
    );
  }
  return proxyFor(id);
}
