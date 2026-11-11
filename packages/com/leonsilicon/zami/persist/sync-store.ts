// matrix-js-sdk's IndexedDB sync store, saved and restored a room at a time.
//
// The SDK keeps the account's /sync state in a SyncAccumulator and persists it as ONE record
// ({ nextBatch, roomsData }) every five minutes: the whole account is serialised, cloned and
// written in one go, and at launch read, cloned, accumulated and deep-copied in one go. With
// no worker on React Native, all of that runs on the JS thread; with thousands of rooms it's
// seconds of frozen app, every five minutes and at every launch.
//
// SlicedIndexedDBStore keeps the same accumulator and the same data, but stores each room as
// its own record and only writes the rooms that changed since the last save, a few at a time
// between turns of the event loop. The rooms are read back only when the SDK asks for the
// saved sync (which Zami holds back until the chats are on screen), also in slices.
import {
  IndexedDBStore,
  SyncAccumulator,
  type IMinimalEvent,
  type IRooms,
  type ISyncResponse,
} from "matrix-js-sdk";
import type { IIndexedDBBackend, UserTuple } from "matrix-js-sdk/lib/store/indexeddb-backend.js";
import { LocalIndexedDBStoreBackend } from "matrix-js-sdk/lib/store/indexeddb-local-backend.js";
import type { ISavedSync } from "matrix-js-sdk/lib/store/index.js";
import { readRangeSliced, requestDone, transactionDone, writeSliced } from "#idb";
import { createYielder, type Yielder, type YielderOptions } from "#yielder";

/** The SDK's object store for /sync data (keyPath ["clobber"]). */
const SYNC_STORE = "sync";
/** The SDK's own single record; read once to migrate, then deleted. */
const LEGACY_KEY = "-";
/** The sync token the room records are up to date with. */
const META_KEY = "zami:meta";
/** One record per room: `zami:room:<roomId>`. */
const ROOM_PREFIX = "zami:room:";
const ROOM_RANGE_END = `${ROOM_PREFIX}\uffff`;

type Category = "join" | "invite" | "knock";
const CATEGORIES: readonly Category[] = ["invite", "join", "knock"];

interface LegacyRecord {
  clobber: string;
  nextBatch?: string;
  roomsData?: IRooms;
}
interface MetaRecord {
  clobber: string;
  /** Not `nextBatch`, so that an older build reading this store finds no saved sync. */
  token: string;
}
interface RoomRecord {
  clobber: string;
  category: Category;
  data: Record<string, unknown>;
}

/** What this module reads of SyncAccumulator, whose fields are private in its typings. */
interface AccumulatorInternals {
  accountData: Record<string, IMinimalEvent>;
  inviteRooms: Record<string, unknown>;
  knockRooms: Record<string, unknown>;
  joinRooms: Record<string, unknown>;
  nextBatch: string | null;
}

/** What this module builds on in the SDK's backend (private in its typings). */
interface LocalBackend extends IIndexedDBBackend {
  db?: IDBDatabase;
  syncAccumulator: SyncAccumulator;
  init(): Promise<void>;
  loadAccountData(): Promise<IMinimalEvent[]>;
  persistUserPresenceEvents(tuples: UserTuple[]): Promise<void>;
  removeEventsFromRoom(roomId: string, eventIds: string[]): Promise<void>;
}
const LocalBackendBase = LocalIndexedDBStoreBackend as unknown as new (
  indexedDB: IDBFactory,
  dbName?: string,
) => LocalBackend;

const roomKey = (roomId: string) => [ROOM_PREFIX + roomId];

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** SyncAccumulator.getJSON for some of its rooms: the same code, run over a view of them. */
function roomsJSON(
  accumulator: SyncAccumulator,
  roomIds: Iterable<string>,
  forDatabase: boolean,
): IRooms {
  const all = accumulator as unknown as AccumulatorInternals;
  const view: AccumulatorInternals = {
    accountData: {},
    inviteRooms: {},
    knockRooms: {},
    joinRooms: {},
    nextBatch: all.nextBatch,
  };
  for (const roomId of roomIds) {
    if (roomId in all.inviteRooms) view.inviteRooms[roomId] = all.inviteRooms[roomId];
    if (roomId in all.knockRooms) view.knockRooms[roomId] = all.knockRooms[roomId];
    if (roomId in all.joinRooms) view.joinRooms[roomId] = all.joinRooms[roomId];
  }
  return SyncAccumulator.prototype.getJSON.call(view, forDatabase).roomsData;
}

function roomIdsOf(accumulator: SyncAccumulator): string[] {
  const all = accumulator as unknown as AccumulatorInternals;
  return [
    ...Object.keys(all.inviteRooms),
    ...Object.keys(all.knockRooms),
    ...Object.keys(all.joinRooms),
  ];
}

/** The rooms a sync response touches (including rooms left). */
function roomIdsIn(data: ISyncResponse): string[] {
  const rooms = data.rooms;
  if (!rooms) return [];
  return [rooms.invite, rooms.join, rooms.leave, rooms.knock].flatMap((part) =>
    part ? Object.keys(part) : [],
  );
}

/**
 * A room's JSON as stored, without `undefined` values: the SDK leaves some (no sticky
 * events, no thread counts, missing summary keys), and plain JSON is what Zami's IndexedDB
 * stores and reads back fastest.
 */
function plainRoom(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key in data) {
    const value = data[key];
    if (value === undefined) continue;
    if (key === "summary" && value && typeof value === "object") {
      const summary: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) if (v !== undefined) summary[k] = v;
      out[key] = summary;
    } else out[key] = value;
  }
  return out;
}

export interface SlicedSyncOptions extends YielderOptions {
  /** Called when a background save fails (the rooms it was writing are retried next time). */
  onSaveError?: (error: unknown) => void;
}

/**
 * The SDK's local IndexedDB backend with the /sync data stored a room per record (see the
 * top of this file). Everything else (presence, out-of-band members, client options, the
 * to-device queue, profiles) is the SDK's own code.
 */
export class SlicedSyncBackend extends LocalBackendBase {
  private readonly options: SlicedSyncOptions;
  /** Serialises every read and change of the accumulator, so a slice never sees half a change. */
  private work: Promise<unknown> = Promise.resolve();
  /** The SDK's single record, waiting to be accumulated (once, the first time it's needed). */
  private legacyRooms: IRooms | null = null;
  /** Whether the room records still need loading into the accumulator. */
  private roomsToLoad = false;
  /** Rooms (and global account data types) changed since the last save. */
  private dirtyRooms = new Set<string>();
  private dirtyAccountData = new Set<string>();
  /** Write every room and delete stale records: after a migration, or a failed save of it. */
  private rewriteAll = false;
  private saveQueued = false;
  private pendingPresence: UserTuple[] = [];

  constructor(indexedDB: IDBFactory, dbName?: string, options: SlicedSyncOptions = {}) {
    super(indexedDB, dbName);
    this.options = options;
  }

  private turn(): Yielder {
    return createYielder(this.options);
  }

  /** Runs `job` after every job queued before it. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.work.then(job);
    this.work = run.catch(() => {});
    return run;
  }

  private get accumulator(): AccumulatorInternals {
    return this.syncAccumulator as unknown as AccumulatorInternals;
  }

  private syncStore(mode: IDBTransactionMode): IDBObjectStore {
    return this.db!.transaction(SYNC_STORE, mode).objectStore(SYNC_STORE);
  }

  /**
   * At connect: the account data and the sync token, not the rooms. Those are read when the
   * saved sync is asked for, or before the first save.
   */
  override async init(): Promise<void> {
    const store = this.syncStore("readonly");
    const [accountData, meta, legacy] = await Promise.all([
      this.loadAccountData(),
      requestDone(store.get([META_KEY]) as IDBRequest<MetaRecord | undefined>),
      requestDone(store.get([LEGACY_KEY]) as IDBRequest<LegacyRecord | undefined>),
    ]);
    let token: string | undefined;
    // The SDK's record is only there if this build never saved, or an older build saved
    // after it (then it's newer than the room records, which are rewritten from it).
    if (legacy?.nextBatch) {
      token = legacy.nextBatch;
      this.legacyRooms = legacy.roomsData ?? null;
      this.rewriteAll = true;
    } else if (meta?.token) {
      token = meta.token;
      this.roomsToLoad = true;
    }
    this.syncAccumulator.accumulate(
      { next_batch: token, account_data: { events: accountData } } as ISyncResponse,
      true,
    );
  }

  /** Loads the saved rooms into the accumulator, a batch at a time. Within a job. */
  private async loadRooms(): Promise<void> {
    const turn = this.turn();
    const nextBatch = this.accumulator.nextBatch ?? undefined;
    const legacy = this.legacyRooms;
    this.legacyRooms = null;
    if (legacy) {
      for (const category of CATEGORIES) {
        const part = legacy[category] ?? {};
        const ids = Object.keys(part);
        for (let i = 0; i < ids.length; i += 25) {
          if (turn.due) await turn.next();
          const rooms: Record<string, unknown> = {};
          for (const id of ids.slice(i, i + 25)) rooms[id] = part[id];
          this.syncAccumulator.accumulate(
            { next_batch: nextBatch, rooms: { [category]: rooms } } as unknown as ISyncResponse,
            true,
          );
        }
      }
    }
    if (!this.roomsToLoad) return;
    this.roomsToLoad = false;
    await readRangeSliced<RoomRecord>(
      this.db!,
      SYNC_STORE,
      IDBKeyRange.bound([ROOM_PREFIX], [ROOM_RANGE_END]),
      (records) => {
        const rooms: Record<Category, Record<string, unknown>> = {
          invite: {},
          join: {},
          knock: {},
        };
        for (const record of records)
          rooms[record.category][record.clobber.slice(ROOM_PREFIX.length)] = record.data;
        this.syncAccumulator.accumulate(
          { next_batch: nextBatch, rooms } as unknown as ISyncResponse,
          true,
        );
      },
      { yielder: turn },
    );
  }

  override getSavedSync(copy = true): Promise<ISavedSync | null> {
    return this.enqueue(async () => {
      await this.loadRooms();
      const nextBatch = this.accumulator.nextBatch;
      if (!nextBatch) return null;
      const turn = this.turn();
      const roomsData: IRooms = { join: {}, invite: {}, leave: {}, knock: {} };
      const ids = roomIdsOf(this.syncAccumulator);
      for (let i = 0; i < ids.length; i += 10) {
        if (turn.due) await turn.next();
        // The SDK's /sync processing changes the events it's given: copy them.
        const part = roomsJSON(this.syncAccumulator, ids.slice(i, i + 10), false);
        const own = copy ? deepCopy(part) : part;
        Object.assign(roomsData.join, own.join);
        Object.assign(roomsData.invite, own.invite);
        Object.assign(roomsData.knock, own.knock ?? {});
      }
      const accountData = Object.values(this.accumulator.accountData);
      return { nextBatch, roomsData, accountData: copy ? deepCopy(accountData) : accountData };
    });
  }

  /** Accumulates later, in order, so a running save is never held up nor sees a change. */
  override setSyncData(syncData: ISyncResponse): Promise<void> {
    void this.enqueue(() => this.accumulate(syncData)).catch((error: unknown) =>
      console.warn("[sync store] couldn't keep a sync response", error),
    );
    return Promise.resolve();
  }

  /** Within a job. A big response (a catch-up after days away) goes a batch of rooms at a time. */
  private async accumulate(data: ISyncResponse): Promise<void> {
    // The saved rooms go first, or their older state would land on top of this.
    await this.loadRooms();
    for (const id of roomIdsIn(data)) this.dirtyRooms.add(id);
    for (const event of data.account_data?.events ?? []) this.dirtyAccountData.add(event.type);
    const rooms = data.rooms;
    const count = roomIdsIn(data).length;
    if (!rooms || count <= 50) {
      this.syncAccumulator.accumulate(data);
      return;
    }
    // Room by room, then the rest of the response (account data, the token) last.
    const turn = this.turn();
    for (const category of ["invite", "join", "leave", "knock"] as const) {
      const part = rooms[category] ?? {};
      const ids = Object.keys(part);
      for (let i = 0; i < ids.length; i += 25) {
        if (turn.due) await turn.next();
        const slice: Record<string, unknown> = {};
        for (const id of ids.slice(i, i + 25)) slice[id] = part[id];
        this.syncAccumulator.accumulate({
          next_batch: data.next_batch,
          rooms: { [category]: slice },
        } as unknown as ISyncResponse);
      }
    }
    this.syncAccumulator.accumulate({ ...data, rooms: undefined } as unknown as ISyncResponse);
  }

  override removeEventsFromRoom(roomId: string, eventIds: string[]): Promise<void> {
    return this.enqueue(async () => {
      this.syncAccumulator.removeEventsFromRoom(roomId, eventIds);
      this.dirtyRooms.add(roomId);
    });
  }

  /**
   * Starts a save of what changed and returns at once: the SDK's sync loop waits for this,
   * and a save of thousands of rooms (the first after signing in) takes a while in slices.
   */
  override syncToDatabase(userTuples: UserTuple[]): Promise<void> {
    this.pendingPresence.push(...userTuples);
    if (this.saveQueued) return Promise.resolve();
    this.saveQueued = true;
    void this.enqueue(async () => {
      this.saveQueued = false;
      await this.save();
    }).catch((error: unknown) => {
      console.warn("[sync store] save failed", error);
      this.options.onSaveError?.(error);
    });
    return Promise.resolve();
  }

  /** Within a job: the changed rooms, then the token they're up to date with. */
  private async save(): Promise<void> {
    await this.loadRooms();
    const db = this.db;
    if (!db) return;
    const turn = this.turn();
    const accumulator = this.accumulator;
    const token = accumulator.nextBatch;
    const presence = this.pendingPresence;
    const rewriteAll = this.rewriteAll;
    const dirtyTypes = rewriteAll
      ? new Set(Object.keys(accumulator.accountData))
      : this.dirtyAccountData;
    let dirtyRooms = this.dirtyRooms;
    this.pendingPresence = [];
    this.rewriteAll = false;
    this.dirtyRooms = new Set();
    this.dirtyAccountData = new Set();
    try {
      if (rewriteAll) {
        const stored = await requestDone(
          this.syncStore("readonly").getAllKeys(IDBKeyRange.bound([ROOM_PREFIX], [ROOM_RANGE_END])),
        );
        dirtyRooms = new Set([
          ...dirtyRooms,
          ...roomIdsOf(this.syncAccumulator),
          ...stored.map((key) => (key as string[])[0]!.slice(ROOM_PREFIX.length)),
        ]);
      }
      if (presence.length) await this.persistUserPresenceEvents(presence);
      if (dirtyTypes.size) {
        const transaction = db.transaction("accountData", "readwrite");
        const store = transaction.objectStore("accountData");
        for (const type of dirtyTypes) {
          const event = accumulator.accountData[type];
          if (event) store.put(event);
        }
        await transactionDone(transaction);
      }
      await writeSliced(
        db,
        SYNC_STORE,
        [...dirtyRooms],
        (store, roomId) => {
          const json = roomsJSON(this.syncAccumulator, [roomId], true);
          const category = CATEGORIES.find((c) => json[c]?.[roomId]);
          if (category)
            store.put({
              clobber: ROOM_PREFIX + roomId,
              category,
              data: plainRoom(json[category]![roomId] as unknown as Record<string, unknown>),
            } satisfies RoomRecord);
          else store.delete(roomKey(roomId));
        },
        { yielder: turn, maxBatch: 25 },
      );
      if (turn.due) await turn.next();
      // Last, so the stored token is never ahead of a room. If the app stops before this,
      // some rooms are ahead of it instead: the next sync repeats their newest events, which
      // the SDK drops as duplicates.
      const transaction = db.transaction(SYNC_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_STORE);
      if (token) store.put({ clobber: META_KEY, token } satisfies MetaRecord);
      else store.delete([META_KEY]);
      store.delete([LEGACY_KEY]);
      await transactionDone(transaction);
    } catch (error) {
      // Try these again next time.
      for (const id of dirtyRooms) this.dirtyRooms.add(id);
      for (const type of dirtyTypes) this.dirtyAccountData.add(type);
      this.pendingPresence.unshift(...presence);
      if (rewriteAll) this.rewriteAll = true;
      throw error;
    }
  }

  /** Resolves once everything queued so far (a save included) is done. */
  flush(): Promise<void> {
    return this.enqueue(async () => {});
  }

  override clearDatabase(): Promise<void> {
    this.legacyRooms = null;
    this.roomsToLoad = false;
    this.dirtyRooms = new Set();
    this.dirtyAccountData = new Set();
    this.pendingPresence = [];
    this.rewriteAll = false;
    return super.clearDatabase();
  }
}

/** An IndexedDBStore whose /sync data is saved and restored a room at a time (see above). */
export class SlicedIndexedDBStore extends IndexedDBStore {
  constructor(
    opts: ConstructorParameters<typeof IndexedDBStore>[0],
    options: SlicedSyncOptions = {},
  ) {
    super(opts);
    this._backend = new SlicedSyncBackend(opts.indexedDB as IDBFactory, opts.dbName, options);
  }
}
