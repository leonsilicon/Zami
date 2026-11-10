// Persisted snapshot of the room list (spaces, rooms, DMs, space tree, tags,
// names, avatars, unread counts) so the sidebar paints instantly on boot while
// sync, classic or sliding, catches up.
//
// The snapshot is materialised into detached `Room` objects that are NEVER put
// in the SDK store: a room already in the store is "not brand new" to both sync
// implementations, which then skip its back-pagination token and its
// ClientEvent.Room emission. client.ts instead consults these rooms as a
// read-only fallback for the room-list helpers until the real list is complete.

import {
    EventType,
    MatrixEvent,
    NotificationCountType,
    PendingEventOrdering,
    Room,
    type IEvent,
    type MatrixClient,
} from "matrix-js-sdk";
import { reportStorageError } from "$lib/stores/storageHealth.svelte";
import type { SpaceChildInfo } from "./client";

const SNAPSHOT_VERSION = 1;

// Everything the sidebar, space tree and room headers read from room state.
const CACHED_STATE_TYPES = new Set<string>([
    "m.room.create",
    "m.room.name",
    "m.room.avatar",
    "m.room.canonical_alias",
    "m.room.topic",
    "m.room.encryption",
    "m.room.tombstone",
    "m.room.join_rules",
    "m.room.power_levels",
    "m.space.parent",
    "m.space.child",
]);

// Global account data the room list depends on. Never secrets (4S, cross-
// signing): those must not be copied out of the SDK's own storage.
export const CACHED_ACCOUNT_DATA_TYPES = [
    EventType.Direct as string,
    "im.client.space_layout",
    "im.client.space_order",
];

// A DM with more joined members than this is a group chat; don't cache its
// whole member list.
const MAX_CACHED_MEMBERS = 8;

// Recent timeline events kept per room so a boot with no network can show the
// conversation instead of an empty pane. Wire events only: encrypted rooms
// cache the ciphertext the SDK's own store already holds. Decryption is NOT
// part of materialising (there is no decrypt call there): client.ts decrypts
// the room about to be opened before publishing the cache, then the rest in
// the background. Until that pass reaches an event, the timeline renders a
// neutral "decrypting" row, never the missing-keys copy.
const MAX_CACHED_EVENTS = 40;

interface CachedHero {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
}

interface CachedRoom {
    roomId: string;
    state: Partial<IEvent>[];
    accountData: Partial<IEvent>[];
    /** Newest-last slice of the live timeline (see MAX_CACHED_EVENTS). */
    timeline?: Partial<IEvent>[];
    heroes?: CachedHero[];
    joined?: number;
    invited?: number;
    total?: number;
    highlight?: number;
}

export interface RoomListSnapshot {
    v: number;
    savedAt: number;
    accountData: Partial<IEvent>[];
    rooms: CachedRoom[];
    /** Last /hierarchy result per space (client.ts owns the shape). */
    hierarchies?: Record<string, SpaceChildInfo[]>;
}

export interface MaterializedCache {
    rooms: Map<string, Room>;
    accountData: Map<string, MatrixEvent>;
}

function rawOf(ev: MatrixEvent): Partial<IEvent> {
    return { ...ev.event };
}

/** Snapshot the joined rooms of a client whose room list is complete. */
export function buildSnapshot(
    client: MatrixClient,
    accountDataTypes: readonly string[] = CACHED_ACCOUNT_DATA_TYPES,
): RoomListSnapshot {
    const accountData: Partial<IEvent>[] = [];
    for (const type of accountDataTypes) {
        const ev = client.getAccountData(type as never);
        if (ev) accountData.push(rawOf(ev));
    }
    const directIds = new Set(
        Object.values(
            (client.getAccountData(EventType.Direct)?.getContent() ??
                {}) as Record<string, string[]>,
        ).flat(),
    );
    const myId = client.getUserId();

    const rooms: CachedRoom[] = [];
    for (const room of client.getRooms()) {
        if (room.getMyMembership() !== "join") continue;
        const state: Partial<IEvent>[] = [];
        const current = room.currentState;
        for (const type of CACHED_STATE_TYPES) {
            for (const ev of current.getStateEvents(type))
                state.push(rawOf(ev));
        }
        const me = myId ? current.getStateEvents("m.room.member", myId) : null;
        if (me) state.push(rawOf(me));
        if (directIds.has(room.roomId)) {
            const members = current
                .getStateEvents("m.room.member")
                .filter(
                    (e) =>
                        e.getStateKey() !== myId &&
                        ["join", "invite"].includes(
                            e.getContent().membership ?? "",
                        ),
                );
            if (members.length <= MAX_CACHED_MEMBERS)
                for (const e of members) state.push(rawOf(e));
        }
        const heroes = (room as unknown as { heroes?: CachedHero[] | null })
            .heroes;
        // Newest 40 non-state events. A detached timeline replay is only worth
        // having if it looks like the conversation did, so this is the live
        // timeline's tail rather than a sample.
        const timeline = room
            .getLiveTimeline()
            .getEvents()
            .filter((e) => !e.isState())
            .slice(-MAX_CACHED_EVENTS)
            .map(rawOf);
        rooms.push({
            roomId: room.roomId,
            state,
            accountData: [...room.accountData.values()].map(rawOf),
            timeline: timeline.length ? timeline : undefined,
            heroes: heroes?.length ? heroes.map((h) => ({ ...h })) : undefined,
            joined: room.getJoinedMemberCount(),
            invited: room.getInvitedMemberCount(),
            total: room.getUnreadNotificationCount(NotificationCountType.Total),
            highlight: room.getUnreadNotificationCount(
                NotificationCountType.Highlight,
            ),
        });
    }
    return { v: SNAPSHOT_VERSION, savedAt: Date.now(), accountData, rooms };
}

/** Turn a snapshot back into detached, read-only Room objects. */
export function materializeSnapshot(
    client: MatrixClient,
    snapshot: RoomListSnapshot,
): MaterializedCache {
    const toEvent = (raw: Partial<IEvent>) => new MatrixEvent(raw);
    const userId = client.getUserId() ?? "";
    const rooms = new Map<string, Room>();
    for (const cached of snapshot.rooms) {
        try {
            const room = new Room(cached.roomId, client, userId, {
                lazyLoadMembers: true,
                // The live client runs detached ordering; a Room that defaults
                // to chronological throws from getPendingEvents(), which the
                // timeline helpers call before they read a single event.
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            room.getLiveTimeline().initialiseState(cached.state.map(toEvent));
            room.updateMyMembership("join");
            // Replay the cached conversation onto the live timeline so a room
            // opened with no network is not an empty pane. Latest events last,
            // and state resolution is skipped: the state above is the snapshot.
            if (cached.timeline?.length) {
                const timeline = room.getLiveTimeline();
                for (const raw of cached.timeline) {
                    timeline.addEvent(toEvent(raw), {
                        toStartOfTimeline: false,
                        addToState: false,
                    });
                }
            }
            if (cached.heroes || cached.joined !== undefined) {
                room.setMSC4186SummaryData(
                    cached.heroes?.map((h) => ({
                        user_id: h.userId,
                        displayname: h.displayName,
                        avatar_url: h.avatarUrl,
                    })),
                    cached.joined,
                    cached.invited,
                );
            }
            if (cached.accountData.length)
                room.addAccountData(cached.accountData.map(toEvent));
            if (cached.total)
                room.setUnreadNotificationCount(
                    NotificationCountType.Total,
                    cached.total,
                );
            if (cached.highlight)
                room.setUnreadNotificationCount(
                    NotificationCountType.Highlight,
                    cached.highlight,
                );
            room.recalculate();
            rooms.set(cached.roomId, room);
        } catch (err) {
            // One malformed entry must not cost the rest of the list.
            console.warn("[roomListCache] skipped room", cached.roomId, err);
        }
    }
    const accountData = new Map<string, MatrixEvent>();
    for (const raw of snapshot.accountData) {
        if (raw.type) accountData.set(raw.type, toEvent(raw));
    }
    return { rooms, accountData };
}

// ---- IndexedDB (one record per account + device) ----

const DB_NAME = "zam-roomlist-cache";
const STORE = "snapshots";
// Zami: all but the first screen's rooms, kept apart (see saveSnapshot).
const REST_DB_NAME = "zam-roomlist-cache-rest";

/** Zami: how many of the most recently active rooms the first screen shows. */
export const FIRST_PAINT_ROOMS = 50;

/** Zami: where the app will open, which the first screen's rooms must cover. */
export interface FirstScreen {
    /** Rooms it may open on: the last room of each space, and of Home. */
    roomIds?: ReadonlySet<string>;
    /** The space it opens in, whose most recently active rooms go first too. */
    spaceId?: string | null;
}

function isSpace(room: CachedRoom): boolean {
    return room.state.some(
        (ev) =>
            ev.type === "m.room.create" &&
            (ev.content as { type?: unknown } | undefined)?.type === "m.space",
    );
}

/** The rooms a cached space lists (an m.space.child without `via` is removed). */
function childIdsOf(space: CachedRoom | undefined): Set<string> {
    const ids = new Set<string>();
    for (const ev of space?.state ?? []) {
        const via = (ev.content as { via?: unknown } | undefined)?.via;
        if (
            ev.type === "m.space.child" &&
            ev.state_key &&
            Array.isArray(via) &&
            via.length
        )
            ids.add(ev.state_key);
    }
    return ids;
}

/**
 * Zami: split a snapshot's rooms into what the first screen shows and the rest.
 * The first part is every space, the rooms the app may open on, the `count`
 * most recently active rooms of the space it opens in, and the `count` most
 * recently active rooms overall. Spaces rarely have messages, so going by
 * recency alone left them all for later: the app then opened in a space it
 * didn't know yet ("this space", "Loading rooms…") instead of its last room,
 * and Home listed rooms that belong to spaces.
 */
export function splitForFirstScreen(
    rooms: CachedRoom[],
    firstScreen: FirstScreen = {},
    count = FIRST_PAINT_ROOMS,
): [CachedRoom[], CachedRoom[]] {
    const lastActivity = (room: CachedRoom): number =>
        room.timeline?.[room.timeline.length - 1]?.origin_server_ts ?? 0;
    const byRecency = [...rooms].sort(
        (a, b) => lastActivity(b) - lastActivity(a),
    );
    const inSpace = childIdsOf(
        firstScreen.spaceId
            ? rooms.find((room) => room.roomId === firstScreen.spaceId)
            : undefined,
    );
    const first: CachedRoom[] = [];
    const rest: CachedRoom[] = [];
    let recentInSpace = 0;
    let recent = 0;
    for (const room of byRecency) {
        if (isSpace(room) || firstScreen.roomIds?.has(room.roomId))
            first.push(room);
        else if (inSpace.has(room.roomId) && recentInSpace < count) {
            recentInSpace++;
            first.push(room);
        } else if (recent < count) {
            recent++;
            first.push(room);
        } else rest.push(room);
    }
    return [first, rest];
}

function openDb(name = DB_NAME): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest,
    name = DB_NAME,
): Promise<T> {
    const db = await openDb(name);
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req.result as T);
            tx.onabort = tx.onerror = () => reject(tx.error ?? req.error);
        });
    } finally {
        db.close();
    }
}

export function snapshotKey(userId: string, deviceId: string): string {
    return `${userId}|${deviceId}`;
}

export async function loadSnapshot(
    key: string,
): Promise<RoomListSnapshot | null> {
    try {
        const snap = await withStore<RoomListSnapshot | undefined>(
            "readonly",
            (s) => s.get(key),
        );
        return snap && snap.v === SNAPSHOT_VERSION ? snap : null;
    } catch {
        return null;
    }
}

/**
 * Zami: the rooms saveSnapshot kept apart from the first screen's, or none.
 * Opening their database loads all of them, so read it only when needed.
 */
export async function loadSnapshotRest(key: string): Promise<CachedRoom[]> {
    try {
        const rest = await withStore<
            { v: number; rooms: CachedRoom[] } | undefined
        >("readonly", (s) => s.get(key), REST_DB_NAME);
        return rest && rest.v === SNAPSHOT_VERSION ? rest.rooms : [];
    } catch {
        return [];
    }
}

export async function saveSnapshot(
    key: string,
    snapshot: RoomListSnapshot,
    // Zami: see splitForFirstScreen.
    firstScreen: FirstScreen = {},
): Promise<void> {
    try {
        // Zami: the snapshot's absent fields are `undefined`. Without them it is
        // plain JSON, which the IndexedDB stand-in stores and reads back far
        // faster than a value it has to walk and tag.
        const plain = JSON.parse(JSON.stringify(snapshot)) as RoomListSnapshot;
        // Zami: the first screen's rooms in one database, the rest in another.
        // The IndexedDB stand-in loads a whole database when it is first
        // opened, and every launch opens this one before it can draw: with
        // thousands of rooms, the full snapshot was tens of megabytes to read
        // first.
        const [first, rest] = splitForFirstScreen(plain.rooms, firstScreen);
        await withStore("readwrite", (s) =>
            s.put({ ...plain, rooms: first }, key),
        );
        await withStore(
            "readwrite",
            (s) => s.put({ v: plain.v, rooms: rest }, key),
            REST_DB_NAME,
        );
    } catch (err) {
        reportStorageError(err, { fromIndexedDB: true });
        console.warn("[roomListCache] save failed", err);
    }
}

export async function deleteSnapshot(key: string): Promise<void> {
    for (const name of [DB_NAME, REST_DB_NAME]) {
        try {
            await withStore("readwrite", (s) => s.delete(key), name);
        } catch {
            // Nothing stored or no IndexedDB: nothing to wipe.
        }
    }
}
