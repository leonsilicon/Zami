// Zami's patch to matrix-js-sdk's sync.js (patches/matrix-js-sdk@*.patch): a /sync response
// with thousands of rooms is processed a slice at a time, with turns of the event loop between.
import { createClient, type ISyncResponse } from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger.js";
import { SyncApi, defaultClientOpts, defaultSyncApiOpts } from "matrix-js-sdk/lib/sync.js";
import { describe, expect, test } from "vite-plus/test";

const ME = "@me:example.org";

function response(rooms: number): ISyncResponse {
  const join: Record<string, unknown> = {};
  for (let n = 0; n < rooms; n++) {
    const roomId = `!room${n}:example.org`;
    join[roomId] = {
      state: {
        events: [
          {
            type: "m.room.create",
            state_key: "",
            content: { creator: ME },
            sender: ME,
            event_id: `$create-${n}`,
            origin_server_ts: 1,
          },
          {
            type: "m.room.member",
            state_key: ME,
            content: { membership: "join" },
            sender: ME,
            event_id: `$member-${n}`,
            origin_server_ts: 1,
          },
        ],
      },
      timeline: {
        events: [
          {
            type: "m.room.message",
            content: { msgtype: "m.text", body: `hello ${n}` },
            sender: ME,
            event_id: `$m-${n}`,
            origin_server_ts: 2,
          },
        ],
        prev_batch: `p${n}`,
      },
    };
  }
  return { next_batch: "s1", rooms: { join, invite: {}, leave: {}, knock: {} } } as never;
}

describe("matrix-js-sdk sync.js patch", () => {
  test("processes every room of a large response, giving the event loop turns in between", async () => {
    const client = createClient({ baseUrl: "https://example.org", userId: ME, deviceId: "DEV" });
    const api = new SyncApi(client, defaultClientOpts({}), defaultSyncApiOpts({ logger }));
    let turns = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      turns++;
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    await (
      api as unknown as {
        processSyncResponse(data: object, response: ISyncResponse): Promise<void>;
      }
    ).processSyncResponse({ nextSyncToken: "s1", catchingUp: false }, response(1500));
    done = true;
    expect(client.getRooms()).toHaveLength(1500);
    expect(
      client.getRoom("!room1499:example.org")?.getLiveTimeline().getEvents().at(-1)?.getId(),
    ).toBe("$m-1499");
    // Without the patch nothing else runs until the last room is done (0 turns).
    expect(turns).toBeGreaterThan(2);
  });
});
