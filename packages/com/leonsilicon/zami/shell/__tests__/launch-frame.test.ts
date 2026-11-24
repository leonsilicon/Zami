// The launch frame in a page's place: which launches it draws the saved page on, what it
// tells the shell, and how the app takes it off. (A stand-in DOM: the copy of the app it
// draws is checked in a browser.)
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { test } from "vite-plus/test";
import { bootstrapScript } from "#bootstrap";
import { launchFrameScript, MAX_LAUNCH_PAGE_LENGTH } from "#launch-frame";
import { parsePageMessage } from "#protocol";

const USER = "@alice:example.org";
const BUILD = "/_app/immutable/entry/app.1.js|/_app/immutable/entry/start.1.js";
const HOME = { roomId: "!today:example.org", spaceId: null, until: 5000, pluginId: "leon" };

const page = {
  userId: USER,
  build: BUILD,
  roomId: HOME.roomId,
  home: true,
  homeKey: JSON.stringify(HOME),
  until: 5000,
  width: 390,
  height: 844,
  savedAt: 1000,
  html: "<div>Home</div>",
  styles: [".leon-home {}"],
  stylesheets: ["/_app/immutable/assets/app.css"],
  rootAttributes: { "data-theme": "paper" },
};

class FakeElement {
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  removed = false;
  textContent = "";
  innerHTML = "";
  rel = "";
  href = "";
  firstChild = null;
  tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
  }
  addEventListener() {}
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  remove() {
    this.removed = true;
  }
}

interface Launch {
  width?: number;
  now?: number;
  search?: string;
  activeUserId?: string | null;
  homes?: Record<string, unknown>;
  entries?: string[];
}

function launch(saved: unknown, options: Launch = {}) {
  const posted: unknown[] = [];
  const body = new FakeElement("body");
  const root = new FakeElement("html");
  const head = new FakeElement("head");
  const storage: Record<string, string> = {
    matrix_accounts: JSON.stringify({
      version: 1,
      activeUserId: options.activeUserId === undefined ? USER : options.activeUserId,
      accounts: [],
    }),
    zami_home: JSON.stringify(options.homes ?? { [USER]: HOME }),
  };
  const entries = options.entries ?? [
    "/_app/immutable/entry/start.1.js",
    "/_app/immutable/chunks/a.js",
    "/_app/immutable/entry/app.1.js",
  ];
  const window: Record<string, unknown> = {
    JSON,
    URL,
    URLSearchParams,
    Object,
    Number,
    Math,
    Date: { now: () => options.now ?? 2000 },
    Element: FakeElement,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: (callback: () => void) => callback(),
    performance: { mark: () => {} },
    innerWidth: options.width ?? 390,
    location: { href: "zami://localhost/", search: options.search ?? "" },
    localStorage: { getItem: (key: string) => storage[key] ?? null },
    ReactNativeWebView: { postMessage: (raw: string) => posted.push(parsePageMessage(raw)) },
    document: {
      body,
      head,
      documentElement: root,
      createElement: (tag: string) => new FakeElement(tag),
      querySelectorAll: (selector: string) =>
        selector.includes("modulepreload") ? entries.map((href) => ({ href })) : [],
      addEventListener: () => {},
    },
  };
  window.window = window;
  runInContext(launchFrameScript(JSON.stringify(saved)), createContext(window));
  const frame = window.__zamiLaunch as
    | {
        element: FakeElement;
        roomId: string;
        sendRequested: boolean;
        dismiss(fade?: boolean): void;
      }
    | null
    | undefined;
  return { frame, posted, body, root, head, window };
}

test("a launch of the same account, build, width and home opens on the saved page", () => {
  const { frame, posted, body, root, head } = launch(page);
  assert.ok(frame);
  assert.equal(body.children[0], frame.element);
  assert.equal(frame.roomId, HOME.roomId);
  // The page's own styles come with it, and the stylesheet the launch hasn't loaded yet.
  assert.equal(frame.element.children[0]?.textContent, ".leon-home {}");
  assert.equal(head.children[0]?.href, "/_app/immutable/assets/app.css");
  assert.equal(root.attributes["data-theme"], "paper");
  // Once it has painted, the shell shows the web view.
  assert.deepEqual(posted, [{ type: "zami", event: "launchDrawn" }]);
});

test("the app takes the frame off", () => {
  const { frame, window } = launch(page);
  assert.ok(frame);
  frame.dismiss(false);
  assert.equal(frame.element.removed, true);
  assert.equal(window.__zamiLaunch, null);
});

test("another account's, build's or width's page isn't drawn, nor one past its time", () => {
  assert.equal(launch(page, { activeUserId: "@bob:example.org" }).frame, undefined);
  assert.equal(launch(page, { activeUserId: null }).frame, undefined);
  assert.equal(launch(page, { entries: ["/_app/immutable/entry/app.2.js"] }).frame, undefined);
  assert.equal(launch(page, { width: 844 }).frame, undefined);
  assert.equal(launch(page, { now: 5000 }).frame, undefined);
  assert.deepEqual(launch(page, { now: 5000 }).posted, []);
});

test("a home that changed or went doesn't open on the old one's page", () => {
  const moved = { ...HOME, roomId: "!tomorrow:example.org" };
  assert.equal(launch(page, { homes: { [USER]: moved } }).frame, undefined);
  assert.equal(launch(page, { homes: {} }).frame, undefined);
  // Without a home, the page is where the app was left.
  const left = { ...page, home: false, homeKey: "null", until: null };
  assert.ok(launch(left, { homes: {} }).frame);
  assert.equal(launch(left).frame, undefined);
});

test("signing in or adding an account shows the sign-in form, not the page", () => {
  assert.equal(launch(page, { search: "?add" }).frame, undefined);
  assert.equal(launch(page, { search: "?state=abc&code=def" }).frame, undefined);
});

test("the bootstrap carries the saved page, and nothing without one", () => {
  const config = { platform: "ios", appId: "com.leonsilicon.zami", headers: [] };
  const plain = bootstrapScript(config);
  assert.equal(bootstrapScript({ ...config, launchPage: null }), plain);
  const withPage = bootstrapScript({ ...config, launchPage: JSON.stringify(page) });
  assert.ok(withPage.startsWith(plain));
  assert.ok(withPage.endsWith(launchFrameScript(JSON.stringify(page))));
  // A page that isn't one, or is too large to be worth reading at every launch, is left out.
  assert.equal(launchFrameScript(""), "");
  assert.equal(launchFrameScript("x".repeat(MAX_LAUNCH_PAGE_LENGTH + 1)), "");
  assert.equal(launch("not a page").frame, undefined);
});

test("the page's launch messages are read", () => {
  assert.deepEqual(parsePageMessage('{"type":"zami","event":"launchPage","page":"{}"}'), {
    type: "zami",
    event: "launchPage",
    page: "{}",
  });
  assert.deepEqual(parsePageMessage('{"type":"zami","event":"launchPage","page":null}'), {
    type: "zami",
    event: "launchPage",
    page: null,
  });
  assert.equal(parsePageMessage('{"type":"zami","event":"launchPage","page":1}'), null);
});
