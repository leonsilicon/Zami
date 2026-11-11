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

describe("createSlicedQueue: cancellation", () => {
  test("an aborted task never runs and rejects with the reason", async () => {
    const { queue, work, nextTurn } = harness(100, 1);
    const controller = new AbortController();
    const ran: string[] = [];
    const keep = queue.add(async () => {
      ran.push("keep");
      return "keep";
    });
    const dropped = queue.add(
      async () => {
        ran.push("dropped");
        return "dropped";
      },
      5,
      { signal: controller.signal },
    );
    const after = queue.add(work("after"), 1);
    controller.abort(new Error("left the room"));
    await expect(dropped).rejects.toThrow("left the room");
    expect(queue.size).toBe(2);
    await nextTurn();
    await expect(keep).resolves.toBe("keep");
    await expect(after).resolves.toBe("after");
    expect(ran).toEqual(["keep"]);
  });

  test("a task added with an aborted signal is refused at once", async () => {
    const { queue, work } = harness(100, 1);
    const controller = new AbortController();
    controller.abort();
    await expect(queue.add(work("x"), 0, { signal: controller.signal })).rejects.toBeDefined();
    expect(queue.size).toBe(0);
  });

  test("aborting after the task started doesn't stop it", async () => {
    const { queue, nextTurn } = harness(100, 1);
    const controller = new AbortController();
    const task = queue.add(
      async () => {
        controller.abort();
        await Promise.resolve();
        return "done";
      },
      0,
      { signal: controller.signal },
    );
    await nextTurn();
    await expect(task).resolves.toBe("done");
  });

  test("removing tasks from the middle keeps the order of the rest", async () => {
    const { queue, work, nextTurn } = harness(1000, 1);
    const finished: number[] = [];
    const controllers: AbortController[] = [];
    for (let i = 0; i < 40; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      queue.add(work(i), (i * 7) % 13, { signal: controller.signal }).then(
        (v) => finished.push(v),
        () => {},
      );
    }
    for (let i = 0; i < 40; i += 3) controllers[i]!.abort();
    for (let i = 0; i < 5; i++) await nextTurn();
    const expected = Array.from({ length: 40 }, (_, i) => i)
      .filter((i) => i % 3 !== 0)
      .sort((a, b) => ((b * 7) % 13) - ((a * 7) % 13) || a - b);
    expect(finished).toEqual(expected);
  });
});

describe("createSlicedQueue: startTurn", () => {
  test("runs a slice now, and leaves the rest to the scheduled turn", async () => {
    const { queue, work, nextTurn, pendingTurns } = harness(8, 3);
    const finished: number[] = [];
    for (let i = 0; i < 5; i++) void queue.add(work(i)).then((v) => finished.push(v));
    queue.startTurn();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(finished).toEqual([0, 1, 2]);
    // The turn scheduled by the first add is the only one waiting.
    expect(pendingTurns()).toBe(1);
    await nextTurn();
    expect(finished).toEqual([0, 1, 2, 3, 4]);
    expect(pendingTurns()).toBe(0);
  });

  test("does nothing while a turn runs or nothing is queued", async () => {
    const { queue, nextTurn, pendingTurns } = harness(100, 1);
    queue.startTurn();
    expect(pendingTurns()).toBe(0);
    let release!: () => void;
    const order: string[] = [];
    void queue.add(
      () =>
        new Promise<void>((resolve) => {
          order.push("first");
          release = resolve;
        }),
    );
    void queue.add(async () => {
      order.push("second");
    });
    const turn = nextTurn();
    queue.startTurn();
    expect(order).toEqual(["first"]);
    release();
    await turn;
    expect(order).toEqual(["first", "second"]);
  });
});

describe("createSlicedQueue: named queues", () => {
  test("the same name is the same queue", () => {
    const a = createSlicedQueue({ sliceMs: 8, name: "test-shared" });
    const b = createSlicedQueue({ sliceMs: 50, name: "test-shared" });
    const c = createSlicedQueue({ sliceMs: 8 });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});
