import { describe, expect, test } from "vite-plus/test";
import { indexParents, spaceReach } from "#space-index";

describe("indexParents", () => {
  test("lists each child's parents in space order, each once", () => {
    const children: Record<string, string[]> = {
      "!s1": ["!a", "!b", "!a"],
      "!s2": ["!b", "!s1"],
      "!s3": [],
    };
    const parents = indexParents(["!s1", "!s2", "!s3"], (id) => children[id] ?? []);
    expect(parents.get("!a")).toEqual(["!s1"]);
    expect(parents.get("!b")).toEqual(["!s1", "!s2"]);
    expect(parents.get("!s1")).toEqual(["!s2"]);
    expect(parents.get("!c")).toBeUndefined();
  });

  test("agrees with asking every space for every room", () => {
    const children: Record<string, string[]> = {
      "!s1": ["!a", "!b"],
      "!s2": ["!b", "!c"],
      "!s3": ["!a", "!c", "!b"],
    };
    const spaces = Object.keys(children);
    const parents = indexParents(spaces, (id) => children[id]!);
    for (const room of ["!a", "!b", "!c", "!d"]) {
      const naive = spaces.filter((s) => children[s]!.includes(room));
      expect(parents.get(room) ?? []).toEqual(naive);
    }
  });
});

describe("spaceReach", () => {
  test("covers the space and every space below it, once, through cycles", () => {
    const childSpaces: Record<string, string[]> = {
      "!top": ["!mid", "!other"],
      "!mid": ["!leaf", "!top"],
      "!other": ["!leaf"],
      "!leaf": [],
    };
    expect(spaceReach("!top", (id) => childSpaces[id] ?? []).sort()).toEqual(
      ["!leaf", "!mid", "!other", "!top"].sort(),
    );
    expect(spaceReach("!leaf", (id) => childSpaces[id] ?? [])).toEqual(["!leaf"]);
  });
});
