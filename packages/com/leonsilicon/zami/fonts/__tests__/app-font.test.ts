import { describe, expect, test, vi } from "vite-plus/test";
import {
  appFontFamily,
  DEFAULT_FONT_STACK,
  fontFamilies,
  resolveFontStack,
  setAppFontStack,
  setFontLoaded,
  setFontsInstalled,
  subscribeAppFont,
} from "#app-font";
import { classChoosesFamily, classChoosesSize } from "#font-class";

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

describe("Zam's default font", () => {
  test("is Zam's stack, which falls back to installed families as on the web", () => {
    setAppFontStack(null);
    expect(resolveFontStack(null)).toBe(resolveFontStack(DEFAULT_FONT_STACK));
    setFontsInstalled(["Helvetica Neue", "Arial"]);
    // gg sans isn't there; Helvetica Neue is, as on iOS.
    expect(appFontFamily()).toBe("Helvetica Neue");
    // A picked font that isn't loaded falls back the same way.
    expect(resolveFontStack('"Inter", "Helvetica Neue", Arial, sans-serif')).toBe(
      resolveFontStack("Inter") ?? "Helvetica Neue",
    );
    setFontLoaded("Helvetica Neue", null);
    setFontLoaded("Arial", null);
    expect(appFontFamily()).toBeNull();
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

describe("classChoosesSize", () => {
  test("is true for Tailwind's sizes and bracketed lengths, with variants", () => {
    for (const className of [
      "text-sm",
      "font-semibold text-xs text-discord-textMuted",
      "md:text-base",
      "!text-2xl",
      "text-[10px]",
      "text-[0.625rem]",
    ]) {
      expect([className, classChoosesSize(className)]).toEqual([className, true]);
    }
  });

  test("is false for colors, alignment and other text- utilities", () => {
    for (const className of [
      undefined,
      "text-discord-textPrimary",
      "text-white text-center",
      "text-[#e0e0e0]",
      "text-[rgb(var(--discord-accent-rgb)_/_1)]",
      "text-smaller",
    ]) {
      expect([className, classChoosesSize(className)]).toEqual([className, false]);
    }
  });
});
