import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createRuneStore } from "#subscribe.svelte";
import type { RuneStore, RuneStoreOptions } from "#subscribe.svelte";

const PausedContext = createContext(false);

/**
 * While `paused`, every `useRune` below stops watching its runes and keeps returning
 * what it last rendered, so a hidden subtree (the closed drawer) costs nothing per
 * sync. When `paused` turns false each one reads again and re-renders if its value
 * changed.
 */
export function PauseRunes({ paused, children }: { paused: boolean; children?: ReactNode }) {
  const outer = useContext(PausedContext);
  return createElement(PausedContext.Provider, { value: outer || paused }, children);
}

const pausedSubscribe = () => () => {};

function useStore<T>(store: RuneStore<T>): T {
  const paused = useContext(PausedContext);
  return useSyncExternalStore(paused ? pausedSubscribe : store.subscribe, store.getSnapshot).value;
}

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
 *
 * A primitive result re-renders only when it changes. An object result re-renders on
 * every change of what `read` read, unless `options.isEqual` (`sameObject`,
 * `shallowEqual` or your own) says it renders the same.
 */
export function useRune<T>(
  read: () => T,
  deps: readonly unknown[] = [],
  options?: Pick<RuneStoreOptions<T>, "isEqual">,
): T {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list.
  const store = useMemo(() => createRuneStore(read, { isEqual: options?.isEqual }), deps);
  return useStore(store);
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
  return useStore(store);
}
