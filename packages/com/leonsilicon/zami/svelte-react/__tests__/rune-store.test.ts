import { flushSync } from "svelte";
import { describe, expect, test } from "vite-plus/test";
import { createRuneStore, sameObject, shallowEqual } from "#subscribe.svelte";
import { createState } from "./fixture.svelte.ts";

function watch<T>(store: ReturnType<typeof createRuneStore<T>>) {
  let changes = 0;
  const stop = store.subscribe(() => changes++);
  return { changes: () => changes, stop };
}

describe("createRuneStore", () => {
  test("changes when a rune it read changes", () => {
    const state = createState();
    const store = createRuneStore(() => state.count);
    const watcher = watch(store);
    const before = store.getSnapshot();
    state.count = 1;
    flushSync();
    expect(watcher.changes()).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().value).toBe(1);
    watcher.stop();
  });

  test("keeps the same snapshot while nothing changes", () => {
    const state = createState();
    const store = createRuneStore(() => state.count);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  test("catches a change between the snapshot and the subscription", () => {
    const state = createState();
    const store = createRuneStore(() => state.count);
    expect(store.getSnapshot().value).toBe(0); // React renders
    state.count = 1; // the store changes before React subscribes
    const watcher = watch(store);
    flushSync();
    expect(watcher.changes()).toBe(1);
    expect(store.getSnapshot().value).toBe(1);
    watcher.stop();
  });

  test("doesn't change on subscribe when nothing changed", () => {
    const state = createState();
    const store = createRuneStore(() => state.count);
    store.getSnapshot();
    const watcher = watch(store);
    flushSync();
    expect(watcher.changes()).toBe(0);
    watcher.stop();
  });

  test("misses writes below what it read", () => {
    const state = createState();
    const store = createRuneStore(() => state.byRoom);
    const watcher = watch(store);
    state.byRoom["!a"] = { events: [] };
    flushSync();
    expect(watcher.changes()).toBe(0);
    watcher.stop();
  });

  test("with deep, sees nested writes and in-place mutation", () => {
    const state = createState();
    const store = createRuneStore(() => state.byRoom, true);
    const watcher = watch(store);
    state.byRoom["!a"] = { events: [] };
    flushSync();
    expect(watcher.changes()).toBe(1);
    state.byRoom["!a"]!.events.push("$event");
    flushSync();
    expect(watcher.changes()).toBe(2);
    watcher.stop();
  });

  test("doesn't change when a derived primitive stays the same", () => {
    const state = createState();
    const store = createRuneStore(() => state.count > 10);
    const watcher = watch(store);
    state.count = 1;
    flushSync();
    expect(watcher.changes()).toBe(0);
    state.count = 11;
    flushSync();
    expect(watcher.changes()).toBe(1);
    watcher.stop();
  });

  test("still changes when it returns the same object with new contents", () => {
    const state = createState();
    const store = createRuneStore(() => {
      void state.byRoom["!a"]?.events.length;
      return state.byRoom;
    });
    const watcher = watch(store);
    state.byRoom["!a"] = { events: [] };
    flushSync();
    expect(watcher.changes()).toBe(1);
    watcher.stop();
  });

  test("creates its effect when subscribing, not when rendering", () => {
    const state = createState();
    let reads = 0;
    const store = createRuneStore(() => {
      reads++;
      return state.count;
    });
    store.getSnapshot();
    state.count = 1;
    flushSync();
    expect(reads).toBe(1); // the render's read tracks nothing
    const watcher = watch(store);
    expect(watcher.changes()).toBe(1);
    expect(store.getSnapshot().value).toBe(1);
    watcher.stop();
  });

  test("skips an object result that isEqual calls the same", () => {
    const state = createState();
    const content = { body: "hi" };
    const store = createRuneStore(
      () => {
        void state.count;
        return content;
      },
      { isEqual: sameObject },
    );
    const watcher = watch(store);
    state.count = 1;
    flushSync();
    expect(watcher.changes()).toBe(0);
    watcher.stop();
  });

  test("shallowEqual skips a rebuilt object with the same values", () => {
    const state = createState();
    const store = createRuneStore(() => ({ big: state.count > 10, toasts: state.toasts }), {
      isEqual: shallowEqual,
    });
    const watcher = watch(store);
    state.count = 1;
    flushSync();
    expect(watcher.changes()).toBe(0);
    state.count = 11;
    flushSync();
    expect(watcher.changes()).toBe(1);
    watcher.stop();
  });

  test("by default, the same object still counts as a change", () => {
    const state = createState();
    const events: string[] = [];
    const store = createRuneStore(() => {
      void state.count;
      return events; // grows in place, like timeline.getEvents()
    });
    const watcher = watch(store);
    events.push("$event");
    state.count = 1;
    flushSync();
    expect(watcher.changes()).toBe(1);
    watcher.stop();
  });

  test("after a pause, reads again and reports what changed meanwhile", async () => {
    const state = createState();
    const store = createRuneStore(() => state.count);
    let watcher = watch(store);
    watcher.stop();
    await Promise.resolve(); // tracking stops the microtask after the last unsubscribe
    state.count = 1;
    flushSync();
    expect(store.getSnapshot().value).toBe(0);
    watcher = watch(store);
    expect(watcher.changes()).toBe(1);
    expect(store.getSnapshot().value).toBe(1);
    watcher.stop();
  });

  test("keeps tracking through an unsubscribe and resubscribe in one commit", () => {
    const state = createState();
    let reads = 0;
    const store = createRuneStore(() => {
      reads++;
      return state.count;
    });
    store.getSnapshot();
    watch(store).stop();
    const watcher = watch(store);
    expect(reads).toBe(2); // the render's read, then the effect's first pass
    watcher.stop();
  });

  test("stops notifying after unsubscribing", () => {
    const state = createState();
    const store = createRuneStore(() => state.toasts);
    const watcher = watch(store);
    watcher.stop();
    state.toasts = ["x"];
    flushSync();
    expect(watcher.changes()).toBe(0);
  });
});
