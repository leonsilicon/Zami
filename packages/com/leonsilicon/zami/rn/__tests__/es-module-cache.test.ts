import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// A fresh module per test: compiled bodies are also kept in memory for the run.
async function load() {
  vi.resetModules();
  return import("#es-module");
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const SOURCE = "export const answer = 6 * 7;";

describe("compileCached", () => {
  test("keeps a compiled module for the rest of the run", async () => {
    const { compileCached } = await load();
    const first = await compileCached(SOURCE);
    expect(await compileCached(SOURCE)).toBe(first);
    expect(await compileCached(`${SOURCE} `)).not.toBe(first);
  });

  test("keeps it between launches in IndexedDB, and uses it without compiling again", async () => {
    const launch1 = await load();
    const body = await launch1.compileCached(SOURCE, "modules-test");
    // Written in the background.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const launch2 = await load();
    expect(await launch2.compileCached(SOURCE, "modules-test")).toBe(body);

    // What's stored is what runs: a stored body that differs from a fresh compile wins.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("modules-test", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("modules", "readwrite");
    transaction
      .objectStore("modules")
      .put(
        { body: `return __zami_namespace([["answer", () => 7]], []);`, at: Date.now() },
        launch2.moduleSourceKey(SOURCE),
      );
    await new Promise((resolve) => (transaction.oncomplete = resolve));
    db.close();
    const launch3 = await load();
    const ns = await launch3.importModule(SOURCE, { compileCache: "modules-test" });
    expect(ns.answer).toBe(7);
    // Without the cache it compiles.
    expect((await launch3.importModule(`${SOURCE}\n`)).answer).toBe(42);
  });

  test("a source that doesn't parse rejects, and isn't kept", async () => {
    const { compileCached } = await load();
    await expect(compileCached("export const = ;", "modules-test")).rejects.toThrow(SyntaxError);
    await expect(compileCached("export const = ;", "modules-test")).rejects.toThrow(SyntaxError);
  });

  test("keeps at most 32 modules between launches, dropping the oldest", async () => {
    const { compileCached, moduleSourceKey } = await load();
    for (let i = 0; i < 40; i++) {
      await compileCached(`export const n = ${i};`, "modules-test");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("modules-test", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const request = db.transaction("modules").objectStore("modules").getAllKeys();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    expect(keys).toHaveLength(32);
    expect(keys).not.toContain(moduleSourceKey("export const n = 0;"));
    expect(keys).toContain(moduleSourceKey("export const n = 39;"));
  });
});
