import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BUFFER = 1024 * 1024 * 1024;

export interface TreeEntry {
  path: string;
  /** Git file mode, e.g. `100644`, or `100755` for executables. */
  mode: string;
}

export class Git {
  readonly root: string;

  constructor(cwd: string) {
    this.root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    }).trim();
  }

  run(args: string[]): string {
    return execFileSync("git", args, { cwd: this.root, encoding: "utf8", maxBuffer: MAX_BUFFER });
  }

  tryRun(args: string[]): string | null {
    const result = spawnSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return result.status === 0 ? result.stdout : null;
  }

  lines(args: string[]): string[] {
    return this.run(args)
      .split("\n")
      .filter((line) => line !== "");
  }

  revParse(ref: string): string {
    return this.run(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    return (
      spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: this.root })
        .status === 0
    );
  }

  /** File contents at a commit, or null if the path doesn't exist there. */
  show(sha: string, path: string): Buffer | null {
    const result = spawnSync("git", ["cat-file", "blob", `${sha}:${path}`], {
      cwd: this.root,
      maxBuffer: MAX_BUFFER,
    });
    return result.status === 0 ? result.stdout : null;
  }

  /** Many files' contents at one commit, read with a single `git cat-file --batch`. */
  readBlobs(sha: string, paths: string[]): Map<string, Buffer> {
    const blobs = new Map<string, Buffer>();
    if (paths.length === 0) return blobs;
    const output = execFileSync("git", ["cat-file", "--batch"], {
      cwd: this.root,
      input: paths.map((path) => `${sha}:${path}\n`).join(""),
      maxBuffer: MAX_BUFFER,
    });
    let offset = 0;
    for (const path of paths) {
      const newline = output.indexOf(10, offset);
      const header = output.subarray(offset, newline).toString("utf8");
      offset = newline + 1;
      if (header.endsWith(" missing")) continue;
      const size = Number(header.split(" ")[2]);
      blobs.set(path, output.subarray(offset, offset + size));
      offset += size + 1;
    }
    return blobs;
  }

  /** Every file in a commit's tree, with its mode. */
  listTree(sha: string): TreeEntry[] {
    return this.run(["ls-tree", "-r", "-z", sha])
      .split("\0")
      .filter((line) => line !== "")
      .map((line) => {
        const tab = line.indexOf("\t");
        return { mode: line.slice(0, line.indexOf(" ")), path: line.slice(tab + 1) };
      });
  }

  /**
   * Upstream paths that changed between two commits. Renames map the old path to its new
   * one; deletions map to null.
   */
  changes(from: string, to: string): Map<string, { status: string; newPath: string | null }> {
    const changes = new Map<string, { status: string; newPath: string | null }>();
    const fields = this.run(["diff", "--name-status", "-z", "-M", from, to])
      .split("\0")
      .filter((field) => field !== "");
    for (let index = 0; index < fields.length;) {
      const status = fields[index++]!;
      if (status.startsWith("R") || status.startsWith("C")) {
        const oldPath = fields[index++]!;
        const newPath = fields[index++]!;
        if (status.startsWith("R")) changes.set(oldPath, { status: "R", newPath });
      } else {
        const path = fields[index++]!;
        changes.set(path, { status: status[0]!, newPath: status.startsWith("D") ? null : path });
      }
    }
    return changes;
  }

  /** Tracked files plus untracked ones that aren't ignored. */
  workingTreeFiles(): string[] {
    return this.run(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
      .split("\0")
      .filter((path) => path !== "");
  }

  /** The subset of `paths` that .gitignore rules match. */
  ignored(paths: string[]): string[] {
    if (paths.length === 0) return [];
    const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
      cwd: this.root,
      input: paths.join("\0"),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return result.stdout.split("\0").filter((path) => path !== "");
  }

  /**
   * Three-way merge with `git merge-file`. Returns the merged text and how many conflicts
   * it contains (marked with `<<<<<<< zami` / `>>>>>>> upstream`).
   */
  mergeFile(ours: Buffer, base: Buffer, theirs: Buffer): { text: Buffer; conflicts: number } {
    const dir = mkdtempSync(join(tmpdir(), "zami-merge-"));
    try {
      const paths = ["ours", "base", "theirs"].map((name) => join(dir, name));
      writeFileSync(paths[0]!, ours);
      writeFileSync(paths[1]!, base);
      writeFileSync(paths[2]!, theirs);
      const result = spawnSync(
        "git",
        [
          "merge-file",
          "-p",
          "--diff-algorithm=histogram",
          "-L",
          "zami",
          "-L",
          "upstream (last synced)",
          "-L",
          "upstream",
          ...paths,
        ],
        { maxBuffer: MAX_BUFFER },
      );
      if (result.status === null || result.status > 127) {
        throw new Error(`git merge-file failed: ${result.stderr.toString()}`);
      }
      return { text: result.stdout, conflicts: result.status };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Git's heuristic: a NUL byte in the first 8000 bytes means binary. */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}
