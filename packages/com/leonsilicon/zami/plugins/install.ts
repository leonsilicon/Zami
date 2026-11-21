// Puts `zam.zami` where Zam's plugin host finds it: the `zam.zami-plugins` codemod makes
// Zam's host build it from `globalThis.__zamiHost` for each plugin, and Zam's `init` hook
// call zamiInit (loading the early plugins) before the app's first render.
import { createZamiApi } from "#api";
import { bootEarlyPlugins } from "#early";
import { watchStartupPluginErrors } from "#startup";

declare global {
  var __zamiHost: { createApi: typeof createZamiApi; unload(pluginId: string): void } | undefined;
}

globalThis.__zamiHost = {
  createApi: createZamiApi,
  // Everything a plugin adds is tracked by Zam's host, which undoes it.
  unload: () => {},
};

/** Before the app's first render (Zam's `init` hook). */
export async function zamiInit(): Promise<void> {
  watchStartupPluginErrors();
  await bootEarlyPlugins();
}
