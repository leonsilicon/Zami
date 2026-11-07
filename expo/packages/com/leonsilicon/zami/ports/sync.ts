import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isBinary } from "#git";
import { mapUpstreamPath, upstreamPathForExpoPath } from "#paths";
import { hasConflictMarkers, type Project } from "#project";

/** Work the mechanical sync can't do, left for the Claude bot (or a person). */
export interface WorkItem {
  /**
   * `port`: write the first Expo version of an upstream Svelte component.
   * `migrate`: apply upstream's changes to a translated (Svelte → React Native) file.
   * `conflict`: resolve what a three-way merge couldn't: `<<<<<<< expo` markers in a text
   * file, or a binary file both Zami and upstream changed (`binary: true`).
   */
  kind: "port" | "migrate" | "conflict";
  expoPath: string;
  upstreamPath: string;
  /** The upstream commit the Expo file was last synced with (migrate and conflict). */
  from?: string;
  /** The upstream path at `from`, when upstream renamed the file since. */
  fromPath?: string;
  /** For `conflict`: a binary file, so there are no markers; pick or redo the content. */
  binary?: boolean;
  /** For `port`: upstream added the file after the `since` commit (not part of the old backlog). */
  new?: boolean;
}

export interface SyncResult {
  upstreamSha: string;
  created: string[];
  merged: string[];
  moved: { from: string; to: string }[];
  deleted: string[];
  orphans: string[];
  work: WorkItem[];
}

export function sync(
  project: Project,
  options: { dryRun?: boolean; since?: string } = {},
): SyncResult {
  const dryRun = options.dryRun ?? false;
  const upstreamSha = project.upstreamSha;
  const manifest = project.manifest;
  const addedSince = new Set<string>();
  if (options.since !== undefined) {
    for (const change of project.git
      .changes(project.git.revParse(options.since), upstreamSha)
      .values()) {
      if (change.newPath !== null && change.status !== "M") addedSince.add(change.newPath);
    }
  }
  const result: SyncResult = {
    upstreamSha,
    created: [],
    merged: [],
    moved: [],
    deleted: [],
    orphans: [],
    work: [],
  };
  const modes = new Map(project.upstreamTree().map((entry) => [entry.path, entry.mode]));
  const write = (path: string, content: Buffer, upstreamPath: string) => {
    if (dryRun) return;
    const absolute = join(project.root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    chmodSync(absolute, modes.get(upstreamPath) === "100755" ? 0o755 : 0o644);
  };

  /** Merges upstream's change into a copy; returns true when it merged cleanly. */
  const mergeCopy = (
    expoPath: string,
    sha: string,
    fromPath: string,
    ours: Buffer,
    upstreamPath: string,
  ) => {
    const base = project.git.show(sha, fromPath) ?? Buffer.alloc(0);
    const theirs = project.git.show(upstreamSha, upstreamPath) ?? Buffer.alloc(0);
    const conflict = (binary: boolean) =>
      result.work.push({
        kind: "conflict",
        expoPath,
        upstreamPath,
        from: sha,
        ...(fromPath === upstreamPath ? {} : { fromPath }),
        ...(binary ? { binary: true } : {}),
      });
    if (ours.equals(base)) {
      write(expoPath, theirs, upstreamPath);
    } else if (ours.equals(theirs)) {
      // Zami already has upstream's new content.
    } else if (isBinary(ours) || isBinary(base) || isBinary(theirs)) {
      conflict(true);
      return false;
    } else {
      const { text, conflicts } = project.git.mergeFile(ours, base, theirs);
      write(expoPath, text, upstreamPath);
      if (conflicts > 0) {
        // The manifest keeps the old commit until the markers are resolved.
        conflict(false);
        return false;
      }
    }
    manifest.set(expoPath, upstreamSha);
    result.merged.push(expoPath);
    return true;
  };

  const { ports, orphans } = project.scan();
  const movedTo = new Set<string>();

  // Expo files whose upstream file was renamed or deleted since their manifest commit.
  for (const orphan of orphans) {
    const sha = manifest.get(orphan.expoPath);
    const upstreamPath = upstreamPathForExpoPath(orphan.expoPath);
    if (sha === undefined || upstreamPath === null) {
      result.orphans.push(orphan.expoPath);
      continue;
    }
    const change = project.git.changes(sha, upstreamSha).get(upstreamPath);
    if (change?.status === "D") {
      if (!dryRun) rmSync(join(project.root, orphan.expoPath));
      manifest.delete(orphan.expoPath);
      result.deleted.push(orphan.expoPath);
      continue;
    }
    const renamed =
      change?.status === "R" && change.newPath !== null ? mapUpstreamPath(change.newPath) : null;
    if (
      renamed === null ||
      renamed.kind !== mapUpstreamPath(upstreamPath).kind ||
      !project.inScope(renamed.upstreamPath) ||
      project.read(renamed.expoPath) !== null
    ) {
      result.orphans.push(orphan.expoPath);
      continue;
    }
    const ours = project.read(orphan.expoPath)!;
    if (!dryRun) {
      mkdirSync(dirname(join(project.root, renamed.expoPath)), { recursive: true });
      renameSync(join(project.root, orphan.expoPath), join(project.root, renamed.expoPath));
    }
    manifest.delete(orphan.expoPath);
    manifest.set(renamed.expoPath, sha);
    result.moved.push({ from: orphan.expoPath, to: renamed.expoPath });
    movedTo.add(renamed.expoPath);
    if (renamed.kind === "copy") {
      mergeCopy(renamed.expoPath, sha, upstreamPath, ours, renamed.upstreamPath);
    } else {
      result.work.push({
        kind: "migrate",
        expoPath: renamed.expoPath,
        upstreamPath: renamed.upstreamPath,
        from: sha,
        fromPath: upstreamPath,
      });
    }
  }

  const toCreate: string[] = [];
  for (const port of ports) {
    const { expoPath, upstreamPath, kind } = port.mapping;
    if (movedTo.has(expoPath)) continue;
    if (port.status === "missing") {
      if (kind === "translate") {
        result.work.push({
          kind: "port",
          expoPath,
          upstreamPath,
          ...(addedSince.has(upstreamPath) ? { new: true } : {}),
        });
      } else {
        toCreate.push(upstreamPath);
      }
    } else if (port.status === "conflict") {
      result.work.push({ kind: "conflict", expoPath, upstreamPath, from: port.sha ?? upstreamSha });
    } else if (port.status === "stale" && port.sha !== null) {
      if (kind === "copy") {
        mergeCopy(expoPath, port.sha, upstreamPath, project.read(expoPath)!, upstreamPath);
      } else {
        result.work.push({ kind: "migrate", expoPath, upstreamPath, from: port.sha });
      }
    }
  }

  // New copies, read in one batch so a first sync of thousands of files stays fast.
  const blobs = project.git.readBlobs(upstreamSha, toCreate);
  for (const upstreamPath of toCreate) {
    const { expoPath } = mapUpstreamPath(upstreamPath);
    write(expoPath, blobs.get(upstreamPath) ?? Buffer.alloc(0), upstreamPath);
    manifest.set(expoPath, upstreamSha);
    result.created.push(expoPath);
  }
  if (!dryRun) {
    // Zam's .gitignore can match an Expo version's name; force-add those so they're tracked.
    const ignored = project.git.ignored(result.created);
    if (ignored.length > 0) project.git.run(["add", "--force", "--", ...ignored]);
    manifest.write(project.root);
  }
  return result;
}

/** Marks Expo files as synced with the merged upstream commit, after their changes were migrated by hand. */
export function markDone(project: Project, expoPaths: string[]): void {
  const upstreamPaths = new Set(project.mappings().map((mapping) => mapping.upstreamPath));
  for (const expoPath of expoPaths) {
    const content = project.read(expoPath);
    if (content === null) throw new Error(`${expoPath} doesn't exist`);
    const upstreamPath = upstreamPathForExpoPath(expoPath);
    if (upstreamPath === null || !upstreamPaths.has(upstreamPath)) {
      throw new Error(`${expoPath} isn't the Expo version of any in-scope upstream file`);
    }
    if (hasConflictMarkers(content))
      throw new Error(`${expoPath} still has conflict markers; resolve them first`);
    project.manifest.set(expoPath, project.upstreamSha);
  }
  project.manifest.write(project.root);
}

export function summarize(result: SyncResult): string {
  const lines = [`Synced Expo files with upstream ${result.upstreamSha.slice(0, 10)}.`, ""];
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`**${title} (${items.length})**`, "");
    const shown = items.slice(0, 50);
    for (const item of shown) lines.push(`- \`${item}\``);
    if (items.length > shown.length) lines.push(`- …and ${items.length - shown.length} more`);
    lines.push("");
  };
  section("Merged automatically", result.merged);
  section("Created (new upstream files, copied)", result.created);
  section(
    "Moved (renamed upstream)",
    result.moved.map((move) => `${move.from} → ${move.to}`),
  );
  section("Deleted (removed upstream)", result.deleted);
  section(
    "Needs migration: conflicts",
    result.work
      .filter((item) => item.kind === "conflict")
      .map((item) => item.expoPath + (item.binary ? " (binary)" : "")),
  );
  section(
    "Needs migration: translated files upstream changed",
    result.work.filter((item) => item.kind === "migrate").map((item) => item.expoPath),
  );
  const ports = result.work.filter((item) => item.kind === "port");
  section(
    "Needs porting: components upstream added",
    ports.filter((item) => item.new === true).map((item) => item.expoPath),
  );
  const backlog = ports.filter((item) => item.new !== true).length;
  if (backlog > 0) {
    lines.push(
      `${backlog} older components have no Expo version yet (the porting backlog; see \`_zami backlog\`).`,
      "",
    );
  }
  section("Orphans (no upstream file; check by hand)", result.orphans);
  return lines.join("\n");
}
