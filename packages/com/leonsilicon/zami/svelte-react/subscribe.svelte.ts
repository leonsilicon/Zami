import { untrack } from "svelte";

/** A rune getter as an external store for React's `useSyncExternalStore`. */
export interface RuneStore<T> {
  subscribe: (onChange: () => void) => () => void;
  /** The same object until a rune the getter read changes. */
  getSnapshot: () => { readonly value: T };
}

export interface RuneStoreOptions<T> {
  /**
   * Also track everything inside the plain objects and arrays `read` returns (Zam's
   * `$state` trees), so a nested write such as `messagesState.byRoom[id] = …` counts as a
   * change.
   */
  deep?: boolean;
  /**
   * Whether a new result renders the same as the previous one, so React can skip the
   * re-render. Without it only a primitive that stays `Object.is`-equal counts as
   * unchanged, because an object can be the same `$state` proxy, SDK array or `Room`
   * with different contents. Pass `sameObject` when the object is replaced and never
   * mutated (`event.getContent()` between edits), or `shallowEqual` when `read` builds a
   * fresh object or array of primitives and references each time.
   */
  isEqual?: (previous: T, next: T) => boolean;
}

/**
 * Wraps `read` as an external store. Subscribing runs `read` in a Svelte effect, so the
 * store changes whenever a rune `read` touched changes.
 *
 * The effect is created when React subscribes (it commits), never while it renders: a
 * Svelte effect created inside another one is attached to it and takes its state, and a
 * render can run inside one, which left stores that read once and never updated.
 */
export function createRuneStore<T>(
  read: () => T,
  options: boolean | RuneStoreOptions<T> = {},
): RuneStore<T> {
  const { deep = false, isEqual } = typeof options === "boolean" ? { deep: options } : options;
  // A getter that derives a primitive (a badge's flag from a tick that changes on every
  // sync) re-runs often to the same value: nothing to re-render.
  const unchanged = (previous: T, next: T): boolean =>
    (isPrimitive(next) && Object.is(previous, next)) || (isEqual?.(previous, next) ?? false);

  let snapshot: { readonly value: T } | undefined;
  const listeners = new Set<() => void>();
  let stopTracking: (() => void) | undefined;
  /** Whether tracking ran before and stopped (a pause): nothing vouches for the snapshot. */
  let resumed = false;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  /** Runs `read` in an effect, now and whenever a rune it read changes. */
  const track = () => {
    let first = true;
    stopTracking = $effect.root(() => {
      // `$effect.pre` runs its first pass synchronously.
      $effect.pre(() => {
        const value = read();
        if (deep) trackDeep(value, new Set());
        const firstPass = first;
        first = false;
        if (snapshot === undefined) {
          // Nothing rendered yet: this is the snapshot.
          snapshot = { value };
          return;
        }
        // The first pass of a first subscription checks for a change since the render
        // that took the snapshot: the very same value is unchanged. After a pause, the
        // same object may hold new contents, so only `unchanged` decides.
        if (firstPass && !resumed && Object.is(snapshot.value, value)) return;
        if (unchanged(snapshot.value, value)) return;
        snapshot = { value };
        if (listeners.size > 0) untrack(notify);
      });
    });
  };
  const stop = () => {
    stopTracking?.();
    stopTracking = undefined;
    resumed = true;
  };

  const getSnapshot = () => (snapshot ??= { value: untrack(read) });
  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    if (stopTracking === undefined) track();
    return () => {
      listeners.delete(onChange);
      if (listeners.size > 0) return;
      // StrictMode unsubscribes and subscribes again in the same commit: keep tracking
      // until the microtask after it.
      queueMicrotask(() => {
        if (listeners.size === 0) stop();
      });
    };
  };
  return { subscribe, getSnapshot };
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

/** Equal when it is the same value (`Object.is`), whatever it contains now. */
export function sameObject<T>(previous: T, next: T): boolean {
  return Object.is(previous, next);
}

/**
 * Equal when both are the same value, or arrays with `Object.is`-equal items, or plain
 * objects with the same keys and `Object.is`-equal values. One level deep.
 */
export function shallowEqual<T>(previous: T, next: T): boolean {
  if (Object.is(previous, next)) return true;
  if (
    typeof previous !== "object" ||
    typeof next !== "object" ||
    previous === null ||
    next === null
  )
    return false;
  if (Array.isArray(previous)) {
    if (!Array.isArray(next) || previous.length !== next.length) return false;
    for (let i = 0; i < previous.length; i++) if (!Object.is(previous[i], next[i])) return false;
    return true;
  }
  if (Array.isArray(next)) return false;
  const a = previous as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) return false;
  }
  return true;
}

/** Reads every property of plain objects and arrays, so the running effect depends on them. */
function trackDeep(value: unknown, seen: Set<object>): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) trackDeep(item, seen);
    return;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  // Class instances (a MatrixEvent, a Room) aren't `$state` proxies; stop there.
  if (proto !== Object.prototype && proto !== null) return;
  for (const key of Object.keys(value)) trackDeep((value as Record<string, unknown>)[key], seen);
}
