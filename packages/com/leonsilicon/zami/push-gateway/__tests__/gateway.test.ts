import { describe, expect, test, vi } from "vite-plus/test";
import { createGateway, type GatewayOptions } from "#gateway";
import type { ExpoMessage } from "#expo";

const TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const OTHER_TOKEN = "ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]";
const APP_ID = "com.leonsilicon.zami";
const EXPO_URL = "https://expo.test/push/send";

function device(pushkey = TOKEN, payload: Record<string, unknown> = {}) {
  return {
    app_id: APP_ID,
    pushkey,
    pushkey_ts: 1_700_000_000,
    data: { format: "event_id_only", default_payload: payload },
  };
}

function notifyRequest(notification: unknown): Request {
  return new Request("https://gateway.test/_matrix/push/v1/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notification }),
  });
}

function eventPush(devices: unknown[], extra: Record<string, unknown> = {}) {
  return {
    event_id: "$event",
    room_id: "!room:example.org",
    counts: { unread: 3, missed_calls: 0 },
    prio: "high",
    devices,
    ...extra,
  };
}

/** Expo's push service, answering each request with `answer`'s response. */
function expo(answer: (messages: ExpoMessage[]) => Response = () => okTickets()) {
  const sent: { messages: ExpoMessage[]; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    expect(input).toBe(EXPO_URL);
    expect(typeof init.body).toBe("string");
    const messages = JSON.parse(init.body as string) as ExpoMessage[];
    sent.push({ messages, headers: new Headers(init.headers) });
    return answer(messages);
  });
  return { fetch, sent };
}

function okTickets(): Response {
  return Response.json({ data: [{ status: "ok", id: "receipt" }] });
}

function errorTicket(error: string): Response {
  return Response.json({
    data: [{ status: "error", message: "No", details: { error } }],
  });
}

function gateway(options: Partial<GatewayOptions> & Pick<GatewayOptions, "fetch">) {
  return createGateway({ appIds: [APP_ID], expoPushUrl: EXPO_URL, ...options });
}

describe("the push gateway", () => {
  test("answers Zam's health probe", async () => {
    const response = await createGateway()(new Request("https://gateway.test/health"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  test("sends an event's push to Expo as an alert, with the app's fields", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch, sent } = expo();
    const payload = {
      zam_account: "@alice:example.org",
      expo: { body: "New message", sound: "default", mutableContent: true },
    };
    const response = await gateway({ fetch, expoAccessToken: "secret" })(
      notifyRequest(eventPush([device(TOKEN, payload)])),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rejected: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(sent[0]?.messages).toEqual([
      {
        to: TOKEN,
        priority: "high",
        badge: 3,
        tag: "!room:example.org",
        threadId: "!room:example.org",
        body: "New message",
        sound: "default",
        mutableContent: true,
        data: {
          zam_account: "@alice:example.org",
          event_id: "$event",
          room_id: "!room:example.org",
          unread: 3,
          missed_calls: 0,
        },
      },
    ]);
  });

  test("sends no message content, and lets the app set only Expo's own fields", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch, sent } = expo();
    const payload = {
      expo: { to: OTHER_TOKEN, data: { x: 1 }, badge: 99, title: 7, unknown: "y", sound: null },
    };
    await gateway({ fetch })(
      notifyRequest(
        eventPush([device(TOKEN, payload)], {
          sender: "@bob:example.org",
          room_name: "Secret plans",
          content: { msgtype: "m.text", body: "the plans" },
        }),
      ),
    );

    const [message] = sent[0]?.messages ?? [];
    expect(message?.to).toBe(TOKEN);
    expect(message?.badge).toBe(3);
    expect(message?.title).toBeUndefined();
    expect(message?.sound).toBeNull();
    expect(message).not.toHaveProperty("unknown");
    expect(JSON.stringify(message)).not.toMatch(/plans|bob/);
  });

  test("sends a low-priority push at normal priority", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch, sent } = expo();
    await gateway({ fetch })(notifyRequest(eventPush([device()], { prio: "low" })));
    expect(sent[0]?.messages[0]?.priority).toBe("normal");
  });

  test("sends a push without an event as a badge update only", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch, sent } = expo();
    const payload = { zam_account: "@alice:example.org", expo: { body: "New message" } };
    await gateway({ fetch })(
      notifyRequest({ counts: { unread: 0 }, devices: [device(TOKEN, payload)] }),
    );
    expect(sent[0]?.messages).toEqual([
      {
        to: TOKEN,
        badge: 0,
        priority: "normal",
        data: { zam_account: "@alice:example.org", unread: 0 },
      },
    ]);
  });

  test("sends nothing for a push with neither an event nor counts", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch } = expo();
    const response = await gateway({ fetch })(notifyRequest({ devices: [device()] }));
    expect(await response.json()).toEqual({ rejected: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects a pushkey Expo says is dead", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch } = expo(() => errorTicket("DeviceNotRegistered"));
    const response = await gateway({ fetch })(notifyRequest(eventPush([device()])));
    expect(await response.json()).toEqual({ rejected: [TOKEN] });
  });

  test("rejects pushkeys it can't deliver to, without asking Expo", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch, sent } = expo();
    const otherApp = { ...device(OTHER_TOKEN), app_id: "moe.crafty.matrix" };
    const fcmToken = device("fcm-registration-token");
    const response = await gateway({ fetch })(
      notifyRequest(eventPush([device(), otherApp, fcmToken])),
    );
    expect(await response.json()).toEqual({ rejected: [OTHER_TOKEN, "fcm-registration-token"] });
    expect(sent.map(({ messages }) => messages[0]?.to)).toEqual([TOKEN]);
  });

  test("serves any app id when none are configured", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch, sent } = expo();
    const otherApp = { ...device(), app_id: "com.example.other" };
    await createGateway({ fetch, expoPushUrl: EXPO_URL })(notifyRequest(eventPush([otherApp])));
    expect(sent).toHaveLength(1);
  });

  test("keeps a pusher whose message Expo refused for another reason", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const tooBig = expo(() => errorTicket("MessageTooBig"));
    const response = await gateway({ fetch: tooBig.fetch })(notifyRequest(eventPush([device()])));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rejected: [] });

    const invalid = expo(() =>
      // Expo's answer to a message with an invalid field.
      Response.json(
        { errors: [{ code: "VALIDATION_ERROR", type: "USER", isTransient: false }] },
        { status: 400 },
      ),
    );
    const refused = await gateway({ fetch: invalid.fetch })(notifyRequest(eventPush([device()])));
    expect(refused.status).toBe(200);
    expect(await refused.json()).toEqual({ rejected: [] });
  });

  test("asks the homeserver to retry when Expo is unavailable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const answer of [
      () => new Response("Service Unavailable", { status: 503 }),
      () => Response.json({ errors: [{ code: "TOO_MANY_REQUESTS" }] }, { status: 429 }),
      () => Response.json({ errors: [{ code: "X", isTransient: true }] }, { status: 400 }),
    ]) {
      const { fetch } = expo(answer);
      const response = await gateway({ fetch })(notifyRequest(eventPush([device()])));
      expect(response.status).toBe(502);
    }
    const unreachable = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const response = await gateway({ fetch: unreachable })(notifyRequest(eventPush([device()])));
    expect(response.status).toBe(502);
  });

  test("logs counts and error codes, never pushkeys or ids", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetch } = expo(() => errorTicket("DeviceNotRegistered"));
    await gateway({ fetch })(notifyRequest(eventPush([device()])));
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toContain('"rejected":1');
    expect(logged).not.toMatch(/ExponentPushToken|\$event|!room/);
  });

  test("refuses requests that aren't Matrix notify requests", async () => {
    const handle = createGateway();
    const notifyUrl = "https://gateway.test/_matrix/push/v1/notify";
    const post = (body: string) => handle(new Request(notifyUrl, { method: "POST", body }));

    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ notification: {} }))).status).toBe(400);
    expect((await post(JSON.stringify({ notification: { devices: [{}] } }))).status).toBe(400);
    expect((await post("x".repeat(64 * 1024 + 1))).status).toBe(413);
    expect((await handle(new Request(notifyUrl))).status).toBe(405);
    expect((await handle(new Request("https://gateway.test/"))).status).toBe(404);
  });
});
