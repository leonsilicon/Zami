// `zam.zami.web.open`: a page of a plugin's own, out of sight (a hidden iframe), that it
// runs code in. Plugins run in a real browser now, so WebAssembly, Workers and canvas are
// theirs directly; a context is for code that wants a document and globals of its own. The
// frame's document is a srcdoc and its code runs as modules from blob: URLs, which is what
// Zam's CSP allows (it allows no inline scripts, no eval, and no frames from blob: URLs).
// Arguments and results are structured clones.
import type { Disposable } from "#layers";

export interface WebContextOptions {
  /** The page's HTML (an empty page by default). */
  html?: string;
  /** Runs once the page has loaded, as the body of an async function; `ready` waits for it. */
  script?: string;
}

export interface WebContext {
  readonly frame: HTMLIFrameElement;
  /** Resolves once the page has loaded and `script` has run. */
  readonly ready: Promise<void>;
  readonly closed: boolean;
  /** Runs `source`, the body of an async function of `args`, in the page. */
  run(source: string, ...args: unknown[]): Promise<unknown>;
  /** A `message` event on the page's window. */
  post(message: unknown): void;
  /** What the page sends with `zami.post(message)`. */
  onMessage(listener: (message: unknown) => void): Disposable;
  onClose(listener: () => void): Disposable;
  dispose(): void;
}

/**
 * The script the page runs first. It asks the plugin's side for a port (one message, which
 * no code of the page sees), and from then on runs code and carries messages over the port,
 * so the page's own `message` listeners only ever see what the plugin posts.
 */
function pageRuntime(token: string): string {
  return `
const token = ${JSON.stringify(token)};
let port = null;
const outbox = [];
const send = (data) => (port ? port.postMessage(data) : outbox.push(data));
window.zami = { post: (message) => send({ message }) };
addEventListener("message", function onPort(event) {
  if (event.source !== parent || !event.data || event.data.zamiContext !== token || !event.ports[0]) return;
  event.stopImmediatePropagation();
  removeEventListener("message", onPort);
  port = event.ports[0];
  port.onmessage = async ({ data }) => {
    if (data.run !== undefined) {
      const url = URL.createObjectURL(
        new Blob(["export default async function (args) {\\n" + data.source + "\\n}"], { type: "text/javascript" }),
      );
      try {
        const module = await import(url);
        send({ result: data.run, value: await module.default(data.args) });
      } catch (error) {
        send({ result: data.run, error: String((error && error.stack) || error) });
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if ("message" in data) {
      dispatchEvent(new MessageEvent("message", { data: data.message }));
    }
  };
  for (const data of outbox.splice(0)) port.postMessage(data);
  send({ ready: true });
});
parent.postMessage({ zamiContext: token, hello: true }, "*");
`;
}

export function openWebContext(options: WebContextOptions = {}): WebContext {
  const token = crypto.randomUUID();
  const urls: string[] = [];
  const blobUrl = (content: string, type: string): string => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    urls.push(url);
    return url;
  };
  const runtime = `<script src="${blobUrl(pageRuntime(token), "text/javascript")}"></script>`;
  const html =
    options.html ?? '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  const page = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (head) => head + runtime)
    : runtime + html;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden;";

  let closed = false;
  let nextRun = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<() => void>();
  let markReady: () => void = () => {};
  const loaded = new Promise<void>((resolve) => (markReady = resolve));

  const channel = new MessageChannel();
  // The page says hello once: it gets the port, and everything else goes over it.
  const onWindowMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.zamiContext !== token || event.source !== frame.contentWindow) return;
    removeEventListener("message", onWindowMessage);
    frame.contentWindow?.postMessage({ zamiContext: token }, "*", [channel.port2]);
  };
  channel.port1.onmessage = ({ data }: MessageEvent<Record<string, unknown>>) => {
    if (data.ready) markReady();
    else if (typeof data.result === "number") {
      const call = pending.get(data.result);
      pending.delete(data.result);
      if (typeof data.error === "string") call?.reject(new Error(data.error));
      else call?.resolve(data.value);
    } else if ("message" in data) {
      for (const listener of messageListeners) listener(data.message);
    }
  };
  addEventListener("message", onWindowMessage);

  const context: WebContext = {
    frame,
    ready: loaded
      .then(() => (options.script ? context.run(options.script) : undefined))
      .then(() => {}),
    get closed() {
      return closed;
    },
    async run(source, ...args) {
      await loaded;
      if (closed) throw new Error("This web context is closed");
      const id = nextRun++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        channel.port1.postMessage({ run: id, source, args });
      });
    },
    post(message) {
      void loaded.then(() => channel.port1.postMessage({ message }));
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return { dispose: () => messageListeners.delete(listener) };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => closeListeners.delete(listener) };
    },
    dispose() {
      if (closed) return;
      closed = true;
      removeEventListener("message", onWindowMessage);
      channel.port1.close();
      frame.remove();
      for (const url of urls) URL.revokeObjectURL(url);
      for (const call of pending.values()) call.reject(new Error("This web context closed"));
      pending.clear();
      for (const listener of closeListeners) listener();
    },
  };
  // srcdoc, not a blob: URL: Zam's CSP allows frames from anywhere (`frame-src *`), which
  // doesn't cover blob: URLs, and a srcdoc frame isn't fetched at all.
  frame.srcdoc = page;
  document.body.append(frame);
  return context;
}
