// The file-naming rule shared with @-/com.leonsilicon.zami.ports (paths.ts): every upstream
// file's Expo version inserts `.expo` before its extension (or appends it when there is
// none), and a Svelte component's is `<name>.svelte.expo.tsx`.
import path from "node:path";

/** The Expo version of an upstream file. */
export function expoPathFor(upstreamPath) {
  if (upstreamPath.endsWith(".svelte")) return `${upstreamPath}.expo.tsx`;
  if (upstreamPath.endsWith(".d.ts")) return `${upstreamPath.slice(0, -".d.ts".length)}.expo.d.ts`;
  const name = path.basename(upstreamPath);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${upstreamPath}.expo`;
  return `${upstreamPath.slice(0, upstreamPath.length - (name.length - dot))}.expo${name.slice(dot)}`;
}

/** Whether a path is an Expo version (its upstream name maps back to it). */
export function isExpoPath(filePath) {
  const name = path.basename(filePath);
  const marker = name.lastIndexOf(".expo");
  if (marker < 0) return false;
  const dir = filePath.slice(0, filePath.length - name.length);
  const candidates = filePath.endsWith(".svelte.expo.tsx")
    ? [filePath.slice(0, -".expo.tsx".length)]
    : filePath.endsWith(".expo.d.ts")
      ? [`${filePath.slice(0, -".expo.d.ts".length)}.d.ts`]
      : [`${dir}${name.slice(0, marker)}${name.slice(marker + ".expo".length)}`];
  return candidates.some((upstream) => expoPathFor(upstream) === filePath);
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
