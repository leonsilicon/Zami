// `import()` of an ES module's source for Hermes, which can't import a module at run time
// (from a `blob:` URL or anywhere else): the module is rewritten to the body of an async
// function and run with `new Function`. Zam loads plugins this way (`import(blobUrl)`).
//
//   import { x } from "https://…"  -> const { x } = await import("https://…") at the top
//   export function f() {}         -> function f() {}, exported as a live binding
//   export default expr            -> const default = expr
//   import.meta, import(x)         -> the module's meta and the same importer
//
// The namespace it resolves to is a module namespace's shape: a null-prototype,
// non-extensible object of getters (so exports stay live bindings), sorted, tagged "Module".
import { parse, type Node as AcornNode } from "acorn";

/** A module namespace: its exports by name. */
export type ModuleNamespace = Readonly<Record<string, unknown>>;

export interface ImportModuleOptions {
  /** Names the module's code sees in place of globals, as Zam's code sees Zami's
   *  `window`, `document`, … Each must be an identifier. */
  scope?: Readonly<Record<string, unknown>>;
  /** The module's URL: `import.meta.url`, and the base of its relative imports. */
  url?: string;
  /** Loads what the module imports, statically or with `import()`. By default http(s)
   *  and data: URLs are fetched and evaluated with the same options (each URL once);
   *  anything else rejects, as a browser does for a module loaded from a `blob:` URL. */
  load?: (specifier: string, referrer: string | undefined) => Promise<ModuleNamespace>;
  /** An IndexedDB database to keep compiled modules in between launches (see compileCached).
   *  Compiled modules are always kept for the rest of the run. */
  compileCache?: string;
}

interface Patch {
  start: number;
  end: number;
  text: string;
}

/** The module rewritten as an async function body, with what it needs from outside. */
export interface CompiledModule {
  /** The body: run it with `IMPORT`, `META` and `NAMESPACE` (below) in scope. */
  body: string;
}

const IMPORT = "__zami_import";
const META = "__zami_meta";
const NAMESPACE = "__zami_namespace";
const DEFAULT = "__zami_default";
const IDENTIFIER = /^[$A-Z_a-z][\w$]*$/;

type Estree = AcornNode & Record<string, unknown>;

/** The names a binding pattern declares (`{ a, b: [c, ...d] }` → a, c, d). */
function patternNames(pattern: Estree | null | undefined, out: string[] = []): string[] {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name as string);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties as Estree[])
        patternNames((prop.type === "RestElement" ? prop.argument : prop.value) as Estree, out);
      break;
    case "ArrayPattern":
      for (const element of pattern.elements as (Estree | null)[]) patternNames(element, out);
      break;
    case "RestElement":
      patternNames(pattern.argument as Estree, out);
      break;
    case "AssignmentPattern":
      patternNames(pattern.left as Estree, out);
      break;
  }
  return out;
}

/** An import/export specifier's name: an identifier, or a string (`export { a as "b c" }`). */
function specifierName(node: Estree): string {
  return node.type === "Literal" ? String(node.value) : (node.name as string);
}

/** Every node below `node`, depth first. */
function walk(node: Estree, visit: (node: Estree) => void): void {
  visit(node);
  for (const key in node) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value)
        if (child !== null && typeof child === "object" && typeof child.type === "string")
          walk(child as Estree, visit);
    } else if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as Estree).type === "string"
    ) {
      walk(value as Estree, visit);
    }
  }
}

/**
 * Rewrites an ES module to the body of an async function, for `importModule`. Throws a
 * SyntaxError when it doesn't parse as a module.
 */
export function compileModule(source: string): CompiledModule {
  let program: Estree;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowHashBang: true,
    }) as unknown as Estree;
  } catch (error) {
    throw new SyntaxError((error as Error).message);
  }

  const patches: Patch[] = [];
  const imports: string[] = [];
  // Export name → the expression that reads it (a local name, or a module's member).
  const exports = new Map<string, string>();
  const stars: string[] = [];
  let moduleCount = 0;
  const importModuleVar = (specifier: string) => {
    const name = `__zami_module${moduleCount++}`;
    imports.push(`const ${name} = await ${IMPORT}(${JSON.stringify(specifier)});`);
    return name;
  };
  const remove = (node: Estree) => patches.push({ start: node.start, end: node.end, text: "" });

  for (const node of program.body as Estree[]) {
    switch (node.type) {
      case "ImportDeclaration": {
        const mod = importModuleVar((node.source as Estree).value as string);
        for (const specifier of node.specifiers as Estree[]) {
          const local = (specifier.local as Estree).name as string;
          const read =
            specifier.type === "ImportNamespaceSpecifier"
              ? mod
              : specifier.type === "ImportDefaultSpecifier"
                ? `${mod}.default`
                : `${mod}[${JSON.stringify(specifierName(specifier.imported as Estree))}]`;
          imports.push(`const ${local} = ${read};`);
        }
        remove(node);
        break;
      }
      case "ExportNamedDeclaration": {
        const declaration = node.declaration as Estree | null;
        if (declaration) {
          // `export const a = 1` / `export function f() {}`: drop `export`.
          patches.push({ start: node.start, end: declaration.start, text: "" });
          const names =
            declaration.type === "VariableDeclaration"
              ? (declaration.declarations as Estree[]).flatMap((d) => patternNames(d.id as Estree))
              : [(declaration.id as Estree).name as string];
          for (const name of names) exports.set(name, name);
          break;
        }
        const source = node.source as Estree | null;
        const mod = source ? importModuleVar(source.value as string) : null;
        for (const specifier of node.specifiers as Estree[]) {
          const local = specifierName(specifier.local as Estree);
          exports.set(
            specifierName(specifier.exported as Estree),
            mod
              ? local === "default"
                ? `${mod}.default`
                : `${mod}[${JSON.stringify(local)}]`
              : local,
          );
        }
        remove(node);
        break;
      }
      case "ExportAllDeclaration": {
        const mod = importModuleVar((node.source as Estree).value as string);
        if (node.exported) exports.set(specifierName(node.exported as Estree), mod);
        else stars.push(mod);
        remove(node);
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = node.declaration as Estree;
        const id = declaration.id as Estree | null | undefined;
        if (
          (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
          id
        ) {
          // `export default function f() {}`: f stays a declaration.
          patches.push({ start: node.start, end: declaration.start, text: "" });
          exports.set("default", id.name as string);
        } else {
          // An expression or an anonymous declaration: a const, ended explicitly so the
          // next line can't continue it.
          patches.push({ start: node.start, end: declaration.start, text: `const ${DEFAULT} = ` });
          patches.push({ start: node.end, end: node.end, text: ";" });
          exports.set("default", DEFAULT);
        }
        break;
      }
    }
  }

  // `import.meta` and `import(x)`, anywhere.
  walk(program, (node) => {
    if (node.type === "MetaProperty" && (node.meta as Estree).name === "import")
      patches.push({ start: node.start, end: node.end, text: META });
    else if (node.type === "ImportExpression")
      patches.push({ start: node.start, end: node.start + "import".length, text: IMPORT });
  });

  patches.sort((a, b) => a.start - b.start || a.end - b.end);
  let body = "";
  let at = 0;
  for (const patch of patches) {
    body += source.slice(at, patch.start) + patch.text;
    at = Math.max(at, patch.end);
  }
  body += source.slice(at);
  // A hashbang is only valid at the very start of a script.
  if (body.startsWith("#!")) body = `//${body}`;

  const getters = [...exports].map(([name, read]) => `[${JSON.stringify(name)}, () => ${read}]`);
  return {
    body: [
      ...imports,
      body,
      `;return ${NAMESPACE}([${getters.join(", ")}], [${stars.join(", ")}]);`,
    ].join("\n"),
  };
}

// --- Compiled modules, kept by their source's hash ---
//
// Parsing a plugin bundle with acorn and rewriting it runs on the JS thread, and took long
// for a large bundle at every launch. The result depends only on the source, so it is kept:
// for the rest of the run in memory, and between launches in IndexedDB (`compileCache`).

/** Changes whenever compileModule's output would, so older cached bodies aren't used. */
const COMPILE_FORMAT = 1;
const CACHE_STORE = "modules";
/** Compiled modules kept between launches; the oldest go first. */
const CACHE_LIMIT = 32;

/** cyrb53, a 53-bit string hash. */
function hash53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A source's cache key: two hashes and its length, so a collision needs all three to match. */
export function moduleSourceKey(source: string): string {
  return `${COMPILE_FORMAT}:${source.length.toString(36)}:${hash53(source, 0).toString(36)}:${hash53(source, 1).toString(36)}`;
}

const compiledBodies = new Map<string, string>();

function openCompileCache(name: string): Promise<IDBDatabase | null> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(CACHE_STORE).createIndex("at", "at");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCompiled(name: string, key: string): Promise<string | undefined> {
  const db = await openCompileCache(name);
  if (!db) return undefined;
  try {
    return await new Promise((resolve) => {
      const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(key);
      request.onsuccess = () => {
        const body = (request.result as { body?: unknown } | undefined)?.body;
        resolve(typeof body === "string" ? body : undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  } finally {
    db.close();
  }
}

async function writeCompiled(name: string, key: string, body: string): Promise<void> {
  const db = await openCompileCache(name);
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(CACHE_STORE, "readwrite");
      const store = transaction.objectStore(CACHE_STORE);
      store.put({ body, at: Date.now() }, key);
      const keys = store.index("at").getAllKeys();
      keys.onsuccess = () => {
        for (const old of keys.result.slice(0, Math.max(0, keys.result.length - CACHE_LIMIT)))
          store.delete(old);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/**
 * compileModule's body for `source`, from this run's or (with `cacheName`) an earlier run's
 * compile when there is one. A cache that can't be read or written only costs a compile.
 */
export async function compileCached(source: string, cacheName?: string): Promise<string> {
  const key = moduleSourceKey(source);
  let body = compiledBodies.get(key);
  if (body !== undefined) return body;
  if (cacheName) body = await readCompiled(cacheName, key).catch(() => undefined);
  if (body === undefined) {
    body = compileModule(source).body;
    if (cacheName) void writeCompiled(cacheName, key, body).catch(() => {});
  }
  compiledBodies.set(key, body);
  return body;
}

/** A module namespace object of getters over `exports`, plus `export *` modules' names. */
function namespace(
  exports: readonly (readonly [string, () => unknown])[],
  stars: readonly ModuleNamespace[],
): ModuleNamespace {
  const getters = new Map<string, () => unknown>(exports);
  for (const star of stars)
    for (const name of Object.keys(star))
      if (name !== "default" && !getters.has(name)) getters.set(name, () => star[name]);
  const ns = Object.create(null) as Record<string | symbol, unknown>;
  for (const name of [...getters.keys()].sort())
    Object.defineProperty(ns, name, { enumerable: true, get: getters.get(name) });
  Object.defineProperty(ns, Symbol.toStringTag, { value: "Module" });
  return Object.preventExtensions(ns);
}

const fetched = new Map<string, Promise<ModuleNamespace>>();

/** The default `load`: http(s) and data: URLs, resolved against the importing module. */
function loadUrl(options: ImportModuleOptions) {
  return (specifier: string, referrer: string | undefined): Promise<ModuleNamespace> => {
    let url: URL;
    try {
      url = new URL(
        specifier,
        referrer && /^(?:https?|data):/.test(referrer) ? referrer : undefined,
      );
    } catch {
      return Promise.reject(new TypeError(`Failed to resolve module specifier "${specifier}"`));
    }
    if (!/^(?:https?|data):$/.test(url.protocol))
      return Promise.reject(
        new TypeError(`Can't import "${specifier}": only http(s) and data: URLs load`),
      );
    const href = url.href;
    let promise = fetched.get(href);
    if (!promise) {
      promise = (async () => {
        const res = await fetch(href);
        if (!res.ok) throw new TypeError(`Failed to fetch module ${href} (HTTP ${res.status})`);
        return importModule(await res.text(), { ...options, url: href });
      })();
      fetched.set(href, promise);
      promise.catch(() => fetched.delete(href));
    }
    return promise;
  };
}

/**
 * Evaluates an ES module's source and resolves to its namespace, as `import()` of it would.
 * Rejects with a SyntaxError if it doesn't parse, or with whatever its evaluation throws.
 */
export async function importModule(
  source: string,
  options: ImportModuleOptions = {},
): Promise<ModuleNamespace> {
  const body = await compileCached(source, options.compileCache);
  const load = options.load ?? loadUrl(options);
  const url = options.url;
  const importer = (specifier: unknown) => {
    try {
      return load(String(specifier), url);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const meta = Object.assign(Object.create(null) as Record<string, unknown>, {
    url: url ?? "about:blank",
    resolve: (specifier: string) => new URL(specifier, url).href,
  });

  const scope = Object.entries(options.scope ?? {}).filter(
    ([name]) => IDENTIFIER.test(name) && name !== IMPORT && name !== META && name !== NAMESPACE,
  );
  // The module's code runs in an inner function, so its own declarations may shadow the
  // scope's names (a parameter can't be redeclared with let/const in the same function).
  // oxlint-disable-next-line typescript/no-implied-eval -- evaluating the module is the point
  const factory = new Function(
    IMPORT,
    META,
    NAMESPACE,
    ...scope.map(([name]) => name),
    `"use strict";\nreturn async function () {\n"use strict";\n${body}\n};` +
      (url ? `\n//# sourceURL=${url.replace(/\s/g, "%20")}` : ""),
  ) as (...args: unknown[]) => () => Promise<ModuleNamespace>;
  const run = factory(importer, meta, namespace, ...scope.map(([, value]) => value));
  return run.call(undefined);
}
