import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { configFor } from "./app.config.ts";

const { expo } = JSON.parse(readFileSync(new URL("./app.json", import.meta.url), "utf8"));

test("production and staging use the approved opaque 1024px app icon", () => {
  assert.equal(expo.icon, "./assets/icon.png");
  const png = readFileSync(new URL(expo.icon, import.meta.url));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 2, "RGB without an alpha channel is required for the iOS icon");
  for (const variant of ["production", "staging"]) {
    const config = configFor(expo, variant);
    assert.equal(config.icon, expo.icon);
    assert.equal(config.ios?.icon ?? config.icon, expo.icon);
    assert.equal(config.android?.icon ?? config.icon, expo.icon);
  }
});
