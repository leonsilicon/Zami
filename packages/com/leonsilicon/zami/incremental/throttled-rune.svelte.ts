import { untrack } from "svelte";

/** A rune getter as an external store whose change notifications are throttled. */
export interface ThrottledRuneStore<T> {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => T;
}

export interface ThrottleOptions {
  /** At most one notification per this many milliseconds. */
  ms: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/**
 * Like `useRune`'s store for a primitive (a tick), but a burst of changes notifies at
 * most once per `ms`: the first change after a quiet spell at once, the rest of the
 * burst once at the end of the window. For a screen that re-renders whole on Zam's
 * `roomsTick` (a settings dialog), so a burst of syncs costs one render per window.
 */
export function createThrottledRuneStore<T>(
  read: () => T,
  {
    ms,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }: ThrottleOptions,
): ThrottledRuneStore<T> {
  let value = untrack(read);
  const listeners = new Set<() => void>();
  let stopTracking: (() => void) | undefined;
  let lastNotified = -Infinity;
  let timer: unknown;

  const notify = () => {
    timer = undefined;
    lastNotified = now();
    for (const listener of Array.from(listeners)) listener();
  };
  const changed = () => {
    if (listeners.size === 0 || timer !== undefined) return;
    const wait = lastNotified + ms - now();
    if (wait <= 0) notify();
    else timer = setTimer(notify, wait);
  };
  const track = () => {
    stopTracking = $effect.root(() => {
      $effect.pre(() => {
        const next = read();
        if (Object.is(next, value)) return;
        value = next;
        untrack(changed);
      });
    });
  };
  const stop = () => {
    stopTracking?.();
    stopTracking = undefined;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  return {
    getSnapshot: () => value,
    subscribe(onChange) {
      listeners.add(onChange);
      if (stopTracking === undefined) track();
      return () => {
        listeners.delete(onChange);
        if (listeners.size > 0) return;
        // StrictMode unsubscribes and subscribes again in the same commit.
        queueMicrotask(() => {
          if (listeners.size === 0) stop();
        });
      };
    },
  };
}
