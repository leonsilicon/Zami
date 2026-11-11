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
// Zami: saved a room per record, only what changed, a slice at a time.
import {
    createRecordSet,
    createYielder,
    hashString,
    RECORD_SET_VERSION,
} from "@-/com.leonsilicon.zami.persist";

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
// cache the ciphertext the SDK's own store already holds, and decryption
// happens at materialise time from the local crypto store.
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
    // Zami: without `undefined` values, so the saved room is plain JSON (see
    // saveClientSnapshot) without a JSON round trip of the whole snapshot.
    const raw: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ev.event))
        if (value !== undefined) raw[key] = value;
    return raw as Partial<IEvent>;
}

/**
 * Zami: what a room's snapshot is made of, still as the SDK's events: cheap
 * to collect for every room, and copied (cachedRoomOf) only for a room whose
 * fingerprint changed since it was last saved.
 */
interface RoomParts {
    roomId: string;
    state: MatrixEvent[];
    accountData: MatrixEvent[];
    timeline: MatrixEvent[];
    heroes: CachedHero[] | null | undefined;
    joined: number;
    invited: number;
    total: number;
    highlight: number;
}

function directIdsOf(client: MatrixClient): Set<string> {
    return new Set(
        Object.values(
            (client.getAccountData(EventType.Direct)?.getContent() ??
                {}) as Record<string, string[]>,
        ).flat(),
    );
}

function collectRoom(
    room: Room,
    directIds: ReadonlySet<string>,
    myId: string | null,
): RoomParts {
    const state: MatrixEvent[] = [];
    const current = room.currentState;
    for (const type of CACHED_STATE_TYPES) {
        for (const ev of current.getStateEvents(type)) state.push(ev);
    }
    const me = myId ? current.getStateEvents("m.room.member", myId) : null;
    if (me) state.push(me);
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
        if (members.length <= MAX_CACHED_MEMBERS) state.push(...members);
    }
    const heroes = (room as unknown as { heroes?: CachedHero[] | null }).heroes;
    // Newest 40 non-state events. A detached timeline replay is only worth
    // having if it looks like the conversation did, so this is the live
    // timeline's tail rather than a sample.
    const events = room.getLiveTimeline().getEvents();
    const timeline: MatrixEvent[] = [];
    for (
        let i = events.length - 1;
        i >= 0 && timeline.length < MAX_CACHED_EVENTS;
        i--
    )
        if (!events[i]!.isState()) timeline.push(events[i]!);
    timeline.reverse();
    return {
        roomId: room.roomId,
        state,
        accountData: [...room.accountData.values()],
        timeline,
        heroes,
        joined: room.getJoinedMemberCount(),
        invited: room.getInvitedMemberCount(),
        total: room.getUnreadNotificationCount(NotificationCountType.Total),
        highlight: room.getUnreadNotificationCount(
            NotificationCountType.Highlight,
        ),
    };
}

/** Zami: a room's snapshot, as plain JSON (no `undefined` fields). */
function cachedRoomOf(parts: RoomParts): CachedRoom {
    const cached: CachedRoom = {
        roomId: parts.roomId,
        state: parts.state.map(rawOf),
        accountData: parts.accountData.map(rawOf),
        joined: parts.joined,
        invited: parts.invited,
        total: parts.total,
        highlight: parts.highlight,
    };
    if (parts.timeline.length) cached.timeline = parts.timeline.map(rawOf);
    if (parts.heroes?.length)
        cached.heroes = parts.heroes.map((h) => {
            const hero: CachedHero = { userId: h.userId };
            if (h.displayName !== undefined) hero.displayName = h.displayName;
            if (h.avatarUrl !== undefined) hero.avatarUrl = h.avatarUrl;
            return hero;
        });
    return cached;
}

/**
 * Zami: changes whenever the room's snapshot would: its events (by id, and
 * whether redacted), account data, heroes and counts. Lets a save skip the
 * rooms that didn't change without building or comparing their snapshots.
 */
function fingerprintOf(parts: RoomParts): number {
    let text = "";
    for (const ev of parts.state)
        text += `${ev.getId()}${ev.isRedacted() ? "!" : ""},`;
    text += "|";
    for (const ev of parts.timeline)
        text += `${ev.getId()}${ev.isRedacted() ? "!" : ""},`;
    text += "|";
    for (const ev of parts.accountData)
        text += `${ev.getType()}${JSON.stringify(ev.getContent())},`;
    text += `|${JSON.stringify(parts.heroes ?? null)}|${parts.joined},${parts.invited},${parts.total},${parts.highlight}`;
    return hashString(text);
}

function accountDataOf(
    client: MatrixClient,
    accountDataTypes: readonly string[],
): Partial<IEvent>[] {
    const accountData: Partial<IEvent>[] = [];
    for (const type of accountDataTypes) {
        const ev = client.getAccountData(type as never);
        if (ev) accountData.push(rawOf(ev));
    }
    return accountData;
}

/** Snapshot the joined rooms of a client whose room list is complete. */
export function buildSnapshot(
    client: MatrixClient,
    accountDataTypes: readonly string[] = CACHED_ACCOUNT_DATA_TYPES,
): RoomListSnapshot {
    const accountData = accountDataOf(client, accountDataTypes);
    const directIds = directIdsOf(client);
    const myId = client.getUserId();

    const rooms: CachedRoom[] = [];
    for (const room of client.getRooms()) {
        if (room.getMyMembership() !== "join") continue;
        rooms.push(cachedRoomOf(collectRoom(room, directIds, myId)));
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
    return splitRooms(rooms, cachedRoomShape, firstScreen, count);
}

/** Zami: what splitRooms reads of a room. */
interface RoomShape<R> {
    lastActivity(room: R): number;
    isSpace(room: R): boolean;
    /** The rooms a space lists. */
    childIds(space: R | undefined): Set<string>;
}

const cachedRoomShape: RoomShape<CachedRoom> = {
    lastActivity: (room) =>
        room.timeline?.[room.timeline.length - 1]?.origin_server_ts ?? 0,
    isSpace,
    childIds: childIdsOf,
};

/** Zami: the same split, of the live rooms saveClientSnapshot collects. */
const roomPartsShape: RoomShape<RoomParts> = {
    lastActivity: (room) => room.timeline.at(-1)?.getTs() ?? 0,
    isSpace: (room) =>
        room.state.some(
            (ev) =>
                ev.getType() === "m.room.create" &&
                ev.getContent().type === "m.space",
        ),
    childIds: (space) =>
        childIdsOf(
            space && {
                roomId: space.roomId,
                state: space.state.map(rawOf),
                accountData: [],
            },
        ),
};

function splitRooms<R extends { roomId: string }>(
    rooms: R[],
    shape: RoomShape<R>,
    firstScreen: FirstScreen,
    count: number,
): [R[], R[]] {
    const { lastActivity } = shape;
    const byRecency = [...rooms].sort(
        (a, b) => lastActivity(b) - lastActivity(a),
    );
    const inSpace = shape.childIds(
        firstScreen.spaceId
            ? rooms.find((room) => room.roomId === firstScreen.spaceId)
            : undefined,
    );
    const first: R[] = [];
    const rest: R[] = [];
    let recentInSpace = 0;
    let recent = 0;
    for (const room of byRecency) {
        if (shape.isSpace(room) || firstScreen.roomIds?.has(room.roomId))
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

/** Zami: what a saved room list keeps besides its rooms. */
interface SnapshotData {
    accountData: Partial<IEvent>[];
    hierarchies?: Record<string, SpaceChildInfo[]>;
}

// Zami: a record per room, in the first screen's database or the rest's,
// written only when it changed, a slice at a time
// (@-/com.leonsilicon.zami.persist; see saveClientSnapshot).
const savedRooms = createRecordSet<SnapshotData, CachedRoom>({
    dbNames: [DB_NAME, REST_DB_NAME],
    storeName: STORE,
});

export async function loadSnapshot(
    key: string,
): Promise<RoomListSnapshot | null> {
    try {
        // Zami: the saved list's head and its first screen's rooms.
        const { head, records } = await savedRooms.loadFirst(key);
        const saved = head as
            | { v?: number; savedAt: number; data: SnapshotData }
            | undefined;
        if (saved?.v === RECORD_SET_VERSION)
            return {
                v: SNAPSHOT_VERSION,
                savedAt: saved.savedAt,
                accountData: saved.data.accountData,
                hierarchies: saved.data.hierarchies,
                rooms: records,
            };
        // Saved by older code: the first screen's rooms in the head.
        const snap = head as RoomListSnapshot | undefined;
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
        // Zami: a batch of rooms at a time, with turns of the event loop between.
        const rooms = await savedRooms.loadRest(key);
        // Saved by older code: all of them in one record.
        const rest = await withStore<
            { v: number; rooms: CachedRoom[] } | undefined
        >("readonly", (s) => s.get(key), REST_DB_NAME);
        if (rest && rest.v === SNAPSHOT_VERSION) rooms.push(...rest.rooms);
        return rooms;
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
        // Zami: a record per room (see saveClientSnapshot, which the app uses):
        // the first screen's rooms in one database, the rest in another. The
        // IndexedDB stand-in loads a whole database when it is first opened, and
        // every launch opens the first before it can draw.
        const [first] = splitForFirstScreen(snapshot.rooms, firstScreen);
        const firstIds = new Set(first.map((room) => room.roomId));
        await savedRooms.save(
            key,
            {
                accountData: snapshot.accountData,
                hierarchies: snapshot.hierarchies,
            },
            snapshot.rooms.map((room) => {
                const json = JSON.stringify(room);
                return {
                    id: room.roomId,
                    fingerprint: hashString(json),
                    first: firstIds.has(room.roomId),
                    build: () => JSON.parse(json) as CachedRoom,
                };
            }),
        );
    } catch (err) {
        reportStorageError(err, { fromIndexedDB: true });
        console.warn("[roomListCache] save failed", err);
    }
}

/** Zami: what saveClientSnapshot is given besides the client and key. */
interface ClientSnapshotOptions {
    hierarchies?: Record<string, SpaceChildInfo[]>;
    firstScreen?: FirstScreen;
    /** Checked between slices; the save stops once it's false. */
    isCurrent?: () => boolean;
}

/** Zami: the running saveClientSnapshot, and one asked for meanwhile. */
let clientSaving: Promise<void> | null = null;
let clientSaveNext: (() => Promise<void>) | null = null;

/**
 * Zami: snapshot and save the joined rooms of a client whose room list is
 * complete, a room at a time. Collecting a room's parts (its events, as the
 * SDK holds them) and fingerprinting them is cheap; only rooms whose
 * fingerprint changed since the last save are copied and written, a few per
 * turn of the event loop. Building and writing the whole snapshot at once held
 * the JS thread for seconds with thousands of rooms, every two minutes and
 * each time the app went to the background. A save asked for while one runs
 * follows it (once, with the latest arguments).
 */
export function saveClientSnapshot(
    client: MatrixClient,
    key: string,
    options: ClientSnapshotOptions = {},
): Promise<void> {
    const run = () => saveClientSnapshotNow(client, key, options);
    if (clientSaving) {
        clientSaveNext = run;
        return clientSaving;
    }
    const saving = (async () => {
        let next: (() => Promise<void>) | null = run;
        while (next) {
            clientSaveNext = null;
            await next();
            next = clientSaveNext;
        }
    })();
    clientSaving = saving.finally(() => {
        clientSaving = null;
    });
    return clientSaving;
}

async function saveClientSnapshotNow(
    client: MatrixClient,
    key: string,
    {
        hierarchies,
        firstScreen = {},
        isCurrent = () => true,
    }: ClientSnapshotOptions,
): Promise<void> {
    try {
        const turn = createYielder();
        const accountData = accountDataOf(client, CACHED_ACCOUNT_DATA_TYPES);
        const directIds = directIdsOf(client);
        const myId = client.getUserId();
        const rooms: RoomParts[] = [];
        const fingerprints = new Map<string, number>();
        for (const room of client.getRooms()) {
            if (turn.due) {
                await turn.next();
                if (!isCurrent()) return;
            }
            if (room.getMyMembership() !== "join") continue;
            const parts = collectRoom(room, directIds, myId);
            rooms.push(parts);
            fingerprints.set(parts.roomId, fingerprintOf(parts));
        }
        const [first] = splitRooms(
            rooms,
            roomPartsShape,
            firstScreen,
            FIRST_PAINT_ROOMS,
        );
        const firstIds = new Set(first.map((room) => room.roomId));
        await savedRooms.save(
            key,
            { accountData, hierarchies },
            rooms.map((parts) => ({
                id: parts.roomId,
                fingerprint: fingerprints.get(parts.roomId)!,
                first: firstIds.has(parts.roomId),
                build: () => cachedRoomOf(parts),
            })),
            { yielder: turn, isCurrent },
        );
    } catch (err) {
        reportStorageError(err, { fromIndexedDB: true });
        console.warn("[roomListCache] save failed", err);
    }
}

export async function deleteSnapshot(key: string): Promise<void> {
    // Zami: the head and every room's record, in both databases.
    try {
        await savedRooms.delete(key);
    } catch {
        // Nothing stored or no IndexedDB: nothing to wipe.
    }
}
