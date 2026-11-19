// Web contexts: pages running out of sight in WebViews, for what Hermes lacks and a
// browser engine has (WebAssembly, Workers, canvas, WebGL, WebCodecs). This module is the
// app's end of one and the list of the open ones; `PluginWebHost` (#web-host) shows a
// WebView for each. Nothing here imports React Native, so the protocol runs in Node
// against the page's own script (#web-bridge).
import type { Disposable, WebContext, WebContextOptions } from "#types";
import { bridgeScripts, deliveryScripts, PAGE_CHANNEL, withBridge } from "#web-bridge";
import { codec } from "#web-codec";

/** Zami's page origin (@-/com.leonsilicon.zami.sveltekit): what a context's page is
 *  loaded at unless it names its own, so its requests have a real origin. */
export const DEFAULT_BASE_URL = "https://zami.invalid/";

const EMPTY_PAGE = '<!doctype html><meta charset="utf-8"><title>Zami web context</title>';

/** One named stream of messages between the app and a context's page. */
export interface WebChannel {
  /** Copies `message` to the page (throws for what can't be copied, as `postMessage`). */
  post: (message: unknown) => void;
  onMessage: (handler: (message: unknown) => void) => Disposable;
}

/** A web context with what the rest of this package builds on (#worker). */
export interface OpenWebContext extends WebContext {
  readonly id: number;
  /** Why it is closed, or null while it's open. */
  readonly closed: string | null;
  /** Called once when the context closes: disposed, or its page's process is gone. */
  onClose(handler: (reason: string) => void): Disposable;
  /** A channel of the page's `__zamiBridge` (`on(name, handler)`, `emit(name, value)`). */
  channel(name: string): WebChannel;
}

/** The WebView showing a context's page, as the context sees it. */
export interface WebContextHost {
  /** Runs `script` in the page, after everything injected before it. */
  inject(script: string): void;
}

/** A context, as the WebView showing its page reports to it. */
export interface WebContextPage {
  /** A string the page posted over the WebView's bridge. */
  message(data: string): void;
  /** A document started loading in the page's main frame. */
  loading(): void;
  /** The page can't go on: it failed to load, or its process is gone. */
  terminated(reason: string): void;
  /** The WebView is gone (unmounted): so is the page, with everything in it. */
  detach(): void;
}

/** What the host needs to show a context's page. Its fields never change. */
export interface WebContextRecord {
  readonly id: number;
  /** For logs: whose context it is. */
  readonly label: string;
  readonly source: { html: string; baseUrl: string } | { uri: string };
  /** Runs before the page's content loads. */
  readonly install: string;
  /** Runs once the page has loaded. */
  readonly start: string;
  /**
   * The WebView showing the page reports for duty. `mount` is that WebView's identity:
   * the same object when the same WebView attaches again (an effect that re-ran), another
   * for a new WebView, whose fresh page is not the one this context was talking to.
   */
  attach(host: WebContextHost, mount: object): WebContextPage;
}

export interface OpenWebContextInternals {
  /** For logs: whose context it is (a plugin's id). */
  label?: string;
  /** The `console` levels of the page the app's console also gets. */
  forwardLogs?: readonly string[];
}

let records: readonly WebContextRecord[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function setRecords(next: readonly WebContextRecord[]): void {
  records = next;
  for (const listener of listeners) listener();
}

/** The open contexts: the same array until one opens or closes. */
export function webContexts(): readonly WebContextRecord[] {
  return records;
}

export function subscribeWebContexts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function closedError(reason: string): Error {
  return new Error(`The web context is closed: ${reason}.`);
}

/** In development every level of the page's console reaches Metro's; a release build
 *  has nowhere to show more than what went wrong. */
function defaultLogLevels(): readonly string[] {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  return dev ? ["debug", "log", "info", "warn", "error"] : ["warn", "error"];
}

type LogLevel = "debug" | "log" | "info" | "warn" | "error";
const LOG_LEVELS = new Set<string>(["debug", "log", "info", "warn", "error"]);

/**
 * Opens a web context. It works at once: what's sent before a WebView shows the page
 * (`PluginWebHost` may not have mounted yet) and before the page is ready waits, in order.
 */
export function openWebContext(
  options: WebContextOptions = {},
  internals: OpenWebContextInternals = {},
): OpenWebContext {
  const id = nextId++;
  const label = internals.label ?? `#${id}`;
  const scripts = bridgeScripts(options.script, internals.forwardLogs ?? defaultLogLevels());

  let host: WebContextHost | null = null;
  let mounted: object | null = null;
  let detaching: ReturnType<typeof setTimeout> | null = null;
  let ready = false;
  let closed: string | null = null;
  /** Packets (as JSON) for the page, until it is ready for them. */
  let outbox: string[] = [];
  let partSequence = 0;
  let nextCall = 1;
  const calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: unknown) => void }
  >();
  const incomingParts = new Map<number, string[]>();
  const channels = new Map<string, Set<(message: unknown) => void>>();
  const closeHandlers = new Set<(reason: string) => void>();

  // `ready` settles once: with the first page's load, or with the context's close.
  const readiness: { settle: ((failure: { error: unknown } | null) => void) | null } = {
    settle: null,
  };
  const readyPromise = new Promise<void>((resolve, reject) => {
    readiness.settle = (failure) => {
      readiness.settle = null;
      if (failure === null) resolve();
      else reject(failure.error);
    };
  });
  // A plugin that never awaits `ready` shouldn't get an unhandled rejection for it.
  readyPromise.catch(() => {});

  const deliver = (text: string): void => {
    if (host === null) return;
    for (const script of deliveryScripts(text, ++partSequence)) host.inject(script);
  };
  const send = (packet: Record<string, unknown>): void => {
    const text = JSON.stringify(packet);
    if (ready && host !== null) deliver(text);
    else outbox.push(text);
  };

  const rejectCalls = (error: Error): void => {
    const waiting = [...calls.values()];
    calls.clear();
    for (const call of waiting) call.reject(error);
  };

  const close = (reason: string): void => {
    if (closed !== null) return;
    closed = reason;
    ready = false;
    host = null;
    if (detaching !== null) clearTimeout(detaching);
    detaching = null;
    outbox = [];
    incomingParts.clear();
    setRecords(records.filter((entry) => entry.id !== id));
    const error = closedError(reason);
    readiness.settle?.({ error });
    rejectCalls(error);
    channels.clear();
    const handlers = [...closeHandlers];
    closeHandlers.clear();
    for (const handler of handlers) {
      try {
        handler(reason);
      } catch (thrown) {
        console.error(`[zami web context ${label}] a close handler threw`, thrown);
      }
    }
  };

  const pageReady = (failure: { error: unknown } | null): void => {
    ready = true;
    readiness.settle?.(failure);
    const waiting = outbox;
    outbox = [];
    for (const text of waiting) deliver(text);
  };

  const receive = (packet: Record<string, unknown>): void => {
    switch (packet.k) {
      case "ready":
        pageReady("e" in packet ? { error: codec().decode(packet.e) } : null);
        break;
      case "ret":
      case "thr": {
        const call = calls.get(packet.id as number);
        if (call === undefined) break;
        calls.delete(packet.id as number);
        if (packet.k === "ret") call.resolve(codec().decode(packet.v));
        else call.reject(codec().decode(packet.e));
        break;
      }
      case "msg": {
        const handlers = channels.get(String(packet.c));
        if (handlers === undefined || handlers.size === 0) break;
        const message = codec().decode(packet.v);
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (thrown) {
            console.error(`[zami web context ${label}] a message handler threw`, thrown);
          }
        }
        break;
      }
      case "log": {
        const level = LOG_LEVELS.has(String(packet.l)) ? (packet.l as LogLevel) : "log";
        console[level](`[zami web context ${label}]`, ...(Array.isArray(packet.a) ? packet.a : []));
        break;
      }
      default:
        break;
    }
  };

  const page: WebContextPage = {
    message(data) {
      if (closed !== null) return;
      try {
        let packet = JSON.parse(data) as Record<string, unknown>;
        if (packet.k === "part") {
          const sequence = packet.q as number;
          const parts = incomingParts.get(sequence) ?? [];
          parts[packet.i as number] = packet.d as string;
          incomingParts.set(sequence, parts);
          if (packet.i !== (packet.n as number) - 1) return;
          incomingParts.delete(sequence);
          packet = JSON.parse(parts.join("")) as Record<string, unknown>;
        }
        receive(packet);
      } catch (thrown) {
        console.error(`[zami web context ${label}] couldn't read a message from its page`, thrown);
      }
    },
    loading() {
      // A new document in a page that was ready: the old one is gone, and what it was
      // asked will never be answered. What's sent from here on waits for the new one.
      if (closed !== null || !ready) return;
      ready = false;
      rejectCalls(new Error("The web context's page was reloaded."));
    },
    terminated(reason) {
      close(reason);
    },
    detach() {
      if (closed !== null) return;
      host = null;
      // Closed on the next turn, unless the same WebView attaches again first (its
      // effect only re-ran): then the page is still there.
      detaching ??= setTimeout(() => close("its page was removed"), 0);
    },
  };

  const record: WebContextRecord = {
    id,
    label,
    source:
      options.url !== undefined
        ? { uri: options.url }
        : {
            html: withBridge(options.html ?? EMPTY_PAGE, scripts.install),
            baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
          },
    install: scripts.install,
    start: scripts.start,
    attach(attached, mount) {
      if (closed !== null) return page;
      if (mounted !== null && mounted !== mount) {
        // Another WebView, so another page: the one this context was talking to is gone.
        close("its page was removed");
        return page;
      }
      mounted = mount;
      if (detaching !== null) clearTimeout(detaching);
      detaching = null;
      host = attached;
      if (ready) {
        const waiting = outbox;
        outbox = [];
        for (const text of waiting) deliver(text);
      }
      return page;
    },
  };

  // (Arrow functions: a plugin may pass `context.post` around on its own.)
  const channel = (name: string): WebChannel => ({
    post: (message) => {
      if (closed !== null) return;
      send({ k: "msg", c: name, v: codec().encode(message) });
    },
    onMessage: (handler) => {
      if (closed !== null) return { dispose() {} };
      let handlers = channels.get(name);
      if (handlers === undefined) channels.set(name, (handlers = new Set()));
      // A handler added twice is called twice, and each registration is undone alone.
      const registered = (message: unknown) => handler(message);
      handlers.add(registered);
      return {
        dispose() {
          handlers.delete(registered);
        },
      };
    },
  });
  const pageChannel = channel(PAGE_CHANNEL);

  setRecords([...records, record]);

  return {
    id,
    get closed() {
      return closed;
    },
    ready: readyPromise,
    run<T = unknown>(source: string, ...args: unknown[]): Promise<T> {
      if (closed !== null) return Promise.reject(closedError(closed));
      let encoded: unknown;
      try {
        encoded = codec().encode(args);
      } catch (thrown) {
        return Promise.reject(thrown);
      }
      return new Promise<T>((resolve, reject) => {
        const call = nextCall++;
        calls.set(call, { resolve: resolve as (value: unknown) => void, reject });
        send({ k: "run", id: call, s: String(source), a: encoded });
      });
    },
    post: pageChannel.post,
    onMessage: pageChannel.onMessage,
    onClose(handler) {
      if (closed !== null) return { dispose() {} };
      closeHandlers.add(handler);
      return {
        dispose() {
          closeHandlers.delete(handler);
        },
      };
    },
    channel,
    dispose() {
      close("it was disposed");
    },
  };
}
