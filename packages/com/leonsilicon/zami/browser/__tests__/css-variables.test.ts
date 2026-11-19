import { describe, expect, test } from "vite-plus/test";
import { createRootVariables, createVariableBatch } from "#css-variables";

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

/** Two themes' variables as the app holds them, and a root over them. */
function root() {
  const themes: Record<string, Record<string, string>> = {
    dark: { "--bg": "#111", "--text": "#eee" },
    light: { "--bg": "#fff", "--text": "#222" },
  };
  const state = { theme: "dark" };
  const variables = createRootVariables({
    theme: () => state.theme,
    read: (name) => themes[state.theme]![name] ?? "",
    write: (theme, name, value) => {
      themes[theme]![name] = value;
    },
  });
  const switchTo = (theme: string) => {
    state.theme = theme;
    variables.themeChanged();
  };
  return { themes, variables, switchTo };
}

describe("createRootVariables", () => {
  test("an inline variable goes over the theme's and comes off again", () => {
    const { themes, variables } = root();
    variables.setProperty("--bg", "#123");
    expect(themes.dark!["--bg"]).toBe("#123");
    expect(variables.getPropertyValue("--bg")).toBe("#123");
    expect(variables.removeProperty("--bg")).toBe("#123");
    expect(themes.dark!["--bg"]).toBe("#111");
    expect(variables.getPropertyValue("--bg")).toBe("");
  });

  test("a stylesheet's variable wins over both, and its removal brings back what's under it", () => {
    const { themes, variables } = root();
    variables.setProperty("--bg", "#123");
    variables.setOverrides([
      { theme: null, name: "--bg", value: "#abc" },
      { theme: null, name: "--text", value: "#def" },
    ]);
    expect(themes.dark).toEqual({ "--bg": "#abc", "--text": "#def" });
    // Zam's theme code sets its own meanwhile: kept, but under the stylesheet's.
    variables.setProperty("--bg", "#456");
    variables.setProperty("--text", "#789");
    expect(themes.dark).toEqual({ "--bg": "#abc", "--text": "#def" });
    variables.removeProperty("--text");
    expect(themes.dark!["--text"]).toBe("#def");
    variables.setOverrides([]);
    // The inline value where there is one, the theme's own where it was removed.
    expect(themes.dark).toEqual({ "--bg": "#456", "--text": "#eee" });
  });

  test("the later of two overrides for a name wins, and a changed list is applied as a diff", () => {
    const writes: string[] = [];
    const variables = createRootVariables({
      theme: () => "dark",
      read: () => "#000",
      write: (_theme, name, value) => writes.push(`${name}=${value}`),
    });
    variables.setOverrides([
      { theme: null, name: "--a", value: "1" },
      { theme: null, name: "--a", value: "2" },
      { theme: null, name: "--b", value: "3" },
    ]);
    expect(writes).toEqual(["--a=2", "--b=3"]);
    writes.length = 0;
    variables.setOverrides([
      { theme: null, name: "--a", value: "2" },
      { theme: null, name: "--b", value: "4" },
    ]);
    expect(writes).toEqual(["--b=4"]);
  });

  test("a theme's overrides apply while it's in force, and are undone when it's back without them", () => {
    const { themes, variables, switchTo } = root();
    variables.setOverrides([
      { theme: null, name: "--text", value: "#0f0" },
      { theme: "light", name: "--bg", value: "#ffe" },
    ]);
    expect(themes.dark).toEqual({ "--bg": "#111", "--text": "#0f0" });
    // The light theme's variables are untouched until it's the one in force.
    expect(themes.light).toEqual({ "--bg": "#fff", "--text": "#222" });
    switchTo("light");
    expect(themes.light).toEqual({ "--bg": "#ffe", "--text": "#0f0" });
    variables.setOverrides([]);
    expect(themes.light).toEqual({ "--bg": "#fff", "--text": "#222" });
    // The dark theme still holds what was written while it was in force.
    expect(themes.dark!["--text"]).toBe("#0f0");
    switchTo("dark");
    expect(themes.dark).toEqual({ "--bg": "#111", "--text": "#eee" });
  });

  test("a variable the theme never had keeps the override's value: it can't be unset", () => {
    const { themes, variables } = root();
    variables.setOverrides([{ theme: null, name: "--mine", value: "1px" }]);
    variables.setOverrides([]);
    expect(themes.dark!["--mine"]).toBe("1px");
  });
});
