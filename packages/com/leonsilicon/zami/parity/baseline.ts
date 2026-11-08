// The baseline: each view's known differences from Zam, so a run fails on what got worse
// (or on any difference, with --strict) while the known ones are being fixed. Update it
// with `vpx _parity --update-baseline` once a change is meant to be there.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Side } from "#protocol";
import type { Issue } from "#compare";

/** A view matches when no node differs and at most this share of its pixels does. */
export const PIXEL_BUDGET = 0.002;
/** How much more of a view's pixels may differ than in the baseline (run-to-run noise). */
export const PIXEL_SLACK = 0.003;

export interface ViewResult {
  name: string;
  /** Share of the safe area's pixels that differ, 0–1. */
  pixels: number;
  issues: Issue[];
  /** What failed in each app, or in the run itself ("runner"). */
  errors: Partial<Record<Side | "runner", string>>;
  /** The Zami components the view mounted. */
  components: string[];
  seconds: number;
}

export interface BaselineEntry {
  pixels: number;
  issues: string[];
  /** The view couldn't be shown in one of the apps. */
  error?: true;
}

export interface Baseline {
  /** The upstream commit the baseline was recorded against. */
  upstream?: string;
  views: Record<string, BaselineEntry>;
}

export type Status = "match" | "known" | "improved" | "regressed" | "new" | "error";

export interface Verdict {
  name: string;
  status: Status;
  failed: boolean;
  /** Issues the baseline doesn't list. */
  added: string[];
  /** Baseline issues that are gone. */
  fixed: string[];
}

export function readBaseline(path: string): Baseline {
  if (!existsSync(path)) return { views: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Baseline;
}

export function matches(result: ViewResult): boolean {
  return (
    Object.keys(result.errors).length === 0 &&
    result.issues.length === 0 &&
    result.pixels <= PIXEL_BUDGET
  );
}

export function judge(
  result: ViewResult,
  base: BaselineEntry | undefined,
  strict: boolean,
): Verdict {
  const ids = result.issues.map((issue) => issue.id);
  const errored = Object.keys(result.errors).length > 0;
  const added = base === undefined ? ids : ids.filter((id) => !base.issues.includes(id));
  const fixed = base === undefined ? [] : base.issues.filter((id) => !ids.includes(id));
  const verdict = (status: Status, failed: boolean): Verdict => ({
    name: result.name,
    status,
    failed,
    added,
    fixed,
  });

  if (matches(result)) return verdict("match", false);
  if (base === undefined) return verdict(errored ? "error" : "new", true);
  if (errored && base.error !== true) return verdict("error", true);
  const regressed = added.length > 0 || result.pixels > base.pixels + PIXEL_SLACK;
  if (regressed) return verdict("regressed", true);
  const improved = fixed.length > 0 || result.pixels < base.pixels - PIXEL_SLACK;
  return verdict(improved ? "improved" : "known", strict);
}

/** Records this run's results for the views it ran, keeping the others' entries. */
export function writeBaseline(
  path: string,
  upstream: string,
  results: ViewResult[],
  previous: Baseline,
): void {
  const views = { ...previous.views };
  for (const result of results) {
    if (matches(result)) {
      delete views[result.name];
      continue;
    }
    views[result.name] = {
      pixels: Math.round(result.pixels * 10_000) / 10_000,
      issues: result.issues.map((issue) => issue.id).toSorted(),
      ...(Object.keys(result.errors).length > 0 ? { error: true as const } : {}),
    };
  }
  const sorted = Object.fromEntries(
    Object.entries(views).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(path, `${JSON.stringify({ upstream, views: sorted }, null, 2)}\n`);
}
