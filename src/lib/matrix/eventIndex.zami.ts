/**
 * Local message index for encrypted rooms (format and search: utils/eventIndex).
 *
 * Two feeds write to it:
 * - live: every message in an encrypted room as it arrives and decrypts, and
 *   any older page the timeline loads;
 * - a crawler that walks each joined encrypted room's history backwards, one
 *   page at a time, until it reaches the start. It covers the plaintext
 *   messages from before a room turned on encryption too, so a mixed room is
 *   searchable end to end.
 *
 * One IndexedDB database per account and device, deleted on sign-out and
 * when the setting is turned off. Account switching reloads the page, so
 * there is only ever one client to follow.
 */
import {
    Direction,
    Filter,
    MatrixEvent,
    MatrixEventEvent,
    RoomEvent,
    type MatrixClient,
    type Room,
} from "matrix-js-sdk";
import { matrixClient } from "./runtime";
import { reportStorageError } from "$lib/stores/storageHealth.svelte";
import { isRoomEncrypted, deleteDatabaseWithOutcome } from "./crypto";
import { isSyncStale } from "./client";
import {
    BLOCK_SIZE,
    decodeBlock,
    encodeBlock,
    entryFromEvent,
    normalizeForSearch,
    searchWords,
    type EncodedBlock,
    type IndexEntry,
} from "$lib/utils/eventIndex";
import {
    mediaFilterDefinition,
    mediaItemFromEvent,
    type RoomMediaItem,
} from "$lib/utils/roomMedia";
import {
    matchesParsedQuery,
    type ParsedSearchQuery,
} from "$lib/utils/messageSearch";
// Zami: the search and the writes run a slice of the event loop at a time.
import {
    createIndexSearch,
    createSlicer,
    prepareEntry,
    type Slicer,
} from "@-/com.leonsilicon.zami.sliced";

const DB_VERSION = 1;
const BLOCKS = "blocks";
const TAILS = "tails";
const MEDIA = "media";
const CRAWL = "crawl";
const REDACTED = "redacted";

/** How long new messages wait before being written (batches a busy sync). */
const FLUSH_DELAY_MS = 2_000;
/** Crawler pacing: between pages, and between checks when it has nothing to
 *  do or shouldn't run (hidden page, sync down, storage tight). */
const CRAWL_PAGE_DELAY_MS = 2_000;
const CRAWL_IDLE_MS = 5 * 60_000;
const CRAWL_PAUSED_MS = 30_000;
const CRAWL_PAGE_SIZE = 100;
/** Stop crawling past this much origin storage, or half the quota. */
const STORAGE_CAP_BYTES = 1024 * 1024 * 1024;

interface StoredBlock extends EncodedBlock {
    id?: number;
    roomId: string;
    count: number;
    minTs: number;
    maxTs: number;
    /** Zami: its entries carry their search bodies (prepareEntry). */
    p?: 1;
}
interface StoredTail {
    roomId: string;
    entries: IndexEntry[];
    /** Zami: its entries carry their search bodies (prepareEntry). */
    p?: 1;
}
interface CrawlState {
    roomId: string;
    /** Where the next backwards page starts; null = from the newest event. */
    from: string | null;
    done: boolean;
}
type StoredMedia = RoomMediaItem & { roomId: string };

export function eventIndexDbName(userId: string, deviceId: string): string {
    return `matrix-client:${encodeURIComponent(userId)}:${encodeURIComponent(deviceId)}:event-index`;
}

function idbFactory(): IDBFactory | null {
    try {
        return globalThis.indexedDB ?? null;
    } catch {
        return null;
    }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function openDb(name: string): Promise<IDBDatabase> {
    const factory = idbFactory();
    if (!factory) return Promise.reject(new Error("IndexedDB unavailable"));
    return new Promise((resolve, reject) => {
        const open = factory.open(name, DB_VERSION);
        open.onupgradeneeded = () => {
            const db = open.result;
            db.createObjectStore(BLOCKS, {
                keyPath: "id",
                autoIncrement: true,
            }).createIndex("room", "roomId");
            db.createObjectStore(TAILS, { keyPath: "roomId" });
            db.createObjectStore(MEDIA, { keyPath: "eventId" }).createIndex(
                "room_ts",
                ["roomId", "ts"],
            );
            db.createObjectStore(CRAWL, { keyPath: "roomId" });
            db.createObjectStore(REDACTED, { keyPath: "eventId" }).createIndex(
                "room",
                "roomId",
            );
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error("event index blocked"));
    });
}

// ── Session ────────────────────────────────────────────────────────────────

interface Session {
    client: MatrixClient;
    dbName: string;
    db: Promise<IDBDatabase>;
    stopped: boolean;
    detach: () => void;
    /** Zami: every room's crawl state, read once and kept up to date. */
    crawlStates?: Map<string, CrawlState>;
}

let session: Session | null = null;
// Every write goes through this chain, so a tail is never read and rewritten
// by two writers at once.
let writeChain: Promise<void> = Promise.resolve();
const pending = new Map<
    string,
    { entries: IndexEntry[]; media: StoredMedia[]; redacted: string[] }
>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Ids already queued this session: a message is both added to the timeline
// and then decrypted, and both fire.
const seen = new Set<string>();

function bucket(roomId: string) {
    let b = pending.get(roomId);
    if (!b) {
        b = { entries: [], media: [], redacted: [] };
        pending.set(roomId, b);
    }
    return b;
}

function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
    }, FLUSH_DELAY_MS);
}

/** Queue one event (live or crawled). False when it adds nothing. */
function queueEvent(
    roomId: string,
    ev: {
        eventId: string;
        sender: string;
        ts: number;
        type: string;
        content: Record<string, unknown>;
        redacted: boolean;
    },
): boolean {
    if (seen.has(ev.eventId)) return false;
    const entry = entryFromEvent(ev);
    if (!entry) return false;
    seen.add(ev.eventId);
    if (seen.size > 20_000) seen.clear();
    const b = bucket(roomId);
    b.entries.push(entry);
    const media = mediaItemFromEvent(ev);
    if (media) b.media.push({ ...media, roomId });
    return true;
}

function flush(): Promise<void> {
    const s = session;
    if (!s || pending.size === 0) return writeChain;
    const batch = new Map(pending);
    pending.clear();
    writeChain = writeChain
        .then(async () => {
            const db = await s.db;
            // Zami: a turn of the event loop between rooms once the slice is
            // used up: at launch, background decryption queues messages in
            // hundreds of rooms at once.
            const slicer = createSlicer();
            for (const [roomId, b] of batch) {
                if (slicer.due) await slicer.pause();
                await writeRoom(db, roomId, b);
            }
        })
        .catch((e) => {
            reportStorageError(e, { fromIndexedDB: true });
            console.warn("[eventIndex] write failed", e);
        });
    return writeChain;
}

async function writeRoom(
    db: IDBDatabase,
    roomId: string,
    b: { entries: IndexEntry[]; media: StoredMedia[]; redacted: string[] },
): Promise<void> {
    const read = db.transaction(TAILS, "readonly");
    const tail = ((await req(read.objectStore(TAILS).get(roomId))) as
        | StoredTail
        | undefined) ?? { roomId, entries: [] };
    // Zami: each body is normalized for search once, as it's written (a tail
    // from before this has none yet), rather than by every search.
    if (!tail.p)
        for (const e of tail.entries) prepareEntry(e, normalizeForSearch);
    for (const e of b.entries) prepareEntry(e, normalizeForSearch);
    let entries = [...tail.entries, ...b.entries];
    // Compress outside the transaction: an IndexedDB transaction closes as
    // soon as it waits on anything that isn't IndexedDB.
    const blocks: StoredBlock[] = [];
    while (entries.length >= BLOCK_SIZE) {
        const chunk = entries.slice(0, BLOCK_SIZE);
        entries = entries.slice(BLOCK_SIZE);
        const ts = chunk.map((e) => e.t);
        blocks.push({
            ...(await encodeBlock(chunk)),
            roomId,
            count: chunk.length,
            minTs: Math.min(...ts),
            maxTs: Math.max(...ts),
            p: 1,
        });
    }
    const tx = db.transaction([TAILS, BLOCKS, MEDIA, REDACTED], "readwrite");
    tx.objectStore(TAILS).put({ roomId, entries, p: 1 } satisfies StoredTail);
    for (const block of blocks) tx.objectStore(BLOCKS).add(block);
    for (const m of b.media) tx.objectStore(MEDIA).put(m);
    for (const eventId of b.redacted) {
        tx.objectStore(REDACTED).put({ eventId, roomId });
        tx.objectStore(MEDIA).delete(eventId);
    }
    await done(tx);
}

// ── Live feed ──────────────────────────────────────────────────────────────

function liveEvent(ev: MatrixEvent, room: Room | null | undefined): void {
    if (!room || !isRoomEncrypted(room)) return;
    const eventId = ev.getId();
    const sender = ev.getSender();
    // Local echoes (no server id yet) and messages still waiting for a key.
    if (!eventId || eventId.startsWith("~") || !sender) return;
    if (ev.isBeingDecrypted() || ev.isDecryptionFailure()) return;
    if (
        queueEvent(room.roomId, {
            eventId,
            sender,
            ts: ev.getTs(),
            type: ev.getType(),
            content: ev.getContent(),
            redacted: ev.isRedacted(),
        })
    )
        scheduleFlush();
}

function liveRedaction(ev: MatrixEvent, room: Room): void {
    if (!isRoomEncrypted(room)) return;
    const target =
        (ev.event as { redacts?: string }).redacts ??
        (ev.getContent().redacts as string | undefined);
    if (!target) return;
    bucket(room.roomId).redacted.push(target);
    scheduleFlush();
}

// ── Crawler ────────────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function storageTight(): Promise<boolean> {
    try {
        const est = await navigator.storage?.estimate?.();
        if (!est?.usage) return false;
        return (
            est.usage > STORAGE_CAP_BYTES ||
            (!!est.quota && est.usage > est.quota / 2)
        );
    } catch {
        return false;
    }
}

// Zami: takes the crawl states, so rooms already done drop out first, and
// reads each room's last activity once rather than in every comparison: a
// bridged account has thousands of rooms, nearly all of them done.
function crawlCandidates(
    client: MatrixClient,
    states: ReadonlyMap<string, CrawlState>,
): Room[] {
    return client
        .getRooms()
        .filter(
            (r) =>
                r.getMyMembership() === "join" &&
                !states.get(r.roomId)?.done &&
                isRoomEncrypted(r),
        )
        .map((room) => ({ room, active: room.getLastActiveTimestamp() }))
        .sort((a, b) => b.active - a.active)
        .map(({ room }) => room);
}

/** Zami: every room's crawl state, in one request. */
async function readCrawlStates(
    db: IDBDatabase,
): Promise<Map<string, CrawlState>> {
    const rows = (await req(
        db.transaction(CRAWL).objectStore(CRAWL).getAll(),
    )) as CrawlState[];
    return new Map(rows.map((row) => [row.roomId, row]));
}

/** Index one page of some room's history. False when every room is done. */
async function crawlStep(s: Session): Promise<boolean> {
    const db = await s.db;
    // Zami: the states are read once a session and kept up to date below,
    // rather than in a transaction per room per page.
    s.crawlStates ??= await readCrawlStates(db);
    const states = s.crawlStates;
    for (const room of crawlCandidates(s.client, states)) {
        const state = states.get(room.roomId);
        if (state?.done) continue;
        const from = state?.from ?? null;
        const filter = new Filter(s.client.getUserId());
        filter.setDefinition(mediaFilterDefinition(true, CRAWL_PAGE_SIZE));
        const res = await s.client.createMessagesRequest(
            room.roomId,
            from,
            CRAWL_PAGE_SIZE,
            Direction.Backward,
            filter,
        );
        if (s.stopped) return false;
        const events = (res.chunk ?? []).map((raw) => new MatrixEvent(raw));
        // Zami: one at a time, with a turn of the event loop between once the
        // slice is used up, rather than a page at once in one microtask chain;
        // the index may have stopped meanwhile.
        const slicer = createSlicer();
        for (const e of events) {
            if (e.getType() !== "m.room.encrypted") continue;
            if (slicer.due) await slicer.pause();
            await s.client.decryptEventIfNeeded(e).catch(() => {});
        }
        if (s.stopped) return false;
        for (const e of events) {
            const eventId = e.getId();
            const sender = e.getSender();
            if (!eventId || !sender || e.isDecryptionFailure()) continue;
            queueEvent(room.roomId, {
                eventId,
                sender,
                ts: e.getTs(),
                type: e.getType(),
                content: e.getContent(),
                redacted: e.isRedacted(),
            });
        }
        await flush();
        // Same end-of-history rule as fetchRoomMediaPage: tuwunel can hand
        // back an empty chunk mid-history, so only the token decides.
        const end = res.end ?? null;
        const next: CrawlState = {
            roomId: room.roomId,
            from: end,
            done: end === null || end === from,
        };
        const tx = db.transaction(CRAWL, "readwrite");
        tx.objectStore(CRAWL).put(next);
        await done(tx);
        states.set(room.roomId, next);
        return true;
    }
    return false;
}

/** One crawler page for the running session, ignoring the pacing gates.
 *  Exported for tests. */
export function crawlOnceForTests(): Promise<boolean> {
    return session ? crawlStep(session) : Promise.resolve(false);
}

async function runCrawler(s: Session): Promise<void> {
    while (!s.stopped) {
        let delay = CRAWL_PAGE_DELAY_MS;
        try {
            if (document.hidden || isSyncStale() || (await storageTight())) {
                delay = CRAWL_PAUSED_MS;
            } else if (!(await crawlStep(s))) {
                delay = CRAWL_IDLE_MS;
            }
        } catch (e) {
            console.warn("[eventIndex] crawl page failed", e);
            delay = CRAWL_PAUSED_MS;
        }
        await wait(delay);
    }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

/** Start indexing for the current client. Returns the stop function. */
export function startEventIndex(): () => void {
    const client = matrixClient;
    const userId = client?.getUserId();
    const deviceId = client?.getDeviceId();
    if (!client || !userId || !deviceId || !idbFactory()) return () => {};
    stopEventIndex();
    const onTimeline = (ev: MatrixEvent, room: Room | undefined) =>
        liveEvent(ev, room);
    const onDecrypted = (ev: MatrixEvent) =>
        liveEvent(ev, client.getRoom(ev.getRoomId() ?? ""));
    const onRedaction = (ev: MatrixEvent, room: Room) =>
        liveRedaction(ev, room);
    client.on(RoomEvent.Timeline, onTimeline as never);
    client.on(MatrixEventEvent.Decrypted, onDecrypted as never);
    client.on(RoomEvent.Redaction, onRedaction as never);
    const s: Session = {
        client,
        dbName: eventIndexDbName(userId, deviceId),
        db: openDb(eventIndexDbName(userId, deviceId)),
        stopped: false,
        detach: () => {
            client.off(RoomEvent.Timeline, onTimeline as never);
            client.off(MatrixEventEvent.Decrypted, onDecrypted as never);
            client.off(RoomEvent.Redaction, onRedaction as never);
        },
    };
    s.db.catch((e) => {
        console.warn("[eventIndex] unavailable", e);
        stopEventIndex();
    });
    session = s;
    void runCrawler(s);
    return stopEventIndex;
}

export function stopEventIndex(): void {
    const s = session;
    if (!s) return;
    s.stopped = true;
    s.detach();
    session = null;
    pending.clear();
    seen.clear();
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    void s.db.then((db) => db.close()).catch(() => {});
}

/** Delete an account's index (sign-out, account removal, setting off). */
export async function deleteEventIndex(
    userId: string,
    deviceId: string,
): Promise<void> {
    const name = eventIndexDbName(userId, deviceId);
    if (session?.dbName === name) {
        const s = session;
        stopEventIndex();
        await s.db.then((db) => db.close()).catch(() => {});
    }
    const factory = idbFactory();
    if (factory) await deleteDatabaseWithOutcome(factory, name, 5_000);
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Whether the index is running and can answer for encrypted rooms. */
export function isEventIndexActive(): boolean {
    return session !== null && !session.stopped;
}

async function redactedIds(
    db: IDBDatabase,
    roomId: string,
): Promise<Set<string>> {
    const rows = (await req(
        db
            .transaction(REDACTED)
            .objectStore(REDACTED)
            .index("room")
            .getAll(roomId),
    )) as { eventId: string }[];
    return new Set(rows.map((r) => r.eventId));
}

/** A search hit as a MatrixEvent, for the same rendering as server results. */
function entryEvent(roomId: string, entry: IndexEntry): MatrixEvent {
    const content: Record<string, unknown> = {
        msgtype: entry.m,
        body: entry.b,
    };
    if (entry.v) content["org.matrix.msc3245.voice"] = {};
    return new MatrixEvent({
        event_id: entry.e,
        room_id: roomId,
        sender: entry.s,
        origin_server_ts: entry.t,
        type: "m.room.message",
        content,
    });
}

export interface LocalSearchResult {
    events: MatrixEvent[];
    /** Whether the crawler has reached the start of this room's history. */
    complete: boolean;
}

/**
 * Search one room's index, newest first. `onPartial` gets the matches from
 * the newest blocks first, so recent hits show while older blocks decompress.
 */
export async function searchLocalIndex(
    roomId: string,
    parsed: ParsedSearchQuery,
    onPartial?: (events: MatrixEvent[]) => void,
): Promise<LocalSearchResult> {
    const s = session;
    if (!s) return { events: [], complete: false };
    const toEvents = (entries: IndexEntry[]) =>
        entries.map((e) => entryEvent(roomId, e));
    const db = await s.db;
    // Write what's queued first, so a message that just arrived is findable.
    await flush();
    // Zami: the blocks are read a few at a time (their keys first), decoded and
    // searched one at a time, a slice of the event loop at a time, keeping only
    // the newest matches (@-/com.leonsilicon.zami.sliced), with the same results
    // as searchEntries(resolveEntries(…)) over them all: a long history read,
    // decoded, normalized and sorted in one task froze the app.
    const tx = db.transaction([BLOCKS, TAILS, CRAWL, REDACTED]);
    const [blockKeys, tail, crawl, redactedRows] = await Promise.all([
        req(tx.objectStore(BLOCKS).index("room").getAllKeys(roomId)),
        req(tx.objectStore(TAILS).get(roomId)) as Promise<
            StoredTail | undefined
        >,
        req(tx.objectStore(CRAWL).get(roomId)) as Promise<
            CrawlState | undefined
        >,
        req(tx.objectStore(REDACTED).index("room").getAll(roomId)) as Promise<
            { eventId: string }[]
        >,
    ]);
    const redacted = new Set(redactedRows.map((r) => r.eventId));
    const slicer = createSlicer();
    const words = searchWords(parsed.term);
    const search = createIndexSearch<IndexEntry>({
        redacted,
        normalize: normalizeForSearch,
        // entryMatches, with the body already normalized.
        matches: (entry, body) =>
            words.every((w) => body.includes(w)) &&
            matchesParsedQuery(
                {
                    sender: entry.s,
                    msgtype: entry.m,
                    body: entry.b,
                    isVoice: !!entry.v,
                },
                parsed,
            ),
        slicer,
    });
    const blocks = await readBlocks(db, blockKeys, slicer);
    await search.add(tail?.entries ?? [], !!tail?.p);
    blocks.sort((a, b) => b.maxTs - a.maxTs);
    const PARTIAL_AFTER = 8;
    for (let i = 0; i < blocks.length; i++) {
        if (slicer.due) await slicer.pause();
        await search.add(await decodeBlock(blocks[i]), !!blocks[i].p);
        if (
            onPartial &&
            i === PARTIAL_AFTER - 1 &&
            blocks.length > PARTIAL_AFTER
        )
            onPartial(toEvents(await search.results()));
    }
    return {
        events: toEvents(await search.results()),
        complete: !!crawl?.done,
    };
}

/** Zami: blocks by key, a few to a transaction, with a turn of the event loop
 *  between once the slice is used up. */
async function readBlocks(
    db: IDBDatabase,
    keys: IDBValidKey[],
    slicer: Slicer,
): Promise<StoredBlock[]> {
    const BATCH = 16;
    const blocks: StoredBlock[] = [];
    for (let i = 0; i < keys.length; i += BATCH) {
        if (slicer.due) await slicer.pause();
        const store = db.transaction(BLOCKS).objectStore(BLOCKS);
        const batch = (await Promise.all(
            keys.slice(i, i + BATCH).map((key) => req(store.get(key))),
        )) as (StoredBlock | undefined)[];
        for (const block of batch) if (block) blocks.push(block);
    }
    return blocks;
}

/** A room's indexed attachments, newest first. `resumeFrom` is where the
 *  crawler stopped: paging the server from there covers only what the index
 *  doesn't have yet. */
export async function getIndexedMedia(roomId: string): Promise<{
    items: RoomMediaItem[];
    complete: boolean;
    resumeFrom: string | null;
}> {
    const s = session;
    if (!s) return { items: [], complete: false, resumeFrom: null };
    const db = await s.db;
    await flush();
    const tx = db.transaction([MEDIA, CRAWL]);
    const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
    const [rows, crawl] = await Promise.all([
        req(tx.objectStore(MEDIA).index("room_ts").getAll(range)) as Promise<
            StoredMedia[]
        >,
        req(tx.objectStore(CRAWL).get(roomId)) as Promise<
            CrawlState | undefined
        >,
    ]);
    const redacted = await redactedIds(db, roomId);
    const items = rows
        .filter((r) => !redacted.has(r.eventId))
        .reverse()
        .map(({ roomId: _r, ...item }) => item as RoomMediaItem);
    return {
        items,
        complete: !!crawl?.done,
        resumeFrom: crawl?.done ? null : (crawl?.from ?? null),
    };
}
