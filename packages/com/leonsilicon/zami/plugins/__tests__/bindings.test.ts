import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { bindingsKey, zamiBindingsPlugin } from "@-/com.leonsilicon.zami.metro/bindings";
import { bindingsForKey, bindingsOf, rememberModule } from "#bindings";
import { patchAfter, patchInstead, setModuleNames } from "#patcher";

// Babel ships no types of its own; this is all of it the test uses.
const { transformSync } = createRequire(import.meta.url)("@babel/core") as {
  transformSync: (source: string, options: object) => { code: string } | null;
};

const repoRoot = new URL("../../../../../..", import.meta.url).pathname.replace(/\/$/, "");
const filename = `${repoRoot}/src/lib/stores/demo.svelte.zami.ts`;

/** Runs `source` as Metro would after the transform: a module body with `exports`. */
function load(source: string): Record<string, unknown> {
  const compiled = transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: ["@babel/preset-typescript"],
    plugins: [zamiBindingsPlugin, "@babel/plugin-transform-modules-commonjs"],
  })!.code;
  const exports: Record<string, unknown> = {};
  // oxlint-disable-next-line typescript/no-implied-eval, no-new-func -- the compiled module
  new Function("exports", compiled)(exports);
  return exports;
}

describe("bindingsKey", () => {
  it("is the module's require.context key, for Zam's modules only", () => {
    expect(bindingsKey(filename)).toBe("./lib/stores/demo.svelte.zami.ts");
    expect(bindingsKey(`${repoRoot}/src/lib/a.test.zami.ts`)).toBeUndefined();
    expect(bindingsKey(`${repoRoot}/src/lib/a.ts`)).toBeUndefined();
    expect(bindingsKey(`${repoRoot}/packages/a.zami.ts`)).toBeUndefined();
    expect(bindingsKey(undefined)).toBeUndefined();
  });
});

describe("a module's bindings", () => {
  beforeEach(() => {
    (globalThis as { __zamiBindings?: unknown }).__zamiBindings = undefined;
    setModuleNames((exports) => bindingsOf(exports));
  });

  const source = `
    export const TTL: number = 5;
    const twice = (n: number) => n * 2;
    function hidden(): string { return "hidden"; }
    export function shown(): string { return hidden() + ":" + twice(TTL); }
    const { skipped } = { skipped: 1 };
    declare const ambient: string;
    interface OnlyAType { a: number }
    export { twice as double };
  `;

  it("lists what the module declares, and reads and sets it", () => {
    const exports = load(source);
    const bindings = bindingsForKey("./lib/stores/demo.svelte.zami.ts")!;
    expect([...bindings.names()].sort()).toEqual(["TTL", "hidden", "shown", "twice"]);
    expect(bindings.has("skipped")).toBe(false);
    expect(bindings.get("TTL")).toBe(5);
    bindings.set("TTL", 7);
    // The module's own code sees it, and so does its (live) export.
    expect((exports.shown as () => string)()).toBe("hidden:14");
    expect(exports.TTL).toBe(7);
    expect(() => bindings.set("nope", 1)).toThrow(/declares no/);
    expect(bindingsForKey("./lib/none.zami.ts")).toBeUndefined();
  });

  it("lets a patch reach a function the module calls itself, exported or not", () => {
    const exports = load(source);
    rememberModule(exports, "./lib/stores/demo.svelte.zami.ts");
    const undoHidden = patchInstead(exports, "hidden", () => "patched");
    const undoShown = patchAfter(exports, "shown", (result) => `<${String(result)}>`);
    expect((exports.shown as () => string)()).toBe("<patched:10>");
    undoShown();
    undoHidden();
    expect((exports.shown as () => string)()).toBe("hidden:10");
    expect("hidden" in exports).toBe(false);
  });

  it("patches a function exported under another name through the export", () => {
    const exports = load(source);
    rememberModule(exports, "./lib/stores/demo.svelte.zami.ts");
    // `double` isn't one of the module's names: only the property can be patched, and
    // this compiler's exports allow it.
    patchAfter(exports, "double", () => 0);
    expect((exports.double as (n: number) => number)(4)).toBe(0);
  });
});
