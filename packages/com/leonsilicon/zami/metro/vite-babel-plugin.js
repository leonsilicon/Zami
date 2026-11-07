// Babel plugin that gives Zam's code the Vite build-time features it relies on, so the
// `.zami.` copies can stay byte-identical to upstream:
//
//   import.meta.env.DEV / PROD / MODE   -> __DEV__-based values
//   import.meta.env.VITE_FOO            -> process.env.EXPO_PUBLIC_FOO (inlined by Expo)
//   __APP_VERSION__                     -> Zam's package.json version (Zam's Vite `define`)
//   import.meta.glob("./dir/*.ts", …)   -> a require.context over the Zami versions, keyed
//                                          by the upstream paths Zam's code looks up
//   new Worker(new URL("./w.ts",        -> throws where it runs: React Native has no Web
//     import.meta.url))                    Workers, and Metro would otherwise bundle the
//                                          worker and whatever wasm it imports
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");

let cachedVersion;
export function appVersion() {
  cachedVersion ??= JSON.parse(
    // Zam's package.json as synced into its Zami version (the root package.json is Zami's).
    fs.readFileSync(path.join(REPO_ROOT, "package.zami.json"), "utf8"),
  ).version;
  return cachedVersion;
}

function isImportMeta(node) {
  return (
    node?.type === "MetaProperty" && node.meta.name === "import" && node.property.name === "meta"
  );
}

function memberName(node) {
  if (node.computed) return node.property.type === "StringLiteral" ? node.property.value : null;
  return node.property.type === "Identifier" ? node.property.name : null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `./locales/*.ts` -> require.context arguments and the key rewrite back to upstream paths. */
function globToContext(pattern) {
  const slash = pattern.lastIndexOf("/");
  const dir = pattern.slice(0, slash) || ".";
  const file = pattern.slice(slash + 1);
  if (/[*?{[]/.test(dir) || !/^\.\.?\//.test(pattern)) {
    throw new Error(
      `import.meta.glob("${pattern}"): only "./dir/<file pattern>" is supported in Zami`,
    );
  }
  const extension = /\.(ts|js|svelte)$/.exec(file)?.[0];
  if (extension === undefined)
    throw new Error(`import.meta.glob("${pattern}"): unsupported file type`);
  const zamiExtension = extension === ".svelte" ? ".svelte.zami.tsx" : `.zami${extension}`;
  const stem = file.slice(0, -extension.length).split("*").map(escapeRegExp).join("[^/]*");
  return { dir, regex: `^\\.\\/${stem}${escapeRegExp(zamiExtension)}$`, zamiExtension, extension };
}

export function zamiVitePlugin({ types: t, template }) {
  const buildGlob = template.expression(`
    ((context) => Object.fromEntries(context.keys().map((key) => [
      DIR + "/" + key.slice(2, -ZAMI_EXT.length) + EXT,
      EAGER ? context(key) : () => Promise.resolve(context(key)),
    ])))(require.context(DIR_LITERAL, false, REGEX, MODE))
  `);
  const buildNoWorker = template.expression(`
    (() => {
      throw new Error("Zami: Web Workers don't exist in React Native (" + WORKER + ")");
    })()
  `);
  return {
    name: "zami-vite",
    visitor: {
      NewExpression(nodePath) {
        const { node } = nodePath;
        const [urlNode] = node.arguments;
        if (
          node.callee.type === "Identifier" &&
          (node.callee.name === "Worker" || node.callee.name === "SharedWorker") &&
          !nodePath.scope.hasBinding(node.callee.name) &&
          urlNode?.type === "NewExpression" &&
          urlNode.callee.type === "Identifier" &&
          urlNode.callee.name === "URL" &&
          urlNode.arguments[0]?.type === "StringLiteral" &&
          urlNode.arguments[1]?.type === "MemberExpression" &&
          isImportMeta(urlNode.arguments[1].object)
        ) {
          nodePath.replaceWith(
            buildNoWorker({ WORKER: t.stringLiteral(urlNode.arguments[0].value) }),
          );
        }
      },
      Identifier(nodePath) {
        if (
          nodePath.node.name === "__APP_VERSION__" &&
          nodePath.isReferencedIdentifier() &&
          !nodePath.scope.hasBinding("__APP_VERSION__")
        ) {
          nodePath.replaceWith(t.stringLiteral(appVersion()));
        }
      },
      MemberExpression(nodePath) {
        const { node } = nodePath;
        if (
          !(
            node.object.type === "MemberExpression" &&
            isImportMeta(node.object.object) &&
            memberName(node.object) === "env"
          )
        ) {
          return;
        }
        const name = memberName(node);
        if (name === "DEV") nodePath.replaceWith(t.identifier("__DEV__"));
        else if (name === "PROD")
          nodePath.replaceWith(t.unaryExpression("!", t.identifier("__DEV__")));
        else if (name === "MODE")
          nodePath.replaceWith(template.expression.ast`__DEV__ ? "development" : "production"`);
        else if (name === "SSR") nodePath.replaceWith(t.booleanLiteral(false));
        else if (name?.startsWith("VITE_")) {
          nodePath.replaceWith(
            t.memberExpression(
              t.memberExpression(t.identifier("process"), t.identifier("env")),
              t.identifier(`EXPO_PUBLIC_${name.slice("VITE_".length)}`),
            ),
          );
        }
      },
      CallExpression(nodePath) {
        const { node } = nodePath;
        if (
          !(
            node.callee.type === "MemberExpression" &&
            isImportMeta(node.callee.object) &&
            memberName(node.callee) === "glob"
          )
        ) {
          return;
        }
        const [patternNode, optionsNode] = node.arguments;
        if (patternNode?.type !== "StringLiteral")
          throw nodePath.buildCodeFrameError("import.meta.glob needs a string literal");
        const eager =
          optionsNode?.type === "ObjectExpression" &&
          optionsNode.properties.some(
            (property) =>
              property.key?.name === "eager" &&
              property.value.type === "BooleanLiteral" &&
              property.value.value,
          );
        const { dir, regex, zamiExtension, extension } = globToContext(patternNode.value);
        nodePath.replaceWith(
          buildGlob({
            DIR: t.stringLiteral(dir),
            DIR_LITERAL: t.stringLiteral(dir),
            ZAMI_EXT: t.stringLiteral(zamiExtension),
            EXT: t.stringLiteral(extension),
            EAGER: t.booleanLiteral(eager),
            REGEX: t.regExpLiteral(regex),
            MODE: t.stringLiteral(eager ? "sync" : "lazy"),
          }),
        );
      },
    },
  };
}
