import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface PortsConfig {
  /** The ref Zam is fetched into, e.g. `upstream/master`. */
  upstream: string;
  /** Upstream files that must have an Expo version (globs, relative to the repo root). */
  include: string[];
  /** Upstream files that never get one. */
  exclude: string[];
}

export const CONFIG_PATH = "expo/zami-ports.json";

export function readConfig(root: string): PortsConfig {
  const config = JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8")) as Partial<PortsConfig>;
  return {
    upstream: config.upstream ?? "upstream/master",
    include: config.include ?? [],
    exclude: config.exclude ?? [],
  };
}

/** Supports `**`, `*`, `?` and `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      pattern += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", index);
      const options = glob.slice(index + 1, end).split(",");
      pattern += `(?:${options.map((option) => option.replaceAll(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      index = end;
    } else {
      pattern += char.replace(/[.+^$()|[\]\\]/, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

export function scopeMatcher(config: PortsConfig): (path: string) => boolean {
  const include = config.include.map(globToRegExp);
  const exclude = config.exclude.map(globToRegExp);
  return (path) =>
    include.some((regexp) => regexp.test(path)) && !exclude.some((regexp) => regexp.test(path));
}
