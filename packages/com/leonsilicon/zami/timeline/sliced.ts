// A long synchronous loop, cut into slices of a few milliseconds with a turn of the
// event loop between them, so the app keeps drawing while it runs.

export interface SlicedLoopOptions {
  /** How long one slice may run (ms). */
  sliceMs: number;
  /** Stop early (checked between items); the loop then resolves `false`. */
  cancelled?: () => boolean;
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. */
  schedule?: (run: () => void) => void;
}

/**
 * Calls `fn` for each item in order, `sliceMs` at a time, waiting a turn of the event
 * loop (`setTimeout(0)`) between slices. Each slice runs at least one item. Resolves
 * `true` once every item ran, `false` if `cancelled` stopped it. An error from `fn`
 * rejects the promise and stops the loop.
 */
export function forEachSliced<T>(
  items: readonly T[],
  fn: (item: T, index: number) => void,
  options: SlicedLoopOptions,
): Promise<boolean> {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0));
  let i = 0;
  return new Promise<boolean>((resolve, reject) => {
    const slice = () => {
      try {
        if (options.cancelled?.()) return resolve(false);
        const start = now();
        do {
          fn(items[i]!, i);
          i++;
        } while (i < items.length && now() - start < options.sliceMs);
        if (i >= items.length) return resolve(true);
        schedule(slice);
      } catch (error) {
        reject(error);
      }
    };
    if (items.length === 0) resolve(true);
    else slice();
  });
}
