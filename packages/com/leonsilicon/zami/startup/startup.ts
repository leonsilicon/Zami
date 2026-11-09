// A timeline of this launch: when each step of starting the app and restoring the session
// began, how long the JS thread was blocked at worst, and how much of the IndexedDB stand-in
// each step loaded. Each change is saved, so the next launch can show what this one did
// even if it never finished; Settings › Debug and the log export show both.

/** One step: what began, when (ms after the app's JS started), and anything worth noting. */
export interface StartupStep {
  step: string;
  at: number;
  detail?: string;
}

export interface StartupRecord {
  /** Epoch ms the app's JS started. */
  startedAt: number;
  steps: StartupStep[];
  /** The longest the JS thread went without running a timer, and the step it began in. */
  longestStall?: { ms: number; during: string };
  /** The three longest such stalls, longest first. */
  stalls?: { ms: number; during: string }[];
  /** Set once the session is up and syncing, or after the watch gave up. */
  finished?: boolean;
}

/** Running totals from the IndexedDB stand-in (react-native-indexeddb-sqlite's stats). */
export interface StartupStats {
  hydratedRecords: number;
  hydrateMs: number;
  indexBuilds: number;
  indexBuildMs: number;
}

const STORAGE_KEY = "zami:startup";
// How long the stall watch runs if the app never finishes starting.
const WATCH_MS = 180_000;
const TICK_MS = 50;

const now = (): number => performance.now();
const origin = now();
const record: StartupRecord = { startedAt: Date.now(), steps: [{ step: "Starting", at: 0 }] };
const listeners = new Set<() => void>();
let previous: StartupRecord | null | undefined;
let statsSource: (() => StartupStats) | null = null;
let lastStats: StartupStats | null = null;

let lastTick = now();
// The step running at the last tick: a stall began in it, whatever ran during the stall.
let stepAtLastTick = "Starting";
const watch: ReturnType<typeof setInterval> | null =
  typeof setInterval === "function" ? setInterval(onTick, TICK_MS) : null;

function onTick(): void {
  const t = now();
  const stall = Math.round(t - lastTick - TICK_MS);
  const during = stepAtLastTick;
  lastTick = t;
  stepAtLastTick = record.steps[record.steps.length - 1]!.step;
  if (stall >= 100) {
    const stalls = [...(record.stalls ?? []), { ms: stall, during }];
    stalls.sort((a, b) => b.ms - a.ms);
    record.stalls = stalls.slice(0, 3);
    record.longestStall = record.stalls[0];
    save();
  }
  if (t - origin > WATCH_MS) finishStartup("Gave up watching");
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPrevious(): void {
  if (previous !== undefined) return;
  previous = null;
  try {
    const saved = storage()?.getItem(STORAGE_KEY);
    if (saved) previous = JSON.parse(saved) as StartupRecord;
  } catch {
    previous = null;
  }
}

function save(): void {
  const store = storage();
  if (!store) return;
  readPrevious();
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A diagnostic: never let it break the launch.
  }
}

function statsDetail(): string | undefined {
  if (!statsSource) return undefined;
  let stats: StartupStats;
  try {
    stats = { ...statsSource() };
  } catch {
    return undefined;
  }
  const before = lastStats;
  lastStats = stats;
  if (!before) return undefined;
  const records = stats.hydratedRecords - before.hydratedRecords;
  const indexes = stats.indexBuilds - before.indexBuilds;
  const parts: string[] = [];
  if (records > 0)
    parts.push(`loaded ${records} records in ${Math.round(stats.hydrateMs - before.hydrateMs)} ms`);
  if (indexes > 0)
    parts.push(
      `built ${indexes} indexes in ${Math.round(stats.indexBuildMs - before.indexBuildMs)} ms`,
    );
  return parts.length ? parts.join(", ") : undefined;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Report where the IndexedDB stand-in's load counters come from. Each step then notes what
 * the step before it loaded.
 */
export function setStartupStatsSource(source: () => StartupStats): void {
  statsSource = source;
  lastStats = null;
  statsDetail();
}

/** Record that a step began. The step before it ends here. */
export function markStartup(step: string, detail?: string): void {
  if (record.finished) return;
  const loaded = statsDetail();
  const previousStep = record.steps[record.steps.length - 1];
  if (loaded && previousStep)
    previousStep.detail = previousStep.detail ? `${previousStep.detail}; ${loaded}` : loaded;
  record.steps.push({ step, at: Math.round(now() - origin), ...(detail ? { detail } : {}) });
  save();
  notify();
}

/** Record the last step and stop watching. Later marks are ignored. */
export function finishStartup(step = "Ready", detail?: string): void {
  if (record.finished) return;
  markStartup(step, detail);
  record.finished = true;
  if (watch) clearInterval(watch);
  save();
  notify();
}

/** The step running now, and how long the launch has taken so far (ms). */
export function currentStartupStep(): { step: string; elapsed: number; finished: boolean } {
  return {
    step: record.steps[record.steps.length - 1]!.step,
    elapsed: Math.round(now() - origin),
    finished: !!record.finished,
  };
}

export function subscribeStartup(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** This launch so far. */
export function thisStartup(): StartupRecord {
  return record;
}

/** What the launch before this one recorded, if anything. */
export function previousStartup(): StartupRecord | null {
  readPrevious();
  return previous ?? null;
}

/** The record as text, one step per line, with each step's duration. */
export function formatStartup(r: StartupRecord): string[] {
  const lines = r.steps.map((s, i) => {
    const next = r.steps[i + 1];
    const took = next ? `${next.at - s.at} ms` : r.finished ? "" : "(running)";
    const at = `${(s.at / 1000).toFixed(2)} s`.padStart(8);
    return `${at}  ${s.step}${took ? ` · ${took}` : ""}${s.detail ? ` (${s.detail})` : ""}`;
  });
  lines.unshift(`started ${new Date(r.startedAt).toISOString()}`);
  const stalls = r.stalls ?? (r.longestStall ? [r.longestStall] : []);
  for (const s of stalls) lines.push(`JS stall: ${s.ms} ms, from "${s.during}"`);
  return lines;
}
