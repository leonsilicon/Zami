import { describe, expect, test } from "vite-plus/test";
import { loadMembersInSlices, MemberIndex, type SlicedMembersRoom } from "#members";

interface FakeEvent {
  userId: string;
}

function fakeRoom(raw: object[]) {
  const calls: string[] = [];
  const set: string[] = [];
  let release!: () => void;
  const server = new Promise<void>((resolve) => (release = resolve));
  const state = {
    markOutOfBandMembersStarted: () => calls.push("started"),
    markOutOfBandMembersFailed: () => calls.push("failed"),
    setOutOfBandMember: (e: FakeEvent) => set.push(e.userId),
    setOutOfBandMembers: (events: FakeEvent[]) => calls.push(`finished:${events.length}`),
  };
  const room: SlicedMembersRoom<FakeEvent> & { failNext?: boolean } = {
    currentState: state,
    async loadMembersFromServer() {
      calls.push("fetch");
      await server;
      if (room.failNext) throw new Error("offline");
      return raw;
    },
    recalculate: () => calls.push("recalculate"),
  };
  return { room, calls, set, release };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("loadMembersInSlices", () => {
  test("applies members a slice per turn, then finishes like the SDK", async () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ state_key: `@u${i}:hs` }));
    const { room, calls, set, release } = fakeRoom(raw);
    let clock = 0;
    const turns: (() => void)[] = [];
    const done = loadMembersInSlices(room, {
      mapEvent: (r) => {
        clock += 3;
        return { userId: (r as { state_key: string }).state_key };
      },
      sliceMs: 8,
      now: () => clock,
      schedule: (run) => turns.push(run),
    });
    expect(calls).toEqual(["started", "fetch"]);
    // Shared with the SDK's callers while it runs.
    expect(room.membersPromise).toBe(done);
    expect(loadMembersInSlices(room, { mapEvent: () => ({ userId: "" }) })).toBe(done);
    release();
    await settle();
    expect(set).toEqual(["@u0:hs", "@u1:hs", "@u2:hs"]);
    expect(calls).not.toContain("finished:0");
    turns.shift()!();
    await settle();
    expect(set).toHaveLength(5);
    expect(await done).toBe(true);
    expect(calls.slice(-2)).toEqual(["finished:0", "recalculate"]);
  });

  test("skips events with unsafe ids", async () => {
    const { room, set, release } = fakeRoom([
      { state_key: "@a:hs", sender: "__proto__" },
      { state_key: "@b:hs", sender: "@b:hs" },
    ]);
    const done = loadMembersInSlices(room, {
      mapEvent: (r) => ({ userId: (r as { state_key: string }).state_key }),
    });
    release();
    await done;
    expect(set).toEqual(["@b:hs"]);
  });

  test("a failure lets the next caller try again", async () => {
    const { room, calls, release } = fakeRoom([]);
    room.failNext = true;
    const done = loadMembersInSlices(room, { mapEvent: () => ({ userId: "" }) });
    release();
    await expect(done).rejects.toThrow("offline");
    await settle();
    expect(room.membersPromise).toBeUndefined();
    expect(calls).toContain("failed");
  });
});

describe("MemberIndex", () => {
  const members = [
    { userId: "@alice:hs", rawDisplayName: "Alice" },
    { userId: "@bob:hs", rawDisplayName: "Bobby " },
    { userId: "@me:hs", rawDisplayName: "Me" },
    { userId: "@carol:other", rawDisplayName: "alice" },
    { userId: "@dave:hs" },
  ];
  const index = new MemberIndex(members);

  test("search matches ids and names in any case, in order, skipping the user", () => {
    expect(index.search("ALI", "@me:hs", 8).map((m) => m.userId)).toEqual([
      "@alice:hs",
      "@carol:other",
    ]);
    expect(index.search("hs", "@me:hs", 2).map((m) => m.userId)).toEqual(["@alice:hs", "@bob:hs"]);
    expect(index.search("", null, 8)).toHaveLength(5);
  });

  test("matchesToken is the composer's isMentionToken over the members", () => {
    const naive = (token: string) => {
      const name = token.slice(1).replace(/[.,!?;:]$/, "");
      return members.some(
        (m) =>
          m.userId === token ||
          m.userId.toLowerCase().includes(name.toLowerCase()) ||
          (m.rawDisplayName ?? "").toLowerCase() === name.toLowerCase(),
      );
    };
    for (const token of [
      "@alice",
      "@Alice,",
      "@bobby",
      "@bob",
      "@dave:hs",
      "@zed",
      "@:other",
      "@.",
    ])
      expect(index.matchesToken(token)).toBe(naive(token));
  });

  test("countSharingName counts trimmed names in any case", () => {
    expect(index.countSharingName("Alice")).toBe(2);
    expect(index.countSharingName("bobby")).toBe(1);
    expect(index.countSharingName("nobody")).toBe(0);
  });
});
