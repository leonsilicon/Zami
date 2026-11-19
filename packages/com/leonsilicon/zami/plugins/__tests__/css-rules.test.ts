import { DOMParser } from "linkedom";
import { beforeEach, describe, expect, test } from "vite-plus/test";
// DomView's own converter, which #css-native hands `nativeStyle` in the app. Its package's
// entrypoint needs React Native; the module itself doesn't.
// oxlint-disable-next-line flatcap/no-workspace-import-bypass
import { computeStyle } from "../../rn/dom-style.ts";
import {
  classDeclarations,
  environmentChanged,
  hasClassRules,
  hasImportantClassRules,
  matchElement,
  nativeStyle,
  referencedVariables,
  resetStyleSheets,
  rootVariables,
  setStyleEnvironment,
  setStyleSheet,
  styleSheetIds,
  styleSheetVersion,
  subscribeStyleSheets,
} from "#css-rules";

const environment = { theme: "dark", media: new Set<string>() };

beforeEach(() => {
  resetStyleSheets();
  environment.theme = "dark";
  environment.media = new Set();
  setStyleEnvironment({
    theme: () => environment.theme,
    matchMedia: (query) => environment.media.has(query),
  });
});

const pairs = (map: ReadonlyMap<string, string> | undefined) => (map ? [...map] : undefined);

describe("sheets", () => {
  test("a sheet belongs to its id: set, changed in place, removed", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeStyleSheets(() => seen.push(styleSheetVersion()));
    const start = styleSheetVersion();
    setStyleSheet("a", ".x { color: red }");
    setStyleSheet("b", ".x { color: blue }");
    expect(styleSheetIds()).toEqual(["a", "b"]);
    expect(pairs(classDeclarations("x")?.normal)).toEqual([["color", "blue"]]);
    // Changed in place: `a` is still the earlier sheet, so `b` still wins.
    setStyleSheet("a", ".x { color: green }");
    expect(styleSheetIds()).toEqual(["a", "b"]);
    expect(pairs(classDeclarations("x")?.normal)).toEqual([["color", "blue"]]);
    setStyleSheet("b", "  ");
    expect(styleSheetIds()).toEqual(["a"]);
    expect(pairs(classDeclarations("x")?.normal)).toEqual([["color", "green"]]);
    expect(seen).toEqual([start + 1, start + 2, start + 3, start + 4]);
    // Nothing changed: no new version, no call.
    setStyleSheet("a", ".x { color: green }");
    setStyleSheet("missing", "");
    expect(seen).toHaveLength(4);
    unsubscribe();
    setStyleSheet("a", "");
    expect(seen).toHaveLength(4);
  });

  test("the names the sheets' values read", () => {
    setStyleSheet("a", ".x { color: var(--zam-text); border: 1px solid var( --b, red) }");
    setStyleSheet("b", ":root { --a: var(--zam-text) }");
    expect(referencedVariables()).toEqual(["--b", "--zam-text"]);
  });
});

describe("rootVariables", () => {
  test("custom properties of root rules, in the order they apply, with their theme", () => {
    setStyleSheet(
      "a",
      `:root { --bg: #111; color: red; --fg: #eee !important }
       html, body { --bg: #222 }
       :root[data-theme="light"] { --bg: #fff }
       .not-root { --bg: #f00 }`,
    );
    setStyleSheet("b", "* { --fg: #ddd }");
    expect(rootVariables()).toEqual([
      // `*` has no specificity; `html`/`body` less than `:root`; the themed one most.
      { theme: null, name: "--fg", value: "#ddd" },
      { theme: null, name: "--bg", value: "#222" },
      { theme: null, name: "--bg", value: "#222" },
      { theme: null, name: "--bg", value: "#111" },
      { theme: "light", name: "--bg", value: "#fff" },
      // `!important` over the rest.
      { theme: null, name: "--fg", value: "#eee" },
    ]);
  });

  test("a rule under a media query counts while the query holds", () => {
    setStyleSheet("a", "@media (min-width: 600px) { :root { --gap: 16px } }");
    expect(rootVariables()).toEqual([]);
    environment.media.add("(min-width: 600px)");
    expect(rootVariables()).toEqual([{ theme: null, name: "--gap", value: "16px" }]);
  });
});

describe("classDeclarations", () => {
  test("nothing without class rules, and nothing for classes no rule names", () => {
    expect(hasClassRules()).toBe(false);
    expect(classDeclarations("flex-1")).toBeUndefined();
    setStyleSheet("a", "div .x { color: red } :root { --a: 1 }");
    expect(hasClassRules()).toBe(false);
    setStyleSheet("a", ".x { color: red }");
    expect(hasClassRules()).toBe(true);
    expect(classDeclarations("flex-1 px-4")).toBeUndefined();
    expect(pairs(classDeclarations("flex-1 x px-4")?.normal)).toEqual([["color", "red"]]);
  });

  test("a compound needs all its classes; Tailwind's escaped names match as written", () => {
    setStyleSheet(
      "a",
      `.a.b { color: red }
       .hover\\:bg-x { opacity: 0.5 }
       .w-\\[420px\\] { width: 100px }`,
    );
    expect(classDeclarations("a")).toBeUndefined();
    expect(pairs(classDeclarations("b c a")?.normal)).toEqual([["color", "red"]]);
    expect(pairs(classDeclarations("hover:bg-x")?.normal)).toEqual([["opacity", "0.5"]]);
    expect(pairs(classDeclarations("w-[420px]")?.normal)).toEqual([["width", "100px"]]);
  });

  test("the cascade: specificity, then order; important declarations apart", () => {
    setStyleSheet(
      "a",
      `.a.b { color: purple }
       .a { color: red; margin-left: 4px; margin: 0 }
       .b { color: blue; padding: 1px !important }
       .a { margin-left: 8px }`,
    );
    expect(hasImportantClassRules()).toBe(true);
    const rules = classDeclarations("a b")!;
    // `.a.b` is the most specific. The later `margin-left` is applied after the
    // `margin` it overrides (declarations apply in the map's order).
    expect(pairs(rules.normal)).toEqual([
      ["margin", "0"],
      ["margin-left", "8px"],
      ["color", "purple"],
    ]);
    expect(pairs(rules.important)).toEqual([["padding", "1px"]]);
    expect(rules.conditional).toBe(false);
  });

  test("a theme scope or a media query makes a rule conditional", () => {
    setStyleSheet(
      "a",
      `:root[data-theme="light"] .x { color: black }
       @media (min-width: 600px) { .x { padding: 8px } }
       .y { color: red }`,
    );
    expect(classDeclarations("y")?.conditional).toBe(false);
    // Nothing holds yet, but something could: the caller needs to know to ask again.
    const none = classDeclarations("x")!;
    expect(none.conditional).toBe(true);
    expect(pairs(none.normal)).toEqual([]);
    environment.theme = "light";
    environment.media.add("(min-width: 600px)");
    expect(pairs(classDeclarations("x")?.normal)).toEqual([
      ["padding", "8px"],
      ["color", "black"],
    ]);
  });

  test("environmentChanged is a change only when some rule is conditional", () => {
    setStyleSheet("a", ".x { color: red }");
    let version = styleSheetVersion();
    environmentChanged();
    expect(styleSheetVersion()).toBe(version);
    setStyleSheet("a", "[data-theme=light] .x { color: red }");
    version = styleSheetVersion();
    environmentChanged();
    expect(styleSheetVersion()).toBe(version + 1);
  });
});

describe("matchElement", () => {
  const document = new DOMParser().parseFromString(
    `<!doctype html><html><head></head><body>
      <div id="panel" class="panel dark">
        <h2 class="title">Title</h2>
        <ul><li class="item first" data-kind="a">One</li><li class="item">Two</li></ul>
        <button class="btn" style="color: red">Go</button>
      </div>
    </body></html>`,
    "text/html",
  ) as unknown as Document;
  const $ = (selector: string) => document.querySelector(selector)!;

  test("nothing without rules for elements", () => {
    expect(matchElement($("#panel"))).toBeUndefined();
    setStyleSheet("a", ":root { --a: 1 }");
    expect(matchElement($("#panel"))).toBeUndefined();
  });

  test("tags, ids, classes, attributes and descendants, in cascade order", () => {
    setStyleSheet(
      "a",
      `li { color: gray; padding: 2px }
       .panel .item { color: blue }
       .item[data-kind="a"] { color: green }
       #panel > ul li.first { font-weight: bold }
       .elsewhere .item { color: red }
       h2, .btn { margin: 0 !important }`,
    );
    const first = matchElement($("li.first"))!;
    expect(pairs(first.normal)).toEqual([
      ["padding", "2px"],
      ["color", "green"],
      ["font-weight", "bold"],
    ]);
    expect(pairs(matchElement($("li:not(.first)"))?.normal)).toEqual([
      ["padding", "2px"],
      ["color", "blue"],
    ]);
    expect(pairs(matchElement($("h2"))?.important)).toEqual([["margin", "0"]]);
    expect(matchElement($("ul"))).toBeUndefined();
  });

  test("a selector the DOM can't run is dropped; the rest of the sheet applies", () => {
    setStyleSheet(
      "a",
      ".btn::before { content: 'x' } .btn:hover { color: blue } .btn { color: red }",
    );
    expect(pairs(matchElement($(".btn"))?.normal)).toEqual([["color", "red"]]);
  });

  test("a root scope in front holds by the theme, not by the detached <html>", () => {
    setStyleSheet("a", `html .title { color: red } [data-theme="light"] .title { color: black }`);
    const dark = matchElement($(".title"))!;
    expect(pairs(dark.normal)).toEqual([["color", "red"]]);
    expect(dark.conditional).toBe(true);
    environment.theme = "light";
    expect(pairs(matchElement($(".title"))?.normal)).toEqual([["color", "black"]]);
  });
});

describe("nativeStyle", () => {
  const theme: Record<string, string> = { "--zam-bg": "#101014", "--gap": "8px" };
  const style = (css: string) => {
    setStyleSheet("a", `.x { ${css} }`);
    const rules = classDeclarations("x")!;
    return nativeStyle(rules.normal, (declarations) =>
      computeStyle(
        declarations,
        {
          variable: (name) => theme[name],
          parentFontSize: 16,
          rootFontSize: 16,
          viewport: { width: 400, height: 800 },
        },
        "Menlo",
      ),
    );
  };

  test("box and text declarations as one React Native style", () => {
    expect(
      style(
        "background-color: var(--zam-bg); padding: var(--gap) 1rem; color: #fff; font-size: 1.5em; border-radius: 50%",
      ),
    ).toEqual({
      backgroundColor: "#101014",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
      color: "#fff",
      fontSize: 24,
      borderTopLeftRadius: "50%",
      borderTopRightRadius: "50%",
      borderBottomRightRadius: "50%",
      borderBottomLeftRadius: "50%",
    });
  });

  test("what a view has in place of the DOM's display, visibility and stacking", () => {
    expect(style("display: none")).toEqual({ display: "none" });
    expect(style("display: block")).toEqual({ display: "flex" });
    expect(style("visibility: hidden; pointer-events: none")).toEqual({
      opacity: 0,
      pointerEvents: "none",
    });
    // DomView's own stacking of positioned elements isn't a view's.
    expect(style("position: absolute; top: 0")).toEqual({ position: "absolute", top: 0 });
    expect(style("position: absolute; z-index: 5")).toEqual({ position: "absolute", zIndex: 5 });
    expect(style("overflow: visible")).toEqual({ overflow: "visible" });
    expect(style("object-fit: cover")).toEqual({ objectFit: "cover" });
  });

  test("a named font is passed on; a generic family is the app's own", () => {
    expect(style(`font-family: "Comic Neue", cursive`)).toEqual({ fontFamily: "Comic Neue" });
    expect(style("font-family: sans-serif")).toEqual({});
    expect(style("font-family: ui-monospace, monospace")).toEqual({ fontFamily: "Menlo" });
  });
});
