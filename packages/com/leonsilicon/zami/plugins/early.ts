// Plugins that load before the app's first render. A component patch only reaches what's
// drawn after it, and Zam loads plugins once its app shell is up, which is too late for a
// patch of the shell. So a plugin that patches a component is marked to load early, and
// from the next launch on it's loaded in Zam's `init` hook, which SvelteKit awaits before it
// starts the app (the `zam.zami-plugins` codemod). It's loaded with Zam's own loader, which
// Zam's own boot then skips it in. `zam.zami.app.loadEarly(false)` opts a plugin out.
import { addLayer } from "#layers";
import { importModule } from "#registry";

const PREFERENCES_KEY = "zami_plugins_early";
/** How long the first render waits for the early plugins. */
const EARLY_TIMEOUT_MS = 4000;

/** Plugin id → whether it loads early (absent: it doesn't, until it patches a component). */
type Preferences = Record<string, boolean>;

function readPreferences(): Preferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Preferences) : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage is full or off: it loads late, which is only slower to apply.
  }
}

export function earlyPluginIds(): string[] {
  return Object.entries(readPreferences())
    .filter(([, early]) => early)
    .map(([id]) => id);
}

export function setEarly(pluginId: string, early: boolean): void {
  writePreferences({ ...readPreferences(), [pluginId]: early });
}

/** Marks a plugin that patched a component to load early; true the first time. */
export function noteComponentPatch(pluginId: string): boolean {
  const preferences = readPreferences();
  if (pluginId in preferences) return false;
  writePreferences({ ...preferences, [pluginId]: true });
  return true;
}

const loadedEarly = new Set<string>();

export function wasLoadedEarly(pluginId: string): boolean {
  return loadedEarly.has(pluginId);
}

interface Loadable {
  manifest: { id: string };
}

interface PluginLoader {
  enable(plugin: Loadable): Promise<boolean>;
  bootLoad(plugins: Loadable[]): Promise<void>;
  isLoaded(pluginId: string): boolean;
}

interface PersistedPlugin {
  enabled?: boolean;
  manifest?: { id: string };
  source?: string;
  repoRef?: string;
  sha?: string;
  path?: string;
}

let bootSkipsLoaded = false;

async function loadEarlyPlugins(): Promise<void> {
  const boot = await importModule("$lib/plugins/pluginBoot");
  const loader = boot.loader as PluginLoader;
  // Zam's own boot (initPlugins) loads every enabled plugin: not the ones loaded here again.
  if (!bootSkipsLoaded) {
    bootSkipsLoaded = true;
    addLayer(
      loader,
      "bootLoad",
      (below) => (plugins: Loadable[]) =>
        (below as PluginLoader["bootLoad"]).call(
          loader,
          plugins.filter((plugin) => !loader.isLoaded(plugin.manifest.id)),
        ),
    );
  }
  const ids = earlyPluginIds();
  if (ids.length === 0) return;
  const store = await importModule("$lib/stores/plugins.svelte");
  const setInstalledPlugin = store.setInstalledPlugin as (record: Record<string, unknown>) => void;
  const state = (boot.readState as () => { plugins: Record<string, PersistedPlugin> })();
  const loadables = boot.loadables as Map<string, Loadable>;
  for (const id of ids) {
    const entry = state.plugins[id];
    if (!entry?.enabled || !entry.manifest || loader.isLoaded(id)) continue;
    let loadable: Loadable;
    if (entry.source === "local") {
      setInstalledPlugin({ manifest: entry.manifest, source: "local", enabled: true, error: null });
      loadable = (boot.localLoadable as (manifest: unknown) => Loadable)(entry.manifest);
    } else if (entry.source === "repo" && entry.repoRef) {
      setInstalledPlugin({
        manifest: entry.manifest,
        source: "repo",
        enabled: true,
        error: null,
        repoRef: entry.repoRef,
        sha: entry.sha,
        path: entry.path || `plugins/${id}`,
      });
      loadable = (boot.repoLoadable as (manifest: unknown, ref: string) => Loadable)(
        entry.manifest,
        entry.repoRef,
      );
    } else continue;
    loadables.set(id, loadable);
    loadedEarly.add(id);
    if (!(await loader.enable(loadable))) loadedEarly.delete(id);
  }
}

/** Loads the early plugins; the first render waits for them, up to a few seconds. */
export async function bootEarlyPlugins(): Promise<void> {
  await Promise.race([
    loadEarlyPlugins().catch((error: unknown) => {
      console.error("[zami] loading plugins before the first render failed", error);
    }),
    new Promise<void>((resolve) => setTimeout(resolve, EARLY_TIMEOUT_MS)),
  ]);
}
