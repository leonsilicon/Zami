import { useEffect, useReducer } from "react";
import { subscribeRune } from "#subscribe.svelte";

/**
 * Reads Svelte runes from a React component:
 *
 *   const toasts = useRune(() => toastsState.toasts);
 *
 * The component re-renders whenever a rune `read` touched changes. Pass `deps` when
 * `read` closes over props or state, as with `useEffect`.
 */
export function useRune<T>(read: () => T, deps: readonly unknown[] = []): T {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list.
  useEffect(() => subscribeRune(read, rerender), deps);
  return read();
}
