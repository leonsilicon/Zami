import { describe, expect, test, vi } from "vite-plus/test";
import {
  appFontFamily,
  fontFamilies,
  resolveFontStack,
  setAppFontStack,
  setFontLoaded,
  subscribeAppFont,
} from "#app-font";
import { classChoosesFamily } from "#font-class";

// Zam's stacks (messageDisplay's MESSAGE_FONTS and CUSTOM_FONT_STACK).
const INTER = '"Inter", "Helvetica Neue", Arial, "Noto Sans Syriac Eastern", sans-serif';
const CUSTOM = '"ZamCustomFont", "Helvetica Neue", Arial, sans-serif';

describe("the app's font", () => {
  test("splits a CSS stack into families", () => {
    expect(fontFamilies(INTER)).toEqual([
      "Inter",
      "Helvetica Neue",
      "Arial",
      "Noto Sans Syriac Eastern",
      "sans-serif",
    ]);
    expect(fontFamilies(" 'A B' ,C,, ")).toEqual(["A B", "C"]);
  });

  test("is the stack's first loaded family, or none", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppFont(listener);
    setAppFontStack(INTER);
    expect(appFontFamily()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    setFontLoaded("Inter");
    expect(appFontFamily()).toBe("Inter");
    expect(listener).toHaveBeenCalledTimes(1);

    // The custom font renders under the name it was registered as.
    setAppFontStack(CUSTOM);
    expect(appFontFamily()).toBeNull();
    setFontLoaded("ZamCustomFont", "ZamCustomFont-abc");
    expect(appFontFamily()).toBe("ZamCustomFont-abc");
    expect(resolveFontStack(INTER)).toBe("Inter");
    setFontLoaded("ZamCustomFont", null);
    expect(appFontFamily()).toBeNull();

    setAppFontStack(INTER);
    setAppFontStack(null);
    expect(appFontFamily()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(6);
    unsubscribe();
    setAppFontStack(INTER);
    expect(listener).toHaveBeenCalledTimes(6);
  });
});

describe("classChoosesFamily", () => {
  test("is true for font-mono, font-serif and arbitrary families, with variants", () => {
    for (const className of [
      "font-mono",
      "text-xs font-mono text-white",
      "md:font-mono",
      "!font-mono",
      "font-serif",
      "font-[Menlo]",
    ]) {
      expect([className, classChoosesFamily(className)]).toEqual([className, true]);
    }
  });

  test("is false for font-sans (the app's font), weights and anything else", () => {
    for (const className of [
      undefined,
      "",
      "font-sans",
      "font-bold",
      "font-medium text-sm",
      "fontmono",
    ]) {
      expect([className, classChoosesFamily(className)]).toEqual([className, false]);
    }
  });
});
