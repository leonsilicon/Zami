import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  earlyPluginIds,
  earlyPreference,
  keepEarlyPreferences,
  markLoadedEarly,
  setEarlyPreference,
  unmarkLoadedEarly,
  wasLoadedEarly,
} from "#early";
import { componentNameForKey, normalizeSpecifier, specifierForKey } from "#module-names";

describe("module names", () => {
  it("are the specifiers Zam's code imports", () => {
    expect(specifierForKey("./lib/stores/rooms.svelte.zami.ts")).toBe("$lib/stores/rooms.svelte");
    expect(specifierForKey("./lib/components/layout/RoomList.svelte.zami.tsx")).toBe(
      "$lib/components/layout/RoomList.svelte",
    );
    expect(specifierForKey("./lib/matrix/client.zami.ts")).toBe("$lib/matrix/client");
    expect(specifierForKey("./routes/+page.svelte.zami.tsx")).toBe("routes/+page.svelte");
  });

  it("accept an extension or `.zami`", () => {
    expect(normalizeSpecifier("$lib/matrix/client.ts")).toBe("$lib/matrix/client");
    expect(normalizeSpecifier("$lib/matrix/client.zami.ts")).toBe("$lib/matrix/client");
    expect(normalizeSpecifier("$lib/stores/rooms.svelte.zami")).toBe("$lib/stores/rooms.svelte");
    expect(normalizeSpecifier("$lib/stores/rooms.svelte")).toBe("$lib/stores/rooms.svelte");
  });

  it("name components after their files", () => {
    expect(componentNameForKey("./lib/components/layout/RoomList.svelte.zami.tsx")).toBe(
      "RoomList",
    );
    expect(componentNameForKey("./lib/stores/rooms.svelte.zami.ts")).toBeUndefined();
  });
});

describe("early plugins", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
      },
    });
  });

  it("are the ones whose preference is true", () => {
    expect(earlyPluginIds()).toEqual([]);
    expect(earlyPreference("a")).toBeUndefined();
    setEarlyPreference("a", true);
    setEarlyPreference("b", false);
    expect(earlyPluginIds()).toEqual(["a"]);
    expect(earlyPreference("b")).toBe(false);
    keepEarlyPreferences((id) => id === "b");
    expect(earlyPluginIds()).toEqual([]);
    expect(earlyPreference("b")).toBe(false);
  });

  it("survive unreadable storage", () => {
    localStorage.setItem("zami_plugins_early", "[not json");
    expect(earlyPluginIds()).toEqual([]);
    setEarlyPreference("a", true);
    expect(earlyPluginIds()).toEqual(["a"]);
  });

  it("remember which loaded before the first render", () => {
    markLoadedEarly("a");
    expect(wasLoadedEarly("a")).toBe(true);
    unmarkLoadedEarly("a");
    expect(wasLoadedEarly("a")).toBe(false);
  });
});
