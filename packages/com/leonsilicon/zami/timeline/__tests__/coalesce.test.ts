import { describe, expect, test } from "vite-plus/test";
import { createCoalescer } from "#coalesce";

function fakeTimers() {
  const timers = new Map<number, { run: () => void; ms: number }>();
  const frames = new Map<number, () => void>();
  let next = 1;
  return {
    timers,
    frames,
    options: {
      setTimeout: (run: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { run, ms });
        return id;
      },
      clearTimeout: (id: unknown) => void timers.delete(id as number),
      requestAnimationFrame: (run: () => void) => {
        const id = next++;
        frames.set(id, run);
        return id;
      },
      cancelAnimationFrame: (id: unknown) => void frames.delete(id as number),
    },
    // What's due now, not what running it schedules.
    fireTimers() {
      const due = Array.from(timers);
      for (const [id, t] of due) {
        timers.delete(id);
        t.run();
      }
    },
    fireFrames() {
      const due = Array.from(frames);
      for (const [id, run] of due) {
        frames.delete(id);
        run();
      }
    },
  };
}

describe("createCoalescer", () => {
  test("runs once for a burst of requests", () => {
    const t = fakeTimers();
    let runs = 0;
    const c = createCoalescer(() => runs++, t.options);
    for (let i = 0; i < 50; i++) c.request();
    expect(runs).toBe(0);
    expect(c.pending).toBe(true);
    t.fireTimers();
    expect(runs).toBe(1);
    expect(c.pending).toBe(false);
  });

  test("a frame that comes first runs it, and the timer then does nothing", () => {
    const t = fakeTimers();
    let runs = 0;
    const c = createCoalescer(() => runs++, t.options);
    c.request();
    t.fireFrames();
    expect(runs).toBe(1);
    expect(t.timers.size).toBe(0);
    t.fireTimers();
    expect(runs).toBe(1);
  });

  test("a delay waits only for the timer", () => {
    const t = fakeTimers();
    let runs = 0;
    const c = createCoalescer(() => runs++, { ...t.options, delayMs: 250 });
    c.request();
    expect(t.frames.size).toBe(0);
    expect([...t.timers.values()][0]?.ms).toBe(250);
    t.fireTimers();
    expect(runs).toBe(1);
  });

  test("requests during a run schedule the next one", () => {
    const t = fakeTimers();
    let runs = 0;
    const c = createCoalescer(() => {
      runs++;
      if (runs === 1) c.request();
    }, t.options);
    c.request();
    t.fireTimers();
    expect(runs).toBe(1);
    expect(c.pending).toBe(true);
    t.fireTimers();
    expect(runs).toBe(2);
  });

  test("flush runs a pending run now, cancel drops it", () => {
    const t = fakeTimers();
    let runs = 0;
    const c = createCoalescer(() => runs++, t.options);
    c.flush();
    expect(runs).toBe(0);
    c.request();
    c.flush();
    expect(runs).toBe(1);
    c.request();
    c.cancel();
    t.fireTimers();
    t.fireFrames();
    expect(runs).toBe(1);
  });
});
