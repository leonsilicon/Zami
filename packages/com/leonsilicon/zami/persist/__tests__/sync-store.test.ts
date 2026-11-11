import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { ISyncResponse } from "matrix-js-sdk";
import { LocalIndexedDBStoreBackend } from "matrix-js-sdk/lib/store/indexeddb-local-backend.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { SlicedSyncBackend } from "#sync-store";

const ME = "@me:example.org";
const NOW = 1_700_000_000_000;

function roomJoin(n: number, events = 3) {
  const roomId = `!room${n}:example.org`;
  const state = (type: string, stateKey: string, content: object) => ({
    type,
    state_key: stateKey,
    content,
    sender: ME,
    event_id: `$${type}-${n}`,
    origin_server_ts: 1,
  });
  return [
    roomId,
    {
      state: {
        events: [
          state("m.room.create", "", { creator: ME }),
          state("m.room.member", ME, { membership: "join" }),
          state("m.room.name", "", { name: `Room ${n}` }),
        ],
      },
      timeline: {
        events: Array.from({ length: events }, (_, i) => ({
          type: "m.room.message",
          content: { msgtype: "m.text", body: `message ${i} in ${n}` },
          sender: ME,
          event_id: `$m${i}-${n}-${events}`,
          origin_server_ts: 1000 + i,
          // An age, which the accumulator stores as an absolute time.
          unsigned: i === 0 ? { age: 50 } : undefined,
        })),
        prev_batch: `p${n}`,
        limited: true,
      },
      ephemeral: {
        events: [
          {
            type: "m.receipt",
            content: {
              [`$m0-${n}-${events}`]: { "m.read": { [ME]: { ts: 5 } } },
            },
          },
        ],
      },
      account_data: { events: [{ type: "m.tag", content: { tags: { u: { order: n } } } }] },
      unread_notifications: { notification_count: n % 3, highlight_count: 0 },
      summary: { "m.joined_member_count": 2 },
    },
  ] as const;
}

function response(nextBatch: string, roomNumbers: number[], events = 3): ISyncResponse {
  return {
    next_batch: nextBatch,
    rooms: {
      join: Object.fromEntries(roomNumbers.map((n) => roomJoin(n, events))),
      invite: {
        "!invite:example.org": {
          invite_state: {
            events: [{ type: "m.room.member", state_key: ME, content: { membership: "invite" } }],
          },
        },
      },
      leave: {},
      knock: {},
    },
    account_data: {
      events: [{ type: "m.direct", content: { "@bob:example.org": ["!room1:example.org"] } }],
    },
  } as unknown as ISyncResponse;
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** What the stock backend would save for the same responses. */
async function stockSavedSync(responses: ISyncResponse[]) {
  const stock = new LocalIndexedDBStoreBackend(new IDBFactory(), "reference");
  await stock.connect();
  for (const data of responses) await stock.setSyncData(structuredClone(data));
  return stock.getSavedSync();
}

async function open(factory: IDBFactory, options = {}) {
  const backend = new SlicedSyncBackend(factory, "test", options);
  await backend.connect();
  return backend;
}

/** Every record of the SDK's "sync" object store. */
async function syncRecords(factory: IDBFactory): Promise<{ clobber: string }[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("matrix-js-sdk:test");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("sync").objectStore("sync").getAll();
      request.onsuccess = () => resolve(request.result as { clobber: string }[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("SlicedSyncBackend", () => {
  test("saves each room as a record and restores the same saved sync as the SDK", async () => {
    const factory = new IDBFactory();
    const responses = [response("s1", range(0, 60)), response("s2", [3, 7], 2)];
    const backend = await open(factory);
    for (const data of responses) await backend.setSyncData(structuredClone(data));
    await backend.syncToDatabase([]);
    await backend.flush();

    const records = await syncRecords(factory);
    expect(records.map((r) => r.clobber).filter((k) => k.startsWith("zami:room:"))).toHaveLength(
      61,
    );
    expect(records.find((r) => r.clobber === "zami:meta")).toEqual({
      clobber: "zami:meta",
      token: "s2",
    });

    const restored = await open(factory);
    expect(await restored.getNextBatchToken()).toBe("s2");
    expect(await restored.getSavedSync()).toEqual(await stockSavedSync(responses));
  });

  test("writes only the rooms that changed since the last save", async () => {
    const factory = new IDBFactory();
    const backend = await open(factory);
    await backend.setSyncData(response("s1", range(0, 40)));
    await backend.syncToDatabase([]);
    await backend.flush();

    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await backend.setSyncData({
      next_batch: "s2",
      rooms: { join: Object.fromEntries([roomJoin(5, 1)]) },
    } as unknown as ISyncResponse);
    await backend.syncToDatabase([]);
    await backend.flush();
    const written = put.mock.calls.map(([value]) => (value as { clobber?: string }).clobber);
    expect(written).toEqual(["zami:room:!room5:example.org", "zami:meta"]);
  });

  test("deletes the record of a room that was left", async () => {
    const factory = new IDBFactory();
    const backend = await open(factory);
    await backend.setSyncData(response("s1", range(0, 3)));
    await backend.syncToDatabase([]);
    await backend.flush();
    await backend.setSyncData({
      next_batch: "s2",
      rooms: { leave: { "!room1:example.org": {} } },
    } as unknown as ISyncResponse);
    await backend.syncToDatabase([]);
    await backend.flush();
    const keys = (await syncRecords(factory)).map((r) => r.clobber);
    expect(keys).not.toContain("zami:room:!room1:example.org");
    expect(keys).toContain("zami:room:!room2:example.org");
  });

  test("migrates the SDK's single record, and an older build then finds no saved sync", async () => {
    const factory = new IDBFactory();
    const responses = [response("s1", range(0, 30))];
    const stock = new LocalIndexedDBStoreBackend(factory, "test");
    await stock.connect();
    await stock.setSyncData(structuredClone(responses[0]!));
    await stock.syncToDatabase([]);
    await stock.destroy();

    const backend = await open(factory);
    const expected = await stockSavedSync(responses);
    expect(await backend.getSavedSync()).toEqual(expected);
    await backend.syncToDatabase([]);
    await backend.flush();
    await backend.destroy();
    const keys = (await syncRecords(factory)).map((r) => r.clobber);
    expect(keys).not.toContain("-");
    expect(keys.filter((k) => k.startsWith("zami:room:"))).toHaveLength(31);

    expect(await (await open(factory)).getSavedSync()).toEqual(expected);
    // A build from before this change must start over rather than misread the records.
    const older = new LocalIndexedDBStoreBackend(factory, "test");
    await older.connect();
    expect(await older.getSavedSync()).toBeNull();
  });

  test("accumulates a large response a slice at a time, with the same result", async () => {
    const factory = new IDBFactory();
    const responses = [response("s1", range(0, 10)), response("s2", range(0, 200), 4)];
    let turns = 0;
    const backend = await open(factory, {
      sliceMs: 0,
      schedule: (run: () => void) => {
        turns++;
        setTimeout(run, 0);
      },
    });
    for (const data of responses) await backend.setSyncData(structuredClone(data));
    await backend.syncToDatabase([]);
    await backend.flush();
    expect(turns).toBeGreaterThan(10);
    expect(await backend.getSavedSync()).toEqual(await stockSavedSync(responses));
  });

  test("never holds the sync loop: setSyncData and syncToDatabase return at once", async () => {
    const factory = new IDBFactory();
    const backend = await open(factory);
    await backend.setSyncData(response("s1", range(0, 100)));
    let saved = false;
    void backend.syncToDatabase([]).then(() => (saved = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(saved).toBe(true);
    // ...and the save itself still completes.
    await backend.flush();
    expect((await syncRecords(factory)).length).toBe(102);
  });
});
