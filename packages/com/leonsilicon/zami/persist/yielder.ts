// Gives the event loop a turn once a slice of work has used up its time.

export interface YielderOptions {
  /** How long work may run before the event loop gets a turn (ms). Default 8. */
  sliceMs?: number;
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. Default `setTimeout(run, 0)`. */
  schedule?: (run: () => void) => void;
}

export interface Yielder {
  /** Whether the current slice has used up its time. */
  readonly due: boolean;
  /**
   * Resolves on a later turn of the event loop (a macrotask, so React Native can draw and
   * handle touches in between), where a new slice begins. Callers waiting at the same time
   * share the turn.
   */
  next(): Promise<void>;
}

/**
 * A promise chain never gives up the JS thread (on React Native even `setImmediate` is a
 * microtask), so a long loop of small awaited steps freezes the app until it ends. Check
 * `due` between steps and `await next()` when it's set:
 *
 * ```ts
 * const turn = createYielder();
 * for (const room of rooms) {
 *   if (turn.due) await turn.next();
 *   save(room);
 * }
 * ```
 */
export function createYielder(options: YielderOptions = {}): Yielder {
  const sliceMs = options.sliceMs ?? 8;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0));
  let start = now();
  let gate: Promise<void> | null = null;
  return {
    get due() {
      return now() - start >= sliceMs;
    },
    next() {
      gate ??= new Promise<void>((resolve) =>
        schedule(() => {
          gate = null;
          start = now();
          resolve();
        }),
      );
      return gate;
    },
  };
}
