// Makes every name declared at the top level of Zam's modules settable from outside the
// module, for plugins (@-/com.leonsilicon.zami.plugins): a plugin can then replace any
// function, class or constant of the app, and the module's own code sees the replacement
// too, which patching a module's exports can't do (most exports are read-only getters,
// and a call inside the module never goes through them).
//
// Each module gets one more statement at its end, registering an accessor for its names:
//
//   (globalThis.__zamiBindings ??= new Map()).set("./lib/stores/toasts.svelte.zami.ts",
//     function (name, set, value) {
//       switch (name) {
//         case undefined: return ["showToast", "TOAST_TTL_MS"];
//         case "showToast": return set ? ((showToast = value), true) : showToast;
//         case "TOAST_TTL_MS": return set ? ((TOAST_TTL_MS = value), true) : TOAST_TTL_MS;
//       }
//     });
//
// A function or class declaration's name can be assigned as it is; a `const` becomes a
// `let` so that it can be. Nothing else changes, and nothing runs until a plugin asks.
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SOURCE_ROOT = path.join(REPO_ROOT, "src") + path.sep;
const MODULE = /\.zami\.tsx?$/;
const TEST = /\.(test|spec)\.zami\./;

/**
 * A module's key in the table: its path under `src/`, written as `require.context` keys
 * it there (`./lib/stores/toasts.svelte.zami.ts`). Undefined for files that get no
 * accessor: anything outside Zam's source, and tests.
 */
export function bindingsKey(filename) {
  if (typeof filename !== "string" || !filename.startsWith(SOURCE_ROOT)) return undefined;
  if (!MODULE.test(filename) || TEST.test(filename)) return undefined;
  return `./${filename.slice(SOURCE_ROOT.length).split(path.sep).join("/")}`;
}

export function zamiBindingsPlugin({ types: t }) {
  /** The names a top-level statement declares, and whether they can be assigned. */
  function declared(statement) {
    const declaration =
      (t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement)) &&
      statement.declaration
        ? statement.declaration
        : statement;
    // (`declare` and overload signatures are types: TypeScript's transform removes them.)
    if (declaration.declare) return [];
    if (t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration))
      return declaration.id ? [declaration.id.name] : [];
    if (
      t.isVariableDeclaration(declaration) &&
      ["const", "let", "var"].includes(declaration.kind) &&
      declaration.declarations.every((declarator) => t.isIdentifier(declarator.id))
    ) {
      if (declaration.kind === "const") declaration.kind = "let";
      return declaration.declarations.map((declarator) => declarator.id.name);
    }
    return [];
  }

  return {
    name: "zami-bindings",
    visitor: {
      Program: {
        // On the way out: TypeScript's own declarations (enums, namespaces) are plain
        // JavaScript by now, and its types are gone.
        exit(programPath) {
          const key = bindingsKey(this.filename);
          if (key === undefined) return;
          const names = [...new Set(programPath.node.body.flatMap(declared))];
          if (names.length === 0) return;

          const name = t.identifier("name");
          const set = t.identifier("set");
          const value = t.identifier("value");
          // The accessor's own parameters must not hide a module's name.
          for (const parameter of [name, set, value]) {
            while (names.includes(parameter.name)) parameter.name = `_${parameter.name}`;
          }
          const cases = [
            t.switchCase(t.identifier("undefined"), [
              t.returnStatement(t.arrayExpression(names.map((each) => t.stringLiteral(each)))),
            ]),
            ...names.map((each) =>
              t.switchCase(t.stringLiteral(each), [
                t.returnStatement(
                  t.conditionalExpression(
                    t.cloneNode(set),
                    t.sequenceExpression([
                      t.assignmentExpression("=", t.identifier(each), t.cloneNode(value)),
                      t.booleanLiteral(true),
                    ]),
                    t.identifier(each),
                  ),
                ),
              ]),
            ),
          ];
          const accessor = t.functionExpression(
            null,
            [name, set, value],
            t.blockStatement([t.switchStatement(t.cloneNode(name), cases)]),
          );
          const table = t.assignmentExpression(
            "??=",
            t.memberExpression(t.identifier("globalThis"), t.identifier("__zamiBindings")),
            t.newExpression(t.identifier("Map"), []),
          );
          programPath.pushContainer(
            "body",
            t.expressionStatement(
              t.callExpression(t.memberExpression(table, t.identifier("set")), [
                t.stringLiteral(key),
                accessor,
              ]),
            ),
          );
        },
      },
    },
  };
}
