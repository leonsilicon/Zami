import { describe, expect, test } from "vite-plus/test";
import {
  computeStyle,
  parseColor,
  parseDeclarations,
  parseLength,
  substituteVariables,
  variableNames,
  type StyleContext,
} from "#dom-style";

const THEME: Record<string, string> = {
  "--discord-divider": "#41444e",
  "--discord-accent-rgb": "88 101 242",
  "--discord-text-primary": "#dcddde",
  "--alias": "var(--discord-divider)",
};
const ctx: StyleContext = {
  variable: (name) => THEME[name],
  parentFontSize: 16,
  rootFontSize: 16,
  viewport: { width: 400, height: 800 },
  color: "#dcddde",
};
const style = (css: string, over: Partial<StyleContext> = {}) =>
  computeStyle(parseDeclarations(css), { ...ctx, ...over }, "Menlo");

describe("parseDeclarations", () => {
  test("splits on semicolons outside parentheses and drops !important", () => {
    const declarations = parseDeclarations(
      "color: red; background: url(data:image/png;base64,AAA) no-repeat;width:1px !important;;bad",
    );
    expect([...declarations]).toEqual([
      ["color", "red"],
      ["background", "url(data:image/png;base64,AAA) no-repeat"],
      ["width", "1px"],
    ]);
  });

  test("lists the variables a style reads", () => {
    expect(variableNames("color: var(--a); border: 1px solid var(--b, var(--c))")).toEqual([
      "--a",
      "--b",
      "--c",
    ]);
  });
});

describe("values", () => {
  test("var() with fallbacks and nesting", () => {
    expect(substituteVariables("rgb(var(--discord-accent-rgb))", ctx.variable)).toBe(
      "rgb(88 101 242)",
    );
    expect(substituteVariables("var(--missing, var(--alias))", ctx.variable)).toBe("#41444e");
    expect(substituteVariables("var(--missing)", ctx.variable)).toBe("");
  });

  test("colors as React Native parses them", () => {
    expect(parseColor("rgb(88 101 242)")).toBe("rgba(88, 101, 242, 1)");
    expect(parseColor("rgb(88 101 242 / 50%)")).toBe("rgba(88, 101, 242, 0.5)");
    expect(parseColor("rgba(1, 2, 3, .4)")).toBe("rgba(1, 2, 3, 0.4)");
    expect(parseColor("hsl(120deg 50% 50%)")).toBe("hsla(120, 50%, 50%, 1)");
    expect(parseColor("#abc")).toBe("#abc");
    expect(parseColor("Transparent")).toBe("transparent");
    expect(parseColor("currentColor", "#fff")).toBe("#fff");
    expect(parseColor("color-mix(in oklab, red, blue)")).toBe(undefined);
  });

  test("lengths: units, calc(), min()/max()/clamp(), percentages", () => {
    const at = { fontSize: 10, rootFontSize: 16, viewport: { width: 400, height: 800 } };
    expect(parseLength("12px", at)).toBe(12);
    expect(parseLength("2rem", at)).toBe(32);
    expect(parseLength("1.5em", at)).toBe(15);
    expect(parseLength("50%", at)).toBe("50%");
    expect(parseLength("10vw", at)).toBe(40);
    expect(parseLength("auto", at)).toBe("auto");
    expect(parseLength("calc(100vw - 16px)", at)).toBe(384);
    expect(parseLength("calc(2 * (1rem + 4px))", at)).toBe(40);
    expect(parseLength("min(100%, 32rem)", at)).toBe(512);
    expect(parseLength("clamp(10px, 50vw, 100px)", at)).toBe(100);
    expect(parseLength("calc(100% - 8px)", at)).toBe(undefined);
    expect(parseLength("fit-content", at)).toBe(undefined);
  });
});

describe("computeStyle", () => {
  test("the emoji-stealer popover's root", () => {
    const s = style(
      "width:300px;max-width:calc(100vw - 16px);padding:12px;display:flex;flex-direction:column;gap:10px;color:var(--discord-text-primary);font-size:14px;",
    );
    expect(s.display).toBe("flex");
    expect(s.box).toMatchObject({
      width: 300,
      maxWidth: 384,
      paddingTop: 12,
      paddingLeft: 12,
      flexDirection: "column",
      rowGap: 10,
      columnGap: 10,
    });
    expect(s.text).toEqual({ color: "#dcddde", fontSize: 14 });
    expect(s.fontSize).toBe(14);
  });

  test("borders, radii and backgrounds", () => {
    const s = style(
      "border:1px solid var(--discord-divider);border-radius:4px 8px;background:rgb(var(--discord-accent-rgb));",
    );
    expect(s.box).toMatchObject({
      borderWidth: 1,
      borderColor: "#41444e",
      borderStyle: "solid",
      borderTopLeftRadius: 4,
      borderTopRightRadius: 8,
      borderBottomRightRadius: 4,
      borderBottomLeftRadius: 8,
      backgroundColor: "rgba(88, 101, 242, 1)",
    });
    expect(style("border:0").box.borderWidth).toBe(0);
    expect(style("border-bottom:2px dashed red").box).toMatchObject({
      borderBottomWidth: 2,
      borderBottomColor: "red",
      borderStyle: "dashed",
    });
  });

  test("em lengths use the element's own font size", () => {
    expect(style("font-size: 20px; padding: 0.5em", { parentFontSize: 10 }).box.paddingTop).toBe(
      10,
    );
    expect(style("font-size: 2em", { parentFontSize: 10 }).fontSize).toBe(20);
    expect(style("letter-spacing: .02em; font-size: 50px").text.letterSpacing).toBe(1);
  });

  test("text properties", () => {
    const s = style(
      "font-weight:700;font-style:italic;text-transform:uppercase;text-align:end;line-height:1.5;text-decoration:underline;font-family:ui-monospace,monospace",
    );
    expect(s.text).toEqual({
      fontWeight: "700",
      fontStyle: "italic",
      textTransform: "uppercase",
      textAlign: "right",
      lineHeight: 24,
      textDecorationLine: "underline",
      fontFamily: "Menlo",
    });
  });

  test("ellipsis, white-space and line clamps", () => {
    const s = style("overflow:hidden;text-overflow:ellipsis;white-space:nowrap");
    expect(s.lineClamp).toBe(1);
    expect(s.whiteSpace).toBe("nowrap");
    expect(s.box.overflow).toBe("hidden");
    expect(style("-webkit-line-clamp: 3").lineClamp).toBe(3);
  });

  test("flex shorthands", () => {
    expect(style("flex:1").box).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: 0 });
    expect(style("flex:none").box).toMatchObject({ flexGrow: 0, flexShrink: 0, flexBasis: "auto" });
    expect(style("flex: 2 0 10px").box).toMatchObject({
      flexGrow: 2,
      flexShrink: 0,
      flexBasis: 10,
    });
    expect(
      style("flex-flow: row wrap; justify-content: end; align-items: start").box,
    ).toMatchObject({
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      alignItems: "flex-start",
    });
  });

  test("scrolling, position, visibility and the rest", () => {
    expect(style("max-height:216px;overflow-y:auto").scroll).toBe("y");
    expect(style("position:fixed;inset:0").box).toMatchObject({
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(style("visibility:hidden").hidden).toBe(true);
    expect(style("pointer-events:none").pointerEvents).toBe("none");
    expect(style("display:none").display).toBe("none");
    expect(style("display:inline flex").display).toBe("inline-flex");
    expect(style("opacity:0.6").box.opacity).toBe(0.6);
    expect(style("box-shadow: inset 3px 0 0 rgb(var(--discord-accent-rgb))").box.boxShadow).toBe(
      "inset 3px 0 0 rgba(88, 101, 242, 1)",
    );
    expect(style("object-fit: contain").objectFit).toBe("contain");
    expect(style("aspect-ratio: 16 / 9").box.aspectRatio).toBeCloseTo(16 / 9);
    expect(style("font: inherit; color: inherit").text).toEqual({});
  });

  test("an unresolvable value is dropped, not passed on", () => {
    expect(style("color: var(--missing); width: calc(100% - 4px)").box).toEqual({});
    expect(style("color: var(--missing)").text).toEqual({});
  });
});
