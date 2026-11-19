/// <reference types="node" />
// A web context's page for the tests: the scripts a WebView would run (the bridge, the
// context's own, what the app injects) run in a realm of their own (`node:vm`), a task
// each as in a WebView, with `ReactNativeWebView.postMessage` wired back to the context.
import vm from "node:vm";
import type { WebContextPage, WebContextRecord } from "#web-context";

export interface FakePage {
  /** The page's global object: `window`. */
  window: Record<string, unknown>;
  /** Every string the page posted to the app, in order. */
  posted: string[];
  /** Every script the app injected, in order. */
  injected: string[];
  /** The context's side of this WebView, to report what a WebView reports. */
  page: WebContextPage;
  /** Runs source in the page, as its own script would. */
  evaluate(source: string): unknown;
  /** Loads the page again: a new document, as after a navigation. */
  reload(): void;
}

export interface FakePageOptions {
  /** The WebView's identity (#web-context's `attach`); a new one by default. */
  mount?: object;
  /** Set up in the page before anything runs (a fake `Worker`, say). */
  setup?: string;
  /** More globals for the page. */
  globals?: Record<string, unknown>;
  /** Don't load the page yet: `reload()` does. */
  unloaded?: boolean;
}

/** Every task queued so far has run, and the tasks those queued, and so on. */
export async function settle(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    // oxlint-disable-next-line no-await-in-loop -- one turn of the event loop at a time
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Waits, a turn of the event loop at a time, until `done()` holds. */
export async function until(done: () => boolean, what = "the condition"): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    // oxlint-disable-next-line no-await-in-loop -- one turn of the event loop at a time
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Shows `record`'s page in a fake WebView. */
export function showPage(record: WebContextRecord, options: FakePageOptions = {}): FakePage {
  const posted: string[] = [];
  const injected: string[] = [];
  let realm: vm.Context | null = null;
  let page: WebContextPage | null = null;

  // A WebView runs each injected script as a task of its own, in order.
  let tasks: Promise<void> = Promise.resolve();
  const task = (run: () => void): void => {
    tasks = tasks.then(() => new Promise<void>((resolve) => setImmediate(resolve))).then(run);
  };

  const load = (): void => {
    const events = new EventTarget();
    const window: Record<string, unknown> = {
      console,
      Event,
      MessageEvent,
      URL,
      Blob,
      TextDecoder,
      TextEncoder,
      setTimeout,
      clearTimeout,
      btoa,
      atob,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      ReactNativeWebView: {
        postMessage(text: string) {
          posted.push(text);
          // The bridge crosses processes: the app hears a message a task later.
          setImmediate(() => page?.message(text));
        },
      },
      ...options.globals,
    };
    window.window = window;
    window.self = window;
    const created = vm.createContext(window);
    realm = created;
    page?.loading();
    task(() => {
      if (realm !== created) return;
      if (options.setup !== undefined) vm.runInContext(options.setup, created);
      vm.runInContext(record.install, created);
    });
    task(() => {
      if (realm === created) vm.runInContext(record.start, created);
    });
  };

  page = record.attach(
    {
      inject(script) {
        injected.push(script);
        const target = realm;
        task(() => {
          if (target !== null && realm === target) vm.runInContext(script, target);
        });
      },
    },
    options.mount ?? {},
  );
  if (options.unloaded !== true) load();

  return {
    get window() {
      if (realm === null) throw new Error("The page hasn't loaded");
      return realm as Record<string, unknown>;
    },
    posted,
    injected,
    page,
    evaluate(source) {
      if (realm === null) throw new Error("The page hasn't loaded");
      return vm.runInContext(source, realm);
    },
    reload: load,
  };
}
