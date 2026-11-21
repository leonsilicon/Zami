// Instrumented modules, run as real ES modules in a Node process of their own (Vitest's
// module runner turns `export default` into a copy, not a live binding): their top-level
// names read and replaced through the accessor, with the module's own calls and its live
// exports seeing the new values.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parse } from "acorn";
import { test } from "vite-plus/test";
import { instrument, moduleIdForPath, type EstreeNode } from "#instrument";

/**
 * Imports the instrumented `source` and runs `check`, a function body with `module` (its
 * namespace) and `accessor` in scope; returns what it returns.
 */
function run(source: string, check: string): unknown {
  const program = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as EstreeNode;
  const out = instrument(source, program, "$lib/example");
  assert.ok(out !== null);
  const script = `
    const module = await import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(out)}`)});
    const accessor = globalThis.__zamiModules.get("$lib/example");
    const result = await (async () => { ${check} })();
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("top-level names are listed, read and replaced, the module's own calls included", () => {
  const result = run(
    `
    const LIMIT = 3;
    function double(n) { return n * 2 }
    export function run(n) { return Math.min(double(n), LIMIT) }
    export const VERSION = "1";
  `,
    `
    const out = { names: [...accessor.names].sort(), exports: accessor.exports, limit: accessor.get("LIMIT"), before: module.run(5) };
    out.setLimit = accessor.set("LIMIT", 100);
    out.afterLimit = module.run(5);
    accessor.set("double", (n) => n * 3);
    out.afterDouble = module.run(5);
    accessor.set("VERSION", "2");
    out.version = module.VERSION;
    out.missing = accessor.set("missing", 1);
    return out;
  `,
  );
  assert.deepEqual(result, {
    names: ["LIMIT", "VERSION", "double", "run"],
    exports: { run: "run", VERSION: "VERSION" },
    limit: 3,
    before: 3,
    setLimit: true,
    afterLimit: 10,
    afterDouble: 15,
    // A live binding: importers see the new value.
    version: "2",
    missing: false,
  });
});

test("an anonymous default export gets a name it can be replaced by", () => {
  const result = run(
    "export default function (a) { return a + 1 }",
    `accessor.set("__zami_default", () => "patched"); return [accessor.exports.default, module.default()];`,
  );
  assert.deepEqual(result, ["__zami_default", "patched"]);
});

test("a named default export (a Svelte component) is its own name, and replaceable", () => {
  const result = run(
    "export default function RoomList($$anchor, $$props) { return 'original' }",
    `const before = module.default(); accessor.set("RoomList", () => "wrapped"); return [accessor.exports.default, before, module.default()];`,
  );
  assert.deepEqual(result, ["RoomList", "original", "wrapped"]);
});

test("destructured and renamed declarations", () => {
  const result = run(
    "const { a, b: [c, ...rest] } = { a: 1, b: [2, 3, 4] }; let x = 1; export { x as y };",
    `const names = [...accessor.names].sort(); accessor.set("x", 2); return [names, accessor.exports.y, accessor.get("rest"), module.y];`,
  );
  assert.deepEqual(result, [["a", "c", "rest", "x"], "x", [3, 4], 2]);
});

test("module ids are named as Zam imports them", () => {
  assert.equal(moduleIdForPath("lib/stores/rooms.svelte.ts"), "$lib/stores/rooms.svelte");
  assert.equal(
    moduleIdForPath("lib/components/layout/RoomList.svelte"),
    "$lib/components/layout/RoomList.svelte",
  );
  assert.equal(moduleIdForPath("routes/+page.svelte"), "routes/+page.svelte");
  assert.equal(moduleIdForPath("hooks.client.ts"), "hooks.client");
  assert.equal(moduleIdForPath("lib/a.test.ts"), null);
  assert.equal(moduleIdForPath("lib/audio/x.worklet.js"), null);
  assert.equal(moduleIdForPath("app.css"), null);
});
