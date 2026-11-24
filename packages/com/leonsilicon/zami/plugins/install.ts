// Puts `zam.zami` where Zam's plugin host finds it: the `zam.zami-plugins` codemod makes
// Zam's host build it from `globalThis.__zamiHost` for each plugin. Zam's `init` hook
// prepares session restore and loads early plugins before the app's first render.
import { createZamiApi } from "#api";
import { bootEarlyPlugins } from "#early";
import { startLaunch } from "#launch";
import { preparePaperTheme } from "#paper";
import { appStoreBuild } from "#store-build";
import { watchStartupPluginErrors } from "#startup";

declare global {
  var __zamiHost: { createApi: typeof createZamiApi; unload(pluginId: string): void } | undefined;
}

globalThis.__zamiHost = {
  createApi: createZamiApi,
  // Everything a plugin adds is tracked by Zam's host, which undoes it.
  unload: () => {},
};

/**
 * Starts loading the encryption module while the rest of the app loads: several megabytes
 * of WebAssembly, which restoring a session otherwise waits for only once it gets there. The
 * SDK's own call then finds it loaded.
 */
function loadEncryptionEarly(): void {
  try {
    // (Only for a session to restore: signing in has time to load it.)
    const accounts: unknown = JSON.parse(localStorage.getItem("matrix_accounts") ?? "null");
    if (!(accounts as { activeUserId?: unknown } | null)?.activeUserId) return;
  } catch {
    return;
  }
  // Zam's dependency, not Zami's: the Vite plugin resolves it to Zam's copy (vite-plugin.ts).
  // oxlint-disable-next-line flatcap/no-undeclared-dependencies
  void import("@matrix-org/matrix-sdk-crypto-wasm")
    .then((crypto) => crypto.initAsync())
    .catch((error: unknown) => {
      // The SDK loads it again as it starts encryption, and reports what's wrong.
      console.warn("[zami] couldn't load encryption early", error);
    });
}

/** Before the app's first render (Zam's `init` hook). */
export async function zamiInit(): Promise<void> {
  if (
    (import.meta as ImportMeta & { env: { VITE_ZAMI_SCREENSHOTS?: string } }).env
      .VITE_ZAMI_SCREENSHOTS === "true"
  ) {
    const { startScreenshotMode } = await import("#screenshot-mode");
    await startScreenshotMode();
  }
  loadEncryptionEarly();
  preparePaperTheme();
  watchStartupPluginErrors();
  await startLaunch();
  if (!appStoreBuild) await bootEarlyPlugins();
}
