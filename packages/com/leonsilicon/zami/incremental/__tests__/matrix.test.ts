import { flushSync } from "svelte";
import { describe, expect, test } from "vite-plus/test";
import { ClientEvent, RoomEvent, RoomStateEvent } from "matrix-js-sdk";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { clientRevision, membershipRevision, roomStateRevision } from "#matrix";
import { createThrottledRuneStore } from "#throttled-rune.svelte";

const event = (type: string) => ({ getType: () => type });

/** Just enough of an event emitter for the counters' listeners. */
class EventEmitter {
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  on(name: string, listener: (...args: unknown[]) => void): this {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    return this;
  }
  emit(name: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(name) ?? []) listener(...args);
  }
}

describe("roomStateRevision", () => {
  test("grows on each state update and timeline reset of that room only", () => {
    const room = new EventEmitter() as unknown as Room;
    const other = new EventEmitter() as unknown as Room;
    const start = roomStateRevision(room);
    expect(roomStateRevision(room)).toBe(start);
    (room as unknown as EventEmitter).emit(RoomStateEvent.Update);
    expect(roomStateRevision(room)).toBe(start + 1);
    (room as unknown as EventEmitter).emit(RoomEvent.TimelineReset);
    expect(roomStateRevision(room)).toBe(start + 2);
    roomStateRevision(other);
    (other as unknown as EventEmitter).emit(RoomStateEvent.Update);
    expect(roomStateRevision(room)).toBe(start + 2);
  });
});

describe("clientRevision", () => {
  test("counts only the watched state and account data types", () => {
    const emitter = new EventEmitter();
    const client = emitter as unknown as MatrixClient;
    const watch = {
      stateTypes: ["m.room.image_pack"],
      accountDataTypes: ["im.ponies.user_emotes"],
    };
    const start = clientRevision(client, watch);
    emitter.emit(RoomStateEvent.Events, event("m.room.member"));
    emitter.emit(ClientEvent.AccountData, event("m.direct"));
    emitter.emit(ClientEvent.Room);
    expect(clientRevision(client, watch)).toBe(start);
    emitter.emit(RoomStateEvent.Events, event("m.room.image_pack"));
    emitter.emit(ClientEvent.AccountData, event("im.ponies.user_emotes"));
    expect(clientRevision(client, watch)).toBe(start + 2);
  });

  test("with rooms, counts rooms coming and going and renames", () => {
    const emitter = new EventEmitter();
    const client = emitter as unknown as MatrixClient;
    const watch = { stateTypes: [], rooms: true };
    const start = clientRevision(client, watch);
    emitter.emit(ClientEvent.Room);
    emitter.emit(RoomEvent.MyMembership);
    emitter.emit(RoomEvent.Name);
    expect(clientRevision(client, watch)).toBe(start + 3);
  });
});

describe("membershipRevision", () => {
  test("grows for the asked-about user's membership and our own rooms", () => {
    const emitter = new EventEmitter();
    const client = emitter as unknown as MatrixClient;
    const start = membershipRevision(client, "@a:x");
    emitter.emit(RoomStateEvent.Members, {}, {}, { userId: "@b:x" });
    expect(membershipRevision(client, "@a:x")).toBe(start);
    emitter.emit(RoomStateEvent.Members, {}, {}, { userId: "@a:x" });
    expect(membershipRevision(client, "@a:x")).toBe(start + 1);
    emitter.emit(RoomEvent.MyMembership);
    emitter.emit(ClientEvent.AccountData, event("m.direct"));
    emitter.emit(ClientEvent.AccountData, event("m.push_rules"));
    expect(membershipRevision(client, "@a:x")).toBe(start + 3);
  });
});

describe("reading a revision in an effect", () => {
  test("runs the effect again when it grows, with no other trigger", () => {
    const room = new EventEmitter() as unknown as Room;
    const store = createThrottledRuneStore(() => roomStateRevision(room), { ms: 0 });
    let notified = 0;
    const stop = store.subscribe(() => notified++);
    const start = store.getSnapshot();
    (room as unknown as EventEmitter).emit(RoomStateEvent.Update);
    flushSync();
    expect(notified).toBe(1);
    expect(store.getSnapshot()).toBe(start + 1);
    stop();
  });
});
