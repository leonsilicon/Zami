// The page Flash plays in: Zam's static/flash-sandbox/ for a WebView. Zam runs Ruffle in
// an iframe with sandbox="allow-scripts", talking to the app over a MessagePort; here the
// WebView is the sandbox (its own process, with none of the app's storage, state or
// session), and the app's side of the port is the WebView's message bridge.

/**
 * The sandbox's Content-Security-Policy: Zam's (static/flash-sandbox/index.html), with
 * `file:` for the page's own scripts and Ruffle's wasm, which load from the sandbox's
 * directory (the only one the WebView may read). No network: connect-src allows only
 * those files, and nothing else may load from anywhere.
 */
export const SANDBOX_CSP =
  "default-src 'none'; script-src file: 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src file:; form-action 'none'; base-uri 'none'";

export const PAGE_HTML = `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}" />
<style>
    html,
    body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #000;
    }
</style>
<script src="frame.js"></script>
`;

/**
 * Zam's static/flash-sandbox/frame.js, over the WebView's bridge: the app posts one
 * "init" message with the SWF, then "suspend"s; the page asks the app for Ruffle's wasm
 * by name, and once the app says it's in place, reads it from the sandbox's directory.
 * Messages are JSON strings; the SWF's bytes travel as base64.
 */
export const FRAME_JS = `(function () {
    "use strict";

    var RUFFLE_WASM = /^[0-9a-f]{20}\\.wasm$/;
    var RUFFLE_DIR = new URL("ruffle/", location.href).href;
    var bridge = window.ReactNativeWebView;
    var player = null;
    var started = false;
    var nextId = 0;
    var pending = new Map();
    var volume = null;
    var wantedVolume = null;

    function setVolume(value) {
        if (!player) return;
        var settings = player.volumeSettings;
        if (settings && typeof settings.volume === "number") {
            settings.volume = Math.round(value * 100);
            settings.isMuted = false;
        }
        player.volume = value;
        volume = player.volume;
    }

    function pollVolume() {
        if (!player) return;
        var v = player.volume;
        if (typeof v !== "number" || v === volume) return;
        volume = v;
        post({ type: "volume", value: v });
    }

    function post(msg) {
        bridge.postMessage(JSON.stringify(msg));
    }

    window.addEventListener("error", function (e) {
        post({ type: "error", message: String(e.message || e.error) });
    });
    window.addEventListener("unhandledrejection", function (e) {
        post({ type: "error", message: String(e.reason && (e.reason.stack || e.reason)) });
    });

    function readFile(url) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.responseType = "arraybuffer";
            xhr.onload = function () {
                if (xhr.response && (xhr.status === 0 || xhr.status === 200))
                    resolve(xhr.response);
                else reject(new TypeError("wasm unavailable"));
            };
            xhr.onerror = function () {
                reject(new TypeError("wasm unavailable"));
            };
            xhr.send();
        });
    }

    // Ruffle's wasm loader goes through fetch; serve its two files from the sandbox's
    // directory once the app has put them there, and refuse everything else.
    self.fetch = function (input) {
        // Ruffle passes a URL object; a Request has .url.
        var url = new URL(
            input instanceof Request ? input.url : String(input),
            location.href,
        ).href;
        var name = url.indexOf(RUFFLE_DIR) === 0 ? url.slice(RUFFLE_DIR.length) : "";
        if (!RUFFLE_WASM.test(name))
            return Promise.reject(new TypeError("no network in the sandbox"));
        var id = nextId++;
        return new Promise(function (resolve, reject) {
            pending.set(id, { resolve: resolve, reject: reject });
            post({ type: "wasm", id: id, name: name });
        })
            .then(function () {
                return readFile(RUFFLE_DIR + name);
            })
            .then(function (bytes) {
                return new Response(bytes, {
                    headers: { "Content-Type": "application/wasm" },
                });
            });
    };

    function bytesOf(base64) {
        if (typeof Uint8Array.fromBase64 === "function")
            return Uint8Array.fromBase64(base64);
        var text = atob(base64);
        var bytes = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
        return bytes;
    }

    function start(swf) {
        // Never scan this page for <object>/<embed> to take over.
        window.RufflePlayer = { config: { polyfills: false } };
        var script = document.createElement("script");
        script.src = "ruffle/ruffle.js";
        script.onload = function () {
            player = window.RufflePlayer.newest().createPlayer();
            player.style.width = "100%";
            player.style.height = "100%";
            document.body.appendChild(player);
            // Ruffle's own limits, kept behind the sandbox: no network
            // (URLLoader/Socket), no host script access (ExternalInterface),
            // no navigation via getURL.
            volume = player.volume;
            Promise.resolve(player.ruffle().load({
                data: swf,
                allowNetworking: "none",
                allowScriptAccess: false,
                openUrlMode: "deny",
            })).then(function () {
                if (wantedVolume !== null) setVolume(wantedVolume);
                else volume = player.volume;
            });
            post({ type: "ready" });
            setInterval(pollVolume, 1000);
        };
        document.head.appendChild(script);
    }

    function onAppMessage(e) {
        var msg;
        try {
            msg = typeof e.data === "string" ? JSON.parse(e.data) : null;
        } catch (err) {
            return;
        }
        if (!msg) return;
        if (msg.type === "init" && !started && typeof msg.swf === "string") {
            started = true;
            start(bytesOf(msg.swf));
        } else if (msg.type === "wasm" && pending.has(msg.id)) {
            var p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.available) p.resolve();
            else p.reject(new TypeError("wasm unavailable"));
        } else if (msg.type === "suspend" && player) {
            player.ruffle().suspend();
        } else if (msg.type === "volume" && typeof msg.value === "number" &&
                   msg.value >= 0 && msg.value <= 1) {
            wantedVolume = msg.value;
            setVolume(msg.value);
        }
    }
    // React Native's WebView dispatches to window on iOS, and on Android to document,
    // whence the event bubbles to window.
    window.addEventListener("message", onAppMessage);
})();
`;
