import { describe, expect, test } from "vite-plus/test";
import { encodeBase64 } from "#base64";
import { extensionFor } from "#extension";

describe("encodeBase64", () => {
  test("matches btoa for every padding and every byte value", () => {
    for (let length = 0; length <= 12; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 250) % 256);
      expect(encodeBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    }
    const all = Uint8Array.from({ length: 256 * 3 + 1 }, (_, i) => i % 256);
    expect(encodeBase64(all)).toBe(btoa(String.fromCharCode(...all)));
  });

  test("encodes only a view's own bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(2, 5);
    expect(encodeBase64(bytes)).toBe(btoa("\u0003\u0004\u0005"));
  });
});

describe("extensionFor", () => {
  test("names a file for its type", () => {
    expect(extensionFor("image/jpeg")).toBe(".jpg");
    expect(extensionFor("Audio/WAV")).toBe(".wav");
    expect(extensionFor("video/mp4; codecs=avc1")).toBe(".mp4");
    expect(extensionFor("text/plain;charset=utf-8")).toBe(".txt");
    expect(extensionFor("image/svg+xml")).toBe(".svg");
  });

  test("falls back to the file's name, then to a subtype that reads like an extension", () => {
    expect(extensionFor("", "Clip.M4A")).toBe(".m4a");
    expect(extensionFor("application/octet-stream", "notes.md")).toBe(".md");
    expect(extensionFor("image/jpeg", "photo.png")).toBe(".jpg");
    expect(extensionFor("audio/x-foo")).toBe(".foo");
    expect(extensionFor("application/octet-stream")).toBe("");
    expect(extensionFor("")).toBe("");
    expect(extensionFor("", "no-extension")).toBe("");
  });
});
