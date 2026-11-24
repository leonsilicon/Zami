// Which chunk the web app's modules are built into (chunks.ts).
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { manualStartupChunks, startupChunks, type ModuleGraph } from "#chunks";

const KIT = "/zam/node_modules/@sveltejs/kit/src/runtime/client";
const GENERATED = "/zam/.svelte-kit/generated/client-optimized";

/** A module graph from each module's static imports; `entries` are the build's inputs. */
function graph(imports: Record<string, string[]>, entries: string[]): ModuleGraph {
  return {
    getModuleIds: () => Object.keys(imports),
    getModuleInfo: (id) =>
      id in imports ? { isEntry: entries.includes(id), importedIds: imports[id]! } : null,
  };
}

const app = graph(
  {
    [`${KIT}/entry.js`]: [`${KIT}/client.js`],
    [`${KIT}/client.js`]: ["/zam/node_modules/svelte/index.js"],
    [`${GENERATED}/app.js`]: ["/zam/src/hooks.client.ts"],
    [`${GENERATED}/nodes/0.js`]: ["/zam/src/routes/+layout.svelte"],
    [`${GENERATED}/nodes/2.js`]: ["/zam/src/routes/+page.svelte"],
    "/zam/src/hooks.client.ts": ["/zam/src/lib/i18n/index.ts", "/zami/plugins/+web.ts"],
    "/zam/src/lib/i18n/index.ts": ["/zam/node_modules/svelte/index.js"],
    "/zami/plugins/+web.ts": ["\0vite/preload-helper.js"],
    "\0vite/preload-helper.js": [],
    "/zam/src/routes/+layout.svelte": ["/zam/src/lib/i18n/index.ts", "/zam/src/app.css"],
    "/zam/src/app.css": [],
    "/zam/src/routes/+page.svelte": ["/zam/src/lib/matrix/client.ts"],
    // (Each imports the other, as Zam's modules do.)
    "/zam/src/lib/matrix/client.ts": [
      "/zam/node_modules/matrix-js-sdk/lib/index.js",
      "/zam/src/lib/stores/rooms.svelte.ts",
    ],
    "/zam/src/lib/stores/rooms.svelte.ts": ["/zam/src/lib/matrix/client.ts"],
    "/zam/node_modules/matrix-js-sdk/lib/index.js": [],
    "/zam/node_modules/svelte/index.js": [],
    // Only ever imported on request (a settings page, a language).
    "/zam/src/lib/components/settings/About.svelte": ["/zam/src/lib/i18n/index.ts"],
    "/zam/src/lib/i18n/locales/ja.ts": [],
  },
  [`${KIT}/entry.js`, `${GENERATED}/app.js`, `${GENERATED}/nodes/0.js`, `${GENERATED}/nodes/2.js`],
);

test("what the client entry imports is built apart from what the routes import", () => {
  const chunks = startupChunks(app);
  // Before Zam's `init` hook: its client hooks, and what they import.
  assert.equal(chunks.get("/zam/src/hooks.client.ts"), "boot");
  assert.equal(chunks.get("/zam/src/lib/i18n/index.ts"), "boot");
  assert.equal(chunks.get("/zami/plugins/+web.ts"), "boot");
  assert.equal(chunks.get(`${KIT}/client.js`), "boot-vendor");
  assert.equal(chunks.get("/zam/node_modules/svelte/index.js"), "boot-vendor");
  assert.equal(chunks.get("\0vite/preload-helper.js"), "boot-vendor");
  // After it: the routes, and what only they import.
  assert.equal(chunks.get("/zam/src/routes/+page.svelte"), "app");
  assert.equal(chunks.get("/zam/src/lib/matrix/client.ts"), "app");
  assert.equal(chunks.get("/zam/src/lib/stores/rooms.svelte.ts"), "app");
  assert.equal(chunks.get("/zam/src/app.css"), "app");
  assert.equal(chunks.get("/zam/node_modules/matrix-js-sdk/lib/index.js"), "app-vendor");
});

test("entries and modules imported only on request keep their own chunks", () => {
  const chunks = startupChunks(app);
  assert.equal(chunks.has(`${GENERATED}/app.js`), false);
  assert.equal(chunks.has(`${GENERATED}/nodes/2.js`), false);
  assert.equal(chunks.has("/zam/src/lib/components/settings/About.svelte"), false);
  assert.equal(chunks.has("/zam/src/lib/i18n/locales/ja.ts"), false);
});

test("a build without the client's entries is left as it is", () => {
  const server = graph({ "/zam/server/index.js": ["/zam/src/lib/a.ts"], "/zam/src/lib/a.ts": [] }, [
    "/zam/server/index.js",
  ]);
  assert.equal(startupChunks(server).size, 0);
  const manualChunks = manualStartupChunks();
  assert.equal(manualChunks("/zam/src/lib/a.ts", server), undefined);
  assert.equal(manualChunks("/zam/src/lib/matrix/client.ts", app), "app");
});
