#!/usr/bin/env node
// Keeps Zami's versions of Zam's files (`*.zami.*`) in step with upstream Zam.
//
//   _zami status [--list <status>] [--json]   coverage and freshness of every port
//   _zami sync [--since <commit>] [--dry-run] [--worklist <path>] [--summary <path>]
//                                              copy new upstream files, three-way merge
//                                              upstream changes into copies, and list
//                                              the rest (translations, conflicts) as work,
//                                              and everything else upstream changed since
//                                              --since for review
//   _zami done <zami file>...                  mark files as migrated to the merged upstream commit
//   _zami diff <zami file>                     what upstream changed since the file was last synced
//   _zami remap [--dry-run]                    after upstream rewrites its history, point the
//                                              manifest's commits at upstream's rewritten copies
//   _zami check [--strict]                     CI invariants; exits 1 on failure
//   _zami editor [--check]                     editor settings that hide Zam's files (VS Code, Zed)
//   _zami backlog [--count <n>]                Svelte components ready to port (all their child
//                                              components already have Zami versions), smallest first
//
// Run from anywhere in the repo. `--upstream <ref>` overrides the upstream ref (default
// `upstream/master`, from zami-ports.json). Zami files are formatted and linted with
// Vite+ (`vp fmt`, `vp lint`, `vp check`), which the root vite.config.js scopes to them.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { parseArgs } from "node:util";
import { check } from "#check";
import { writeEditorSettings } from "#editor";
import { Project, type PortStatus } from "#project";
import { remap } from "#remap";
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
        if (port.status === (values.list as PortStatus)) console.log(port.mapping.zamiPath);
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
    if (args.length === 0) throw new Error("Usage: _zami done <zami file>...");
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
    const zamiPath = resolve(process.cwd(), args[0] ?? "").slice(project.root.length + 1);
    const { ports } = project.scan();
    const port = ports.find((candidate) => candidate.mapping.zamiPath === zamiPath);
    if (port === undefined)
      throw new Error(`${zamiPath} isn't the Zami version of an in-scope upstream file`);
    if (port.sha === null) {
      console.log(`${zamiPath} doesn't exist yet; port ${port.mapping.upstreamPath} from scratch.`);
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
  case "remap": {
    const { remapped, unmapped } = remap(project, { dryRun: values["dry-run"] ?? false });
    const pairs = new Set(
      [...remapped.values()].map(([from, to]) => `${from.slice(0, 10)} -> ${to.slice(0, 10)}`),
    );
    const commits = new Set([...remapped.values()].map(([from]) => from));
    for (const pair of pairs) console.log(pair);
    for (const [zamiPath, reason] of unmapped) console.error(`unmapped: ${zamiPath}: ${reason}`);
    console.log(
      remapped.size === 0
        ? "Every manifest commit is part of the merged upstream history."
        : `${values["dry-run"] ? "Would remap" : "Remapped"} ${remapped.size} file(s) from ${commits.size} rewritten commit(s).`,
    );
    if (unmapped.size > 0) process.exit(1);
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
    const overrides = project.config.overrides;
    console.log(
      `OK: synced with upstream ${project.upstreamSha.slice(0, 10)}; no upstream file modified${overrides.length > 0 ? ` besides Zami's overrides (${overrides.join(", ")})` : ""}.`,
    );
    break;
  }
  case "editor": {
    const stale = writeEditorSettings(project, { check: values.check ?? false });
    if (values.check && stale.length > 0) {
      for (const path of stale) console.error(`out of date: ${path}`);
      process.exit(1);
    }
    console.log(
      stale.length === 0 ? "Editor settings are up to date." : `Wrote ${stale.join(", ")}.`,
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
  default:
    console.error(
      "Usage: _zami <status|sync|done|diff|remap|check|backlog|editor> (see the comment at the top of _zami.ts)",
    );
    process.exit(command === undefined ? 0 : 1);
}
