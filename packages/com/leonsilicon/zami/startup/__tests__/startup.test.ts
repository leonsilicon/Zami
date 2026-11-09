import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

async function load() {
  vi.resetModules();
  return import("#startup");
}

describe("startup timeline", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  test("records steps in order and saves them for the next launch", async () => {
    const first = await load();
    first.markStartup("Opening the message cache");
    first.finishStartup("Up to date", "3 rooms");
    expect(first.thisStartup().steps.map((s) => s.step)).toEqual([
      "Starting",
      "Opening the message cache",
      "Up to date",
    ]);
    expect(first.thisStartup().finished).toBe(true);

    const second = await load();
    expect(second.previousStartup()?.steps.at(-1)).toMatchObject({
      step: "Up to date",
      detail: "3 rooms",
    });
    second.markStartup("Opening the message cache");
    // The previous launch is read before this one overwrites it.
    expect(second.previousStartup()?.finished).toBe(true);
  });

  test("ignores marks after the launch finished", async () => {
    const { markStartup, finishStartup, thisStartup } = await load();
    finishStartup();
    markStartup("Late");
    expect(thisStartup().steps.map((s) => s.step)).toEqual(["Starting", "Ready"]);
  });

  test("notes what the IndexedDB stand-in loaded during each step", async () => {
    const { markStartup, setStartupStatsSource, thisStartup } = await load();
    const stats = { hydratedRecords: 10, hydrateMs: 5, indexBuilds: 0, indexBuildMs: 0 };
    setStartupStatsSource(() => stats);
    markStartup("Opening the encryption store");
    stats.hydratedRecords = 1010;
    stats.hydrateMs = 405;
    stats.indexBuilds = 2;
    stats.indexBuildMs = 30;
    markStartup("Checking device keys");
    expect(thisStartup().steps.find((s) => s.step === "Opening the encryption store")?.detail).toBe(
      "loaded 1000 records in 400 ms, built 2 indexes in 30 ms",
    );
  });

  test("tells listeners about each step", async () => {
    const { markStartup, subscribeStartup, currentStartupStep } = await load();
    const seen: string[] = [];
    subscribeStartup(() => seen.push(currentStartupStep().step));
    markStartup("Starting sync");
    expect(seen).toEqual(["Starting sync"]);
  });

  test("formats each step with how long it took", async () => {
    const { formatStartup } = await load();
    const lines = formatStartup({
      startedAt: 0,
      steps: [
        { step: "Starting", at: 0 },
        { step: "Restoring session", at: 1500 },
        { step: "Up to date", at: 4000, detail: "3 rooms" },
      ],
      longestStall: { ms: 900, during: "Restoring session" },
      finished: true,
    });
    expect(lines).toEqual([
      "started 1970-01-01T00:00:00.000Z",
      "  0.00 s  Starting · 1500 ms",
      "  1.50 s  Restoring session · 2500 ms",
      "  4.00 s  Up to date (3 rooms)",
      'JS stall: 900 ms, from "Restoring session"',
    ]);
  });
});
