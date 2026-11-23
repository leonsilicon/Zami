#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { captureScreenshots, screenshotTargets, type ScreenshotTarget } from "#screenshots";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: "string" },
    out: { type: "string" },
    "iphone-device": { type: "string" },
    "ipad-device": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`Usage: vpx _create-screenshots [iphone] [ipad] [--app <simulator .app>] [--out <directory>]

Defaults to both devices. Pass --app to reuse a release simulator build.
Use --iphone-device or --ipad-device with a simulator name or UDID.
Each run writes a new folder in apps/zami/.build/screenshots, or under --out.`);
} else {
  const ids = positionals.length ? [...new Set(positionals)] : Object.keys(screenshotTargets);
  if (ids.some((id) => !Object.hasOwn(screenshotTargets, id)))
    throw new Error("Screenshot targets are iphone and ipad");
  await captureScreenshots({
    targets: ids as ScreenshotTarget[],
    app: values.app && resolve(values.app),
    out: values.out && resolve(values.out),
    devices: { iphone: values["iphone-device"], ipad: values["ipad-device"] },
  });
}
