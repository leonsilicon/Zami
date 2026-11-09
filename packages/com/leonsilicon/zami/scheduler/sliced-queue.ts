// A priority queue of async tasks, run a slice at a time between turns of the event loop.

export interface SlicedQueueOptions {
  /** How long one turn may run tasks before yielding (ms). */
  sliceMs: number;
  /** Clock, for tests. */
  now?: () => number;
  /** How to wait for the next turn, for tests. */
  schedule?: (run: () => void) => void;
}

export interface SlicedQueue {
  /** Queue `task`; higher `priority` runs first. Resolves or rejects with the task. */
  add<T>(task: () => Promise<T>, priority?: number): Promise<T>;
  /** Tasks waiting to start. */
  readonly size: number;
}

interface Entry {
  run: () => Promise<void>;
  priority: number;
  order: number;
}

export function createSlicedQueue(options: SlicedQueueOptions): SlicedQueue {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((run) => void setTimeout(run, 0));
  // A binary max-heap on (priority, then earliest added).
  const heap: Entry[] = [];
  let added = 0;
  let scheduled = false;

  const before = (a: Entry, b: Entry) =>
    a.priority !== b.priority ? a.priority > b.priority : a.order < b.order;
  const swap = (i: number, j: number) => {
    const t = heap[i]!;
    heap[i] = heap[j]!;
    heap[j] = t;
  };
  const push = (entry: Entry) => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i]!, heap[parent]!)) break;
      swap(i, parent);
      i = parent;
    }
  };
  const pop = (): Entry | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < heap.length && before(heap[l]!, heap[best]!)) best = l;
        if (r < heap.length && before(heap[r]!, heap[best]!)) best = r;
        if (best === i) break;
        swap(i, best);
        i = best;
      }
    }
    return top;
  };

  const turn = async (): Promise<void> => {
    const start = now();
    while (heap.length > 0 && now() - start < options.sliceMs) await pop()!.run();
    if (heap.length > 0) schedule(() => void turn());
    else scheduled = false;
  };

  return {
    add<T>(task: () => Promise<T>, priority = 0): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        push({
          run: () => {
            try {
              return task().then(resolve, reject);
            } catch (error) {
              reject(error);
              return Promise.resolve();
            }
          },
          priority,
          order: added++,
        });
        if (scheduled) return;
        scheduled = true;
        schedule(() => void turn());
      });
    },
    get size() {
      return heap.length;
    },
  };
}
