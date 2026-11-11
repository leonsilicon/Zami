// A timeline of this launch: when each step of starting the app and restoring the session
// began, how long the JS thread was blocked at worst, and how much of the IndexedDB stand-in
// each step loaded. Each change is saved, so the next launch can show what this one did
// even if it never finished; Settings › Debug and the log export show both.
//
// Once the launch is over, a slower watch keeps going for the rest of the session: it keeps
// the longest stalls of the JS thread, each with what the app was showing before and after
// it (`setStallContext`) and how much IndexedDB work ran meanwhile.

/** One step: what began, when (ms after the app's JS started), and anything worth noting. */
export interface StartupStep {
  step: string;
  at: number;
  detail?: string;
}

/** A stall after the launch: how long, when it ended (ms after the app's JS started), and where. */
export interface SessionStall {
  ms: number;
  at: number;
  /** What the app was doing before the stall, and after it if that differs. */
  context: string;
  /** IndexedDB work that ran during it, if any. */
  idb?: string;
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
  /** After the launch: the longest stalls, longest first, and how many there were in all. */
  sessionStalls?: SessionStall[];
  sessionStallCount?: number;
  sessionStalledMs?: number;
}

/** Running totals from the IndexedDB stand-in (react-native-indexeddb-sqlite's stats). */
export interface StartupStats {
  hydratedRecords: number;
  hydrateMs: number;
  indexBuilds: number;
  indexBuildMs: number;
  /** Transactions written to SQLite. */
  commits?: number;
  /** fake-indexeddb tasks run (requests, commits). */
  idbTasks?: number;
}

const STORAGE_KEY = "zami:startup";
// How long the stall watch runs if the app never finishes starting.
const WATCH_MS = 180_000;
const TICK_MS = 50;
// After the launch: a timer this often, and a stall is a timer this much late or more.
const SESSION_TICK_MS = 200;
const SESSION_STALL_MS = 50;
const SESSION_STALLS_KEPT = 10;
// Later than this, the app was suspended (in the background), not stalled.
const SUSPENDED_MS = 30_000;
// How long after a new stall is recorded the record is saved.
const SAVE_DELAY_MS = 2_000;

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

function readStats(): StartupStats | null {
  if (!statsSource) return null;
  try {
    return { ...statsSource() };
  } catch {
    return null;
  }
}

function statsDetail(): string | undefined {
  if (!statsSource) return undefined;
  const stats = readStats();
  if (!stats) return undefined;
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
  startSessionWatch();
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

// ---- After the launch: the session's longest stalls. ----

let stallContext: (() => string) | null = null;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
let sessionActive = true;
let sessionStarted = false;
// When the pending timer is due, the context and IndexedDB counters at the tick before.
let due = 0;
let contextBefore = "";
let idbBefore: StartupStats | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Describes what the app is doing (the screen, the open room), for the stalls recorded after
 * the launch. Called a few times a second, so keep it cheap.
 */
export function setStallContext(context: () => string): void {
  stallContext = context;
}

/**
 * Pauses the stall watch while the app is in the background (a suspended app isn't stalled),
 * and resumes it when it's back.
 */
export function setStallWatchActive(active: boolean): void {
  if (active === sessionActive) return;
  sessionActive = active;
  if (!sessionStarted) return;
  if (active) scheduleSessionTick();
  else if (sessionTimer !== null) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
}

function describe(): string {
  if (!record.finished) return record.steps[record.steps.length - 1]!.step;
  if (!stallContext) return "";
  try {
    return stallContext();
  } catch {
    return "";
  }
}

function idbDuring(before: StartupStats | null, after: StartupStats | null): string | undefined {
  if (!before || !after) return undefined;
  const parts: string[] = [];
  const tasks = (after.idbTasks ?? 0) - (before.idbTasks ?? 0);
  const commits = (after.commits ?? 0) - (before.commits ?? 0);
  const records = after.hydratedRecords - before.hydratedRecords;
  const indexes = after.indexBuilds - before.indexBuilds;
  if (tasks > 0) parts.push(`${tasks} tasks`);
  if (commits > 0) parts.push(`${commits} commits`);
  if (records > 0) parts.push(`loaded ${records} records`);
  if (indexes > 0) parts.push(`built ${indexes} indexes`);
  return parts.length ? parts.join(", ") : undefined;
}

function scheduleSessionTick(): void {
  if (typeof setTimeout !== "function" || sessionTimer !== null) return;
  due = now() + SESSION_TICK_MS;
  contextBefore = describe();
  idbBefore = readStats();
  sessionTimer = setTimeout(onSessionTick, SESSION_TICK_MS);
}

function onSessionTick(): void {
  sessionTimer = null;
  if (!sessionActive) return;
  const late = Math.round(now() - due);
  if (late >= SESSION_STALL_MS && late < SUSPENDED_MS) {
    const after = describe();
    const idb = idbDuring(idbBefore, readStats());
    recordSessionStall({
      ms: late,
      at: Math.round(now() - origin),
      context: after === contextBefore ? contextBefore : `${contextBefore} → ${after}`,
      ...(idb ? { idb } : {}),
    });
  }
  scheduleSessionTick();
}

function recordSessionStall(stall: SessionStall): void {
  record.sessionStallCount = (record.sessionStallCount ?? 0) + 1;
  record.sessionStalledMs = (record.sessionStalledMs ?? 0) + stall.ms;
  const kept = record.sessionStalls ?? [];
  if (kept.length < SESSION_STALLS_KEPT || stall.ms > kept[kept.length - 1]!.ms) {
    kept.push(stall);
    kept.sort((a, b) => b.ms - a.ms);
    record.sessionStalls = kept.slice(0, SESSION_STALLS_KEPT);
    notify();
  }
  // The counts change with every stall; save them now and then, not each time.
  if (saveTimer === null && typeof setTimeout === "function") {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, SAVE_DELAY_MS);
  }
}

function startSessionWatch(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  if (sessionActive) scheduleSessionTick();
}

// ---- Text. ----

/** The stalls after the launch, longest first, one per line. */
export function formatSessionStalls(r: StartupRecord): string[] {
  const stalls = r.sessionStalls ?? [];
  if (!stalls.length) return [];
  const lines = [
    `stalls after launch: ${r.sessionStallCount ?? stalls.length}, ${r.sessionStalledMs ?? 0} ms in all; longest:`,
  ];
  for (const s of stalls) {
    const at = `${(s.at / 1000).toFixed(1)} s`;
    lines.push(
      `  ≥${s.ms} ms at ${at}${s.context ? `, ${s.context}` : ""}${s.idb ? ` (IndexedDB: ${s.idb})` : ""}`,
    );
  }
  return lines;
}

/**
 * The record as text, one step per line, with each step's duration, then (unless
 * `sessionStalls` is false) the longest stalls after the launch.
 */
export function formatStartup(
  r: StartupRecord,
  options: { sessionStalls?: boolean } = {},
): string[] {
  const lines = r.steps.map((s, i) => {
    const next = r.steps[i + 1];
    const took = next ? `${next.at - s.at} ms` : r.finished ? "" : "(running)";
    const at = `${(s.at / 1000).toFixed(2)} s`.padStart(8);
    return `${at}  ${s.step}${took ? ` · ${took}` : ""}${s.detail ? ` (${s.detail})` : ""}`;
  });
  lines.unshift(`started ${new Date(r.startedAt).toISOString()}`);
  const stalls = r.stalls ?? (r.longestStall ? [r.longestStall] : []);
  for (const s of stalls) lines.push(`JS stall: ${s.ms} ms, from "${s.during}"`);
  if (options.sessionStalls !== false) lines.push(...formatSessionStalls(r));
  return lines;
}
