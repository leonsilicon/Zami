import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ZAM_PATH } from "@-/com.leonsilicon.zami.paths";

export interface TreeEntry {
  mode: string;
  sha: string;
  /** The path in Zam's tree. */
  path: string;
}

function zamCheckout(root: string): string {
  const dir = join(root, ZAM_PATH);
  if (!existsSync(join(dir, ".git"))) {
    throw new Error(`Initialize upstream Zam with git submodule update --init -- ${ZAM_PATH}`);
  }
  return dir;
}

/** The Git commit pinned by Zami's index, which may contain a staged update. */
function zamRevision(root: string): string {
  return execFileSync("git", ["rev-parse", "--verify", `:${ZAM_PATH}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

/** Lists files from the pinned commit without reading the submodule's working tree. */
export function zamTree(root: string): TreeEntry[] {
  const out = execFileSync("git", ["ls-tree", "-r", "-z", zamRevision(root)], {
    cwd: zamCheckout(root),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const entries: TreeEntry[] = [];
  for (const record of out.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const [mode, type, sha] = record.slice(0, tab).split(" ");
    if (mode === undefined || type !== "blob" || sha === undefined) continue;
    entries.push({ mode, sha, path: record.slice(tab + 1) });
  }
  if (!entries.some((entry) => entry.path === "package.json")) {
    throw new Error(`${ZAM_PATH} has no package.json at the pinned commit`);
  }
  return entries.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Reads a file as it appears at the pinned commit. */
export function readZamFile(root: string, path: string): Buffer {
  return execFileSync("git", ["cat-file", "blob", `${zamRevision(root)}:${path}`], {
    cwd: zamCheckout(root),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The contents of blobs, read with one `git cat-file --batch`. */
export function readZamBlobs(root: string, shas: string[]): Map<string, Buffer> {
  const cwd = zamCheckout(root);
  const blobs = new Map<string, Buffer>();
  const unique = [...new Set(shas)];
  // In batches, so no single answer has to hold the whole tree.
  for (let start = 0; start < unique.length; start += 2000) {
    const batch = unique.slice(start, start + 2000);
    const out = execFileSync("git", ["cat-file", "--batch"], {
      cwd,
      input: `${batch.join("\n")}\n`,
      maxBuffer: 2 * 1024 * 1024 * 1024,
    });
    let offset = 0;
    for (const sha of batch) {
      const newline = out.indexOf(10, offset);
      const [, , size] = out.subarray(offset, newline).toString("utf8").split(" ");
      const length = Number(size);
      if (!Number.isFinite(length)) throw new Error(`git cat-file: no blob ${sha}`);
      blobs.set(sha, out.subarray(newline + 1, newline + 1 + length));
      offset = newline + 1 + length + 1;
    }
  }
  return blobs;
}
