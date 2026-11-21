// The bootstrap in a page's place, against the real @capacitor/core, talking to the Bridge
// the way react-native-webview carries their messages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInContext, createContext, type Context } from "node:vm";
import { test } from "vite-plus/test";
import { bootstrapScript } from "#bootstrap";
import { Bridge, PluginError, resultScript, type PluginEvents, type ShellPlugin } from "#bridge";
import { parsePageMessage } from "#protocol";

const capacitorCore = readFileSync(
  createRequire(import.meta.url).resolve("@capacitor/core/dist/index.cjs.js"),
  "utf8",
);

interface Page {
  context: Context;
  bridge: Bridge;
  /** Runs page code, with Capacitor's `registerPlugin` in scope. */
  run<T>(code: string): Promise<T>;
  /** Lets every message cross both ways. */
  settle(): Promise<void>;
  posted: string[];
}

function loadPage(plugins: ShellPlugin[], platform = "ios"): Page {
  const posted: string[] = [];
  const queue: string[] = [];
  const window: Record<string, unknown> = {
    console,
    setTimeout,
    Promise,
    JSON,
    Error,
    ReactNativeWebView: { postMessage: (json: string) => (posted.push(json), queue.push(json)) },
    document: { readyState: "loading", addEventListener: () => {} },
  };
  window.window = window;
  window.globalThis = window;
  const context = createContext(window);
  const bridge = new Bridge(plugins, (result) => runInContext(resultScript(result), context));
  runInContext(
    bootstrapScript({ platform, appId: "com.leonsilicon.zami", headers: bridge.headers }),
    context,
  );
  // @capacitor/core reads window.Capacitor and window.CapacitorCustomPlatform as it loads.
  const exports: Record<string, unknown> = {};
  window.module = { exports };
  window.exports = exports;
  runInContext(capacitorCore, context);
  window.capacitor = exports;

  async function settle(): Promise<void> {
    for (let round = 0; round < 20; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (queue.length > 0) {
        const message = parsePageMessage(queue.shift()!);
        if (message?.type === "capacitor") await bridge.call(message);
      }
    }
  }
  return {
    context,
    bridge,
    posted,
    settle,
    async run<T>(code: string): Promise<T> {
      const result = runInContext(
        `(async () => { const { Capacitor, registerPlugin } = capacitor; ${code} })()`,
        context,
      ) as Promise<unknown>;
      await settle();
      // A copy in this realm: the page's arrays and objects have its prototypes.
      const value = await result;
      return (value === undefined ? undefined : JSON.parse(JSON.stringify(value))) as T;
    },
  };
}

test("Capacitor sees a native platform with the shell's plugins", async () => {
  const page = loadPage([{ name: "Preferences", methods: { get: () => ({ value: "x" }) } }]);
  assert.equal(await page.run("return Capacitor.getPlatform();"), "ios");
  assert.equal(await page.run("return Capacitor.isNativePlatform();"), true);
  assert.equal(await page.run('return Capacitor.isPluginAvailable("Preferences");'), true);
  assert.equal(await page.run('return Capacitor.isPluginAvailable("UnifiedPush");'), false);
});

test("a call reaches its plugin and resolves with what it returns", async () => {
  const seen: unknown[] = [];
  const page = loadPage([
    {
      name: "Preferences",
      methods: {
        get: async (options) => {
          seen.push(options);
          return { value: `value of ${String(options.key)}` };
        },
      },
    },
  ]);
  const result = await page.run<{ value: string }>(
    'const Preferences = registerPlugin("Preferences"); return Preferences.get({ key: "a" });',
  );
  assert.deepEqual(result, { value: "value of a" });
  assert.deepEqual(seen, [{ key: "a" }]);
});

test("a failed call rejects with the plugin's message and code", async () => {
  const page = loadPage([
    {
      name: "Browser",
      methods: {
        open: () => {
          throw new PluginError("Must provide a URL to open", "BAD_URL");
        },
      },
    },
  ]);
  const error = await page.run<{ message: string; code: string }>(
    'try { await registerPlugin("Browser").open({}); } catch (e) { return { message: e.message, code: e.code }; }',
  );
  assert.deepEqual(error, { message: "Must provide a URL to open", code: "BAD_URL" });
});

test("a method the plugin lacks rejects as unimplemented", async () => {
  const page = loadPage([{ name: "App", methods: {} }]);
  const code = await page.run<string>(
    'try { await registerPlugin("App").getInfo(); } catch (e) { return e.code; }',
  );
  assert.equal(code, "UNIMPLEMENTED");
});

test("listeners get events until removed, and a retained event waits for the first", async () => {
  let events: PluginEvents | undefined;
  const page = loadPage([
    {
      name: "App",
      methods: {},
      start(pluginEvents) {
        events = pluginEvents;
        return () => {};
      },
    },
  ]);
  const stop = page.bridge.start();
  events!.emit("appUrlOpen", { url: "moe.crafty.matrix://launch" }, { retain: true });
  events!.emit("pause"); // nobody listens, and it isn't kept

  await page.run(`
    globalThis.urls = [];
    globalThis.handle = await registerPlugin("App").addListener("appUrlOpen", (e) => urls.push(e.url));
  `);
  assert.deepEqual(await page.run("return urls;"), ["moe.crafty.matrix://launch"]);

  events!.emit("appUrlOpen", { url: "moe.crafty.matrix://callback" });
  await page.settle();
  assert.deepEqual(await page.run("return urls;"), [
    "moe.crafty.matrix://launch",
    "moe.crafty.matrix://callback",
  ]);
  assert.equal(page.bridge.listenerCount("App", "appUrlOpen"), 1);

  await page.run("await handle.remove();");
  assert.equal(page.bridge.listenerCount("App", "appUrlOpen"), 0);
  events!.emit("appUrlOpen", { url: "moe.crafty.matrix://late" });
  await page.settle();
  assert.equal((await page.run<string[]>("return urls;")).length, 2);
  stop();
});

test("a reload drops the old page's listeners", async () => {
  const page = loadPage([{ name: "App", methods: {} }]);
  await page.run('await registerPlugin("App").addListener("backButton", () => {});');
  assert.equal(page.bridge.listenerCount("App", "backButton"), 1);
  page.bridge.reset();
  assert.equal(page.bridge.listenerCount("App", "backButton"), 0);
});
