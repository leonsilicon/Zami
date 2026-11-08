// What the runner and the two in-app agents say to each other over the runner's WebSocket.
// "zam" is upstream Zam's web build in a WebView; "zami" is the Zami app. Both agents
// implement the same commands, so one view recipe (views.ts) drives either.

export type Side = "zam" | "zami";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What a recipe's `app` calls look for: one of text, label or placeholder. */
export interface Target {
  /** A text block's whole text, as written (before any CSS `text-transform`). */
  text?: string;
  /** `aria-label` on the web, `accessibilityLabel` in React Native. */
  label?: string;
  /** A text field's placeholder. */
  placeholder?: string;
  /** Which match, in reading order (0 by default). */
  nth?: number;
}

/** How a recipe acts on the app it runs in. Each agent implements it for its platform. */
export interface Driver {
  readonly side: Side;
  /** Presses the element (its nearest pressable ancestor). Fails if there's none. */
  press(target: Target): Promise<void>;
  longPress(target: Target): Promise<void>;
  /** Replaces a text field's value. */
  fill(target: Target, value: string): Promise<void>;
  /** Resolves once the target is on screen; fails after `timeoutMs` (default 10 s). */
  waitFor(target: Target, timeoutMs?: number): Promise<void>;
  exists(target: Target): boolean;
  sleep(ms: number): Promise<void>;
}

/** A thing on screen that can be paired with its counterpart in the other app. */
export interface ParityNode {
  kind: "text" | "control" | "input";
  /** Pairs nodes across the apps: `text:…`, `label:…` or `placeholder:…`. */
  key: string;
  /** Window coordinates in points (CSS pixels), clipped to what's visible. */
  rect: Rect;
  /** For text: where its glyphs sit in `rect`. */
  align?: "left" | "center" | "right";
  /** For text: lines it wraps to (rect height / line height, rounded). */
  lines?: number;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
}

export interface Dump {
  nodes: ParityNode[];
  /** Component names mounted (Zami only): which translations the view exercised. */
  components?: string[];
}

/** What the runner seeded the homeserver with, for recipes to navigate by. */
export interface SeedData {
  homeserverUrl: string;
  userId: string;
  password: string;
  users: Record<string, string>;
  rooms: Record<string, string>;
  events: Record<string, string>;
}

/** A view the agent can show, as listed in its `hello`. */
export interface ViewInfo {
  name: string;
  signedIn: boolean;
  steps: number;
}

export type Command =
  | { cmd: "step"; view: string; step: number; data: SeedData }
  | { cmd: "session"; session: ParitySession }
  /** Waits until the app has restored its session and synced (or shows sign-in). */
  | { cmd: "ready"; signedIn: boolean; timeoutMs: number }
  | { cmd: "settle"; quietMs: number; timeoutMs: number }
  | { cmd: "dump" }
  /** Forgets the room the app would reopen (before the runner relaunches it). */
  | { cmd: "forget" }
  /** Reloads the page (Zam) after forgetting the last room. */
  | { cmd: "reload" };

/** A signed-in session the runner created for the app, saved as Zam's own sign-in does. */
export interface ParitySession {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

export type AgentMessage =
  | {
      type: "hello";
      side: Side;
      /** The window (the WebView's viewport for Zam) in points, and the screen's scale. */
      window: { width: number; height: number; scale: number };
      /** Where the agent's content sits on screen: the WebView's frame for Zam. */
      frame: Rect;
      insets: Insets;
      views: ViewInfo[];
      /** Anything the agent wants the runner to report. */
      notes: string[];
    }
  | { type: "reply"; id: number; ok: true; result?: unknown }
  | { type: "reply"; id: number; ok: false; error: string }
  | { type: "log"; message: string };

export type RunnerMessage = { id: number } & Command;

/** The launch arguments (iOS user defaults) the runner starts the app with. */
export const LAUNCH_ARGS = {
  /** "reference" (Zam's web build in a WebView) or "native" (the Zami app). */
  mode: "ZamiParity",
  runner: "ZamiParityRunner",
  referenceUrl: "ZamiParityReferenceUrl",
} as const;

/** Set on the WebView's window before Zam's code runs. */
export interface WebParityConfig {
  runner: string;
  frame: Rect;
  insets: Insets;
  scale: number;
}
