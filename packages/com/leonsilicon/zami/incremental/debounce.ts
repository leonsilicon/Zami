export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Runs the pending call now, if there is one. */
  flush(): void;
  /** Drops the pending call. */
  cancel(): void;
}

/**
 * `fn` called `ms` after the last of a burst of calls, with that last call's arguments.
 * For writes that only the final value of matters (a color typed one hex digit at a
 * time): the burst costs one write.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: A | undefined;
  const run = () => {
    const args = pendingArgs;
    timer = undefined;
    pendingArgs = undefined;
    if (args !== undefined) fn(...args);
  };
  const debounced = (...args: A) => {
    pendingArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pendingArgs = undefined;
  };
  return debounced;
}
