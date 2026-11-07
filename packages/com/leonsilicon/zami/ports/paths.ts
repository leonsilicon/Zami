// How an upstream Zam file maps to its Zami version, and back. Every upstream file has
// one. The Zami version inserts `.zami` before the file's extension, so the import
// strings Zam already uses resolve to it under Metro's `sourceExts` and TypeScript's
// `moduleSuffixes`:
//
//   src/lib/foo.ts              -> src/lib/foo.zami.ts              (copy)
//   src/lib/stores/x.svelte.ts  -> src/lib/stores/x.svelte.zami.ts  (copy)
//   src/app.d.ts                -> src/app.zami.d.ts                (copy)
//   static/favicon.png          -> static/favicon.zami.png          (copy)
//   README.md                   -> README.zami.md                   (copy)
//   LICENSE, .gitignore         -> LICENSE.zami, .gitignore.zami    (copy)
//   src/lib/Foo.svelte          -> src/lib/Foo.svelte.zami.tsx      (translation)
//
// A copy keeps upstream's file type, so upstream changes are merged into it with a
// three-way merge. A translation is Svelte rewritten as React Native, so upstream
// changes are migrated by hand or by the Claude bot.
import { posix } from "node:path";

export type PortKind = "copy" | "translate";

export interface PortMapping {
  upstreamPath: string;
  zamiPath: string;
  kind: PortKind;
}

export function mapUpstreamPath(upstreamPath: string): PortMapping {
  if (upstreamPath.endsWith(".svelte")) {
    return { upstreamPath, zamiPath: `${upstreamPath}.zami.tsx`, kind: "translate" };
  }
  if (upstreamPath.endsWith(".d.ts")) {
    return {
      upstreamPath,
      zamiPath: `${upstreamPath.slice(0, -".d.ts".length)}.zami.d.ts`,
      kind: "copy",
    };
  }
  const name = posix.basename(upstreamPath);
  const dot = name.lastIndexOf(".");
  // No extension (LICENSE) or only a leading dot (.gitignore): append `.zami`.
  if (dot <= 0) return { upstreamPath, zamiPath: `${upstreamPath}.zami`, kind: "copy" };
  const stem = upstreamPath.slice(0, upstreamPath.length - (name.length - dot));
  return { upstreamPath, zamiPath: `${stem}.zami${name.slice(dot)}`, kind: "copy" };
}

/** The upstream file a Zami file's name implies, or null if the name isn't a Zami version's. */
export function upstreamPathForZamiPath(zamiPath: string): string | null {
  const name = posix.basename(zamiPath);
  const dir = zamiPath.slice(0, zamiPath.length - name.length);
  let upstream: string;
  if (zamiPath.endsWith(".svelte.zami.tsx")) upstream = zamiPath.slice(0, -".zami.tsx".length);
  else if (zamiPath.endsWith(".zami.d.ts"))
    upstream = `${zamiPath.slice(0, -".zami.d.ts".length)}.d.ts`;
  else if (name.endsWith(".zami")) upstream = zamiPath.slice(0, -".zami".length);
  else {
    const marker = name.lastIndexOf(".zami.");
    if (marker < 0) return null;
    upstream = `${dir}${name.slice(0, marker)}${name.slice(marker + ".zami".length)}`;
  }
  // Only names this mapping produces count (so `foo.ts.zami` isn't `foo.ts`'s Zami version).
  return posix.basename(upstream) !== "" && mapUpstreamPath(upstream).zamiPath === zamiPath
    ? upstream
    : null;
}

export function isZamiPath(path: string): boolean {
  return upstreamPathForZamiPath(path) !== null;
}
