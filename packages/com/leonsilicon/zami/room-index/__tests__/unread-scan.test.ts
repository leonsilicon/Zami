import { describe, expect, test } from "vite-plus/test";
import { hasUnreadEvents, type UnreadScanReader } from "#unread-scan";

interface View {
  id: string;
  ts: number;
  fromMe: boolean;
  isNotification: boolean;
}

/** Zam's `hasUnreadMessages` (src/lib/utils/roomUnread.ts), as it is upstream. */
function reference(input: {
  events: View[];
  readUpToId: string | null;
  receiptTs: number | null;
}): boolean {
  const { events, readUpToId, receiptTs } = input;
  if (events[events.length - 1]?.fromMe) return false;
  if (!readUpToId && receiptTs !== null) {
    if (!(receiptTs > 0)) return false;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.isNotification && !event.fromMe) return event.ts > receiptTs;
    }
    return false;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.id === readUpToId) return false;
    if (event.isNotification) return true;
  }
  return false;
}

const reader: UnreadScanReader<View> = {
  id: (e) => e.id,
  ts: (e) => e.ts,
  fromMe: (e) => e.fromMe,
  isNotification: (e) => e.isNotification,
};

/** A seeded PRNG (mulberry32), so a failure reproduces. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("hasUnreadEvents", () => {
  test("answers as Zam's hasUnreadMessages for random timelines", () => {
    const random = prng(1234);
    for (let run = 0; run < 5000; run++) {
      const length = Math.floor(random() * 8);
      const events: View[] = Array.from({ length }, (_, i) => ({
        id: random() < 0.05 ? "" : `$${i}`,
        ts: 1000 + i * 10,
        fromMe: random() < 0.3,
        isNotification: random() < 0.6,
      }));
      const pick = random();
      const readUpToId =
        pick < 0.3
          ? null
          : pick < 0.4
            ? ""
            : pick < 0.5
              ? "$missing"
              : `$${Math.floor(random() * 8)}`;
      const ts = random();
      const receiptTs =
        ts < 0.3 ? null : ts < 0.4 ? 0 : ts < 0.45 ? Number.NaN : 995 + Math.floor(random() * 90);
      const input = { events, readUpToId, receiptTs };
      expect(hasUnreadEvents(events, readUpToId, receiptTs, reader), JSON.stringify(input)).toBe(
        reference(input),
      );
    }
  });

  test("reads only the newest events it needs", () => {
    const events: View[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `$${i}`,
      ts: i,
      fromMe: false,
      isNotification: true,
    }));
    let reads = 0;
    const counting: UnreadScanReader<View> = {
      id: (e) => (reads++, e.id),
      ts: (e) => e.ts,
      fromMe: (e) => e.fromMe,
      isNotification: (e) => (reads++, e.isNotification),
    };
    expect(hasUnreadEvents(events, "$999", null, counting)).toBe(false);
    expect(reads).toBe(1);
    reads = 0;
    expect(hasUnreadEvents(events, "$5", null, counting)).toBe(true);
    expect(reads).toBe(2);
  });

  test("an empty timeline is read", () => {
    expect(hasUnreadEvents([], null, null, reader)).toBe(false);
    expect(hasUnreadEvents([], null, 50, reader)).toBe(false);
  });
});
