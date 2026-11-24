import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const clientEdits = [
  {
    kinds: ["program"],
    contains: 'from "./roomListCache";',
    from: "    loadHierarchies,",
    to: `    loadHierarchies,
    restoreCachedTimeline,`,
    marker: "    restoreCachedTimeline,",
  },
  {
    kinds: ["program"],
    contains: "function createAuthenticatedClient(",
    from: `    accessTokenExpiresAt?: number;
}): Promise<MatrixClient> {`,
    to: `    accessTokenExpiresAt?: number;
    restore?: boolean;
}): Promise<MatrixClient> {`,
    marker: "    restore?: boolean;",
  },
  {
    kinds: ["program"],
    contains: "function createAuthenticatedClient(",
    from: "    const { oauth, accessTokenExpiresAt, ...clientOpts } = opts;",
    to: `    const { oauth, accessTokenExpiresAt, restore, ...clientOpts } = opts;
    // Read the room list while the SDK store and crypto are opening.
    const savedRooms = restore
        ? loadSnapshot(snapshotKey(opts.userId, opts.deviceId))
        : undefined;`,
    marker: "    const savedRooms = restore",
  },
  {
    kinds: ["program"],
    contains: "function createAuthenticatedClient(",
    from: `    installClient(client);

    // Warm the /versions cache.`,
    to: `    installClient(client);
    if (savedRooms) pendingRoomLists.set(client, savedRooms);

    // Warm the /versions cache.`,
    marker: "if (savedRooms) pendingRoomLists.set(client, savedRooms);",
  },
  {
    kinds: ["program"],
    contains: "function reconnect(",
    from: `        deviceId,
        ...oauth,
    });
}`,
    to: `        deviceId,
        ...oauth,
        restore: true,
    });
}`,
    marker: "        restore: true,",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `            // Classic /sync delivers the whole room list in one (cached or live)
            // pass; sliding sync reports completion from its list windows.
            if (state === "PREPARED" && !isUsingSlidingSync())
                markRoomListComplete(client);`,
    to: `            // Classic /sync's cached PREPARED can predate the room snapshot.
            // Keep its rooms until the server has delivered a real update.
            if (
                !data?.fromCache && !isUsingSlidingSync() &&
                (state === "PREPARED" || state === "SYNCING")
            )
                markRoomListComplete(client);`,
    marker: "// Classic /sync's cached PREPARED",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `    // Without crypto, sync would still receive the room keys other sessions
    // send this one and acknowledge them, and the server deletes what was
    // acknowledged: those keys would be gone for good, and every message
    // they unlock unreadable. Sliding sync can leave them on the server;
    // classic /sync can't, so it isn't started at all.
    const cryptoDown = !isCryptoAvailable();
    setSyncHeldForCrypto(false);

    try {
        const slidingSync = await buildSlidingSync(client, {
            keepToDeviceOnServer: cryptoDown,
`,
    to: `    if (!ownedClient(owner)) {
        dispose();
        return dispose;
    }
    const canStart = () =>
        !disposed && !backgroundReleased && !!ownedClient(owner);
    const warm = restoring && roomListCache !== null;
    const watchKeysVerdict = (): void => {
        // A background keys check (createAuthenticatedClient) that found this
        // device replaced has signed it out already. End the session here the
        // way an expiry does, as the blocking path does by throwing.
        const keysVerdict = deferredKeysVerdicts.get(client);
        if (keysVerdict) {
            deferredKeysVerdicts.delete(client);
            void keysVerdict.then((verdict) => {
                if (verdict !== "replaced" || !ownedClient(owner)) return;
                showErrorToast(t("crypto.encryptionDataLost"));
                onSessionExpired?.();
            });
        }
    };
    const startLiveSync = async (): Promise<void> => {
        if (!canStart()) return;

        // Without crypto, sync would still receive the room keys other sessions
        // send this one and acknowledge them, and the server deletes what was
        // acknowledged: those keys would be gone for good, and every message
        // they unlock unreadable. Sliding sync can leave them on the server;
        // classic /sync can't, so it isn't started at all.
        const cryptoDown = !isCryptoAvailable();
        setSyncHeldForCrypto(false);

        const slidingSync = await buildSlidingSync(client, {
            keepToDeviceOnServer: cryptoDown,
`,
    marker: "const watchKeysVerdict = (): void => {",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `                ),
        });
        if (cryptoDown && !slidingSync) {
            logSync(
`,
    to: `                ),
        });
        if (!canStart()) return;
        if (cryptoDown && !slidingSync) {
            logSync(
`,
    marker: "if (!canStart()) return;\n        if (cryptoDown && !slidingSync)",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `            setSyncHeldForCrypto(true);
            onStateChange("STOPPED");
            return dispose;
        }
        bootMark("startclient-start");
        await client.startClient({
            slidingSync: slidingSync,
            initialSyncLimit: 8,
`,
    to: `            setSyncHeldForCrypto(true);
            onStateChange("STOPPED");
            return;
        }
        const options = {
            slidingSync: slidingSync,
            initialSyncLimit: 8,
`,
    marker: "const options = {\n            slidingSync: slidingSync,",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `            // thread filter in getTimelineMessages hides it from view entirely.
            threadSupport: true,
        });
        bootMark("startclient-done");
        // A background keys check (createAuthenticatedClient) that found this
        // device replaced has signed it out already. End the session here the
        // way an expiry does, as the blocking path does by throwing.
        const keysVerdict = deferredKeysVerdicts.get(client);
        if (keysVerdict) {
            deferredKeysVerdicts.delete(client);
            void keysVerdict.then((verdict) => {
                if (verdict !== "replaced" || !ownedClient(owner)) return;
                showErrorToast(t("crypto.encryptionDataLost"));
                onSessionExpired?.();
            });
        }
    } catch (err) {
        // A rejected start must not leave four listeners bound to a client the
        // caller is about to throw away.
        dispose();
        throw err;
    }

    // The slot changed while we were starting up (expiry, or a second
    // sign-in): this client never became the app's client, so detach now.
    if (!ownedClient(owner)) dispose();

    return dispose;`,
    to: `            // thread filter in getTimelineMessages hides it from view entirely.
            threadSupport: true,
        };
        if (warm) {
            // The SDK marks the client as running before it awaits /versions.
            // Wait outside startClient so a logout or background release can
            // cancel this launch before the SDK creates a new sync loop.
            // The server's answer from the last launch stands in for this
            // one's, so the saved rooms load without waiting for the network;
            // the SDK keeps the live answer for everything it asks later.
            const live = client.getVersions();
            void live.then((answer) => saveServerVersions(client, answer), () => {});
            const saved = savedServerVersions(client);
            const versions = saved ? Promise.resolve(saved) : live;
            await versions.catch(() => {});
            if (!canStart()) return;
            // Reuse the settled result even on failure, so startClient can
            // continue offline without launching another blocking request.
            const getVersions = client.getVersions;
            client.getVersions = () => versions;
            try {
                bootMark("startclient-start");
                await client.startClient(options);
            } finally {
                client.getVersions = getVersions;
            }
        } else {
            bootMark("startclient-start");
            await client.startClient(options);
        }
        bootMark("startclient-done");
        if (!warm) watchKeysVerdict();
    };

    if (roomListCache) {
        const cache = roomListCache;
        // Let Svelte commit and the WebView paint the cached list before
        // bulk decryption can take over the event loop.
        void afterCachedRoomPaint().then(() => {
            if (canStart() && roomListCache === cache)
                return decryptCachedEvents(client, cache, preferredRoomId);
        });
    }

    if (warm) {
        watchKeysVerdict();
        onStateChange("RECONNECTING");
        // The saved sync replays in the turn the shell is drawn in, not
        // after it: what the server has since (asked for as the page
        // started, by Zami's shell) can then follow it at once, so the
        // first frame of the app is already connected.
        void startLiveSync().catch((err) => {
            if (!canStart()) return;
            console.warn("[matrix] cached launch could not start sync", err);
            onStateChange("ERROR");
        });
    } else {
        try {
            await startLiveSync();
        } catch (err) {
            dispose();
            throw err;
        }
    }

    if (!ownedClient(owner)) dispose();
    return dispose;`,
    marker: "// The SDK marks the client as running before it awaits /versions.",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `    await hydrateRoomListCache(client, preferredRoomId);
    bootMark("roomlist-hydrated");`,
    to: `    const restoring = pendingRoomLists.has(client);
    await hydrateRoomListCache(client);
    bootMark("roomlist-hydrated");`,
    marker: "    const restoring = pendingRoomLists.has(client);",
  },
  {
    kinds: ["program"],
    contains: "async function hydrateRoomListCache(",
    from: `async function hydrateRoomListCache(
    client: MatrixClient,
    preferredRoomId?: string | null,
): Promise<void> {
    resetRoomListCache();
    const userId = client.getUserId();
    const deviceId = client.getDeviceId();
    if (!userId || !deviceId) return;
    // Independent of the snapshot and of the room list completing: sync
    // finishing first must not leave a big space to be walked from scratch.
    resetHierarchyCache();
    hierarchyPersistKey = snapshotKey(userId, deviceId);
    const savedHierarchies = await loadHierarchies(hierarchyPersistKey);
    if (matrixClient === client && savedHierarchies)
        for (const [spaceId, list] of Object.entries(savedHierarchies))
            if (!hierarchyCache.has(spaceId)) hierarchyCache.set(spaceId, list);
    const snapshot = await loadSnapshot(snapshotKey(userId, deviceId));
    if (!snapshot || matrixClient !== client || roomListComplete) return;
    const cache = materializeSnapshot(client, snapshot);
    // The cached tail of an encrypted room is ciphertext. Decrypt the room the
    // user is about to open BEFORE publishing, so its first paint is normally
    // the real conversation instead of a placeholder. The wait is bounded: a
    // missing key can send the SDK to key backup (network), and boot must not
    // hang on that. Every other room, and anything this pass did not finish,
    // is decrypted in the background; while an event waits there, MessageItem
    // renders a neutral "decrypting" row rather than claiming its keys are
    // missing.
    if (preferredRoomId) {
        const preferred = cache.rooms.get(preferredRoomId);
        if (preferred)
            await Promise.race([
                decryptRoomEvents(client, preferred),
                new Promise<void>((resolve) =>
                    setTimeout(resolve, PREFERRED_DECRYPT_WAIT_MS),
                ),
            ]);
        // A logout/reconnect during that await must win over this snapshot.
        if (matrixClient !== client || roomListComplete) return;
    }
    for (const [spaceId, list] of Object.entries(snapshot.hierarchies ?? {}))
        if (!hierarchyCache.has(spaceId)) hierarchyCache.set(spaceId, list);
    roomListCache = cache;
    void decryptCachedEvents(client, cache, preferredRoomId);
}

`,
    to: `const pendingRoomLists = new WeakMap<MatrixClient, ReturnType<typeof loadSnapshot>>();

/** How long decrypting the saved rooms waits for Zami's launch frame to hand over to the app. */
const LAUNCH_FRAME_WAIT_MS = 1500;

function afterCachedRoomPaint(): Promise<void> {
    return new Promise((resolve) => {
        const started = performance.now();
        const painted = () => {
            // Decrypting keeps the main thread busy. Zami's launch frame
            // (drawn before this code loaded) may have the keyboard: let it
            // hand what was typed to the app's composer first.
            const frame = (globalThis as { __zamiLaunch?: unknown }).__zamiLaunch;
            if (frame && performance.now() - started < LAUNCH_FRAME_WAIT_MS)
                window.setTimeout(painted, 16);
            else resolve();
        };
        const fallback = window.setTimeout(painted, 100);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.clearTimeout(fallback);
                painted();
            });
        });
    });
}

const SERVER_VERSIONS_KEY = "zami_server_versions";

type ServerVersions = Awaited<ReturnType<MatrixClient["getVersions"]>>;

/** What the homeserver answered /versions with at the last launch. */
function savedServerVersions(client: MatrixClient): ServerVersions | null {
    try {
        const saved = JSON.parse(
            localStorage.getItem(SERVER_VERSIONS_KEY) ?? "null",
        );
        return saved?.baseUrl === client.baseUrl &&
            Array.isArray(saved.versions?.versions)
            ? saved.versions
            : null;
    } catch {
        return null;
    }
}

function saveServerVersions(
    client: MatrixClient,
    versions: ServerVersions,
): void {
    try {
        localStorage.setItem(
            SERVER_VERSIONS_KEY,
            JSON.stringify({ baseUrl: client.baseUrl, versions }),
        );
    } catch {
        // Storage is full or off: the next launch asks the server first.
    }
}

async function hydrateRoomListCache(client: MatrixClient): Promise<void> {
    resetRoomListCache();
    const userId = client.getUserId();
    const deviceId = client.getDeviceId();
    if (!userId || !deviceId) return;

    resetHierarchyCache();
    const key = snapshotKey(userId, deviceId);
    hierarchyPersistKey = key;
    void loadHierarchies(key).then((saved) => {
        if (matrixClient !== client || !saved) return;
        let changed = false;
        for (const [spaceId, list] of Object.entries(saved)) {
            if (hierarchyFetchedAt.has(spaceId)) continue;
            hierarchyCache.set(spaceId, list);
            changed = true;
        }
        if (changed) for (const cb of roomUpdateSubscribers) cb();
    });

    const savedRooms = pendingRoomLists.get(client);
    pendingRoomLists.delete(client);
    const snapshot = await (savedRooms ?? loadSnapshot(key));
    if (!snapshot || matrixClient !== client || roomListComplete) return;
    for (const [spaceId, list] of Object.entries(snapshot.hierarchies ?? {}))
        if (!hierarchyCache.has(spaceId)) hierarchyCache.set(spaceId, list);
    roomListCache = materializeSnapshot(client, snapshot, true);
}

`,
    marker: "function afterCachedRoomPaint()",
  },
  {
    kinds: ["program"],
    contains: "const SNAPSHOT_SAVE_INTERVAL_MS",
    from: `// A cached event with its key present decrypts from the local store in a few
// milliseconds. With a key missing the SDK may consult key backup, which can
// hit the network, so the boot paint waits at most this long for the landing
// room and then lets the rest fill in behind the neutral "decrypting" row.
const PREFERRED_DECRYPT_WAIT_MS = 500;

`,
    to: "\n",
    marker: "roomListCache = materializeSnapshot(client, snapshot, true);",
  },
  {
    kinds: ["program"],
    contains: "function decryptCachedEvents(",
    from: `    skipRoomId?: string | null,
): Promise<void> {
    for (const [roomId, room] of cache.rooms) {
        if (roomId === skipRoomId) continue;
        await decryptRoomEvents(client, room);
    }`,
    to: `    preferredRoomId?: string | null,
): Promise<void> {
    const preferred = preferredRoomId ? cache.rooms.get(preferredRoomId) : undefined;
    // A room the SDK has by now is shown from there, not from its saved
    // stand-in: the SDK decrypts its own.
    const shown = (room: Room): boolean => !client.getRoom(room.roomId);
    if (preferred && shown(preferred)) await decryptRoomEvents(client, preferred);
    for (const room of cache.rooms.values()) {
        if (roomListCache !== cache || matrixClient !== client || backgroundReleased) return;
        if (room !== preferred && shown(room)) await decryptRoomEvents(client, room);
    }`,
    marker: "    const preferred = preferredRoomId ? cache.rooms.get(preferredRoomId) : undefined;",
  },
  {
    kinds: ["program"],
    contains: "function getTimelineMessages(",
    from: "    pruneDeliveredEchoes(room);",
    to: `    restoreCachedTimeline(room);
    pruneDeliveredEchoes(room);`,
    marker: "    restoreCachedTimeline(room);",
  },
  {
    kinds: ["program"],
    contains: "function startSync(",
    from: `     * The room the app is about to open. Its cached encrypted tail is
     * decrypted before the cache is published so the first timeline paint is
     * already cleartext. Other cached rooms decrypt in the background.`,
    to: "     * Prefer the last open room when decrypting cached previews after paint.",
    marker: "Prefer the last open room when decrypting cached previews",
  },
];

const roomListCacheEdits = [
  {
    kinds: ["program"],
    contains: 'import type { SpaceChildInfo } from "./client";',
    from: 'import type { SpaceChildInfo } from "./client";',
    to: `import type { SpaceChildInfo } from "./client";
import { latestMessage } from "$lib/utils/roomPreview";`,
    marker: 'import { latestMessage } from "$lib/utils/roomPreview";',
  },
  {
    kinds: ["program"],
    contains: "function loadSnapshot(",
    from: "return snap && snap.v === SNAPSHOT_VERSION ? snap : null;",
    to: `return snap?.v === SNAPSHOT_VERSION &&
            Array.isArray(snap.rooms) && Array.isArray(snap.accountData)
            ? snap
            : null;`,
    marker: "Array.isArray(snap.rooms) && Array.isArray(snap.accountData)",
  },
  {
    kinds: ["program"],
    contains: "const MAX_CACHED_EVENTS",
    from: `// Recent timeline events kept per room so a boot with no network can show the
// conversation instead of an empty pane. Wire events only: encrypted rooms
// cache the ciphertext the SDK's own store already holds. Decryption is NOT
// part of materialising (there is no decrypt call there): client.ts decrypts
// the room about to be opened before publishing the cache, then the rest in
// the background. Until that pass reaches an event, the timeline renders a
// neutral "decrypting" row, never the missing-keys copy.
`,
    to: `// Keep a cached conversation per room. Encrypted events are saved in wire
// form. During startup, load the newest room preview and its timeline tail.
`,
    marker: "// Keep a cached conversation per room.",
  },
  {
    kinds: ["program"],
    contains: "function materializeSnapshot(",
    from: `/** Turn a snapshot back into detached, read-only Room objects. */
export function materializeSnapshot(
    client: MatrixClient,
    snapshot: RoomListSnapshot,
): MaterializedCache {
`,
    to: `const deferredTimelines = new WeakMap<Room, Partial<IEvent>[]>();

function hasCachedPreview(raw: Partial<IEvent>): boolean {
    try {
        return latestMessage([new MatrixEvent(raw)]) !== null;
    } catch {
        return false;
    }
}

/** Add the rest of a cached room's history when its timeline is opened. */
export function restoreCachedTimeline(room: Room): void {
    const older = deferredTimelines.get(room);
    if (!older) return;
    deferredTimelines.delete(room);
    const timeline = room.getLiveTimeline();
    for (let i = older.length - 1; i >= 0; i--) {
        timeline.addEvent(new MatrixEvent(older[i]), {
            toStartOfTimeline: true,
            addToState: false,
        });
    }
}

/** Turn a snapshot back into detached, read-only Room objects. */
export function materializeSnapshot(
    client: MatrixClient,
    snapshot: RoomListSnapshot,
    deferTimelines = false,
): MaterializedCache {
`,
    marker: "const deferredTimelines = new WeakMap",
  },
  {
    kinds: ["program"],
    contains: "function materializeSnapshot(",
    from: `                for (const raw of cached.timeline) {
                    timeline.addEvent(toEvent(raw), {
                        toStartOfTimeline: false,
                        addToState: false,
                    });
                }`,
    to: `                const events = cached.timeline;
                // A reaction or edit can follow the newest displayable message.
                const preview = deferTimelines ? events.findLastIndex(hasCachedPreview) : 0;
                const first = preview < 0 ? events.length - 1 : preview;
                if (first > 0) deferredTimelines.set(room, events.slice(0, first));
                for (let i = first; i < events.length; i++) {
                    timeline.addEvent(toEvent(events[i]), {
                        toStartOfTimeline: false,
                        addToState: false,
                    });
                }`,
    marker: "const preview = deferTimelines",
  },
];

export default function codemod(root: SgRoot): string | null {
  return editNodes(
    root,
    root.filename().endsWith("/roomListCache.ts") ? roomListCacheEdits : clientEdits,
  );
}
