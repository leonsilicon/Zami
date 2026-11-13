import { describe, expect, test } from "vite-plus/test";
import { createMediaQueryList, recheckMediaQueries, watchedMediaQueryCount } from "#media-query";

describe("createMediaQueryList", () => {
  test("watches only while it has a listener", () => {
    let wide = false;
    const before = watchedMediaQueryCount();
    // A component that calls matchMedia on every render and never listens.
    for (let i = 0; i < 100; i++) createMediaQueryList("(min-width: 768px)", () => wide);
    expect(watchedMediaQueryCount()).toBe(before);

    const list = createMediaQueryList("(min-width: 768px)", () => wide);
    const heard: boolean[] = [];
    const listener = (event: Event) =>
      heard.push((event as unknown as { matches: boolean }).matches);
    list.addEventListener("change", listener);
    expect(watchedMediaQueryCount()).toBe(before + 1);
    wide = true;
    recheckMediaQueries();
    recheckMediaQueries();
    expect(heard).toEqual([true]);
    list.removeEventListener("change", listener);
    expect(watchedMediaQueryCount()).toBe(before);
    wide = false;
    recheckMediaQueries();
    expect(heard).toEqual([true]);
  });

  test("supports the legacy listener methods and onchange", () => {
    let dark = false;
    const list = createMediaQueryList("(prefers-color-scheme: dark)", () => dark);
    const heard: string[] = [];
    const legacy = () => heard.push("legacy");
    list.addListener(legacy);
    list.onchange = () => heard.push("onchange");
    dark = true;
    recheckMediaQueries();
    expect(heard).toEqual(["legacy", "onchange"]);
    expect(list.matches).toBe(true);
    list.removeListener(legacy);
    list.onchange = null;
    dark = false;
    recheckMediaQueries();
    expect(heard).toEqual(["legacy", "onchange"]);
  });

  test("starts from the current answer when it starts watching", () => {
    let wide = false;
    const list = createMediaQueryList("(min-width: 768px)", () => wide);
    wide = true; // changed before anyone listened
    const heard: boolean[] = [];
    list.addEventListener("change", () => heard.push(true));
    recheckMediaQueries();
    expect(heard).toEqual([]);
  });
});
