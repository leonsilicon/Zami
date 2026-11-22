import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite-plus";
import { test } from "vite-plus/test";
import { zamiPluginsVite } from "#vite-plugin";

test("import exposes re-exports from a module that has already registered its accessor", async () => {
  const root = mkdtempSync(join(tmpdir(), "zami-registry-"));
  try {
    const src = join(root, "src/lib");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "media.js"), 'export function mxcToHttp() { return "media"; }');
    writeFileSync(
      join(src, "client.js"),
      `import { mxcToHttp } from "./media.js";
       export { mxcToHttp } from "./media.js";
       export { mxcToHttp as avatarUrl };
       export function ownAvatar() { return mxcToHttp(); }`,
    );
    const entry = join(root, "entry.js");
    const registry = fileURLToPath(new URL("../registry.ts", import.meta.url));
    writeFileSync(
      entry,
      `import assert from "node:assert/strict";
       import { ownAvatar } from "./src/lib/client.js";
       import { importModule, isLoaded } from ${JSON.stringify(registry)};
       assert.equal(ownAvatar(), "media");
       assert.equal(isLoaded("$lib/client"), true);
       const client = await importModule("$lib/client");
       assert.equal(client.mxcToHttp(), "media");
       assert.equal(client.avatarUrl(), "media");
       client.ownAvatar = () => "patched";
       assert.equal(ownAvatar(), "patched");
       assert.equal(client.ownAvatar(), "patched");`,
    );

    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [zamiPluginsVite() as Plugin],
      build: {
        lib: { entry, formats: ["es"], fileName: () => "fixture.mjs" },
        modulePreload: false,
        target: "esnext",
        rollupOptions: { external: ["node:assert/strict"] },
      },
    });
    execFileSync(process.execPath, [join(root, "dist/fixture.mjs")]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
