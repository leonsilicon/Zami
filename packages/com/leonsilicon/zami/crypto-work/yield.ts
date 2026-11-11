// Giving the event loop a turn between pieces of long work.
//
// React Native draws, takes touches and runs timers only between tasks of the JS event loop.
// An awaited promise doesn't end a task, and on bridgeless React Native `setImmediate` is a
// microtask too, so only a timer does.

/** Resolves on a later turn of the event loop. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface YielderOptions {
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. */
  wait?: () => Promise<void>;
}

/**
 * A checkpoint for a loop of pieces of work. Between pieces, `maybeYield()` returns a promise
 * that resolves on the next turn of the event loop once `budgetMs` have passed since the last
 * turn it gave, and undefined (no timer, no microtask) while work is quick:
 *
 * ```ts
 * const maybeYield = createYielder(8);
 * for (const item of items) {
 *   work(item);
 *   const turn = maybeYield();
 *   if (turn) await turn;
 * }
 * ```
 */
export function createYielder(
  budgetMs: number,
  options: YielderOptions = {},
): () => Promise<void> | undefined {
  const now = options.now ?? (() => performance.now());
  const wait = options.wait ?? yieldToEventLoop;
  let since = now();
  return () => {
    if (now() - since < budgetMs) return undefined;
    return wait().then(() => {
      since = now();
    });
  };
}

/** Run `fn` over `items` in order, giving the event loop a turn every `budgetMs`. */
export async function forEachSliced<T>(
  items: Iterable<T>,
  fn: (item: T) => void,
  budgetMs = 8,
  options?: YielderOptions,
): Promise<void> {
  const maybeYield = createYielder(budgetMs, options);
  for (const item of items) {
    fn(item);
    const turn = maybeYield();
    if (turn) await turn;
  }
}
