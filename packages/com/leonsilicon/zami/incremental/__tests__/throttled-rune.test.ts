import { flushSync } from "svelte";
import { describe, expect, test } from "vite-plus/test";
import { createThrottledRuneStore } from "#throttled-rune.svelte";
import { createTick } from "./fixture.svelte";

function harness(ms: number) {
  const state = createTick();
  let clock = 1_000;
  const timers: { at: number; run: () => void }[] = [];
  const store = createThrottledRuneStore(() => state.tick, {
    ms,
    now: () => clock,
    setTimer: (run, wait) => {
      const timer = { at: clock + wait, run };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => timers.splice(timers.indexOf(timer as never), 1),
  });
  let notified = 0;
  const stop = store.subscribe(() => notified++);
  const advance = (by: number) => {
    clock += by;
    for (const timer of timers.filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  const bump = () => {
    state.tick++;
    flushSync();
  };
  return { store, bump, advance, notified: () => notified, stop };
}

describe("createThrottledRuneStore", () => {
  test("notifies at once after a quiet spell, then once per window", () => {
    const { store, bump, advance, notified } = harness(500);
    bump();
    expect(notified()).toBe(1);
    expect(store.getSnapshot()).toBe(1);
    bump();
    bump();
    advance(100);
    bump();
    expect(notified()).toBe(1);
    // The snapshot is current even before the notification.
    expect(store.getSnapshot()).toBe(4);
    advance(400);
    expect(notified()).toBe(2);
    advance(1_000);
    bump();
    expect(notified()).toBe(3);
  });

  test("stops watching once unsubscribed", async () => {
    const { bump, notified, stop } = harness(0);
    stop();
    await Promise.resolve();
    bump();
    expect(notified()).toBe(0);
  });
});
