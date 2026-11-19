/// <reference types="node" />
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { Disposable } from "#types";
import { webContexts, type WebContextRecord } from "#web-context";
import { createWorkerClass, type WorkerClassOptions, type WorkerEvent } from "#worker";
import { settle, showPage, until, type FakePage } from "./fake-page.ts";

// The page's `Worker`, for the tests: it keeps what it's given, echoes each message back
// a task later, and fails the way its script's text or its name asks it to.
const PAGE_WORKER = `
  globalThis.__workers = [];
  globalThis.Worker = class Worker {
    constructor(url, options) {
      if (options.name === "refused") throw new Error("The page refused the worker.");
      this.url = url;
      this.options = options;
      this.received = [];
      this.transfers = [];
      this.terminated = false;
      this.onmessage = null;
      this.onerror = null;
      __workers.push(this);
      __readBlob(url).then((text) => {
        this.text = text;
        if (text.includes("FAIL") && this.onerror) {
          this.onerror({
            message: "Uncaught Error: boom", filename: url, lineno: 3, colno: 9,
            preventDefault() {},
          });
        }
      });
    }
    postMessage(data, transfer) {
      if (this.terminated) return;
      this.received.push(data);
      this.transfers.push(transfer);
      setTimeout(() => {
        if (!this.terminated && this.onmessage) this.onmessage({ data: { echo: data } });
      }, 0);
    }
    terminate() {
      this.terminated = true;
    }
  };
`;

interface PageWorker {
  url: string;
  options: { type: string; name: string };
  text?: string;
  received: unknown[];
  transfers: unknown[][];
  terminated: boolean;
}

const pages = new Map<number, FakePage>();
/** Shows every open context's page in a fake WebView, as the host would. */
function showPages(): void {
  for (const record of webContexts()) {
    if (pages.has(record.id)) continue;
    pages.set(
      record.id,
      showPage(record, {
        setup: PAGE_WORKER,
        globals: { __readBlob: (url: string) => fetch(url).then((response) => response.text()) },
      }),
    );
  }
}
/** The page's workers so far (none until the page has loaded). */
const workersIn = (record: WebContextRecord): PageWorker[] => {
  const page = pages.get(record.id);
  try {
    return (page?.window.__workers as PageWorker[] | undefined) ?? [];
  } catch {
    return [];
  }
};

function owner() {
  const tracked: Disposable[] = [];
  return {
    track(disposable: Disposable) {
      tracked.push(disposable);
      return disposable;
    },
    unload() {
      for (const disposable of tracked) disposable.dispose();
    },
  };
}

const QUIET_SCRIPT = "self.onmessage = (e) => postMessage(e.data)";
const make = (options: WorkerClassOptions = {}, by = owner()) =>
  createWorkerClass(by, { readText: () => Promise.resolve(QUIET_SCRIPT), idleMs: 20, ...options });

afterEach(async () => {
  // Closing a page tells its workers, and the ones nobody listens to log it.
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const open of webContexts()) open.attach({ inject() {} }, {}).terminated("the test ended");
  pages.clear();
  await settle(2);
  vi.restoreAllMocks();
});

/** What crossed into the page's realm, as this realm's values (for `toEqual`). */
const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      ArrayBuffer.isView(item) ? { bytes: [...new Uint8Array(item.buffer)] } : item,
    ),
  );

describe("a plugin's Worker", () => {
  test("runs the script's text in a worker of the page, with its options", async () => {
    const Worker = make({ label: "sample" });
    const worker = new Worker("file:///cache/blob.js", { type: "module", name: "crunch" });
    expect(Object.prototype.toString.call(worker)).toBe("[object Worker]");
    expect(Worker.name).toBe("Worker");
    expect(webContexts()).toHaveLength(1);
    expect(webContexts()[0]!.label).toBe("sample (workers)");
    showPages();
    await settle();
    const [inPage] = workersIn(webContexts()[0]!);
    expect(inPage!.url).toMatch(/^blob:/);
    expect(inPage!.text).toBe(QUIET_SCRIPT);
    expect(inPage!.options).toEqual({ type: "module", name: "crunch" });
    expect(workersIn(webContexts()[0]!)).toHaveLength(1);
  });

  test("what's posted before the worker is up reaches it, in order", async () => {
    let deliver: (text: string) => void = () => {};
    const Worker = make({
      readText: () => new Promise<string>((resolve) => (deliver = resolve)),
    });
    const worker = new Worker(new URL("https://example.com/worker.js"));
    const heard: unknown[] = [];
    worker.onmessage = (event) => heard.push(event.data);
    worker.postMessage(1);
    worker.postMessage({ two: new Uint8Array([2]) });
    showPages();
    await settle();
    // The page has the messages and no worker yet: its script is still being read.
    expect(workersIn(webContexts()[0]!)).toHaveLength(0);
    worker.postMessage("three");
    deliver(QUIET_SCRIPT);
    await until(() => heard.length === 3, "the echoes");
    const [inPage] = workersIn(webContexts()[0]!);
    expect(plain(inPage!.received)).toEqual([1, { two: { bytes: [2] } }, "three"]);
    // The buffer made for a message is handed to the worker, not copied again.
    expect(inPage!.transfers.map((transfer) => transfer.length)).toEqual([0, 1, 0]);
    expect(heard).toEqual([{ echo: 1 }, { echo: { two: new Uint8Array([2]) } }, { echo: "three" }]);
  });

  test("events reach onmessage and listeners, as a browser's do", async () => {
    const Worker = make();
    const worker = new Worker("file:///w.js");
    showPages();
    const calls: string[] = [];
    const listener = (event: MessageEvent) => calls.push(`listener ${String(event.data.echo)}`);
    worker.onmessage = function (this: unknown, event) {
      calls.push(`on ${String(event.data.echo)} ${this === worker} ${event.target === worker}`);
    };
    worker.addEventListener("message", listener);
    worker.addEventListener("message", listener);
    worker.addEventListener(
      "message",
      { handleEvent: (event: MessageEvent) => calls.push(`object ${String(event.data.echo)}`) },
      { once: true },
    );
    const aborted = new AbortController();
    worker.addEventListener("message", () => calls.push("aborted"), { signal: aborted.signal });
    aborted.abort();
    worker.postMessage("a");
    await until(() => calls.length === 3, "the first echo");
    worker.removeEventListener("message", listener);
    worker.postMessage("b");
    await until(() => calls.length === 4, "the second echo");
    await settle();
    expect(calls).toEqual(["on a true true", "listener a", "object a", "on b true true"]);
    expect(() => worker.postMessage(() => {})).toThrow(/could not be cloned/);
    expect(
      worker.dispatchEvent({ type: "message", data: { echo: "mine" } } as unknown as Event),
    ).toBe(true);
    expect(calls.at(-1)).toBe("on mine true true");
  });

  test("terminate stops the page's worker, and the handle goes quiet", async () => {
    const Worker = make();
    const worker = new Worker("file:///w.js");
    const heard: unknown[] = [];
    worker.onmessage = (event) => heard.push(event.data);
    showPages();
    await settle();
    const record = webContexts()[0]!;
    await until(() => workersIn(record).length === 1, "the page's worker");
    worker.postMessage("lost");
    worker.terminate();
    worker.terminate();
    worker.postMessage("ignored");
    await until(() => workersIn(record)[0]!.terminated, "the page's worker to be terminated");
    await settle();
    expect(heard).toEqual([]);
    expect((pages.get(record.id)!.window.__zamiWorkers as Map<number, unknown>).size).toBe(0);
  });

  test("a script's uncaught error is the worker's error event", async () => {
    const Worker = make({ readText: () => Promise.resolve("FAIL") });
    const worker = new Worker("file:///w.js");
    const errors: WorkerEvent[] = [];
    worker.onerror = (event) => errors.push(event as unknown as WorkerEvent);
    showPages();
    await until(() => errors.length > 0, "the error");
    await settle();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "error",
      message: "Uncaught Error: boom",
      lineno: 3,
      colno: 9,
    });
    expect(errors[0]!.filename).toMatch(/^blob:/);
    // The worker is still there: an error doesn't end it.
    worker.postMessage(1);
    await until(() => workersIn(webContexts()[0]!)[0]!.received.length > 0, "the message");
    expect(workersIn(webContexts()[0]!)[0]!.received).toEqual([1]);
  });

  test("an error nobody listens for is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const Worker = make({ readText: () => Promise.resolve("FAIL"), label: "sample" });
    const worker = new Worker("file:///w.js");
    showPages();
    await until(() => error.mock.calls.length > 0, "the log");
    expect(error).toHaveBeenCalledWith(
      "[zami sample (workers)] uncaught error in a worker: Uncaught Error: boom",
    );
    worker.terminate();
  });

  test("a script that can't be read, or a worker the page refuses, is an error event", async () => {
    const Worker = make({
      readText: (url) =>
        url.includes("missing") ? Promise.reject(new Error("HTTP 404")) : Promise.resolve("x"),
    });
    const missing = new Worker("https://example.com/missing.js");
    const refused = new Worker("file:///w.js", { name: "refused" });
    const messages: string[] = [];
    missing.addEventListener("error", (event) => messages.push(event.message));
    refused.addEventListener("error", (event) => messages.push(event.message));
    showPages();
    await until(() => messages.length === 2, "both errors");
    expect(messages).toEqual([
      "Couldn't load the worker's script (https://example.com/missing.js): HTTP 404",
      "The page refused the worker.",
    ]);
    const page = pages.get(webContexts()[0]!.id)!;
    expect((page.window.__zamiWorkers as Map<number, unknown>).size).toBe(0);
    // Both are over: nothing more goes to the page for them.
    const sent = page.injected.length;
    missing.postMessage(1);
    refused.postMessage(1);
    expect(page.injected.length).toBe(sent);
  });

  test("data: URLs are read as the app reads them", async () => {
    const Worker = createWorkerClass(owner(), { idleMs: 20 });
    const plain = new Worker("data:text/javascript,postMessage(%22hi%22)");
    const encoded = new Worker(
      `data:text/javascript;base64,${Buffer.from("postMessage('ça')").toString("base64")}`,
    );
    showPages();
    await until(
      () => workersIn(webContexts()[0]!).filter((worker) => worker.text !== undefined).length === 2,
      "both scripts",
    );
    expect(workersIn(webContexts()[0]!).map((worker) => worker.text)).toEqual([
      'postMessage("hi")',
      "postMessage('ça')",
    ]);
    plain.terminate();
    encoded.terminate();
  });

  test("one plugin's workers share a page, which closes a while after the last", async () => {
    const Worker = make();
    const Other = make();
    const first = new Worker("file:///a.js");
    const second = new Worker("file:///b.js");
    const others = new Other("file:///c.js");
    expect(webContexts()).toHaveLength(2);
    showPages();
    const [mine, theirs] = webContexts();
    await until(
      () => workersIn(mine!).length === 2 && workersIn(theirs!).length === 1,
      "the pages' workers",
    );

    first.terminate();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(webContexts()).toContain(mine);
    second.terminate();
    // Another worker within the wait keeps the page.
    const third = new Worker("file:///d.js");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(webContexts()).toContain(mine);
    third.terminate();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(webContexts()).toEqual([theirs]);

    // And the next one opens a new page.
    const fourth = new Worker("file:///e.js");
    expect(webContexts()).toHaveLength(2);
    fourth.terminate();
    others.terminate();
  });

  test("unloading the plugin terminates its workers and closes their page for good", async () => {
    const plugin = owner();
    const Worker = make({}, plugin);
    const worker = new Worker("file:///w.js");
    const heard: unknown[] = [];
    worker.onmessage = (event) => heard.push(event.data);
    worker.onerror = () => heard.push("error");
    showPages();
    const record = webContexts()[0]!;
    await until(() => workersIn(record).length === 1, "the page's worker");
    worker.postMessage(1);
    plugin.unload();
    expect(webContexts()).toEqual([]);
    await settle(40);
    expect(heard).toEqual([]);
    expect(() => new Worker("file:///w.js")).toThrow(/unloaded/);
  });

  test("when the page's process is gone, its workers say so and new ones get a new page", async () => {
    const Worker = make();
    const worker = new Worker("file:///w.js");
    const stopped = new Worker("file:///w.js");
    const errors: string[] = [];
    worker.onerror = (event) => errors.push((event as unknown as WorkerEvent).message ?? "");
    stopped.onerror = () => errors.push("the terminated one");
    stopped.terminate();
    showPages();
    await settle();
    const record = webContexts()[0]!;
    pages.get(record.id)!.page.terminated("the system ended its page's process");
    expect(errors).toEqual(["The worker's page is closed: the system ended its page's process."]);
    worker.postMessage("into the void");
    expect(webContexts()).toEqual([]);

    const next = new Worker("file:///w.js");
    expect(webContexts()).toHaveLength(1);
    expect(webContexts()[0]).not.toBe(record);
    next.terminate();
  });

  test("the constructor wants a script, as a browser's does", () => {
    const Worker = make();
    expect(() => new (Worker as unknown as new () => Worker)()).toThrow(TypeError);
    expect(webContexts()).toEqual([]);
  });
});
