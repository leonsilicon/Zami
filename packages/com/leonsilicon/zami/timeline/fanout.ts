// One listener on an emitter for many subscribers, each event classified once.
//
// A dozen subscribers to the client's RoomEvent.Timeline each re-read every event's type
// and relation, including the thousands a launch replays from the saved sync. A fanout
// registers once, works out an event's facts once (lazily), and runs each classifier
// once per event however many subscribers share it.

/** Turns an event into what its subscribers get, or `null` to skip them. */
export type Classifier<A extends unknown[], F, R extends unknown[]> = (
  facts: F,
  ...args: A
) => R | null;

export interface Fanout<A extends unknown[], F> {
  /** Calls `listener` with the emitter's arguments and their facts. Returns its removal. */
  add(listener: (facts: F, ...args: A) => void): () => void;
  /**
   * Calls `listener` with what `classify` makes of each event, when that isn't `null`.
   * Subscribers with the same `key` (by default the same `classify`) share one result:
   * the first one's `classify` runs once per event for all of them.
   */
  addClassified<R extends unknown[]>(
    classify: Classifier<A, F, R>,
    listener: (...result: R) => void,
    key?: unknown,
  ): () => void;
  /** What the emitter calls. */
  readonly emit: (...args: A) => void;
  /** How many subscribers there are. */
  readonly size: number;
}

export interface FanoutOptions<A extends unknown[], F> {
  /** The facts about one event, made once per emit (make its fields lazy). */
  facts: (...args: A) => F;
  /** Start listening to the emitter (first subscriber). */
  attach: (emit: (...args: A) => void) => void;
  /** Stop listening (last subscriber gone). */
  detach: (emit: (...args: A) => void) => void;
}

type Entry<A extends unknown[], F> =
  | { classify: null; key: null; listener: (facts: F, ...args: A) => void }
  | {
      classify: Classifier<A, F, unknown[]>;
      key: unknown;
      listener: (...result: unknown[]) => void;
    };

const UNSET = Symbol("unset");

export function createFanout<A extends unknown[], F>(options: FanoutOptions<A, F>): Fanout<A, F> {
  // Copied on write, so a subscriber added or removed mid-emit takes effect next time.
  let entries: Entry<A, F>[] = [];

  const emit = (...args: A) => {
    const current = entries;
    if (current.length === 0) return;
    const facts = options.facts(...args);
    const results = new Map<unknown, unknown[] | null>();
    let failure: unknown = UNSET;
    for (const entry of current) {
      try {
        if (!entry.classify) {
          entry.listener(facts, ...args);
          continue;
        }
        let result = results.get(entry.key);
        if (result === undefined) {
          result = entry.classify(facts, ...args);
          results.set(entry.key, result);
        }
        if (result) entry.listener(...result);
      } catch (error) {
        // As with separate listeners, the error reaches the emitter, but not before the
        // other subscribers have had the event.
        if (failure === UNSET) failure = error;
      }
    }
    if (failure !== UNSET) throw failure;
  };

  const add = (entry: Entry<A, F>) => {
    if (entries.length === 0) options.attach(emit);
    entries = [...entries, entry];
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      entries = entries.filter((e) => e !== entry);
      if (entries.length === 0) options.detach(emit);
    };
  };

  return {
    add: (listener) => add({ classify: null, key: null, listener }),
    addClassified: (classify, listener, key = classify) =>
      add({
        classify: classify as Classifier<A, F, unknown[]>,
        key,
        listener: listener as (...result: unknown[]) => void,
      }),
    emit,
    get size() {
      return entries.length;
    },
  };
}
