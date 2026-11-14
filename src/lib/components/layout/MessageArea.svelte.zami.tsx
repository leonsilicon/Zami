import { DomMount, Pulse, Spin, SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { sameObject, useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    createCoalescer,
    movesOthersReceipts,
    type ReceiptContent,
} from "@-/com.leonsilicon.zami.timeline";
import {
    memo,
    useCallback,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ComponentProps,
} from "react";
import {
    AccessibilityInfo,
    AppState,
    FlatList,
    Keyboard,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    type FlatListProps,
    type GestureResponderEvent,
    type LayoutChangeEvent,
    type ListRenderItemInfo,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    type ListViewToken,
} from "react-native";
import {
    GestureDetector,
    usePanGesture,
    type PanGestureConfig,
} from "react-native-gesture-handler";
import {
    KeyboardAvoidingView,
    useKeyboardState,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from "react-native-reanimated";
import { localeInfo, t } from "$lib/i18n";
import type { Room, MatrixEvent, TimelineWindow } from "matrix-js-sdk";
import type { CallSummary } from "$lib/utils/callSummary";
import { auth } from "$lib/stores/auth.svelte";
import MessageItem from "$lib/components/messages/MessageItem.svelte";
import MessageInput, {
    type MessageInputHandle,
    type TimelineScroller,
} from "$lib/components/messages/MessageInput.svelte";
import MemberList from "$lib/components/layout/MemberList.svelte";
import DebugPanel from "$lib/components/debug/DebugPanel.svelte";
import DebugEventItem from "$lib/components/debug/DebugEventItem.svelte";
import { settingsState } from "$lib/stores/settings.svelte";
import {
    getTimelineMessages,
    getLatestTimelineEvent,
    onTimelineEvent,
    onEventDecrypted,
    onDecryptedTimelineEvent,
    onLocalEchoUpdated,
    onSyncPrepared,
    isInitialSyncComplete,
    isInLiveTimeline,
    isSyncStale,
    waitForLiveEvent,
    onReactionEvent,
    onPollEvent,
    onEditEvent,
    onRedactionEvent,
    onTimelineReset,
    onRoomHealed,
    loadPreviousMessages,
    createContextWindow,
    getContextWindowEvents,
    paginateContextWindow,
    contextWindowCanPaginate,
    getRoomDisplayName,
    getRoomTopic,
    getRoomAvatar,
    sendReadReceipt,
    getTombstone,
    joinRoom,
    getRoom,
    isRoomCachedOnly,
    getReadUpToEventId,
    getOwnReadReceipt,
    getMarkedUnread,
    onMarkedUnreadChange,
    getReceiptsByDisplayedEvent,
    onReceiptEvent,
    getRoomCallMemberships,
    getRoomThreads,
    isVideoRoom,
    loadRoomMembersIfNeeded,
    getCallSummaries,
    getContextCallSummaries,
    getOwnUserId,
    decryptEventsForDisplay,
    isRenderableTimelineEvent,
    onCallEvent,
    shouldLoadMembersOnOpen,
    type ReadReceiptInfo,
} from "$lib/matrix/client";
import { isCallEventType } from "$lib/utils/callSummary";
import { logSync } from "$lib/matrix/syncLog";
import { setActiveRoom } from "$lib/stores/rooms.svelte";
import {
    getMessages,
    setMessages,
    appendMessage,
    canLoadMore,
    setCanLoadMore,
    bumpReactionTick,
    messagesState,
} from "$lib/stores/messages.svelte";
import { bumpUnreadTick, roomsState } from "$lib/stores/rooms.svelte";
import {
    interfaceState,
    openSidebar,
    closeSidebar,
    openModal,
    closeModal,
    showCallView,
    clearSelectedMessage,
    type SidebarId,
} from "$lib/stores/interface.svelte";
import { getLoudNotificationCount } from "$lib/stores/notifications.svelte";
import { ignoredUsersState } from "$lib/stores/ignoredUsers.svelte";
import { shouldHideMessage } from "$lib/utils/ignoredUsers";
import {
    isEditableContent,
    lastEditableOwnMessage,
} from "$lib/utils/editableMessage";
import { sedEditLastMessage } from "$lib/matrix/editMessage";
import PinnedMessagesPanel from "$lib/components/layout/PinnedMessagesPanel.svelte";
import NotificationsPanel from "$lib/components/layout/NotificationsPanel.svelte";
import ThreadPanel from "$lib/components/layout/ThreadPanel.svelte";
import MessageSearchPanel from "$lib/components/layout/MessageSearchPanel.svelte";
import ThreadsListPanel from "$lib/components/layout/ThreadsListPanel.svelte";
import RoomMediaPanel from "$lib/components/layout/RoomMediaPanel.svelte";
import { searchState } from "$lib/stores/search.svelte";
import UserProfileCard from "$lib/components/ui/UserProfileCard.svelte";
import {
    getPinnedEventIds,
    findEventById,
    isHighlightEvent,
    preloadRoomEmoji,
} from "$lib/matrix/client";
import {
    shouldShowHeader,
    dateSeparatorLabel,
    unreadDividerIndex,
    isNearBottom,
    timelineKey,
} from "$lib/utils/timelineDisplay";
import { shouldDismissSelectionOnScroll } from "$lib/utils/scrollDismiss";
import { daySeparator, messageTimestamp } from "$lib/utils/timeFormat";
import { canSendReceipt } from "$lib/utils/receiptGate";
import {
    historyEdge,
    hasRoomCreate,
    timelineReachesRoomCreate,
} from "$lib/utils/historyEdge";
import {
    BACKFILL_BUFFER_ROWS,
    INITIAL_VISIBLE_RATIO,
    nextBackfillLimit,
    updateVisibleRatio,
} from "$lib/utils/backfillSizing";
import { createBackfillGate } from "$lib/utils/backfillGate";
import { hostBridge } from "$lib/plugins/hostBridge";
import { pluginRegistry } from "$lib/stores/plugins.svelte";
import {
    pluginPanel,
    registeredPanelKey,
    openPluginPanel,
} from "$lib/plugins/pluginPanel.svelte";
import { pluginMount } from "$lib/plugins/pluginMount";
import { rollupRoomThreadUnread } from "$lib/utils/threadUnread";
import { isOffCanvasClosed } from "$lib/utils/drawerInert";
import { isPollStartEventType } from "$lib/utils/pollContent";
import { isFileOfferEventType } from "$lib/utils/fileTransfer";
import ActiveCallBanner from "$lib/components/layout/ActiveCallBanner.svelte";
import LiveLocationBanner from "$lib/components/layout/LiveLocationBanner.svelte";
import {
    Phone,
    Maximize2,
    Lock,
    Users,
    Hash,
    Image,
    MoreHorizontal,
    X,
} from "lucide-svelte";
import RoomHeaderOverflowMenu from "$lib/components/layout/RoomHeaderOverflowMenu.svelte";
import RoomTopicSheet from "$lib/components/layout/RoomTopicSheet.svelte";
import {
    pluginHeaderButtons,
    pluginHeaderMenuRows,
    type RoomHeaderMenuKey,
} from "$lib/utils/roomHeaderMenu";
import { isRoomEncrypted } from "$lib/matrix/crypto";
import { voiceCallState, joinCall } from "$lib/stores/voiceCall.svelte";
import {
    dedupeParticipants,
    callControlMode,
    isRecentlyLeftHere,
} from "$lib/utils/voiceCall";
import { scrollBehavior } from "$lib/utils/motionPreference";
import {
    ANNOUNCE_DEBOUNCE_MS,
    EMPTY_ANNOUNCER,
    drainAnnouncement,
    recordArrival,
    shouldAnnounceDecrypted,
} from "$lib/utils/liveAnnouncer";
import { SWIPE_ENGAGE_PX } from "$lib/utils/swipeGesture";

// Zami: the timeline is an inverted FlatList: its rows are the messages newest
// first, drawn bottom-up, so scroll offset 0 is the bottom of the room and
// older history loads past the top without moving what's on screen.
//
// - Upstream's row windowing (utils/timelineWindow: spacers, measured row
//   heights, pinned rows) is the FlatList's own: it mounts the rows within
//   `windowSize` screens of the view. Not ported: keeping a row that is being
//   typed in or playing media mounted when it scrolls further away than that.
// - `scrollTop`/`scrollHeight`/`clientHeight` come from the list's scroll,
//   layout and content-size events (see scrollGeometry), so upstream's checks
//   run on the same numbers. A row's element is its index: the list scrolls
//   to it (scrollRowIntoView), mounting it on the way.
// - The rows on screen come from `onViewableItemsChanged` (IntersectionObserver
//   and getBoundingClientRect reads upstream).
// - Native scroll anchoring, the bottom anchor row, the reading-position anchor
//   (MutationObserver/load) and the stick-to-bottom ResizeObserver are
//   `maintainVisibleContentPosition`: the list keeps the lowest row on screen
//   in place when rows are added below it or anything changes size, and
//   follows new messages while the reader is at the bottom.
// - Not ported: dropping files onto the room (drag and drop), the swipe on a
//   wide code block or table scrolling it rather than moving a drawer
//   (targetCanScrollHoriz reads the DOM target).

// Shared empty list for the avatars-off path — one allocation instead of a
// fresh [] per message. Taking this branch also means receiptTick is never
// read, so receipts stop invalidating the timeline entirely.
const NO_RECEIPTS: ReadReceiptInfo[] = [];

interface Props {
    room: Room;
    isMobile?: boolean;
    onMenuOpen?: () => void;
}

// Zami: Zam's inline `<svg fill="currentColor">` icons, drawn by SvgIcon.
const MENU_PATH = "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z";
const SEARCH_PATH =
    "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";
const THREADS_PATH =
    "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm2 5h12V7H6v2zm0 4h9v-2H6v2z";
const PIN_PATH = "M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z";
const BELL_PATH =
    "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z";
const BLOCKED_PATH =
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z";
const WARNING_PATH = "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z";
const CHEVRON_DOWN_PATH =
    "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z";
const INFO_PATH =
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z";
const CHECK_PATH = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";

// Zami: `isNearBottom`'s default slack, for the list's follow-the-bottom
// threshold.
const AT_BOTTOM_SLACK = 100;

// Gap left above the divider on open: some read history plus the bar.
const UNREAD_DIVIDER_TOP_GAP = 72;
const UNREAD_HOLD_MS = 1500;
// Zami: how long after the hold's first aim its landing spot is trusted.
const BOTTOM_CHECK_MS = 200;

/** Zami: upstream's `dividerIndex` over a given list and unread state. */
function dividerIndexOf(
    messages: MatrixEvent[],
    unreadDividerEventId: string | null,
    unreadReadTs: number | null,
    unreadFromFirst: boolean,
): number {
    if (!unreadDividerEventId) return -1;
    if (unreadFromFirst) {
        const i = messages.findIndex((e) => e.getId() === unreadDividerEventId);
        return i >= 0 ? i : unreadDividerIndex(messages, null, unreadReadTs);
    }
    return unreadDividerIndex(messages, unreadDividerEventId, unreadReadTs);
}
// Zami: how long a smooth scroll to a jumped-to message runs before the
// keep-it-in-view loop re-aims it (a re-aim cuts an animation short).
const SMOOTH_SCROLL_MS = 400;
// Zami: the rows on screen are any the view overlaps, as upstream counts them.
const VIEWABILITY = { itemVisiblePercentThreshold: 0 };
// Zami: the rows the list renders before its first layout, from the bottom.
const INITIAL_NUM_TO_RENDER = 15;
// Zami: read receipts are worked out for the rows from the bottom up to the
// screen's top row and this many more (the list mounts about five screens
// either side), at least RECEIPT_ROWS of them, and at most once per
// RECEIPT_COALESCE_MS for a burst of receipt events (B4).
const RECEIPT_ROWS = 60;
const RECEIPT_MARGIN_ROWS = 60;
const RECEIPT_COALESCE_MS = 250;
// Zami: rows this far beyond the screen decrypt ahead of the backlog (B2).
const DECRYPT_MARGIN_ROWS = 30;
// Zami: the far end of a pan's offset ranges, for "never".
const OFFSET_NEVER = 100_000;
// Zami: the drawers' `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`.
const DRAWER_TIMING = {
    duration: 300,
    easing: Easing.bezier(0.4, 0, 0.2, 1),
};

export default function MessageArea({
    room,
    isMobile = false,
    onMenuOpen,
}: Props) {
    // Zami: the rune reads the deriveds below use, first, as React computes in
    // order.
    const myUserId = useRune(() => auth.userId);
    const sidebar = useRune(() => interfaceState.sidebar);
    const modal = useRune(() => interfaceState.modal);
    const leftOpen = useRune(() => interfaceState.leftOpen);
    const lightboxOpen = useRune(() => interfaceState.lightboxOpen);
    const showReadReceiptAvatars = useRune(
        () => settingsState.showReadReceiptAvatars,
    );
    const showAllEvents = useRune(() => settingsState.showAllEvents);
    const ignoredUserIds = useRune(() => ignoredUsersState.userIds);
    const searchUnsupported = useRune(() => searchState.unsupported);
    const joinPendingRoomId = useRune(() => voiceCallState.joinPendingRoomId);
    const pluginTick = useRune(() => pluginRegistry.tick);
    const currentPluginPanel = useRune(() => pluginPanel.current);
    const pendingJump = useRune(() => roomsState.pendingJump);
    // Zami: whether rows offer swipe-to-reply (MessageItem's SwipePan), which
    // the member drawer's opening swipe yields to.
    const swipeOffered = useRune(
        () => (
            void pluginRegistry.tick,
            interfaceState.isTouchscreen &&
                pluginRegistry.swipeHandlers.length > 0
        ),
    );

    // Zami: the props and state as of the latest render, for the async code
    // and the SDK callbacks below, which upstream reads live.
    const roomRef = useRef(room);
    useLayoutEffect(() => {
        roomRef.current = room;
    });

    // A room that exists only in the saved room list: sync hasn't delivered it
    // yet (offline, or early in any boot), so its timeline is the cached tail
    // and there is nothing to send to yet. Re-checked as sync delivers rooms.
    const cachedOnly = useRune(() => {
        void auth.syncState;
        return isRoomCachedOnly(room.roomId);
    }, [room]);

    // Let the room's own content (timeline, avatars) claim connections first,
    // then warm its custom emoji in the background.
    const EMOJI_PRELOAD_DEFER_MS = 1200;

    // Zami: the list, for `scrollEl` (see the top of the file).
    const scrollEl = useRef<FlatList<MatrixEvent>>(null);
    const messageInputEl = useRef<MessageInputHandle>(null);
    // Measured composer height (padding included) so the floating "Jump to
    // present" / "Searching…" pills always clear the input, however tall it
    // grows with multi-line drafts, replies or the attachment drawer.
    const [composerHeight, setComposerHeight] = useState(0);
    // True while the composer is showing a mention/emoji/slash suggestion list.
    // The "jump to present" pill is hidden under it (Discord-style: the list
    // takes that space — you're not jumping back mid-mention).
    const [composerAutocompleteOpen, setComposerAutocompleteOpen] =
        useState(false);
    const [isAtBottom, setIsAtBottom, isAtBottomRef] = useLiveState(true);
    const [loadingOlder, setLoadingOlder, loadingOlderRef] =
        useLiveState(false);
    // Shared by backfillFromTop and recoverScrollback. Not a plain boolean: a
    // request that arrives while it's held must be remembered and re-run, or a
    // room opened during another room's pagination renders empty forever (the
    // sentinel observer won't re-fire without an intersection transition).
    const [backfillGate] = useState(createBackfillGate);
    const [replyToEvent, setReplyToEvent] = useState<MatrixEvent | null>(null);
    // Plugin composer.startReply → set this room's reply target. Single slot;
    // the mounted room area owns it, resolving the event id in its own room
    // only. Cleanup nulls the slot only if it is still ours, so a room switch
    // that re-registers is not clobbered by the previous instance's teardown.
    useEffect(() => {
        const activeRoom = room;
        const handler = (ctx: { roomId: string; eventId: string }) => {
            if (ctx.roomId !== activeRoom.roomId) return;
            const ev = findEventById(activeRoom, ctx.eventId);
            if (ev) setReplyToEvent(ev);
        };
        hostBridge.startReply = handler;
        return () => {
            if (hostBridge.startReply === handler) hostBridge.startReply = null;
        };
    }, [room]);
    const [editRequestedEventId, setEditRequestedEventId] = useState<
        string | null
    >(null);

    // Zami: `await tick()`: resolves once React has committed what was set
    // before it.
    const tick = useTick();
    // Zami: a commit, then two frames, for the list's native layout and its
    // scroll, layout and content-size events to arrive.
    const layoutSettled = useCallback(async () => {
        await tick();
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
    }, [tick]);

    // Plugin composer.startEdit → start inline edit of your own text message.
    // Single slot; the mounted room area owns it and only acts on its own room.
    // Guards own + editable text (parity with requestEditLastMessage). The
    // transient editRequestedEventId pulse is how the matching MessageItem
    // enters edit mode (its editRequested prop → $effect → startEdit()).
    useEffect(() => {
        const activeRoom = room;
        const handler = async (ctx: { roomId: string; eventId: string }) => {
            if (ctx.roomId !== activeRoom.roomId) return;
            const ev = findEventById(activeRoom, ctx.eventId);
            if (
                !ev ||
                ev.getSender() !== auth.userId ||
                ev.getType() !== "m.room.message" ||
                !isEditableContent(ev.getContent())
            )
                return;
            await revealForEdit(ctx.eventId);
            setEditRequestedEventId(ctx.eventId);
            await tick();
            setEditRequestedEventId(null);
        };
        hostBridge.startEdit = handler;
        return () => {
            if (hostBridge.startEdit === handler) hostBridge.startEdit = null;
        };
    }, [room, tick]);
    const [threadRootId, setThreadRootId] = useState<string | null>(null);
    // Desktop: thread replaces the timeline instead of docking as a side
    // panel. Sticky for the session so an expanded reader stays expanded
    // across threads; reset on room switch. Mobile always renders fullscreen.
    const [threadFullscreen, setThreadFullscreen] = useState(false);

    function openThread(rootEventId: string) {
        setThreadRootId(rootEventId);
        closeSidebar();
    }
    function closeThread() {
        setThreadRootId(null);
    }
    // Blocked-message placeholders the user chose to reveal, by event id.
    const [revealedBlockedIds, setRevealedBlockedIds] = useState<
        Record<string, boolean>
    >({});

    // Close any open thread and re-collapse blocked messages when switching rooms.
    useEffect(() => {
        void room.roomId;
        setThreadRootId(null);
        setThreadFullscreen(false);
        setRevealedBlockedIds({});
    }, [room]);

    // Bridged/quiet senders whose m.room.member event wasn't lazy-loaded render
    // as their raw MXID (no display name, no avatar) until the member arrives.
    // Fetch the full roster on room open so every sender resolves, then bump
    // roomsTick so already-rendered rows re-derive their name/avatar — the
    // getMember reads don't re-run on their own when the member mutates in
    // place. Idempotent (loadMembersIfNeeded caches); the bump is untracked so
    // it can't re-enter this effect.
    // Zami: not for a room of hundreds of members or more, whose list loads
    // when the member list or a mention search needs it (C7): fetching and
    // applying thousands of members on every first open froze the switch.
    useEffect(() => {
        const r = room;
        void r.roomId;
        if (!shouldLoadMembersOnOpen(r)) return;
        loadRoomMembersIfNeeded(r)
            .then(() => void roomsState.roomsTick++)
            .catch(() => {});
    }, [room]);

    // Warm this room's custom emoji in the background on open so the picker and
    // inline :shortcode: images render instantly instead of trickling in over
    // uncached (and, for remote packs, federated ~1s-each) media fetches.
    // Deferred so the room's own content loads first; fire-and-forget and
    // session-deduped inside preloadRoomEmoji. Space id/list read untracked so
    // only a room change re-arms it.
    useEffect(() => {
        const r = room;
        void r.roomId;
        const spaceId = roomsState.activeSpaceId;
        const spaces = roomsState.spaces;
        const timer = setTimeout(
            () => preloadRoomEmoji(r, spaceId, spaces),
            EMOJI_PRELOAD_DEFER_MS,
        );
        return () => clearTimeout(timer);
    }, [room]);
    // Zami: not ported: the drop overlay and its drag handlers (dragging files
    // onto the room). The composer's own attach button adds files.
    const intervalId = useRef<ReturnType<typeof setInterval> | undefined>(
        undefined,
    );
    const scrollStopTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );

    // Stop any in-flight "keep scrolling into view" loop (started by
    // scrollToMessage). Safe to call repeatedly.
    function stopScrollIntoView() {
        if (intervalId.current !== undefined) {
            clearInterval(intervalId.current);
            intervalId.current = undefined;
        }
        if (scrollStopTimeout.current !== undefined) {
            clearTimeout(scrollStopTimeout.current);
            scrollStopTimeout.current = undefined;
        }
        // Zami: no window to re-fit: the list windows itself.
    }

    async function requestEditLastMessage() {
        const last = lastEditableOwnMessage(currentMessages(), auth.userId);
        if (!last) return;
        await revealForEdit(last.getId()!);
        setEditRequestedEventId(last.getId()!);
        await tick();
        setEditRequestedEventId(null);
    }
    // Zami: upstream's window mounts the row an edit is asked of; the list
    // only mounts rows near the screen, so bring it on screen first (as
    // focusing its edit box would).
    async function revealForEdit(eventId: string) {
        if (viewableKeys.current.length === 0) return;
        const index = await revealRow(eventId);
        if (index === null) return;
        const event = rows.current[index];
        if (event && viewableKeys.current.includes(rowKey(event))) return;
        scrollRowIntoView(index, 0.5, false);
        await layoutSettled();
    }
    // Right-side panels live in the shared interfaceState.sidebar slot, so only
    // one is ever open and the central Escape/back handler can dismiss them.
    const showMemberList = sidebar === "members";
    const showPinnedPanel = sidebar === "pinned";
    const showNotificationsPanel = sidebar === "notifications";
    const showSearchPanel = sidebar === "search";
    const showThreadsPanel = sidebar === "threads";
    const showMediaPanel = sidebar === "media";
    const showRightPanel =
        showPinnedPanel ||
        showNotificationsPanel ||
        showSearchPanel ||
        showThreadsPanel ||
        showMediaPanel;

    // Room-level thread unread rollup for the threads-toggle badge. Keyed off
    // unreadTick so it refreshes on sync/receipts (live Room mutates in place).
    // Zami: read as its two values, so a tick that leaves them unchanged
    // doesn't re-render the room.
    const threadRollupOf = (r: Room) => {
        void roomsState.unreadTick;
        return rollupRoomThreadUnread(
            getRoomThreads(r).map((t) => ({
                total: t.unreadTotal,
                highlight: t.unreadHighlight,
            })),
        );
    };
    const threadMentions = useRune(() => threadRollupOf(room).mentions, [room]);
    const threadAnyUnread = useRune(
        () => threadRollupOf(room).anyUnread,
        [room],
    );
    const threadRollup = {
        mentions: threadMentions,
        anyUnread: threadAnyUnread,
    };

    function toggleSidebar(id: SidebarId) {
        if (interfaceState.sidebar === id) closeSidebar();
        else openSidebar(id, () => {});
    }
    const pinnedCount = useRune(() => {
        void roomsState.roomsTick;
        return getPinnedEventIds(room).length;
    }, [room]);

    // Plugin room-header buttons (zam.room.addHeaderButton). tick-gated so a
    // mid-session enable/disable re-derives.
    const pluginHeaderBtns = useMemo(() => {
        void pluginTick;
        return pluginHeaderButtons(pluginRegistry.headerButtons);
    }, [pluginTick]);
    // Which plugin panel (if any) is open, for the active accent.
    const activePluginPanelKey =
        sidebar === "plugin" ? (currentPluginPanel?.key ?? null) : null;
    const pluginOverflowRows = pluginHeaderMenuRows(
        pluginHeaderBtns.map((b) => ({ key: b.key, label: b.label })),
        activePluginPanelKey,
    );

    /** Open (or toggle off) a plugin's header panel in the single sidebar slot,
     *  binding the plugin's render to the current room. */
    function openPluginHeaderPanel(btn: {
        key: string;
        label: string;
        render(el: HTMLElement, ctx: { roomId: string }): void | (() => void);
    }) {
        if (
            interfaceState.sidebar === "plugin" &&
            pluginPanel.current?.key === btn.key
        ) {
            closeSidebar();
            return;
        }
        const roomId = room.roomId;
        openPluginPanel({
            key: btn.key,
            title: btn.label,
            roomId,
            render: (el) => btn.render(el, { roomId }),
        });
    }

    /** Mobile overflow → open a plugin panel by key. */
    function choosePluginOverflow(key: string) {
        const btn = pluginHeaderBtns.find((b) => b.key === key);
        if (btn) openPluginHeaderPanel(btn);
    }

    /** Id-guarded release of a stranded plugin-panel slot (mirrors
     *  releaseOverflowSlot). */
    function releasePluginPanelSlot() {
        if (interfaceState.sidebar === "plugin") closeSidebar();
    }

    // Mobile only: threads / pinned / notifications / members move off the
    // header into a "⋯" sheet so the room name and topic get width at 412px.
    // It uses the shared modal slot, so Escape and Android's back button
    // dismiss it through AppShell.dismissTopmost like every other popup.
    const overflowOpen = modal === "room-header-overflow";

    // On desktop each of the four buttons colours itself accent while its own
    // panel is open. The "⋯" trigger stands in for all four, so it has to carry
    // that signal too — otherwise opening the member list on mobile leaves the
    // header with no indication that any panel is open.
    const overflowActive =
        overflowOpen ||
        showThreadsPanel ||
        showPinnedPanel ||
        showNotificationsPanel ||
        showMemberList ||
        sidebar === "plugin";

    function toggleOverflowMenu() {
        if (interfaceState.modal === "room-header-overflow") closeModal();
        else openModal("room-header-overflow", () => {});
    }

    function chooseOverflowItem(key: RoomHeaderMenuKey) {
        toggleSidebar(key);
    }

    // The sheet only renders while `isMobile && overflowOpen`, but the slot it
    // registers in is global. Widening past the 767px breakpoint (devtools,
    // an Electron window, a tablet rotating) or unmounting this component
    // (call view, inbox, no active room) makes the sheet disappear WITHOUT
    // touching interfaceState.modal, stranding the slot on an invisible modal:
    // AppShell.dismissTopmost() then swallows the next Escape/back that should
    // have closed a sidebar, type-to-focus stays disabled, and mobile keeps a
    // matrixBackGuard history entry pushed. Release it on both paths.
    //
    // Id-guarded rather than an unconditional closeModal() so it is idempotent
    // and can never dismiss a modal some other component now owns.
    function releaseOverflowSlot() {
        if (interfaceState.modal === "room-header-overflow") closeModal();
        if (interfaceState.modal === "room-topic") closeModal();
    }

    // Mobile only: the header truncates the topic, so tapping it opens the
    // full text in a sheet. Same shared modal slot (and same stranding
    // guard, via releaseOverflowSlot) as the overflow menu.
    const topicOpen = modal === "room-topic";
    function openTopicSheet() {
        openModal("room-topic", () => {});
    }

    // Tracks `isMobile` and nothing else — the interfaceState read AND write
    // both live inside untrack(), so this effect can never take its own store
    // write as a dependency and re-trigger itself (effect_update_depth_exceeded).
    useEffect(() => {
        if (isMobile) return;
        releaseOverflowSlot();
    }, [isMobile]);

    // Unmount half, mirroring Lightbox's teardown.
    useEffect(() => releaseOverflowSlot, []);

    // Close a plugin panel when the room changes (MessageArea is one persistent
    // instance — the panel was imperatively bound to the old roomId). Tracked
    // dep = room.roomId; store read+write in untrack (no self-retrigger).
    useEffect(() => {
        const rid = room.roomId;
        if (
            interfaceState.sidebar === "plugin" &&
            pluginPanel.current &&
            pluginPanel.current.roomId !== rid
        ) {
            closeSidebar();
        }
    }, [room.roomId]);

    // Close a plugin panel when its owning header button disappears (plugin
    // disabled/disposed → registry entry removed). Tracked dep =
    // pluginRegistry.tick.
    const closeOrphanedPluginPanel = useEffectEvent(() => {
        const cur = pluginPanel.current;
        if (
            interfaceState.sidebar === "plugin" &&
            cur &&
            !pluginHeaderBtns.some((b) => b.key === cur.key) &&
            !pluginRegistry.panels.some(
                (e) => registeredPanelKey(e.pluginId, e.value.id) === cur.key,
            )
        ) {
            closeSidebar();
        }
    });
    useEffect(() => {
        void pluginTick;
        closeOrphanedPluginPanel();
    }, [pluginTick]);

    useEffect(() => releasePluginPanelSlot, []);

    // Any loud (red) notification anywhere → badge the mobile hamburger.
    const hasAnyLoud = useRune(() => getLoudNotificationCount() > 0);

    const [jumpingToEventId, setJumpingToEventId] = useState<string | null>(
        null,
    );

    // A notification tap on a cold start / PWA resume can land here before the
    // first sync has delivered the notified event. Wait (bounded) for it rather
    // than falling straight into a detached context view: that view ignores
    // live events, so the room looked frozen with none of the newer messages.
    function waitForInitialSync(timeoutMs: number): Promise<void> {
        if (isInitialSyncComplete()) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                unsub();
                resolve();
            };
            const timer = setTimeout(done, timeoutMs);
            const unsub = onSyncPrepared(done);
        });
    }

    // Zami: `message-highlight` on a row, as the row's id and a count that
    // restarts its flash.
    const [highlight, setHighlight] = useState<{
        eventId: string;
        n: number;
    } | null>(null);
    const highlightCount = useRef(0);

    async function scrollToMessage(eventId: string) {
        const query = () => revealRow(eventId);
        let el: number | null = await query();
        if (el === null) {
            const rid = roomRef.current.roomId;
            await waitForInitialSync(10_000);
            if (roomRef.current.roomId !== rid) return;
            // Woken from the background (a notification tap on Android), the
            // live timeline is behind and the message is usually still on its
            // way. Let sync deliver it so the jump lands in the live view
            // instead of a detached context window.
            if (!isInLiveTimeline(roomRef.current, eventId) && isSyncStale()) {
                const result = await waitForLiveEvent(
                    roomRef.current,
                    eventId,
                    45_000,
                );
                logSync(`jump waited for sync: ${result}`);
                if (roomRef.current.roomId !== rid) return;
                // Sync never caught up: stay on the live view, which fills in
                // as soon as it does.
                if (result === "timeout") return;
            }
            // In the live timeline but not rendered yet: this effect runs in
            // the same flush as the room-open effect that re-reads the list,
            // so wait for that render instead of building a context window.
            if (isInLiveTimeline(roomRef.current, eventId)) {
                await tick();
                if (roomRef.current.roomId !== rid) return;
                el = await query();
            }
        }
        if (el === null) {
            setJumpingToEventId(eventId);
            // MessageArea is one persistent instance (not keyed by room), so
            // `room` can change during this await. Capture the room we started
            // in and drop the fetched window if we've since switched — otherwise
            // room A's context window is written into room B, which renders A's
            // messages under B's header and freezes B's live updates until
            // "Return to live" (F1). Mirrors recoverScrollback's rid capture.
            const rid = roomRef.current.roomId;
            try {
                const win = await createContextWindow(roomRef.current, eventId);
                if (win && roomRef.current.roomId === rid) {
                    setContextWindow(win);
                    setContextMessages(getContextWindowEvents(win));
                    setContextAtReadPosition(false);
                    await tick();
                }
            } finally {
                setJumpingToEventId(null);
            }
            el = await revealRow(eventId);
            if (el === null) return;
        }
        // Cancel any previous scroll loop so we never leak an interval that
        // would keep yanking the scroll position and block the user.
        stopScrollIntoView();
        // Smooth-scroll only to a message that is nearly on screen. Further
        // away, the animation ran through spacer where no rows are mounted
        // (window updates wait for the jump), so it showed blank space for
        // most of the way. Land there at once with its neighbours mounted.
        // Zami: the list mounts the row and its neighbours as it scrolls to
        // it (scrollRowIntoView), so no window to move first.
        const far = isFarFromView(el);
        // Zami: the loop re-aims at the row by id (new messages shift its
        // index), and only once a smooth scroll has had time to land. A
        // non-animated re-aim at a row already in place doesn't move the
        // list, so it needs no check that the row moved (upstream's listTop).
        const smooth = !far && scrollBehavior() === "smooth";
        const started = Date.now();
        const aim = (animated: boolean) => {
            const index = indexOfEvent(eventId);
            if (index !== null) scrollRowIntoView(index, 0.5, animated);
        };
        aim(smooth);
        intervalId.current = setInterval(() => {
            if (smooth && Date.now() - started < SMOOTH_SCROLL_MS) return;
            aim(false);
        }, 50);
        const n = ++highlightCount.current;
        setHighlight({ eventId, n });
        // Zami: the class's removal, which a touch stopping the loop early
        // doesn't skip (a row scrolled back into view would flash again).
        setTimeout(() => setHighlight((h) => (h?.n === n ? null : h)), 2000);
        scrollStopTimeout.current = setTimeout(() => {
            stopScrollIntoView();
            // A short context window can sit at the bottom without ever
            // scrolling, so onScroll would never page it forward.
            catchUpContextView();
        }, 2000);
    }

    /** More than a screen and a half between `el` and the viewport centre. */
    // Zami: counted in rows, from the rows on screen (viewableKeys); `index`
    // is the row's index in the list.
    function isFarFromView(index: number): boolean {
        const list = rows.current;
        const on: number[] = [];
        for (const key of viewableKeys.current) {
            const i = list.findIndex((e) => rowKey(e) === key);
            if (i >= 0) on.push(i);
        }
        if (on.length === 0) return false;
        const lo = Math.min(...on);
        const hi = Math.max(...on);
        return Math.abs(index - (lo + hi) / 2) > (hi - lo + 1) * 1.5;
    }

    // Ensure the scroll loop never outlives the component (e.g. room switch).
    useEffect(() => stopScrollIntoView, []);

    // Consume a queued "jump to this message" request (a notification tap or a
    // cross-room permalink — see navigateToRoom). It fires once pendingJump names
    // THIS room, whether we just switched into it (the room prop catches up and
    // re-runs this) or the request arrived while we were already here. The
    // roomId guard is what keeps a jump meant for another room from firing in
    // this one: a mismatch just waits, it does not consume. Clear the request
    // before scrolling — inside untrack, so neither the read nor scrollToMessage's
    // own state writes re-trigger this effect (the effect_update_depth landmine).
    // scrollToMessage fetches a context window when the event isn't in the loaded
    // timeline, so an older message still lands, and its interval-based scroll
    // wins over the room-open scroll-to-bottom above.
    const consumeJump = useEffectEvent((eventId: string) => {
        roomsState.pendingJump = null;
        void scrollToMessage(eventId);
    });
    useEffect(() => {
        const jump = pendingJump;
        if (!jump || jump.roomId !== room.roomId) return;
        consumeJump(jump.eventId);
    }, [pendingJump, room]);

    const [joiningUpgrade, setJoiningUpgrade] = useState(false);

    const tombstone = useMemo(() => getTombstone(room), [room]);
    const replacementAlreadyJoined = useMemo(
        () =>
            tombstone
                ? getRoom(tombstone.replacementRoomId)?.getMyMembership() ===
                  "join"
                : false,
        [tombstone],
    );

    async function joinUpgrade() {
        if (!tombstone) return;
        if (replacementAlreadyJoined) {
            setActiveRoom(tombstone.replacementRoomId);
            return;
        }
        setJoiningUpgrade(true);
        try {
            await joinRoom(
                tombstone.replacementRoomId,
                tombstone.senderServer ? [tombstone.senderServer] : undefined,
            );
            setActiveRoom(tombstone.replacementRoomId);
        } catch (e) {
            console.error("Failed to join replacement room", e);
        } finally {
            setJoiningUpgrade(false);
        }
    }

    // Animated right drawer (mobile member list)
    const MEMBER_WIDTH = 280;
    // The side drawers always slide in from the right: the panel arrangement
    // is pinned left-to-right in every language (see the root below).
    const DIR = 1;
    const uiDir = localeInfo().dir;
    // Zami: the drawer's offset is a shared value, so a drag moves only the
    // drawer and its backdrop, on the UI thread.
    const memberTranslate = useSharedValue(MEMBER_WIDTH);
    const [isMemberDragging, setIsMemberDragging] = useState(false);
    const memberDragBase = useRef(0);

    useEffect(() => {
        if (!isMemberDragging) {
            memberTranslate.value = withTiming(
                showMemberList ? 0 : MEMBER_WIDTH,
                DRAWER_TIMING,
            );
        }
    }, [isMemberDragging, showMemberList, memberTranslate]);

    // Zami: the backdrop's `rgba(0,0,0,opacity)`, as its opacity over black.
    const memberBackdropStyle = useAnimatedStyle(() => ({
        opacity: isMobile
            ? ((MEMBER_WIDTH - memberTranslate.value) / MEMBER_WIDTH) * 0.5
            : 0,
    }));
    const memberDrawerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: memberTranslate.value * DIR }],
    }));

    // Right-hand drawer: it parks at +MEMBER_WIDTH when closed and opens at 0.
    // It stays mounted while closed, so without this a hardware keyboard tabs
    // into invisible controls (audit A11Y-02). Same notion as the box-shadow
    // gate in the markup (`memberTranslate >= MEMBER_WIDTH`).
    // Zami: from where the drawer rests (or is being dragged from), as its
    // live offset is the shared value's.
    const memberDrawerClosed = isOffCanvasClosed(
        showMemberList || isMemberDragging ? 0 : MEMBER_WIDTH,
        MEMBER_WIDTH,
    );

    function memberDragStartAllowed(): boolean {
        return !(
            !isMobile ||
            interfaceState.leftOpen ||
            interfaceState.lightboxOpen ||
            interfaceState.modal !== null ||
            showRightPanel
        );
    }

    function memberDragMove(dx: number) {
        memberTranslate.value = Math.max(
            0,
            Math.min(MEMBER_WIDTH, memberDragBase.current + dx * DIR),
        );
    }

    function memberDragEnd() {
        setIsMemberDragging(false);
        const progress = (MEMBER_WIDTH - memberTranslate.value) / MEMBER_WIDTH;
        const startedOpen = memberDragBase.current === 0;
        const open = startedOpen ? progress >= 0.75 : progress > 0.25;
        if (open) openSidebar("members", () => {});
        else if (interfaceState.sidebar === "members") closeSidebar();
        memberTranslate.value = withTiming(
            open ? 0 : MEMBER_WIDTH,
            DRAWER_TIMING,
        );
    }

    // Animated right drawer (mobile pinned panel)
    const PINNED_WIDTH = 280;
    const pinnedTranslate = useSharedValue(PINNED_WIDTH);
    const [isPinnedDragging, setIsPinnedDragging] = useState(false);

    useEffect(() => {
        if (!isPinnedDragging) {
            pinnedTranslate.value = withTiming(
                showRightPanel ? 0 : PINNED_WIDTH,
                DRAWER_TIMING,
            );
        }
    }, [isPinnedDragging, showRightPanel, pinnedTranslate]);

    const pinnedBackdropStyle = useAnimatedStyle(() => ({
        opacity: isMobile
            ? ((PINNED_WIDTH - pinnedTranslate.value) / PINNED_WIDTH) * 0.5
            : 0,
    }));
    const pinnedDrawerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: pinnedTranslate.value * DIR }],
    }));

    // Right-hand drawer: parks at +PINNED_WIDTH when closed, opens at 0. Same
    // notion as the box-shadow gate in the markup
    // (`pinnedTranslate >= PINNED_WIDTH`).
    const rightPanelClosed = isOffCanvasClosed(
        showRightPanel || isPinnedDragging ? 0 : PINNED_WIDTH,
        PINNED_WIDTH,
    );

    function pinnedDragStartAllowed(): boolean {
        return !(
            !isMobile ||
            !showRightPanel ||
            interfaceState.leftOpen ||
            interfaceState.lightboxOpen ||
            showMemberList
        );
    }

    function pinnedDragMove(dx: number) {
        pinnedTranslate.value = Math.max(0, Math.min(PINNED_WIDTH, dx * DIR));
    }

    function pinnedDragEnd() {
        setIsPinnedDragging(false);
        const progress = (PINNED_WIDTH - pinnedTranslate.value) / PINNED_WIDTH;
        const stayOpen = progress > 0.75; // close if dragged more than 25% away
        if (!stayOpen) closeSidebar();
        pinnedTranslate.value = withTiming(
            stayOpen ? 0 : PINNED_WIDTH,
            DRAWER_TIMING,
        );
    }

    // Zami: the root's touchstart/touchmove/touchend listeners, as one pan.
    // Which drawer a drag moves, and so the one horizontal direction it may
    // start in, is decided up front from memberDragStart's and
    // pinnedDragStart's conditions; the pan activates past the same 6px
    // deadzone, and a vertical move first fails it so the timeline scrolls.
    // A rightward drag that no drawer here takes is left to the room list's.
    const dragMode: "member-open" | "member-close" | "pinned" | null =
        !isMobile || leftOpen || lightboxOpen
            ? null
            : showMemberList
              ? modal === null && !showRightPanel
                  ? "member-close"
                  : null
              : showRightPanel
                ? "pinned"
                : modal === null
                  ? "member-open"
                  : null;
    // Zami: the drawer the drag under way moves, once its start was allowed.
    const activeDrag = useRef<"member" | "pinned" | null>(null);
    const dragHandlers = useRef({
        start: () => {},
        move: (_dx: number) => {},
        end: () => {},
    });
    useLayoutEffect(() => {
        dragHandlers.current = {
            start: () => {
                activeDrag.current = null;
                if (dragMode === "pinned") {
                    if (!pinnedDragStartAllowed()) return;
                    activeDrag.current = "pinned";
                    setIsPinnedDragging(true);
                } else if (dragMode !== null) {
                    if (!memberDragStartAllowed()) return;
                    activeDrag.current = "member";
                    memberDragBase.current = showMemberList ? 0 : MEMBER_WIDTH;
                    setIsMemberDragging(true);
                }
                Keyboard.dismiss();
            },
            move: (dx) => {
                if (activeDrag.current === "pinned") pinnedDragMove(dx);
                else if (activeDrag.current === "member") memberDragMove(dx);
            },
            end: () => {
                const drag = activeDrag.current;
                activeDrag.current = null;
                if (drag === "pinned") pinnedDragEnd();
                else if (drag === "member") memberDragEnd();
            },
        };
    });
    // Leftward opens the member list; rightward closes either drawer. With
    // swipe-to-reply on the rows, their 12px leftward swipe wins over the
    // member drawer's (as swipePan claims it upstream).
    const openThreshold = swipeOffered ? SWIPE_ENGAGE_PX + 1 : 6;
    const drawerPan = usePanGesture(
        useMemo(
            (): PanGestureConfig => ({
                runOnJS: true,
                enabled: dragMode !== null,
                activeOffsetX:
                    dragMode === "member-open"
                        ? [-openThreshold, OFFSET_NEVER]
                        : [-OFFSET_NEVER, 6],
                failOffsetX:
                    dragMode === "member-open"
                        ? [-OFFSET_NEVER, 6]
                        : [-6, OFFSET_NEVER],
                failOffsetY: [-6, 6],
                onActivate: (e) => {
                    dragHandlers.current.start();
                    dragHandlers.current.move(e.translationX);
                },
                onUpdate: (e) => dragHandlers.current.move(e.translationX),
                onDeactivate: () => dragHandlers.current.end(),
            }),
            [dragMode, openThreshold],
        ),
    );

    const roomId = room.roomId;
    // Tick dependency: the Room mutates in place when state arrives late
    // (late-seeded federated joins, renames) — same reference, new name.
    const roomName = useRune(
        () => (void roomsState.roomsTick, getRoomDisplayName(room)),
        [room],
    );
    // Re-reads the live Room's state; depends on roomsTick to refresh when the
    // m.room.encryption state event lands (the Room mutates in place).
    const roomEncrypted = useRune(
        () => (void roomsState.roomsTick, isRoomEncrypted(room)),
        [room],
    );
    const topic = useRune(
        () => (void roomsState.roomsTick, getRoomTopic(room)),
        [room],
    );
    // Header "show call" button gate. Computed here rather than as an {@const}
    // in the markup: the header is a plain <div>, and {@const} may only be an
    // immediate child of a block.
    const callCount = useRune(
        () => (
            void voiceCallState.voiceTick,
            dedupeParticipants(getRoomCallMemberships(room)).length
        ),
        [room],
    );
    const startCallMode = useRune(
        () => (
            void voiceCallState.voiceTick,
            callControlMode({
                inThisCall: voiceCallState.roomId === room.roomId,
                participantUserIds: dedupeParticipants(
                    getRoomCallMemberships(room),
                ).map((p) => p.userId),
                selfUserId: auth.userId,
                recentlyLeftHere: isRecentlyLeftHere(
                    voiceCallState.lastLeftCall,
                    room.roomId,
                    Date.now(),
                ),
            })
        ),
        [room],
    );
    // Tick dependency: a Room mutates in place, so a plain $derived over it
    // would not re-run once the create event is seeded late.
    const isVideoRoomView = useRune(
        () => (void roomsState.roomsTick, isVideoRoom(room)),
        [room],
    );
    // Jump-to-message ("context") view. Jumping to a far-back message loads a
    // paginating TimelineWindow around it instead of the live timeline, so the
    // user can scroll freely both ways from that point (unlike the old static
    // 50-event snapshot). `contextMessages` is the rendered snapshot, refreshed
    // from the window after each pagination; scrolling to the live edge hands
    // back to the live timeline (see rejoinLive / maybeLoadNewer).
    const [contextWindow, setContextWindow, contextWindowRef] =
        useLiveState<TimelineWindow | null>(null);
    const [contextMessages, setContextMessages, contextMessagesRef] =
        useLiveState<MatrixEvent[] | null>(null);
    // The window was opened at the read position by entering the room, not
    // by jumping to a message. It's an ordinary visit: "Jump to present"
    // stays and the "Viewing message context" banner never shows, even once
    // the room is read and the unread bar goes away.
    const [contextAtReadPosition, setContextAtReadPosition] = useState(false);
    const loadingNewer = useRef(false);
    // Zami: the store replaces a room's list whole, never changes it in place.
    const liveMessages = useRune(() => getMessages(roomId), [roomId], {
        isEqual: sameObject,
    });
    const messages = contextMessages ?? liveMessages;
    // Zami: the list as it stands now (the store is written synchronously),
    // for the async code below.
    function currentMessages(): MatrixEvent[] {
        return (
            contextMessagesRef.current ?? getMessages(roomRef.current.roomId)
        );
    }
    // Zami: the list's rows, newest first, and the latest render's, which
    // the list's own scrollToIndex indexes into.
    const listRows = useMemo(() => [...messages].reverse(), [messages]);
    const rows = useRef(listRows);
    useLayoutEffect(() => {
        rows.current = listRows;
    });
    // Zami: what the rows read (see rowsContext below).
    const [rowsStore] = useState(createRowsStore);
    const [receiptTick, setReceiptTick] = useState(0);
    // Zami: the rows read receipts are worked out for: from the newest up to
    // this many rows from the bottom, the screen's top row plus a margin
    // (onViewableItemsChanged moves it), not the whole timeline (B4).
    const [receiptRows, setReceiptRows, receiptRowsRef] =
        useLiveState(RECEIPT_ROWS);
    useLayoutEffect(() => {
        void roomId;
        setReceiptRows(RECEIPT_ROWS);
    }, [roomId, setReceiptRows]);
    // Zami: each row keeps its previous receipts array while its readers are
    // the same, so a receipt elsewhere doesn't re-render it (MessageItem is
    // memo'd on it).
    const [receiptCache] = useState(() => ({
        map: null as Map<string, ReadReceiptInfo[]> | null,
    }));
    const receiptsByEvent = useMemo(() => {
        void receiptTick;
        const next = showReadReceiptAvatars
            ? getReceiptsByDisplayedEvent(
                  room,
                  messages.slice(Math.max(0, messages.length - receiptRows)),
              )
            : null;
        receiptCache.map = keepEqualValues(
            receiptCache.map,
            next,
            sameReceipts,
        );
        return receiptCache.map;
    }, [
        receiptTick,
        showReadReceiptAvatars,
        room,
        messages,
        receiptRows,
        receiptCache,
    ]);
    const isContextView = contextMessages !== null;
    // Top of the timeline (issue #49): the start banner only once the room's
    // m.room.create is really loaded; a loading line while older history may
    // still come. Re-derived on every timeline write and every page end, since
    // a page of hidden events skips setMessages.
    // Zami: on this room's timeline writes (`messages`), not every room's
    // (timelineTick, which every decryption anywhere bumps): each walked the
    // whole timeline for the room's m.room.create.
    const historyEdgeState = useRune(() => {
        void messages;
        void loadingOlder;
        void contextMessages;
        return historyEdge({
            reachedStart: isContextView
                ? !!contextWindow && hasRoomCreate(contextWindow.getEvents())
                : timelineReachesRoomCreate(room.getLiveTimeline()),
            hasOlder: hasOlderToLoad(),
            loadingOlder,
        });
    }, [room, loadingOlder, contextMessages, contextWindow, messages]);
    // Native anchoring pins the view to the bottom anchor row only on the live
    // timeline. A context view's bottom is history: pinned there, each page
    // maybeLoadNewer added below kept the user at the bottom, so the next page
    // loaded too, and one new message dragged them all the way back to live.
    const stickToBottom = isAtBottom && !isContextView;

    // ── Row windowing (utils/timelineWindow) ──
    // Zami: the FlatList's (see the top of the file), and with it the top
    // spacer's slack (topSlack, cancelShift, settleTopSlack) and the native
    // anchor row (setNativeAnchorRow): maintainVisibleContentPosition holds
    // the reader's row without writing the scroll offset mid-fling.

    // timelineKey is only undefined for an event with neither id, which the
    // list never holds; "" keeps the types honest.
    // Zami: rowKey is at the bottom of the file, so the list's keyExtractor
    // keeps its identity.

    // Zami: the list's index of `eventId`'s row, or null when it doesn't hold
    // it.
    function indexOfEvent(eventId: string): number | null {
        const list = rows.current;
        const i = list.findIndex((e) => e.getId() === eventId);
        return i < 0 ? null : i;
    }

    /** The row element for `eventId`, mounting it first if it is loaded but
     *  outside the window. Null when the list doesn't hold it. */
    // Zami: the row's index in the list (see scrollRowIntoView), once a
    // render has shown the store's latest list.
    async function revealRow(eventId: string): Promise<number | null> {
        const list = currentMessages();
        if (!list.some((e) => e.getId() === eventId)) return null;
        if (rows.current.length !== list.length) await tick();
        return indexOfEvent(eventId);
    }

    // Zami: `el.scrollIntoView({ block })` for the row at `index`:
    // `viewPosition` 0 lines its bottom up with the view's ("end"), 0.5
    // centres it, 1 puts it at the top. A row the list hasn't laid out yet is
    // first scrolled near by its estimated offset, then aimed at again.
    // `viewOffset` moves it that many pixels further from where viewPosition
    // puts it (towards the bottom for a negative one).
    const scrollTarget = useRef<{
        index: number;
        viewPosition: number;
        viewOffset: number;
        tries: number;
    } | null>(null);
    function scrollRowIntoView(
        index: number,
        viewPosition: number,
        animated: boolean,
        viewOffset = 0,
    ) {
        if (index >= rows.current.length) return;
        scrollTarget.current = { index, viewPosition, viewOffset, tries: 0 };
        scrollEl.current?.scrollToIndex({
            index,
            viewPosition,
            viewOffset,
            animated,
        });
    }
    function onScrollToIndexFailed(info: {
        index: number;
        averageItemLength: number;
    }) {
        scrollEl.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
        });
        const target = scrollTarget.current;
        if (!target || target.index !== info.index || target.tries >= 10)
            return;
        target.tries++;
        setTimeout(() => {
            if (scrollTarget.current !== target) return;
            if (target.index >= rows.current.length) return;
            scrollEl.current?.scrollToIndex({
                index: target.index,
                viewPosition: target.viewPosition,
                viewOffset: target.viewOffset,
                animated: false,
            });
        }, 50);
    }

    // Zami: the list's latest scroll offset (from the bottom), view height and
    // content height, and from them upstream's `scrollTop`, `clientHeight`
    // and `scrollHeight` of a top-to-bottom scroller.
    const metrics = useRef({ offset: 0, visible: 0, content: 0 });
    function scrollGeometry() {
        const { offset, visible, content } = metrics.current;
        return {
            scrollTop: Math.max(0, content - visible - offset),
            clientHeight: visible,
            scrollHeight: content,
        };
    }
    const [listHeight, setListHeight] = useState(0);
    function onListLayout(e: LayoutChangeEvent) {
        metrics.current.visible = e.nativeEvent.layout.height;
        setListHeight(e.nativeEvent.layout.height);
    }
    function onContentSizeChange(_w: number, h: number) {
        metrics.current.content = h;
    }
    // Zami: the rows on screen, newest first (see the top of the file).
    const viewableKeys = useRef<string[]>([]);

    // Mention highlights, re-derived whenever the message list is replaced. A
    // per-row isHighlightEvent(event) call never re-ran: decryption mutates the
    // SAME MatrixEvent, so the row saw no change and a mention that arrived as
    // ciphertext stayed unhighlighted (issue #39).
    // Zami: per row as it renders (mentionHighlightOf), remembered per event
    // until it decrypts, rather than for the whole list on every change; the
    // rows re-check after decryptions (the rows store's touch, below).

    // Liveness comes from the room's MatrixRTC memberships, which the SDK
    // recomputes asynchronously AFTER the m.call.member event reaches the
    // timeline; voiceTick re-folds once it lands, or a just-started call
    // folded against the stale list stuck on "Call ended".
    // Zami: each row keeps its previous summary while it reads the same, and
    // the getter returns a version that only moves when one changed, so the
    // ticks (every room's timeline writes among them) don't re-render the
    // room otherwise.
    // Zami: and re-folded on this room's list and call events (callEventTick),
    // not on every room's timeline writes and every sync (timelineTick,
    // roomsTick), which each walked the whole timeline.
    const [summaryCache] = useState(() => ({
        map: new Map<string, CallSummary>(),
        version: 0,
    }));
    const [callEventTick, setCallEventTick] = useState(0);
    useEffect(
        () => onCallEvent(room, () => setCallEventTick((n) => n + 1)),
        [room],
    );
    const callSummaryVersion = useRune(() => {
        void messages;
        void callEventTick;
        void voiceCallState.voiceTick;
        const next = keepEqualValues(
            summaryCache.map,
            isContextView && contextWindow
                ? getContextCallSummaries(room, contextWindow)
                : getCallSummaries(room),
            sameCallSummary,
        );
        if (!sameEntries(summaryCache.map, next)) {
            summaryCache.map = next;
            summaryCache.version++;
        }
        return summaryCache.version;
    }, [
        room,
        isContextView,
        contextWindow,
        summaryCache,
        messages,
        callEventTick,
    ]);
    const callSummaries = useMemo(() => {
        void callSummaryVersion;
        return summaryCache.map;
    }, [callSummaryVersion, summaryCache]);

    // The event ID the user had read up to when they opened the room, while
    // that read state is still unacknowledged. Drives the unread bar and turns
    // off sticking to the bottom; cleared once the room is marked read.
    // Put the "New Messages" divider near the top (a little read history
    // above it, room for the unread bar) and keep it there while rows and
    // media around it settle, as a jump to a message does. Any touch hands
    // control back at once. Few unread messages clamp this to the bottom,
    // which counts as reading them.
    // Zami: the divider's row is aimed at (its day separator, when it has
    // one, sits above the divider), and a touch on the list stops the loop
    // (onListTouchStart), after which onScroll takes over.
    function holdDividerNearTop(firstUnreadId: string) {
        if (!scrollEl.current) return;
        stopScrollIntoView();
        // Zami: scrollToIndex clamps at the bottom before applying
        // viewOffset, so a divider too near the bottom to reach the top lands
        // the gap above the bottom; seen there, go to the bottom instead.
        // Judged a moment after the first aim, once its scroll event has
        // reported where the list landed.
        let placedAt: number | null = null;
        let atBottom = false;
        const place = () => {
            if (atBottom) {
                scrollEl.current?.scrollToOffset({
                    offset: 0,
                    animated: false,
                });
                return;
            }
            if (
                placedAt !== null &&
                Date.now() - placedAt >= BOTTOM_CHECK_MS &&
                metrics.current.offset <= UNREAD_DIVIDER_TOP_GAP + 1
            ) {
                atBottom = true;
                place();
                return;
            }
            const index = indexOfEvent(firstUnreadId);
            if (index === null) return;
            scrollRowIntoView(index, 1, false, -UNREAD_DIVIDER_TOP_GAP);
            placedAt ??= Date.now();
        };
        const finish = () => {
            // Something else (a jump, a room switch) already took over.
            if (intervalId.current !== hold) return;
            stopScrollIntoView();
            setIsAtBottom(measureAtBottom());
            if (isAtBottomRef.current && atLiveEdge())
                markAsReadIfDisplayable();
        };
        place();
        const hold = setInterval(place, 50);
        intervalId.current = hold;
        scrollStopTimeout.current = setTimeout(finish, UNREAD_HOLD_MS);
    }

    // Whether the bottom of what's shown is the newest message: always in the
    // live timeline; in a window only once it has paged up to the live edge.
    // Reaching the bottom only counts as reading the room there.
    function atLiveEdge(): boolean {
        if (contextMessagesRef.current === null) return true;
        const win = contextWindowRef.current;
        return !!win && !contextWindowCanPaginate(win, true);
    }
    const [unreadMarkerEventId, setUnreadMarkerEventId, unreadMarkerRef] =
        useLiveState<string | null>(null);
    // Where the "New Messages" divider sits. Unlike the marker above it stays
    // for the whole visit (as in Discord), so reaching the bottom doesn't wipe
    // out where the new messages started. Re-derived on every room open.
    const [unreadDividerEventId, setUnreadDividerEventId, unreadDividerRef] =
        useLiveState<string | null>(null);
    // When the receipt's event isn't loaded, its time places the divider.
    const [unreadReadTs, setUnreadReadTs, unreadReadTsRef] = useLiveState<
        number | null
    >(null);
    // "Mark as unread" names the first UNREAD message, so the divider goes
    // above unreadDividerEventId instead of below it.
    const [unreadFromFirst, setUnreadFromFirst, unreadFromFirstRef] =
        useLiveState(false);
    // Marked unread while looking at the room: reaching the bottom or
    // refocusing doesn't read it again; leaving or "Mark as read" do.
    const keepUnreadHere = useRef(false);
    // Row the divider sits above; -1 while the loaded rows don't reach back
    // to the read position (or nothing is unread).
    const dividerIndex = useMemo(
        () =>
            dividerIndexOf(
                messages,
                unreadDividerEventId,
                unreadReadTs,
                unreadFromFirst,
            ),
        [messages, unreadDividerEventId, unreadReadTs, unreadFromFirst],
    );
    // Zami: dividerIndex as it stands now, for the async code below.
    function currentDividerIndex(): number {
        return dividerIndexOf(
            currentMessages(),
            unreadDividerRef.current,
            unreadReadTsRef.current,
            unreadFromFirstRef.current,
        );
    }
    // The unread bar's "N new messages since <time>". When the read position
    // is further back than the loaded history, the count is a lower bound and
    // "since" is when the user last read the room.
    // Zami: refreshed on this room's timeline writes (`messages`) and on
    // unread counts changing (unreadTick), not on every timelineTick.
    const unreadTick = useRune(() => roomsState.unreadTick);
    const unreadSummary = useMemo(() => {
        void unreadTick;
        if (!unreadMarkerEventId) return null;
        if (dividerIndex >= 0) {
            const since = messageTimestamp(messages[dividerIndex].getTs());
            const loaded = messages.length - dividerIndex;
            // A window opened at the read position holds only part of the
            // unread run; the server's count covers all of it when the room
            // notifies, else what's loaded is a lower bound.
            if (
                !isContextView ||
                (!!contextWindow &&
                    !contextWindowCanPaginate(contextWindow, true))
            )
                return {
                    key: "messageArea.unreadSince",
                    params: { count: loaded, since },
                } as const;
            const counted = room.getUnreadNotificationCount() ?? 0;
            return counted >= loaded
                ? ({
                      key: "messageArea.unreadSince",
                      params: { count: counted, since },
                  } as const)
                : ({
                      key: "messageArea.unreadSinceMany",
                      params: { count: loaded, since },
                  } as const);
        }
        if (
            !unreadFromFirst &&
            messages.some((e) => e.getId() === unreadMarkerEventId)
        )
            return null;
        const newest = messages[messages.length - 1];
        if (unreadReadTs !== null && newest && newest.getTs() <= unreadReadTs)
            return null;
        const count = Math.max(
            room.getUnreadNotificationCount() ?? 0,
            messages.length,
        );
        return unreadReadTs
            ? ({
                  key: "messageArea.unreadSinceMany",
                  params: { count, since: messageTimestamp(unreadReadTs) },
              } as const)
            : ({ key: "messageArea.unreadMany", params: { count } } as const);
    }, [
        unreadTick,
        unreadMarkerEventId,
        dividerIndex,
        messages,
        isContextView,
        contextWindow,
        room,
        unreadFromFirst,
        unreadReadTs,
    ]);

    // This room's recent share of history events that render as a message
    // (low in rooms full of joins); sizes the next page (utils/backfillSizing).
    const visibleRatio = useRef(INITIAL_VISIBLE_RATIO);

    // Clear reply and context view when switching rooms
    useEffect(() => {
        void room.roomId; // track room changes
        setReplyToEvent(null);
        setContextWindow(null);
        setContextMessages(null);
        setContextAtReadPosition(false);
        // Release the backfill lock so the new room's initial backfill isn't
        // blocked by a load still in flight for the previous room (F2). The
        // finally in loadOlderMessages only clears the lock for its own room.
        setLoadingOlder(false);
        visibleRatio.current = INITIAL_VISIBLE_RATIO;
    }, [room, setContextMessages, setContextWindow, setLoadingOlder]);
    // Zami: the list is keyed by room, so a new room's starts over at its
    // bottom; before its first events arrive (hence a layout effect).
    useLayoutEffect(() => {
        void roomId;
        metrics.current = {
            offset: 0,
            visible: metrics.current.visible,
            content: 0,
        };
        viewableKeys.current = [];
        setIsAtBottom(true);
    }, [roomId, setIsAtBottom]);

    // Load messages when room changes — always reload from SDK state (fast, in-memory)
    const openRoom = useEffectEvent((id: string) => {
        const events = getTimelineMessages(room);
        setMessages(id, events);
        // Re-derive "more history?" on every visit instead of trusting a
        // verdict latched on an earlier one. While we were elsewhere a
        // gappy sync may have replaced this room's timeline with a short
        // fresh one that CAN paginate; a stale false then showed only the
        // post-gap messages (older ones "vanished") and scrolling to the
        // top did nothing. loadPreviousMessages re-checks the real token.
        setCanLoadMore(id, true);
        // Unread when our receipt is behind the newest event. Under
        // sliding sync the receipt's event is usually not loaded yet
        // (rooms open with only their newest event), so getReadUpToEventId
        // is null and the receipt's own time has to tell.
        // Zami: upstream's untrack block, as a function returning what it
        // found.
        const { readUpTo, readTs, fromFirst } = (() => {
            let readUpTo: string | null = null;
            const marker = getReadUpToEventId(room);
            const receipt = getOwnReadReceipt(room);
            const last = events[events.length - 1];
            // "Mark as unread" wins over the receipt (which can't move back):
            // from the chosen message, or the newest one when the room was
            // marked without a position (room menu, another client).
            const marked = getMarkedUnread(room);
            const from =
                marked?.from ??
                (marked && last?.getId()
                    ? { eventId: last.getId()!, ts: last.getTs() }
                    : null);
            if (from)
                return {
                    readUpTo: from.eventId,
                    readTs: from.ts - 1,
                    fromFirst: true,
                };
            if (marker) {
                // Unread only when a shown message from someone else follows
                // the receipt. It often sits on a hidden event (a join, a
                // reaction, an edit) newer than the last shown message; a
                // plain "not the last shown message" check called such a
                // fully read room unread and opened it at the receipt.
                const live = room.getLiveTimeline().getEvents();
                const at = live.findIndex((e) => e.getId() === marker);
                if (at < 0) {
                    if (marker !== last?.getId()) readUpTo = marker;
                } else {
                    const shown = new Set(events);
                    if (
                        live
                            .slice(at + 1)
                            .some(
                                (e) =>
                                    shown.has(e) &&
                                    e.getSender() !== auth.userId,
                            )
                    )
                        readUpTo = marker;
                }
            } else if (
                receipt &&
                receipt.ts > 0 &&
                last &&
                last.getId() !== receipt.eventId &&
                last.getSender() !== auth.userId &&
                last.getTs() > receipt.ts
            ) {
                readUpTo = receipt.eventId;
            }
            return {
                readUpTo,
                readTs: receipt && receipt.ts > 0 ? receipt.ts : null,
                fromFirst: false,
            };
        })();
        setUnreadMarkerEventId(readUpTo);
        setUnreadDividerEventId(readUpTo);
        setUnreadReadTs(readTs);
        setUnreadFromFirst(fromFirst);
        keepUnreadHere.current = false;
        void layoutSettled().then(async () => {
            if (readUpTo) {
                // The read position isn't loaded (under sliding sync a room
                // opens with only its newest event). Open a window AT it, as
                // a jump to that message would, instead of paging back from
                // the present: an active room can have a huge gap, and pages
                // are slow. Scrolling down pages the window forward; jumping
                // to the present goes straight to the live timeline.
                if (currentDividerIndex() < 0) {
                    setJumpingToEventId(readUpTo);
                    let win: TimelineWindow | null = null;
                    try {
                        win = await createContextWindow(room, readUpTo);
                    } catch (err) {
                        console.warn(
                            "Opening at the read position failed:",
                            err,
                        );
                    } finally {
                        setJumpingToEventId(null);
                    }
                    if (roomRef.current.roomId !== id) return;
                    if (win) {
                        setContextWindow(win);
                        setContextMessages(getContextWindowEvents(win));
                        setContextAtReadPosition(true);
                        await tick();
                    }
                }
                if (roomRef.current.roomId !== id) return;
                // Scroll so the first unread message is visible near the top
                const at = currentDividerIndex();
                const firstUnreadId =
                    at >= 0 ? currentMessages()[at].getId() : null;
                const markerEl = firstUnreadId
                    ? await revealRow(firstUnreadId)
                    : null;
                if (roomRef.current.roomId !== id) return;
                // Zami: the divider is part of the first unread row, so
                // it's always there once the row is.
                if (markerEl !== null && firstUnreadId && scrollEl.current) {
                    holdDividerNearTop(firstUnreadId);
                } else {
                    scrollToBottom(true);
                }
            } else {
                scrollToBottom(true);
            }
            // If the scroll area isn't tall enough to scroll, onScroll never fires,
            // so markAsRead() is never called. Handle that here.
            // Zami: once the list has measured its content.
            const { scrollHeight, clientHeight } = scrollGeometry();
            if (
                scrollEl.current &&
                scrollHeight > 0 &&
                scrollHeight <= clientHeight &&
                atLiveEdge()
            ) {
                markAsReadIfDisplayable();
            }
            void backfillFromTop();
        });
    });
    useEffect(() => {
        openRoom(room.roomId);
    }, [room]);

    // Reload the timeline when the "show all events" debug toggle flips so the
    // list switches between filtered messages and the full raw event stream.
    const reloadForShowAllEvents = useEffectEvent(() => {
        if (contextMessagesRef.current !== null) return;
        setMessages(roomId, getTimelineMessages(room));
        setCanLoadMore(roomId, true);
    });
    useEffect(() => {
        void showAllEvents; // track only the toggle
        reloadForShowAllEvents();
    }, [showAllEvents]);

    // Whether an event should render as a raw debug row rather than a normal
    // message. Only possible when "show all events" is on (otherwise the
    // timeline only contains renderable messages/stickers).
    // Zami: the rows re-derive on `debugTick`, the timelineTick while "show all
    // events" is on.
    const debugTick = useRune(() =>
        settingsState.showAllEvents ? messagesState.timelineTick : -1,
    );
    function isRawDebugEvent(event: MatrixEvent): boolean {
        if (!showAllEvents) return false;
        // An encrypted event mutates in place when it decrypts (same object),
        // so depend on timelineTick or the row stays a raw m.room.encrypted
        // debug row after it has become a renderable message.
        void debugTick;
        if (event.isRedacted()) return true;
        const type = event.getType();
        if (
            type !== "m.room.message" &&
            type !== "m.sticker" &&
            !isPollStartEventType(type) &&
            !isFileOfferEventType(type)
        )
            return true;
        return event.getContent()?.["m.relates_to"]?.rel_type === "m.replace";
    }

    // Reload messages once the initial sync completes (catches messages missed during SYNCING state)
    useEffect(() => {
        const currentRoom = room;
        const currentRoomId = currentRoom.roomId;
        const unsub = onSyncPrepared(() => {
            if (contextMessagesRef.current !== null) {
                catchUpContextView();
                return;
            }
            setMessages(currentRoomId, getTimelineMessages(currentRoom));
            void backfillFromTop();
            if (isAtBottomRef.current) markAsReadIfDisplayable();
        });
        return unsub;
    }, [room]);

    // Reload after a state-less stub room gets seeded and backfilled (rooms
    // joined over federation that sync omits) — the timeline is populated
    // outside any SDK sync event, so the displayed list must be re-read.
    useEffect(() => {
        const currentRoom = room;
        const currentRoomId = currentRoom.roomId;
        const unsub = onRoomHealed((healedId) => {
            if (
                healedId !== currentRoomId ||
                contextMessagesRef.current !== null
            )
                return;
            setMessages(currentRoomId, getTimelineMessages(currentRoom));
            setCanLoadMore(currentRoomId, true);
            void tick().then(() => {
                if (isAtBottomRef.current) {
                    scrollToBottom(true);
                    markAsReadIfDisplayable();
                }
                void backfillFromTop();
            });
        });
        return unsub;
    }, [room, tick]);

    // Reload when the live timeline is reset by a gappy/limited sync (reconnect,
    // resuming the PWA from a notification, etc). The SDK discards the old
    // timeline and starts a fresh one after the gap, so we must replace the
    // displayed list — otherwise the post-gap events get appended onto stale
    // ones and the intervening messages appear to never have existed. For a
    // user who had paginated back, that replacement would throw away their
    // scroll-back position, so we then re-paginate until their history returns
    // (see recoverScrollback).
    useEffect(() => {
        const currentRoom = room;
        const currentRoomId = currentRoom.roomId;
        const unsub = onTimelineReset(currentRoom, () => {
            // Context view uses its own window; just let it catch up.
            if (contextMessagesRef.current !== null) {
                // The store's copy is now stale; refresh it so rejoinLive (or
                // a room switch back) does not briefly show pre-gap events.
                setMessages(currentRoomId, getTimelineMessages(currentRoom));
                setCanLoadMore(currentRoomId, true);
                catchUpContextView();
                return;
            }
            // Capture what the reset is about to discard — the handler runs
            // before setMessages, so `messages` is still the pre-reset list.
            const prevOldestId = isAtBottomRef.current
                ? undefined
                : currentMessages()[0]?.getId();
            const anchor = isAtBottomRef.current
                ? null
                : captureViewportAnchor();
            setMessages(currentRoomId, getTimelineMessages(currentRoom));
            // The fresh timeline can be paginated back to fill the gap.
            setCanLoadMore(currentRoomId, true);
            void tick().then(async () => {
                if (isAtBottomRef.current) {
                    scrollToBottom(true);
                    markAsReadIfDisplayable();
                } else if (prevOldestId) {
                    await recoverScrollback(
                        currentRoom,
                        currentRoomId,
                        prevOldestId,
                        anchor,
                    );
                }
                void backfillFromTop();
            });
        });
        return unsub;
    }, [room, tick]);

    // The first message row visible in the viewport plus its on-screen offset,
    // so the view can be pinned back to it after the list is rebuilt.
    // Zami: the top row on screen; it's pinned back at the top of the view.
    function captureViewportAnchor(): { eventId: string } | null {
        const key = viewableKeys.current.at(-1);
        const event = key
            ? currentMessages().find((e) => rowKey(e) === key)
            : undefined;
        const eventId = event?.getId();
        return eventId ? { eventId } : null;
    }

    // After a reset replaces the displayed list with the short fresh timeline,
    // paginate backward until the previously-oldest displayed event reappears,
    // then restore the viewport to the captured anchor. Bounded: a gap deeper
    // than RECOVERY_MAX_BATCHES leaves the user at the fresh timeline exactly
    // as before this recovery existed.
    const RECOVERY_MAX_BATCHES = 10;
    async function recoverScrollback(
        currentRoom: Room,
        currentRoomId: string,
        prevOldestId: string,
        anchor: { eventId: string } | null,
    ) {
        // Same gate as backfillFromTop, so the top-sentinel observer can't
        // interleave — and so a fill request swallowed during this recovery is
        // re-run once we're done instead of being lost.
        if (!backfillGate.tryEnter()) return;
        try {
            for (let i = 0; i < RECOVERY_MAX_BATCHES; i++) {
                if (
                    getTimelineMessages(currentRoom).some(
                        (e) => e.getId() === prevOldestId,
                    )
                )
                    break;
                const hasMore = await loadPreviousMessages(currentRoom);
                if (!hasMore) {
                    setCanLoadMore(currentRoomId, false);
                    break;
                }
            }
            if (roomRef.current.roomId !== currentRoomId) return; // room switched mid-recovery
            setMessages(currentRoomId, getTimelineMessages(currentRoom));
            await tick();
            if (!anchor || !scrollEl.current) return;
            const el = await revealRow(anchor.eventId);
            if (el !== null) {
                scrollRowIntoView(el, 1, false);
            }
        } finally {
            if (backfillGate.exit()) void backfillFromTop();
        }
    }

    // Screen-reader announcer for arriving messages (A11Y-06). $state.raw: the
    // reducer replaces the value wholesale and signals "nothing to say" by
    // returning the identical object — a deep proxy would break that identity
    // check and restart the debounce timer forever.
    // Zami: plain refs: nothing renders them.
    const announcerState = useRef(EMPTY_ANNOUNCER);
    const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );

    // Queue one live arrival for the polite region below the timeline. Called
    // from SDK subscription callbacks, NOT from an `$effect`: an effect that
    // both read and wrote this state would re-enter itself.
    function queueArrivalAnnouncement(event: MatrixEvent) {
        const arrivedBody = event.getContent()?.body;
        const next = recordArrival(announcerState.current, {
            eventId: event.getId() ?? "",
            sender:
                event.sender?.name ??
                event.getSender() ??
                t("messageArea.someone"),
            isOwn: event.getSender() === auth.userId,
            // showAllEvents lets non-message events through, where `body` may
            // be missing or not a string.
            body: typeof arrivedBody === "string" ? arrivedBody : "",
        });
        // Identity check, not equality: an unchanged state means the message
        // was dropped (own echo, duplicate), so the in-flight burst timer must
        // keep running untouched.
        if (next === announcerState.current) return;
        announcerState.current = next;
        clearTimeout(announceTimer.current);
        announceTimer.current = setTimeout(() => {
            const drained = drainAnnouncement(announcerState.current);
            announcerState.current = drained.state;
            // Zami: a polite announcement through AccessibilityInfo, for the
            // live region's text. It speaks every time, so no zero width space
            // is needed to make a repeated summary count as a change.
            if (drained.text)
                AccessibilityInfo.announceForAccessibilityWithOptions(
                    drained.text,
                    { queue: true },
                );
        }, ANNOUNCE_DEBOUNCE_MS);
    }

    // Subscribe to new live timeline events (incoming and confirmed own messages)
    useEffect(() => {
        const currentRoomId = room.roomId; // capture for closure
        // Capture the Room too: the prop can already point at the NEXT room
        // before this effect is torn down, and re-reading `room` in the
        // callback then wrote that room's events under this room's id.
        const currentRoom = room;
        const unsub = onTimelineEvent(
            (event: MatrixEvent, eventRoom: Room, isLiveAppend: boolean) => {
                bumpUnreadTick();
                if (eventRoom.roomId !== currentRoomId) return;
                if (contextMessagesRef.current !== null) {
                    // Not for the user's own send: paging towards it dragged
                    // them from the history they were reading all the way
                    // back to live. It shows once they scroll down.
                    if (event.getSender() !== getOwnUserId())
                        catchUpContextView();
                    return;
                }
                const tail = messagesState.byRoom[currentRoomId]?.events.at(-1);
                if (isLiveAppend && (!tail || event.getTs() >= tail.getTs())) {
                    // Normal tail append — fast path, the event is the newest.
                    appendMessage(currentRoomId, event);
                } else {
                    // Mid-timeline insertion (thread reply moved to the main
                    // timeline, out-of-order related event) or a live event
                    // older than the tail. appendMessage would place it at the
                    // tail in the wrong spot; re-read the whole timeline so it
                    // lands in its correct position.
                    setMessages(
                        currentRoomId,
                        getTimelineMessages(currentRoom),
                    );
                }
                if (isAtBottomRef.current) {
                    scrollToBottomAfterRender();
                }
                if (isLiveAppend) queueArrivalAnnouncement(event);
            },
        );
        // An encrypted message reaches the timeline as `m.room.encrypted`, a
        // type onTimelineEvent filters out, so the announcer above never sees
        // it — and new DMs default to encrypted, so that is most traffic.
        // onDecryptedTimelineEvent replays the SAME liveness signal the
        // plaintext path gates on (the SDK's `data.liveEvent`, recorded when
        // the ciphertext hit the timeline, backfill already excluded there),
        // plus a sync-completion flag. So a scrollback or key-backup decrypt
        // of history cannot reach the announcer. The reducer dedupes by event
        // id, so an event both paths see is still announced once.
        const unsubDecryptedAnnounce = onDecryptedTimelineEvent(
            (event, eventRoom, meta) => {
                if (
                    eventRoom.roomId !== currentRoomId ||
                    contextMessagesRef.current !== null
                )
                    return;
                if (!shouldAnnounceDecrypted(meta)) return;
                queueArrivalAnnouncement(event);
            },
        );
        return () => {
            unsub();
            unsubDecryptedAnnounce();
            // Room switch or unmount: drop the pending burst rather than
            // announcing the previous room's messages in this one.
            clearTimeout(announceTimer.current);
            announcerState.current = EMPTY_ANNOUNCER;
        };
    }, [room]);

    // Incoming encrypted messages reach the live timeline as `m.room.encrypted`
    // and are filtered out of the live-append path (onTimelineEvent) until they
    // decrypt. Re-read the timeline when an event in this room finishes
    // decrypting so new encrypted messages appear live instead of only after a
    // manual reload. getTimelineMessages includes the now-decrypted message and
    // still excludes decrypted reactions, so the re-read stays correct.
    // Zami: decryptions arrive an event at a time, a page of them at once
    // when a room opens or keys arrive, and each re-read the whole timeline
    // (B2). They're collected and handled once per turn of the event loop (or
    // frame, whichever comes first), and the timeline is re-read only when one
    // changes which rows there are: a placeholder that turned out to be an
    // edit, a reaction or a thread reply, or a call event. A row whose content
    // changed redraws itself; the rows re-check their mention highlight.
    useEffect(() => {
        const currentRoomId = room.roomId;
        const currentRoom = room;
        let decrypted: MatrixEvent[] = [];
        const flush = createCoalescer(() => {
            const batch = decrypted;
            decrypted = [];
            if (
                roomRef.current !== currentRoom ||
                contextMessagesRef.current !== null
            )
                return;
            const shown = getMessages(currentRoomId);
            const keys = keyIndex(shown);
            let reread = settingsState.orderHints;
            let calls = false;
            for (const event of batch) {
                const isCall = isCallEventType(event.getType());
                calls ||= isCall;
                if (
                    isCall ||
                    keys.has(rowKey(event)) !== isRenderableTimelineEvent(event)
                )
                    reread = true;
            }
            if (reread) {
                const events = getTimelineMessages(currentRoom);
                if (!sameEvents(events, shown))
                    setMessages(currentRoomId, events);
            }
            if (calls) setCallEventTick((n) => n + 1);
            rowsStore.touch();
            if (isAtBottomRef.current) {
                scrollToBottomAfterRender();
            }
        });
        const unsub = onEventDecrypted(
            (event: MatrixEvent, eventRoom: Room) => {
                if (
                    eventRoom.roomId !== currentRoomId ||
                    contextMessagesRef.current !== null
                )
                    return;
                decrypted.push(event);
                flush.request();
            },
        );
        return () => {
            unsub();
            flush.cancel();
        };
    }, [room, rowsStore]);

    // Subscribe to local echo updates (own pending messages in Detached ordering mode)
    useEffect(() => {
        const currentRoomId = room.roomId;
        const currentRoom = room;
        const unsub = onLocalEchoUpdated((eventRoom: Room) => {
            if (
                eventRoom.roomId === currentRoomId &&
                contextMessagesRef.current === null
            ) {
                setMessages(currentRoomId, getTimelineMessages(currentRoom));
                if (isAtBottomRef.current) {
                    scrollToBottomAfterRender();
                }
            }
        });
        return unsub;
    }, [room]);

    // Subscribe to reaction, poll-vote, and edit events to trigger re-renders
    useEffect(() => {
        const currentRoomId = room.roomId;
        const unsubReaction = onReactionEvent(
            (_event: MatrixEvent, eventRoom: Room) => {
                if (eventRoom.roomId === currentRoomId) bumpReactionTick();
            },
        );
        const unsubPoll = onPollEvent(
            (_event: MatrixEvent, eventRoom: Room) => {
                if (eventRoom.roomId === currentRoomId) bumpReactionTick();
            },
        );
        const unsubEdit = onEditEvent(
            (_event: MatrixEvent, eventRoom: Room) => {
                if (eventRoom.roomId === currentRoomId) bumpReactionTick();
            },
        );
        return () => {
            unsubReaction();
            unsubPoll();
            unsubEdit();
        };
    }, [room]);

    // Subscribe directly on the room object for redaction events (client does not re-emit these)
    useEffect(() => {
        const currentRoom = room;
        const currentRoomId = currentRoom.roomId;
        const unsub = onRedactionEvent(currentRoom, () => {
            setMessages(currentRoomId, getTimelineMessages(currentRoom));
            bumpReactionTick();
        });
        return unsub;
    }, [room]);

    // Zami: once per RECEIPT_COALESCE_MS for a burst of receipts, and not for
    // the user's own (most of them), which the avatars never show (B4).
    useEffect(() => {
        const currentRoom = room;
        const refresh = createCoalescer(() => setReceiptTick((n) => n + 1), {
            delayMs: RECEIPT_COALESCE_MS,
        });
        const unsub = onReceiptEvent(currentRoom, (event) => {
            const content = event?.getContent() as ReceiptContent | undefined;
            if (content && !movesOthersReceipts(content, getOwnUserId()))
                return;
            refresh.request();
        });
        return () => {
            unsub();
            refresh.cancel();
        };
    }, [room]);

    // Another device can read the room while it's open: drop the unread bar
    // once our receipt reaches the latest event.
    useEffect(() => {
        void receiptTick;
        if (!unreadMarkerRef.current || getMarkedUnread(room)) return;
        const last = getLatestTimelineEvent(room);
        if (last && getReadUpToEventId(room) === last.getId())
            setUnreadMarkerEventId(null);
    }, [receiptTick, room, unreadMarkerRef, setUnreadMarkerEventId]);

    // Show the room as unread from `from` without leaving it (a message's
    // "Mark as unread", here or on another device).
    const showMarkedUnread = useEffectEvent(
        (from: { eventId: string; ts: number }) => {
            setUnreadMarkerEventId(from.eventId);
            setUnreadDividerEventId(from.eventId);
            setUnreadReadTs(from.ts - 1);
            setUnreadFromFirst(true);
            keepUnreadHere.current = true;
        },
    );
    useEffect(() => {
        interfaceState.markUnreadFrom = (from) => showMarkedUnread(from);
        return () => {
            interfaceState.markUnreadFrom = null;
        };
    }, []);
    // The flag changing for this room while it's open: marked elsewhere shows
    // it; cleared (another device reading it) ends it.
    const onMarkedUnread = useEffectEvent((roomId: string) => {
        const current = roomRef.current;
        if (roomId !== current.roomId) return;
        const marked = getMarkedUnread(current);
        if (marked?.from) {
            if (unreadDividerRef.current !== marked.from.eventId)
                showMarkedUnread(marked.from);
        } else if (!marked && keepUnreadHere.current) {
            keepUnreadHere.current = false;
            setUnreadMarkerEventId(null);
        }
    });
    useEffect(
        () => onMarkedUnreadChange((roomId) => onMarkedUnread(roomId)),
        [room],
    );

    function markAsRead() {
        keepUnreadHere.current = false;
        const currentRoom = roomRef.current;
        const last = getLatestTimelineEvent(currentRoom);
        if (!last) return;
        sendReadReceipt(last).catch(() => {});
        bumpUnreadTick();
        setUnreadMarkerEventId(null);
    }

    // A read receipt tells other clients the user has *seen* an event, so only
    // send one when the app could actually display it: the window focused AND
    // the tab visible. Every markAsRead() call site funnels through this gate
    // (see canSendReceipt) so receipts never fire while the app is hidden or
    // in the background. While gated out, local unread state deliberately
    // persists — it clears when the user next focuses (onWindowFocusRegained).
    function markAsReadIfDisplayable() {
        if (keepUnreadHere.current) return;
        // Zami: the window's focus and visibility are AppState's "active".
        const active = AppState.currentState === "active";
        if (canSendReceipt({ hasFocus: active, visible: active })) {
            markAsRead();
        }
    }

    // When the app regains focus/visibility, clear unread the moment the user
    // actually looks — preserving today's perceived behavior now that receipts
    // wait for focus. This runs the existing "at bottom → mark read" path once.
    // markAsRead() synchronously fires app-level listeners, so this MUST stay a
    // plain DOM listener (registered in onMount below); calling it inside a
    // tracked $effect would trip effect_update_depth_exceeded and freeze the
    // component. visibilitychange fires both ways — the canSendReceipt gate
    // inside markAsReadIfDisplayable makes the hidden transition a no-op.
    function onWindowFocusRegained() {
        // In context view "at bottom" is the bottom of the jumped-to window, not
        // the live tail — don't send a receipt for the latest event then.
        if (isAtBottomRef.current && contextMessagesRef.current === null)
            markAsReadIfDisplayable();
    }

    // Zami: the window's `focus` and `visibilitychange` are AppState's changes.
    const onAppStateChange = useEffectEvent(() => onWindowFocusRegained());
    useEffect(() => {
        const subscription = AppState.addEventListener("change", () =>
            onAppStateChange(),
        );
        return () => subscription.remove();
    }, []);

    // Shift+PageUp (Settings > Keybinds): back to the oldest unread message.
    const jumpToUnread = useEffectEvent(() => {
        const at = currentDividerIndex();
        if (at >= 0) {
            const firstUnread = currentMessages()[at].getId();
            if (firstUnread) void scrollToMessage(firstUnread);
        } else if (unreadDividerRef.current)
            void scrollToMessage(unreadDividerRef.current);
    });
    useEffect(() => {
        interfaceState.jumpToUnread = () => jumpToUnread();
        return () => {
            interfaceState.jumpToUnread = null;
        };
    }, []);

    function scrollToBottom(instant: boolean) {
        if (!scrollEl.current) return;
        // Set here, not left to onScroll: a scroll that doesn't move (content
        // still shorter than the viewport on entering a room) fires no scroll
        // event, which would leave the previous room's verdict in place and
        // keep the stick-to-bottom observer below switched off.
        setIsAtBottom(true);
        // Zami: the inverted list's bottom is offset 0.
        scrollEl.current.scrollToOffset({
            offset: 0,
            animated:
                scrollBehavior(instant ? "instant" : "smooth") === "smooth",
        });
        markAsReadIfDisplayable();
    }

    // Zami: upstream's `tick().then(() => scrollToBottom(false))` as messages
    // arrive: once, after the next frame (by when the list has rendered what
    // arrived), for however many arrived. Waiting on tick() forced a render of
    // this whole component per message.
    const bottomFrame = useRef<number | null>(null);
    function scrollToBottomAfterRender() {
        if (bottomFrame.current !== null) return;
        bottomFrame.current = requestAnimationFrame(() => {
            bottomFrame.current = null;
            scrollToBottom(false);
        });
    }
    useEffect(
        () => () => {
            if (bottomFrame.current !== null)
                cancelAnimationFrame(bottomFrame.current);
        },
        [],
    );

    // Supplemental scroll anchor. When content grows LATE while the user is
    // reading history — a link-preview card fetching in, an image decoding — the
    // message they are looking at would jump.
    // Zami: the list's maintainVisibleContentPosition (see the top of the
    // file), so no anchorEl/anchorOffset and no READING_LINE_FRACTION.

    // scrollTop captured when a touch message-selection appeared; the baseline the
    // scroll-dismiss delta is measured from. Adjusted by restoreScrollAnchor so a
    // content-growth correction never reads as a user scroll. null = no selection.
    // Zami: the list's offset from the bottom, which older history loading
    // above doesn't change.
    const selectionScrollTop = useRef<number | null>(null);

    function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        metrics.current = {
            offset: contentOffset.y,
            visible: layoutMeasurement.height,
            content: contentSize.height,
        };
        const { scrollTop, clientHeight, scrollHeight } = scrollGeometry();
        const wasAtBottom = isAtBottomRef.current;
        setIsAtBottom(isNearBottom(scrollTop, clientHeight, scrollHeight));
        // Zami: no reading-position capture or window update (see the top of
        // the file).

        // Touch: a meaningful scroll away from where a message was selected dismisses
        // its floating actions bar. Guarded so a bottom-sheet action in progress and
        // reading-anchor jitter don't nuke the selection (see shouldDismissSelectionOnScroll).
        if (
            interfaceState.isTouchscreen &&
            shouldDismissSelectionOnScroll({
                selectionScrollTop: selectionScrollTop.current,
                currentScrollTop: contentOffset.y,
                modalOpen: interfaceState.modal !== null,
            })
        ) {
            selectionScrollTop.current = null;
            clearSelectedMessage();
        }

        // Receipts advance the live read marker; in context view the bottom of
        // the window is not the live tail, so don't mark read while browsing it.
        if (
            !wasAtBottom &&
            isAtBottomRef.current &&
            contextMessagesRef.current === null
        )
            markAsReadIfDisplayable();
        // Loading older messages near the top is driven by the IntersectionObserver
        // on topSentinelEl (see below) — more reliable than a scroll-position check.
        // Backstop: the observer only fires on an intersection TRANSITION, so a
        // fill that ended while the sentinel stayed in view (a failed load, a
        // latch cleared later) never restarts on its own. Any scroll near the
        // top re-asks; the gate makes a redundant call a no-op.
        if (
            !loadingOlderRef.current &&
            hasOlderToLoad() &&
            needsOlderMessages()
        )
            void backfillFromTop();
        // Loading newer messages (and rejoining live) is driven here: while in a
        // jumped-to context view, approaching the bottom pages the window forward.
        if (contextMessagesRef.current !== null) {
            const distanceToBottom = scrollHeight - scrollTop - clientHeight;
            if (distanceToBottom < 600) void maybeLoadNewer();
        }
    }

    // When a touch selection appears, remember where the timeline was; clear the
    // baseline when the selection goes away. `untrack` keeps isTouchscreen/scrollEl
    // out of this effect's dependency set — only selectedMessageId should retrigger.
    const selectedMessageId = useRune(() => interfaceState.selectedMessageId);
    useEffect(() => {
        const selected = selectedMessageId;
        selectionScrollTop.current =
            selected !== null &&
            interfaceState.isTouchscreen &&
            scrollEl.current
                ? metrics.current.offset
                : null;
    }, [selectedMessageId]);

    // Outside-tap dismiss on touch. On desktop the bar follows hover/focus, so this
    // is touch-only. Ordering is safe: pointerdown fires before click, so tapping
    // ANOTHER row clears here then that row's onclick selects it (handover); tapping
    // the SAME row is ignored here (target is inside it) and its onclick toggles;
    // tapping a bar action is ignored (inside [data-message-actions]). Disabled while
    // a modal is open so a bottom-sheet action is never interrupted.
    // Zami: a touch anywhere in the room area (the root's `onTouchStart`) in
    // place of a document listener. A row's touch reaches the root after its
    // own, which records whose row it began in; the bar is part of its row.
    const touchedRowId = useRef<string | null>(null);
    const onRowTouch = useCallback((eventId: string) => {
        touchedRowId.current = eventId;
    }, []);
    function onRootTouchStart() {
        const touched = touchedRowId.current;
        touchedRowId.current = null;
        const selectedId = interfaceState.selectedMessageId;
        if (
            !interfaceState.isTouchscreen ||
            selectedId === null ||
            interfaceState.modal !== null
        )
            return;
        if (touched === selectedId) return; // the selected row (or its bar)
        clearSelectedMessage();
    }

    async function loadOlderMessages() {
        if (loadingOlderRef.current) return;
        // Context view paginates the jumped-to window; the live view paginates
        // the live timeline. Both share the scroll-preservation dance below.
        const contextWin = contextWindowRef.current;
        if (contextMessagesRef.current !== null) {
            if (!contextWin || !contextWindowCanPaginate(contextWin, false))
                return;
        } else if (!canLoadMore(roomRef.current.roomId)) {
            return;
        }
        setLoadingOlder(true);
        // Capture the room we started paginating. MessageArea is one persistent
        // instance, so `room` can change while the load awaits; on a mismatch we
        // drop the result so room A's "no more history" verdict is never written
        // into room B (which would leave B un-paginatable) (F2).
        const currentRoom = roomRef.current;
        const rid = currentRoom.roomId;
        // Scroll preservation across a history prepend.
        // Zami: none needed: older rows land past the inverted list's top, and
        // its offset from the bottom, which holds the reader's place, doesn't
        // change (upstream nudges a message on screen, backfillReferenceRow,
        // back to where it was).
        try {
            if (contextMessagesRef.current !== null && contextWin) {
                await paginateContextWindow(contextWin, false);
                if (roomRef.current.roomId !== rid) return;
                setContextMessages(getContextWindowEvents(contextWin));
            } else {
                const limit = nextBackfillLimit(
                    BACKFILL_BUFFER_ROWS - rowsAboveViewport(),
                    visibleRatio.current,
                );
                const hasMore = await loadPreviousMessages(currentRoom, limit);
                if (roomRef.current.roomId !== rid) return;
                if (!hasMore) setCanLoadMore(rid, false);
                const events = getTimelineMessages(currentRoom);
                const current = getMessages(rid);
                visibleRatio.current = updateVisibleRatio(
                    visibleRatio.current,
                    events.length - current.length,
                    limit,
                );
                // A page of only hidden events changes nothing on screen:
                // skip the write, which would re-derive every mounted row.
                if (
                    events.length === current.length &&
                    events[0] === current[0]
                )
                    return;
                setMessages(rid, events);
            }

            await tick();
        } finally {
            // Only release the lock for our own room. On a mid-load switch the
            // room-switch effect already reset it for the new room; clearing it
            // unconditionally here would corrupt that room's in-flight load (F2).
            if (roomRef.current.roomId === rid) setLoadingOlder(false);
        }
    }

    // Extend a jumped-to context window towards newer messages as the user
    // scrolls down. Once the window reaches the live edge AND the user is at the
    // bottom, hand back to the live timeline so new messages append and the
    // "Viewing message context" banner clears — the seamless "scroll down to
    // rejoin the present" that jumping to an old message used to lack.
    async function maybeLoadNewer() {
        const win = contextWindowRef.current;
        if (loadingNewer.current || contextMessagesRef.current === null || !win)
            return;
        if (contextWindowCanPaginate(win, true)) {
            loadingNewer.current = true;
            let grew = false;
            try {
                grew = await paginateContextWindow(win, true);
                if (contextWindowRef.current !== win) return; // left the view mid-load
                setContextMessages(getContextWindowEvents(win));
            } finally {
                loadingNewer.current = false;
            }
            // Only onScroll drives this, and a window whose content still fits
            // (or sits at the bottom) produces no further scroll events, so
            // keep going until it overflows or reaches the live edge. Re-measure
            // rather than trust isAtBottom: rows added below don't move
            // scrollTop, so no scroll event clears it, and a stale true chained
            // pages all the way to live and rejoined there.
            // Zami: rows added below move the list's offset instead (it keeps
            // the reader's row in place), which its scroll event reports once
            // laid out.
            await layoutSettled();
            setIsAtBottom(measureAtBottom());
            if (
                grew &&
                contextWindowRef.current === win &&
                isAtBottomRef.current
            )
                void maybeLoadNewer();
        } else if (isAtBottomRef.current && intervalId.current === undefined) {
            // Not while a jump's scroll-into-view loop is still pinning the
            // target: rejoining scrolls to the bottom and would yank it away.
            void rejoinLive(true);
        }
    }

    // Something new happened in this room while a context view is showing
    // (live message, sync caught up, timeline reset). The view ignores live
    // events, so a user parked at its bottom saw nothing new arrive — the
    // notification-tap case where newer messages never loaded. Page the window
    // forward / hand back to live exactly as scrolling to the bottom would.
    function catchUpContextView() {
        if (contextMessagesRef.current === null) return;
        // Measured, not the state: a jump scrolls without always updating it.
        setIsAtBottom(measureAtBottom());
        if (!isAtBottomRef.current) return;
        void maybeLoadNewer();
    }

    // Leave context view and return to the live timeline. The banner's button
    // goes to the present. The automatic handoff (keepPosition) keeps the
    // message on screen where it is: the window counts as caught up once its
    // newest event is anywhere in the live timeline, not only its tail, so
    // scrolling to the bottom there threw a reader in history down to the
    // present whenever a new message arrived.
    async function rejoinLive(keepPosition = false) {
        const currentRoom = roomRef.current;
        const live = getTimelineMessages(currentRoom);
        let anchor: { eventId: string } | null = null;
        if (keepPosition) {
            // A message on screen that the live timeline also holds; the
            // window's older rows may not be in it.
            const liveIds = new Set(live.map((e) => e.getId()));
            anchor =
                visibleRowAnchors().find((a) => liveIds.has(a.eventId)) ?? null;
            // Swapping now would lose the reader's place: stay in the window.
            if (!anchor) return;
            // Not at the bottom of the live timeline until measured: a stale
            // true pins the swap to the bottom (stick, bottom anchor, rows).
            setIsAtBottom(false);
        }
        // Zami: the lowest row on screen, which the list holds in place across
        // the swap when the live timeline has it too.
        const held = viewableKeys.current[0];
        setContextWindow(null);
        setContextMessages(null);
        setContextAtReadPosition(false);
        setMessages(currentRoom.roomId, live);
        await tick();
        const el = anchor ? await revealRow(anchor.eventId) : null;
        if (el === null || !scrollEl.current) {
            scrollToBottom(true);
        } else {
            if (!held || !live.some((e) => rowKey(e) === held))
                scrollRowIntoView(el, 1, false);
            await layoutSettled();
            setIsAtBottom(measureAtBottom());
        }
        // Landing at the present from a window opened at the read position
        // reads the room; no scroll event follows to say so.
        if (isAtBottomRef.current && unreadMarkerRef.current)
            markAsReadIfDisplayable();
    }

    // Every message row at least partly on screen, top to bottom, with its
    // on-screen offset.
    // Zami: without the offset (see captureViewportAnchor).
    function visibleRowAnchors(): { eventId: string }[] {
        const list = currentMessages();
        const out: { eventId: string }[] = [];
        for (const key of [...viewableKeys.current].reverse()) {
            const at = keyIndex(list).get(key);
            const eventId = at === undefined ? undefined : list[at]?.getId();
            if (eventId) out.push({ eventId });
        }
        return out;
    }

    function measureAtBottom(): boolean {
        if (!scrollEl.current) return isAtBottomRef.current;
        const { scrollTop, clientHeight, scrollHeight } = scrollGeometry();
        return isNearBottom(scrollTop, clientHeight, scrollHeight);
    }

    // Whether older history can still load: the live timeline's pagination
    // token, or the context window's backwards edge.
    function hasOlderToLoad(): boolean {
        const win = contextWindowRef.current;
        return contextMessagesRef.current !== null
            ? !!win && contextWindowCanPaginate(win, false)
            : canLoadMore(roomRef.current.roomId);
    }

    // Messages loaded above the viewport, i.e. what the user can scroll up
    // into without waiting.
    // Zami: the oldest row on screen's place in the list; before the list has
    // reported any, the rows it renders first (from the bottom) are assumed.
    function rowsAboveViewport(): number {
        if (!scrollEl.current) return 0;
        const list = currentMessages();
        const key = viewableKeys.current.at(-1);
        // Zami: by the list's key index, not a search per scroll event.
        const i = key ? (keyIndex(list).get(key) ?? -1) : -1;
        return i >= 0 ? i : Math.max(0, list.length - INITIAL_NUM_TO_RENDER);
    }

    // Scrollback keeps going until a buffer of messages sits above the
    // viewport, not just until the top is off screen: in a room full of
    // joins the old rule stopped after a single visible message.
    function needsOlderMessages(): boolean {
        return (
            isTopSentinelNearViewport() ||
            rowsAboveViewport() < BACKFILL_BUFFER_ROWS
        );
    }

    // Returns whether the top sentinel is on/near screen — i.e. the user has
    // scrolled (almost) to the top, OR there aren't enough messages to make the
    // list scrollable so the top is permanently in view. Reads live geometry so
    // it's accurate mid-pagination.
    function isTopSentinelNearViewport(): boolean {
        if (!scrollEl.current || metrics.current.visible === 0) return false;
        // Sentinel sits at the visual top; once enough older content loads above
        // it, its bottom edge moves well above the viewport top.
        return scrollGeometry().scrollTop < 400;
    }

    // Retry timer for a backfill that failed while the top was in view.
    const backfillRetryTimer = useRef<
        ReturnType<typeof setTimeout> | undefined
    >(undefined);
    const BACKFILL_RETRY_MS = 3000;
    useEffect(() => {
        void roomId; // a pending retry belongs to the room it was scheduled in
        return () => clearTimeout(backfillRetryTimer.current);
    }, [roomId]);

    // Keep paginating older history while the top is in view and the server still
    // has more. Covers both "scrolled to the top" and "too few messages to fill
    // the viewport". Driven by the IntersectionObserver and the explicit fill
    // points (room open, sync prepared, timeline reset).
    async function backfillFromTop() {
        if (!backfillGate.tryEnter()) return;
        try {
            await tick();
            let guard = 0;
            while (hasOlderToLoad() && needsOlderMessages() && guard++ < 50) {
                await loadOlderMessages();
                // Zami: and the list's layout of the new rows, which the
                // checks above measure.
                await layoutSettled();
            }
        } catch (err) {
            // A failed /messages (flaky network, app just resumed) used to
            // escape as an unhandled rejection and end the fill for good: the
            // sentinel was still intersecting, so the observer (which only
            // fires on a transition) never asked again and the top of the
            // room sat there with no spinner and no pagination. Retry.
            console.warn("Loading older messages failed; retrying:", err);
            clearTimeout(backfillRetryTimer.current);
            backfillRetryTimer.current = setTimeout(
                () => void backfillFromTop(),
                BACKFILL_RETRY_MS,
            );
        } finally {
            // A request arrived while we held the gate (typically this room's
            // own first fill, swallowed by the previous room's loop): serve it.
            if (backfillGate.exit()) void backfillFromTop();
        }
    }

    // Reliably trigger backfill when the visual top approaches (rootMargin
    // pre-fetches before the user hits the very top) or stays in view because the
    // list is too short to scroll. Re-created per room.
    // Zami: the list's `onEndReached` (its end is the top), 400px out, fires
    // as its top comes near and again whenever the content grows while it's
    // still near; the rows on screen changing asks again, as the scroll
    // backstop does.
    const onEndReached = useStableCallback(() => void backfillFromTop());
    const onViewableItemsChanged = useStableCallback(
        ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
            viewableKeys.current = viewableItems
                .filter((v) => v.isViewable)
                .map((v) => v.key);
            if (
                !loadingOlderRef.current &&
                hasOlderToLoad() &&
                needsOlderMessages()
            )
                void backfillFromTop();
            // Zami: rows coming near the screen decrypt ahead of the backlog
            // (getTimelineMessages asks only for the newest), and read
            // receipts are worked out down from the screen's top row plus a
            // margin (B2, B4). Indexes count from the bottom.
            let top = -1;
            let bottom = Infinity;
            for (const v of viewableItems) {
                if (!v.isViewable || v.index == null) continue;
                top = Math.max(top, v.index);
                bottom = Math.min(bottom, v.index);
            }
            if (top < 0) return;
            decryptEventsForDisplay(
                rows.current.slice(
                    Math.max(0, bottom - DECRYPT_MARGIN_ROWS),
                    top + DECRYPT_MARGIN_ROWS + 1,
                ),
            );
            const needed = top + 1 + RECEIPT_MARGIN_ROWS;
            const have = receiptRowsRef.current;
            if (needed > have || have > needed + 3 * RECEIPT_MARGIN_ROWS)
                setReceiptRows(
                    Math.max(RECEIPT_ROWS, needed + RECEIPT_MARGIN_ROWS),
                );
        },
    );

    // Keep the reading position pinned when timeline content grows AFTER it
    // rendered: a link-preview card mounting (DOM mutation) or media finishing
    // load (a `load` event, which doesn't bubble → capture phase).
    // Zami: maintainVisibleContentPosition (see the top of the file).

    // Stay at the bottom while content grows under a user who is there.
    // Zami: the inverted list's bottom is its scroll origin, so content
    // growing above it leaves a reader there at the bottom; new rows below
    // are followed by maintainVisibleContentPosition's threshold.

    // Message grouping, date separators and the unread divider are pure
    // functions over the chronological list — see $lib/utils/timelineDisplay.

    // Zami: the rows' callbacks, stable so the memo'd rows skip re-rendering.
    // Zami: when a reply started, for onListTouchEnd (the composer takes it).
    const composerWantedAt = useRef(0);
    const onReply = useCallback((e: MatrixEvent) => {
        setReplyToEvent(e);
        composerWantedAt.current = Date.now();
    }, []);
    const jumpToReply = useStableCallback((eventId: string) => {
        void scrollToMessage(eventId);
    });
    const onOpenThread = useStableCallback(openThread);
    const onEditDone = useCallback(() => messageInputEl.current?.focus(), []);
    const onRevealBlocked = useCallback((eventId: string) => {
        setRevealedBlockedIds((ids) => ({ ...ids, [eventId]: true }));
    }, []);

    // Zami: what the rows read to work out their props (upstream's {#each}
    // body), handed to them through the rows store rather than through
    // renderItem: a change re-renders only the rows it changes, where a new
    // renderItem re-rendered every cell of the list (B3). The rows that mount
    // in this render read it at once; those already mounted, after the commit.
    const rowsContext = useMemo(
        (): RowsContext => ({
            messages,
            dividerIndex,
            isRawDebugEvent,
            ignoredUserIds,
            myUserId,
            revealedBlockedIds,
            receiptsByEvent,
            callSummaries,
            editRequestedEventId,
            highlight,
        }),
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- isRawDebugEvent reads showAllEvents and debugTick.
        [
            messages,
            dividerIndex,
            showAllEvents,
            debugTick,
            ignoredUserIds,
            myUserId,
            revealedBlockedIds,
            receiptsByEvent,
            callSummaries,
            editRequestedEventId,
            highlight,
        ],
    );
    rowsStore.update(rowsContext);
    useLayoutEffect(() => rowsStore.notify(), [rowsStore, rowsContext]);

    const renderItem = useCallback(
        ({ item: event }: ListRenderItemInfo<MatrixEvent>) => {
            // Zami: the list is newest first; the row finds its chronological
            // index in the rows store.
            return (
                <TimelineRow
                    event={event}
                    room={room}
                    rowsStore={rowsStore}
                    onReply={onReply}
                    jumpToReply={jumpToReply}
                    onOpenThread={onOpenThread}
                    onEditDone={onEditDone}
                    onRevealBlocked={onRevealBlocked}
                    onRowTouch={onRowTouch}
                />
            );
        },
        [
            room,
            rowsStore,
            onReply,
            jumpToReply,
            onOpenThread,
            onEditDone,
            onRevealBlocked,
            onRowTouch,
        ],
    );

    // Zami: what keeps the reader's place (see the top of the file). The
    // bottom anchor: follow new messages while the reader is at the bottom of
    // the live timeline and no unread divider holds the view.
    const followBottom = !unreadMarkerEventId && stickToBottom;
    const visibleContentPosition = useMemo(
        () => ({
            minIndexForVisible: 0,
            autoscrollToTopThreshold: followBottom
                ? AT_BOTTOM_SLACK
                : undefined,
        }),
        [followBottom],
    );

    // Zami: the list's handlers, stable so a render of the room doesn't
    // re-render the list.
    const onListScroll = useStableCallback(onScroll);
    const onListLayoutStable = useStableCallback(onListLayout);
    const onListContentSizeChange = useStableCallback(onContentSizeChange);
    const onListScrollToIndexFailed = useStableCallback(onScrollToIndexFailed);
    // Zami: a tap on the timeline puts the keyboard away, as a tap outside the
    // composer blurs it in a browser; the tap still reaches what it landed on
    // (a message, a link). A drag puts it away too (keyboardDismissMode). A
    // tap that moves focus to another field keeps the keyboard, and so does one
    // that started a reply (which wants the composer). The check waits a
    // moment: a field focused from an effect, as a message's edit box is, only
    // takes focus after the tap's own handler has run.
    const keyboardTap = useRef<{
        x: number;
        y: number;
        at: number;
        focused: unknown;
    } | null>(null);
    const onListTouchStart = useStableCallback((e: GestureResponderEvent) => {
        stopScrollIntoView();
        const { pageX, pageY, touches } = e.nativeEvent;
        keyboardTap.current =
            Keyboard.isVisible() && touches.length <= 1
                ? {
                      x: pageX,
                      y: pageY,
                      at: Date.now(),
                      focused: TextInput.State.currentlyFocusedInput(),
                  }
                : null;
    });
    const onListTouchEnd = useStableCallback((e: GestureResponderEvent) => {
        const start = keyboardTap.current;
        keyboardTap.current = null;
        if (!start) return;
        const { pageX, pageY } = e.nativeEvent;
        if (
            Math.abs(pageX - start.x) >= 10 ||
            Math.abs(pageY - start.y) >= 10 ||
            Date.now() - start.at >= 400
        )
            return;
        setTimeout(() => {
            if (
                composerWantedAt.current < start.at &&
                TextInput.State.currentlyFocusedInput() === start.focused
            )
                Keyboard.dismiss();
        }, 150);
    });

    // Zami: MessageInput's `scrollEl`: "scroll to the newest message" is the
    // inverted list's offset 0, not its end.
    const timelineScroller = useMemo<TimelineScroller>(
        () => ({
            scrollToEnd: (options) =>
                scrollEl.current?.scrollToOffset({
                    offset: 0,
                    animated: options?.animated ?? true,
                }),
        }),
        [],
    );

    // Zami: the room area reaches the home indicator (AppShell leaves it to
    // the composer, which pads for it), so what else sits at its bottom (the
    // cached-room note, the drawers, in the panels' color) pads for it while
    // the keyboard, which covers it, is down.
    const insets = useSafeAreaInsets();
    const keyboardShown = useKeyboardState((state) => state.isVisible);
    const bottomInset = keyboardShown ? 0 : insets.bottom;

    const joining = joinPendingRoomId === room.roomId;
    const callLabel = joining
        ? t("messageArea.joiningVoiceCall")
        : t("messageArea.startVoiceCall");

    // Zami: a header button's icon color, which upstream's button sets as its
    // text color (`currentColor`).
    const headerIconClass = (active: boolean) =>
        active ? "text-discord-accent" : "text-discord-textMuted";
    const headerButtonClass = (active: boolean) =>
        `p-1.5 rounded transition-colors ${
            active ? "bg-discord-messageHover" : "hover:bg-discord-messageHover"
        }`;

    const threadBadge =
        threadRollup.mentions > 0 ? (
            <View className="absolute -top-1 -end-1 flex-shrink-0 bg-discord-danger rounded-full min-w-[16px] h-4 px-1 flex-row items-center justify-center ring-2 ring-discord-backgroundSecondary">
                <Text className="text-white text-[10px] leading-none font-bold">
                    {threadRollup.mentions > 99 ? "99+" : threadRollup.mentions}
                </Text>
            </View>
        ) : threadRollup.anyUnread ? (
            <View className="absolute top-0.5 end-0.5 w-2 h-2 rounded-full bg-discord-accent ring-2 ring-discord-backgroundSecondary" />
        ) : null;
    // Zami: what the badge's `title` said, for screen readers.
    const threadBadgeLabel =
        threadRollup.mentions > 0
            ? t("messageArea.unreadThreadMentions")
            : threadRollup.anyUnread
              ? t("messageArea.unreadThreads")
              : null;

    const rightPanel = (
        <>
            {showNotificationsPanel ? (
                <NotificationsPanel
                    onClose={closeSidebar}
                    onJumpTo={(_rid, eid) => void scrollToMessage(eid)}
                />
            ) : showSearchPanel ? (
                <MessageSearchPanel
                    room={room}
                    onClose={closeSidebar}
                    onJumpTo={(eid) => void scrollToMessage(eid)}
                />
            ) : showThreadsPanel ? (
                <ThreadsListPanel
                    room={room}
                    onClose={closeSidebar}
                    onOpenThread={openThread}
                />
            ) : showMediaPanel ? (
                <RoomMediaPanel room={room} onClose={closeSidebar} />
            ) : isMobile || showPinnedPanel ? (
                <PinnedMessagesPanel
                    room={room}
                    onClose={closeSidebar}
                    onJumpTo={(eid) => void scrollToMessage(eid)}
                />
            ) : null}
        </>
    );

    return (
        <>
            {/* Zami: the room area shrinks above the keyboard, its composer and
                the thread panel's with it; the inverted timeline keeps its
                newest message at the bottom as it shrinks. */}
            <KeyboardAvoidingView
                behavior="padding"
                automaticOffset
                style={{ flex: 1, minWidth: 0 }}
            >
                <GestureDetector gesture={drawerPan}>
                    {/* Pinned left-to-right so the chat stays left of its side panels in every
                        language; the chat and each panel get the UI direction back. */}
                    <View
                        style={{ direction: "ltr" }}
                        className="flex-1 flex-row min-w-0 overflow-hidden relative"
                        onTouchStart={onRootTouchStart}
                    >
                        {/* Drop overlay */}
                        {/* Zami: not ported (see dragging files above). */}

                        {/* Main chat area */}
                        <View
                            style={{ direction: uiDir }}
                            className="flex-1 flex-col min-w-0 overflow-hidden"
                        >
                            {/* Room header */}
                            {/* Zami: not ported: `data-zam-region="room-header"`,
                                the DOM hook plugins find it by (pluginDom.ts);
                                there's no DOM for them to query. */}
                            <View className="h-12 px-4 flex-row items-center gap-3 border-b border-discord-divider shadow-sm flex-shrink-0">
                                {isMobile ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={onMenuOpen}
                                        className="relative p-1.5 -ms-1 rounded hover:bg-discord-messageHover transition-colors flex-shrink-0"
                                        accessibilityLabel={
                                            hasAnyLoud
                                                ? `${t("common.openRoomList")}, ${t("messageArea.unreadNotifications")}`
                                                : t("common.openRoomList")
                                        }
                                    >
                                        <SvgIcon
                                            className="w-5 h-5 text-discord-textMuted"
                                            d={MENU_PATH}
                                        />
                                        {hasAnyLoud ? (
                                            <View className="absolute top-0.5 end-0.5 w-2 h-2 rounded-full bg-discord-danger border border-discord-background" />
                                        ) : null}
                                    </Pressable>
                                ) : null}
                                <Hash
                                    size={20}
                                    className="text-discord-textMuted flex-shrink-0"
                                />
                                {/* 5rem floor below md only: the header's buttons cannot shrink, so
                                    without a floor the name and topic each get a proportional share of
                                    the deficit at 412px and neither renders even an ellipsis. Above md
                                    there is ample width, so drop the floor rather than strand short
                                    names (a DM titled "Zam" would sit 50px from the lock icon). */}
                                <Text
                                    accessibilityRole="header"
                                    numberOfLines={1}
                                    className="flex-shrink font-semibold text-discord-textPrimary min-w-[5rem] md:min-w-0"
                                >
                                    {roomName}
                                </Text>
                                {roomEncrypted ? (
                                    <View
                                        accessible
                                        accessibilityLabel={t(
                                            "messageArea.encryptionEnabled",
                                        )}
                                        className="flex-shrink-0"
                                    >
                                        <Lock
                                            size={16}
                                            className="text-discord-textMuted"
                                        />
                                    </View>
                                ) : null}
                                {topic ? (
                                    <>
                                        <View className="w-px h-5 bg-discord-divider" />
                                        {isMobile ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                onPress={openTopicSheet}
                                                accessibilityLabel={t(
                                                    "roomTopicSheet.open",
                                                )}
                                                className="flex-auto min-w-0"
                                            >
                                                <Text
                                                    numberOfLines={1}
                                                    className="text-sm text-discord-textMuted"
                                                >
                                                    {topic}
                                                </Text>
                                            </Pressable>
                                        ) : (
                                            <Text
                                                numberOfLines={1}
                                                className="text-sm text-discord-textMuted flex-auto min-w-0"
                                            >
                                                {topic}
                                            </Text>
                                        )}
                                    </>
                                ) : null}
                                {!topic ? <View className="flex-1" /> : null}
                                {/* Start voice call button */}
                                {startCallMode === "join" ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            void joinCall(room.roomId)
                                        }
                                        disabled={joinPendingRoomId !== null}
                                        accessibilityState={{
                                            disabled:
                                                joinPendingRoomId !== null,
                                        }}
                                        className="p-1.5 rounded transition-colors hover:bg-discord-messageHover disabled:opacity-50"
                                        accessibilityLabel={callLabel}
                                    >
                                        {joining ? (
                                            <Pulse>
                                                <Phone
                                                    size={20}
                                                    className="text-discord-textMuted"
                                                />
                                            </Pulse>
                                        ) : (
                                            <Phone
                                                size={20}
                                                className="text-discord-textMuted"
                                            />
                                        )}
                                    </Pressable>
                                ) : null}
                                {/* Flip to the call view (peek without joining) */}
                                {callCount > 0 || isVideoRoomView ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            showCallView(room.roomId)
                                        }
                                        className="p-1.5 rounded transition-colors hover:bg-discord-messageHover"
                                        accessibilityLabel={t(
                                            "messageArea.showCall",
                                        )}
                                    >
                                        <Maximize2
                                            size={20}
                                            className="text-discord-textMuted"
                                        />
                                    </Pressable>
                                ) : null}
                                {/* Search messages button */}
                                {!searchUnsupported ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() => toggleSidebar("search")}
                                        className={headerButtonClass(
                                            showSearchPanel,
                                        )}
                                        accessibilityLabel={t(
                                            "messageArea.searchMessages",
                                        )}
                                        accessibilityState={{
                                            selected: showSearchPanel,
                                        }}
                                    >
                                        <SvgIcon
                                            className={`w-5 h-5 ${headerIconClass(showSearchPanel)}`}
                                            d={SEARCH_PATH}
                                        />
                                    </Pressable>
                                ) : null}
                                {/* Threads, pinned, notifications and the member list are desktop
                                    only; on mobile they live in the "⋯" sheet below so the room
                                    name and topic are not starved by eight unshrinkable buttons. */}
                                {!isMobile ? (
                                    <>
                                        {/* Threads list button */}
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                toggleSidebar("threads")
                                            }
                                            className={`relative ${headerButtonClass(showThreadsPanel)}`}
                                            accessibilityLabel={
                                                threadBadgeLabel
                                                    ? `${t("messageArea.toggleThreadsList")}, ${threadBadgeLabel}`
                                                    : t(
                                                          "messageArea.toggleThreadsList",
                                                      )
                                            }
                                            accessibilityState={{
                                                selected: showThreadsPanel,
                                            }}
                                        >
                                            <SvgIcon
                                                className={`w-5 h-5 ${headerIconClass(showThreadsPanel)}`}
                                                d={THREADS_PATH}
                                            />
                                            {threadBadge}
                                        </Pressable>
                                        {/* Pinned messages button */}
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                toggleSidebar("pinned")
                                            }
                                            className={headerButtonClass(
                                                showPinnedPanel,
                                            )}
                                            accessibilityLabel={
                                                pinnedCount > 0
                                                    ? t(
                                                          "messageArea.pinnedMessagesCount",
                                                          {
                                                              count: pinnedCount,
                                                          },
                                                      )
                                                    : t(
                                                          "messageArea.pinnedMessages",
                                                      )
                                            }
                                            accessibilityState={{
                                                selected: showPinnedPanel,
                                            }}
                                        >
                                            <SvgIcon
                                                className={`w-5 h-5 ${headerIconClass(showPinnedPanel)}`}
                                                d={PIN_PATH}
                                            />
                                        </Pressable>
                                        {/* Notifications inbox button */}
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                toggleSidebar("notifications")
                                            }
                                            className={headerButtonClass(
                                                showNotificationsPanel,
                                            )}
                                            accessibilityLabel={t(
                                                "messageArea.notificationsInbox",
                                            )}
                                            accessibilityState={{
                                                selected:
                                                    showNotificationsPanel,
                                            }}
                                        >
                                            <SvgIcon
                                                className={`w-5 h-5 ${headerIconClass(showNotificationsPanel)}`}
                                                d={BELL_PATH}
                                            />
                                        </Pressable>
                                        {/* Media and files browser */}
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                toggleSidebar("media")
                                            }
                                            className={headerButtonClass(
                                                showMediaPanel,
                                            )}
                                            accessibilityLabel={t(
                                                "messageArea.mediaAndFiles",
                                            )}
                                            accessibilityState={{
                                                selected: showMediaPanel,
                                            }}
                                        >
                                            <Image
                                                size={20}
                                                className={headerIconClass(
                                                    showMediaPanel,
                                                )}
                                            />
                                        </Pressable>
                                        {/* Toggle member list */}
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() =>
                                                toggleSidebar("members")
                                            }
                                            className={headerButtonClass(
                                                showMemberList,
                                            )}
                                            accessibilityLabel={t(
                                                "messageArea.toggleMemberList",
                                            )}
                                            accessibilityState={{
                                                selected: showMemberList,
                                            }}
                                        >
                                            <Users
                                                size={20}
                                                className={headerIconClass(
                                                    showMemberList,
                                                )}
                                            />
                                        </Pressable>
                                        {pluginHeaderBtns.map((btn) => (
                                            <Pressable
                                                key={btn.entryId}
                                                accessibilityRole="button"
                                                onPress={() =>
                                                    openPluginHeaderPanel(btn)
                                                }
                                                className={headerButtonClass(
                                                    activePluginPanelKey ===
                                                        btn.key,
                                                )}
                                                accessibilityLabel={btn.label}
                                            >
                                                {btn.icon ? (
                                                    <SvgIcon
                                                        className={`w-5 h-5 ${headerIconClass(activePluginPanelKey === btn.key)}`}
                                                        d={btn.icon}
                                                    />
                                                ) : (
                                                    <Text
                                                        className={`text-xs font-semibold ${headerIconClass(activePluginPanelKey === btn.key)}`}
                                                    >
                                                        {btn.label.slice(0, 2)}
                                                    </Text>
                                                )}
                                            </Pressable>
                                        ))}
                                    </>
                                ) : (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={toggleOverflowMenu}
                                        className={`relative flex-shrink-0 ${headerButtonClass(overflowActive)}`}
                                        accessibilityLabel={
                                            threadBadgeLabel
                                                ? `${t("messageArea.moreRoomOptions")}, ${threadBadgeLabel}`
                                                : t(
                                                      "messageArea.moreRoomOptions",
                                                  )
                                        }
                                        accessibilityState={{
                                            expanded: overflowOpen,
                                        }}
                                    >
                                        <MoreHorizontal
                                            size={20}
                                            className={headerIconClass(
                                                overflowActive,
                                            )}
                                        />
                                        {threadBadge}
                                    </Pressable>
                                )}
                            </View>

                            <ActiveCallBanner room={room} />
                            <LiveLocationBanner room={room} />

                            {/* Messages scrollable area. aria-live="off" is load-bearing: role="log"
                                implies aria-live="polite", and backfill replaces the whole messages
                                array, so an implicit live region would re-announce the entire
                                visible history on every scroll-up. Arrivals are announced by the
                                dedicated sr-only region after this container instead. */}
                            {/* Zami: inverted (see the top of the file): its header is
                                the bottom (the tombstone banner, below the newest
                                message) and its footer the top (the history edge).
                                Keyed by room, so a room opens at its own bottom.
                                Zami: not ported: `data-zam-region="timeline"`
                                (see the room header's). */}
                            <FlatList
                                key={roomId}
                                ref={scrollEl}
                                inverted
                                data={listRows}
                                keyExtractor={rowKey}
                                renderItem={renderItem}
                                // Rows re-render when renderItem changes, not
                                // on every render of the room.
                                strictMode
                                CellRendererComponent={TimelineCell}
                                onScroll={onListScroll}
                                scrollEventThrottle={16}
                                onLayout={onListLayoutStable}
                                onContentSizeChange={onListContentSizeChange}
                                onTouchStart={onListTouchStart}
                                onTouchEnd={onListTouchEnd}
                                onEndReached={onEndReached}
                                onEndReachedThreshold={
                                    listHeight > 0 ? 400 / listHeight : 1
                                }
                                onViewableItemsChanged={onViewableItemsChanged}
                                viewabilityConfig={VIEWABILITY}
                                onScrollToIndexFailed={
                                    onListScrollToIndexFailed
                                }
                                maintainVisibleContentPosition={
                                    visibleContentPosition
                                }
                                initialNumToRender={INITIAL_NUM_TO_RENDER}
                                maxToRenderPerBatch={10}
                                windowSize={11}
                                // MessageItem's action bar overlaps the row
                                // above it, so cells mustn't clip.
                                removeClippedSubviews={false}
                                // Zami: as in a native chat app, dragging the
                                // timeline puts the keyboard away (on iOS it
                                // follows the finger); a tap does too
                                // (onListTouchEnd), and still reaches what it
                                // landed on.
                                keyboardDismissMode={
                                    Platform.OS === "ios"
                                        ? "interactive"
                                        : "on-drag"
                                }
                                keyboardShouldPersistTaps="handled"
                                accessibilityLabel={t(
                                    "messageArea.messageTimeline",
                                )}
                                className="flex-1 overflow-x-hidden"
                                ListHeaderComponent={
                                    tombstone ? (
                                        <TombstoneBanner
                                            body={tombstone.body}
                                            joining={joiningUpgrade}
                                            alreadyJoined={
                                                replacementAlreadyJoined
                                            }
                                            onJoin={() => void joinUpgrade()}
                                        />
                                    ) : undefined
                                }
                                ListFooterComponent={
                                    <HistoryEdge
                                        state={historyEdgeState}
                                        roomName={roomName}
                                    />
                                }
                            />

                            {/* Polite announcer for arriving messages. A sibling of the timeline,
                                never a child: a live region inside role="log" is announced twice.
                                Debounced upstream so a burst is one utterance. */}
                            {/* Zami: AccessibilityInfo announces them (see
                                queueArrivalAnnouncement). */}

                            {/* Scroll to bottom button. Hidden while a composer suggestion list is
                                open so it doesn't fight the autocomplete for the same space. */}
                            {!isAtBottom &&
                            (!isContextView ||
                                unreadSummary ||
                                contextAtReadPosition) &&
                            messages.length > 0 &&
                            !composerAutocompleteOpen ? (
                                <View
                                    pointerEvents="box-none"
                                    className="absolute start-0 end-0 flex-row justify-center z-10"
                                    style={{ bottom: composerHeight + 12 }}
                                >
                                    {/* Zami: a press here doesn't take focus
                                        from the composer, so no pointerdown
                                        preventDefault. */}
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            isContextView
                                                ? void rejoinLive()
                                                : scrollToBottom(false)
                                        }
                                        className="bg-discord-backgroundSecondary hover:bg-discord-messageHover px-3 py-1.5 rounded-full shadow-lg border border-discord-divider transition-colors flex-row items-center gap-1.5"
                                    >
                                        <SvgIcon
                                            className="w-4 h-4 text-discord-textPrimary"
                                            d={CHEVRON_DOWN_PATH}
                                        />
                                        <Text className="text-discord-textPrimary text-sm font-medium">
                                            {t("messageArea.jumpToPresent")}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}

                            {/* Searching for unloaded message indicator */}
                            {jumpingToEventId ? (
                                <View
                                    pointerEvents="none"
                                    className="absolute start-0 end-0 flex-row justify-center z-10"
                                    style={{ bottom: composerHeight + 12 }}
                                >
                                    <View className="bg-discord-backgroundSecondary px-3 py-1.5 rounded-full shadow-lg border border-discord-divider flex-row items-center gap-2">
                                        <Spin className="w-3.5 h-3.5 border-2 border-discord-accent border-t-transparent rounded-full" />
                                        <Text className="text-discord-textMuted text-sm">
                                            {t(
                                                "messageArea.searchingForMessage",
                                            )}
                                        </Text>
                                    </View>
                                </View>
                            ) : null}

                            {/* Unread bar: how much arrived since last visit, with a jump back to
                                the divider and a way to dismiss it without scrolling down. */}
                            {unreadSummary ? (
                                <View className="absolute top-12 start-0 end-0 mx-4 z-10 flex-row items-stretch rounded-b-lg overflow-hidden shadow-lg bg-discord-accent">
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            interfaceState.jumpToUnread?.()
                                        }
                                        className="flex-1 min-w-0 px-3 py-1 hover:bg-white/10"
                                    >
                                        <Text
                                            numberOfLines={1}
                                            className="text-white text-sm font-semibold"
                                        >
                                            {t(
                                                unreadSummary.key,
                                                unreadSummary.params,
                                            )}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={markAsRead}
                                        className="flex-shrink-0 px-3 py-1 hover:bg-white/10 flex-row items-center gap-1"
                                    >
                                        <Text className="text-white text-sm font-semibold">
                                            {t("messageArea.markAsRead")}
                                        </Text>
                                        <SvgIcon
                                            className="w-4 h-4 text-white"
                                            d={CHECK_PATH}
                                        />
                                    </Pressable>
                                </View>
                            ) : null}

                            {/* Context view banner (the unread bar stands in for it while a room
                                is opened at the read position) */}
                            {isContextView &&
                            !unreadSummary &&
                            !contextAtReadPosition ? (
                                <View
                                    pointerEvents="box-none"
                                    className="absolute top-12 start-0 end-0 flex-row justify-center z-10"
                                >
                                    <View className="bg-discord-warning/20 px-3 py-1.5 rounded-full shadow-lg border border-discord-warning/40 flex-row items-center gap-2">
                                        <SvgIcon
                                            className="w-3.5 h-3.5 flex-shrink-0 text-discord-warning"
                                            d={INFO_PATH}
                                        />
                                        <Text className="text-discord-warning text-sm">
                                            {t(
                                                "messageArea.viewingMessageContext",
                                            )}
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => void rejoinLive()}
                                            className="ms-1"
                                        >
                                            <Text className="text-discord-warning text-sm underline">
                                                {t("messageArea.returnToLive")}
                                            </Text>
                                        </Pressable>
                                    </View>
                                </View>
                            ) : null}

                            {/* Message input. Wrapped so its rendered height can be measured and
                                the floating pills above can be offset to clear it. A cached room
                                has no live timeline to send into, so it shows a note instead.
                                That happens offline and also for a moment on every online boot,
                                so the note doesn't claim either: ReconnectPill reports the
                                connection. */}
                            {cachedOnly ? (
                                <View
                                    style={{
                                        direction: uiDir,
                                        marginBottom: 16 + bottomInset,
                                    }}
                                    className="flex-shrink-0 mx-4 rounded-lg border border-discord-backgroundModifier bg-discord-backgroundSecondary px-4 py-3"
                                >
                                    <Text className="text-xs text-discord-textMuted">
                                        {t("messageArea.cachedRoomHint")}
                                    </Text>
                                </View>
                            ) : (
                                <View
                                    onLayout={(e) =>
                                        setComposerHeight(
                                            e.nativeEvent.layout.height,
                                        )
                                    }
                                    className="flex-shrink-0"
                                >
                                    <MessageInput
                                        ref={messageInputEl}
                                        autocompleteOpen={
                                            composerAutocompleteOpen
                                        }
                                        onAutocompleteOpenChange={
                                            setComposerAutocompleteOpen
                                        }
                                        roomId={roomId}
                                        roomName={roomName}
                                        room={room}
                                        replyToEvent={replyToEvent}
                                        scrollEl={timelineScroller}
                                        keepScrollOnSend={isContextView}
                                        onCancelReply={() => {
                                            setReplyToEvent(null);
                                        }}
                                        onRequestEditLast={() =>
                                            void requestEditLastMessage()
                                        }
                                        onSedEdit={(cmd) =>
                                            sedEditLastMessage(
                                                room,
                                                messages,
                                                auth.userId,
                                                cmd,
                                            )
                                        }
                                        onThreadCreated={openThread}
                                    />
                                </View>
                            )}
                        </View>

                        {/* Debug panel (toggleDebug keybind, Ctrl+Alt+Shift+D by default) */}
                        {/* Zami: upstream's `display: contents` wrapper, which gives the
                            panels the UI direction, is the mobile drawers' own boxes;
                            the desktop panels keep the root's. */}
                        <DebugPanel room={room} />

                        {/* User profile card (opened from the member list or a message header) */}
                        <UserProfileCard room={room} />

                        {/* Right panel (pinned or notifications inbox) */}
                        {isMobile ? (
                            <>
                                <Animated.View
                                    pointerEvents={
                                        showRightPanel || isPinnedDragging
                                            ? "auto"
                                            : "none"
                                    }
                                    style={pinnedBackdropStyle}
                                    className="absolute inset-0 z-30 bg-black"
                                >
                                    <Pressable
                                        accessible={false}
                                        className="flex-1"
                                        onPress={() => {
                                            if (!isPinnedDragging)
                                                closeSidebar();
                                        }}
                                    />
                                </Animated.View>
                                <Animated.View
                                    className="absolute inset-y-0 right-0 z-40 h-full bg-discord-backgroundSecondary"
                                    style={[
                                        {
                                            width: PINNED_WIDTH,
                                            direction: uiDir,
                                            paddingBottom: bottomInset,
                                        },
                                        pinnedDrawerStyle,
                                        rightPanelClosed
                                            ? null
                                            : {
                                                  boxShadow:
                                                      "-25px 0 50px -12px rgba(0,0,0,0.5)",
                                              },
                                    ]}
                                    pointerEvents={
                                        rightPanelClosed ? "none" : "auto"
                                    }
                                    accessibilityElementsHidden={
                                        rightPanelClosed
                                    }
                                    importantForAccessibility={
                                        rightPanelClosed
                                            ? "no-hide-descendants"
                                            : "auto"
                                    }
                                >
                                    {rightPanel}
                                </Animated.View>
                            </>
                        ) : (
                            rightPanel
                        )}

                        {/* Member list sidebar (animated overlay on mobile, inline on desktop) */}
                        {isMobile ? (
                            <>
                                <Animated.View
                                    pointerEvents={
                                        showMemberList || isMemberDragging
                                            ? "auto"
                                            : "none"
                                    }
                                    style={memberBackdropStyle}
                                    className="absolute inset-0 z-30 bg-black"
                                >
                                    <Pressable
                                        accessible={false}
                                        className="flex-1"
                                        onPress={() => {
                                            if (!isMemberDragging)
                                                closeSidebar();
                                        }}
                                    />
                                </Animated.View>
                                <Animated.View
                                    className="absolute inset-y-0 right-0 z-40 h-full bg-discord-backgroundSecondary"
                                    style={[
                                        {
                                            width: MEMBER_WIDTH,
                                            direction: uiDir,
                                            paddingBottom: bottomInset,
                                        },
                                        memberDrawerStyle,
                                        memberDrawerClosed
                                            ? null
                                            : {
                                                  boxShadow:
                                                      "-25px 0 50px -12px rgba(0,0,0,0.5)",
                                              },
                                    ]}
                                    pointerEvents={
                                        memberDrawerClosed ? "none" : "auto"
                                    }
                                    accessibilityElementsHidden={
                                        memberDrawerClosed
                                    }
                                    importantForAccessibility={
                                        memberDrawerClosed
                                            ? "no-hide-descendants"
                                            : "auto"
                                    }
                                >
                                    <MemberList room={room} />
                                </Animated.View>
                            </>
                        ) : showMemberList ? (
                            <MemberList room={room} />
                        ) : null}

                        {/* Plugin room-header panel (single sidebar slot). Additive: no inbound
                            rendering touched. Title is escaped text; body is the plugin's own DOM
                            mounted via pluginMount (cleanup runs on unmount/close/supersede). */}
                        {currentPluginPanel ? (
                            // Zami: `bg-discord-background`: upstream's
                            // `bg-discord-backgroundPrimary` names no color
                            // (tailwind.config.js has `background`), which
                            // leaves the full-screen panel see-through.
                            <View
                                style={{ direction: uiDir }}
                                className={
                                    isMobile
                                        ? "absolute inset-0 z-40 flex-col bg-discord-background"
                                        : "w-80 flex-shrink-0 flex-col border-l border-discord-divider bg-discord-backgroundSecondary"
                                }
                            >
                                <View className="flex-row items-center justify-between px-4 h-12 flex-shrink-0 border-b border-discord-divider">
                                    <Text
                                        numberOfLines={1}
                                        className="flex-shrink font-semibold text-discord-textPrimary"
                                    >
                                        {currentPluginPanel.title}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={closeSidebar}
                                        className="p-1.5 rounded hover:bg-discord-messageHover"
                                        accessibilityLabel={t(
                                            "messageArea.closePanel",
                                        )}
                                    >
                                        <X
                                            size={20}
                                            className="text-discord-textMuted"
                                        />
                                    </Pressable>
                                </View>
                                {/* Zami: the plugin builds DOM into the element
                                    (pluginMount), which DomView shows. */}
                                <ScrollView
                                    key={currentPluginPanel.key}
                                    className="flex-1"
                                    keyboardShouldPersistTaps="handled"
                                >
                                    <DomMount
                                        document={document}
                                        mount={(el) =>
                                            pluginMount(
                                                el,
                                                currentPluginPanel.render,
                                            ).destroy
                                        }
                                    />
                                </ScrollView>
                            </View>
                        ) : null}

                        {/* Thread panel. Mobile: always fullscreen over the timeline (the w-80
                            side sheet was unusably cramped). Desktop: side panel by default,
                            with an expand toggle that swaps it to fullscreen. */}
                        {threadRootId ? (
                            isMobile ? (
                                <View
                                    style={{ direction: uiDir }}
                                    className="absolute inset-0 z-40"
                                >
                                    <ThreadPanel
                                        room={room}
                                        rootEventId={threadRootId}
                                        onClose={closeThread}
                                        fullscreen
                                    />
                                </View>
                            ) : threadFullscreen ? (
                                <View
                                    style={{ direction: uiDir }}
                                    className="absolute inset-0 z-30"
                                >
                                    <ThreadPanel
                                        room={room}
                                        rootEventId={threadRootId}
                                        onClose={closeThread}
                                        fullscreen
                                        onToggleFullscreen={() =>
                                            setThreadFullscreen((f) => !f)
                                        }
                                    />
                                </View>
                            ) : (
                                <ThreadPanel
                                    room={room}
                                    rootEventId={threadRootId}
                                    onClose={closeThread}
                                    onToggleFullscreen={() =>
                                        setThreadFullscreen((f) => !f)
                                    }
                                />
                            )
                        ) : null}
                    </View>
                </GestureDetector>
            </KeyboardAvoidingView>

            {isMobile && overflowOpen ? (
                <RoomHeaderOverflowMenu
                    activeSidebar={sidebar}
                    threadMentions={threadRollup.mentions}
                    threadAnyUnread={threadRollup.anyUnread}
                    pinnedCount={pinnedCount}
                    pluginRows={pluginOverflowRows}
                    onChoose={chooseOverflowItem}
                    onChoosePlugin={choosePluginOverflow}
                    onClose={closeModal}
                />
            ) : null}

            {isMobile && topicOpen && topic ? (
                <RoomTopicSheet
                    roomId={room.roomId}
                    roomName={roomName}
                    avatarSrc={getRoomAvatar(room)}
                    topic={topic}
                    onClose={closeModal}
                />
            ) : null}
        </>
    );
}

const rowKey = (event: MatrixEvent) => timelineKey(event) ?? "";

/** Zami: what a row reads to work out its props (see rowsContext). */
interface RowsContext {
    messages: MatrixEvent[];
    /** The row the "New Messages" divider sits above, or -1. */
    dividerIndex: number;
    isRawDebugEvent: (event: MatrixEvent) => boolean;
    ignoredUserIds: string[];
    myUserId: string | null;
    revealedBlockedIds: Record<string, boolean>;
    receiptsByEvent: Map<string, ReadReceiptInfo[]> | null;
    callSummaries: Map<string, CallSummary>;
    editRequestedEventId: string | null;
    highlight: { eventId: string; n: number } | null;
}

/**
 * Zami: the rows' context outside React state. MessageArea `update`s it as it
 * renders (so rows mounting in that render read the new one) and `notify`s the
 * mounted rows after the commit; `touch` makes them re-read it without a new
 * one, after decryptions (their mention highlights). Each row re-renders only
 * when its own props change (useRowProps).
 */
interface RowsStore {
    context: RowsContext;
    version: number;
    subscribe: (listener: () => void) => () => void;
    update: (context: RowsContext) => void;
    notify: () => void;
    touch: () => void;
}

function createRowsStore(): RowsStore {
    const listeners = new Set<() => void>();
    const store: RowsStore = {
        context: {
            messages: [],
            dividerIndex: -1,
            isRawDebugEvent: () => false,
            ignoredUserIds: [],
            myUserId: null,
            revealedBlockedIds: {},
            receiptsByEvent: null,
            callSummaries: new Map(),
            editRequestedEventId: null,
            highlight: null,
        },
        version: 0,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        update: (context) => {
            if (context === store.context) return;
            store.context = context;
            store.version++;
        },
        notify: () => {
            for (const listener of [...listeners]) listener();
        },
        touch: () => {
            store.version++;
            store.notify();
        },
    };
    return store;
}

/** Zami: a row's props from the rows' context (upstream's {#each} body). */
interface RowProps {
    /** The chronological list and this row's index in it. */
    messages: MatrixEvent[];
    index: number;
    sepTs: number | null;
    unreadHere: boolean;
    rawDebug: boolean;
    blocked: boolean;
    showHeader: boolean;
    receipts: ReadReceiptInfo[];
    mentionHighlight: boolean;
    callSummary: CallSummary | null;
    editRequested: boolean;
    highlightN: number;
}

function rowPropsOf(context: RowsContext, event: MatrixEvent): RowProps {
    const { messages } = context;
    const i = keyIndex(messages).get(rowKey(event)) ?? -1;
    const id = event.getId() ?? "";
    return {
        messages,
        index: i,
        sepTs: i >= 0 ? dateSeparatorLabel(messages, i) : null,
        unreadHere: i >= 0 && i === context.dividerIndex,
        rawDebug: context.isRawDebugEvent(event),
        blocked:
            shouldHideMessage(
                event.getSender(),
                context.ignoredUserIds,
                context.myUserId,
            ) && !context.revealedBlockedIds[id],
        showHeader: i >= 0 && shouldShowHeader(messages, i),
        receipts: context.receiptsByEvent?.get(id) ?? NO_RECEIPTS,
        mentionHighlight: mentionHighlightOf(event),
        callSummary: context.callSummaries.get(id) ?? null,
        editRequested: context.editRequestedEventId === event.getId(),
        highlightN:
            context.highlight && context.highlight.eventId === event.getId()
                ? context.highlight.n
                : 0,
    };
}

/** Zami: the row's props, re-rendering it only when they change. */
function useRowProps(store: RowsStore, event: MatrixEvent): RowProps {
    const last = useRef<{
        version: number;
        event: MatrixEvent;
        props: RowProps;
    } | null>(null);
    const getSnapshot = useCallback(() => {
        const prev = last.current;
        if (prev && prev.version === store.version && prev.event === event)
            return prev.props;
        let props = rowPropsOf(store.context, event);
        if (
            prev &&
            prev.event === event &&
            sameRowProps(prev.props, props, event)
        )
            props = prev.props;
        last.current = { version: store.version, event, props };
        return props;
    }, [store, event]);
    return useSyncExternalStore(store.subscribe, getSnapshot);
}

/** Zami: isHighlightEvent per event, remembered until it decrypts (#39). */
const mentionHighlights = new WeakMap<
    MatrixEvent,
    { clear: boolean; value: boolean }
>();
function mentionHighlightOf(event: MatrixEvent): boolean {
    const clear = !event.isEncrypted() || !!event.getClearContent();
    const known = mentionHighlights.get(event);
    if (known && known.clear === clear) return known.value;
    const value = isHighlightEvent(event);
    mentionHighlights.set(event, { clear, value });
    return value;
}

/** Zami: each list's row keys and their indexes, built once per list. */
const keyIndexes = new WeakMap<MatrixEvent[], Map<string, number>>();
function keyIndex(list: MatrixEvent[]): Map<string, number> {
    let index = keyIndexes.get(list);
    if (!index) {
        index = new Map();
        for (const [i, event] of list.entries()) index.set(rowKey(event), i);
        keyIndexes.set(list, index);
    }
    return index;
}

/** Zami: whether two lists hold the very same events in the same order. */
function sameEvents(a: MatrixEvent[], b: MatrixEvent[]): boolean {
    return a.length === b.length && a.every((e, i) => e === b[i]);
}

interface TimelineRowProps {
    event: MatrixEvent;
    room: Room;
    /** Zami: the rows' context, from which the row works out its props. */
    rowsStore: RowsStore;
    onReply: (event: MatrixEvent) => void;
    jumpToReply: (eventId: string) => void;
    onOpenThread: (rootEventId: string) => void;
    onEditDone: () => void;
    onRevealBlocked: (eventId: string) => void;
    onRowTouch: (eventId: string) => void;
}

/**
 * Zami: one row of the `{#each}`: its day separator, unread divider, and the
 * message (or its debug row, or the blocked-user placeholder). Memo'd, as
 * MessageItem is; its props from the rows' context re-render it only when they
 * change (useRowProps).
 */
const TimelineRow = memo(function TimelineRow({
    event,
    room,
    rowsStore,
    onReply,
    jumpToReply,
    onOpenThread,
    onEditDone,
    onRevealBlocked,
    onRowTouch,
}: TimelineRowProps) {
    const {
        messages,
        index: i,
        sepTs,
        unreadHere,
        rawDebug,
        blocked,
        showHeader,
        receipts,
        mentionHighlight,
        callSummary,
        editRequested,
        highlightN,
    } = useRowProps(rowsStore, event);
    // One box per row, measured for the spacers. It carries the
    // unread divider's anchoring: a child can't opt back in
    // under a parent that opted out.
    // Zami: nothing to measure or anchor (the list does both).
    return (
        <View onTouchStart={() => onRowTouch(event.getId() ?? "")}>
            {sepTs !== null ? (
                <View className="flex-row items-center gap-4 px-4 my-4">
                    <View className="flex-1 h-px bg-discord-divider" />
                    <Text className="text-xs font-semibold text-discord-textMuted">
                        {daySeparator(sepTs)}
                    </Text>
                    <View className="flex-1 h-px bg-discord-divider" />
                </View>
            ) : null}
            {unreadHere ? (
                <View className="flex-row items-center gap-3 px-4 my-2">
                    <View className="flex-1 h-px bg-discord-danger/60" />
                    <Text className="text-xs font-semibold text-discord-danger uppercase tracking-wide">
                        {t("messageArea.newMessages")}
                    </Text>
                    <View className="flex-1 h-px bg-discord-danger/60" />
                </View>
            ) : null}
            {rawDebug ? (
                <DebugEventItem event={event} />
            ) : blocked ? (
                <View className="px-4 py-1.5 flex-row items-center gap-2">
                    <SvgIcon
                        className="w-3.5 h-3.5 flex-shrink-0 text-discord-textMuted"
                        d={BLOCKED_PATH}
                    />
                    <Text className="text-xs text-discord-textMuted italic">
                        {t("messageArea.messageFromABlockedUser")}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => onRevealBlocked(event.getId() ?? "")}
                    >
                        <Text className="text-xs text-discord-accent font-medium">
                            {t("messageArea.showBlockedMessage")}
                        </Text>
                    </Pressable>
                </View>
            ) : (
                <View>
                    {/* Zami: the jump's `message-highlight`, under the row. */}
                    <MessageHighlight n={highlightN} />
                    <MessageItem
                        event={event}
                        room={room}
                        showHeader={showHeader}
                        timelineEvents={messages}
                        timelineIndex={i}
                        onReply={onReply}
                        jumpToReply={jumpToReply}
                        onOpenThread={onOpenThread}
                        editRequested={editRequested}
                        onEditDone={onEditDone}
                        receipts={receipts}
                        mentionHighlight={mentionHighlight}
                        callSummary={callSummary}
                    />
                </View>
            )}
        </View>
    );
});

/**
 * Zami: whether a row renders the same with `next` as with `prev`. The list
 * and the row's index in it are new for every row whenever the timeline grows
 * or pages, but only an image upload reads them, when it's opened (to page
 * across the uploads around it), and then only that run of uploads matters.
 */
function sameRowProps(
    prev: Readonly<RowProps>,
    next: Readonly<RowProps>,
    event: MatrixEvent,
): boolean {
    for (const key of Object.keys(next) as (keyof RowProps)[]) {
        if (Object.is(prev[key], next[key])) continue;
        if (key === "messages" || key === "index") {
            if (event.getContent()?.msgtype !== "m.image") continue;
            if (
                sameUploadRun(
                    prev.messages,
                    prev.index,
                    next.messages,
                    next.index,
                )
            )
                continue;
        }
        return false;
    }
    return true;
}

/**
 * Zami: whether the image at `a[i]` is `b[j]` with the same run of images on
 * either side and the same event ending each run: what MessageItem pages
 * across when it's opened, from the list and index it last rendered with.
 */
function sameUploadRun(
    a: MatrixEvent[],
    i: number,
    b: MatrixEvent[],
    j: number,
): boolean {
    if (i < 0 || j < 0 || a[i] !== b[j]) return false;
    for (const step of [-1, 1]) {
        for (let d = step; ; d += step) {
            const x = a[i + d];
            if (x !== b[j + d]) return false;
            if (!x || x.getContent()?.msgtype !== "m.image") break;
        }
    }
    return true;
}

/**
 * Zami: MessageItem's action bar overlaps the row above it, which the inverted
 * list draws later, so on top of it. The selected row's cell is raised over
 * the others (touch shows the bar on the selected row). Only that one: a
 * zIndex reorders the native cells, and maintainVisibleContentPosition looks
 * for the row to hold in place in that order. Not ported: raising a row
 * hovered with a pointer.
 */
function TimelineCell({
    item,
    style,
    onLayout,
    onFocusCapture,
    children,
}: ComponentProps<
    NonNullable<FlatListProps<MatrixEvent>["CellRendererComponent"]>
>) {
    const raised = useRune(() => {
        const selected = interfaceState.selectedMessageId;
        return selected !== null && selected === item.getId();
    }, [item]);
    return (
        <View
            style={raised ? [style, { zIndex: 1 }] : style}
            onLayout={onLayout}
            onFocusCapture={onFocusCapture}
        >
            {children}
        </View>
    );
}

/** Zami: the top of the timeline (the list's footer): upstream's loading
 *  line and chat-start banner. */
function HistoryEdge({
    state,
    roomName,
}: {
    state: "start" | "loading" | "none";
    roomName: string;
}) {
    return (
        <>
            {/* Older history may still load: shown until the room's start is
                reached, so an unloaded top is never mistaken for it */}
            {state === "loading" ? (
                <View className="flex-row justify-center py-4">
                    <Spin
                        className="w-6 h-6 border-2 border-discord-accent border-t-transparent rounded-full"
                        accessibilityRole="progressbar"
                        accessibilityLabel={t("messageArea.loadingHistory")}
                    />
                </View>
            ) : null}

            {/* Chat start, shown only once the room's m.room.create is loaded */}
            {state === "start" ? (
                <View className="px-4 pb-4">
                    <View className="w-16 h-16 rounded-full bg-discord-accent flex-row items-center justify-center mb-4">
                        <Text className="text-3xl font-bold text-white">#</Text>
                    </View>
                    <Text
                        accessibilityRole="header"
                        className="text-2xl font-bold text-discord-textPrimary mb-1"
                    >
                        {t("messageArea.welcomeTo")}
                        {roomName}!
                    </Text>
                    <Text className="text-discord-textMuted">
                        {t("messageArea.thisIsTheBeginningOfThe")}
                        {roomName} {t("messageArea.room")}
                    </Text>
                </View>
            ) : null}
        </>
    );
}

/** Zami: the room upgrade tombstone banner, below the newest message (the
 *  list's header). */
function TombstoneBanner({
    body,
    joining,
    alreadyJoined,
    onJoin,
}: {
    body: string;
    joining: boolean;
    alreadyJoined: boolean;
    onJoin: () => void;
}) {
    return (
        <View className="mx-4 mt-2 mb-4 p-3 rounded-lg bg-discord-backgroundTertiary border border-discord-warning flex-row items-center gap-3">
            <SvgIcon
                className="w-5 h-5 text-discord-warning flex-shrink-0"
                d={WARNING_PATH}
            />
            <View className="flex-1 min-w-0">
                <Text className="text-sm font-semibold text-discord-textPrimary">
                    {t("messageArea.thisRoomHasBeenUpgraded")}
                </Text>
                <Text
                    numberOfLines={1}
                    className="text-xs text-discord-textMuted"
                >
                    {body}
                </Text>
            </View>
            <Pressable
                accessibilityRole="button"
                onPress={onJoin}
                disabled={joining}
                accessibilityState={{ disabled: joining }}
                className="flex-shrink-0 px-3 py-1.5 rounded bg-discord-accent hover:bg-discord-accentHover transition-colors disabled:opacity-50"
            >
                <Text className="text-white text-sm font-semibold">
                    {alreadyJoined
                        ? t("messageArea.goToNewRoom")
                        : joining
                          ? t("common.joining")
                          : t("messageArea.joinNewRoom")}
                </Text>
            </Pressable>
        </View>
    );
}

/**
 * Zami: `.message-highlight` (src/app.zami.css): the mention-highlight wash,
 * held for 70% of 2s, then faded out ease-out. Reanimated skips it under
 * reduced motion, where upstream's collapsed animation never shows either.
 */
function MessageHighlight({ n }: { n: number }) {
    const opacity = useSharedValue(0);
    useEffect(() => {
        if (!n) return;
        opacity.value = 1;
        opacity.value = withDelay(
            1400,
            withTiming(0, {
                duration: 600,
                easing: Easing.bezier(0, 0, 0.58, 1),
            }),
        );
    }, [n, opacity]);
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
    if (!n) return null;
    return (
        <Animated.View
            pointerEvents="none"
            style={style}
            className="absolute inset-0 bg-[rgb(var(--discord-mention-highlight-rgb)_/_0.35)]"
        />
    );
}

/** Zami: `next`, keeping `prev`'s value for each key whose value is `same`
 *  as before, so rows memo'd on it skip re-rendering. */
function keepEqualValues<V, M extends Map<string, V> | null>(
    prev: Map<string, V> | null,
    next: M,
    same: (a: V, b: V) => boolean,
): M {
    if (!prev || !next) return next;
    for (const [key, value] of next) {
        const old = prev.get(key);
        if (old !== undefined && old !== value && same(old, value))
            next.set(key, old);
    }
    return next;
}

/** Zami: whether two maps hold the very same values under the same keys. */
function sameEntries<V>(a: Map<string, V>, b: Map<string, V>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, value] of b) if (a.get(key) !== value) return false;
    return true;
}

function sameReceipts(a: ReadReceiptInfo[], b: ReadReceiptInfo[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (r, i) =>
                r.userId === b[i].userId &&
                r.ts === b[i].ts &&
                r.name === b[i].name &&
                r.avatarUrl === b[i].avatarUrl,
        )
    );
}

function sameCallSummary(a: CallSummary, b: CallSummary): boolean {
    return (
        a.callId === b.callId &&
        a.anchorEventId === b.anchorEventId &&
        a.startTs === b.startTs &&
        a.endTs === b.endTs &&
        a.durationMs === b.durationMs &&
        a.outcome === b.outcome &&
        a.notified === b.notified &&
        a.participants.length === b.participants.length &&
        a.participants.every((p, i) => p === b.participants[i])
    );
}

/** Zami: `$state` that async code reads back right after writing it: the
 *  value to render, its setter, and a ref that always holds the latest. */
function useLiveState<T>(initial: T) {
    const [value, setValue] = useState(initial);
    const ref = useRef(initial);
    const set = useCallback((next: T) => {
        ref.current = next;
        setValue(() => next);
    }, []);
    return [value, set, ref] as const;
}

/** Zami: Svelte's `tick()`: a promise that resolves once React has committed
 *  the updates made before it. */
function useTick(): () => Promise<void> {
    const [, setTick] = useState(0);
    const waiting = useRef<(() => void)[]>([]);
    const forcing = useRef(false);
    useEffect(() => {
        forcing.current = false;
        if (waiting.current.length === 0) return;
        const resolve = waiting.current;
        waiting.current = [];
        for (const r of resolve) r();
    });
    return useCallback(
        () =>
            new Promise<void>((resolve) => {
                waiting.current.push(resolve);
                if (forcing.current) return;
                forcing.current = true;
                // Most callers have just set state (or written a store the
                // component reads), so a commit is on its way and resolves
                // them. Only one that doesn't come by the next frame is
                // forced: forcing one each time rendered this whole component
                // again per arriving message. (A timer too: no frames come
                // while the app is in the background.)
                const force = () => {
                    if (forcing.current) setTick((n) => n + 1);
                };
                requestAnimationFrame(force);
                setTimeout(force, 32);
            }),
        [],
    );
}

/** Zami: a callback that keeps its identity across renders (so memo'd rows
 *  skip re-rendering) and always calls the latest `fn`. */
function useStableCallback<A extends unknown[], R>(
    fn: (...args: A) => R,
): (...args: A) => R {
    const latest = useRef(fn);
    useLayoutEffect(() => {
        latest.current = fn;
    });
    return useCallback((...args: A) => latest.current(...args), []);
}
