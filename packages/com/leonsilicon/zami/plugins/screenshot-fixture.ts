// A deterministic Matrix homeserver for the simulator-only screenshot bundle. The real
// client, classic sync and Svelte views render these events. No network or Matrix account.
import { conversationId, conversationName, studioId, studioName } from "#screenshot-scenes";

const server = "screenshots.invalid";
export const screenshotAccount = {
  homeserverUrl: `https://${server}`,
  userId: `@taylor:${server}`,
  deviceId: "ZAMISCREEN",
  accessToken: "screenshot-fixture",
  displayName: "Taylor",
};

const memberIds = {
  Taylor: screenshotAccount.userId,
  Alex: `@alex:${server}`,
  Priya: `@priya:${server}`,
  Morgan: `@morgan:${server}`,
};
type Member = keyof typeof memberIds;

const baseTime = new Date().setHours(9, 30, 0, 0);
const state = (
  id: string,
  type: string,
  content: Record<string, unknown>,
  stateKey = "",
  sender = memberIds.Alex,
) => ({
  event_id: "$" + id,
  origin_server_ts: baseTime,
  sender,
  state_key: stateKey,
  type,
  content,
});

function members(room: string) {
  return Object.entries(memberIds).map(([displayname, id]) =>
    state(
      `${room}-member-${displayname}`,
      "m.room.member",
      { membership: "join", displayname },
      id,
      id,
    ),
  );
}

const rooms = [
  { id: conversationId, name: conversationName, topic: "" },
  { id: `!book-club:${server}`, name: "Book club", topic: "What we’re reading next" },
  {
    id: `!shared-notes:${server}`,
    name: "Shared notes",
    topic: "A place for links and observations",
  },
];

const conversation: readonly (readonly [Member, string])[] = [
  ["Alex", "Saturday looks clear. Want to take the riverside trail?"],
  ["Taylor", "That sounds lovely. Meet at the north entrance at 10?"],
  ["Priya", "I found a little café near the bridge. We could stop there on the way back."],
  ["Morgan", "Perfect. I’m bringing my camera if anyone wants photos."],
  ["Priya", "I’ll bring the printed maps."],
];

const timeline = conversation.map(([member, body], index) => ({
  event_id: "$walk-" + index,
  origin_server_ts: baseTime + index * 60_000,
  sender: memberIds[member],
  type: "m.room.message",
  content: { msgtype: "m.text", body },
}));

function joined(events: ReturnType<typeof state>[], messages: typeof timeline = []) {
  return {
    state: { events },
    timeline: { events: messages, limited: false, prev_batch: "older" },
    account_data: { events: [] },
    ephemeral: { events: [] },
    summary: { "m.joined_member_count": Object.keys(memberIds).length },
    unread_notifications: { notification_count: 0, highlight_count: 0 },
  };
}

const space = [
  state("space-create", "m.room.create", {
    room_version: "10",
    creator: memberIds.Alex,
    type: "m.space",
  }),
  state("space-name", "m.room.name", { name: studioName }),
  state("space-topic", "m.room.topic", { topic: "Plans, field notes, and good company." }),
  ...members("space"),
  ...rooms.map(({ id }, index) =>
    state(`child-${index}`, "m.space.child", { via: [server], order: String(index) }, id),
  ),
];

const joinedRooms = {
  [studioId]: joined(space),
  ...Object.fromEntries(
    rooms.map(({ id, name, topic }, index) => [
      id,
      joined(
        [
          state(`room-${index}-create`, "m.room.create", {
            room_version: "10",
            creator: memberIds.Alex,
          }),
          state(`room-${index}-name`, "m.room.name", { name }),
          state(`room-${index}-topic`, "m.room.topic", { topic }),
          state(
            `room-${index}-parent`,
            "m.space.parent",
            { via: [server], canonical: true },
            studioId,
          ),
          ...members(`room-${index}`),
        ],
        id === conversationId ? timeline : [],
      ),
    ]),
  ),
};

const pushRules = { global: { content: [], override: [], room: [], sender: [], underride: [] } };
const oneTimeKeys = { signed_curve25519: 50 };

function shortPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, 15_000);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function installScreenshotHomeserver(): void {
  const fetchReal = globalThis.fetch.bind(globalThis);
  let deviceKeys: unknown;
  let nextBatch = 0;
  globalThis.fetch = async (input, init) => {
    // The app still loads packaged assets from its normal origin.
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== screenshotAccount.homeserverUrl) return fetchReal(input, init);
    const request = new Request(input, init);
    const path = url.pathname;
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    if (path.endsWith("/versions"))
      return json({ versions: ["v1.1", "v1.11"], unstable_features: {} });
    if (path.endsWith("/sync")) {
      const initial = !url.searchParams.get("since");
      if (!initial) await shortPoll(request.signal);
      return json({
        next_batch: `capture-${++nextBatch}`,
        rooms: initial ? { join: joinedRooms } : {},
        account_data: { events: [] },
        device_one_time_keys_count: oneTimeKeys,
      });
    }
    if (path.endsWith("/keys/upload")) {
      const keys = (await request.json()) as { device_keys?: unknown };
      if (keys.device_keys) deviceKeys = keys.device_keys;
      return json({ one_time_key_counts: oneTimeKeys });
    }
    if (path.endsWith("/keys/query"))
      return json({
        device_keys: deviceKeys
          ? { [screenshotAccount.userId]: { [screenshotAccount.deviceId]: deviceKeys } }
          : {},
        failures: {},
      });
    if (path.endsWith("/filter")) return json({ filter_id: "capture" });
    if (path.endsWith("/pushrules/")) return json(pushRules);
    if (path.endsWith("/joined_rooms")) return json({ joined_rooms: Object.keys(joinedRooms) });
    if (path.endsWith("/messages")) return json({ chunk: [], start: "older" });
    if (path.endsWith("/hierarchy")) return json({ rooms: [] });
    if (path.includes("/profile/")) return json({ displayname: "Taylor" });
    if (path.includes("/account_data/") && request.method === "GET")
      return json({ errcode: "M_NOT_FOUND", error: "No saved settings" }, 404);
    return json({});
  };
}
