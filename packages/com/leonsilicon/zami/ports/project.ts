import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isZamiOwned, readConfig, scopeMatcher, type PortsConfig } from "#config";
import { Git, isBinary, type TreeEntry } from "#git";
import { Manifest } from "#manifest";
import { mapUpstreamPath, upstreamPathForZamiPath, type PortMapping } from "#paths";

export type PortStatus =
  /** Synced with the merged upstream commit. */
  | "fresh"
  /** Upstream changed the file since the commit the manifest records. */
  | "stale"
  /** Contains unresolved `<<<<<<< zami` conflict markers. */
  | "conflict"
  /** No Zami version exists yet. */
  | "missing";

export interface Port {
  mapping: PortMapping;
  /** The upstream file's git mode at the merged upstream commit. */
  mode: string;
  status: PortStatus;
  /** The upstream commit the Zami version was last synced with (from the manifest). */
  sha: string | null;
  /** For a stale port: what upstream did to the file since `sha`. */
  change?: { status: string; newPath: string | null };
}

export interface Problem {
  zamiPath: string;
  message: string;
}

export const CONFLICT_MARKER = /^(<<<<<<< zami|>>>>>>> upstream)$/m;

export function hasConflictMarkers(content: Buffer): boolean {
  return !isBinary(content) && CONFLICT_MARKER.test(content.toString("utf8"));
}

export class Project {
  readonly git: Git;
  readonly config: PortsConfig;
  /** The newest upstream commit merged into HEAD. Every upstream file in the tree is at this commit. */
  readonly upstreamSha: string;
  readonly inScope: (path: string) => boolean;
  readonly manifest: Manifest;
  #tree: TreeEntry[] | undefined;

  constructor(cwd: string, options: { upstream?: string } = {}) {
    this.git = new Git(cwd);
    this.config = readConfig(this.git.root);
    const upstreamRef = options.upstream ?? this.config.upstream;
    const upstream = this.git.tryRun(["rev-parse", "--verify", `${upstreamRef}^{commit}`]);
    if (upstream === null) {
      throw new Error(
        `Can't find ${upstreamRef}. Add Zam as a remote first:\n  git remote add upstream https://github.com/az4521/Zam.git && git fetch upstream`,
      );
    }
    this.upstreamSha = this.git.run(["merge-base", "HEAD", upstream.trim()]).trim();
    this.inScope = scopeMatcher(this.config);
    this.manifest = Manifest.read(this.git.root);
  }

  get root(): string {
    return this.git.root;
  }

  read(path: string): Buffer | null {
    const absolute = join(this.root, path);
    return existsSync(absolute) ? readFileSync(absolute) : null;
  }

  /** Every upstream file at the merged upstream commit. */
  upstreamTree(): TreeEntry[] {
    this.#tree ??= this.git.listTree(this.upstreamSha);
    return this.#tree;
  }

  /** Every in-scope upstream file, with its Zami version's path. */
  mappings(): (PortMapping & { mode: string })[] {
    return this.upstreamTree()
      .filter((entry) => this.inScope(entry.path))
      .map((entry) => ({ ...mapUpstreamPath(entry.path), mode: entry.mode }));
  }

  /** Zami files in the working tree (Zami's own apps and packages excluded). */
  zamiFiles(): string[] {
    const upstream = new Set(this.upstreamTree().map((entry) => entry.path));
    return this.git
      .workingTreeFiles()
      .filter(
        (path) =>
          !isZamiOwned(path) &&
          !upstream.has(path) &&
          upstreamPathForZamiPath(path) !== null &&
          existsSync(join(this.root, path)),
      );
  }

  /** The state of every port, plus Zami files and manifest entries that don't add up. */
  scan(): { ports: Port[]; orphans: Problem[]; invalid: Problem[] } {
    const mappings = this.mappings();
    const zamiFiles = new Set(this.zamiFiles());
    const mappedZamiPaths = new Set(mappings.map((mapping) => mapping.zamiPath));
    const changesSince = new Map<string, Map<string, { status: string; newPath: string | null }>>();
    const changes = (sha: string) => {
      let result = changesSince.get(sha);
      if (result === undefined) {
        result = this.git.changes(sha, this.upstreamSha);
        changesSince.set(sha, result);
      }
      return result;
    };
    const shaProblems = new Map<string, string | null>();
    const shaProblem = (sha: string): string | null => {
      if (!shaProblems.has(sha)) {
        shaProblems.set(
          sha,
          this.git.tryRun(["cat-file", "-e", `${sha}^{commit}`]) === null
            ? `manifest commit ${sha} doesn't exist`
            : this.git.isAncestor(sha, this.upstreamSha)
              ? null
              : `manifest commit ${sha} isn't part of the merged upstream history`,
        );
      }
      return shaProblems.get(sha)!;
    };

    const invalid: Problem[] = [];
    const orphans: Problem[] = [];
    for (const zamiPath of zamiFiles) {
      const sha = this.manifest.get(zamiPath);
      if (sha === undefined) {
        invalid.push({
          zamiPath,
          message: `has no entry in zami-ports.lock.json (run \`_zami done\` once it reflects upstream)`,
        });
      } else {
        const problem = shaProblem(sha);
        if (problem !== null) invalid.push({ zamiPath, message: problem });
      }
      if (!mappedZamiPaths.has(zamiPath)) {
        orphans.push({
          zamiPath,
          message: `${upstreamPathForZamiPath(zamiPath)} isn't an in-scope upstream file at ${this.upstreamSha.slice(0, 8)}`,
        });
      }
    }
    for (const zamiPath of this.manifest.paths()) {
      if (!zamiFiles.has(zamiPath)) {
        invalid.push({ zamiPath, message: "is in zami-ports.lock.json but doesn't exist" });
      }
    }

    const ports = mappings.map(({ mode, ...mapping }): Port => {
      if (!zamiFiles.has(mapping.zamiPath)) return { mapping, mode, status: "missing", sha: null };
      const sha = this.manifest.get(mapping.zamiPath) ?? null;
      if (sha === null || sha === this.upstreamSha) return { mapping, mode, status: "fresh", sha };
      // Only files behind upstream can hold an unresolved merge.
      if (hasConflictMarkers(this.read(mapping.zamiPath) ?? Buffer.alloc(0))) {
        return { mapping, mode, status: "conflict", sha };
      }
      const change = changes(sha).get(mapping.upstreamPath);
      return change === undefined
        ? { mapping, mode, status: "fresh", sha }
        : { mapping, mode, status: "stale", sha, change };
    });

    return { ports, orphans, invalid };
  }
}
