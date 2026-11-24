import type { Change } from "#codemod";

export const roomsChanges: Change[] = [
  [
    "    if (spaceId === roomsState.activeSpaceId) return;",
    '    interfaceState.zamiTab = "home";\n    if (spaceId === roomsState.activeSpaceId) return;',
    'interfaceState.zamiTab = "home";\n    if (spaceId === roomsState.activeSpaceId)',
  ],
  [
    "pendingJump: null as { roomId: string; eventId: string } | null,",
    "pendingJump: null as { roomId: string; eventId: string; threadRootId?: string } | null,",
    "eventId: string; threadRootId?: string } | null",
  ],
  [
    "    markRoomPendingArrival(roomId);\n    roomsState.draftDm = null;",
    '    interfaceState.zamiTab = "home";\n    markRoomPendingArrival(roomId);\n    roomsState.draftDm = null;',
    'interfaceState.zamiTab = "home";\n    markRoomPendingArrival(roomId);',
  ],
  [
    "export function showInviteInbox(): void {\n    roomsState.draftDm = null;",
    'export function showInviteInbox(): void {\n    interfaceState.zamiTab = "home";\n    roomsState.draftDm = null;',
    'function showInviteInbox(): void {\n    interfaceState.zamiTab = "home";',
  ],
  [
    "    roomsState.draftDm = { userId, encrypt };",
    '    interfaceState.zamiTab = "home";\n    roomsState.draftDm = { userId, encrypt };',
    'interfaceState.zamiTab = "home";\n    roomsState.draftDm = { userId, encrypt };',
  ],
  [
    "export function navigateToRoom(roomId: string, eventId?: string): void {",
    "export function navigateToRoom(roomId: string, eventId?: string, threadRootId?: string): void {",
    "eventId?: string, threadRootId?: string): void",
  ],
  [
    "    roomsState.pendingJump = eventId ? { roomId, eventId } : null;",
    "    roomsState.pendingJump = eventId ? { roomId, eventId, threadRootId } : null;",
    "roomsState.pendingJump = eventId ? { roomId, eventId, threadRootId }",
  ],
];

export const messageAreaChanges: Change[] = [
  [
    "    let threadRootId = $state<string | null>(null);",
    "    let threadRootId = $state<string | null>(null);\n    let threadJumpId = $state<string | undefined>();",
    "let threadJumpId = $state",
  ],
  [
    "    function openThread(rootEventId: string) {\n        threadRootId = rootEventId;",
    "    function openThread(rootEventId: string, eventId?: string) {\n        threadRootId = rootEventId;\n        threadJumpId = eventId;",
    "function openThread(rootEventId: string, eventId?: string)",
  ],
  [
    "            void scrollToMessage(jump.eventId);",
    "            if (jump.threadRootId) openThread(jump.threadRootId, jump.eventId);\n            else void scrollToMessage(jump.eventId);",
    "if (jump.threadRootId) openThread",
  ],
  ...[
    ["                        ", "fullscreen\n                    />"],
    ["                        ", "fullscreen\n                        onToggleFullscreen"],
    ["                    ", "onToggleFullscreen"],
  ].map(([indent, following]): Change => [
    `${indent}rootEventId={threadRootId}\n${indent}onClose={closeThread}\n${indent}${following}`,
    `${indent}rootEventId={threadRootId}\n${indent}jumpEventId={threadJumpId}\n${indent}onClose={closeThread}\n${indent}${following}`,
    `${indent}rootEventId={threadRootId}\n${indent}jumpEventId={threadJumpId}\n${indent}onClose={closeThread}\n${indent}${following}`,
  ]),
];

export const threadChanges: Change[] = [
  [
    "        rootEventId: string;\n        onClose",
    "        rootEventId: string;\n        jumpEventId?: string;\n        onClose",
    "jumpEventId?: string;",
  ],
  [
    "        rootEventId,\n        onClose,",
    "        rootEventId,\n        jumpEventId,\n        onClose,",
    "        jumpEventId,\n        onClose,",
  ],
  [
    "        getThreadMessages,",
    "        getThreadMessages,\n        getEventThreadRootId,\n        fetchEventById,",
    "        getEventThreadRootId,",
  ],
  [
    "    // Re-read thread messages whenever tick changes",
    `    // A synced reply can be discoverable in the room before the SDK has
    // finished populating the thread's own timeline. Keep the jump target
    // visible in that window, then let the timeline take over.
    let jumpedReply = $state<MatrixEvent | null>(null);
    $effect(() => {
        const target = jumpEventId;
        const currentRoom = room;
        const root = rootEventId;
        jumpedReply = null;
        if (!target || untrack(() => getThreadMessages(currentRoom, root).some((event) => event.getId() === target)))
            return;
        let current = true;
        const accept = (event: MatrixEvent | null) => {
            if (current && event?.getId() === target && !event.isRedacted() &&
                getEventThreadRootId(event) === root) jumpedReply = event;
        };
        const cached = findEventById(currentRoom, target);
        if (cached) accept(cached);
        else void fetchEventById(currentRoom.roomId, target).then(accept);
        return () => { current = false; };
    });

    // Re-read thread messages whenever tick changes`,
    "let jumpedReply = $state",
  ],
  [
    "        return getThreadMessages(room, rootEventId);",
    `        const replies = getThreadMessages(room, rootEventId);
        const target = jumpedReply;
        if (!target || target.isRedacted() || target.getId() !== jumpEventId ||
            replies.some((event) => event.getId() === target.getId())) return replies;
        return [...replies, target].sort((a, b) => a.getTs() - b.getTs());`,
    "const target = jumpedReply;",
  ],
  [
    "    function shouldShowHeader(events: MatrixEvent[], index: number): boolean {",
    `    let lastJumpedReply: string | undefined;
    $effect(() => {
        const target = jumpEventId;
        const container = scrollEl;
        if (!target || !container || lastJumpedReply === target ||
            !messages.some((event) => event.getId() === target)) return;
        void tick().then(() => {
            if (jumpEventId === target && scrollEl === container) {
                lastJumpedReply = target;
                jumpToReply(target);
            }
        });
    });

    function shouldShowHeader(events: MatrixEvent[], index: number): boolean {`,
    "const target = jumpEventId;",
  ],
];
