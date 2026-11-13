// A cap on how many transfers run at once. The newest waiting task starts first: when a
// timeline is scrolled, the rows on screen now matter more than the ones scrolled past,
// whose tasks are usually cancelled anyway.

export interface Limiter {
  /**
   * Runs `task` once fewer than the cap are running. `cancelled()` is checked before it
   * starts: a task cancelled while it waited never runs, and its promise rejects with
   * what `cancelled()` returned.
   */
  run<T>(task: () => Promise<T>, cancelled?: () => Error | null): Promise<T>;
  /** Tasks running and waiting, for tests and diagnostics. */
  readonly running: number;
  readonly waiting: number;
}

export function createLimiter(max: number): Limiter {
  let running = 0;
  const waiting: (() => void)[] = [];

  function next(): void {
    while (running < max) {
      const start = waiting.pop();
      if (!start) return;
      start();
    }
  }

  return {
    run(task, cancelled) {
      return new Promise((resolve, reject) => {
        const start = () => {
          const reason = cancelled?.();
          if (reason) {
            reject(reason);
            return;
          }
          running++;
          let promise: Promise<unknown>;
          try {
            promise = task();
          } catch (error) {
            promise = Promise.reject(error);
          }
          promise.then(resolve as (value: unknown) => void, reject).finally(() => {
            running--;
            next();
          });
        };
        waiting.push(start);
        next();
      });
    },
    get running() {
      return running;
    },
    get waiting() {
      return waiting.length;
    },
  };
}
