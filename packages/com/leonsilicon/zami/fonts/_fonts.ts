#!/usr/bin/env node
// `vpx _fonts`: writes Zam's bundled fonts (the Zami versions of static/fonts/*.woff2) as
// TrueType to apps/zami/assets/fonts, which the app loads at startup: iOS's expo-font and
// Android's Typeface don't load WOFF2. Their licenses go along. Rerun it after a sync
// changes Zam's fonts, and commit what it writes.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toSfnt } from "#convert";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const source = path.join(repoRoot, "static/fonts");
const destination = path.join(repoRoot, "apps/zami/assets/fonts");

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const name of readdirSync(source).sort()) {
  const match = /^(.+)\.zami\.(woff2|txt)$/.exec(name);
  if (!match) continue;
  const [, stem, extension] = match as unknown as [string, string, string];
  if (extension === "txt") {
    copyFileSync(path.join(source, name), path.join(destination, `${stem}.txt`));
    continue;
  }
  const font = toSfnt(new Uint8Array(readFileSync(path.join(source, name))));
  const out = path.join(destination, `${stem}.${font.extension}`);
  writeFileSync(out, font.data);
  console.log(`${path.relative(repoRoot, out)} (${font.data.length} bytes)`);
}
