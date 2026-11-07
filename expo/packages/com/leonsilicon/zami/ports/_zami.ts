#!/usr/bin/env node
// Keeps Zami's Expo files (`*.expo.*`) in step with upstream Zam.
//
//   _zami status [--list <status>] [--json]   coverage and freshness of every port
//   _zami sync [--since <commit>] [--dry-run] [--worklist <path>] [--summary <path>]
//                                              copy new upstream files, three-way merge
//                                              upstream changes into copies, and list
//                                              the rest (translations, conflicts) as work
//   _zami done <expo file>...                  mark files as migrated to the merged upstream commit
//   _zami diff <expo file>                     what upstream changed since the file was last synced
//   _zami check [--strict]                     CI invariants; exits 1 on failure
//   _zami backlog [--count <n>]                Svelte components ready to port (all their child
//                                              components already have Expo versions), smallest first
//   _zami fmt [--check] [files...]             Prettier, with Zam's own options, on Expo files only
//   _zami lint [files...]                      oxlint (expo/oxlint.zam-files.json) on Expo files only
//
// Run from anywhere in the repo. `--upstream <ref>` overrides the upstream ref
// (default `upstream/master`, from expo/zami-ports.json).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { parseArgs } from "node:util";
import { check } from "#check";
import { formatExpoFiles } from "#format";
import { isExpoPath } from "#paths";

/** Repo-relative Expo paths from command-line arguments; anything else is an error. */
function expoPathsFrom(args: string[]): string[] {
  const files = args.map((arg) => resolve(process.cwd(), arg).slice(project.root.length + 1));
  const notExpo = files.filter((file) => !isExpoPath(file) || file.startsWith("expo/"));
  if (notExpo.length > 0) throw new Error(`Not Expo files in Zam's tree: ${notExpo.join(", ")}`);
  return files;
}

/** Expo files whose upstream originals Zam's .prettierignore excludes (vendored code, build output). */
function zamIgnored(files: string[]): string[] {
  const result = spawnSync(
    "git",
    ["-c", "core.excludesFile=.prettierignore", "check-ignore", "--no-index", "--stdin", "-z"],
    {
      cwd: project.root,
      input: files.join("\0"),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
    },
  );
  return result.stdout.split("\0").filter((path) => path !== "");
}
import { Project, type PortStatus } from "#project";
import { markDone, summarize, sync } from "#sync";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    upstream: { type: "string" },
    "dry-run": { type: "boolean" },
    since: { type: "string" },
    worklist: { type: "string" },
    summary: { type: "string" },
    list: { type: "string" },
    json: { type: "boolean" },
    strict: { type: "boolean" },
    check: { type: "boolean" },
    count: { type: "string" },
  },
});

const [command, ...args] = positionals;
const project = new Project(
  process.cwd(),
  values.upstream === undefined ? {} : { upstream: values.upstream },
);

const writeOutput = (path: string, text: string) => {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
};

switch (command) {
  case "status": {
    const { ports, orphans, invalid } = project.scan();
    if (values.list !== undefined) {
      for (const port of ports) {
        if (port.status === (values.list as PortStatus)) console.log(port.mapping.expoPath);
      }
      break;
    }
    const counts: Record<string, Record<PortStatus, number>> = {};
    for (const port of ports) {
      counts[port.mapping.kind] ??= { fresh: 0, stale: 0, conflict: 0, missing: 0 };
      counts[port.mapping.kind]![port.status]++;
    }
    if (values.json) {
      console.log(
        JSON.stringify({ upstream: project.upstreamSha, counts, orphans, invalid }, null, 2),
      );
      break;
    }
    console.log(`Merged upstream: ${project.upstreamSha}`);
    for (const [kind, byStatus] of Object.entries(counts)) {
      const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
      const parts = Object.entries(byStatus)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${count} ${status}`);
      console.log(
        `  ${kind === "copy" ? "copies      " : "translations"}  ${total} total: ${parts.join(", ")}`,
      );
    }
    if (orphans.length > 0) console.log(`  orphans       ${orphans.length}`);
    if (invalid.length > 0) console.log(`  invalid       ${invalid.length}`);
    break;
  }
  case "sync": {
    const result = sync(project, {
      dryRun: values["dry-run"] ?? false,
      ...(values.since === undefined ? {} : { since: values.since }),
    });
    const summary = summarize(result);
    if (values.worklist !== undefined) {
      writeOutput(values.worklist, `${JSON.stringify(result, null, 2)}\n`);
    }
    if (values.summary !== undefined) writeOutput(values.summary, `${summary}\n`);
    console.log(summary);
    break;
  }
  case "done": {
    if (args.length === 0) throw new Error("Usage: _zami done <expo file>...");
    markDone(
      project,
      args.map((arg) => resolve(process.cwd(), arg).slice(project.root.length + 1)),
    );
    console.log(
      `Marked ${args.length} file(s) as synced with ${project.upstreamSha.slice(0, 10)}.`,
    );
    break;
  }
  case "diff": {
    const expoPath = resolve(process.cwd(), args[0] ?? "").slice(project.root.length + 1);
    const { ports } = project.scan();
    const port = ports.find((candidate) => candidate.mapping.expoPath === expoPath);
    if (port === undefined)
      throw new Error(`${expoPath} isn't the Expo version of an in-scope upstream file`);
    if (port.sha === null) {
      console.log(`${expoPath} doesn't exist yet; port ${port.mapping.upstreamPath} from scratch.`);
      break;
    }
    // A file upstream renamed since `sha` is listed under its old path there.
    const renamedFrom = [...project.git.changes(port.sha, project.upstreamSha)].find(
      ([, change]) => change.status === "R" && change.newPath === port.mapping.upstreamPath,
    )?.[0];
    const paths =
      renamedFrom === undefined
        ? [port.mapping.upstreamPath]
        : [renamedFrom, port.mapping.upstreamPath];
    process.stdout.write(
      project.git.run(["diff", "-M", port.sha, project.upstreamSha, "--", ...paths]),
    );
    break;
  }
  case "check": {
    const { failures, warnings } = check(project, { strict: values.strict ?? false });
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    for (const failure of failures) console.error(`error: ${failure}`);
    if (failures.length > 0) {
      console.error(`\n${failures.length} problem(s).`);
      process.exit(1);
    }
    console.log(
      `OK: synced with upstream ${project.upstreamSha.slice(0, 10)}, no upstream file modified.`,
    );
    break;
  }
  case "backlog": {
    const { ports } = project.scan();
    const statusOf = new Map(ports.map((port) => [port.mapping.upstreamPath, port.status]));
    const ready = ports
      .filter((port) => port.mapping.kind === "translate" && port.status === "missing")
      .map((port) => {
        const source = (
          project.git.show(project.upstreamSha, port.mapping.upstreamPath) ?? Buffer.alloc(0)
        ).toString("utf8");
        const children = [...source.matchAll(/from\s+["']([^"']+\.svelte)["']/g)].map(
          ([, specifier]) =>
            specifier!.startsWith("$lib/")
              ? `src/lib/${specifier!.slice("$lib/".length)}`
              : posix.join(posix.dirname(port.mapping.upstreamPath), specifier!),
        );
        return {
          path: port.mapping.upstreamPath,
          lines: source.split("\n").length,
          blocked: children.some((child) => statusOf.get(child) === "missing"),
        };
      })
      .filter((component) => !component.blocked)
      .sort((a, b) => a.lines - b.lines);
    const count = values.count === undefined ? ready.length : Number(values.count);
    for (const component of ready.slice(0, count)) console.log(component.path);
    break;
  }
  case "fmt": {
    // Zami's tooling only ever touches Expo files; Zam's own files stay exactly as upstream wrote them.
    const files = args.length > 0 ? expoPathsFrom(args) : project.expoFiles();
    const { checked, unformatted } = await formatExpoFiles(project.root, files, {
      check: values.check ?? false,
    });
    if (values.check && unformatted.length > 0) {
      for (const file of unformatted) console.error(`not formatted: ${file}`);
      process.exit(1);
    }
    console.log(
      `${values.check ? "Format-checked" : "Formatted"} ${checked} Expo files${unformatted.length > 0 && !values.check ? ` (${unformatted.length} changed)` : ""}.`,
    );
    break;
  }
  case "lint": {
    // oxlint, on the Expo files of code Zam itself lints (not what its .prettierignore skips, such as vendored static/ code).
    const requested = args.length > 0 ? expoPathsFrom(args) : project.expoFiles();
    const skipped = new Set(zamIgnored(requested));
    const files = requested.filter(
      (file) => !skipped.has(file) && /\.(js|mjs|cjs|ts|mts|cts|tsx)$/.test(file),
    );
    let failed = false;
    for (let index = 0; index < files.length; index += 400) {
      const result = spawnSync(
        join(project.root, "expo/node_modules/.bin/oxlint"),
        ["-c", "expo/oxlint.zam-files.json", ...files.slice(index, index + 400)],
        { cwd: project.root, stdio: "inherit" },
      );
      failed ||= result.status !== 0;
    }
    if (failed) process.exit(1);
    console.log(`Linted ${files.length} Expo files.`);
    break;
  }
  default:
    console.error(
      "Usage: _zami <status|sync|done|diff|check|fmt|lint> (see the comment at the top of _zami.ts)",
    );
    process.exit(command === undefined ? 0 : 1);
}
