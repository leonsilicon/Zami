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
          'import { reportStartupScriptError, zamiInit } from "@-/com.leonsilicon.zami.plugins/web";\n',
        marker: 'from "@-/com.leonsilicon.zami.plugins/web"',
      },
      {
        kinds: ["program"],
        contains: "export const handleError:",
        from: "    if (status === 404) return { message };\n",
        to: "    if (reportStartupScriptError(error) || status === 404) return { message };\n",
        marker: "reportStartupScriptError(error)",
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

  if (filename.endsWith("/src/lib/plugins/loader.ts")) {
    return editNodes(root, [
      {
        kinds: ["program"],
        contains: "interface PluginLoader",
        from: `export interface PluginLoader {
    enable(p: LoadablePlugin): Promise<boolean>;
    disable(pluginId: string): Promise<void>;
    bootLoad(plugins: LoadablePlugin[]): Promise<void>;`,
        to: `type EnablePlugin = (plugin: LoadablePlugin, onError?: (error: unknown) => void) => Promise<boolean>;
type StartupPluginRunner = (plugin: LoadablePlugin, enable: EnablePlugin) => Promise<boolean>;

export interface PluginLoader {
    enable: EnablePlugin;
    disable(pluginId: string): Promise<void>;
    bootLoad(plugins: LoadablePlugin[], run?: StartupPluginRunner): Promise<void>;`,
        marker: "type StartupPluginRunner",
      },
      {
        kinds: ["program"],
        contains: "async function enable(",
        from: "async function enable(p: LoadablePlugin): Promise<boolean>",
        to: "async function enable(p: LoadablePlugin, onError?: (error: unknown) => void): Promise<boolean>",
        marker: "async function enable(p: LoadablePlugin, onError?",
      },
      {
        kinds: ["program"],
        contains: "async function enable(",
        from: "            return false;",
        to: "            onError?.(e);\n            return false;",
        marker: "onError?.(e);",
      },
      {
        kinds: ["program"],
        contains: "async function bootLoad(",
        from: "async function bootLoad(plugins: LoadablePlugin[]): Promise<void>",
        to: "async function bootLoad(plugins: LoadablePlugin[], run?: StartupPluginRunner): Promise<void>",
        marker: "async function bootLoad(plugins: LoadablePlugin[], run?",
      },
      {
        kinds: ["program"],
        contains: "async function bootLoad(",
        from: "            await enable(p);",
        to: "            if (run) await run(p, enable);\n            else await enable(p);",
        marker: "await run(p, enable);",
      },
    ]);
  }

  if (filename.endsWith("/src/lib/plugins/pluginBoot.ts")) {
    return editNodes(root, [
      {
        kinds: ["program"],
        contains: 'import { t } from "$lib/i18n";',
        from: 'import { t } from "$lib/i18n";\n',
        to:
          'import { t } from "$lib/i18n";\n' +
          'import { finishStartupPluginChecks, runStartupPlugin, trackStartupPluginBundle } from "@-/com.leonsilicon.zami.plugins/web";\n',
        marker: "import { finishStartupPluginChecks",
      },
      {
        kinds: ["program"],
        contains: "const loader = createPluginLoader(ops);",
        from: "const loader = createPluginLoader(ops);",
        to: `const loader = createPluginLoader(ops);

function loadPluginAtStartup(plugin: LoadablePlugin, enable: typeof loader.enable): Promise<boolean> {
    const id = plugin.manifest.id;
    if (loader.isLoaded(id)) return Promise.resolve(true);
    return runStartupPlugin(plugin, enable, () => {
        // Persist first: a broken plugin may also hang or throw in its unload hook.
        setEnabledFlag(id, false);
        if (readState().plugins[id]?.enabled !== false) {
            throw new Error("Could not disable the plugin");
        }
    });
}`,
        marker: "function loadPluginAtStartup(",
      },
      {
        kinds: ["program"],
        contains: "async function blobImport(",
        from: "async function blobImport(code: string)",
        to: "async function importPluginBundle(code: string, id: string)",
        marker: "async function importPluginBundle(code: string, id:",
      },
      {
        kinds: ["program"],
        contains: "async function blobImport(",
        from: "    try {\n        const mod = (await import(/* @vite-ignore */ url))",
        to: "    trackStartupPluginBundle(id, url);\n    try {\n        const mod = (await import(/* @vite-ignore */ url))",
        marker: "trackStartupPluginBundle(id, url)",
      },
      {
        kinds: ["program"],
        contains: "function localLoadable(",
        from: "function localLoadable(manifest: Manifest): LoadablePlugin {\n",
        to:
          "function localLoadable(manifest: Manifest): LoadablePlugin {\n" +
          "    const blobImport = (code: string) => importPluginBundle(code, manifest.id);\n",
        marker:
          "function localLoadable(manifest: Manifest): LoadablePlugin {\n    const blobImport",
      },
      {
        kinds: ["program"],
        contains: "function repoLoadable(",
        from: "function repoLoadable(manifest: Manifest, repoRef: string): LoadablePlugin {\n",
        to:
          "function repoLoadable(manifest: Manifest, repoRef: string): LoadablePlugin {\n" +
          "    const blobImport = (code: string) => importPluginBundle(code, manifest.id);\n",
        marker:
          "function repoLoadable(manifest: Manifest, repoRef: string): LoadablePlugin {\n    const blobImport",
      },
      {
        kinds: ["program"],
        contains: "function initPlugins()",
        from: "    void loader.bootLoad(toBoot);",
        to: "    void loader.bootLoad(toBoot, loadPluginAtStartup).finally(finishStartupPluginChecks);",
        marker: "bootLoad(toBoot, loadPluginAtStartup)",
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
