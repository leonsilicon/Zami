// The one queue every backlog of crypto calls goes through.
import { createSlicedQueue } from "@-/com.leonsilicon.zami.scheduler";

/** How long one turn of queued crypto work may hold the JS thread (ms). */
export const CRYPTO_SLICE_MS = 8;

/**
 * The shared crypto queue: queued decryption (the client's `decryptEventIfNeeded`), retries
 * after trust changes, trust and identity lookups, and key-request answers. One queue, so
 * they share one 8 ms budget per turn instead of each taking their own. Priorities are
 * timestamps: an event's `getTs()`, or `interactivePriority()` for something the user is
 * looking at now, so the newest work runs first.
 *
 * A queued task must not wait on another task of this queue (the queue runs one task at a
 * time, so it would wait forever), and should not wait on the network.
 */
export const cryptoQueue = createSlicedQueue({ sliceMs: CRYPTO_SLICE_MS, name: "crypto" });

/** The priority of work for what's on screen now: ahead of every older event. */
export function interactivePriority(): number {
  return Date.now();
}

/** What a retry needs from an event: its timestamp, for newest-first order. */
export interface TimedEvent {
  getTs?(): number;
}

/** An event's priority on the queue: newest first. */
export function eventPriority(event: TimedEvent): number {
  return typeof event.getTs === "function" ? event.getTs() : 0;
}

export interface QueueRetriesOptions<E> {
  /** Checked when the retry's turn comes: false skips it (the key arrived meanwhile). */
  stillNeeded?: (event: E) => boolean;
  /** Drops the retries that haven't started yet. */
  signal?: AbortSignal;
  /**
   * Start the first slice in the current task (the caller is a timer callback, a turn of
   * its own) instead of a turn later (`SlicedQueue.startTurn`).
   */
  startNow?: boolean;
}

/**
 * Queue a retry per event on the crypto queue, newest first. Resolves once every retry ran,
 * was skipped or was dropped; a retry's own failure is swallowed, as the callers did.
 */
export function queueRetries<E extends TimedEvent>(
  events: Iterable<E>,
  retry: (event: E) => Promise<unknown>,
  options: QueueRetriesOptions<E> = {},
): Promise<void> {
  const done: Promise<unknown>[] = [];
  for (const event of events) {
    done.push(
      cryptoQueue
        .add(
          async () => {
            if (options.stillNeeded && !options.stillNeeded(event)) return;
            await retry(event);
          },
          eventPriority(event),
          { signal: options.signal },
        )
        .catch(() => {}),
    );
  }
  if (options.startNow) cryptoQueue.startTurn();
  return Promise.all(done).then(() => {});
}
