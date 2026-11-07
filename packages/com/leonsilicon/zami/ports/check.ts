import { writeEditorSettings } from "#editor";
import type { Project } from "#project";

export interface CheckResult {
  failures: string[];
  warnings: string[];
}

/**
 * The invariants CI enforces:
 *  - no upstream file is modified, deleted or renamed (Zami only adds files), except the
 *    ones zami-ports.json lists as overrides (Zami's root package.json);
 *  - every Zami file has a manifest entry and belongs to an in-scope upstream file;
 *  - no Zami file is stale or has unresolved conflict markers;
 *  - every upstream file that's copied (everything but Svelte components) has its Zami version.
 * Translated files that don't exist yet are warnings, or failures with `strict`.
 */
export function check(project: Project, options: { strict?: boolean } = {}): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const upstream = project.upstreamSha;
  const upstreamFiles = new Set(project.upstreamTree().map((entry) => entry.path));

  const committed = project.git
    .run(["diff", "--name-status", "-z", "--no-renames", upstream, "HEAD"])
    .split("\0")
    .filter((field) => field !== "");
  for (let index = 0; index < committed.length; index += 2) {
    const status = committed[index]!;
    const path = committed[index + 1]!;
    if (status !== "A" && !(status === "M" && project.config.overrides.includes(path))) {
      failures.push(
        `${path}: upstream file ${status === "D" ? "deleted" : "modified"} (status ${status}); Zami may only add files`,
      );
    }
  }
  for (const path of project.git.lines(["diff", "--name-only", "HEAD"])) {
    if (upstreamFiles.has(path) && !project.config.overrides.includes(path)) {
      failures.push(`${path}: upstream file has uncommitted changes`);
    }
  }

  const { ports, orphans, invalid } = project.scan();
  for (const problem of invalid) failures.push(`${problem.zamiPath}: ${problem.message}`);
  for (const problem of orphans) failures.push(`${problem.zamiPath}: orphan; ${problem.message}`);

  const missingTranslations: string[] = [];
  for (const port of ports) {
    const { zamiPath, upstreamPath, kind } = port.mapping;
    switch (port.status) {
      case "conflict":
        failures.push(`${zamiPath}: unresolved conflict markers`);
        break;
      case "stale":
        failures.push(
          `${zamiPath}: stale; upstream changed ${upstreamPath} after ${port.sha!.slice(0, 10)} (run \`_zami sync\`, then migrate)`,
        );
        break;
      case "missing":
        if (kind === "copy")
          failures.push(`${zamiPath}: missing (run \`_zami sync\` to create it)`);
        else missingTranslations.push(zamiPath);
        break;
      case "fresh":
        break;
    }
  }
  for (const path of writeEditorSettings(project, { check: true })) {
    failures.push(`${path}: editor settings out of date (run \`_zami editor\`)`);
  }
  if (missingTranslations.length > 0) {
    const message = `${missingTranslations.length} Svelte components have no Zami version yet (\`_zami status --list missing\`)`;
    (options.strict ? failures : warnings).push(message);
  }
  return { failures, warnings };
}
