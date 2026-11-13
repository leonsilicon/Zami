import { describe, expect, test } from "vite-plus/test";
import { createUnreadRollups, type UnreadFlags } from "#unread-rollups";

function harness(initial: Record<string, UnreadFlags>) {
  const state = new Map(Object.entries(initial));
  const asked: string[] = [];
  const rollups = createUnreadRollups({
    flags(roomId) {
      asked.push(roomId);
      return state.get(roomId) ?? null;
    },
  });
  const set = (roomId: string, flags: UnreadFlags) => {
    state.set(roomId, flags);
    rollups.changed(roomId);
  };
  return { rollups, state, set, asked };
}

const READ = { unread: false, highlight: false };
const UNREAD = { unread: true, highlight: false };
const MENTION = { unread: false, highlight: true };

describe("createUnreadRollups", () => {
  test("counts a group's unread and highlighted rooms", () => {
    const { rollups } = harness({ "!a": READ, "!b": UNREAD, "!c": MENTION });
    const group = rollups.group("home", () => ["!a", "!b", "!c", "!gone"]);
    expect(group.unread).toBe(2);
    expect(group.highlight).toBe(1);
    expect([...group.members]).toEqual(["!a", "!b", "!c", "!gone"]);
  });

  test("builds a group once, and asks each room once across groups", () => {
    const { rollups, asked } = harness({ "!a": UNREAD, "!b": READ });
    let builds = 0;
    const members = () => (builds++, ["!a", "!b"]);
    rollups.group("s1", members);
    rollups.group("s1", members);
    rollups.group("s2", () => ["!a"]);
    expect(builds).toBe(1);
    expect(asked).toEqual(["!a", "!b"]);
  });

  test("follows a changed room in every group it is in, asking it once", () => {
    const { rollups, set, asked } = harness({ "!a": READ, "!b": READ });
    rollups.group("s1", () => ["!a", "!b"]);
    rollups.group("s2", () => ["!a"]);
    asked.length = 0;
    set("!a", MENTION);
    set("!a", { unread: true, highlight: true });
    expect(rollups.group("s1", () => []).unread).toBe(1);
    expect(rollups.group("s2", () => []).highlight).toBe(1);
    expect(asked).toEqual(["!a"]);
    set("!a", READ);
    expect(rollups.group("s1", () => []).unread).toBe(0);
    expect(rollups.group("s2", () => []).highlight).toBe(0);
  });

  test("ignores changes to rooms no group counts", () => {
    const { rollups, set, asked } = harness({ "!a": READ });
    set("!z", UNREAD);
    rollups.group("s1", () => ["!a"]);
    expect(asked).toEqual(["!a"]);
  });

  test("rebuilds groups after a structure change, keeping counts it has", () => {
    const { rollups, set, asked } = harness({ "!a": UNREAD, "!b": READ });
    rollups.group("s1", () => ["!a"]);
    set("!a", READ);
    rollups.invalidateStructure();
    asked.length = 0;
    const group = rollups.group("s1", () => ["!a", "!b"]);
    expect(group.unread).toBe(0);
    expect(asked).toEqual(["!a", "!b"]);
  });

  test("with a slice, counts a large group a slice per turn, then says so", () => {
    let clock = 0;
    const turns: (() => void)[] = [];
    let counted = 0;
    const ids = Array.from({ length: 10 }, (_, i) => `!${i}`);
    const rollups = createUnreadRollups({
      flags: () => {
        clock += 1;
        return UNREAD;
      },
      sliceMs: 3,
      now: () => clock,
      schedule: (run) => turns.push(run),
      onCounted: () => counted++,
    });
    const group = rollups.group("home", () => ids);
    expect(group.unread).toBe(3);
    expect(rollups.backlog).toBe(7);
    expect(turns).toHaveLength(1);
    // Reading again while the rest waits doesn't count it now.
    expect(rollups.group("home", () => ids).unread).toBe(3);
    while (turns.length) turns.shift()!();
    expect(group.unread).toBe(10);
    expect(rollups.backlog).toBe(0);
    expect(counted).toBe(1);
  });

  test("forgetting everything stops counting that was left for later", () => {
    const turns: (() => void)[] = [];
    let clock = 0;
    let counted = 0;
    const rollups = createUnreadRollups({
      flags: () => ((clock += 5), UNREAD),
      sliceMs: 1,
      now: () => clock,
      schedule: (run) => turns.push(run),
      onCounted: () => counted++,
    });
    rollups.group("home", () => ["!a", "!b", "!c"]);
    rollups.invalidateAll();
    while (turns.length) turns.shift()!();
    expect(counted).toBe(0);
    expect(rollups.backlog).toBe(0);
  });

  test("matches counting from scratch through random changes", () => {
    let seed = 99;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const ids = Array.from({ length: 12 }, (_, i) => `!${i}`);
    const flagsOf = (): UnreadFlags => ({ unread: random() < 0.4, highlight: random() < 0.2 });
    const { rollups, state, set } = harness(Object.fromEntries(ids.map((id) => [id, flagsOf()])));
    const membersOf = new Map<string, string[]>();
    const pickMembers = () => ids.filter(() => random() < 0.5);
    for (const key of ["a", "b", "c"]) membersOf.set(key, pickMembers());
    for (let step = 0; step < 2000; step++) {
      const action = random();
      if (action < 0.6) set(ids[Math.floor(random() * ids.length)]!, flagsOf());
      else if (action < 0.65) {
        for (const key of membersOf.keys()) membersOf.set(key, pickMembers());
        rollups.invalidateStructure();
      } else {
        const key = ["a", "b", "c"][Math.floor(random() * 3)]!;
        const members = membersOf.get(key)!;
        const group = rollups.group(key, () => members);
        const flags = members.map((id) => state.get(id)!);
        expect(group.unread).toBe(flags.filter((f) => f.unread || f.highlight).length);
        expect(group.highlight).toBe(flags.filter((f) => f.highlight).length);
      }
    }
  });
});
