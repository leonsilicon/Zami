// The page's end of the app's `Worker` (#worker): real Web Workers in a web context's
// page, driven over one of the bridge's channels. Source text, like the bridge itself
// (#web-bridge), run once per page with the context's `run`.

/** The bridge channel the app and the page's workers talk over. */
export const WORKER_CHANNEL = "zami:worker";

/**
 * What crosses the channel, both ways, keyed by the worker's `id`.
 *
 * App to page: `new` (a worker is coming: `o` its options; messages for it wait),
 * `src` (its script's text `s`: start it and hand it what waited, in order), `m` (a
 * message `d` for it), `x` (terminate it).
 *
 * Page to app: `m` (a message `d` from it), `e` (its `error` event: message `m`, file
 * `f`, line `l`, column `c`; `fatal` when it couldn't be started at all), `me` (a
 * message that couldn't be copied).
 */
export type WorkerEnvelope =
  | { id: number; t: "new"; o: { type: "classic" | "module"; name: string; credentials?: string } }
  | { id: number; t: "src"; s: string }
  | { id: number; t: "m"; d: unknown }
  | { id: number; t: "x" }
  | { id: number; t: "e"; m: string; f?: string; l?: number; c?: number; fatal?: boolean }
  | { id: number; t: "me" };

/** The body of an async function, for a web context's `run`. */
export const WORKER_PAGE_SOURCE = `
if (window.__zamiWorkers) return;
var bridge = window.__zamiBridge;
var workers = new Map();
window.__zamiWorkers = workers;

function emit(message) {
  bridge.emit(${JSON.stringify(WORKER_CHANNEL)}, message);
}

function start(id, entry, text) {
  // A blob URL of the page's own: a worker's script has to come from the page's origin,
  // which the URL the app was given (a file of the app's, another site's) is not.
  var url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  var worker;
  try {
    worker = new Worker(url, entry.options);
  } catch (error) {
    URL.revokeObjectURL(url);
    workers.delete(id);
    emit({ id: id, t: "e", m: String((error && error.message) || error), fatal: true });
    return;
  }
  entry.url = url;
  entry.worker = worker;
  worker.onmessage = function (event) {
    try {
      emit({ id: id, t: "m", d: event.data });
    } catch (_) {
      // Something in it only this page can hold (a port, an ImageBitmap).
      emit({ id: id, t: "me" });
    }
  };
  worker.onmessageerror = function () {
    emit({ id: id, t: "me" });
  };
  worker.onerror = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    emit({
      id: id,
      t: "e",
      m: String((event && event.message) || "The worker's script failed."),
      f: String((event && event.filename) || ""),
      l: (event && event.lineno) || 0,
      c: (event && event.colno) || 0,
    });
  };
  var queue = entry.queue;
  entry.queue = [];
  queue.forEach(function (item) {
    worker.postMessage(item[0], item[1]);
  });
}

bridge.on(${JSON.stringify(WORKER_CHANNEL)}, function (message, buffers) {
  var entry = workers.get(message.id);
  if (message.t === "new") {
    workers.set(message.id, { worker: null, url: null, queue: [], options: message.o });
  } else if (!entry) {
    return;
  } else if (message.t === "src") {
    if (!entry.worker) start(message.id, entry, message.s);
  } else if (message.t === "m") {
    // The buffers were made for this message alone, so the worker takes them uncopied.
    if (entry.worker) entry.worker.postMessage(message.d, buffers);
    else entry.queue.push([message.d, buffers]);
  } else if (message.t === "x") {
    workers.delete(message.id);
    if (entry.worker) entry.worker.terminate();
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
});
`;
