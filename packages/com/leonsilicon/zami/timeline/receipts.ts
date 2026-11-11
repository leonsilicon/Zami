// Who a read-receipt event (m.receipt) is about.

/** An m.receipt event's content: event id → receipt type → user id → receipt. */
export type ReceiptContent = Record<string, Record<string, Record<string, unknown> | undefined>>;

/** The users whose public (`m.read`) receipts `content` moves. */
export function publicReceiptReaders(content: ReceiptContent | undefined): Set<string> {
  const readers = new Set<string>();
  if (!content) return readers;
  for (const byType of Object.values(content)) {
    const read = byType?.["m.read"];
    if (read) for (const userId of Object.keys(read)) readers.add(userId);
  }
  return readers;
}

/**
 * Whether `content` moves anyone's public receipt but `ownUserId`'s: what the timeline's
 * read-receipt avatars show. The user's own receipts, which are most of them (one per
 * message read), and private ones change nothing there.
 */
export function movesOthersReceipts(
  content: ReceiptContent | undefined,
  ownUserId: string | null,
): boolean {
  for (const userId of publicReceiptReaders(content)) if (userId !== ownUserId) return true;
  return false;
}
