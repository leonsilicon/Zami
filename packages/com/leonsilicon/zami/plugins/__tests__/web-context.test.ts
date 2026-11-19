/// <reference types="node" />
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { MAX_PACKET } from "#web-bridge";
import { DEFAULT_BASE_URL, openWebContext, subscribeWebContexts, webContexts } from "#web-context";
import { settle, showPage } from "./fake-page.ts";

const QUIET = { forwardLogs: [] };
const record = (id: number) => webContexts().find((entry) => entry.id === id)!;

afterEach(async () => {
  for (const open of webContexts()) open.attach({ inject() {} }, {}).terminated("the test ended");
  await settle(2);
  vi.restoreAllMocks();
});

describe("a web context's page", () => {
  test("is listed for the host while it's open, with the bridge in its HTML", () => {
    let changes = 0;
    const unsubscribe = subscribeWebContexts(() => changes++);
    const before = webContexts();
    const context = openWebContext(
      { html: "<!DOCTYPE html><title>t</title><script>window.early = typeof zami</script>" },
      QUIET,
    );
    expect(webContexts()).not.toBe(before);
    expect(changes).toBe(1);
    const { source, install } = record(context.id);
    if (!("html" in source)) throw new Error("expected an HTML page");
    // After the doctype (before it, the page would be in quirks mode), before its scripts.
    expect(source.html.startsWith("<!DOCTYPE html><script>")).toBe(true);
    expect(source.html.indexOf("__zamiBridge")).toBeLessThan(source.html.indexOf("window.early"));
    expect(source.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(install).not.toMatch(/<\/script/i);

    context.dispose();
    expect(webContexts().some((entry) => entry.id === context.id)).toBe(false);
    expect(changes).toBe(2);
    expect(context.closed).toBe("it was disposed");
    unsubscribe();
  });

  test("a page loaded from a URL gets the bridge injected, and no HTML", () => {
    const context = openWebContext({ url: "https://example.com/app" }, QUIET);
    expect(record(context.id).source).toEqual({ uri: "https://example.com/app" });
    expect(openWebContext({ baseUrl: "https://x.test/" }, QUIET)).toBeDefined();
    const custom = webContexts().at(-1)!;
    expect("baseUrl" in custom.source && custom.source.baseUrl).toBe("https://x.test/");
  });

  test("runs code in the page, with arguments and results copied", async () => {
    const context = openWebContext({}, QUIET);
    showPage(record(context.id));
    await context.ready;
    expect(await context.run("return args[0] + args[1]", 2, 3)).toBe(5);
    expect(await context.run("return typeof window.zami.post")).toBe("function");
    const doubled = await context.run<Float32Array>(
      "await null; return args[0].map((n) => n * 2)",
      new Float32Array([1, 2.5]),
    );
    expect(Object.prototype.toString.call(doubled)).toBe("[object Float32Array]");
    expect([...doubled]).toEqual([2, 5]);
    expect(await context.run("return")).toBe(undefined);
    expect(await context.run("return new Map([[1, new Date(5)]])")).toEqual(
      new Map([[1, new Date(5)]]),
    );
  });

  test("what the page throws rejects the run, as what it threw", async () => {
    const context = openWebContext({}, QUIET);
    showPage(record(context.id));
    const error = await context.run("throw new TypeError('no good')").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect([(error as Error).name, (error as Error).message]).toEqual(["TypeError", "no good"]);
    await expect(context.run("throw { code: 7 }")).rejects.toEqual({ code: 7 });
    await expect(context.run("this is not javascript")).rejects.toMatchObject({
      name: "SyntaxError",
    });
    // A result only the page can hold.
    await expect(context.run("return () => 1")).rejects.toMatchObject({ name: "DataCloneError" });
    // An argument only the app can hold: nothing is sent.
    await expect(context.run("return 1", () => 1)).rejects.toMatchObject({
      name: "DataCloneError",
    });
  });

  test("everything asked before a WebView shows the page waits, in order", async () => {
    const context = openWebContext(
      { script: "var order = []; window.addEventListener('message', (e) => order.push(e.data))" },
      QUIET,
    );
    const first = context.run<number>("order.push('run 1'); return order.length");
    context.post("post 1");
    const second = context.run<string[]>("return order.slice()");
    context.post({ n: 2 });
    await settle();
    // No host yet: nothing has gone anywhere.
    const page = showPage(record(context.id), { unloaded: true });
    await settle();
    expect(page.injected).toEqual([]);
    page.reload();
    expect(await first).toBe(1);
    expect(await second).toEqual(["run 1", "post 1"]);
    expect(await context.run("return order")).toEqual(["run 1", "post 1", { n: 2 }]);
  });

  test("ready follows the context's script, whose functions and vars are the page's", async () => {
    const context = openWebContext(
      {
        script: `
          function triple(n) { return n * 3; }
          var four = 4;
          new Promise((resolve) => setTimeout(() => { window.late = true; resolve(); }, 5));
        `,
      },
      QUIET,
    );
    const page = showPage(record(context.id));
    await context.ready;
    // The script ended in a promise: ready waited for it.
    expect(page.evaluate("window.late")).toBe(true);
    // What the script declared is global: later runs see it.
    expect(await context.run("return triple(four)")).toBe(12);
  });

  test("a script that throws rejects ready, and the page still works", async () => {
    const context = openWebContext({ script: "window.before = 1; missing()" }, QUIET);
    showPage(record(context.id));
    await expect(context.ready).rejects.toMatchObject({ name: "ReferenceError" });
    expect(await context.run("return window.before")).toBe(1);
  });

  test("messages go both ways, copied", async () => {
    const context = openWebContext(
      {
        script: `window.addEventListener("message", (event) => {
          zami.post({ echo: event.data, bytes: new Uint8Array([1, 2, 3]) });
        })`,
      },
      QUIET,
    );
    showPage(record(context.id));
    const received: unknown[] = [];
    const subscription = context.onMessage((message) => received.push(message));
    context.post({ when: new Date(9), list: [1n] });
    await context.ready;
    await settle();
    expect(received).toEqual([
      { echo: { when: new Date(9), list: [1n] }, bytes: new Uint8Array([1, 2, 3]) },
    ]);
    subscription.dispose();
    context.post("again");
    await settle();
    expect(received).toHaveLength(1);
    expect(() => context.post(() => {})).toThrow(/could not be cloned/);
  });

  test("a handler that throws doesn't stop the others", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const context = openWebContext({ script: "zami.post(1)" }, QUIET);
    const seen: unknown[] = [];
    context.onMessage(() => {
      throw new Error("mine");
    });
    context.onMessage((message) => seen.push(message));
    showPage(record(context.id));
    await context.ready;
    await settle();
    expect(seen).toEqual([1]);
    expect(error).toHaveBeenCalledOnce();
  });

  test("a packet too large for one message goes in parts, both ways", async () => {
    const context = openWebContext({}, QUIET);
    const page = showPage(record(context.id));
    await context.ready;
    const big = "x".repeat(MAX_PACKET * 2 + 17);
    const bytes = Uint8Array.from({ length: MAX_PACKET }, (_, i) => i % 251);
    const result = await context.run<{ text: string; bytes: Uint8Array }>(
      "return { text: args[0] + '!', bytes: args[1].reverse() }",
      big,
      bytes,
    );
    expect(result.text).toBe(`${big}!`);
    expect(Buffer.from(result.bytes).equals(Buffer.from(bytes.reverse()))).toBe(true);
    expect(page.injected.every((script) => script.length < MAX_PACKET * 1.1)).toBe(true);
    expect(page.injected.filter((script) => script.includes("__zamiBridge.part(")).length).toBe(4);
    expect(page.posted.every((text) => text.length < MAX_PACKET * 1.1)).toBe(true);
    expect(page.posted.filter((text) => text.startsWith('{"k":"part"')).length).toBe(4);
  });

  test("line separators in what's sent don't break the injected script", async () => {
    const context = openWebContext({ script: "window.sep = '\u2028'" }, QUIET);
    const page = showPage(record(context.id));
    await context.ready;
    expect(await context.run("return args[0] + window.sep", "a\u2028b\u2029c\n\"'\\")).toBe(
      "a\u2028b\u2029c\n\"'\\\u2028",
    );
    expect(page.injected.join("")).not.toMatch(/[\u2028\u2029]/);
  });

  test("disposing rejects what's pending and whatever is asked after", async () => {
    const context = openWebContext({}, QUIET);
    showPage(record(context.id));
    await context.ready;
    const pending = context.run("await new Promise(() => {})");
    const closes: string[] = [];
    context.onClose((reason) => closes.push(reason));
    context.dispose();
    context.dispose();
    await expect(pending).rejects.toThrow("The web context is closed: it was disposed.");
    await expect(context.run("return 1")).rejects.toThrow(/closed/);
    expect(closes).toEqual(["it was disposed"]);
    expect(() => context.post("ignored")).not.toThrow();
    expect(context.onMessage(() => {}).dispose()).toBe(undefined);
  });

  test("closing before the page is ready rejects ready, quietly if nobody waits", async () => {
    const context = openWebContext({}, QUIET);
    const pending = context.run("return 1");
    context.dispose();
    await expect(context.ready).rejects.toThrow(/closed/);
    await expect(pending).rejects.toThrow(/closed/);
    const unwatched = openWebContext({}, QUIET);
    unwatched.dispose();
    await settle(2);
  });

  test("a page whose process is gone closes the context", async () => {
    const context = openWebContext({}, QUIET);
    const page = showPage(record(context.id));
    await context.ready;
    const pending = context.run("await new Promise(() => {})");
    const closes: string[] = [];
    context.onClose((reason) => closes.push(reason));
    page.page.terminated("the system ended its page's process");
    await expect(pending).rejects.toThrow(
      "The web context is closed: the system ended its page's process.",
    );
    expect(closes).toEqual(["the system ended its page's process"]);
    expect(webContexts().some((entry) => entry.id === context.id)).toBe(false);
  });

  test("a reloaded page drops what it was asked, and takes what's asked next", async () => {
    const context = openWebContext({ script: "window.loads = (window.loads || 0) + 1" }, QUIET);
    const page = showPage(record(context.id));
    await context.ready;
    await context.run("window.state = 'old'");
    const lost = context.run("await new Promise(() => {})");
    page.reload();
    await expect(lost).rejects.toThrow("The web context's page was reloaded.");
    // Asked while the new document loads: it waits for it.
    expect(await context.run("return [window.state, window.loads]")).toEqual([undefined, 1]);
    expect(context.closed).toBe(null);
  });

  test("the same WebView attaching again keeps the page; another one is another page", async () => {
    const context = openWebContext({}, QUIET);
    const mount = {};
    const current = record(context.id);
    const page = showPage(current, { mount });
    await context.ready;
    await context.run("window.kept = 1");
    // An effect that ran again: detached and attached within a turn.
    page.page.detach();
    const sent = context.run("return window.kept");
    current.attach({ inject: (script) => page.evaluate(script) }, mount);
    expect(await sent).toBe(1);
    expect(context.closed).toBe(null);

    current.attach({ inject() {} }, {});
    expect(context.closed).toBe("its page was removed");
  });

  test("a WebView that goes away for good closes the context", async () => {
    const context = openWebContext({}, QUIET);
    const page = showPage(record(context.id));
    await context.ready;
    page.page.detach();
    expect(context.closed).toBe(null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(context.closed).toBe("its page was removed");
  });

  test("the page's console and uncaught errors reach the app's console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const context = openWebContext(
      { script: "console.warn('careful', { n: 1 }); console.log('chatter')" },
      { label: "sample", forwardLogs: ["warn", "error"] },
    );
    const page = showPage(record(context.id), { globals: { console: { ...console } } });
    await context.ready;
    page.evaluate(
      "window.dispatchEvent(Object.assign(new Event('error'), { message: 'Uncaught boom' }))",
    );
    await settle();
    expect(warn).toHaveBeenCalledWith("[zami web context sample]", "careful", '{"n":1}');
    expect(error).toHaveBeenCalledWith("[zami web context sample]", "Uncaught boom");
    expect(log).not.toHaveBeenCalledWith("[zami web context sample]", "chatter");
  });

  test("channels carry their own messages, and wait for a handler in the page", async () => {
    const context = openWebContext({}, QUIET);
    const page = showPage(record(context.id));
    const channel = context.channel("side");
    const seen: unknown[] = [];
    const main: unknown[] = [];
    channel.onMessage((message) => seen.push(message));
    context.onMessage((message) => main.push(message));
    // Posted before the page listens on the channel: kept for its handler.
    channel.post({ n: 1, bytes: new Uint8Array([5]) });
    await context.ready;
    await settle();
    page.evaluate(`
      window.__zamiBridge.on("side", (message, buffers) => {
        window.__zamiBridge.emit("side", { got: message.n, buffers: buffers.length });
      });
    `);
    channel.post({ n: 2 });
    await settle();
    expect(seen).toEqual([
      { got: 1, buffers: 1 },
      { got: 2, buffers: 0 },
    ]);
    expect(main).toEqual([]);
  });
});
