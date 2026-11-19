// Hooks on a method of any object a plugin can reach: a store, the Matrix client, a
// module's exports. One replacement function per method runs every plugin's hooks, so
// they compose in the order they were added and each can be removed on its own.

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;
type Before = (args: unknown[], self: unknown) => unknown[] | void;
type After = (result: unknown, args: unknown[], self: unknown) => unknown;
type Instead = (args: unknown[], original: AnyFunction, self: unknown) => unknown;

interface Hooks {
  original: AnyFunction;
  replacement: AnyFunction;
  before: Before[];
  after: After[];
  instead: Instead[];
}

const hooksByObject = new WeakMap<object, Map<string, Hooks>>();

/** A module's top-level names, where a function can be replaced for the module itself. */
interface Names {
  has(name: string): boolean;
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

let namesOf: (object: object) => Names | undefined = () => undefined;

/**
 * For objects that are a module's exports: where to find the module's own names. A patch
 * of an exported function then replaces the module's name for it, so the module's own
 * calls reach the patch too, and an export that's a read-only getter can be patched.
 */
export function setModuleNames(source: typeof namesOf): void {
  namesOf = source;
}

let reportError = (what: string, error: unknown): void => {
  console.error(`[zami] ${what} threw`, error);
};

/** Where a hook's errors go. */
export function setHookErrorReporter(report: typeof reportError): void {
  reportError = report;
}

function call(hooks: Hooks, self: unknown, args: unknown[], construct?: AnyFunction): unknown {
  for (const hook of hooks.before.slice()) {
    try {
      const changed = hook(args, self);
      if (Array.isArray(changed)) args = changed;
    } catch (error) {
      reportError("a before hook", error);
    }
  }
  let invoke: AnyFunction =
    construct === undefined
      ? (...inner) => hooks.original.apply(self, inner)
      : (...inner) => Reflect.construct(hooks.original, inner, construct) as unknown;
  // An `instead` hook stands in for the method, so what it throws is the method's to throw.
  for (const hook of hooks.instead.slice()) {
    const next = invoke;
    invoke = (...inner) => hook(inner, next, self);
  }
  let result = invoke(...args);
  for (const hook of hooks.after.slice()) {
    try {
      const changed = hook(result, args, self);
      if (changed !== undefined) result = changed;
    } catch (error) {
      reportError("an after hook", error);
    }
  }
  return result;
}

/** Puts `value` where callers find `object[method]`. Returns whether they now do. */
function place(object: object, method: string, value: AnyFunction): boolean {
  const target = object as Record<string, unknown>;
  const names = namesOf(object);
  const named = names?.has(method) === true;
  // The module's own name first: an export that reads it (a getter) follows.
  if (named) names!.set(method, value);
  if (target[method] === value) return true;
  // Not exported at all: the module's own name was the whole of it.
  if (named && !(method in target)) return true;
  try {
    target[method] = value;
  } catch {
    // A read-only property: redefine it below if it allows that.
  }
  if (target[method] === value) return true;
  try {
    Object.defineProperty(target, method, {
      value,
      writable: true,
      configurable: true,
      enumerable: Object.getOwnPropertyDescriptor(target, method)?.enumerable ?? true,
    });
  } catch {
    // The caller says so.
  }
  return target[method] === value;
}

function hooksFor(object: object, method: string): Hooks {
  let methods = hooksByObject.get(object);
  if (methods === undefined) hooksByObject.set(object, (methods = new Map()));
  const existing = methods.get(method);
  if (existing) return existing;

  const names = namesOf(object);
  const original = names?.has(method)
    ? names.get(method)
    : (object as Record<string, unknown>)[method];
  if (typeof original !== "function")
    throw new TypeError(`"${method}" isn't a function on the object given, so it can't be patched`);
  const hooks: Hooks = {
    original: original as AnyFunction,
    replacement: null as unknown as AnyFunction,
    before: [],
    after: [],
    instead: [],
  };
  const replacement = function (this: unknown, ...args: unknown[]): unknown {
    // `new.target` is set when the method is a class that's being constructed.
    const constructing = new.target as AnyFunction | undefined;
    if (constructing === undefined) return call(hooks, this, args);
    return call(
      hooks,
      undefined,
      args,
      constructing === replacement ? hooks.original : constructing,
    );
  };
  // What callers read off the function itself stays the original's, live: its statics
  // (through the prototype chain) and, for a class, the prototype its instances get.
  Object.setPrototypeOf(replacement, original);
  if ("prototype" in original) replacement.prototype = original.prototype;
  Object.defineProperty(replacement, "name", { value: original.name, configurable: true });
  hooks.replacement = replacement;

  if (!place(object, method, replacement)) {
    throw new Error(
      `"${method}" is read-only there (a name the module only re-exports, a library's export, or a frozen object), so it can't be patched. Patch it where it's defined.`,
    );
  }
  methods.set(method, hooks);
  return hooks;
}

function current(object: object, method: string): unknown {
  const names = namesOf(object);
  return names?.has(method) ? names.get(method) : (object as Record<string, unknown>)[method];
}

function restoreIfUnused(object: object, method: string, hooks: Hooks): void {
  if (hooks.before.length + hooks.after.length + hooks.instead.length > 0) return;
  hooksByObject.get(object)?.delete(method);
  // Something else may have wrapped the replacement since: leave that chain alone (the
  // replacement with no hooks only calls the original).
  if (current(object, method) !== hooks.replacement) return;
  place(object, method, hooks.original);
}

function add<T>(object: object, method: string, list: (hooks: Hooks) => T[], hook: T): () => void {
  if ((typeof object !== "object" && typeof object !== "function") || object === null)
    throw new TypeError("patch: the first argument must be an object");
  const hooks = hooksFor(object, method);
  list(hooks).push(hook);
  return () => {
    const hooked = list(hooks);
    const index = hooked.indexOf(hook);
    if (index === -1) return;
    hooked.splice(index, 1);
    restoreIfUnused(object, method, hooks);
  };
}

/** Runs `hook` before `object[method]`; an array it returns replaces the arguments. */
export function patchBefore(object: object, method: string, hook: Before): () => void {
  return add(object, method, (hooks) => hooks.before, hook);
}

/** Runs `hook` after `object[method]`; anything but `undefined` it returns is the result. */
export function patchAfter(object: object, method: string, hook: After): () => void {
  return add(object, method, (hooks) => hooks.after, hook);
}

/** Runs `hook` in place of `object[method]`; it gets the method it replaced. */
export function patchInstead(object: object, method: string, hook: Instead): () => void {
  return add(object, method, (hooks) => hooks.instead, hook);
}
