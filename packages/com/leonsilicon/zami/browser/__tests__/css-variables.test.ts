import { describe, expect, test } from "vite-plus/test";
import { createVariableBatch } from "#css-variables";

function harness() {
  const calls: [string, Record<string, string>][] = [];
  const queued: (() => void)[] = [];
  const batch = createVariableBatch(
    (theme, variables) => calls.push([theme, variables]),
    (run) => queued.push(run),
  );
  const endOfTask = () => {
    for (const run of queued.splice(0)) run();
  };
  return { batch, calls, endOfTask, queued };
}

describe("createVariableBatch", () => {
  test("sends a task's writes as one call with the last value of each", () => {
    const { batch, calls, endOfTask } = harness();
    batch.set("dark", "--a", "1");
    batch.set("dark", "--b", "2");
    batch.set("dark", "--a", "3");
    expect(calls).toEqual([]);
    endOfTask();
    expect(calls).toEqual([["dark", { "--a": "3", "--b": "2" }]]);
  });

  test("leaves out what Uniwind already holds, and sends nothing for no change", () => {
    const { batch, calls, endOfTask } = harness();
    batch.set("dark", "--a", "1");
    batch.set("dark", "--b", "2");
    endOfTask();
    // Applying a preset again: every variable removed (back to the theme's value),
    // then set to what it was.
    batch.set("dark", "--a", "theme");
    batch.set("dark", "--b", "theme");
    batch.set("dark", "--a", "1");
    batch.set("dark", "--b", "5");
    endOfTask();
    expect(calls).toEqual([
      ["dark", { "--a": "1", "--b": "2" }],
      ["dark", { "--b": "5" }],
    ]);
    batch.set("dark", "--b", "5");
    endOfTask();
    expect(calls).toHaveLength(2);
  });

  test("keeps each theme's variables apart", () => {
    const { batch, calls, endOfTask } = harness();
    batch.set("dark", "--a", "1");
    batch.set("light", "--a", "1");
    endOfTask();
    expect(calls).toEqual([
      ["dark", { "--a": "1" }],
      ["light", { "--a": "1" }],
    ]);
  });

  test("begin schedules the flush before the writes that follow", () => {
    const { batch, calls, queued } = harness();
    batch.begin();
    expect(queued).toHaveLength(1);
    batch.set("dark", "--a", "1");
    expect(queued).toHaveLength(1);
    batch.flush();
    expect(calls).toEqual([["dark", { "--a": "1" }]]);
    // The scheduled run finds nothing left.
    queued[0]();
    expect(calls).toHaveLength(1);
  });
});
