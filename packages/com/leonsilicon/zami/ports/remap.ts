import { upstreamPathForZamiPath } from "#paths";
import type { Project } from "#project";

export interface RemapResult {
  /** Manifest entries pointed at upstream's rewritten history: Zami path → [old, new] commit. */
  remapped: Map<string, [string, string]>;
  /** Entries whose commit isn't upstream history and has no counterpart there, with why. */
  unmapped: Map<string, string>;
}

/**
 * When upstream rewrites history it had already published, the commits the manifest
 * records are no longer part of the merged upstream history (`_zami check` fails), though
 * upstream's rewritten copies of them are. This points each such entry at the copy: the
 * upstream commit with the same author date and subject, provided the upstream file has the
 * same content there. Failing that, at the newest upstream commit where it has that content.
 * Either way the file's content at the recorded commit is unchanged, so what `sync`, `diff`
 * and `check` compute from it is too.
 */
export function remap(project: Project, options: { dryRun?: boolean } = {}): RemapResult {
  const { git, manifest, upstreamSha } = project;
  const result: RemapResult = { remapped: new Map(), unmapped: new Map() };

  // Entries by commit: there are thousands of entries but only a handful of commits.
  const bySha = new Map<string, string[]>();
  for (const zamiPath of manifest.paths()) {
    const sha = manifest.get(zamiPath)!;
    bySha.set(sha, [...(bySha.get(sha) ?? []), zamiPath]);
  }
  const outside = new Map<string, string[]>();
  for (const [sha, zamiPaths] of bySha) {
    if (git.tryRun(["cat-file", "-e", `${sha}^{commit}`]) === null) {
      for (const zamiPath of zamiPaths)
        result.unmapped.set(zamiPath, `commit ${sha} doesn't exist`);
    } else if (!git.isAncestor(sha, upstreamSha)) {
      outside.set(sha, zamiPaths);
    }
  }
  if (outside.size === 0) return result;

  // Upstream's commits by author date and subject; a pair seen twice can't identify one.
  const bySignature = new Map<string, string | null>();
  for (const line of git.lines(["log", "--format=%H%x00%ad%x00%s", "--date=raw", upstreamSha])) {
    const [sha, date, subject] = line.split("\0") as [string, string, string];
    const key = `${date}\0${subject}`;
    bySignature.set(key, bySignature.has(key) ? null : sha);
  }
  // Each commit's tree, read once: path → blob id.
  const trees = new Map<string, Map<string, string>>();
  const blob = (sha: string, path: string): string | undefined => {
    let tree = trees.get(sha);
    if (tree === undefined) {
      tree = new Map();
      for (const entry of git.run(["ls-tree", "-r", "-z", sha]).split("\0")) {
        const tab = entry.indexOf("\t");
        if (tab !== -1) tree.set(entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2]!);
      }
      trees.set(sha, tree);
    }
    return tree.get(path);
  };

  for (const [sha, zamiPaths] of outside) {
    const [date, subject] = git
      .run(["log", "-1", "--format=%ad%x00%s", "--date=raw", sha])
      .trim()
      .split("\0") as [string, string];
    const twin = bySignature.get(`${date}\0${subject}`) ?? null;
    for (const zamiPath of zamiPaths) {
      const upstreamPath = upstreamPathForZamiPath(zamiPath);
      const content = upstreamPath === null ? undefined : blob(sha, upstreamPath);
      if (upstreamPath === null || content === undefined) {
        result.unmapped.set(zamiPath, `${upstreamPath ?? zamiPath} isn't in commit ${sha}`);
        continue;
      }
      let target: string | null =
        twin !== null && blob(twin, upstreamPath) === content ? twin : null;
      if (target === null) {
        for (const candidate of git.lines([
          "log",
          "--format=%H",
          upstreamSha,
          "--",
          upstreamPath,
        ])) {
          if (blob(candidate, upstreamPath) === content) {
            target = candidate;
            break;
          }
        }
      }
      if (target === null) {
        result.unmapped.set(
          zamiPath,
          `upstream's history never has ${upstreamPath} as it was in commit ${sha.slice(0, 10)}`,
        );
        continue;
      }
      result.remapped.set(zamiPath, [sha, target]);
      manifest.set(zamiPath, target);
    }
  }
  if (!options.dryRun && result.remapped.size > 0) manifest.write(project.root);
  return result;
}
