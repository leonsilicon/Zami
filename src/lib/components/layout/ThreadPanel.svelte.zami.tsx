import { SvgIcon } from "@-/com.leonsilicon.zami.rn";
import { useRune } from "@-/com.leonsilicon.zami.svelte-react";
import {
    useCallback,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
} from "react";
import {
    AppState,
    FlatList,
    Pressable,
    ScrollView,
    Text,
    View,
    type FlatListProps,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from "react-native-reanimated";
import { t } from "$lib/i18n";
import type { Room, MatrixEvent } from "matrix-js-sdk";
import MessageItem from "$lib/components/messages/MessageItem.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { sedEditLastMessage } from "$lib/matrix/editMessage";
import {
    getThreadMessages,
    paginateThreadBack,
    onThreadEvent,
    onLocalEchoUpdated,
    findEventById,
    markThreadRead,
    getThreadName,
    canNameThread,
    setThreadName,
} from "$lib/matrix/client";
import RenameThreadDialog from "$lib/components/layout/RenameThreadDialog.svelte";
import {
    interfaceState,
    openModal,
    closeModal,
} from "$lib/stores/interface.svelte";
import { roomsState, bumpUnreadTick } from "$lib/stores/rooms.svelte";
import MessageInput, {
    type MessageInputHandle,
} from "$lib/components/messages/MessageInput.svelte";
import { composerThreadKey } from "$lib/utils/threadContent";
import { canSendReceipt } from "$lib/utils/receiptGate";
import { timelineKey } from "$lib/utils/timelineDisplay";

// Zami: the replies are an inverted FlatList (newest first, drawn bottom-up),
// so the newest reply sits at scroll offset 0 and older replies load past the
// top without moving what's on screen. The parent (MessageArea) keeps the
// panel, and so its composer, above the keyboard.

interface Props {
    room: Room;
    rootEventId: string;
    onClose: () => void;
    /** Fill the container (thread replaces the timeline) instead of the w-80 side panel. */
    fullscreen?: boolean;
    /** Desktop only: show an expand/collapse toggle that flips fullscreen. */
    onToggleFullscreen?: () => void;
}

const RENAME_PATH =
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z";
const COLLAPSE_PATH =
    "M22 3.41 16.71 8.7 20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM3.41 22l5.29-5.29L12 20v-8H4l3.29 3.29L2 20.59 3.41 22z";
const EXPAND_PATH =
    "M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10L21 11z";
const CLOSE_PATH =
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

export default function ThreadPanel({
    room,
    rootEventId,
    onClose,
    fullscreen = false,
    onToggleFullscreen,
}: Props) {
    const scrollEl = useRef<FlatList<MatrixEvent>>(null);
    const [threadTick, setThreadTick] = useState(0);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [noMoreOlder, setNoMoreOlder] = useState(false);
    const [replyToEvent, setReplyToEvent] = useState<MatrixEvent | null>(null);
    const messageInputEl = useRef<MessageInputHandle>(null);
    // Plain (non-reactive) scroll bookkeeping for the auto-scroll effect below.
    const atBottom = useRef(true);
    const lastLatestId = useRef<string | null>(null);
    // Zami: the props as of the latest render, for the checks after an await.
    const rootEventIdRef = useRef(rootEventId);
    useLayoutEffect(() => {
        rootEventIdRef.current = rootEventId;
    });

    function bump() {
        setThreadTick((n) => n + 1);
    }

    async function loadOlder() {
        if (loadingOlder || noMoreOlder) return;
        // The panel is reused (no {#key}) when rootEventId changes, so it can
        // change while paginateThreadBack awaits. Capture it and drop a stale
        // result so thread A's "no more replies" verdict / lock is never applied
        // to thread B (F4).
        const rid = rootEventId;
        setLoadingOlder(true);
        try {
            const more = await paginateThreadBack(room, rootEventId);
            if (rootEventIdRef.current !== rid) return;
            if (!more) setNoMoreOlder(true);
            // Zami: no holding the distance from the bottom: older replies land
            // past the inverted list's top, which leaves the reader in place.
            bump();
        } catch (err) {
            console.error("Failed to paginate thread:", err);
        } finally {
            if (rootEventIdRef.current === rid) setLoadingOlder(false);
        }
    }

    // Re-read thread messages whenever tick changes
    const messages = useMemo(() => {
        void threadTick;
        return getThreadMessages(room, rootEventId);
    }, [threadTick, room, rootEventId]);
    // Zami: newest first, for the inverted list.
    const rows = useMemo(() => [...messages].reverse(), [messages]);

    // threadTick dependency is load-bearing for the "Create thread" flow: the
    // panel opens on a root whose remote echo hasn't landed in the timeline
    // yet, so the first lookup is null — without the tick this derived never
    // re-runs (stable room + id) and the header stays blank forever. The
    // localEchoUpdated subscription bumps the tick when the echo reconciles.
    const rootEvent = useMemo(() => {
        void threadTick;
        return findEventById(room, rootEventId);
    }, [threadTick, room, rootEventId]);
    // Thread name (AppShell bumps roomsTick when one changes).
    const threadName = useRune(() => {
        void roomsState.roomsTick;
        return getThreadName(room, rootEventId);
    }, [room, rootEventId]);
    const mayName = useRune(() => {
        void roomsState.roomsTick;
        return canNameThread(room, rootEventId);
    }, [room, rootEventId]);
    // The thread being renamed: pinned when the dialog opens, so a retarget
    // of the panel underneath can't redirect the save.
    const [renaming, setRenaming] = useState<{
        rootId: string;
        name: string | null;
    } | null>(null);
    function openRename() {
        openModal("rename-thread", () => setRenaming(null));
        setRenaming({ rootId: rootEventId, name: threadName });
    }
    const modal = useRune(() => interfaceState.modal);

    // Subscribe to thread events
    useEffect(() => {
        const unsub = onThreadEvent(bump);
        return unsub;
    }, []);

    // Subscribe to local echo updates so pending sends appear immediately
    useEffect(() => {
        const unsub = onLocalEchoUpdated((eventRoom: Room) => {
            if (eventRoom.roomId === room.roomId) bump();
        });
        return unsub;
    }, [room]);

    // Mark the thread read when opened and whenever a new reply lands while it
    // is open. Threaded receipt only (⚑6) — does not touch main-timeline unread.
    // untrack() is load-bearing: sendReadReceipt fires every receipt listener
    // SYNCHRONOUSLY (bumpUnreadTick etc.), so any reactive read inside that
    // cascade would become a dependency of this effect while the cascade's
    // writes retrigger it — an infinite loop (effect_update_depth_exceeded)
    // that froze the whole panel. Track only the open thread + latest reply.
    // Zami: useEffectEvent is the untrack(): the effect depends only on the
    // thread and its reply count.
    const markRead = useEffectEvent(() => {
        // Only claim the thread "read" when the user could actually see it —
        // window focused AND tab visible — mirroring the main-timeline gate
        // (receiptGate.ts / MessageArea markAsReadIfDisplayable). Without this
        // a threaded receipt fires while the window is hidden/unfocused (S-A2).
        // Zami: the window's focus and visibility are AppState's "active".
        const active = AppState.currentState === "active";
        if (canSendReceipt({ hasFocus: active, visible: active })) {
            markThreadRead(room, rootEventId)
                .then((cleared) => {
                    if (cleared) bumpUnreadTick();
                })
                .catch(() => {});
        }
    });
    useEffect(() => {
        markRead();
    }, [rootEventId, messages.length]);

    // Reset pagination flags when the panel retargets to a different thread root.
    // The panel is reused (no {#key}) across a rootEventId change, so without this
    // thread A's noMoreOlder hides "Load older replies" for thread B, and a
    // stranded loadingOlder leaves B's button disabled forever (F4).
    useEffect(() => {
        void rootEventId;
        setNoMoreOlder(false);
        setLoadingOlder(false);
        setReplyToEvent(null);
        atBottom.current = true;
        lastLatestId.current = null;
    }, [rootEventId]);

    // Follow the newest reply, but only when a new one actually arrives and
    // the reader is already at the bottom (or sent it). `messages` is re-read
    // on every thread/edit/redaction event in ANY room and when older replies
    // load, and none of those may yank someone reading further up.
    useEffect(() => {
        const latest = messages[messages.length - 1];
        const latestId = latest?.getId() ?? null;
        if (latestId === lastLatestId.current) return;
        const first = lastLatestId.current === null;
        lastLatestId.current = latestId;
        const mine = !!latest && latest.getSender() === auth.userId;
        if (!first && !atBottom.current && !mine) return;
        // Zami: the inverted list's bottom is offset 0.
        scrollEl.current?.scrollToOffset({ offset: 0, animated: false });
    }, [messages]);

    // Zami: `scrollHeight - scrollTop - clientHeight` is the inverted list's
    // offset.
    function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
        atBottom.current = e.nativeEvent.contentOffset.y < 80;
    }

    // Zami: `message-highlight` on a row, as the row's id and a count that
    // restarts its flash; cleared after the 2s, as upstream removes the class.
    const [highlight, setHighlight] = useState<{
        eventId: string;
        n: number;
    } | null>(null);
    const highlightCount = useRef(0);
    // Zami: how often a scroll to a row not laid out yet has been retried.
    const scrollRetries = useRef(0);

    const jumpToReply = useStableCallback((eventId: string) => {
        // Zami: the row by its index in the list, for `[data-event-id]`.
        const i = messages.findIndex((e) => e.getId() === eventId);
        if (i < 0) return;
        scrollRetries.current = 0;
        scrollToRow(messages.length - 1 - i);
        const n = ++highlightCount.current;
        setHighlight({ eventId, n });
        setTimeout(() => setHighlight((h) => (h?.n === n ? null : h)), 2000);
    });

    // Zami: `scrollIntoView({ block: "center" })`. A row the list hasn't laid
    // out yet is first scrolled near by its estimated offset, then centred.
    function scrollToRow(index: number) {
        scrollEl.current?.scrollToIndex({
            index,
            viewPosition: 0.5,
            animated: false,
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
        if (scrollRetries.current++ >= 10) return;
        setTimeout(() => {
            if (info.index < rows.length) scrollToRow(info.index);
        }, 50);
    }

    function shouldShowHeader(events: MatrixEvent[], index: number): boolean {
        if (index === 0) return true;
        const prev = events[index - 1];
        const curr = events[index];
        if (prev.getSender() !== curr.getSender()) return true;
        return curr.getTs() - prev.getTs() > 5 * 60 * 1000;
    }

    const onReply = useCallback((e: MatrixEvent) => {
        setReplyToEvent(e);
        messageInputEl.current?.focus();
    }, []);

    const renderItem = ({
        item: event,
        index,
    }: {
        item: MatrixEvent;
        index: number;
    }) => {
        const i = messages.length - 1 - index;
        return (
            <View>
                {/* Zami: the jump's `message-highlight`, under the row. */}
                <MessageHighlight
                    n={
                        highlight && highlight.eventId === event.getId()
                            ? highlight.n
                            : 0
                    }
                />
                <MessageItem
                    event={event}
                    room={room}
                    showHeader={shouldShowHeader(messages, i)}
                    timelineEvents={messages}
                    timelineIndex={i}
                    onReply={onReply}
                    jumpToReply={jumpToReply}
                />
            </View>
        );
    };

    const titleLabel = threadName
        ? t("renameThreadDialog.renameThread")
        : t("renameThreadDialog.nameThread");

    return (
        <>
            <View
                className={`${
                    fullscreen ? "w-full" : "w-80 border-l"
                } h-full flex-shrink-0 flex flex-col border-discord-divider bg-discord-background overflow-hidden`}
            >
                {/* Header */}
                <View className="h-12 px-4 flex-row items-center justify-between border-b border-discord-divider flex-shrink-0">
                    <Text
                        numberOfLines={1}
                        className="flex-shrink font-semibold text-discord-textPrimary text-sm min-w-0"
                    >
                        {threadName ?? t("threadPanel.thread")}
                    </Text>
                    <View className="flex-row items-center gap-1 flex-shrink-0">
                        {mayName ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={openRename}
                                className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                                accessibilityLabel={titleLabel}
                            >
                                <SvgIcon
                                    className="w-4 h-4 text-discord-textMuted"
                                    d={RENAME_PATH}
                                />
                            </Pressable>
                        ) : null}
                        {onToggleFullscreen ? (
                            <Pressable
                                accessibilityRole="button"
                                onPress={onToggleFullscreen}
                                className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                                accessibilityLabel={
                                    fullscreen
                                        ? t("threadPanel.collapseThread")
                                        : t("threadPanel.expandThread")
                                }
                            >
                                {fullscreen ? (
                                    <SvgIcon
                                        className="w-4 h-4 text-discord-textMuted"
                                        d={COLLAPSE_PATH}
                                    />
                                ) : (
                                    <SvgIcon
                                        className="w-4 h-4 text-discord-textMuted"
                                        d={EXPAND_PATH}
                                    />
                                )}
                            </Pressable>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            onPress={onClose}
                            className="p-1.5 rounded hover:bg-discord-messageHover transition-colors"
                            accessibilityLabel={t("threadPanel.closeThread")}
                        >
                            <SvgIcon
                                className="w-4 h-4 text-discord-textMuted"
                                d={CLOSE_PATH}
                            />
                        </Pressable>
                    </View>
                </View>

                {/* Thread root message, rendered like any other message (media,
                    formatting, reactions) but capped so a long root can't push the
                    replies off screen. */}
                {rootEvent ? (
                    <ScrollView
                        className="border-b border-discord-divider flex-shrink-0 flex-grow-0 bg-discord-backgroundSecondary max-h-60"
                        contentContainerClassName="py-1"
                    >
                        <MessageItem
                            event={rootEvent}
                            room={room}
                            showHeader={true}
                            onReply={onReply}
                            jumpToReply={jumpToReply}
                        />
                    </ScrollView>
                ) : null}

                {/* Replies */}
                {/* Zami: inverted, so the list's footer is its top: the empty
                    note and the "load older" button go there. `flexGrow` with
                    `justify-end` keeps a short thread at the top, as upstream's
                    plain scroller does. */}
                <FlatList
                    ref={scrollEl}
                    inverted
                    data={rows}
                    keyExtractor={(event) => timelineKey(event) ?? ""}
                    renderItem={renderItem}
                    extraData={highlight}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                    onScrollToIndexFailed={onScrollToIndexFailed}
                    // A reply arriving while the reader is further up mustn't
                    // shove what they're reading.
                    maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                    keyboardShouldPersistTaps="handled"
                    removeClippedSubviews={false}
                    CellRendererComponent={ReplyCell}
                    className="flex-1"
                    contentContainerClassName="py-2 flex-grow justify-end"
                    ListFooterComponent={
                        <>
                            {messages.length === 0 ? (
                                <Text className="text-xs text-discord-textMuted text-center mt-4 px-4">
                                    {t(
                                        "threadPanel.noRepliesYetStartTheThread",
                                    )}
                                </Text>
                            ) : null}
                            {messages.length > 0 && !noMoreOlder ? (
                                <View className="px-4 pb-2 items-center">
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            disabled: loadingOlder,
                                        }}
                                        onPress={() => void loadOlder()}
                                        disabled={loadingOlder}
                                        className="disabled:opacity-40 transition-colors"
                                    >
                                        <Text className="text-xs text-discord-textMuted">
                                            {loadingOlder
                                                ? t("common.loading")
                                                : t(
                                                      "threadPanel.loadOlderReplies",
                                                  )}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}
                        </>
                    }
                />

                {/* Reply input */}
                <View className="flex-shrink-0">
                    <MessageInput
                        ref={messageInputEl}
                        roomId={room.roomId}
                        roomName={room.name ?? ""}
                        room={room}
                        threadRootId={rootEventId}
                        replyToEvent={replyToEvent}
                        onCancelReply={() => {
                            setReplyToEvent(null);
                        }}
                        composerKey={composerThreadKey(
                            room.roomId,
                            rootEventId,
                        )}
                        onSedEdit={(cmd) =>
                            sedEditLastMessage(room, messages, auth.userId, cmd)
                        }
                    />
                </View>
            </View>

            {renaming && modal === "rename-thread" ? (
                <RenameThreadDialog
                    name={renaming.name}
                    onSave={(name) =>
                        setThreadName(room, renaming.rootId, name)
                    }
                    onClose={closeModal}
                />
            ) : null}
        </>
    );
}

/**
 * Zami: MessageItem's action bar overlaps the row above it, which the inverted
 * list draws later, so on top of it. The selected reply's cell is raised over
 * the others. Only that one: a zIndex reorders the native cells, and
 * maintainVisibleContentPosition looks for the row to hold in place in that
 * order.
 */
function ReplyCell({
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
