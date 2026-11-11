// Whether a room's loaded timeline has unread messages, read backwards from the newest
// event and only as far as the answer needs.

/**
 * How the scan reads one event. Made once and reused, so a scan allocates nothing.
 */
export interface UnreadScanReader<E> {
  /** The event's id, or "" when it has none. */
  id(event: E): string;
  ts(event: E): number;
  fromMe(event: E): boolean;
  /** A message-like event that makes a room unread. */
  isNotification(event: E): boolean;
}

/**
 * Zam's `hasUnreadMessages` (`src/lib/utils/roomUnread.ts`), answering the same for every
 * input, over the timeline's own events instead of a copy mapped from all of them. Zam built
 * that copy, one object per loaded event, on every call; this reads only the events it
 * reaches, newest first, and stops at the first that decides.
 *
 * `readUpToId` is the event our read receipt points at when it is loaded. `receiptTs` is
 * the newest timestamp among our receipts, or null when we have none. Only a falsy
 * `readUpToId` reads it, so a caller with a `readUpToId` needn't work it out.
 */
export function hasUnreadEvents<E>(
  events: readonly E[],
  readUpToId: string | null,
  receiptTs: number | null,
  read: UnreadScanReader<E>,
): boolean {
  const last = events.length - 1;
  if (last >= 0 && read.fromMe(events[last]!)) return false;

  if (!readUpToId && receiptTs !== null) {
    if (!(receiptTs > 0)) return false;
    for (let i = last; i >= 0; i--) {
      const event = events[i]!;
      if (read.isNotification(event) && !read.fromMe(event)) return read.ts(event) > receiptTs;
    }
    return false;
  }

  for (let i = last; i >= 0; i--) {
    const event = events[i]!;
    if (read.id(event) === readUpToId) return false;
    if (read.isNotification(event)) return true;
  }
  return false;
}
