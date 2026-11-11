// A priority queue of async tasks, run a slice at a time between turns of the event loop.

export interface SlicedQueueOptions {
  /** How long one turn may run tasks before yielding (ms). */
  sliceMs: number;
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. */
  schedule?: (run: () => void) => void;
  /**
   * Share one queue between every caller that names it: the first call with a name creates
   * the queue (with its options) and later calls with the same name get that queue. Work
   * routed through one queue shares one time budget per turn, where two queues would each
   * take their own.
   */
  name?: string;
}

export interface SlicedTaskOptions {
  /**
   * Drops the task if it is aborted before it starts: its promise rejects with the
   * signal's reason, and the queue never runs it. A task already running isn't stopped.
   */
  signal?: AbortSignal;
}

export interface SlicedQueue {
  /** Queue `task`; higher `priority` runs first. Resolves or rejects with the task. */
  add<T>(task: () => Promise<T>, priority?: number, options?: SlicedTaskOptions): Promise<T>;
  /**
   * Run a turn now, in the current task, unless one is running. For work queued from a
   * timer callback, which is a turn of the event loop of its own: it starts there instead
   * of a turn later. Don't call it from inside a long chain of promises, which it would
   * make longer.
   */
  startTurn(): void;
  /** Tasks waiting to start. */
  readonly size: number;
}

interface Entry {
  run: () => Promise<void>;
  priority: number;
  order: number;
  /** Where the entry is in the heap, so an abort can take it out; -1 once it's out. */
  index: number;
}

const named = new Map<string, SlicedQueue>();

export function createSlicedQueue(options: SlicedQueueOptions): SlicedQueue {
  if (options.name !== undefined) {
    const existing = named.get(options.name);
    if (existing) return existing;
  }
  const queue = createQueue(options);
  if (options.name !== undefined) named.set(options.name, queue);
  return queue;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("The task was aborted before it started.");
}

function createQueue(options: SlicedQueueOptions): SlicedQueue {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0));
  // A binary max-heap on (priority, then earliest added).
  const heap: Entry[] = [];
  let added = 0;
  // A turn is waiting for its timer; a turn is running.
  let timerPending = false;
  let turnRunning = false;

  const before = (a: Entry, b: Entry) =>
    a.priority !== b.priority ? a.priority > b.priority : a.order < b.order;
  const place = (entry: Entry, i: number) => {
    heap[i] = entry;
    entry.index = i;
  };
  const up = (i: number) => {
    const entry = heap[i]!;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(entry, heap[parent]!)) break;
      place(heap[parent]!, i);
      i = parent;
    }
    place(entry, i);
  };
  const down = (i: number) => {
    const entry = heap[i]!;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let best = entry;
      let bestIndex = i;
      if (l < heap.length && before(heap[l]!, best)) {
        best = heap[l]!;
        bestIndex = l;
      }
      if (r < heap.length && before(heap[r]!, best)) {
        best = heap[r]!;
        bestIndex = r;
      }
      if (bestIndex === i) break;
      place(best, i);
      i = bestIndex;
    }
    place(entry, i);
  };
  const push = (entry: Entry) => {
    heap.push(entry);
    up(heap.length - 1);
  };
  /** Take the entry at `i` out of the heap. */
  const remove = (i: number): Entry => {
    const entry = heap[i]!;
    const last = heap.pop()!;
    if (last !== entry) {
      place(last, i);
      up(i);
      down(last.index);
    }
    entry.index = -1;
    return entry;
  };
  const pop = (): Entry | undefined => (heap.length > 0 ? remove(0) : undefined);

  const scheduleTurn = () => {
    if (timerPending) return;
    timerPending = true;
    schedule(() => {
      timerPending = false;
      void turn();
    });
  };
  const turn = async (): Promise<void> => {
    if (turnRunning) return;
    turnRunning = true;
    const start = now();
    try {
      while (heap.length > 0 && now() - start < options.sliceMs) await pop()!.run();
    } finally {
      turnRunning = false;
    }
    if (heap.length > 0) scheduleTurn();
  };

  return {
    add<T>(task: () => Promise<T>, priority = 0, taskOptions?: SlicedTaskOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const signal = taskOptions?.signal;
        if (signal?.aborted) {
          reject(abortReason(signal));
          return;
        }
        const onAbort = () => {
          if (entry.index >= 0) remove(entry.index);
          reject(abortReason(signal!));
        };
        const entry: Entry = {
          run: () => {
            signal?.removeEventListener("abort", onAbort);
            try {
              return task().then(resolve, reject);
            } catch (error) {
              reject(error);
              return Promise.resolve();
            }
          },
          priority,
          order: added++,
          index: -1,
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        push(entry);
        // A running turn schedules the next one when it ends.
        if (!turnRunning) scheduleTurn();
      });
    },
    startTurn() {
      // A turn whose timer is pending finds less (or nothing) to do when it comes.
      if (turnRunning || heap.length === 0) return;
      void turn();
    },
    get size() {
      return heap.length;
    },
  };
}
