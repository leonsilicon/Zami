// Capacitor's native side, in React Native: takes the page's plugin calls (bootstrap.ts),
// runs them on the plugins implemented here, and sends back results and events. It knows
// nothing of React Native itself, so it runs under Node in the tests.
import type {
  CallError,
  CallResult,
  CapacitorCall,
  PluginHeader,
  PluginMethodHeader,
} from "#protocol";

/** A failed call, as the page sees it (Capacitor's `CapacitorException`). */
export class PluginError extends Error {
  readonly code: string | undefined;
  readonly data: unknown;

  constructor(message: string, code?: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export interface PluginEvents {
  /**
   * Sends an event to the page's listeners for it. With `retain`, an event no listener
   * hears waits for the first one (Capacitor's `retainUntilConsumed`): a notification tap
   * that launched the app, before Zam has added its listener.
   */
  emit(eventName: string, data?: unknown, options?: { retain?: boolean }): void;
  listenerCount(eventName: string): number;
}

export type PluginMethod = (options: Record<string, unknown>) => unknown;

export interface ShellPlugin {
  /** The name Zam registers it under (`registerPlugin("App")`). */
  name: string;
  /** The methods the page awaits, by name. */
  methods: Record<string, PluginMethod>;
  /** Starts watching what the plugin reports as events; returns how to stop. */
  start?(events: PluginEvents): () => void;
}

/** Capacitor's listener methods, which every plugin has. */
const LISTENER_METHODS: PluginMethodHeader[] = [
  { name: "addListener", rtype: "callback" },
  { name: "removeListener", rtype: "promise" },
  { name: "removeAllListeners", rtype: "promise" },
];

/** How many unheard events of one kind wait for a listener. */
const MAX_RETAINED = 10;

function callError(error: unknown): CallError {
  if (error instanceof PluginError) {
    return {
      message: error.message,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.data === undefined ? {} : { data: error.data }),
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

export class Bridge {
  readonly #plugins = new Map<string, ShellPlugin>();
  /** Plugin → event → the page's listener callbacks. */
  readonly #listeners = new Map<string, Map<string, Set<string>>>();
  /** Plugin → event → events waiting for a listener. */
  readonly #retained = new Map<string, Map<string, unknown[]>>();
  readonly #send: (result: CallResult) => void;

  constructor(plugins: ShellPlugin[], send: (result: CallResult) => void) {
    for (const plugin of plugins) this.#plugins.set(plugin.name, plugin);
    this.#send = send;
  }

  /** What `window.Capacitor.PluginHeaders` lists. */
  get headers(): PluginHeader[] {
    return [...this.#plugins.values()].map((plugin) => ({
      name: plugin.name,
      methods: [
        ...Object.keys(plugin.methods).map((name): PluginMethodHeader => ({
          name,
          rtype: "promise",
        })),
        ...LISTENER_METHODS,
      ],
    }));
  }

  /** Starts every plugin's native events; returns how to stop them. */
  start(): () => void {
    const stops = [...this.#plugins.values()].map((plugin) =>
      plugin.start ? plugin.start(this.#eventsFor(plugin.name)) : () => {},
    );
    return () => {
      for (const stop of stops) stop();
    };
  }

  /** The page loaded again: its listeners went with the old document. */
  reset(): void {
    this.#listeners.clear();
  }

  /** Sends an event to the page's listeners for `eventName` on `pluginId`. */
  emit(pluginId: string, eventName: string, data?: unknown, options?: { retain?: boolean }): void {
    const callbacks = this.#listeners.get(pluginId)?.get(eventName);
    if (!callbacks || callbacks.size === 0) {
      if (options?.retain) {
        let byEvent = this.#retained.get(pluginId);
        if (!byEvent) this.#retained.set(pluginId, (byEvent = new Map()));
        const queue = byEvent.get(eventName) ?? [];
        queue.push(data);
        byEvent.set(eventName, queue.slice(-MAX_RETAINED));
      }
      return;
    }
    for (const callbackId of callbacks) this.#deliver(pluginId, callbackId, data);
  }

  listenerCount(pluginId: string, eventName: string): number {
    return this.#listeners.get(pluginId)?.get(eventName)?.size ?? 0;
  }

  /** Runs one of the page's calls and sends its result. */
  async call(call: CapacitorCall): Promise<void> {
    const plugin = this.#plugins.get(call.pluginId);
    if (!plugin) {
      this.#reply(call, false, undefined, {
        message: `"${call.pluginId}" plugin is not implemented here`,
        code: "UNIMPLEMENTED",
      });
      return;
    }
    switch (call.methodName) {
      case "addListener":
        this.#addListener(call);
        return;
      case "removeListener": {
        const { eventName, callbackId } = call.options;
        if (typeof eventName === "string" && typeof callbackId === "string") {
          this.#listeners.get(call.pluginId)?.get(eventName)?.delete(callbackId);
        }
        this.#reply(call, true);
        return;
      }
      case "removeAllListeners":
        this.#listeners.delete(call.pluginId);
        this.#reply(call, true);
        return;
    }
    const method = plugin.methods[call.methodName];
    if (!method) {
      this.#reply(call, false, undefined, {
        message: `"${call.pluginId}.${call.methodName}()" is not implemented here`,
        code: "UNIMPLEMENTED",
      });
      return;
    }
    try {
      this.#reply(call, true, await method(call.options));
    } catch (error) {
      this.#reply(call, false, undefined, callError(error));
    }
  }

  #addListener(call: CapacitorCall): void {
    const eventName = call.options.eventName;
    if (typeof eventName !== "string") return;
    let byEvent = this.#listeners.get(call.pluginId);
    if (!byEvent) this.#listeners.set(call.pluginId, (byEvent = new Map()));
    let callbacks = byEvent.get(eventName);
    if (!callbacks) byEvent.set(eventName, (callbacks = new Set()));
    callbacks.add(call.callbackId);
    const waiting = this.#retained.get(call.pluginId)?.get(eventName);
    if (waiting) {
      this.#retained.get(call.pluginId)?.delete(eventName);
      for (const data of waiting) this.#deliver(call.pluginId, call.callbackId, data);
    }
  }

  #deliver(pluginId: string, callbackId: string, data: unknown): void {
    this.#send({
      callbackId,
      pluginId,
      methodName: "addListener",
      success: true,
      save: true,
      ...(data === undefined ? {} : { data }),
    });
  }

  #reply(call: CapacitorCall, success: boolean, data?: unknown, error?: CallError): void {
    this.#send({
      callbackId: call.callbackId,
      pluginId: call.pluginId,
      methodName: call.methodName,
      success,
      ...(data === undefined ? {} : { data }),
      ...(error === undefined ? {} : { error }),
    });
  }

  #eventsFor(pluginId: string): PluginEvents {
    return {
      emit: (eventName, data, options) => this.emit(pluginId, eventName, data, options),
      listenerCount: (eventName) => this.listenerCount(pluginId, eventName),
    };
  }
}

/** The script that hands `result` to the page. */
export function resultScript(result: CallResult): string {
  return `window.Capacitor&&window.Capacitor.fromNative&&window.Capacitor.fromNative(${JSON.stringify(result)});true;`;
}
