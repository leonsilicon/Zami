import { describe, expect, test } from "vite-plus/test";
import { compileModule, importModule, type ModuleNamespace } from "#es-module";

describe("importModule", () => {
  test("named function and variable exports", async () => {
    const ns = await importModule(`
      export function onload(zam) { return zam + 1; }
      export async function later() { return 2; }
      export const a = 1, { b, c: [d] } = { b: 2, c: [3] };
      export let counter = 0;
      export class Thing {}
    `);
    expect(Object.keys(ns)).toEqual(["Thing", "a", "b", "counter", "d", "later", "onload"]);
    expect((ns.onload as (n: number) => number)(1)).toBe(2);
    expect(await (ns.later as () => Promise<number>)()).toBe(2);
    expect([ns.a, ns.b, ns.d]).toEqual([1, 2, 3]);
  });

  test("the namespace is a module namespace's shape", async () => {
    const ns = await importModule("export const z = 1; export const a = 2;");
    expect(Object.prototype.toString.call(ns)).toBe("[object Module]");
    expect(Object.getPrototypeOf(ns)).toBe(null);
    expect(Object.isExtensible(ns)).toBe(false);
    expect(Object.keys(ns)).toEqual(["a", "z"]);
  });

  test("exports are live bindings", async () => {
    const ns = await importModule(`
      export let count = 0;
      export function bump() { count++; }
    `);
    (ns.bump as () => void)();
    (ns.bump as () => void)();
    expect(ns.count).toBe(2);
  });

  test("esbuild's `export { x as default }`, and export lists", async () => {
    const ns = await importModule(`
      var plugin = { onload() { return "loaded"; } };
      var main_default = plugin;
      const helper = 1;
      export {
        main_default as default,
        helper,
        helper as "with space"
      };
    `);
    expect((ns.default as { onload(): string }).onload()).toBe("loaded");
    expect(ns.helper).toBe(1);
    expect(ns["with space"]).toBe(1);
  });

  test("default exports of every kind", async () => {
    const named = await importModule("export default function onload() { return 1; }");
    expect((named.default as () => number)()).toBe(1);
    const anonymous = await importModule("export default function () { return 2; }\n(3)");
    expect((anonymous.default as () => number)()).toBe(2);
    const cls = await importModule("export default class {}");
    expect(typeof cls.default).toBe("function");
    const expression = await importModule("export default { onload() {} }");
    expect(typeof (expression.default as { onload: unknown }).onload).toBe("function");
    const noSemicolon = await importModule("export default 1 + 1\nexport const b = 3");
    expect([noSemicolon.default, noSemicolon.b]).toEqual([2, 3]);
  });

  test("module code is strict, with `this` undefined", async () => {
    const ns = await importModule(`
      export const self = this;
      export let threw = false;
      try { undeclared = 1; } catch { threw = true; }
    `);
    expect(ns.self).toBe(undefined);
    expect(ns.threw).toBe(true);
  });

  test("scope names stand in for globals, and the module may shadow them", async () => {
    const document = { title: "stand-in" };
    const ns = await importModule("export const title = document.title;", { scope: { document } });
    expect(ns.title).toBe("stand-in");
    const shadowed = await importModule(
      "const document = { title: 'own' }; export const title = document.title;",
      { scope: { document } },
    );
    expect(shadowed.title).toBe("own");
  });

  test("static, re-exported and dynamic imports go through `load`", async () => {
    const modules: Record<string, ModuleNamespace> = {
      "dep:a": { default: "A", x: 1, y: 2 },
      "dep:b": { z: 3, default: "ignored" },
    };
    const loaded: string[] = [];
    const load = async (specifier: string) => {
      loaded.push(specifier);
      return modules[specifier]!;
    };
    const ns = await importModule(
      `
      import A, { x as ex } from "dep:a";
      import * as all from "dep:a";
      import "dep:a";
      export { y as why } from "dep:a";
      export * from "dep:b";
      export * as bee from "dep:b";
      export const got = [A, ex, all.y];
      export const later = () => import("dep:b");
    `,
      { load },
    );
    expect(ns.got).toEqual(["A", 1, 2]);
    expect(ns.why).toBe(2);
    expect(ns.z).toBe(3);
    expect(ns.default).toBe(undefined);
    expect(ns.bee).toBe(modules["dep:b"]);
    expect(await (ns.later as () => Promise<ModuleNamespace>)()).toBe(modules["dep:b"]);
    expect(loaded).toEqual(["dep:a", "dep:a", "dep:a", "dep:a", "dep:b", "dep:b", "dep:b"]);
  });

  test("a bare or relative specifier rejects by default, as from a blob: URL", async () => {
    await expect(importModule('import x from "./x.js";')).rejects.toThrow(TypeError);
    await expect(importModule('import x from "lodash";')).rejects.toThrow(TypeError);
  });

  test("import.meta and top-level await", async () => {
    const ns = await importModule(
      "export const url = import.meta.url; export const v = await Promise.resolve(5);",
      { url: "https://example.com/plugin.js" },
    );
    expect(ns.url).toBe("https://example.com/plugin.js");
    expect(ns.v).toBe(5);
  });

  test("a syntax error rejects with a SyntaxError; an evaluation error with itself", async () => {
    await expect(importModule("export const = 1")).rejects.toThrow(SyntaxError);
    await expect(importModule("return 1")).rejects.toThrow(SyntaxError);
    await expect(importModule("throw new RangeError('boom')")).rejects.toThrow("boom");
  });

  test("text that looks like an export inside strings, comments and templates stays", async () => {
    const ns = await importModule(`
      // export const fake = 1;
      const s = "export default 2";
      const t = \`import x from "y" \${"export"}\`;
      /* import.meta */
      export const out = [s, t];
    `);
    expect(ns.out).toEqual(["export default 2", 'import x from "y" export']);
    expect(Object.keys(ns)).toEqual(["out"]);
  });

  test("a hashbang", async () => {
    const ns = await importModule("#!/usr/bin/env node\nexport const a = 1;");
    expect(ns.a).toBe(1);
  });
});

describe("compileModule", () => {
  test("leaves code without imports or exports as it is, plus the namespace", () => {
    const { body } = compileModule("const a = 1;");
    expect(body).toContain("const a = 1;");
    expect(body).toContain("__zami_namespace([], [])");
  });
});
