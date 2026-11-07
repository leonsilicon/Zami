// The file-naming rule shared with @-/com.leonsilicon.zami.ports (paths.ts): every upstream
// file's Zami version inserts `.zami` before its extension (or appends it when there is
// none), and a Svelte component's is `<name>.svelte.zami.tsx`.
import path from "node:path";

/** The Zami version of an upstream file. */
export function zamiPathFor(upstreamPath) {
  if (upstreamPath.endsWith(".svelte")) return `${upstreamPath}.zami.tsx`;
  if (upstreamPath.endsWith(".d.ts")) return `${upstreamPath.slice(0, -".d.ts".length)}.zami.d.ts`;
  const name = path.basename(upstreamPath);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${upstreamPath}.zami`;
  return `${upstreamPath.slice(0, upstreamPath.length - (name.length - dot))}.zami${name.slice(dot)}`;
}

/** Whether a path is a Zami version (its upstream name maps back to it). */
export function isZamiPath(filePath) {
  const name = path.basename(filePath);
  const marker = name.lastIndexOf(".zami");
  if (marker < 0) return false;
  const dir = filePath.slice(0, filePath.length - name.length);
  const candidates = filePath.endsWith(".svelte.zami.tsx")
    ? [filePath.slice(0, -".zami.tsx".length)]
    : filePath.endsWith(".zami.d.ts")
      ? [`${filePath.slice(0, -".zami.d.ts".length)}.d.ts`]
      : [`${dir}${name.slice(0, marker)}${name.slice(marker + ".zami".length)}`];
  return candidates.some((upstream) => zamiPathFor(upstream) === filePath);
}

/** Upstream files a Vite import specifier can resolve to, in Vite's order. */
export function upstreamCandidates(target) {
  const candidates = [target];
  if (/\.(js|mjs)$/.test(target)) candidates.push(target.replace(/\.m?js$/, ".ts"));
  candidates.push(
    `${target}.ts`,
    `${target}.js`,
    path.join(target, "index.ts"),
    path.join(target, "index.js"),
  );
  return candidates;
}
