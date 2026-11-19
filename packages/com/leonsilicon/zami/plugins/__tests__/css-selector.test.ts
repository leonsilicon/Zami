import { describe, expect, test } from "vite-plus/test";
import { analyzeSelector } from "#css-selector";

describe("analyzeSelector", () => {
  test("the root, in the ways a sheet names it, with the theme it's scoped to", () => {
    for (const selector of [":root", "html", "body", "*", "html:root", ":root:root"])
      expect(analyzeSelector(selector), selector).toMatchObject({ root: true, theme: null });
    for (const [selector, theme] of [
      [':root[data-theme="light"]', "light"],
      ["[data-theme=amoled]", "amoled"],
      ["html[data-theme='light']", "light"],
      ["[data-theme]", null],
    ] as const)
      expect(analyzeSelector(selector), selector).toMatchObject({ root: true, theme });
    for (const selector of [".root", "div", ":root.dark", "html > body", '[data-theme^="l"]'])
      expect(analyzeSelector(selector)?.root, selector).toBe(false);
  });

  test("one compound of classes is for native views, with the names unescaped", () => {
    expect(analyzeSelector(".foo")?.classes).toEqual(["foo"]);
    expect(analyzeSelector(".a.b")?.classes).toEqual(["a", "b"]);
    expect(analyzeSelector(".hover\\:bg-x")?.classes).toEqual(["hover:bg-x"]);
    expect(analyzeSelector(".w-\\[420px\\]")?.classes).toEqual(["w-[420px]"]);
    expect(analyzeSelector(".p-0\\.5")?.classes).toEqual(["p-0.5"]);
    expect(analyzeSelector(".bg-black\\/50")?.classes).toEqual(["bg-black/50"]);
    // A hex escape, as CSS.escape writes a leading digit.
    expect(analyzeSelector(".\\31 0px")?.classes).toEqual(["10px"]);
  });

  test("anything a view can't be asked isn't a class rule", () => {
    for (const selector of [
      "div.a",
      ".a .b",
      ".a > .b",
      ".a:hover",
      ".a::before",
      ".a[data-x]",
      "#a.b",
      "*.a",
    ])
      expect(analyzeSelector(selector)?.classes, selector).toBeNull();
  });

  test("a root scope in front is a theme condition on what follows", () => {
    expect(analyzeSelector(':root[data-theme="light"] .foo')).toMatchObject({
      text: ".foo",
      theme: "light",
      classes: ["foo"],
      root: false,
    });
    expect(analyzeSelector("html .a > .b")).toMatchObject({
      text: ".a > .b",
      theme: null,
      classes: null,
      key: { classes: ["b"] },
    });
    expect(analyzeSelector("[data-theme=amoled] > .x")).toMatchObject({
      text: ".x",
      theme: "amoled",
    });
    // Without a theme, a child of the root isn't the same as any element.
    expect(analyzeSelector("body > .x")?.text).toBe("body > .x");
  });

  test("the key is what the rightmost compound needs of an element", () => {
    expect(analyzeSelector("ul li.item#first")?.key).toEqual({
      id: "first",
      classes: ["item"],
      tag: "li",
    });
    expect(analyzeSelector(".a > *")?.key).toEqual({ id: undefined, classes: [], tag: undefined });
    expect(analyzeSelector("DIV")?.key.tag).toBe("div");
  });

  test("specificity orders ids over classes over tags", () => {
    const of = (selector: string) => analyzeSelector(selector)!.specificity;
    expect(of("#a")).toBeGreaterThan(of(".a.b.c"));
    expect(of(".a.b")).toBeGreaterThan(of(".a"));
    expect(of(".a")).toBeGreaterThan(of("div span"));
    expect(of("div.a")).toBeGreaterThan(of(".a"));
    expect(of(".a:hover")).toBe(of(".a.b"));
    expect(of("[x]")).toBe(of(".a"));
    expect(of(".a::before")).toBe(of("div.a"));
    expect(of(":not(.a, #b)")).toBe(of("#b"));
    expect(of(":where(.a)")).toBe(0);
    expect(of(':root[data-theme="light"] .a')).toBeGreaterThan(of(":root .a"));
  });

  test("what isn't a selector is null", () => {
    for (const selector of [
      "",
      ">",
      ".a >",
      "> .a",
      "..a",
      ".a > > .b",
      "a[href",
      ".a:not(.b",
      "5",
    ])
      expect(analyzeSelector(selector), selector).toBeNull();
  });
});
