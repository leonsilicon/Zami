// The names declared at the top level of the app's modules, readable and settable from
// outside them. The Metro transformer gives each of Zam's modules an accessor for its
// names (@-/com.leonsilicon.zami.metro's bindings plugin), registered in a table when the
// module first runs. Setting a name changes it for the module's own code too, which is
// what lets a plugin replace a function the module calls itself, or one it only exports
// through a read-only getter (as most are).

type Accessor = (name?: string, set?: boolean, value?: unknown) => unknown;

/** One module's top-level names. */
export interface ModuleBindings {
  names(): readonly string[];
  has(name: string): boolean;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

function table(): Map<string, Accessor> | undefined {
  return (globalThis as { __zamiBindings?: Map<string, Accessor> }).__zamiBindings;
}

/** Each module's names, with the accessor they were read from: Fast Refresh runs a
 *  changed module again, and the new run registers its own. */
const byKey = new Map<string, { accessor: Accessor; bindings: ModuleBindings }>();

/**
 * The names of the module the table knows as `key` (its `require.context` key,
 * `./lib/stores/toasts.svelte.zami.ts`), or undefined for a module with none: one that
 * hasn't run yet, or that isn't one of Zam's.
 */
export function bindingsForKey(key: string): ModuleBindings | undefined {
  const accessor = table()?.get(key);
  if (accessor === undefined) return undefined;
  const known = byKey.get(key);
  if (known?.accessor === accessor) return known.bindings;
  const names = accessor() as string[];
  const declared = new Set(names);
  const bindings: ModuleBindings = {
    names: () => names,
    has: (name) => declared.has(name),
    get: (name) => (declared.has(name) ? accessor(name, false) : undefined),
    set: (name, value) => {
      if (!declared.has(name)) throw new Error(`The module declares no "${name}" at its top level`);
      accessor(name, true, value);
    },
  };
  byKey.set(key, { accessor, bindings });
  return bindings;
}

/** Which module each exports object handed to a plugin belongs to. */
const keys = new WeakMap<object, string>();

/** Remembers that `exports` is what the module `key` exports. */
export function rememberModule(exports: unknown, key: string): void {
  if ((typeof exports === "object" || typeof exports === "function") && exports !== null)
    keys.set(exports, key);
}

/** The top-level names of the module whose exports `exports` is, if it's one of Zam's. */
export function bindingsOf(exports: object): ModuleBindings | undefined {
  const key = keys.get(exports);
  return key === undefined ? undefined : bindingsForKey(key);
}
