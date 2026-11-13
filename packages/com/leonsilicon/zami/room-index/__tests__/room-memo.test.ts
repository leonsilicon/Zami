import { describe, expect, test } from "vite-plus/test";
import { createRoomMemo } from "#room-memo";

interface FakeRoom {
  roomId: string;
  events: string[];
}

function harness() {
  let computes = 0;
  const memo = createRoomMemo<FakeRoom, number>({
    idOf: (room) => room.roomId,
    fingerprintSize: 2,
    fingerprint(room, out) {
      out[0] = room.events;
      out[1] = room.events.length;
    },
    compute(room) {
      computes++;
      return room.events.length;
    },
  });
  return { memo, computes: () => computes };
}

describe("createRoomMemo", () => {
  test("computes a room once while nothing changes", () => {
    const { memo, computes } = harness();
    const room = { roomId: "!a", events: ["$1"] };
    expect(memo.get(room)).toBe(1);
    expect(memo.get(room)).toBe(1);
    expect(computes()).toBe(1);
  });

  test("computes again when the fingerprint changes", () => {
    const { memo, computes } = harness();
    const room = { roomId: "!a", events: ["$1"] };
    memo.get(room);
    room.events.push("$2");
    expect(memo.get(room)).toBe(2);
    expect(computes()).toBe(2);
  });

  test("computes again after invalidate, for that room only", () => {
    const { memo, computes } = harness();
    const a = { roomId: "!a", events: [] };
    const b = { roomId: "!b", events: [] };
    memo.get(a);
    memo.get(b);
    memo.invalidate("!a");
    memo.get(a);
    memo.get(b);
    expect(computes()).toBe(3);
    memo.invalidateAll();
    memo.get(a);
    memo.get(b);
    expect(computes()).toBe(5);
  });

  test("computes again for another object with the same id", () => {
    const { memo, computes } = harness();
    const events = ["$1"];
    memo.get({ roomId: "!a", events });
    memo.get({ roomId: "!a", events });
    expect(computes()).toBe(2);
  });
});
