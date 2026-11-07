import { flushSync } from "svelte";
import { describe, expect, test } from "vite-plus/test";
import { createRuneStore } from "#subscribe.svelte";
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
