import { describe, expect, test } from "vite-plus/test";
import { createSlicedQueue } from "#sliced-queue";

/** A fake clock that advances by `cost` per task, and turns run on demand. */
function harness(sliceMs: number, cost: number) {
  let clock = 0;
  const turns: (() => void)[] = [];
  const queue = createSlicedQueue({
    sliceMs,
    now: () => clock,
    schedule: (run) => turns.push(run),
  });
  const work =
    <T>(value: T) =>
    async () => {
      clock += cost;
      return value;
    };
  const nextTurn = async () => {
    turns.shift()?.();
    // Let the turn's task chain settle.
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  return { queue, work, nextTurn, pendingTurns: () => turns.length };
}

describe("createSlicedQueue", () => {
  test("runs nothing until the next turn", async () => {
    const { queue, work, nextTurn } = harness(8, 1);
    let done = false;
    void queue.add(work("a")).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await nextTurn();
    expect(done).toBe(true);
  });

  test("runs at most a slice per turn, then yields", async () => {
    const { queue, work, nextTurn, pendingTurns } = harness(8, 3);
    const finished: number[] = [];
    for (let i = 0; i < 6; i++) void queue.add(work(i)).then((v) => finished.push(v));
    await nextTurn();
    // 3 ms each: three start within the 8 ms slice.
    expect(finished).toEqual([0, 1, 2]);
    expect(pendingTurns()).toBe(1);
    await nextTurn();
    expect(finished).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pendingTurns()).toBe(0);
  });

  test("runs the highest priority first, ties in the order added", async () => {
    const { queue, work, nextTurn } = harness(100, 1);
    const finished: string[] = [];
    const add = (name: string, priority: number) =>
      void queue.add(work(name), priority).then((v) => finished.push(v));
    add("old", 1);
    add("new", 5);
    add("newer-a", 9);
    add("newer-b", 9);
    add("middle", 3);
    await nextTurn();
    expect(finished).toEqual(["newer-a", "newer-b", "new", "middle", "old"]);
  });

  test("a task added during a turn takes its place by priority", async () => {
    const { queue, work, nextTurn } = harness(4, 2);
    const finished: string[] = [];
    void queue.add(work("a"), 1).then((v) => finished.push(v));
    void queue.add(work("b"), 1).then((v) => finished.push(v));
    void queue.add(work("c"), 1).then((v) => finished.push(v));
    await nextTurn();
    expect(finished).toEqual(["a", "b"]);
    void queue.add(work("urgent"), 10).then((v) => finished.push(v));
    await nextTurn();
    expect(finished).toEqual(["a", "b", "urgent", "c"]);
  });

  test("a failing task rejects its own promise and the queue carries on", async () => {
    const { queue, work, nextTurn } = harness(100, 1);
    const failing = queue.add(async () => {
      throw new Error("no key");
    });
    const throwing = queue.add((() => {
      throw new Error("sync");
    }) as () => Promise<never>);
    const fine = queue.add(work("ok"));
    await nextTurn();
    await expect(failing).rejects.toThrow("no key");
    await expect(throwing).rejects.toThrow("sync");
    await expect(fine).resolves.toBe("ok");
    expect(queue.size).toBe(0);
  });
});
