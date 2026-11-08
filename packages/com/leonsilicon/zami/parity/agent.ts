// What the web and native agents share: the connection to the runner, its commands, and
// finding a recipe's target among the nodes a dump would report.
import { FORGOTTEN_STORAGE_PREFIXES, runStep, viewInfos } from "#views";
import * as scope from "#scope";
import type {
  AgentMessage,
  Driver,
  Dump,
  Insets,
  ParityNode,
  Rect,
  RunnerMessage,
  Side,
  Target,
} from "#protocol";

export interface Candidate<Handle> {
  node: ParityNode;
  handle: Handle;
}

export function normalizeText(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

export function matches(node: ParityNode, target: Target): boolean {
  if (target.text !== undefined) return node.key === `text:${normalizeText(target.text)}`;
  if (target.label !== undefined) return node.key === `label:${target.label}`;
  if (target.placeholder !== undefined) return node.key === `placeholder:${target.placeholder}`;
  return false;
}

export function describeTarget(target: Target): string {
  const [kind, value] =
    target.text === undefined
      ? target.label === undefined
        ? ["placeholder", target.placeholder]
        : ["label", target.label]
      : ["text", target.text];
  return `${kind} "${value}"${target.nth === undefined ? "" : ` #${target.nth}`}`;
}

/** Top to bottom, then left to right, with rows that differ by under 2 points merged. */
export function byReadingOrder<T extends { rect: Rect }>(items: T[]): T[] {
  // (Not toSorted: Hermes lacks it.)
  return [...items].sort((a, b) =>
    Math.abs(a.rect.y - b.rect.y) < 2 ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  );
}

export function pick<Handle>(
  candidates: Candidate<Handle>[],
  target: Target,
): Candidate<Handle> | undefined {
  const found = candidates.filter((candidate) => matches(candidate.node, target));
  return byReadingOrder(found.map((candidate) => ({ ...candidate, rect: candidate.node.rect })))[
    target.nth ?? 0
  ];
}

/**
 * Like pick, but among the matches a press would actually reach (`onTop`): a room's name
 * in the drawer, not the same name in the header the drawer covers. Falls back to every
 * match when none is on top.
 */
export async function pickOnTop<Handle>(
  candidates: Candidate<Handle>[],
  target: Target,
  onTop: (candidate: Candidate<Handle>) => boolean | Promise<boolean>,
): Promise<Candidate<Handle> | undefined> {
  const found = byReadingOrder(
    candidates
      .filter((candidate) => matches(candidate.node, target))
      .map((candidate) => ({ ...candidate, rect: candidate.node.rect })),
  );
  const reachable: typeof found = [];
  for (const candidate of found) if (await onTop(candidate)) reachable.push(candidate);
  return (reachable.length > 0 ? reachable : found)[target.nth ?? 0];
}

export function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right - x < 0.5 || bottom - y < 0.5) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

export function union(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function round(rect: Rect): Rect {
  const r = (value: number): number => Math.round(value * 10) / 10;
  return { x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) };
}

/** Polls `find` until it returns something, or fails after `timeoutMs`. */
export async function waitUntil(
  find: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!find()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Forgets the room and space the app would reopen, so every view starts from the same place. */
export function forgetLocation(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key !== null) keys.push(key);
    }
    for (const key of keys) {
      if (FORGOTTEN_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // No storage to forget.
  }
}

export interface AgentHost {
  side: Side;
  window(): { width: number; height: number; scale: number };
  frame(): Rect;
  insets(): Insets;
  notes?: string[];
  driver: Driver;
  dump(): Dump | Promise<Dump>;
  settle(quietMs: number, timeoutMs: number): Promise<void>;
  /** Reloads the app; the agent reconnects with a new `hello`. */
  reload(): void;
}

/** Connects to the runner and serves its commands until the app goes away. */
export function runAgent(url: string, host: AgentHost): void {
  let socket: WebSocket;
  const send = (message: AgentMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const handle = async (message: RunnerMessage): Promise<unknown> => {
    switch (message.cmd) {
      case "step": {
        await runStep(message.view, message.step, host.driver, message.data);
        return undefined;
      }
      case "session": {
        scope.saveSession(message.session);
        return undefined;
      }
      case "ready": {
        const { auth, roomsState } = scope;
        await waitUntil(
          () =>
            message.signedIn
              ? auth.isAuthenticated &&
                ["PREPARED", "SYNCING", "CATCHUP"].includes(auth.syncState) &&
                roomsState.spaces.length + roomsState.orphanRooms.length > 0
              : !auth.isAuthenticated &&
                host.driver.exists({ text: scope.t("loginView.homeserver") }),
          message.timeoutMs,
          message.signedIn ? "the app to sync" : "the app to show sign-in",
        );
        return undefined;
      }
      case "settle": {
        await host.settle(message.quietMs, message.timeoutMs);
        return undefined;
      }
      case "dump": {
        return await host.dump();
      }
      case "forget": {
        forgetLocation();
        return undefined;
      }
      case "reload": {
        forgetLocation();
        // After the reply has gone out.
        setTimeout(() => host.reload(), 100);
        return undefined;
      }
    }
  };

  const open = (): void => {
    socket = new WebSocket(`${url}?side=${host.side}`);
    socket.addEventListener("open", () => {
      send({
        type: "hello",
        side: host.side,
        window: host.window(),
        frame: host.frame(),
        insets: host.insets(),
        views: viewInfos(),
        notes: host.notes ?? [],
      });
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as RunnerMessage;
      handle(message).then(
        (result) => send({ type: "reply", id: message.id, ok: true, result }),
        (error: unknown) =>
          send({
            type: "reply",
            id: message.id,
            ok: false,
            // (WebKit's stack doesn't repeat the message.)
            error:
              error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
          }),
      );
    });
    // The runner may not be up yet, or may restart: keep trying.
    socket.addEventListener("close", () => setTimeout(open, 1000));
  };
  open();
}
