// A value that changes often (the composer's text, an autocomplete's query), held
// outside React state so that only the components reading it re-render, and only when
// what they read of it changes.

import { useCallback, useRef, useSyncExternalStore } from "react";

export interface ValueStore<T> {
  get: () => T;
  /** Replaces the value and tells the subscribers (none when it's the same). */
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * What `select` makes of the store's value. The component re-renders only when that
 * changes (`isEqual`, `Object.is` by default), so return a primitive, or pass an
 * `isEqual` that says when two results render the same.
 */
export function useValueStore<T, S>(
  store: ValueStore<T>,
  select: (value: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const last = useRef<{ value: T; select: (value: T) => S; selected: S } | null>(null);
  const getSnapshot = useCallback(() => {
    const value = store.get();
    const prev = last.current;
    if (prev && Object.is(prev.value, value) && prev.select === select) return prev.selected;
    let selected = select(value);
    if (prev && isEqual(prev.selected, selected)) selected = prev.selected;
    last.current = { value, select, selected };
    return selected;
  }, [store, select, isEqual]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
