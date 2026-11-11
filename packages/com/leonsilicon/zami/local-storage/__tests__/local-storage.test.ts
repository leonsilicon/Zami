import { describe, expect, test } from "vite-plus/test";
import { createCachedStorage, type StorageBackend, type StorageBatch } from "#local-storage";

/** A backend over a Map, recording each batch; `fail` makes the next writes throw. */
function memoryBackend(initial: [string, string][] = []) {
  const disk = new Map(initial);
  const batches: StorageBatch[] = [];
  const state = { fail: 0 };
  const backend: StorageBackend = {
    load: () => [...disk],
    write: async (batch) => {
      await Promise.resolve();
      if (state.fail > 0) {
        state.fail--;
        throw new Error("disk full");
      }
      batches.push(batch);
      if (batch.clear) disk.clear();
      for (const key of batch.remove) disk.delete(key);
      for (const [key, value] of batch.set) disk.set(key, value);
    },
  };
  return { backend, disk, batches, state };
}

/** Timers the test runs by hand. */
function manualTimers() {
  const timers: { task: () => void; ms: number }[] = [];
  return {
    setTimeout: (task: () => void, ms: number) => void timers.push({ task, ms }),
    pending: () => timers.map((timer) => timer.ms),
    async run(): Promise<void> {
      const due = timers.splice(0);
      for (const { task } of due) task();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

describe("createCachedStorage", () => {
  test("reads what the backend holds, once, and serves it from memory", () => {
    let loads = 0;
    const { backend } = memoryBackend([["a", "1"]]);
    const storage = createCachedStorage({
      ...backend,
      load: () => {
        loads++;
        return backend.load();
      },
    });
    expect(storage.getItem("a")).toBe("1");
    expect(storage.getItem("missing")).toBeNull();
    expect(storage.getItem("a")).toBe("1");
    expect(loads).toBe(1);
  });

  test("behaves as a Storage", () => {
    const { backend } = memoryBackend([["a", "1"]]);
    const storage = createCachedStorage(backend, manualTimers());
    storage.setItem("b", 2 as unknown as string);
    expect(storage.getItem("b")).toBe("2");
    expect(storage.length).toBe(2);
    expect([storage.key(0), storage.key(1), storage.key(2)]).toEqual(["a", "b", null]);
    storage.removeItem("a");
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe("b");
    storage.clear();
    expect(storage.length).toBe(0);
    expect(storage.getItem("b")).toBeNull();
    expect(String(Object.prototype.toString.call(storage))).toBe("[object Storage]");
  });

  test("property access reaches the items, as on the web", () => {
    const { backend } = memoryBackend([["a", "1"]]);
    const storage = createCachedStorage(backend, manualTimers()) as Storage &
      Record<string, string | undefined>;
    expect(storage.a).toBe("1");
    storage.b = "2";
    expect(storage.getItem("b")).toBe("2");
    expect("b" in storage).toBe(true);
    expect(Object.keys(storage)).toEqual(["a", "b"]);
    delete storage.a;
    expect(storage.getItem("a")).toBeNull();
    expect(typeof storage.getItem).toBe("function");
  });

  test("writes changes in one batch, a while after the first, and in order", async () => {
    const { backend, disk, batches } = memoryBackend([["old", "x"]]);
    const timers = manualTimers();
    const storage = createCachedStorage(backend, timers);
    for (let i = 0; i < 100; i++) storage.setItem("slider", String(i));
    storage.setItem("gone", "soon");
    storage.removeItem("gone");
    storage.removeItem("old");
    expect(timers.pending()).toEqual([250]);
    expect(batches).toHaveLength(0);
    await timers.run();
    expect(batches).toHaveLength(1);
    expect(disk).toEqual(new Map([["slider", "99"]]));
  });

  test("a clear between changes leaves only what came after it", async () => {
    const { backend, disk } = memoryBackend([["a", "1"]]);
    const timers = manualTimers();
    const storage = createCachedStorage(backend, timers);
    storage.setItem("b", "2");
    storage.clear();
    storage.setItem("c", "3");
    await timers.run();
    expect(disk).toEqual(new Map([["c", "3"]]));
  });

  test("flush writes now, and waits for a write in flight first", async () => {
    const { backend, disk, batches } = memoryBackend();
    const storage = createCachedStorage(backend, manualTimers());
    storage.setItem("a", "1");
    const first = storage.flush();
    storage.setItem("a", "2");
    await storage.flush();
    await first;
    expect(batches.map((b) => [...b.set])).toEqual([[["a", "1"]], [["a", "2"]]]);
    expect(disk.get("a")).toBe("2");
    await storage.flush(); // nothing changed: no write
    expect(batches).toHaveLength(2);
  });

  test("a failed write is retried later with the changes made since, without losing any", async () => {
    const { backend, disk, state } = memoryBackend([
      ["keep", "1"],
      ["drop", "1"],
    ]);
    const timers = manualTimers();
    const errors: unknown[] = [];
    const storage = createCachedStorage(backend, {
      ...timers,
      onError: (error) => errors.push(error),
    });
    state.fail = 1;
    storage.setItem("a", "1");
    storage.removeItem("drop");
    await storage.flush();
    expect(errors).toHaveLength(1);
    expect(disk.has("a")).toBe(false);
    storage.setItem("b", "2");
    storage.setItem("a", "3");
    expect(timers.pending()).toHaveLength(1);
    await timers.run();
    expect(disk).toEqual(
      new Map([
        ["keep", "1"],
        ["a", "3"],
        ["b", "2"],
      ]),
    );
  });

  test("setting an item to the value it has writes nothing", async () => {
    const { backend, batches } = memoryBackend([["a", "1"]]);
    const storage = createCachedStorage(backend, manualTimers());
    storage.setItem("a", "1");
    storage.removeItem("missing");
    await storage.flush();
    expect(batches).toHaveLength(0);
  });
});
