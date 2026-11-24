// The launch's first requests in a page's place: which ones are sent as it starts, when
// the app is handed an answer and when it asks the server itself, and what's kept for the
// launch after. (A stand-in page: the timing is measured in a browser.)
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { test } from "vite-plus/test";
import { bootstrapScript } from "#bootstrap";
import { launchRequestsScript } from "#launch-requests";

const USER = "@alice:example.org";
const DEVICE = "DEVICE";
const HOMESERVER = "https://matrix.example.org";
const BASE = `${HOMESERVER}/_matrix/`;
const TOKEN = "secret";
const PUSH_RULES = `${BASE}client/v3/pushrules/`;
const FILTER = `${BASE}client/v3/user/${encodeURIComponent(USER)}/filter/f1`;
const SYNC_BEFORE = `${BASE}client/v3/sync?filter=f1&timeout=0&set_presence=online&since=`;
const sync = (since: string) => SYNC_BEFORE + since;

const plan = {
  userId: USER,
  deviceId: DEVICE,
  base: BASE,
  requests: [PUSH_RULES, FILTER],
  syncBefore: SYNC_BEFORE,
  syncAfter: "",
};

interface Sent {
  url: string;
  authorization: string | undefined;
  method: string;
  signal?: AbortSignal;
}

interface Page {
  account?: Record<string, unknown> | null;
  plan?: unknown;
  /** The token of the sync the app saved, by account and device. */
  saved?: Record<string, string>;
  search?: string;
  now?: number;
  /** What the server answers a URL with (a 200 with `{}` otherwise), or "fail". */
  answers?: Record<string, { status?: number; body?: string } | "fail" | "never">;
}

function open(options: Page = {}) {
  const sent: Sent[] = [];
  const timers: Array<{ run: () => void; ms: number } | null> = [];
  const marks: string[] = [];
  const storage: Record<string, string> = {};
  const account =
    options.account === undefined
      ? { userId: USER, accessToken: TOKEN, deviceId: DEVICE, homeserverUrl: HOMESERVER }
      : options.account;
  storage.matrix_accounts = JSON.stringify({
    version: 1,
    activeUserId: account ? account.userId : null,
    accounts: account ? [account] : [],
  });
  if (options.plan !== undefined) storage.zami_launch_requests = JSON.stringify(options.plan);
  if (options.saved) storage.zami_saved_sync_token = JSON.stringify(options.saved);

  const server = (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    sent.push({
      url,
      authorization: headers.Authorization,
      method: init.method ?? "GET",
      signal: init.signal ?? undefined,
    });
    const answer = options.answers?.[url];
    if (answer === "fail") return Promise.reject(new TypeError("Load failed"));
    if (answer === "never") return new Promise(() => {});
    return Promise.resolve(
      new Response(answer?.body ?? "{}", {
        status: answer?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  const window: Record<string, unknown> = {
    fetch: server,
    Response,
    AbortController,
    DOMException,
    URLSearchParams,
    Date: { now: () => options.now ?? 1000 },
    setTimeout: (run: () => void, ms: number) => timers.push({ run, ms }),
    clearTimeout: (id: number) => {
      timers[id - 1] = null;
    },
    performance: { mark: (name: string) => marks.push(name) },
    location: { search: options.search ?? "" },
    localStorage: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    },
  };
  window.window = window;
  runInContext(launchRequestsScript(), createContext(window));
  /** The app's request, as the SDK makes it. */
  const ask = (url: string, init: RequestInit = {}) =>
    (window.fetch as typeof fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
      ...init,
    });
  /** Runs the timers set for `ms` (none of them runs on its own). */
  const after = (ms: number) => {
    for (const timer of timers.splice(0)) if (timer?.ms === ms) timer.run();
  };
  const savedPlan = () => JSON.parse(storage.zami_launch_requests ?? "null") as typeof plan | null;
  return { window, sent, ask, after, marks, savedPlan, server };
}

const key = `${USER}|${DEVICE}`;
/** A value made in the page, as one made here (the page's objects are another realm's). */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("the launch before's requests go out as the page starts, with the saved sync's token", () => {
  const { sent, marks } = open({ plan, saved: { [key]: "s72_5" } });
  assert.deepEqual(
    sent.map((request) => request.url),
    [PUSH_RULES, FILTER, sync("s72_5")],
  );
  for (const request of sent) {
    assert.equal(request.authorization, `Bearer ${TOKEN}`);
    assert.equal(request.method, "GET");
  }
  assert.deepEqual(marks, ["zami-connect:sent"]);
});

test("the token is written into the query as the SDK writes it", () => {
  const { sent } = open({ plan: { ...plan, requests: [] }, saved: { [key]: "a b/c+d" } });
  assert.deepEqual(
    sent.map((request) => request.url),
    [sync("a+b%2Fc%2Bd")],
  );
});

test("the app is handed the answer to exactly the request that was sent", async () => {
  const body = JSON.stringify({ next_batch: "s73_1", rooms: {} });
  const { sent, ask, marks } = open({
    plan,
    saved: { [key]: "s72_5" },
    answers: { [sync("s72_5")]: { body } },
  });
  const response = await ask(sync("s72_5"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(plain(await response.json()), { next_batch: "s73_1", rooms: {} });
  assert.equal(await response.text(), body);
  assert.deepEqual(plain(await (await ask(PUSH_RULES)).json()), {});
  // Nothing was asked of the server twice.
  assert.equal(sent.length, 3);
  assert.ok(marks.includes("zami-connect:answered"));
  assert.ok(marks.includes("zami-connect:taken"));
  // An answer is handed over once: asking again asks the server.
  await ask(PUSH_RULES);
  assert.equal(sent.length, 4);
});

test("a request that differs is the app's own", async () => {
  const { sent, ask } = open({ plan, saved: { [key]: "s72_5" } });
  // The store had another sync saved than the token said.
  await ask(sync("s80_1"));
  // Another access token (it was refreshed, or it's another account's client).
  await ask(PUSH_RULES, { headers: { Authorization: "Bearer other" } });
  // Not a read.
  await ask(FILTER, { method: "POST" });
  assert.deepEqual(
    sent.slice(3).map((request) => [request.method, request.url, request.authorization]),
    [
      ["GET", sync("s80_1"), `Bearer ${TOKEN}`],
      ["GET", PUSH_RULES, "Bearer other"],
      ["POST", FILTER, `Bearer ${TOKEN}`],
    ],
  );
});

test("what the server refused or never answered is asked again by the app", async () => {
  const { sent, ask } = open({
    plan,
    saved: { [key]: "s72_5" },
    answers: {
      [PUSH_RULES]: { status: 401, body: '{"errcode":"M_UNKNOWN_TOKEN"}' },
      [FILTER]: "fail",
    },
  });
  // The app's own request gets what the server says, to handle as it does.
  assert.equal((await ask(PUSH_RULES)).status, 401);
  await assert.rejects(ask(FILTER), /Load failed/);
  assert.deepEqual(
    sent.slice(3).map((request) => request.url),
    [PUSH_RULES, FILTER],
  );
});

test("a request that takes too long is given up", () => {
  const { sent, after } = open({
    plan: { ...plan, requests: [PUSH_RULES] },
    answers: { [PUSH_RULES]: "never" },
  });
  assert.equal(sent[0]?.signal?.aborted, false);
  after(20_000);
  assert.equal(sent[0]?.signal?.aborted, true);
});

test("the app can give up on an answer it's waiting for", async () => {
  const { ask } = open({
    plan: { ...plan, requests: [PUSH_RULES] },
    answers: { [PUSH_RULES]: "never" },
  });
  const controller = new AbortController();
  const asked = ask(PUSH_RULES, { signal: controller.signal });
  controller.abort(new Error("timed out"));
  await assert.rejects(asked, /timed out/);
});

test("nothing is sent without a restored account, a plan of its own, or a token that works", () => {
  assert.deepEqual(open({ plan, account: null }).sent, []);
  assert.deepEqual(open({ plan, search: "?add" }).sent, []);
  assert.deepEqual(open({ plan, search: "?state=abc&code=def" }).sent, []);
  assert.deepEqual(open({}).sent, []);
  assert.deepEqual(open({ plan: { ...plan, userId: "@bob:example.org" } }).sent, []);
  assert.deepEqual(open({ plan: { ...plan, deviceId: "OTHER" } }).sent, []);
  assert.deepEqual(
    open({ plan: { ...plan, base: "https://elsewhere.example/_matrix/" } }).sent,
    [],
  );
  const expired = {
    userId: USER,
    accessToken: TOKEN,
    deviceId: DEVICE,
    homeserverUrl: HOMESERVER,
    accessTokenExpiresAt: 500,
  };
  assert.deepEqual(open({ plan, account: expired }).sent, []);
  assert.equal(open({ plan, account: { ...expired, accessTokenExpiresAt: 5000 } }).sent.length, 2);
  // Without the saved sync's token, there's no sync to ask for.
  assert.deepEqual(
    open({ plan, saved: { "@bob:example.org|DEVICE": "s1" } }).sent.map((request) => request.url),
    [PUSH_RULES, FILTER],
  );
});

test("the access token only ever goes to the account's homeserver", () => {
  const elsewhere = "https://elsewhere.example/_matrix/client/v3/pushrules/";
  const { sent } = open({
    plan: {
      ...plan,
      requests: [elsewhere, PUSH_RULES],
      syncBefore: "https://elsewhere.example/sync?since=",
    },
    saved: { [key]: "s1" },
  });
  assert.deepEqual(
    sent.map((request) => request.url),
    [PUSH_RULES],
  );
});

test("what the app asks for as it connects is kept for the next launch", async () => {
  const { ask, savedPlan, window, server } = open({});
  const other = `${BASE}client/v3/pushrules/global/override/.m.rule.master`;
  await ask(PUSH_RULES);
  await ask(other);
  await ask(FILTER);
  await ask(PUSH_RULES);
  assert.equal(savedPlan(), null);
  await ask(`${SYNC_BEFORE}s72_5&x=1`);
  assert.deepEqual(savedPlan(), { ...plan, syncAfter: "&x=1" });
  // The connection is made: the page's fetch is its own again.
  assert.equal(window.fetch, server);
});

test("a first sync with nothing saved, or sliding sync, leaves no plan", async () => {
  const initial = open({ plan });
  await initial.ask(`${BASE}client/v3/sync?filter=%7B%7D&timeout=0&_cacheBuster=1`);
  assert.equal(initial.savedPlan(), null);
  const sliding = open({ plan });
  await sliding.ask(`${BASE}client/unstable/org.matrix.simplified_msc3575/sync?timeout=0`, {
    method: "POST",
  });
  assert.equal(sliding.savedPlan(), null);
  // The long poll that follows a first sync isn't the launch's.
  const later = open({});
  await later.ask(`${BASE}client/v3/sync?filter=f1&timeout=30000&since=s1`);
  assert.equal(later.savedPlan(), null);
});

test("the page's fetch is its own once every answer is taken or dropped", async () => {
  const { ask, after, window, server } = open({ plan, saved: { [key]: "s72_5" } });
  await ask(sync("s72_5"));
  assert.notEqual(window.fetch, server);
  await ask(PUSH_RULES);
  // The filter's answer is never asked for.
  after(120_000);
  assert.equal(window.fetch, server);
});

test("a page without an account keeps its fetch", () => {
  const { window, server } = open({ account: null });
  assert.equal(window.fetch, server);
});

test("the bootstrap sends the requests before anything else", () => {
  const script = bootstrapScript({ platform: "ios", appId: "com.leonsilicon.zami", headers: [] });
  assert.ok(script.startsWith(launchRequestsScript()));
});
