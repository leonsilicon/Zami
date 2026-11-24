import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const program = ["program"];

const messageAreaMarker = "<!-- Zami: a cached room has its composer too.";

function messageAreaEdits(component: string[]) {
  // Svelte's blocks don't parse as HTML, so the tree is error nodes. Each edit names the
  // whole text it replaces: the tightest node around less may hold only part of it.
  const edits = [
    {
      from: `        getRoom,
        isRoomCachedOnly,
        getReadUpToEventId,`,
      to: `        getRoom,
        getReadUpToEventId,`,
      marker: messageAreaMarker,
    },
    {
      from: `    // A room that exists only in the saved room list: sync hasn't delivered it
    // yet (offline, or early in any boot), so its timeline is the cached tail
    // and there is nothing to send to yet. Re-checked as sync delivers rooms.
    const cachedOnly = $derived.by(() => {
        void auth.syncState;
        return isRoomCachedOnly(room.roomId);
    });

`,
      to: "",
      marker: messageAreaMarker,
    },
    {
      from: `        <!-- Message input. Wrapped so its rendered height can be measured and
             the floating pills above can be offset to clear it. A cached room
             has no live timeline to send into, so it shows a note instead.
             That happens offline and also for a moment on every online boot,
             so the note doesn't claim either: ReconnectPill reports the
             connection. -->
        {#if cachedOnly}
            <div
                class="flex-shrink-0 mx-4 mb-4 rounded-lg border border-zam-backgroundModifier bg-zam-backgroundSecondary px-4 py-3"
                dir={uiDir}
            >
                <p class="text-xs text-zam-textMuted">
                    {t("messageArea.cachedRoomHint")}
                </p>
            </div>
        {:else}
            <div bind:clientHeight={composerHeight} class="flex-shrink-0">`,
      to: `        <!-- Message input. Wrapped so its rendered height can be measured and
             the floating pills above can be offset to clear it. -->
        ${messageAreaMarker} What it sends waits
             in the outbox, or in client.sendEvent, until sync has delivered
             the room. -->
            <div bind:clientHeight={composerHeight} class="flex-shrink-0">`,
      marker: messageAreaMarker,
    },
    {
      from: `                    onThreadCreated={openThread}
                />
            </div>
        {/if}
    </div>`,
      to: `                    onThreadCreated={openThread}
                />
            </div>
    </div>`,
      marker: messageAreaMarker,
    },
  ];
  return edits.map((edit) => ({ ...edit, kinds: component, contains: edit.from }));
}

function messageInputEdits(component: string[]) {
  return [
    {
      kinds: component,
      contains: "sendFormattedMessage,",
      from: `        sendTextMessage,
        sendFormattedMessage,
        sendSticker,`,
      to: `        sendTextMessage,
        sendFormattedMessage,
        isRoomCachedOnly,
        sendSticker,`,
      marker: "        isRoomCachedOnly,\n        sendSticker,",
    },
    {
      kinds: component,
      contains: "shouldQueueSend({",
      from: `            !isThread &&
            shouldQueueSend({
                syncState: auth.syncState,
                online: navigator.onLine,
            })
        ) {`,
      to: `            !isThread &&
            // Zami: sync hasn't delivered a cached room yet. Its message waits
            // in the outbox, which sends it once the room is live.
            (isRoomCachedOnly(targetRoomId) ||
                shouldQueueSend({
                    syncState: auth.syncState,
                    online: navigator.onLine,
                }))
        ) {`,
      marker: "(isRoomCachedOnly(targetRoomId) ||",
    },
  ];
}

const clientEdits = [
  {
    kinds: program,
    contains: "function isRoomCachedOnly(",
    from: `export function isRoomCachedOnly(roomId: string): boolean {
    return !!roomListCache?.rooms.get(roomId) && !matrixClient?.getRoom(roomId);
}
`,
    to: `export function isRoomCachedOnly(roomId: string): boolean {
    return !!roomListCache?.rooms.get(roomId) && !matrixClient?.getRoom(roomId);
}

/** How long an event for a cached room waits for sync to deliver the room. */
const CACHED_ROOM_SEND_WAIT_MS = 60_000;

/**
 * The transaction id of the outbox message being handed to the SDK. Zam's order
 * hints wrap sendMessage and take its last argument for the content, so the
 * id can't be passed through it: client.sendEvent, which sendMessage calls
 * before it returns, picks it up here.
 */
let outboxTxnId: string | undefined;

/** Resolves once sync has put a room in the SDK's store. */
function whenRoomLive(client: MatrixClient, roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const check = () => {
            if (client.getRoom(roomId)) finish();
        };
        const timer = setTimeout(
            () => finish(new Error(t("messageArea.cachedRoomHint"))),
            CACHED_ROOM_SEND_WAIT_MS,
        );
        function finish(error?: Error) {
            clearTimeout(timer);
            client.off(ClientEvent.Room, check);
            client.off(ClientEvent.Sync, check);
            if (error) reject(error);
            else resolve();
        }
        client.on(ClientEvent.Room, check);
        client.on(ClientEvent.Sync, check);
    });
}

/**
 * The SDK sends to a room it doesn't have without encrypting
 * (\`encryptEventIfNeeded\` returns early), and a cached room isn't in its
 * store yet. So every event for one waits here until sync has delivered the
 * room, whichever wrapper or plugin sent it.
 */
function holdSendsForCachedRooms(client: MatrixClient): void {
    const sendEvent = client.sendEvent as unknown as (
        ...args: unknown[]
    ) => Promise<unknown>;
    client.sendEvent = ((roomId: string, ...rest: unknown[]) => {
        // The SDK's sendMessage calls (roomId, threadId, type, content, txnId).
        const txnId = outboxTxnId;
        outboxTxnId = undefined;
        if (txnId !== undefined && rest.length === 4 && rest[3] === undefined)
            rest[3] = txnId;
        if (client.getRoom(roomId) || !roomListCache?.rooms.has(roomId))
            return sendEvent.call(client, roomId, ...rest);
        return whenRoomLive(client, roomId).then(() =>
            sendEvent.call(client, roomId, ...rest),
        );
    }) as unknown as typeof client.sendEvent;
}

/** Calls back with each room sync delivers, once it is in the SDK's store. */
export function onRoomLive(callback: (roomId: string) => void): () => void {
    const client = matrixClient;
    if (!client) return () => {};
    const onRoom = (room: Room) => callback(room.roomId);
    client.on(ClientEvent.Room, onRoom);
    return () => client.off(ClientEvent.Room, onRoom);
}
`,
    marker: "function holdSendsForCachedRooms(",
  },
  {
    kinds: program,
    contains: "function createAuthenticatedClient(",
    from: `    addOrderHints(client, bottomEventId, () => settingsState.orderHints);
    installClient(client);`,
    to: `    addOrderHints(client, bottomEventId, () => settingsState.orderHints);
    holdSendsForCachedRooms(client);
    installClient(client);`,
    marker: "    holdSendsForCachedRooms(client);\n    installClient(client);",
  },
  {
    kinds: program,
    contains: "function sendOutboxMessage(",
    from: `export async function sendOutboxMessage(
    roomId: string,
    content: Record<string, unknown>,
): Promise<string> {`,
    to: `export async function sendOutboxMessage(
    roomId: string,
    content: Record<string, unknown>,
    /** Zami: the same id on a retry, so the server never stores a message twice. */
    txnId?: string,
): Promise<string> {`,
    marker: "/** Zami: the same id on a retry, so the server never stores a message twice. */",
  },
  {
    kinds: program,
    contains: "function sendOutboxMessage(",
    from: `    try {
        const res = await matrixClient.sendMessage(roomId, content as never);
        return res.event_id;
    } catch (err) {
        const pending = matrixClient.getRoom(roomId)?.getPendingEvents() ?? [];`,
    to: `    try {
        // Zami: client.sendEvent takes the id up as sendMessage calls it.
        outboxTxnId = txnId;
        const sending = matrixClient.sendMessage(roomId, content as never);
        outboxTxnId = undefined;
        const res = await sending;
        return res.event_id;
    } catch (err) {
        const pending = matrixClient.getRoom(roomId)?.getPendingEvents() ?? [];`,
    marker: "// Zami: client.sendEvent takes the id up as sendMessage calls it.",
  },
];

const outboxEdits = [
  {
    kinds: program,
    contains: "function flushRoom(",
    from: 'import { sendOutboxMessage, onSyncReconnected } from "$lib/matrix/client";',
    to: `import {
    getLiveRoom,
    onRoomLive,
    onSyncReconnected,
    sendOutboxMessage,
} from "$lib/matrix/client";
import { auth } from "$lib/stores/auth.svelte";
import { readScoped, removeScoped, writeScoped } from "$lib/utils/scopedStorage";`,
    marker: 'import { readScoped, removeScoped, writeScoped } from "$lib/utils/scopedStorage";',
  },
  {
    kinds: program,
    contains: "function flushRoom(",
    from: `/** Apply a reducer result and bump the reactivity tick. */
function commit(next: OutboxState): void {
    state.s = next;
    state.tick++;
}
`,
    to: `// Zami: the outbox outlives the page. A message queued in the first moments of
// a launch must not be lost when the app is left and its web process is killed
// before sync has delivered the room.
const PERSIST_KEY = "zami_outbox";

interface PersistedItem {
    id: string;
    roomId: string;
    content: Record<string, unknown>;
}

function persist(): void {
    const userId = auth.userId;
    if (!userId) return;
    // A failed item is kept as well: it's still the user's unsent message.
    const items: PersistedItem[] = state.s.items.map((item) => ({
        id: item.id,
        roomId: item.roomId,
        content: { ...item.content },
    }));
    if (items.length === 0) removeScoped(PERSIST_KEY, userId);
    else writeScoped(PERSIST_KEY, userId, JSON.stringify(items));
}

/** Queue again what an earlier page left unsent. */
function restoreOutbox(): void {
    const userId = auth.userId;
    if (!userId) return;
    let saved: unknown;
    try {
        saved = JSON.parse(readScoped(PERSIST_KEY, userId) ?? "[]");
    } catch {
        return;
    }
    if (!Array.isArray(saved)) return;
    let next = state.s;
    for (const item of saved as Partial<PersistedItem>[]) {
        if (
            typeof item?.id !== "string" ||
            typeof item.roomId !== "string" ||
            typeof item.content !== "object" ||
            item.content === null
        )
            continue;
        next = enqueue(next, {
            id: item.id,
            roomId: item.roomId,
            content: item.content,
            seq: ++counter,
        });
    }
    if (next !== state.s) commit(next);
}

/** Apply a reducer result and bump the reactivity tick. */
function commit(next: OutboxState): void {
    state.s = next;
    state.tick++;
    persist();
}
`,
    marker: "function restoreOutbox(",
  },
  {
    kinds: program,
    contains: "function queueMessage(",
    from: "    commit(enqueue(state.s, { id: `o${seq}`, roomId, content, seq }));",
    to: `    // Zami: unique across page loads, as it's also the transaction id.
    const id = \`zami\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 10)}\`;
    commit(enqueue(state.s, { id, roomId, content, seq }));`,
    marker: "    commit(enqueue(state.s, { id, roomId, content, seq }));",
  },
  {
    kinds: program,
    contains: "function flushRoom(",
    from: `    if (flushing.has(roomId)) return;
    flushing.add(roomId);`,
    to: `    if (flushing.has(roomId)) return;
    // Zami: the SDK sends to a room it doesn't have without encrypting. A
    // cached room's items wait for sync to deliver it (onRoomLive, below).
    if (!getLiveRoom(roomId)) return;
    flushing.add(roomId);`,
    marker: "    if (!getLiveRoom(roomId)) return;",
  },
  {
    kinds: program,
    contains: "function flushRoom(",
    from: `                await sendOutboxMessage(roomId, {
                    ...item.content,
                });`,
    to: `                await sendOutboxMessage(
                    roomId,
                    { ...item.content },
                    item.id,
                );`,
    marker: "                    item.id,\n                );",
  },
  {
    kinds: program,
    contains: "function initOutbox(",
    from: `    const unsubReconnect = onSyncReconnected(flushOutbox);
    window.addEventListener("online", flushOutbox);
    return () => {
        unsubReconnect();
        window.removeEventListener("online", flushOutbox);
    };`,
    to: `    restoreOutbox();
    const unsubReconnect = onSyncReconnected(flushOutbox);
    const unsubRoomLive = onRoomLive((roomId) => {
        if (itemsForRoom(state.s, roomId).length > 0) void flushRoom(roomId);
    });
    window.addEventListener("online", flushOutbox);
    flushOutbox();
    return () => {
        unsubReconnect();
        unsubRoomLive();
        window.removeEventListener("online", flushOutbox);
    };`,
    marker: "    const unsubRoomLive = onRoomLive(",
  },
];

/**
 * Makes `edits`, and checks that the file then has each one: an edit whose marker upstream
 * already had would otherwise be skipped as made, and the file left half-changed.
 */
function edit(root: SgRoot, edits: Parameters<typeof editNodes>[1]): string | null {
  const changed = editNodes(root, edits);
  const source = changed ?? root.root().text();
  for (const { to } of edits) {
    if (to !== "" && !source.includes(to)) {
      throw new Error(
        `${root.filename()}: an edit wasn't made: ${JSON.stringify(to.slice(0, 160))}`,
      );
    }
  }
  return changed;
}

export default function codemod(root: SgRoot): string | null {
  const filename = root.filename();
  const component = [String(root.root().kind())];
  if (filename.endsWith("/MessageArea.svelte")) return edit(root, messageAreaEdits(component));
  if (filename.endsWith("/MessageInput.svelte")) return edit(root, messageInputEdits(component));
  if (filename.endsWith("/client.ts")) return edit(root, clientEdits);
  if (filename.endsWith("/outbox.svelte.ts")) return edit(root, outboxEdits);
  throw new Error(`zam.send-before-sync codemod: unexpected file ${filename}`);
}
