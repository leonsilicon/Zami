// The page's end of a web context (#web-context): JavaScript the WebView runs in the page.
// The app injects packets (`__zamiBridge.receive`), the page answers through React Native
// WebView's `ReactNativeWebView.postMessage`, and both are JSON text carrying values the
// codec copied (#web-codec). It is source text for the same reason the codec is.
import { CODEC_SOURCE } from "#web-codec";

/**
 * The most characters one injected script or one posted message carries. A larger packet
 * goes as parts: neither platform documents a limit, but a single multi-megabyte
 * evaluation or bridge message is where WebViews have had them.
 */
export const MAX_PACKET = 1 << 20;

/** The channel `post` and `onMessage` use: the page's `window` messages and `zami.post`. */
export const PAGE_CHANNEL = "";

/**
 * Installs `window.__zamiBridge` and `window.zami`, once per page (running it again does
 * nothing). `forwardLogs` is the `console` levels the app also gets.
 */
function bridgeSource(forwardLogs: readonly string[]): string {
  return `(function () {
  "use strict";
  if (window.__zamiBridge) return;
  var codec = ${CODEC_SOURCE};
  var MAX = ${MAX_PACKET};
  var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  var sequence = 0;
  var incoming = {};
  var handlers = {};
  var backlog = {};
  var started = false;

  function sendText(text) {
    var native = window.ReactNativeWebView;
    if (!native) return;
    if (text.length <= MAX) {
      native.postMessage(text);
      return;
    }
    var q = ++sequence;
    var n = Math.ceil(text.length / MAX);
    for (var i = 0; i < n; i++) {
      native.postMessage(
        JSON.stringify({ k: "part", q: q, i: i, n: n, d: text.slice(i * MAX, (i + 1) * MAX) })
      );
    }
  }
  function send(packet) {
    sendText(JSON.stringify(packet));
  }
  function encodeError(error) {
    try {
      return codec.encode(error);
    } catch (_) {
      return codec.encode(new Error(String(error)));
    }
  }

  function emit(channel, value) {
    send({ k: "msg", c: channel, v: codec.encode(value) });
  }
  function deliver(channel, value, buffers) {
    if (channel === "") {
      window.dispatchEvent(new MessageEvent("message", { data: value }));
      return;
    }
    var list = handlers[channel];
    if (!list || list.length === 0) {
      // Its handler is being set up by a script still running: kept for it.
      (backlog[channel] || (backlog[channel] = [])).push([value, buffers]);
      return;
    }
    list.slice().forEach(function (handler) {
      try {
        handler(value, buffers);
      } catch (error) {
        console.error(error);
      }
    });
  }

  function handle(packet) {
    if (packet.k === "run") {
      Promise.resolve()
        .then(function () {
          return new AsyncFunction("args", packet.s)(codec.decode(packet.a));
        })
        .then(function (value) {
          send({ k: "ret", id: packet.id, v: codec.encode(value) });
        })
        .catch(function (error) {
          send({ k: "thr", id: packet.id, e: encodeError(error) });
        });
    } else if (packet.k === "msg") {
      var buffers = [];
      deliver(packet.c, codec.decode(packet.v, buffers), buffers);
    }
  }

  var levels = ${JSON.stringify(forwardLogs)};
  function describe(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || value.name + ": " + value.message;
    try {
      var json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch (_) {
      return String(value);
    }
  }
  function log(level, values) {
    try {
      send({ k: "log", l: level, a: Array.prototype.map.call(values, describe) });
    } catch (_) {}
  }
  levels.forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      log(level, arguments);
      if (original) original.apply(console, arguments);
    };
  });
  // What nothing in the page caught is otherwise seen by nobody: the page is out of sight.
  window.addEventListener("error", function (event) {
    log("error", [event.error || event.message]);
  });
  window.addEventListener("unhandledrejection", function (event) {
    log("error", ["Unhandled rejection:", event.reason]);
  });

  window.__zamiBridge = {
    receive: function (text) {
      handle(JSON.parse(text));
    },
    part: function (q, i, n, text) {
      var parts = incoming[q] || (incoming[q] = []);
      parts[i] = text;
      if (i !== n - 1) return;
      delete incoming[q];
      handle(JSON.parse(parts.join("")));
    },
    /** Runs the context's script once, as global code (its functions and vars are the
     *  page's), and waits for what it evaluates to, if that's a promise. */
    start: function (script) {
      if (started) return;
      started = true;
      var failed = function (error) {
        send({ k: "ready", e: encodeError(error) });
      };
      var result;
      try {
        result = script ? (0, eval)(script) : undefined;
      } catch (error) {
        failed(error);
        return;
      }
      Promise.resolve(result).then(function () {
        send({ k: "ready" });
      }, failed);
    },
    /** A channel's messages from the app: handler(value, buffers the value was made of). */
    on: function (channel, handler) {
      (handlers[channel] || (handlers[channel] = [])).push(handler);
      var waiting = backlog[channel];
      if (waiting) {
        delete backlog[channel];
        waiting.forEach(function (entry) {
          deliver(channel, entry[0], entry[1]);
        });
      }
    },
    emit: emit,
  };
  window.zami = {
    post: function (message) {
      emit("", message);
    },
  };
})();`;
}

/** A JavaScript string literal of `text`. (JSON's, with the two line separators JSON
 *  allows raw and older engines' scripts don't.) */
export function literal(text: string): string {
  return JSON.stringify(text)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** An injected script must end in a value the WebView can report, and throw nothing. */
function injected(statement: string): string {
  return `try{${statement}}catch(e){}true;`;
}

export interface BridgeScripts {
  /** Installs the bridge; run before the page's own scripts (and safe to run again). */
  install: string;
  /** Run once the page has loaded: installs the bridge if nothing did, then runs `script`. */
  start: string;
}

export function bridgeScripts(
  script: string | undefined,
  forwardLogs: readonly string[],
): BridgeScripts {
  const source = bridgeSource(forwardLogs);
  return {
    install: `${source}true;`,
    start: `${source}${injected(`window.__zamiBridge.start(${literal(script ?? "")})`)}`,
  };
}

/** `html` with the bridge installed by its first script, so the page's own scripts
 *  (which can run before a WebView's injected ones) find `zami`. */
export function withBridge(html: string, install: string): string {
  // "</script" would end the element wherever it is in the source, even in a string.
  const element = `<script>${install.replace(/<\/script/gi, "<\\/script")}</script>`;
  // After the doctype: anything before it puts the page in quirks mode.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype === null
    ? element + html
    : html.slice(0, doctype[0].length) + element + html.slice(doctype[0].length);
}

/** The scripts that hand `packetText` (a packet's JSON) to the page, in order. */
export function deliveryScripts(packetText: string, sequence: number): string[] {
  if (packetText.length <= MAX_PACKET) {
    return [injected(`window.__zamiBridge.receive(${literal(packetText)})`)];
  }
  const count = Math.ceil(packetText.length / MAX_PACKET);
  return Array.from({ length: count }, (_, index) =>
    injected(
      `window.__zamiBridge.part(${sequence},${index},${count},${literal(
        packetText.slice(index * MAX_PACKET, (index + 1) * MAX_PACKET),
      )})`,
    ),
  );
}
