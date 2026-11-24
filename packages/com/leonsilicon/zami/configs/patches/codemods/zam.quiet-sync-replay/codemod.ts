import type { SgRoot } from "@codemod.com/jssg-types/main";
import { editNodes } from "@-/com.leonsilicon.zami.configs.patches.codemods";

const program = ["program"];

const clientEdits = [
  {
    kinds: program,
    contains: "function onTimelineEvent(",
    from: `        // treated as new messages and drive false unread bumps/notifications.
        if (toStartOfTimeline || removed) return;
`,
    to: `        // treated as new messages and drive false unread bumps/notifications.
        if (toStartOfTimeline || removed) return;
        // The backlog a launch replays (the saved sync, or a first sync) is
        // no news either: the lists and the open room are built from it
        // once it's in, not event by event.
        if (!initialSyncComplete) return;
`,
    marker: "        // The backlog a launch replays (the saved sync, or a first sync) is",
  },
  {
    kinds: program,
    contains: "function onDecryptedTimelineEvent(",
    from: `        // Scroll-up backfill and removals are never new messages.
        if (toStartOfTimeline || removed || !room) return;
        if (!event.isEncrypted()) return;
        const eventId = event.getId();
        if (!eventId) return;
        pending.set(eventId, {`,
    to: `        // Scroll-up backfill and removals are never new messages.
        if (toStartOfTimeline || removed || !room) return;
        if (!event.isEncrypted()) return;
        // Nor is what the saved sync replays at launch: nothing is announced
        // for it, so there's nothing to do when it decrypts.
        if (!initialSyncComplete && data?.liveEvent !== true) return;
        const eventId = event.getId();
        if (!eventId) return;
        pending.set(eventId, {`,
    marker: "        // Nor is what the saved sync replays at launch: nothing is announced",
  },
  {
    kinds: program,
    contains: "function onAnyReceiptEvent(",
    from: `export function onAnyReceiptEvent(callback: () => void): () => void {
    if (!matrixClient) return () => {};
    matrixClient.on(RoomEvent.Receipt as never, callback as never);
    return () =>
        matrixClient?.off(RoomEvent.Receipt as never, callback as never);
}
`,
    to: `/** Called once for all the receipts in the backlog a launch replays (startSync). */
const receiptSubscribers = new Set<() => void>();

export function onAnyReceiptEvent(callback: () => void): () => void {
    if (!matrixClient) return () => {};
    const client = matrixClient;
    const handler = () => {
        if (initialSyncComplete) callback();
    };
    receiptSubscribers.add(callback);
    client.on(RoomEvent.Receipt as never, handler as never);
    return () => {
        receiptSubscribers.delete(callback);
        client.off(RoomEvent.Receipt as never, handler as never);
    };
}
`,
    marker: "const receiptSubscribers = new Set<() => void>();",
  },
  {
    kinds: program,
    contains: "function startSync(",
    from: `            if (state === "PREPARED") {
                if (!initialSyncComplete) {
                    bootMark("first-sync");
                    logBootTimeline();
                }
                initialSyncComplete = true;
                seedStatelessRooms();
            }
`,
    to: `            if (state === "PREPARED") {
                const backlogIn = !initialSyncComplete;
                if (backlogIn) {
                    bootMark("first-sync");
                    logBootTimeline();
                }
                initialSyncComplete = true;
                // The receipts of the backlog, which their subscribers
                // weren't called for one by one.
                if (backlogIn)
                    for (const caughtUp of [...receiptSubscribers]) caughtUp();
                seedStatelessRooms();
            }
`,
    marker: "                const backlogIn = !initialSyncComplete;",
  },
];

const roomsEdits = [
  {
    kinds: program,
    contains: "function bumpUnreadTick(",
    from: `export function bumpUnreadTick(): void {
    roomsState.unreadTick++;
}
`,
    to: `/** How long a burst of unread changes is gathered into one bump. */
const UNREAD_BUMP_MS = 50;
let unreadBump: ReturnType<typeof setTimeout> | null = null;

export function bumpUnreadTick(): void {
    // Every row of the room list re-derives from this, and a sync delivers
    // events (then their decryptions) in bursts of thousands: once for each
    // burst, not once for each event.
    unreadBump ??= setTimeout(() => {
        unreadBump = null;
        roomsState.unreadTick++;
    }, UNREAD_BUMP_MS);
}
`,
    marker: "const UNREAD_BUMP_MS = 50;",
  },
];

export default function codemod(root: SgRoot): string | null {
  return editNodes(root, root.filename().endsWith("/rooms.svelte.ts") ? roomsEdits : clientEdits);
}
