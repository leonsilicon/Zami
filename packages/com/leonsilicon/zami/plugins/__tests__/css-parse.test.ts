import { describe, expect, test } from "vite-plus/test";
import { parseStyleSheet, type StyleRule } from "#css-parse";

const declared = (rule: StyleRule | undefined) =>
  rule?.declarations.map((d) => `${d.name}: ${d.value}${d.important ? " !important" : ""}`);

describe("parseStyleSheet", () => {
  test("rules, selector lists and declarations", () => {
    const rules = parseStyleSheet(`
      .a, .b > .c { color: red; Background-Color: #000 }
      :root { --Accent: 1 2 3; }
    `);
    expect(rules.map((rule) => rule.selectors)).toEqual([[".a", ".b > .c"], [":root"]]);
    expect(declared(rules[0])).toEqual(["color: red", "background-color: #000"]);
    // A custom property's name keeps its case.
    expect(declared(rules[1])).toEqual(["--Accent: 1 2 3"]);
  });

  test("!important is a flag, not part of the value", () => {
    const [rule] = parseStyleSheet(".a { color: red !important; margin: 0 ! IMPORTANT; top: 1px }");
    expect(declared(rule)).toEqual(["color: red !important", "margin: 0 !important", "top: 1px"]);
  });

  test("comments go; what looks like one inside a string stays", () => {
    const rules = parseStyleSheet(`
      /* .gone { color: red } */
      .a { /* note */ color: blue; content: "/* kept */"; }
      .b { color: green } /* unterminated
      .c { color: red }
    `);
    expect(rules.map((rule) => rule.selectors[0])).toEqual([".a", ".b"]);
    expect(declared(rules[0])).toEqual(["color: blue", 'content: "/* kept */"']);
  });

  test("braces, semicolons and commas inside strings, parentheses and escapes are text", () => {
    const rules = parseStyleSheet(`
      .w-\\[420px\\], .hover\\:bg-x, .a\\,b { width: 420px }
      .icon { background: url(data:image/svg+xml;charset=utf8,%3Csvg%3E) center; content: "}{;" }
      a[title="x,y{"] { color: red }
    `);
    expect(rules[0]?.selectors).toEqual([".w-\\[420px\\]", ".hover\\:bg-x", ".a\\,b"]);
    expect(declared(rules[1])).toEqual([
      "background: url(data:image/svg+xml;charset=utf8,%3Csvg%3E) center",
      'content: "}{;"',
    ]);
    expect(rules[2]?.selectors).toEqual(['a[title="x,y{"]']);
  });

  test("@media blocks give their rules a condition, nested ones all of theirs", () => {
    const rules = parseStyleSheet(`
      .a { color: red }
      @media (min-width: 600px) {
        .a { color: blue }
        @media (prefers-color-scheme: dark) { .b { color: white } }
      }
      .c { color: green }
    `);
    expect(rules.map((rule) => [rule.selectors[0], rule.media])).toEqual([
      [".a", []],
      [".a", ["(min-width: 600px)"]],
      [".b", ["(min-width: 600px)", "(prefers-color-scheme: dark)"]],
      [".c", []],
    ]);
  });

  test("at-rules that aren't rules for elements are skipped whole; layers and @supports are read", () => {
    const rules = parseStyleSheet(`
      @charset "utf-8";
      @import url("x.css");
      @font-face { font-family: X; src: url(x.woff2) }
      @keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
      @container (min-width: 1px) { .no { color: red } }
      @supports not (display: grid) { .no { color: red } }
      @layer base { .a { color: red } }
      @supports (display: grid) { .b { color: blue } }
      .c { color: green }
    `);
    expect(rules.map((rule) => rule.selectors[0])).toEqual([".a", ".b", ".c"]);
  });

  test("nested rules join their parents: `&` where it stands, a descendant without it", () => {
    const rules = parseStyleSheet(`
      .card, .panel {
        color: red;
        .title { font-weight: bold }
        &.active, &:hover { color: blue }
        @media (min-width: 600px) { padding: 8px }
      }
    `);
    expect(rules.map((rule) => [rule.selectors, declared(rule), rule.media])).toEqual([
      [[".card", ".panel"], ["color: red"], []],
      [[".card .title", ".panel .title"], ["font-weight: bold"], []],
      [[".card.active", ".card:hover", ".panel.active", ".panel:hover"], ["color: blue"], []],
      [[".card", ".panel"], ["padding: 8px"], ["(min-width: 600px)"]],
    ]);
  });

  test("what can't be read is skipped, and the rest still applies", () => {
    const rules = parseStyleSheet(`
      } .a { color: red; nonsense; : x; width }
      .b { color: blue
    `);
    expect(rules.map((rule) => [rule.selectors[0], declared(rule)])).toEqual([
      [".a", ["color: red"]],
      [".b", ["color: blue"]],
    ]);
    expect(parseStyleSheet("")).toEqual([]);
    expect(parseStyleSheet("{{{{")).toEqual([]);
    expect(parseStyleSheet(".a { ")).toEqual([]);
    expect(parseStyleSheet(undefined as unknown as string)).toEqual([]);
  });
});
