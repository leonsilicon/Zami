// A time budget for a long loop on the JS thread: run a slice, then give the event loop a
// turn (a macrotask), so the app draws and handles input in between.

export interface SlicerOptions {
  /** How long a slice may run before the loop gives up its turn (ms). Default 8. */
  sliceMs?: number;
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. */
  schedule?: (run: () => void) => void;
}

export interface Slicer {
  /** Whether this slice has used up its time. Cheap enough to read every iteration. */
  readonly due: boolean;
  /** Waits for a later turn of the event loop, then starts a new slice. */
  pause(): Promise<void>;
}

/** Resolves on a later turn of the event loop (`setTimeout(0)`): not a microtask, which
 * React Native runs before drawing or handling input (on bridgeless React Native
 * `setImmediate` is one too). */
export function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A slicer for one long loop: check `due` as it goes, and `await pause()` when it's true.
 *
 * ```ts
 * const slicer = createSlicer();
 * for (const item of items) {
 *   if (slicer.due) await slicer.pause();
 *   work(item);
 * }
 * ```
 */
export function createSlicer(options: SlicerOptions = {}): Slicer {
  const sliceMs = options.sliceMs ?? 8;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule;
  let start = now();
  return {
    get due() {
      return now() - start >= sliceMs;
    },
    async pause() {
      if (schedule) await new Promise<void>((resolve) => schedule(resolve));
      else await nextTurn();
      start = now();
    },
  };
}
