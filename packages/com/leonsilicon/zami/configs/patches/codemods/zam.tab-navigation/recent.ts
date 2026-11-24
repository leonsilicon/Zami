import type { Change } from "#codemod";

export const matrixChanges: Change[] = [
  [
    "export function getLatestTimelineEvent(room: Room): MatrixEvent | undefined {",
    `/** Recent messages from sync, including threads and rooms with push disabled. */
export function getRecentRoomMessages(limit: number, ignored: ReadonlySet<string>) {
    const candidates: { event: MatrixEvent; room: Room; id: string; sender: string; threadRootId: string | null }[] = [];
    const seen = new Set<string>();
    function append(room: Room, events: MatrixEvent[]) {
        for (const event of events.slice(-limit)) {
            const id = event.getId();
            const sender = event.getSender();
            if (!id || !sender || ignored.has(sender) || seen.has(id) ||
                event.status || event.isState() || event.isRedacted() || event.localRedactionEvent()) continue;
            const relation = event.getOriginalContent()?.["m.relates_to"];
            if (relation?.rel_type === "m.replace" || relation?.rel_type === THREAD_NAME_REL_TYPE) continue;
            const type = event.getType();
            if (type !== "m.room.message" && type !== "m.room.encrypted" && type !== "m.sticker" &&
                !isPollStartEventType(type) && !isFileOfferEventType(type)) continue;
            seen.add(id);
            candidates.push({ event, room, id, sender, threadRootId: eventThreadRoot(event) });
        }
    }
    for (const room of getRooms()) {
        if (room.isSpaceRoom()) continue;
        let remaining = limit;
        for (const timeline of liveTimelineChain(room).reverse()) {
            const events = timeline.getEvents();
            append(room, events.slice(-remaining));
            remaining -= events.length;
            if (remaining <= 0) break;
        }
        for (const thread of room.getThreads()) append(room, thread.events);
    }

    const recent = candidates.sort((a, b) => b.event.getTs() - a.event.getTs()).slice(0, limit);
    decryptForDisplay(recent.map(({ event }) => event));
    const userId = matrixClient?.getUserId();
    return recent.map(({ event, room, id, sender, threadRootId }) => ({
        event,
        roomId: room.roomId,
        eventId: id,
        sender,
        ts: event.getTs(),
        threadRootId,
        read: !userId || sender === userId ||
            (threadRootId ? room.getThread(threadRootId) ?? room : room).hasUserReadEvent(userId, id),
    }));
}

export function onRecentRoomMessagesChanged(callback: () => void): () => void {
    const client = matrixClient;
    if (!client) return () => {};
    client.on(RoomEvent.Timeline, callback);
    client.on(RoomEvent.TimelineReset, callback);
    client.on(RoomEvent.Redaction, callback);
    const stopEdit = onEditEvent(callback);
    const stopDecryption = onEventDecrypted(callback);
    return () => {
        client.off(RoomEvent.Timeline, callback);
        client.off(RoomEvent.TimelineReset, callback);
        client.off(RoomEvent.Redaction, callback);
        stopEdit();
        stopDecryption();
    };
}

export function getLatestTimelineEvent(room: Room): MatrixEvent | undefined {`,
    "export function getRecentRoomMessages(",
  ],
];

export const notificationsChanges: Change[] = [
  [
    '    import { displayContent } from "$lib/utils/displayContent";',
    `    import { displayContent } from "$lib/utils/displayContent";
    import { eventPreviewText } from "$lib/utils/eventPreviewText";
    import { appStoreBuild, contentFilter, matchesMutedPhrase } from "@-/com.leonsilicon.zami.plugins/web";
    import { roomsState } from "$lib/stores/rooms.svelte";
    import { ignoredUsersState } from "$lib/stores/ignoredUsers.svelte";
    import { untrack } from "svelte";`,
    "import { eventPreviewText }",
  ],
  [
    "        fetchServerNotifications,",
    "        fetchServerNotifications,\n        getRecentRoomMessages,\n        onRecentRoomMessagesChanged,",
    "        onRecentRoomMessagesChanged,",
  ],
  [
    `        onClose: () => void;
        onJumpTo: (roomId: string, eventId: string) => void;
    }

    let { onClose, onJumpTo }: Props = $props();`,
    `        onClose?: () => void;
        onJumpTo?: (roomId: string, eventId: string) => void;
        recentMessages?: boolean;
    }

    let { onClose, onJumpTo, recentMessages = false }: Props = $props();
    let recentItems = $state<DisplayItem[]>([]);
    let refreshRecent: (() => void) | undefined;

    $effect(() => {
        if (!recentMessages) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        function update() {
            timer = undefined;
            const ignored = new Set(ignoredUsersState.userIds);
            recentItems = getRecentRoomMessages(100, ignored).map(({ event, ...item }) => {
                const original = displayContent(event)?.body;
                let body = "";
                if (event.getType() === "m.room.encrypted") {
                    body = t("encryptionState.encryptedMessage");
                } else if (original == null || typeof original === "string") {
                    body = eventPreviewText(event) ?? "";
                }
                if (appStoreBuild && (matchesMutedPhrase(body) ||
                    (typeof original === "string" && matchesMutedPhrase(original)))) {
                    body = t("zami.messageFiltered");
                }
                return { ...item, body };
            });
        }
        function schedule() {
            timer ??= setTimeout(update, 150);
        }
        refreshRecent = schedule;
        const stop = onRecentRoomMessagesChanged(schedule);
        untrack(update);
        return () => {
            stop();
            clearTimeout(timer);
            refreshRecent = undefined;
        };
    });

    $effect(() => {
        if (!recentMessages) return;
        void roomsState.roomsTick;
        void roomsState.unreadTick;
        void ignoredUsersState.userIds;
        if (appStoreBuild) void contentFilter.phrases;
        refreshRecent?.();
    });`,
    "recentMessages?: boolean",
  ],
  [
    "    $effect(() => {\n        refresh();",
    "    $effect(() => {\n        if (recentMessages) return;\n        refresh();",
    "if (recentMessages) return;\n        refresh();",
  ],
  [
    "        read: boolean;\n    }",
    "        read: boolean;\n        threadRootId?: string | null;\n    }",
    "threadRootId?: string | null;",
  ],
  [
    "        void notificationsState.tick;",
    "        if (recentMessages) return recentItems;\n        void notificationsState.tick;",
    "if (recentMessages) return recentItems;",
  ],
  [
    `    function jump(roomId: string, eventId: string) {
        navigateToRoom(roomId);
        onJumpTo(roomId, eventId);
        onClose();
    }`,
    `    function jump(item: DisplayItem) {
        if (recentMessages) {
            navigateToRoom(item.roomId, item.eventId, item.threadRootId ?? undefined);
            return;
        }
        navigateToRoom(item.roomId);
        onJumpTo?.(item.roomId, item.eventId);
        onClose?.();
    }`,
    "function jump(item: DisplayItem)",
  ],
  [
    `    class="{interfaceState.isMobile
        ? ''
        : 'w-80'} h-full flex flex-col bg-zam-backgroundSecondary border-l border-zam-divider"`,
    `    class={recentMessages
        ? "zami-recent-messages"
        : (interfaceState.isMobile ? "" : "w-80 ") + "h-full flex flex-col bg-zam-backgroundSecondary border-l border-zam-divider"}`,
    'class={recentMessages\n        ? "zami-recent-messages"',
  ],
  [
    `    <div
        class="h-12 flex items-center gap-2 px-4 py-3 border-b border-zam-divider flex-shrink-0"
    >`,
    `    {#if recentMessages}
        <header class="zami-tab-heading"><h2>{t("common.notifications")}</h2></header>
    {:else}
    <div
        class="h-12 flex items-center gap-2 px-4 py-3 border-b border-zam-divider flex-shrink-0"
    >`,
    'class="zami-tab-heading"',
  ],
  [
    '    </div>\n\n    <div class="flex-1 overflow-y-auto">',
    '    </div>\n    {/if}\n\n    <div class="flex-1 overflow-y-auto">',
    '    {/if}\n\n    <div class="flex-1 overflow-y-auto">',
  ],
  [
    '{#if loading && serverSupport === "unknown"}',
    '{#if !recentMessages && loading && serverSupport === "unknown"}',
    "{#if !recentMessages && loading",
  ],
  [
    '{t("notificationsPanel.noNotifications")}',
    '{t(recentMessages ? "zami.noRecentMessages" : "notificationsPanel.noNotifications")}',
    't(recentMessages ? "zami.noRecentMessages"',
  ],
  [
    '<div class="p-2 space-y-1">',
    '<div class={recentMessages ? "zami-recent-list" : "p-2 space-y-1"}>',
    'class={recentMessages ? "zami-recent-list"',
  ],
  [
    "onclick={() => jump(n.roomId, n.eventId)}",
    "onclick={() => jump(n)}",
    "onclick={() => jump(n)}",
  ],
  [
    'class="block w-full text-start p-2 rounded-lg hover:bg-zam-messageHover transition-colors cursor-pointer border-s-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zam-accent {n.read',
    'class="zami-notification-row block w-full text-start p-2 rounded-lg hover:bg-zam-messageHover transition-colors cursor-pointer border-s-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zam-accent {n.read',
    'class="zami-notification-row ',
  ],
];
