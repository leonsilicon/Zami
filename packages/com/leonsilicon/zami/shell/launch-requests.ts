// The launch's first requests to the homeserver, sent before any of the web app's code has
// loaded. Reconnecting waits for three answers, one after the other: the account's push
// rules, its sync filter, then the sync that brings what changed since the app last ran.
// The SDK only asks once the web app has loaded, opened its stores and replayed the sync it
// saved, so the round trips started late and each waited for the one before. Here they go
// out together as the page starts, and each answer is handed to the app when it asks for
// exactly that request.
//
// Which requests those are comes from the launch before: the page records what the app
// asked for (`zami_launch_requests`), and the app keeps the token of the sync it saved where
// this script can read it without opening the store (`zami_saved_sync_token`, written by the
// zam.connect-at-launch codemod). A request the app doesn't ask for, or asks for with
// another URL or another access token, is never used: the app then asks the server itself.
// So is one that failed. A sync answer that's never taken is never acknowledged either,
// since only the next sync's token does that, so the server sends its contents again.
//
// Like the bootstrap, this is plain ES2017 in a string: it runs in the page.
// __tests__/launch-requests.test.ts runs it against a stand-in page.

const SOURCE = String.raw`(function () {
  "use strict";
  if (window.__zamiLaunchRequests) return;
  var nativeFetch = window.fetch;
  if (typeof nativeFetch !== "function") return;

  var PLAN_KEY = "zami_launch_requests";
  var TOKEN_KEY = "zami_saved_sync_token";
  // How long an answer is kept for the app to ask for it.
  var KEEP_MS = 120000;
  // How long a request may take: past it, the app asks the server itself.
  var GIVE_UP_MS = 20000;

  function mark(step) {
    try {
      performance.mark("zami-connect:" + step);
    } catch (error) {}
  }
  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (error) {
      return null;
    }
  }

  // The account this launch restores (none while signing in or adding an account).
  function restoredAccount() {
    try {
      var parameters = new URLSearchParams(location.search);
      if (parameters.has("add") || parameters.has("state")) return null;
    } catch (error) {
      return null;
    }
    var registry = read("matrix_accounts");
    var accounts = registry && Array.isArray(registry.accounts) ? registry.accounts : [];
    for (var i = 0; i < accounts.length; i++) {
      var candidate = accounts[i];
      if (!candidate || candidate.userId !== registry.activeUserId) continue;
      if (typeof candidate.accessToken !== "string" || typeof candidate.homeserverUrl !== "string") return null;
      // An access token that's known to have run out is refreshed by the app.
      if (typeof candidate.accessTokenExpiresAt === "number" && candidate.accessTokenExpiresAt <= Date.now()) return null;
      return candidate;
    }
    return null;
  }

  var account = restoredAccount();
  var base = account ? account.homeserverUrl.replace(/\/+$/, "") + "/_matrix/" : null;
  var authorization = account ? "Bearer " + account.accessToken : null;

  // url → { authorization, answer }: an answer is { status, statusText, headers, text },
  // or null when the request failed.
  var waiting = {};
  var sent = [];

  function send(url) {
    if (waiting[url]) return;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var entry = { authorization: authorization, answer: null };
    var giveUp = setTimeout(function () {
      if (controller) controller.abort();
    }, GIVE_UP_MS);
    entry.answer = nativeFetch
      .call(window, url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: authorization },
        mode: "cors",
        redirect: "follow",
        referrer: "",
        referrerPolicy: "no-referrer",
        credentials: "omit",
        signal: controller ? controller.signal : undefined,
      })
      .then(function (response) {
        // What the server refused is the app's to ask again and handle.
        if (!response.ok) return null;
        var headers = [];
        response.headers.forEach(function (value, name) {
          headers.push([name, value]);
        });
        return response.text().then(function (text) {
          return { status: response.status, statusText: response.statusText, headers: headers, text: text };
        });
      })
      .catch(function () {
        return null;
      })
      .then(function (answer) {
        clearTimeout(giveUp);
        if (answer && /\/sync\?/.test(url)) mark("answered");
        return answer;
      });
    waiting[url] = entry;
    sent.push(url);
    setTimeout(function () {
      if (waiting[url] !== entry) return;
      delete waiting[url];
      if (controller) controller.abort();
      settle();
    }, KEEP_MS);
  }

  // The plan the launch before left, with the token of the sync the app has saved since.
  function sendPlanned() {
    var plan = read(PLAN_KEY);
    if (!plan || plan.userId !== account.userId || plan.deviceId !== account.deviceId || plan.base !== base) return;
    var urls = Array.isArray(plan.requests) ? plan.requests.slice() : [];
    var tokens = read(TOKEN_KEY);
    var token = tokens && tokens[account.userId + "|" + account.deviceId];
    if (typeof token === "string" && token && typeof plan.syncBefore === "string" && typeof plan.syncAfter === "string") {
      // As the SDK writes a query (URLSearchParams).
      var since = new URLSearchParams({ since: token }).toString().slice(6);
      urls.push(plan.syncBefore + since + plan.syncAfter);
    }
    for (var i = 0; i < urls.length; i++) {
      // Only ever to the account's own homeserver: the request carries its access token.
      if (typeof urls[i] === "string" && urls[i].indexOf(base) === 0) send(urls[i]);
    }
    if (sent.length > 0) mark("sent");
  }

  // What the app asks for as it connects, for the next launch to send first.
  var recorded = { requests: [], done: false };
  function record(url, method) {
    if (recorded.done || url.indexOf(base) !== 0) return;
    var query = url.indexOf("?");
    var path = query === -1 ? url : url.slice(0, query);
    if (method === "GET" && (/\/pushrules\/$/.test(path) || /\/user\/[^/]+\/filter\/[^/]+$/.test(path))) {
      if (recorded.requests.indexOf(url) === -1) recorded.requests.push(url);
      return;
    }
    if (!/\/sync$/.test(path)) return;
    // The first sync ends the launch's connection, whichever kind it is.
    recorded.done = true;
    var since = method === "GET" && /[?&]timeout=0(&|$)/.test(url) ? /([?&]since=)([^&]*)/.exec(url) : null;
    try {
      // Only the sync that follows a saved one can be sent first: a first sync of another
      // kind (nothing saved yet, or sliding sync) leaves no plan.
      if (!since) localStorage.removeItem(PLAN_KEY);
      else {
        localStorage.setItem(PLAN_KEY, JSON.stringify({
          userId: account.userId,
          deviceId: account.deviceId,
          base: base,
          requests: recorded.requests,
          syncBefore: url.slice(0, since.index + since[1].length),
          syncAfter: url.slice(since.index + since[0].length),
        }));
      }
    } catch (error) {}
    settle();
  }

  function header(init, input, name) {
    var headers = (init && init.headers) || (input && typeof input === "object" && input.headers) || null;
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    if (Array.isArray(headers)) {
      for (var i = 0; i < headers.length; i++) {
        if (headers[i] && String(headers[i][0]).toLowerCase() === name) return String(headers[i][1]);
      }
      return null;
    }
    for (var key in headers) {
      if (key.toLowerCase() === name) return String(headers[key]);
    }
    return null;
  }

  // The answer, unless the app gives up on the request first.
  function taken(entry, signal) {
    if (!signal) return entry.answer;
    return new Promise(function (resolve, reject) {
      function aborted() {
        reject(signal.reason !== undefined ? signal.reason : new DOMException("The request was aborted", "AbortError"));
      }
      if (signal.aborted) return aborted();
      signal.addEventListener("abort", aborted);
      entry.answer.then(function (answer) {
        signal.removeEventListener("abort", aborted);
        resolve(answer);
      });
    });
  }

  function fetchAtLaunch(input, init) {
    var self = this;
    var args = arguments;
    if (header(init, input, "authorization") !== authorization) return nativeFetch.apply(self, args);
    var url = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : String(input);
    var method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
    var entry = method === "GET" ? waiting[url] : null;
    if (entry) delete waiting[url];
    record(url, method);
    if (!entry) return nativeFetch.apply(self, args);
    if (/\/sync\?/.test(url)) mark("taken");
    settle();
    return taken(entry, init && init.signal).then(function (answer) {
      if (!answer) return nativeFetch.apply(self, args);
      // A response without a body can't be given one.
      var body = answer.status === 204 || answer.status === 205 ? null : answer.text;
      var response = new Response(body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
      // The text is here already: read it without waiting for a turn of the event loop,
      // which the launch's own work on the main thread can hold up for a while.
      response.text = function () {
        return Promise.resolve(answer.text);
      };
      response.json = function () {
        return new Promise(function (resolve) {
          resolve(JSON.parse(answer.text));
        });
      };
      return response;
    });
  }

  // Once the connection is made and every answer is taken or dropped, the page's fetch is
  // its own again.
  function settle() {
    if (!recorded.done || Object.keys(waiting).length > 0) return;
    if (window.fetch === fetchAtLaunch) window.fetch = nativeFetch;
  }

  window.__zamiLaunchRequests = { sent: sent, waiting: waiting };
  if (!account) return;
  window.fetch = fetchAtLaunch;
  sendPlanned();
  // A launch that hasn't connected by now isn't one to learn from.
  setTimeout(function () {
    recorded.done = true;
    settle();
  }, KEEP_MS);
})();`;

/** The script that sends a launch's first requests: the first thing the page runs. */
export function launchRequestsScript(): string {
  return SOURCE;
}
