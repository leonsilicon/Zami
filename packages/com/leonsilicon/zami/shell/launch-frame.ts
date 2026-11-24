// The launch frame: the app as it last looked, drawn before any of the web app's code has
// loaded. The page saves a copy of its DOM as it's left (@-/com.leonsilicon.zami.plugins,
// launch.ts), the shell keeps it (launch-store.ts) and hands it back in the script the next
// launch's page runs first, so the first frame the WebView paints is already the app, with
// a composer that takes typing. The app takes over once its own shell has drawn the same
// thing underneath, and carries over what was typed.
//
// Like the bootstrap it follows, this is plain ES2017 in a string: it runs in the page.
// __tests__/launch-frame.test.ts runs it against a DOM.

/** The largest page the shell keeps (UTF-16 units of its JSON). */
export const MAX_LAUNCH_PAGE_LENGTH = 3_000_000;

const SOURCE = String.raw`(function (saved) {
  "use strict";
  if (window.__zamiLaunch) return;
  var page;
  try {
    page = JSON.parse(saved);
  } catch (error) {
    return;
  }
  if (!page || typeof page.html !== "string") return;

  function post(message) {
    var native = window.ReactNativeWebView;
    if (native && typeof native.postMessage === "function") native.postMessage(JSON.stringify(message));
    else setTimeout(function () { post(message); }, 10);
  }
  function mark(step) {
    try {
      performance.mark("zami-launch:" + step);
    } catch (error) {}
  }

  // This build of the web app: its entry chunks, whose names are hashes of their content.
  function buildKey() {
    var paths = [];
    var links = document.querySelectorAll('link[rel="modulepreload"]');
    for (var i = 0; i < links.length; i++) {
      var path = new URL(links[i].href, location.href).pathname;
      if (path.indexOf("/entry/") !== -1) paths.push(path);
    }
    return paths.sort().join("|");
  }

  // Whether this launch opens on what the page shows: the same account, restored by the same
  // build at the same width, with the same home registered (and not past its time).
  function fits() {
    try {
      var parameters = new URLSearchParams(location.search);
      if (parameters.has("add") || parameters.has("state")) return false;
      var registry = JSON.parse(localStorage.getItem("matrix_accounts") || "null");
      if (!registry || registry.activeUserId !== page.userId) return false;
      if (Math.abs(page.width - window.innerWidth) > 1) return false;
      if (typeof page.until === "number" && page.until <= Date.now()) return false;
      if (page.build !== buildKey()) return false;
      var homes = JSON.parse(localStorage.getItem("zami_home") || "{}") || {};
      return JSON.stringify(homes[page.userId] || null) === page.homeKey;
    } catch (error) {
      return false;
    }
  }

  function text(composer) {
    return composer ? composer.innerText.replace(/\n$/, "") : "";
  }

  var settled = false;
  function draw() {
    if (settled || !document.body) return;
    settled = true;
    if (!fits()) return;

    var element = document.createElement("div");
    element.setAttribute("data-zami-launch", "");
    element.setAttribute("aria-busy", "true");
    // Under the layers plugins add, over everything of the app.
    element.style.cssText = "position:fixed;inset:0;z-index:2147482000;contain:strict;";

    var root = document.documentElement;
    Object.keys(page.rootAttributes || {}).forEach(function (name) {
      if (!root.hasAttribute(name)) root.setAttribute(name, page.rootAttributes[name]);
    });
    var loaded = {};
    var links = document.querySelectorAll('link[rel~="stylesheet"]');
    for (var i = 0; i < links.length; i++) loaded[new URL(links[i].href, location.href).pathname] = true;
    (page.stylesheets || []).forEach(function (href) {
      if (loaded[href]) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    });
    (page.styles || []).forEach(function (css) {
      var style = document.createElement("style");
      style.textContent = css;
      element.appendChild(style);
    });
    var content = document.createElement("div");
    content.innerHTML = page.html;
    while (content.firstChild) element.appendChild(content.firstChild);

    var images = element.querySelectorAll("img");
    for (var j = 0; j < images.length; j++) {
      images[j].addEventListener("error", function (event) {
        event.target.style.visibility = "hidden";
      });
    }

    var composer = element.querySelector('[data-zami-launch-region="composer"] [contenteditable]');
    if (composer) composer.setAttribute("contenteditable", "true");
    var send = element.querySelector("[data-zami-launch-send]");
    if (send) send.removeAttribute("disabled");

    var launch = {
      element: element,
      composer: composer,
      composerText: text(composer),
      roomId: page.roomId,
      // The send button was pressed: the app sends what was typed once it has taken over.
      sendRequested: false,
      text: function () { return text(composer); },
      dismiss: dismiss,
    };

    // Nothing in the page acts but the composer, and its send button: no handler came with
    // the copy, and a link mustn't navigate. Its events don't reach the app's listeners.
    ["click", "auxclick", "dblclick", "contextmenu", "submit"].forEach(function (type) {
      element.addEventListener(type, function (event) {
        event.stopPropagation();
        var target = event.target instanceof Element ? event.target : null;
        if (type === "click" && send && target && send.contains(target) && text(composer).trim()) {
          launch.sendRequested = true;
          send.style.opacity = "0.4";
        }
        if (!(target && target.closest("[contenteditable]"))) event.preventDefault();
      }, true);
    });
    ["keydown", "keyup", "keypress", "beforeinput", "input", "paste"].forEach(function (type) {
      element.addEventListener(type, function (event) {
        event.stopPropagation();
        if (type === "keydown" && event.key === "Tab") event.preventDefault();
      });
    });

    document.body.appendChild(element);
    var scrolled = element.querySelectorAll("[data-zami-launch-scroll]");
    for (var k = 0; k < scrolled.length; k++) {
      var parts = (scrolled[k].getAttribute("data-zami-launch-scroll") || "").split(",");
      scrolled[k].scrollLeft = Number(parts[1]) || 0;
      // The app opens a room at its newest message, so that's where a timeline that was
      // there is put, whatever the window's height is now.
      scrolled[k].scrollTop = parts[2] ? scrolled[k].scrollHeight : Number(parts[0]) || 0;
    }

    var dismissed = false;
    // The app takes the frame off itself (launch.ts). If it never gets to, show what did load.
    var fallback = setTimeout(function () { dismiss(true); }, 30000);
    function dismiss(fade) {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(fallback);
      mark("dismissed");
      if (window.__zamiLaunch === launch) window.__zamiLaunch = null;
      if (!fade) {
        element.remove();
        return;
      }
      element.style.pointerEvents = "none";
      element.style.transition = "opacity 120ms ease-out";
      element.style.opacity = "0";
      setTimeout(function () { element.remove(); }, 160);
    }

    window.__zamiLaunch = launch;
    mark("drawn");
    // Once it has painted, the shell shows the web view (it covers it until then).
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        post({ type: "zami", event: "launchDrawn" });
      });
    });
  }

  // As soon as there's a body to draw into: the head has been read by then (the build's
  // links), and the app's stylesheets hold back the first paint until they've loaded.
  if (document.body) draw();
  else {
    var observer = new MutationObserver(function () {
      if (!document.body) return;
      observer.disconnect();
      draw();
    });
    observer.observe(document.documentElement, { childList: true });
    document.addEventListener("DOMContentLoaded", function () {
      observer.disconnect();
      draw();
    });
  }
})`;

/** The script that draws a saved launch page (its JSON), to run after the bootstrap. */
export function launchFrameScript(page: string | null): string {
  if (page === null || page.length === 0 || page.length > MAX_LAUNCH_PAGE_LENGTH) return "";
  return `${SOURCE}(${JSON.stringify(page)});`;
}
