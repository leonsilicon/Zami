import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

/**
 * `zam.zami`, what the Zami app adds to Zam's plugin API (@-/com.leonsilicon.zami.plugins):
 *
 * - `src/hooks.client.ts`: the runtime loads with Zam's client hooks, and Zam's `init` hook
 *   (which SvelteKit awaits before it starts the app) loads the plugins that patch
 *   components, before the app's first render.
 * - `src/lib/plugins/hostApi.ts`: each plugin's `zam` gets `zami`, built from
 *   `globalThis.__zamiHost` when the plugin first reads it, and the host tells it when the
 *   plugin unloads.
 */
export default function codemod(root: SgRoot): string | null {
  const filename = root.filename();

  if (filename.endsWith("/src/hooks.client.ts")) {
    return editNodes(root, [
      {
        kinds: ["program"],
        contains: 'import "$lib/polyfills";',
        from: 'import "$lib/polyfills";\n',
        to:
          'import "$lib/polyfills";\n' +
          "// Zami: `zam.zami` for plugins, and the plugins that load before the first render.\n" +
          'import { zamiInit } from "@-/com.leonsilicon.zami.plugins/web";\n',
        marker: 'from "@-/com.leonsilicon.zami.plugins/web"',
      },
      {
        kinds: ["program"],
        contains: "async function init()",
        from: "    await initI18n();\n}",
        to:
          "    await initI18n();\n" +
          "    // Zami: the plugins that patch components load before the app's first render.\n" +
          "    await zamiInit();\n}",
        marker: "await zamiInit();",
      },
    ]);
  }

  if (filename.endsWith("/src/lib/plugins/hostApi.ts")) {
    return editNodes(root, [
      {
        kinds: ["function_declaration"],
        contains: "function buildHostApi(",
        from: "\n    const disposeAll = (): void => {\n",
        to: `
    // Zami: \`zam.zami\` (every module of the app, function and component patches, Zam's
    // stores, the native app), built when the plugin first reads it.
    const zamiHost = (globalThis as any).__zamiHost;
    if (zamiHost?.createApi) {
        let zami: unknown;
        Object.defineProperty(zam, "zami", {
            enumerable: true,
            configurable: true,
            get: () => (zami ??= zamiHost.createApi({ pluginId, manifest, track })),
        });
    }

    const disposeAll = (): void => {
        // Zami: what the plugin made outside this host.
        zamiHost?.unload?.(pluginId);
`,
        marker: "__zamiHost",
      },
    ]);
  }

  throw new Error(`zam.zami-plugins codemod: unexpected file ${filename}`);
}
