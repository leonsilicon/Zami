// The script the web app runs before any of its own: Capacitor's native side, as seen from
// the page. Zam reaches native code only through Capacitor (`@capacitor/core` and its
// plugins), which talks to the native side through `window.Capacitor`: the plugins the
// native side implements are listed in `PluginHeaders`, and calls go out through
// `nativePromise` / `nativeCallback` and come back through `fromNative`. Defining those
// here, over react-native-webview's messages, makes Zam take the paths it takes in a native
// app, with the plugins implemented in React Native (bridge.ts).
//
// It's plain ES2017 in a string: it runs in the page, and Hermes can't turn a function back
// into its source. __tests__/bootstrap.test.ts runs it against the real @capacitor/core.
import type { PluginHeader } from "#protocol";

export interface BootstrapConfig {
  /** What `Capacitor.getPlatform()` answers: "ios" or "android". */
  platform: string;
  /** The app's id (com.leonsilicon.zami, or .staging), for codemods that need it. */
  appId: string | null;
  headers: PluginHeader[];
}

const SOURCE = String.raw`(function (config) {
  "use strict";
  if (window.__zamiShell) return;

  // Messages wait, in order, until react-native-webview's postMessage exists (it's defined
  // by another document-start script, which may run after this one).
  var pending = [];
  var flushScheduled = false;
  function flush() {
    var native = window.ReactNativeWebView;
    if (!native || typeof native.postMessage !== "function") {
      if (!flushScheduled) {
        flushScheduled = true;
        setTimeout(function () {
          flushScheduled = false;
          flush();
        }, 10);
      }
      return;
    }
    while (pending.length > 0) native.postMessage(pending.shift());
  }
  function post(message) {
    pending.push(JSON.stringify(message));
    flush();
  }

  var callbacks = {};
  var nextId = 1;
  var cap = window.Capacitor || (window.Capacitor = {});
  cap.PluginHeaders = config.headers;
  cap.isLoggingEnabled = false;

  function toNative(pluginId, methodName, options, stored) {
    var callbackId = "zami" + nextId++;
    callbacks[callbackId] = stored;
    post({
      type: "capacitor",
      callbackId: callbackId,
      pluginId: pluginId,
      methodName: methodName,
      options: options || {},
    });
    return callbackId;
  }

  cap.toNative = toNative;
  cap.nativePromise = function (pluginId, methodName, options) {
    return new Promise(function (resolve, reject) {
      toNative(pluginId, methodName, options, { resolve: resolve, reject: reject });
    });
  };
  cap.nativeCallback = function (pluginId, methodName, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    return toNative(pluginId, methodName, options, { callback: callback });
  };
  cap.fromNative = function (result) {
    var stored = callbacks[result.callbackId];
    if (!stored) return;
    if (!result.save) delete callbacks[result.callbackId];
    if (stored.callback) {
      if (result.success) stored.callback(result.data);
      else stored.callback(null, result.error);
      return;
    }
    if (result.success) {
      stored.resolve(result.data);
      return;
    }
    var error = new Error((result.error && result.error.message) || "The native call failed");
    if (result.error) {
      error.code = result.error.code;
      error.data = result.error.data;
    }
    stored.reject(error);
  };

  // Capacitor's platform. Its own detection looks for its native bridges (androidBridge,
  // webkit.messageHandlers.bridge), which this isn't.
  window.CapacitorCustomPlatform = { name: config.platform, plugins: {} };

  // The page's theme colour (<meta name="theme-color">, which Zam updates with the
  // theme), for what the app draws around the web view.
  var lastTheme = null;
  function reportTheme() {
    var meta = document.querySelector('meta[name="theme-color"]');
    var color = meta && meta.getAttribute("content");
    if (color && color !== lastTheme) {
      lastTheme = color;
      post({ type: "zami", event: "theme", color: color });
    }
  }
  function watchTheme() {
    reportTheme();
    new MutationObserver(reportTheme).observe(document.head, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["content"],
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchTheme);
  else watchTheme();

  window.__zamiShell = {
    platform: config.platform,
    appId: config.appId,
    plugins: config.headers.map(function (h) { return h.name; }),
  };
})`;

/** The bootstrap for `config`, ready to run in the page. */
export function bootstrapScript(config: BootstrapConfig): string {
  return `${SOURCE}(${JSON.stringify(config)});`;
}
