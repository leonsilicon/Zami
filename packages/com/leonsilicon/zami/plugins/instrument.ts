// Gives each of Zam's modules an accessor for the names it declares at its top level (its
// functions, classes, constants and variables, exported or not), registered on
// `globalThis.__zamiModules` as the module finishes evaluating. That's what lets a plugin
// read and replace any of them (`zam.zami.modules`, `patch`, component patches): the
// accessor assigns the module's own binding, so the module's own calls see the new value,
// and so does every importer (ES module bindings are live, and Rollup keeps them so). A
// top-level `const` becomes a `let` so that it can be assigned, and an anonymous
// `export default` gets a name. Nothing else about the module changes.

/** An ESTree node, as Rollup's and acorn's parsers produce it. */
export interface EstreeNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** The name of the binding an anonymous `export default` gets. */
export const DEFAULT_BINDING = "__zami_default";

interface Edit {
  start: number;
  end: number;
  text: string;
}

function node(value: unknown): EstreeNode | null {
  return typeof value === "object" && value !== null && "type" in value
    ? (value as EstreeNode)
    : null;
}

function identifierName(value: unknown): string | null {
  const id = node(value);
  if (id?.type === "Identifier") return id.name as string;
  if (id?.type === "Literal" && typeof id.value === "string") return id.value;
  return null;
}

/** The names a declaration pattern (`a`, `{ a, b: [c] }`, `...rest`) binds. */
function patternNames(pattern: EstreeNode | null, names: string[]): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      names.push(pattern.name as string);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties as EstreeNode[]) {
        patternNames(
          node(property.type === "RestElement" ? property.argument : property.value),
          names,
        );
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements as (EstreeNode | null)[]) {
        patternNames(element, names);
      }
      break;
    case "RestElement":
      patternNames(node(pattern.argument), names);
      break;
    case "AssignmentPattern":
      patternNames(node(pattern.left), names);
      break;
  }
}

/** What a module declares: its names, and each export's local name. */
export interface Declarations {
  names: string[];
  exports: Record<string, string>;
}

/**
 * `code` with its top-level names made assignable and an accessor for them registered as
 * `id`, or null when it declares none.
 */
export function instrument(code: string, program: EstreeNode, id: string): string | null {
  const names = new Set<string>();
  const exports: Record<string, string> = {};
  const edits: Edit[] = [];

  function declare(declaration: EstreeNode, exported: boolean): void {
    if (declaration.type === "VariableDeclaration") {
      if (declaration.kind !== "const" && declaration.kind !== "let" && declaration.kind !== "var")
        return;
      const declared: string[] = [];
      for (const declarator of declaration.declarations as EstreeNode[]) {
        patternNames(node(declarator.id), declared);
      }
      for (const name of declared) {
        names.add(name);
        if (exported) exports[name] = name;
      }
      if (declaration.kind === "const") {
        edits.push({
          start: declaration.start,
          end: declaration.start + "const".length,
          text: "let",
        });
      }
      return;
    }
    if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
      const name = identifierName(declaration.id);
      if (name === null) return;
      names.add(name);
      if (exported) exports[name] = name;
    }
  }

  for (const statement of program.body as EstreeNode[]) {
    switch (statement.type) {
      case "VariableDeclaration":
      case "FunctionDeclaration":
      case "ClassDeclaration":
        declare(statement, false);
        break;
      case "ExportNamedDeclaration": {
        const declaration = node(statement.declaration);
        if (declaration) declare(declaration, true);
        else if (!statement.source) {
          for (const specifier of statement.specifiers as EstreeNode[]) {
            const local = identifierName(specifier.local);
            const exported = identifierName(specifier.exported);
            if (local !== null && exported !== null) exports[exported] = local;
          }
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = node(statement.declaration);
        if (!declaration) break;
        const named =
          (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
          identifierName(declaration.id);
        if (named) {
          names.add(named);
          exports.default = named;
        } else {
          edits.push({
            start: statement.start,
            end: declaration.start,
            text: `let ${DEFAULT_BINDING} = `,
          });
          edits.push({
            start: statement.end,
            end: statement.end,
            text: `\nexport { ${DEFAULT_BINDING} as default };`,
          });
          names.add(DEFAULT_BINDING);
          exports.default = DEFAULT_BINDING;
        }
        break;
      }
    }
  }
  if (names.size === 0) return null;

  let out = code;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  const list = [...names];
  const gets = list.map((name) => `case ${JSON.stringify(name)}: return ${name};`).join(" ");
  const sets = list
    .map((name) => `case ${JSON.stringify(name)}: ${name} = __zami_value; return true;`)
    .join(" ");
  return (
    `${out}\n;(globalThis.__zamiModules ??= new Map()).set(${JSON.stringify(id)}, {` +
    ` names: ${JSON.stringify(list)}, exports: ${JSON.stringify(exports)},` +
    ` get(__zami_name) { switch (__zami_name) { ${gets} } },` +
    ` set(__zami_name, __zami_value) { switch (__zami_name) { ${sets} } return false; } });\n`
  );
}

/**
 * The name a plugin uses for one of Zam's modules: how Zam's own code imports it
 * (`$lib/stores/rooms.svelte` for `src/lib/stores/rooms.svelte.ts`, `routes/+page.svelte`),
 * from its path under `src/`. Null for a file that isn't a module of the app's.
 */
export function moduleIdForPath(srcRelative: string): string | null {
  const path = srcRelative.replace(/^\/+/, "");
  if (!/\.(ts|js|svelte)$/.test(path)) return null;
  if (/(^|\/)__tests__\/|\.(test|spec)\.[tj]s$|\.d\.ts$|\.(worker|worklet)\.[tj]s$/.test(path))
    return null;
  const id = path.replace(/\.(ts|js)$/, "");
  return id.startsWith("lib/") ? `$${id}` : id;
}
