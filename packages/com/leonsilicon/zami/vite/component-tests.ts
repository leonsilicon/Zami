import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Upstream tests that render Svelte components. Their Zami copies import the components'
 * React Native translations, which a Svelte test can't render, so they need rewriting
 * (with React Native Testing Library) before they can run. Returns repo-relative paths of
 * those `.test.zami.ts` copies.
 */
export function componentTestFiles(repoRoot: string): string[] {
  const tests = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "--", "src/*.test.zami.ts", "src/**/*.test.zami.ts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((file) => file !== "");
  return tests.filter((test) => {
    const source = readFileSync(path.join(repoRoot, test), "utf8");
    return [...source.matchAll(/from\s+["']([^"']+\.svelte)["']/g)].some(([, specifier]) => {
      const target = specifier!.startsWith("$lib/")
        ? path.join(repoRoot, "src/lib", specifier!.slice("$lib/".length))
        : path.resolve(path.dirname(path.join(repoRoot, test)), specifier!);
      return existsSync(target);
    });
  });
}
