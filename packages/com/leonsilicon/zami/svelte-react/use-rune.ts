import { useMemo, useSyncExternalStore } from "react";
import { createRuneStore } from "#subscribe.svelte";

/**
 * Reads Svelte runes from a React component:
 *
 *   const toasts = useRune(() => toastsState.toasts);
 *
 * The component re-renders whenever a rune `read` touched changes. Pass `deps` when
 * `read` closes over props or state, as with `useEffect`.
 *
 * It only sees what `read` reads: `useRune(() => state.byRoom)` misses a write to
 * `state.byRoom[id]`, because it read `byRoom` but nothing inside it. Read down to the
 * values you render (`useRune(() => state.byRoom[id], [id])`), or use `useDeepRune`.
 */
export function useRune<T>(read: () => T, deps: readonly unknown[] = []): T {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list.
  const store = useMemo(() => createRuneStore(read), deps);
  return useSyncExternalStore(store.subscribe, store.getSnapshot).value;
}

/**
 * `useRune` that also re-renders on any change inside the plain objects and arrays
 * `read` returns, however deep (it stops at class instances). It returns the same
 * `$state` proxy after a nested change, so don't put the result in a `useMemo` or
 * `useEffect` dependency list; depend on the values inside it.
 */
export function useDeepRune<T>(read: () => T, deps: readonly unknown[] = []): T {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list.
  const store = useMemo(() => createRuneStore(read, true), deps);
  return useSyncExternalStore(store.subscribe, store.getSnapshot).value;
}
