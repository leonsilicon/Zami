// `Worker` for plugins: React Native has no Web Workers (and Hermes no WebAssembly for one
// to run), so a plugin's workers are real ones in a web context's page (#web-context),
// with this class as their handle in the app.
//
// One plugin's workers share one page. A WebView is a process of its own on iOS, tens of
// megabytes each, where a worker in a page is a thread; and a page per plugin, rather than
// one for all of them, keeps one plugin's crash, or its unloading, to itself. The page is
// opened by the first worker and closed a while after the last one is terminated.
import { fileFromUri } from "@-/com.leonsilicon.zami.blob/files";
import type { Disposable } from "#types";
import { codec } from "#web-codec";
import { openWebContext, type OpenWebContext, type WebChannel } from "#web-context";
import { WORKER_CHANNEL, WORKER_PAGE_SOURCE, type WorkerEnvelope } from "#web-worker-page";

/** Who the workers belong to (a plugin's host): `track` registers what its unloading undoes. */
export interface WorkerOwner {
  track(disposable: Disposable): Disposable;
}

export interface WorkerClassOptions {
  /** For logs: whose workers they are (a plugin's id). */
  label?: string;
  /** How long the page outlives its last worker, in case another follows. */
  idleMs?: number;
  /** Opens the workers' page (the tests' seam). */
  open?: typeof openWebContext;
  /** Reads a worker's script (the tests' seam). */
  readText?: (url: string) => Promise<string>;
}

/** What a listener gets: the fields of the browser's MessageEvent and ErrorEvent that
 *  a worker's events carry. */
export interface WorkerEvent {
  readonly type: string;
  target: unknown;
  currentTarget: unknown;
  readonly cancelable: boolean;
  defaultPrevented: boolean;
  readonly timeStamp: number;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  /** `message`: what the worker posted. */
  readonly data?: unknown;
  /** `error`: what went wrong, and where in the worker's script. */
  readonly message?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly error?: unknown;
}

type Listener = ((event: WorkerEvent) => void) | { handleEvent(event: WorkerEvent): void };
type Handler = ((event: WorkerEvent) => void) | null;

/** The text of a `data:` URL. */
function dataUrlText(url: string): string {
  const comma = url.indexOf(",");
  if (comma === -1) throw new TypeError("Not a data: URL");
  const data = url.slice(comma + 1);
  if (!/;base64$/i.test(url.slice(5, comma))) return decodeURIComponent(data);
  // The codec's base64 reader: the same bytes a page would get.
  const bytes = codec().decode({ $: "b", v: decodeURIComponent(data) }) as ArrayBuffer;
  return new TextDecoder().decode(bytes);
}

/**
 * A worker script's text. The app reads it, whatever URL names it: a file (what Zami's
 * `URL.createObjectURL` gives for a Blob, so `zam.assets.url()` too), a `data:` URL, or
 * one on the network, where the app's requests aren't bound by a page's same-origin rule
 * or put off by a `text/plain` type (GitHub's raw files).
 */
async function readScript(url: string): Promise<string> {
  if (/^data:/i.test(url)) return dataUrlText(url);
  if (/^file:/i.test(url)) return fileFromUri(url).text();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const stoppedEvents = new WeakSet<object>();

function workerEvent(type: string, fields: Partial<WorkerEvent>): WorkerEvent {
  const event: WorkerEvent = {
    type,
    target: null,
    currentTarget: null,
    cancelable: type === "error",
    defaultPrevented: false,
    timeStamp: Date.now(),
    preventDefault() {
      if (event.cancelable) event.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {
      stoppedEvents.add(event);
    },
    ...fields,
  };
  return event;
}

interface WorkerState {
  id: number;
  channel: WebChannel;
  context: OpenWebContext;
  terminated: boolean;
  listeners: Map<string, Map<Listener, { once: boolean }>>;
}

/**
 * A `Worker` class for one owner (a plugin): the browser's `Worker`, each instance a real
 * Web Worker in a page the class's instances share. The script may be named by a file
 * URL, a `blob:` or `data:` URL, an `http(s):` URL or a `URL` object, and is run from its
 * text (so a relative import inside it has nothing to resolve against: import absolute
 * URLs). Messages are copied both ways (#web-codec; a transfer list is accepted, and what
 * it names is copied too). When the owner's work is undone (`track`), every worker is
 * terminated, the page is closed, and the class makes no more.
 */
export function createWorkerClass(
  owner?: WorkerOwner,
  options: WorkerClassOptions = {},
): typeof Worker {
  const open = options.open ?? openWebContext;
  const readText = options.readText ?? readScript;
  const idleMs = options.idleMs ?? 10_000;
  const label = options.label === undefined ? "workers" : `${options.label} (workers)`;

  const states = new WeakMap<object, WorkerState>();
  const live = new Map<number, PluginWorker>();
  let page: { context: OpenWebContext; channel: WebChannel } | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  let unloaded = false;

  const stateOf = (worker: object): WorkerState => {
    const state = states.get(worker);
    if (state === undefined) throw new TypeError("Illegal invocation");
    return state;
  };

  const dispatch = (worker: PluginWorker, event: WorkerEvent): boolean => {
    const state = stateOf(worker);
    try {
      event.target = worker;
      event.currentTarget = worker;
    } catch {
      // An event of the caller's own making (dispatchEvent) may not let them be set.
    }
    const call = (listener: Listener) => {
      try {
        if (typeof listener === "function") listener.call(worker, event);
        else listener.handleEvent(event);
      } catch (thrown) {
        // As a browser does with a listener's exception: report it, go on to the next.
        console.error(`[zami ${label}] a worker's ${event.type} listener threw`, thrown);
      }
    };
    const handler = (worker as unknown as Record<string, Handler | undefined>)[`on${event.type}`];
    let handled = typeof handler === "function";
    if (typeof handler === "function") call(handler);
    // The listeners as they are now: one added while the event is dispatched isn't called.
    for (const [listener, { once }] of Array.from(state.listeners.get(event.type) ?? [])) {
      if (stoppedEvents.has(event)) break;
      if (once) state.listeners.get(event.type)?.delete(listener);
      handled = true;
      call(listener);
    }
    // An error nobody listens for would otherwise vanish with the page nobody sees.
    if (event.type === "error" && !handled)
      console.error(`[zami ${label}] uncaught error in a worker: ${event.message ?? ""}`);
    return !event.defaultPrevented;
  };

  /** The worker is gone without having been terminated: it couldn't start, or its page closed. */
  const lose = (worker: PluginWorker, message: string): void => {
    const state = stateOf(worker);
    if (state.terminated) return;
    state.terminated = true;
    live.delete(state.id);
    dispatch(worker, workerEvent("error", { message, filename: "", lineno: 0, colno: 0 }));
    rest();
  };

  const receive = (envelope: WorkerEnvelope): void => {
    const worker = live.get(envelope.id);
    if (worker === undefined) return;
    if (envelope.t === "m") dispatch(worker, workerEvent("message", { data: envelope.d }));
    else if (envelope.t === "me") dispatch(worker, workerEvent("messageerror", { data: null }));
    else if (envelope.t === "e") {
      if (envelope.fatal === true) lose(worker, envelope.m);
      else
        dispatch(
          worker,
          workerEvent("error", {
            message: envelope.m,
            filename: envelope.f ?? "",
            lineno: envelope.l ?? 0,
            colno: envelope.c ?? 0,
            error: null,
          }),
        );
    }
  };

  const closePage = (): void => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    const current = page;
    page = null;
    current?.context.dispose();
  };

  /** With no worker left, the page closes after a while. */
  function rest(): void {
    if (live.size > 0 || page === null || idle !== null) return;
    idle = setTimeout(() => {
      idle = null;
      if (live.size === 0) closePage();
    }, idleMs);
  }

  const ensurePage = (): { context: OpenWebContext; channel: WebChannel } => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    if (page !== null && page.context.closed === null) return page;
    const context = open({}, { label });
    const channel = context.channel(WORKER_CHANNEL);
    const opened = { context, channel };
    page = opened;
    channel.onMessage((message) => receive(message as WorkerEnvelope));
    context.onClose((reason) => {
      if (page === opened) page = null;
      for (const worker of live.values()) {
        if (stateOf(worker).context === context)
          lose(worker, `The worker's page is closed: ${reason}.`);
      }
    });
    // Sets up the page's end. If the page closes first, the handler above has told the
    // workers; the rejection has nothing to add.
    context.run(WORKER_PAGE_SOURCE).catch(() => {});
    return opened;
  };

  class PluginWorker {
    onmessage: Handler = null;
    onmessageerror: Handler = null;
    onerror: Handler = null;

    constructor(url: string | URL, workerOptions?: WorkerOptions) {
      if (arguments.length === 0)
        throw new TypeError("Failed to construct 'Worker': 1 argument required.");
      if (unloaded) throw new Error("This plugin was unloaded: its workers are gone.");
      const href = String(url);
      const { context, channel } = ensurePage();
      const id = nextId++;
      const state: WorkerState = { id, channel, context, terminated: false, listeners: new Map() };
      states.set(this, state);
      live.set(id, this);
      const announce: WorkerEnvelope = {
        id,
        t: "new",
        o: {
          type: workerOptions?.type === "module" ? "module" : "classic",
          name: String(workerOptions?.name ?? ""),
          ...(workerOptions?.credentials !== undefined && {
            credentials: workerOptions.credentials,
          }),
        },
      };
      // Announced now, so the messages posted while the script is being read wait in the
      // page, in order, for the worker that will run it.
      channel.post(announce);
      readText(href).then(
        (text) => {
          if (!state.terminated) channel.post({ id, t: "src", s: text } satisfies WorkerEnvelope);
        },
        (error: unknown) => {
          if (state.terminated) return;
          channel.post({ id, t: "x" } satisfies WorkerEnvelope);
          lose(
            this,
            `Couldn't load the worker's script (${href.slice(0, 200)}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      );
    }

    /** Copies `message` to the worker. A transfer list is accepted for the browser's
     *  signature: the app can't give a buffer away to a page, so it is copied as well. */
    postMessage(message: unknown, _transfer?: unknown): void {
      const state = stateOf(this);
      if (state.terminated) return;
      state.channel.post({ id: state.id, t: "m", d: message } satisfies WorkerEnvelope);
    }

    terminate(): void {
      const state = stateOf(this);
      if (state.terminated) return;
      state.terminated = true;
      live.delete(state.id);
      state.channel.post({ id: state.id, t: "x" } satisfies WorkerEnvelope);
      rest();
    }

    addEventListener(
      type: string,
      listener: Listener | null,
      listenerOptions?: boolean | { once?: boolean; signal?: AbortSignal },
    ): void {
      if (listener === null || listener === undefined) return;
      const state = stateOf(this);
      const settings = typeof listenerOptions === "object" ? listenerOptions : {};
      if (settings.signal?.aborted === true) return;
      let listeners = state.listeners.get(type);
      if (listeners === undefined) state.listeners.set(type, (listeners = new Map()));
      if (listeners.has(listener)) return;
      listeners.set(listener, { once: settings.once === true });
      settings.signal?.addEventListener("abort", () => this.removeEventListener(type, listener), {
        once: true,
      });
    }

    removeEventListener(type: string, listener: Listener | null): void {
      if (listener === null || listener === undefined) return;
      stateOf(this).listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event: WorkerEvent): boolean {
      return dispatch(this, event);
    }

    get [Symbol.toStringTag](): string {
      return "Worker";
    }
  }
  Object.defineProperty(PluginWorker, "name", { value: "Worker" });

  owner?.track({
    dispose() {
      unloaded = true;
      for (const worker of live.values()) worker.terminate();
      closePage();
    },
  });

  return PluginWorker as unknown as typeof Worker;
}
