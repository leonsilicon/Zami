// Which plugins load before the app's first render. A component patch only reaches the
// elements created after it, so a plugin that patches loads early from the next launch
// on (Zam loads plugins once the app shell is up, so as not to hold the first frame).
// Kept in localStorage, which is loaded before anything renders.

const KEY = "zami_plugins_early";

type Preferences = Record<string, boolean>;

function read(): Preferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Preferences)
      : {};
  } catch {
    return {};
  }
}

function write(preferences: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Storage is best-effort: the plugin loads late and says so (a toast).
  }
}

/** The plugins to load before the first render. */
export function earlyPluginIds(): string[] {
  const preferences = read();
  return Object.keys(preferences).filter((id) => preferences[id] === true);
}

/** What's recorded for the plugin: undefined until it patches something or says. */
export function earlyPreference(pluginId: string): boolean | undefined {
  const preference = read()[pluginId];
  return typeof preference === "boolean" ? preference : undefined;
}

export function setEarlyPreference(pluginId: string, early: boolean): void {
  const preferences = read();
  if (preferences[pluginId] === early) return;
  preferences[pluginId] = early;
  write(preferences);
}

/** Drops plugins that are no longer installed. */
export function keepEarlyPreferences(installed: (pluginId: string) => boolean): void {
  const preferences = read();
  let changed = false;
  for (const id of Object.keys(preferences)) {
    if (installed(id)) continue;
    delete preferences[id];
    changed = true;
  }
  if (changed) write(preferences);
}

const loadedEarly = new Set<string>();

/** The plugin was loaded before this run's first render. */
export function markLoadedEarly(pluginId: string): void {
  loadedEarly.add(pluginId);
}

/** Its early load failed: it's loaded with the rest, and unloads with them. */
export function unmarkLoadedEarly(pluginId: string): void {
  loadedEarly.delete(pluginId);
}

export function wasLoadedEarly(pluginId: string): boolean {
  return loadedEarly.has(pluginId);
}
