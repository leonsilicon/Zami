import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createRecordSet, type RecordEntry } from "#record-set";

interface Item {
  id: string;
  body: string;
}

const NAMES = ["first-db", "rest-db"] as const;

function entries(items: { id: string; body: string; first: boolean }[]): RecordEntry<Item>[] {
  return items.map(({ id, body, first }) => ({
    id,
    fingerprint: body.length * 1000 + body.charCodeAt(0),
    first,
    build: vi.fn(() => ({ id, body })),
  }));
}

async function allKeys(name: string): Promise<string[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("store").objectStore("store").getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRecordSet", () => {
  test("saves the first part and the rest apart, and reads them back", async () => {
    const set = createRecordSet<{ n: number }, Item>({ dbNames: NAMES, storeName: "store" });
    await set.save(
      "acct",
      { n: 1 },
      entries([
        { id: "a", body: "alpha", first: true },
        { id: "b", body: "beta", first: false },
        { id: "c", body: "gamma", first: false },
      ]),
    );
    expect(await allKeys("first-db")).toEqual(["acct", "acct|a"]);
    expect(await allKeys("rest-db")).toEqual(["acct|b", "acct|c"]);

    const fresh = createRecordSet<{ n: number }, Item>({ dbNames: NAMES, storeName: "store" });
    const { head, records } = await fresh.loadFirst("acct");
    expect(head).toMatchObject({ v: 2, data: { n: 1 } });
    expect(records).toEqual([{ id: "a", body: "alpha" }]);
    expect(await fresh.loadRest("acct")).toEqual([
      { id: "b", body: "beta" },
      { id: "c", body: "gamma" },
    ]);
  });

  test("writes only what changed, moves records between parts and deletes what's gone", async () => {
    const set = createRecordSet<null, Item>({ dbNames: NAMES, storeName: "store" });
    await set.save(
      "acct",
      null,
      entries([
        { id: "a", body: "alpha", first: true },
        { id: "b", body: "beta", first: false },
        { id: "c", body: "gamma", first: false },
      ]),
    );
    // A fresh instance learns what's saved from the head it loads.
    const fresh = createRecordSet<null, Item>({ dbNames: NAMES, storeName: "store" });
    await fresh.loadFirst("acct");
    const next = entries([
      { id: "a", body: "alpha", first: true },
      { id: "b", body: "beta", first: true },
      { id: "d", body: "delta!", first: false },
    ]);
    await fresh.save("acct", null, next);
    expect(next.map((e) => vi.mocked(e.build).mock.calls.length)).toEqual([0, 1, 1]);
    expect(await allKeys("first-db")).toEqual(["acct", "acct|a", "acct|b"]);
    expect(await allKeys("rest-db")).toEqual(["acct|d"]);

    // Nothing changed: nothing written, not even the head.
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await fresh.save("acct", null, next);
    expect(put).not.toHaveBeenCalled();
  });

  test("replaces an older format's records and drops records it doesn't know", async () => {
    const set = createRecordSet<null, Item>({ dbNames: NAMES, storeName: "store" });
    // What older code saved: the first part's rooms in the head, the rest in one record.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("rest-db", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("store");
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("store", "readwrite");
    transaction.objectStore("store").put({ v: 1, rooms: [] }, "acct");
    transaction.objectStore("store").put({ id: "stale", body: "" }, "acct|stale");
    await new Promise((resolve) => (transaction.oncomplete = resolve));
    db.close();

    await set.save("acct", null, entries([{ id: "a", body: "alpha", first: false }]));
    expect(await allKeys("rest-db")).toEqual(["acct|a"]);
  });

  test("stops without a new head once the caller is no longer current", async () => {
    const set = createRecordSet<null, Item>({ dbNames: NAMES, storeName: "store" });
    let current = true;
    const items = entries(
      Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, body: `body ${i}`, first: false })),
    );
    const done = set.save("acct", null, items, {
      isCurrent: () => current,
      yielder: {
        get due() {
          return true;
        },
        next: () => {
          current = false;
          return Promise.resolve();
        },
      },
    });
    expect(await done).toBe(false);
    expect(await allKeys("first-db")).not.toContain("acct");
  });

  test("delete removes the head and every record, and nothing else", async () => {
    const set = createRecordSet<null, Item>({ dbNames: NAMES, storeName: "store" });
    await set.save("acct", null, entries([{ id: "a", body: "alpha", first: true }]));
    await set.save("other", null, entries([{ id: "b", body: "beta", first: false }]));
    await set.delete("acct");
    expect(await allKeys("first-db")).toEqual(["other"]);
    expect(await allKeys("rest-db")).toEqual(["other|b"]);
  });
});
