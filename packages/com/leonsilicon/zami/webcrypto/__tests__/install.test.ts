import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installWebCrypto } from "#install";
import { subtle } from "#subtle";
import { bytes, hex, node, rejection } from "./helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installWebCrypto", () => {
  test("leaves a platform's own subtle in place", () => {
    const before = globalThis.crypto.subtle;
    installWebCrypto();
    expect(globalThis.crypto.subtle).toBe(before);
  });

  test("gives crypto a subtle where it has none, as in Hermes", async () => {
    const getRandomValues = <T extends ArrayBufferView>(array: T) => array;
    const host = { getRandomValues };
    vi.stubGlobal("crypto", host);
    installWebCrypto();
    installWebCrypto();
    expect(globalThis.crypto).toBe(host);
    expect(host).toEqual({ getRandomValues, subtle });
    expect(hex(await globalThis.crypto.subtle.digest("SHA-256", bytes(3)))).toBe(
      hex(await node.digest("SHA-256", bytes(3))),
    );
  });

  test("makes crypto if there's none", () => {
    vi.stubGlobal("crypto", undefined);
    installWebCrypto();
    expect(globalThis.crypto.subtle).toBe(subtle);
  });
});

describe("errors", () => {
  test("are Errors with DOMException's names where there's no DOMException", async () => {
    vi.stubGlobal("DOMException", undefined);
    const error = await rejection(subtle.digest("SHA-1", bytes(1)));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NotSupportedError");
    expect(error.message).toContain("SHA-1");
  });
});
