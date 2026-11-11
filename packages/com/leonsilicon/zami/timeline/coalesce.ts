// Many requests, one run: a burst of SDK events (decryptions, receipts) asks for a
// re-read once per event; the re-read runs once for the whole burst.

export interface CoalescerOptions {
  /**
   * How long to wait after the first request before running (ms). 0 (the default) runs on
   * the next turn of the event loop or the next animation frame, whichever comes first.
   */
  delayMs?: number;
  /** Timers, for tests. */
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  requestAnimationFrame?: ((run: () => void) => unknown) | null;
  cancelAnimationFrame?: ((handle: unknown) => void) | null;
}

export interface Coalescer {
  /** Ask for a run; the first request since the last run schedules it. */
  request(): void;
  /** Run now if a run is pending. */
  flush(): void;
  /** Drop a pending run. */
  cancel(): void;
  /** Whether a run is scheduled. */
  readonly pending: boolean;
}

export function createCoalescer(run: () => void, options: CoalescerOptions = {}): Coalescer {
  const delayMs = options.delayMs ?? 0;
  const setTimer = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer =
    options.clearTimeout ??
    ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const raf =
    options.requestAnimationFrame !== undefined
      ? options.requestAnimationFrame
      : typeof requestAnimationFrame === "function"
        ? (fn: () => void) => requestAnimationFrame(fn)
        : null;
  const cancelRaf =
    options.cancelAnimationFrame !== undefined
      ? options.cancelAnimationFrame
      : typeof cancelAnimationFrame === "function"
        ? (handle: unknown) => cancelAnimationFrame(handle as number)
        : null;
  let timer: unknown = null;
  let frame: unknown = null;
  let pending = false;

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    if (frame !== null) cancelRaf?.(frame);
    timer = null;
    frame = null;
  };
  const fire = () => {
    if (!pending) return;
    pending = false;
    clear();
    run();
  };

  return {
    request() {
      if (pending) return;
      pending = true;
      timer = setTimer(fire, delayMs);
      // A long chain of microtasks can hold a timer back; a frame is the other way the
      // event loop comes round, so take whichever is first.
      if (delayMs === 0 && raf) frame = raf(fire);
    },
    flush: fire,
    cancel() {
      pending = false;
      clear();
    },
    get pending() {
      return pending;
    },
  };
}
