// Revision counters for Matrix state, so a reader can tell in O(1) whether what it
// derives from could have changed, and redo the work only then. Each counter is a
// number that only grows: a memo keyed on it is fresh exactly while it is unchanged.
//
// Reading one inside a Svelte effect (a `useRune` getter) also subscribes to it, so the
// getter runs again when it grows, without waiting for a tick such as Zam's
// `roomsTick`. Listeners attach on the first read, so a counter costs nothing until
// something asks for it; nothing can be stale before then.
import { ClientEvent, RoomEvent, RoomStateEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import { createSubscriber } from "svelte/reactivity";

interface Counter {
  revision: number;
  /** Grows the revision and wakes the effects that read it. */
  bump: () => void;
  /** Wakes the effects that read it. */
  notify: () => void;
  /** Subscribes the running Svelte effect, if any. */
  track: () => void;
}

function createCounter(): Counter {
  const updates = new Set<() => void>();
  const counter: Counter = {
    revision: 0,
    bump() {
      counter.revision++;
      counter.notify();
    },
    notify() {
      for (const update of updates) update();
    },
    track: createSubscriber((update) => {
      updates.add(update);
      return () => updates.delete(update);
    }),
  };
  return counter;
}

const roomStates = new WeakMap<Room, Counter>();

/**
 * Grows on every change to `room`'s state: members joining, leaving or renamed, power
 * levels, and any other state event (one bump per batch the SDK applies).
 */
export function roomStateRevision(room: Room): number {
  let counter = roomStates.get(room);
  if (counter === undefined) {
    const created = createCounter();
    counter = created;
    roomStates.set(room, created);
    // The room re-emits its live state's events, also after a timeline reset swaps
    // the state object.
    room.on(RoomStateEvent.Update, created.bump);
    room.on(RoomEvent.TimelineReset, created.bump);
  }
  counter.track();
  return counter.revision;
}

/** What a `clientRevision` counts. Keep one object per use (a module constant). */
export interface ClientWatch {
  /** State event types, in any room. */
  stateTypes: readonly string[];
  /** Account data event types. */
  accountDataTypes?: readonly string[];
  /** Also count rooms joined, left, added or removed, and renamed. */
  rooms?: boolean;
}

const clientWatches = new WeakMap<MatrixClient, Map<ClientWatch, Counter>>();

/**
 * Grows when any room's state event of one of `watch.stateTypes` changes, or one of
 * its account data types, or (with `watch.rooms`) the set of rooms or a room's name.
 */
export function clientRevision(client: MatrixClient, watch: ClientWatch): number {
  let watches = clientWatches.get(client);
  if (watches === undefined) clientWatches.set(client, (watches = new Map()));
  let counter = watches.get(watch);
  if (counter === undefined) {
    const created = createCounter();
    counter = created;
    watches.set(watch, created);
    const stateTypes = new Set(watch.stateTypes);
    const accountDataTypes = new Set(watch.accountDataTypes ?? []);
    client.on(RoomStateEvent.Events, (event: MatrixEvent) => {
      if (stateTypes.has(event.getType())) created.bump();
    });
    // A reset timeline brings a new state object, possibly with new events in it.
    client.on(RoomEvent.TimelineReset, created.bump);
    if (accountDataTypes.size > 0) {
      client.on(ClientEvent.AccountData, (event: MatrixEvent) => {
        if (accountDataTypes.has(event.getType())) created.bump();
      });
    }
    if (watch.rooms === true) {
      client.on(ClientEvent.Room, created.bump);
      client.on(ClientEvent.DeleteRoom, created.bump);
      client.on(RoomEvent.MyMembership, created.bump);
      client.on(RoomEvent.Name, created.bump);
    }
  }
  counter.track();
  return counter.revision;
}

const memberships = new WeakMap<MatrixClient, { rooms: Counter; users: Map<string, number> }>();

/**
 * Grows when `userId`'s membership or name changes in any room, when our own
 * membership changes, when rooms come or go, or when `m.direct` changes: what the
 * rooms we share with someone depend on.
 */
export function membershipRevision(client: MatrixClient, userId: string): number {
  let entry = memberships.get(client);
  if (entry === undefined) {
    const created = { rooms: createCounter(), users: new Map<string, number>() };
    entry = created;
    memberships.set(client, created);
    client.on(
      RoomStateEvent.Members,
      (_event: MatrixEvent, _state: unknown, member: RoomMember) => {
        const count = created.users.get(member.userId);
        // Only users someone asked about: a busy account sees thousands of others.
        if (count === undefined) return;
        created.users.set(member.userId, count + 1);
        // Wakes every reader; those reading another user see the same sum.
        created.rooms.notify();
      },
    );
    client.on(ClientEvent.Room, created.rooms.bump);
    client.on(ClientEvent.DeleteRoom, created.rooms.bump);
    client.on(RoomEvent.MyMembership, created.rooms.bump);
    client.on(RoomEvent.TimelineReset, created.rooms.bump);
    client.on(ClientEvent.AccountData, (event: MatrixEvent) => {
      if (event.getType() === "m.direct") created.rooms.bump();
    });
  }
  if (!entry.users.has(userId)) entry.users.set(userId, 0);
  entry.rooms.track();
  // Both only grow, so their sum changes whenever either does.
  return entry.rooms.revision + entry.users.get(userId)!;
}
