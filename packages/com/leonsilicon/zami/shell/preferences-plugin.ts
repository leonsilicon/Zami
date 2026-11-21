// Capacitor's Preferences plugin (@capacitor/preferences): small values kept natively. Zam
// keeps its native session mirror there (nativeSession.ts) and a few flags. Stored in
// SQLite, under Capacitor's own key names (`<group>.<key>`).
import Storage from "expo-sqlite/kv-store";
import { PluginError, type ShellPlugin } from "#bridge";

const DEFAULT_GROUP = "CapacitorStorage";

function key(options: Record<string, unknown>): string {
  if (typeof options.key !== "string") throw new PluginError("Must provide a key");
  return options.key;
}

export function createPreferencesPlugin(): ShellPlugin {
  let group = DEFAULT_GROUP;
  // Capacitor's "NativeStorage" group means keys without a prefix.
  const prefix = () => (group === "NativeStorage" ? "" : `${group}.`);

  async function ownKeys(): Promise<string[]> {
    const all = await Storage.getAllKeysAsync();
    const start = prefix();
    return all.filter((name) => name.startsWith(start));
  }

  return {
    name: "Preferences",
    methods: {
      configure: ({ group: next }) => {
        group = typeof next === "string" && next !== "" ? next : DEFAULT_GROUP;
      },
      get: async (options) => ({ value: await Storage.getItemAsync(prefix() + key(options)) }),
      set: async (options) => {
        const value = options.value;
        if (typeof value !== "string") throw new PluginError("Must provide a string value");
        await Storage.setItemAsync(prefix() + key(options), value);
      },
      remove: async (options) => {
        await Storage.removeItemAsync(prefix() + key(options));
      },
      keys: async () => ({ keys: (await ownKeys()).map((name) => name.slice(prefix().length)) }),
      clear: async () => {
        for (const name of await ownKeys()) await Storage.removeItemAsync(name);
      },
      // Nothing to migrate from: there was never a Cordova or Ionic store here.
      migrate: () => ({ migrated: [], existing: [] }),
      removeOld: () => undefined,
    },
  };
}
