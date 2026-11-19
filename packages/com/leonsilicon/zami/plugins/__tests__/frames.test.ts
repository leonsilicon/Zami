import { describe, expect, it } from "vite-plus/test";
import { addFrameRule, frameRulesFor } from "#frames";

function quietly<T>(run: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = original;
  }
}

describe("frame rules", () => {
  it("answer for the URLs they name, until removed", () => {
    const undo = addFrameRule("p", {
      urlPrefixes: ["https://www.youtube.com/embed/"],
      script: "window.x = 1",
      referrer: "https://example.com/",
    });
    const setup = frameRulesFor("https://www.youtube.com/embed/abc");
    expect(setup.referrer).toBe("https://example.com/");
    expect(setup.script).toContain("window.x = 1");
    expect(setup.script).toContain('["https://www.youtube.com/embed/"]');
    expect(frameRulesFor("https://www.youtube.com/watch?v=abc")).toEqual({});
    expect(frameRulesFor(undefined)).toEqual({});
    undo();
    expect(frameRulesFor("https://www.youtube.com/embed/abc")).toEqual({});
  });

  it("refuse a prefix that isn't a whole origin, a bad referrer and a script that doesn't parse", () => {
    quietly(() => {
      addFrameRule("p", { urlPrefixes: ["https://example.com"], script: "1" });
      addFrameRule("p", { urlPrefixes: ["https://example.com/"], referrer: "example.com" });
      addFrameRule("p", { urlPrefixes: ["https://example.com/"], script: "function (" });
    });
    expect(frameRulesFor("https://example.com/page")).toEqual({});
  });

  it("the first rule with a referrer gives it, and every script runs", () => {
    const undo = [
      addFrameRule("a", { urlPrefixes: ["https://example.com/"], script: "a()" }),
      addFrameRule("b", { urlPrefixes: ["https://example.com/x/"], referrer: "https://b.test/" }),
      addFrameRule("c", {
        urlPrefixes: ["https://example.com/"],
        referrer: "https://c.test/",
        script: "c()",
      }),
    ];
    const setup = frameRulesFor("https://example.com/x/1");
    expect(setup.referrer).toBe("https://b.test/");
    expect(setup.script).toMatch(/a\(\)[\s\S]*c\(\)/);
    for (const remove of undo) remove();
  });
});
