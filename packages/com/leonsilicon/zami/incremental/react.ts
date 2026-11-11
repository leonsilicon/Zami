import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createSelection } from "#selection";
import type { Selection } from "#selection";
import { createThrottledRuneStore } from "#throttled-rune.svelte";

/**
 * `useRune` for a primitive (Zam's `roomsTick`) that re-renders at most once per `ms`:
 * at once after a quiet spell, then once at the end of a burst. For a screen that
 * re-renders whole on the tick and can show a sync's changes a moment late.
 */
export function useThrottledRune<T>(read: () => T, ms: number, deps: readonly unknown[] = []): T {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list.
  const store = useMemo(() => createThrottledRuneStore(read, { ms }), [ms, ...deps]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** A `Selection` that lives as long as the component. */
export function useSelection<K>(): Selection<K> {
  const [selection] = useState(() => createSelection<K>());
  return selection;
}

/**
 * Whether `key` is the selected one. Re-renders only when that flips, so a cursor
 * move re-renders two items, not the list.
 */
export function useSelected<K>(selection: Selection<K>, key: K): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => selection.subscribe(key, onChange),
    [selection, key],
  );
  const getSnapshot = () => Object.is(selection.get(), key);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * `value`, but only once it has stayed the same for `ms`: a search over thousands of
 * items runs once per pause in typing rather than per keystroke. A value for which
 * `immediate` says so (clearing a search) goes through at once.
 */
export function useDebouncedValue<T>(value: T, ms: number, immediate?: (value: T) => boolean): T {
  const [settled, setSettled] = useState(value);
  const now = immediate?.(value) ?? false;
  useEffect(() => {
    if (now) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, now]);
  return now ? value : settled;
}

/**
 * A function that keeps its identity across renders and calls the latest `fn`: a
 * callback for memoized rows that doesn't re-render them when the state it reads
 * changes. Call it from events, not during render.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

/**
 * How many of `total` items to render: `step` at first, then `step` more each turn of
 * the event loop until all are, so a long list inside a scroll view that can't be
 * virtualized mounts a slice per frame instead of all at once. Starts over when `reset`
 * changes.
 */
export function useProgressiveCount(total: number, step: number, reset?: unknown): number {
  const [state, setState] = useState({ count: step, reset });
  // A new list starts at one step again (set during render, as React allows for
  // state derived from props).
  if (!Object.is(state.reset, reset)) setState({ count: step, reset });
  const count = Object.is(state.reset, reset) ? state.count : step;
  useEffect(() => {
    if (count >= total) return;
    const timer = setTimeout(
      () => setState((current) => ({ ...current, count: current.count + step })),
      0,
    );
    return () => clearTimeout(timer);
  }, [count, total, step]);
  return Math.min(count, total);
}
