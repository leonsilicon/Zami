import { untrack } from "svelte";

/** A rune getter as an external store for React's `useSyncExternalStore`. */
export interface RuneStore<T> {
  subscribe: (onChange: () => void) => () => void;
  /** The same object until a rune the getter read changes. */
  getSnapshot: () => { readonly value: T };
}

/**
 * Wraps `read` as an external store. Subscribing runs `read` in a Svelte effect, so the
 * store changes whenever a rune `read` touched changes. With `deep`, it also tracks
 * everything inside the plain objects and arrays `read` returns (Zam's `$state` trees),
 * so a nested write such as `messagesState.byRoom[id] = …` counts as a change.
 */
export function createRuneStore<T>(read: () => T, deep = false): RuneStore<T> {
  let snapshot: { readonly value: T } | undefined;
  const getSnapshot = () => (snapshot ??= { value: untrack(read) });
  const subscribe = (onChange: () => void) => {
    let first = true;
    return $effect.root(() => {
      // `$effect.pre` runs its first pass synchronously, as React subscribes.
      $effect.pre(() => {
        const value = read();
        if (deep) trackDeep(value, new Set());
        if (first) {
          first = false;
          // Nothing rendered yet: this is the snapshot.
          if (snapshot === undefined) {
            snapshot = { value };
            return;
          }
          // Unchanged since the render that took the snapshot.
          if (Object.is(snapshot.value, value)) return;
        }
        // A getter that derives a primitive (a badge's flag from a tick that changes on
        // every sync) re-runs often to the same value: nothing to re-render. An object
        // can be the same `$state` proxy with different contents, so it always counts.
        if (
          !deep &&
          isPrimitive(value) &&
          snapshot !== undefined &&
          Object.is(snapshot.value, value)
        )
          return;
        snapshot = { value };
        untrack(onChange);
      });
    });
  };
  return { subscribe, getSnapshot };
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
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
