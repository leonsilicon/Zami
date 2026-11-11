import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

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

describe("stalls after the launch", () => {
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Time passes with the thread free: each timer runs when it's due. */
  function idle(ms: number): void {
    for (let t = 0; t < ms; t += 10) {
      clock += 10;
      vi.advanceTimersByTime(10);
    }
  }

  /**
   * Right after a tick of the watch (the next one is due in 200 ms), the JS thread is busy for
   * `ms`; then timers run, late. The watch sees `ms - 200`.
   */
  function stall(ms: number): void {
    idle(200 - (clock % 200));
    clock += ms;
    vi.advanceTimersByTime(ms);
    idle(200);
  }

  test("keeps the longest, with where the app was before and after, and saves them", async () => {
    const startup = await load();
    let room = "room A";
    startup.setStallContext(() => room);
    const stats = {
      hydratedRecords: 0,
      hydrateMs: 0,
      indexBuilds: 0,
      indexBuildMs: 0,
      idbTasks: 0,
    };
    startup.setStartupStatsSource(() => stats);
    startup.finishStartup("Up to date");
    idle(1000);
    expect(startup.thisStartup().sessionStalls).toBeUndefined();

    idle(200 - (clock % 200));
    // During this stall, the user switched rooms and IndexedDB ran 120 tasks.
    room = "room B";
    stats.idbTasks = 120;
    clock += 400;
    vi.advanceTimersByTime(400);
    idle(1000);
    stall(600);
    idle(1000);
    const record = startup.thisStartup();
    expect(record.sessionStallCount).toBe(2);
    expect(record.sessionStalls).toEqual([
      { ms: 400, at: expect.any(Number), context: "room B" },
      { ms: 200, at: expect.any(Number), context: "room A → room B", idb: "120 tasks" },
    ]);
    // Saved a while later, not on every stall.
    vi.advanceTimersByTime(2000);
    const saved = JSON.parse(localStorage.getItem("zami:startup")!) as typeof record;
    expect(saved.sessionStalls).toHaveLength(2);
    expect(startup.formatSessionStalls(record)[0]).toBe(
      "stalls after launch: 2, 600 ms in all; longest:",
    );
  });

  test("keeps only the ten longest, and ignores time spent in the background", async () => {
    const startup = await load();
    startup.finishStartup();
    for (let i = 1; i <= 15; i++) stall(300 + i * 10);
    expect(startup.thisStartup().sessionStalls?.map((s) => s.ms)).toEqual([
      250, 240, 230, 220, 210, 200, 190, 180, 170, 160,
    ]);
    expect(startup.thisStartup().sessionStallCount).toBe(15);

    startup.setStallWatchActive(false);
    clock += 60_000;
    vi.advanceTimersByTime(60_000);
    startup.setStallWatchActive(true);
    idle(1000);
    expect(startup.thisStartup().sessionStallCount).toBe(15);
  });

  test("costs one timer a few times a second when nothing stalls", async () => {
    const startup = await load();
    startup.finishStartup();
    const before = vi.getTimerCount();
    idle(1000);
    expect(vi.getTimerCount()).toBe(before);
    expect(startup.thisStartup().sessionStallCount).toBeUndefined();
  });
});
