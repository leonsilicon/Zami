import { DOMParser } from "linkedom";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { resetStyleSheets } from "#css-rules";
import { addInterceptor, installElementHooks, type ElementRuntimes } from "#elements";
import { installStyleSheets, setStyleSheet, setVariables } from "#stylesheet";

type Style = Record<string | symbol, unknown>;
interface Resolved {
  styles: Style;
  dependencies: number[];
  dependencySum: number;
}

// Uniwind, as much of it as the stylesheets touch: a theme, its variables, and a store
// that resolves a `className` once and keeps the result, as Uniwind's does.
const uniwind = vi.hoisted(() => {
  const state = {
    theme: "dark",
    variables: { "--bg": "#101014" } as Record<string, string>,
    notified: 0,
    overrides: [] as unknown[],
    themeListeners: new Set<() => void>(),
    resolved: 0,
  };
  const store = {
    cache: { dark: new Map<string, unknown>(), light: new Map<string, unknown>() } as Record<
      string,
      Map<string, unknown>
    >,
    resolveStyles(className: string) {
      state.resolved++;
      return {
        styles: className.includes("flex-1") ? { flex: 1 } : {},
        dependencies: [] as number[],
        dependencySum: 0,
      };
    },
    getStyles(className: string) {
      const cache = store.cache[state.theme]!;
      let result = cache.get(className);
      if (result === undefined) cache.set(className, (result = store.resolveStyles(className)));
      return result;
    },
  };
  return { state, store };
});

vi.mock("#css-uniwind", () => ({ uniwindStore: () => uniwind.store }));
vi.mock("react-native", () => ({
  Appearance: { addChangeListener: () => ({ remove() {} }) },
  Dimensions: {
    get: () => ({ width: 400, height: 800 }),
    addEventListener: () => ({ remove() {} }),
  },
  Platform: {
    select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default,
  },
}));
vi.mock("uniwind", () => ({
  ScopedVariables: "ScopedVariables",
  Uniwind: {
    get currentTheme() {
      return uniwind.state.theme;
    },
    getCSSVariable: (name: string) => uniwind.state.variables[name],
    updateCSSVariables: () => {
      uniwind.state.notified++;
    },
  },
}));
vi.mock("@-/com.leonsilicon.zami.browser", () => ({
  onRootThemeChange: (listener: () => void) => uniwind.state.themeListeners.add(listener),
  setRootVariableOverrides: (overrides: unknown[]) => {
    uniwind.state.overrides = overrides;
  },
}));
vi.mock("@-/com.leonsilicon.zami.rn", async () => {
  // The package's pure module; its entrypoint needs React Native.
  // oxlint-disable-next-line flatcap/no-workspace-import-bypass
  const style = await import("../../rn/dom-style.ts");
  return {
    computeStyle: style.computeStyle,
    setDomStyleSource: style.setDomStyleSource,
    // linkedom's MutationObserver for a document, which its window builds on first use.
    domGlobals: (document: Document) => ({
      MutationObserver: (
        document.createElement("div").ownerDocument.defaultView as unknown as {
          MutationObserver: unknown;
        }
      ).MutationObserver,
    }),
  };
});

const document = new DOMParser().parseFromString(
  "<!doctype html><html><head></head><body></body></html>",
  "text/html",
) as unknown as Document;
const media = new Set<string>();

// The JSX runtime the app's elements go through (#elements), for the interceptor.
const jsxRuntime: ElementRuntimes["jsxRuntime"] = {
  jsx: (type, props) => ({ type, props }) as never,
  jsxs: (type, props) => ({ type, props }) as never,
};
const react: ElementRuntimes["react"] = {
  createElement: (type, props) => ({ type, props }) as never,
};
const created = (props: Record<string, unknown>) =>
  (jsxRuntime.jsx("RCTView", props) as unknown as { props: Record<string, unknown> }).props;

/** The end of the task: the observer's callback, then the scheduled apply. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const styleOf = (className: string) => (uniwind.store.getStyles(className) as Resolved).styles;

beforeAll(() => {
  Object.assign(globalThis, {
    __ZAMI_DOCUMENT__: document,
    __ZAMI_WINDOW__: { matchMedia: (query: string) => ({ matches: media.has(query) }) },
  });
  installElementHooks({ react, jsxRuntime });
  installStyleSheets();
});

beforeEach(async () => {
  for (const element of document.querySelectorAll("style")) element.remove();
  resetStyleSheets();
  await settle();
  uniwind.state.theme = "dark";
  media.clear();
});

describe("class rules on native views", () => {
  test("a rule's declarations go over the classes' own, with what they depend on", async () => {
    setStyleSheet("user", ".x { background-color: var(--bg); width: 50vw } .y.z { opacity: 0.5 }");
    await settle();
    expect(styleOf("flex-1 x")).toEqual({ flex: 1, backgroundColor: "#101014", width: 200 });
    const resolved = uniwind.store.getStyles("flex-1 x") as Resolved;
    // Variables (9) and the theme (2) for `var()`, the window (3) for `vw`.
    expect([...resolved.dependencies].sort((a, b) => a - b)).toEqual([2, 3, 9]);
    expect(resolved.dependencySum).toBe((1 << 2) | (1 << 3) | (1 << 9));
    expect(styleOf("y")).toEqual({});
    expect(styleOf("z y")).toEqual({ opacity: 0.5 });
    // A class no rule names is Uniwind's result, untouched.
    expect((uniwind.store.getStyles("flex-1") as Resolved).dependencies).toEqual([]);
  });

  test("a change of sheets clears what Uniwind kept and has the views resolve again", async () => {
    setStyleSheet("user", ".x { opacity: 0.5 }");
    await settle();
    expect(styleOf("x")).toEqual({ opacity: 0.5 });
    const notified = uniwind.state.notified;
    setStyleSheet("user", ".x { opacity: 0.25 }");
    // Until the end of the task, the kept style; then it's gone, and the views are told.
    expect(styleOf("x")).toEqual({ opacity: 0.5 });
    await settle();
    expect(uniwind.state.notified).toBe(notified + 1);
    expect(styleOf("x")).toEqual({ opacity: 0.25 });
    setStyleSheet("user", "");
    await settle();
    expect(styleOf("x")).toEqual({});
    // With no class rule left (or ever), sheets come and go without touching the views.
    const idle = uniwind.state.notified;
    setStyleSheet("user", ":root { --a: 1 } div p { color: red }");
    await settle();
    expect(uniwind.state.notified).toBe(idle);
  });

  test("!important declarations go after a view's inline style, through the element hook", async () => {
    setStyleSheet("user", ".x { padding: 4px !important; color: red }");
    await settle();
    const resolved = styleOf("x");
    expect(resolved).toEqual({
      color: "red",
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 4,
    });
    const inline = { paddingTop: 20, color: "blue" };
    // What a Uniwind component creates its view with.
    const style = created({ className: "x", style: [resolved, inline] }).style as unknown[];
    expect(style).toHaveLength(3);
    expect(style[1]).toBe(inline);
    expect(style[2]).toEqual({ paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4 });
    // Nothing to go over, or not a view Uniwind styled: as it was.
    expect(created({ className: "x", style: [resolved, undefined] }).style).toHaveLength(2);
    expect(created({ style: [{ a: 1 }, { b: 2 }] }).style).toHaveLength(2);
    // With the last important declaration gone, the hook is too.
    setStyleSheet("user", ".x { color: red }");
    await settle();
    const props = { className: "x", style: [styleOf("x"), inline] };
    expect(created(props)).toBe(props);
  });

  test("a rule under a theme applies in that theme", async () => {
    setStyleSheet("user", '[data-theme="light"] .x { color: black }');
    await settle();
    expect(styleOf("x")).toEqual({});
    expect((uniwind.store.getStyles("x") as Resolved).dependencies).toContain(2);
    uniwind.state.theme = "light";
    for (const listener of uniwind.state.themeListeners) listener();
    await settle();
    expect(styleOf("x")).toEqual({ color: "black" });
  });
});

describe("theme variables", () => {
  test("root rules' custom properties are handed over as overrides, in order", async () => {
    setStyleSheet("user", ":root { --bg: #000 } .x { --bg: #fff }");
    setVariables("plugin", { "--accent": "red", "not-a-variable": "1", "--bad": "a;b" });
    await settle();
    expect(uniwind.state.overrides).toEqual([
      { theme: null, name: "--bg", value: "#000" },
      { theme: null, name: "--accent", value: "red" },
    ]);
    setVariables("plugin", {});
    setStyleSheet("user", "");
    await settle();
    expect(uniwind.state.overrides).toEqual([]);
  });
});

describe("<style> elements", () => {
  test("one in the document is a sheet for as long as it's there, with its text as it changes", async () => {
    const style = document.createElement("style");
    style.textContent = ".x { opacity: 0.5 }";
    document.head.appendChild(style);
    await settle();
    expect(styleOf("x")).toEqual({ opacity: 0.5 });
    style.textContent = ".x { opacity: 0.75 }";
    await settle();
    expect(styleOf("x")).toEqual({ opacity: 0.75 });
    style.remove();
    await settle();
    expect(styleOf("x")).toEqual({});
  });

  test("within what a plugin renders, too; Zam's own (already handed over) is skipped", async () => {
    const host = document.createElement("div");
    host.innerHTML = `<style media="(min-width: 600px)">.x { opacity: 0.5 }</style><p class="x">text</p>`;
    document.body.appendChild(host);
    const own = document.createElement("style");
    own.setAttribute("data-zam-css", "user");
    own.textContent = ".x { color: red }";
    document.head.appendChild(own);
    await settle();
    // Under its `media`, which doesn't hold yet.
    expect(styleOf("x")).toEqual({});
    media.add("(min-width: 600px)");
    resetStyleSheets();
    host.remove();
    document.body.appendChild(host);
    await settle();
    expect(styleOf("x")).toEqual({ opacity: 0.5 });
    host.remove();
    own.remove();
  });
});

describe("the DOM plugins build", () => {
  test("DomView's style source matches elements against the sheets", async () => {
    // oxlint-disable-next-line flatcap/no-workspace-import-bypass
    const { cascade, domStyleSource, parseDeclarations } = await import("../../rn/dom-style.ts");
    const host = document.createElement("div");
    host.innerHTML = `<div class="card"><button style="color: blue; margin: 2px">Go</button></div>`;
    document.body.appendChild(host);
    setStyleSheet("plugin", ".card button { color: red; padding: 8px; margin: 0 !important }");
    const button = host.querySelector("button")!;
    const merged = cascade(
      parseDeclarations(button.getAttribute("style")),
      domStyleSource()!.match(button),
    );
    expect([...merged]).toEqual([
      ["padding", "8px"],
      ["color", "blue"],
      ["margin", "0"],
    ]);
    expect(domStyleSource()!.variables()).toEqual([]);
    host.remove();
    await settle();
  });
});

// The element hook is shared with whatever else intercepts: this file's own stays last.
test("the important hook leaves other interceptors' changes in place", async () => {
  const remove = addInterceptor("test", (_type, props) => ({ props: { ...props, seen: true } }));
  setStyleSheet("user", ".x { top: 1px !important }");
  await settle();
  const props = created({ className: "x", style: [styleOf("x"), { top: 5 }] });
  expect(props.seen).toBe(true);
  expect(props.style).toHaveLength(3);
  remove();
});
