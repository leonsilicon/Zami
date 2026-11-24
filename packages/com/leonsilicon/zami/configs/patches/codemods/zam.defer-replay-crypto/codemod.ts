import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const program = ["program"];

export default function codemod(root: SgRoot): string | null {
  return editNodes(root, [
    {
      kinds: program,
      contains: "function kickSync(",
      from: `function kickSync(client: MatrixClient): void {`,
      to: `// ── The saved sync's replay and the crypto store ───────────────────────────
//
// A launch replays the sync saved on the device before it takes anything new
// from the server. For each encrypted room in it, the SDK waited for the
// crypto store to take the room's settings again, one room after the other
// (they are there since the room's encryption event first arrived), and
// queued every saved message for decryption on the way: thousands of calls
// into the store the replay, and then the first new sync, waited behind.
//
// So while the saved sync replays, neither is done. A room's settings are
// applied after it (the open room first, and at once for a room that's about
// to be sent to), and of its messages only what shows without opening the
// room is decrypted. The rest decrypt as they are shown (decryptForDisplay),
// as with sliding sync.

type ReplayCrypto = {
    onCryptoEvent(room: Room, event: MatrixEvent): Promise<void>;
    encryptEvent(event: MatrixEvent, room: Room): Promise<void>;
    prepareToEncrypt(room: Room): void;
    forceDiscardSession(roomId: string): Promise<void>;
};

/** True while the SDK replays the sync it saved: from reading it to the first sync state. */
let replayingSavedSync = false;
/** What applies the settings of each encrypted room the replay went through, once. */
let replayRoomSetups = new Map<string, () => Promise<void>>();
/** What was to be decrypted during the replay. */
let replayDecryptions: MatrixEvent[] = [];
/** The room the app opens on, whose messages and settings come first. */
let replayOpenRoomId: string | null = null;
const replayWatched = new WeakSet<object>();

/** How many of a room's newest encrypted messages are decrypted for its preview. */
const REPLAY_PREVIEW_EVENTS = 3;
/** How many of the other rooms' messages are decrypted at a time. */
const REPLAY_DECRYPT_SLICE = 24;
/** How long the other rooms' messages wait for the first new sync. */
const REPLAY_LIVE_WAIT_MS = 2000;
/**
 * How long after it starts a replay is taken to be over, whatever the SDK
 * said: nothing may stay undecrypted because a sync state never came. (A
 * replay holds the main thread, so this can't come due in the middle of one
 * that's merely long.)
 */
const REPLAY_GIVE_UP_MS = 10_000;

/** Before the client starts: follow its replay of the saved sync, if it has one. */
function watchSavedSyncReplay(
    client: MatrixClient,
    openRoomId?: string | null,
): void {
    replayingSavedSync = false;
    replayRoomSetups = new Map();
    replayDecryptions = [];
    replayOpenRoomId = openRoomId ?? null;
    const crypto = (client as unknown as { cryptoBackend?: ReplayCrypto })
        .cryptoBackend;
    // Without crypto nothing is decrypted or set up, replay or not.
    if (!crypto) return;

    const store = client.store;
    if (!replayWatched.has(store)) {
        replayWatched.add(store);
        const getSavedSync = store.getSavedSync.bind(store);
        store.getSavedSync = async () => {
            const saved = await getSavedSync();
            // The SDK replays it as soon as this resolves.
            if (saved && matrixClient === client) {
                replayingSavedSync = true;
                const setups = replayRoomSetups;
                setTimeout(() => {
                    if (replayRoomSetups === setups)
                        finishSavedSyncReplay(client);
                }, REPLAY_GIVE_UP_MS);
            }
            return saved;
        };
    }
    if (!replayWatched.has(crypto)) {
        replayWatched.add(crypto);
        const onCryptoEvent = crypto.onCryptoEvent.bind(crypto);
        const encryptEvent = crypto.encryptEvent.bind(crypto);
        const prepareToEncrypt = crypto.prepareToEncrypt.bind(crypto);
        const forceDiscardSession = crypto.forceDiscardSession.bind(crypto);
        crypto.onCryptoEvent = (room, event) => {
            if (!replayingSavedSync || matrixClient !== client)
                return onCryptoEvent(room, event);
            let applied: Promise<void> | undefined;
            replayRoomSetups.set(
                room.roomId,
                () => (applied ??= onCryptoEvent(room, event)),
            );
            return Promise.resolve();
        };
        crypto.encryptEvent = async (event, room) => {
            await replayRoomSetups.get(event.getRoomId() ?? "")?.();
            return encryptEvent(event, room);
        };
        crypto.prepareToEncrypt = (room) => {
            const setup = replayRoomSetups.get(room.roomId);
            if (setup) void setup().then(() => prepareToEncrypt(room));
            else prepareToEncrypt(room);
        };
        crypto.forceDiscardSession = async (roomId) => {
            await replayRoomSetups.get(roomId)?.();
            return forceDiscardSession(roomId);
        };
    }
    if (!replayWatched.has(client)) {
        replayWatched.add(client);
        const decrypt = client.decryptEventIfNeeded.bind(client);
        client.decryptEventIfNeeded = (event, options) => {
            // State is read as it arrives: the replay waits for it.
            if (
                !replayingSavedSync ||
                matrixClient !== client ||
                event.isState()
            )
                return decrypt(event, options);
            replayDecryptions.push(event);
            // Never a promise that waits for the replay to end: the replay
            // itself may be what's waiting.
            return Promise.resolve();
        };
    }
}

/** The replay is over: do what it left, the open room's at once. */
function finishSavedSyncReplay(client: MatrixClient): void {
    if (!replayingSavedSync) return;
    replayingSavedSync = false;
    const openRoomId = replayOpenRoomId;
    const asked = replayDecryptions;
    replayDecryptions = [];

    // What shows without opening a room: its unread messages (their text
    // decides its counts and highlights), its newest for the preview, and
    // each thread's newest. All of the open room's.
    const shown = new Set<MatrixEvent>();
    const userId = client.getUserId();
    for (const room of client.getRooms()) {
        const events = room.getLiveTimeline().getEvents();
        const readUpTo = userId ? room.getEventReadUpTo(userId, true) : null;
        const read = readUpTo
            ? events.findIndex((e) => e.getId() === readUpTo)
            : -1;
        // A receipt older than what's saved leaves all of it unread.
        const unreadFrom =
            room.roomId === openRoomId
                ? 0
                : read !== -1
                  ? read + 1
                  : readUpTo && room.getUnreadNotificationCount() > 0
                    ? 0
                    : events.length;
        let previews = REPLAY_PREVIEW_EVENTS;
        for (let i = events.length - 1; i >= 0; i--) {
            if (i < unreadFrom && previews <= 0) break;
            if (!events[i].isEncrypted()) continue;
            shown.add(events[i]);
            // A reaction or an edit isn't what a preview shows: look past it.
            const relation =
                events[i].getWireContent()?.["m.relates_to"]?.rel_type;
            if (relation !== "m.annotation" && relation !== "m.replace")
                previews--;
        }
        for (const thread of room.getThreads()) {
            const newest = thread.events[thread.events.length - 1];
            if (newest) shown.add(newest);
        }
    }

    const first: MatrixEvent[] = [];
    const rest: MatrixEvent[] = [];
    for (const event of asked) {
        const roomId = event.getRoomId();
        const replayed =
            !!roomId &&
            client.getRoom(roomId)?.findEventById(event.getId() ?? "") ===
                event;
        // What the app itself asked for (a saved room's message, say) is
        // none of the replay's: it was wanted, and has waited.
        if (!replayed || roomId === openRoomId) first.push(event);
        else if (shown.has(event)) rest.push(event);
    }
    for (const event of first) void client.decryptEventIfNeeded(event);
    const setups = replayRoomSetups;
    void setups.get(openRoomId ?? "")?.().catch(() => {});

    // The other rooms' follow what the server has since, a few at a time and
    // the newest first: at once, they'd hold up that sync in the crypto
    // store, and the app on the main thread.
    rest.sort((a, b) => b.getTs() - a.getTs());
    const others = async (): Promise<void> => {
        for (let i = 0; i < rest.length; i += REPLAY_DECRYPT_SLICE) {
            if (matrixClient !== client || replayRoomSetups !== setups) return;
            await Promise.allSettled(
                rest
                    .slice(i, i + REPLAY_DECRYPT_SLICE)
                    .map((event) => client.decryptEventIfNeeded(event)),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        for (const [roomId, setup] of setups) {
            if (matrixClient !== client || replayRoomSetups !== setups) return;
            if (roomId !== openRoomId) await setup().catch(() => {});
        }
    };
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const start = (): void => {
        if (waiting === null) return;
        clearTimeout(waiting);
        waiting = null;
        client.off(ClientEvent.Sync, onLive as never);
        void others();
    };
    const onLive = (
        _state: string,
        _prev: string | null,
        data?: { fromCache?: boolean },
    ): void => {
        if (!data?.fromCache) start();
    };
    client.on(ClientEvent.Sync, onLive as never);
    // Offline, or the server is slow: they don't wait for it for long.
    waiting = setTimeout(start, REPLAY_LIVE_WAIT_MS);
}

function kickSync(client: MatrixClient): void {`,
      marker: "function watchSavedSyncReplay(client: MatrixClient): void {",
    },
    {
      kinds: program,
      contains: "function startSync(",
      from: `    initialSyncComplete = false;
    resetLiveSyncDelivered();
    lastSyncState = null;
`,
      to: `    initialSyncComplete = false;
    resetLiveSyncDelivered();
    lastSyncState = null;
    watchSavedSyncReplay(client, preferredRoomId);
`,
      marker: "    watchSavedSyncReplay(client, preferredRoomId);",
    },
    {
      kinds: program,
      contains: "function startSync(",
      from: `            lastSyncState = state;
            if (isHealthySyncState(state)) {
`,
      to: `            finishSavedSyncReplay(client);
            lastSyncState = state;
            if (isHealthySyncState(state)) {
`,
      marker: "            finishSavedSyncReplay(client);",
    },
  ]);
}
