// How an upstream Zam file maps to its Expo version, and back. Every upstream file has
// one. The Expo version inserts `.expo` before the file's extension, so the import
// strings Zam already uses resolve to it under Metro's `sourceExts` and TypeScript's
// `moduleSuffixes`:
//
//   src/lib/foo.ts              -> src/lib/foo.expo.ts              (copy)
//   src/lib/stores/x.svelte.ts  -> src/lib/stores/x.svelte.expo.ts  (copy)
//   src/app.d.ts                -> src/app.expo.d.ts                (copy)
//   static/favicon.png          -> static/favicon.expo.png          (copy)
//   README.md                   -> README.expo.md                   (copy)
//   LICENSE, .gitignore         -> LICENSE.expo, .gitignore.expo    (copy)
//   src/lib/Foo.svelte          -> src/lib/Foo.svelte.expo.tsx      (translation)
//
// A copy keeps upstream's file type, so upstream changes are merged into it with a
// three-way merge. A translation is Svelte rewritten as React Native, so upstream
// changes are migrated by hand or by the Claude bot.
import { posix } from "node:path";

export type PortKind = "copy" | "translate";

export interface PortMapping {
  upstreamPath: string;
  expoPath: string;
  kind: PortKind;
}

export function mapUpstreamPath(upstreamPath: string): PortMapping {
  if (upstreamPath.endsWith(".svelte")) {
    return { upstreamPath, expoPath: `${upstreamPath}.expo.tsx`, kind: "translate" };
  }
  if (upstreamPath.endsWith(".d.ts")) {
    return {
      upstreamPath,
      expoPath: `${upstreamPath.slice(0, -".d.ts".length)}.expo.d.ts`,
      kind: "copy",
    };
  }
  const name = posix.basename(upstreamPath);
  const dot = name.lastIndexOf(".");
  // No extension (LICENSE) or only a leading dot (.gitignore): append `.expo`.
  if (dot <= 0) return { upstreamPath, expoPath: `${upstreamPath}.expo`, kind: "copy" };
  const stem = upstreamPath.slice(0, upstreamPath.length - (name.length - dot));
  return { upstreamPath, expoPath: `${stem}.expo${name.slice(dot)}`, kind: "copy" };
}

/** The upstream file an Expo file's name implies, or null if the name isn't an Expo version's. */
export function upstreamPathForExpoPath(expoPath: string): string | null {
  const name = posix.basename(expoPath);
  const dir = expoPath.slice(0, expoPath.length - name.length);
  let upstream: string;
  if (expoPath.endsWith(".svelte.expo.tsx")) upstream = expoPath.slice(0, -".expo.tsx".length);
  else if (expoPath.endsWith(".expo.d.ts"))
    upstream = `${expoPath.slice(0, -".expo.d.ts".length)}.d.ts`;
  else if (name.endsWith(".expo")) upstream = expoPath.slice(0, -".expo".length);
  else {
    const marker = name.lastIndexOf(".expo.");
    if (marker < 0) return null;
    upstream = `${dir}${name.slice(0, marker)}${name.slice(marker + ".expo".length)}`;
  }
  // Only names this mapping produces count (so `foo.ts.expo` isn't `foo.ts`'s Expo version).
  return posix.basename(upstream) !== "" && mapUpstreamPath(upstream).expoPath === expoPath
    ? upstream
    : null;
}

export function isExpoPath(path: string): boolean {
  return upstreamPathForExpoPath(path) !== null;
}
